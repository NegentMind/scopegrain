// SPDX-License-Identifier: Apache-2.0
// Property-based test: arbitrary sequences of task FSM transition
// attempts (valid, invalid, stale-revision, self-loop, evidence-attach)
// driven against a REAL task file in a temp project. Invariants per
// step:
//   * success => revision +1, one appended history entry, new bytes
//   * failure => file bytes byte-identical (nothing was written)
//   * success implies a policy-allowed edge (or the REVIEW self-loop)
//   * history[i].revision === i across the whole run
// Fixed seed + bounded numRuns keep CI deterministic (fast-check).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fc from 'fast-check';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { isTransitionAllowed, knownStates } from '../src/core/policy.mjs';
import { createTask, getTask, taskFilePath } from '../src/core/tasks.mjs';
import { transitionTask } from '../src/core/transition.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, writeJson } from './helpers.mjs';

const AUTHOR = 'author-ctx';
const STATES = knownStates();

const VERIFY_OK = {
  checks: [{ command: 'npm test', cwd: '.', status: 'pass', evidence: 'log:1' }],
};
const reviewFresh = (verdict) => ({
  mode: 'fresh', reviewer: 'rev', authorContext: AUTHOR,
  reviewerContext: 'reviewer-ctx', verdict,
});
const REVIEW_WAIVED = {
  mode: 'waived', owner: 'o', reference: 'w-1', reason: 'r', verdict: 'approve',
};

// An evidence draw: nothing, verification only, review only, or both —
// with recordable-but-not-always-passing statuses so ACCEPT sometimes
// fails on gate semantics instead of edge legality.
const evidenceArb = fc.oneof(
  { weight: 4, arbitrary: fc.constant({}) },
  {
    weight: 2,
    arbitrary: fc.record({
      verification: fc.constantFrom('pass', 'fail', 'error'),
      review: fc.constantFrom('fresh-approve', 'fresh-reject', 'waived'),
    }).map(({ verification, review }) => ({
      verification: {
        checks: [{ command: 'npm test', cwd: '.', status: verification,
          evidence: 'log:1' }],
      },
      review: review === 'waived' ? REVIEW_WAIVED
        : reviewFresh(review === 'fresh-approve' ? 'approve' : 'reject'),
    })),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom('pass', 'fail', 'error').map((status) => ({
      verification: { checks: [{ command: 'c', cwd: '.', status,
        evidence: 'e' }] },
    })),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom('approve', 'reject', 'changes-requested')
      .map((verdict) => ({ review: reviewFresh(verdict) })),
  },
);

const commandArb = fc.record({
  // Mostly legal state names, sometimes garbage (INVALID_STATE path).
  to: fc.oneof(
    { weight: 9, arbitrary: fc.constantFrom(...STATES) },
    { weight: 1, arbitrary: fc.constantFrom('NOWHERE', 'act', 'PLAN ', '') },
  ),
  // expectedRevision = model + delta; mostly exact CAS, sometimes stale
  // or future (REVISION_MISMATCH path).
  delta: fc.oneof(
    { weight: 8, arbitrary: fc.constant(0) },
    { weight: 1, arbitrary: fc.constantFrom(-2, -1) },
    { weight: 1, arbitrary: fc.constantFrom(1, 2, 7) },
  ),
  evidence: evidenceArb,
  bogusKey: fc.oneof(
    { weight: 19, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) }),
});

const commandsArb = fc.array(commandArb, { minLength: 1, maxLength: 20 });

function setup() {
  const dir = makeTempDir('pbt-fsm');
  const config = createConfig(dir, VALID_ANSWERS, {});
  writeJson(dir, '.scopegrain/config.json', config);
  const ctx = resolveContext({ project: dir });
  const task = createTask(ctx, {
    title: 'T', contract: 'C', authorContext: AUTHOR, scope: ['src/x'],
  });
  return { dir, ctx, task };
}

test('PBT: random transition sequences keep revision/bytes/history invariants', () => {
  fc.assert(fc.property(commandsArb, (commands) => {
    const { dir, ctx, task } = setup();
    try {
      const file = taskFilePath(ctx, task.id);
      let model = { state: task.state, revision: task.revision };
      for (const [step, cmd] of commands.entries()) {
        const bytesBefore = fs.readFileSync(file);
        const input = {
          id: task.id, to: cmd.to,
          expectedRevision: model.revision + cmd.delta,
          ...cmd.evidence,
          ...(cmd.bogusKey ? { bogus: 1 } : {}),
        };
        const label = `step ${step}: ${model.state}->${cmd.to} rev=${input.expectedRevision}`;
        let next = null;
        try {
          next = transitionTask(ctx, input);
        } catch (e) {
          // Any failure must leave the file byte-identical and the
          // stored model untouched.
          assert.ok(fs.readFileSync(file).equals(bytesBefore),
            `${label}: failed transition (${e.code}) altered bytes`);
          const stored = getTask(ctx, task.id);
          assert.equal(stored.revision, model.revision, `${label}: revision moved on failure`);
          assert.equal(stored.state, model.state, `${label}: state moved on failure`);
          continue;
        }
        assert.ok(next, `${label}: transitionTask returned nothing`);
        // Success implies a legal edge or the evidence self-loop; a
        // policy-invalid edge can never succeed.
        const selfLoop = model.state === 'REVIEW' && cmd.to === 'REVIEW'
          && (cmd.evidence.verification || cmd.evidence.review);
        assert.ok(
          isTransitionAllowed(model.state, cmd.to) || selfLoop,
          `${label}: disallowed transition ${model.state}->${cmd.to} succeeded`);
        assert.equal(next.revision, model.revision + 1,
          `${label}: revision did not increment exactly once`);
        assert.equal(next.state, cmd.to, `${label}: state mismatch`);
        // Success always rewrites the file (revision/updatedAt/history
        // change even on an evidence self-loop).
        assert.ok(!fs.readFileSync(file).equals(bytesBefore),
          `${label}: successful transition did not write new bytes`);
        const stored = getTask(ctx, task.id);
        assert.equal(stored.revision, next.revision);
        assert.equal(stored.history.length, (model.historyLength ?? 1) + 1,
          `${label}: success must append exactly one history entry`);
        const last = stored.history.at(-1);
        assert.equal(last.revision, next.revision, `${label}: history tail revision`);
        assert.equal(last.to, cmd.to, `${label}: history tail target`);
        model = { state: next.state, revision: next.revision,
          historyLength: stored.history.length };
      }
      // Whole-run invariant: history revision is a dense +1 sequence.
      const final = getTask(ctx, task.id);
      assert.equal(final.revision, final.history.length - 1);
      for (const [i, h] of final.history.entries()) {
        assert.equal(h.revision, i, `history[${i}].revision !== ${i}`);
      }
    } finally {
      cleanup(dir);
    }
  }), { numRuns: 25, seed: 0x5eed });
});
