// SPDX-License-Identifier: Apache-2.0
// Property-based test: arbitrary sequences of journal operations —
// create (new / noop-reissue / conflicting-reissue / invalid), ack
// (valid / tampered / idempotent re-ack / unknown event), compact,
// recovery dry-run — executed against a real journal in a temp project.
// Invariants checked after EVERY step (light) and once at the end
// (full):
//   * head.lastSequence === total events ever committed (monotonic)
//   * pending drain == un-acked committed events, sorted by sequence
//   * countJournalPending === ops with at least one un-acked event
//   * compact archives exactly the fully-acked, still-live ops and is
//     idempotent (already-archived ops are never re-archived)
//   * acked ⊆ committed; every op stays readable and keeps snapshots
// Fixed seed + bounded numRuns keep CI deterministic (fast-check).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { canonicalDigest } from '../src/core/digests.mjs';
import {
  ackJournalEvent, applyJournaledCreation, compactJournal,
  countJournalPending, getJournalOperation,
  listJournalAcked, listJournalPending, prepareJournalRecovery,
  readJournalSnapshot,
} from '../src/core/journal.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, writeJson } from './helpers.mjs';

function fixture() {
  const dir = makeTempDir('pbt-journal');
  writeJson(dir, '.scopegrain/config.json', createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir, config: '.scopegrain/config.json' });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  return {
    dir, ctx, a, b,
    bound: bindWorkspace(ctx, { areaIds: [a, b] }),
    journal: path.join(dir, '.scopegrain/state', 'journal'),
  };
}

function evidenceFor(event, overrides = {}) {
  return {
    backendId: 'pbt-backend',
    remoteNamespace: 'pbt-namespace',
    remoteKey: event.eventId,
    eventDigest: canonicalDigest(event),
    sourceHash: event.sourceHash,
    confirmedAt: '2026-11-09T12:00:00.000Z',
    ...overrides,
  };
}

// Journal recordId allows [a-z0-9-] only — fold every other char.
const recordId = (rel) =>
  `pbt-${rel.replaceAll(/[^a-z0-9-]/g, '-').replaceAll(/-+/g, '-').slice(0, 110)}`;

const commandArb = fc.oneof(
  { weight: 5, arbitrary: fc.record({
    kind: fc.constant('create'),
    nFiles: fc.integer({ min: 1, max: 3 }),
    // 0: reissue last op's rels with identical bytes (noop->unchanged).
    // 1: reissue with different bytes (PLAN_CONFLICT). 2+: fresh create.
    reissue: fc.integer({ min: 0, max: 10 }) }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('createInvalid') }) },
  { weight: 4, arbitrary: fc.record({
    kind: fc.constant('ack'),
    opIndex: fc.nat(), eventIndex: fc.nat(),
    mode: fc.constantFrom('valid', 'tampered', 'unknown') }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('compact') }) },
  { weight: 1, arbitrary: fc.record({
    kind: fc.constant('recoverDry'), opIndex: fc.nat(),
    action: fc.constantFrom('finalize-committed', 'abandon-prepared') }) },
);

const commandsArb = fc.array(commandArb, { minLength: 1, maxLength: 25 });

// Drains the paginated pending/acked lists into flat item arrays.
function drain(bound, listFn) {
  const items = [];
  let after = 0;
  for (;;) {
    const page = listFn(bound, { afterSequence: after, limit: 100 });
    items.push(...page.items);
    if (page.nextAfterSequence === null) return items;
    after = page.nextAfterSequence;
  }
}

test('PBT: journal sequences keep head/pending/acked/compaction invariants', () => {
  fc.assert(fc.property(commandsArb, (commands) => {
    const f = fixture();
    try {
      const model = { ops: [], nextRel: 0, lastSequence: 0 };
      const headAbs = path.join(f.journal, 'head.json');
      // Per-step light check: head consistency + pending set/count.
      const checkLight = (step) => {
        if (fs.existsSync(headAbs)) {
          const head = JSON.parse(fs.readFileSync(headAbs, 'utf8'));
          assert.equal(head.lastSequence, model.lastSequence,
            `step ${step}: head sequence drifted`);
          assert.equal(head.activeOperation, null,
            `step ${step}: head has an active operation`);
        } else {
          assert.equal(model.lastSequence, 0,
            `step ${step}: head missing but model committed events`);
        }
        let pendingModel = 0;
        const unacked = [];
        for (const op of model.ops) {
          if (op.acked.size < op.events.length) pendingModel += 1;
          for (const ev of op.events) {
            if (!op.acked.has(ev.eventId)) unacked.push(ev.journalSequence);
          }
        }
        assert.equal(countJournalPending(f.bound), pendingModel,
          `step ${step}: pending count mismatch`);
        unacked.sort((x, y) => x - y);
        assert.deepEqual(
          drain(f.bound, listJournalPending)
            .map((i) => i.event.journalSequence),
          unacked, `step ${step}: pending set mismatch`);
      };

      for (const [step, cmd] of commands.entries()) {
        if (cmd.kind === 'create') {
          const prev = model.ops.at(-1);
          if (cmd.reissue <= 1 && prev) {
            const sameBytes = cmd.reissue === 0;
            const changes = [...prev.contents.keys()].map((rel) => ({
              sourceKind: 'task', recordId: recordId(rel),
              sourceRevision: 0, areaIds: [f.a, f.b],
              file: { rel, content: sameBytes
                ? prev.contents.get(rel)
                : `{"re":${step}}` },
            }));
            if (sameBytes) {
              const res = applyJournaledCreation(f.bound, changes);
              assert.equal(res.status, 'unchanged',
                `step ${step}: byte-identical reissue must be a noop`);
              assert.equal(res.operationId, null);
            } else {
              assert.throws(
                () => applyJournaledCreation(f.bound, changes),
                (e) => e.code === 'PLAN_CONFLICT',
                `step ${step}: divergent reissue must conflict`);
            }
          } else {
            const changes = Array.from({ length: cmd.nFiles }, (_, i) => {
              const rel = `pbt/records/r${model.nextRel++}.json`;
              return {
                sourceKind: 'task', recordId: recordId(rel),
                sourceRevision: 0, areaIds: [f.a, f.b],
                file: { rel, content: `{"i":${step},"j":${i}}` },
              };
            });
            const res = applyJournaledCreation(f.bound, changes);
            assert.equal(res.status, 'committed', `step ${step}: create`);
            assert.equal(res.journalState, 'confirmed');
            assert.equal(res.eventIds.length, cmd.nFiles);
            const loaded = getJournalOperation(f.bound, res.operationId);
            assert.equal(loaded.state, 'committed');
            assert.equal(loaded.intentDigest, canonicalDigest(loaded.intent));
            // Snapshots are complete at commit: verify once, here.
            for (const ev of loaded.intent.events) {
              assert.deepEqual(
                readJournalSnapshot(f.bound, res.operationId, ev.eventId),
                Buffer.from(changes.find(
                  (c) => c.file.rel === ev.sourceRel).file.content));
            }
            model.ops.push({
              operationId: res.operationId,
              // Full event objects: evidence digests are computed over
              // the canonical event, so a projection is not enough.
              events: loaded.intent.events,
              contents: new Map(
                changes.map((c) => [c.file.rel, c.file.content])),
              acked: new Set(),
              archived: false,
            });
            model.lastSequence += cmd.nFiles;
          }
        } else if (cmd.kind === 'createInvalid') {
          const headBefore = fs.existsSync(headAbs)
            ? fs.readFileSync(headAbs) : null;
          assert.throws(() => applyJournaledCreation(f.bound, [
            { sourceKind: 'task', recordId: 'bad', sourceRevision: 0,
              areaIds: [], file: { rel: 'pbt/x', content: 'x' } },
          ]), (e) => ['INVALID_JOURNAL_INPUT', 'SCOPE_DENIED'].includes(e.code));
          if (headBefore) {
            assert.ok(fs.readFileSync(headAbs).equals(headBefore),
              `step ${step}: invalid create touched head`);
          }
        } else if (cmd.kind === 'ack' && model.ops.length) {
          const op = model.ops[cmd.opIndex % model.ops.length];
          const event = op.events[cmd.eventIndex % op.events.length];
          if (cmd.mode === 'tampered') {
            // Wrong remoteKey: input-level INVALID_JOURNAL_INPUT on a
            // fresh ack, JOURNAL_ACK_CONFLICT on an already-acked event.
            assert.throws(() => ackJournalEvent(f.bound, op.operationId,
              event.eventId, evidenceFor(event, {
                remoteKey: '00000000-0000-4000-8000-000000000000',
              })), (e) => ['INVALID_JOURNAL_INPUT', 'JOURNAL_ACK_CONFLICT']
              .includes(e.code));
          } else if (cmd.mode === 'unknown') {
            assert.throws(() => ackJournalEvent(f.bound, op.operationId,
              '00000000-0000-4000-8000-000000000000',
              evidenceFor(event)), (e) => e.code === 'JOURNAL_NOT_FOUND');
          } else {
            ackJournalEvent(f.bound, op.operationId, event.eventId,
              evidenceFor(event));
            op.acked.add(event.eventId);
            // Idempotent re-ack with identical evidence: no conflict.
            ackJournalEvent(f.bound, op.operationId, event.eventId,
              evidenceFor(event));
          }
        } else if (cmd.kind === 'compact') {
          const res = compactJournal(f.bound);
          // Only fully-acked ops still in operations/ move; an archived
          // op is terminal for compaction — idempotent second run.
          const expected = model.ops.filter(
            (op) => !op.archived
              && op.events.every((ev) => op.acked.has(ev.eventId)))
            .map((op) => op.operationId);
          assert.deepEqual([...res.archived].sort(), [...expected].sort(),
            `step ${step}: compact archived the wrong set`);
          for (const opId of res.archived) {
            model.ops.find((o) => o.operationId === opId).archived = true;
          }
        } else if (cmd.kind === 'recoverDry' && model.ops.length) {
          const op = model.ops[cmd.opIndex % model.ops.length];
          const digest = getJournalOperation(f.bound, op.operationId).intentDigest;
          const opts = { action: cmd.action, expectedIntentDigest: digest,
            reason: 'pbt recovery probe' };
          if (cmd.action === 'finalize-committed') {
            const dry = prepareJournalRecovery(f.bound, op.operationId, opts);
            assert.equal(dry.mode, 'dry-run');
            assert.equal(dry.action, 'finalize-committed');
          } else {
            // A committed op can never be abandoned: structured conflict.
            assert.throws(() => prepareJournalRecovery(
              f.bound, op.operationId, opts),
            (e) => e.code === 'JOURNAL_RECOVERY_CONFLICT');
          }
        }
        checkLight(step);
      }

      // Full end-of-run check: every op resolves (live or archived),
      // stays committed, keeps complete snapshots, and the acked drain
      // is exactly the model's acked subset of committed events.
      for (const op of model.ops) {
        const loaded = getJournalOperation(f.bound, op.operationId);
        assert.equal(loaded.state, 'committed',
          `op ${op.operationId} ended in state ${loaded.state}`);
        for (const ev of loaded.intent.events) {
          assert.deepEqual(
            readJournalSnapshot(f.bound, op.operationId, ev.eventId),
            Buffer.from(op.contents.get(ev.sourceRel)));
        }
      }
      const ackedEvents = [];
      for (const op of model.ops) {
        for (const ev of op.events) {
          if (op.acked.has(ev.eventId)) ackedEvents.push(ev.journalSequence);
        }
      }
      ackedEvents.sort((x, y) => x - y);
      assert.deepEqual(
        drain(f.bound, listJournalAcked)
          .map((i) => i.event.journalSequence),
        ackedEvents, 'acked drain != model acked set');
    } finally {
      cleanup(f.dir);
    }
  }), { numRuns: 25, seed: 0x1eaf });
});
