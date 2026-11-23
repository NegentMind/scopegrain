// SPDX-License-Identifier: Apache-2.0
// Declarative workflow runner (`dist run`) contract: task.transition
// carries verification/review evidence into transitionTask, args are
// closed per op, and failures record into the resumable run state.
// Synthetic attestations only — no check is executed by these fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRun, runWorkflow } from '../src/core/workflow-runner.mjs';
import { getTask } from '../src/core/tasks.mjs';
import { updateTaskMeta } from '../src/core/transition.mjs';
import { loadPolicy } from '../src/core/policy.mjs';
import { lightFixture } from './methodology-fixtures.mjs';
import { cleanup } from './helpers.mjs';

const passVerification = {
  checks: [{ command: 'declared-fixture-check', cwd: '.', status: 'pass',
    evidence: 'synthetic declared passing result, not execution' }],
};
const freshReview = {
  mode: 'fresh', reviewer: 'declared fixture reviewer',
  authorContext: 'fixture-author',
  reviewerContext: 'different-fixture-context', verdict: 'approve',
};
const step = (id, to, expectedRevision, extra = {}) => ({
  id, op: 'task.transition',
  args: { taskId: extra.taskId, to, expectedRevision,
    ...(extra.args ?? {}) },
});

test('dist run carries VERIFY->EVALUATE->REVIEW->ACCEPT with attached evidence', () => {
  const f = lightFixture();
  try {
    const doc = {
      schemaVersion: 1, id: 'verify-to-accept',
      steps: [
        step('to-act', 'ACT', 0, { taskId: f.task.id }),
        step('to-verify', 'VERIFY', 1, { taskId: f.task.id }),
        // 'evidence' is the legacy alias of 'verification'.
        step('to-evaluate', 'EVALUATE', 2, {
          taskId: f.task.id, args: { evidence: passVerification } }),
        step('to-review', 'REVIEW', 3, {
          taskId: f.task.id, args: { review: freshReview } }),
        step('to-accept', 'ACCEPT', 4, { taskId: f.task.id }),
      ],
    };
    const { run } = runWorkflow(f.ctx, doc);
    assert.equal(run.status, 'completed');
    assert.deepEqual(run.completed,
      ['to-act', 'to-verify', 'to-evaluate', 'to-review', 'to-accept']);
    const task = getTask(f.ctx, f.task.id);
    assert.equal(task.state, 'ACCEPT');
    assert.equal(task.verification.checks[0].command,
      'declared-fixture-check');
    assert.equal(task.review.mode, 'fresh');
    assert.equal(task.review.verdict, 'approve');
  } finally { cleanup(f.dir); }
});

test('task.transition honors the canonical verification key (recordable != acceptable)', () => {
  const f = lightFixture();
  try {
    const doc = {
      schemaVersion: 1, id: 'verification-key',
      steps: [
        step('to-act', 'ACT', 0, { taskId: f.task.id }),
        step('to-verify', 'VERIFY', 1, { taskId: f.task.id }),
        step('to-evaluate', 'EVALUATE', 2, {
          taskId: f.task.id,
          args: { verification: {
            checks: [{ command: 'declared-fixture-check', cwd: '.',
              status: 'fail', evidence: 'honest failed attestation' }],
          } } }),
      ],
    };
    const { run } = runWorkflow(f.ctx, doc);
    assert.equal(run.status, 'completed');
    const task = getTask(f.ctx, f.task.id);
    assert.equal(task.state, 'EVALUATE');
    assert.equal(task.verification.checks[0].status, 'fail');
    assert.equal(task.review, null);
  } finally { cleanup(f.dir); }
});

test('unknown or ambiguous args are rejected before any run state exists', () => {
  const f = lightFixture();
  try {
    const mk = (id, op, args) => ({ schemaVersion: 1, id,
      steps: [{ id: 's1', op, args }] });
    // Misspelled evidence key: previously dropped silently.
    assert.throws(() => runWorkflow(f.ctx, mk('bad-1', 'task.transition', {
      taskId: f.task.id, to: 'ACT', expectedRevision: 0, evidenc: {},
    })), (e) => e.code === 'UNKNOWN_KEY');
    // 'evidence' + 'verification' together are ambiguous.
    assert.throws(() => runWorkflow(f.ctx, mk('bad-2', 'task.transition', {
      taskId: f.task.id, to: 'VERIFY', expectedRevision: 0,
      verification: {}, evidence: {},
    })), (e) => e.code === 'INVALID_VALUE');
    // args must be an object.
    assert.throws(() => runWorkflow(f.ctx,
      mk('bad-3', 'noop', ['x'])), (e) => e.code === 'INVALID_VALUE');
    // The closed contract is per-op: 'to' is not a converge.evaluate arg.
    assert.throws(() => runWorkflow(f.ctx, mk('bad-4', 'converge.evaluate', {
      taskId: f.task.id, to: 'ACT',
    })), (e) => e.code === 'UNKNOWN_KEY');
    // Rejected documents persist no run state.
    for (const id of ['bad-1', 'bad-2', 'bad-3', 'bad-4']) {
      assert.equal(loadRun(f.ctx, id), null, id);
    }
    assert.equal(getTask(f.ctx, f.task.id).state, 'PLAN');
  } finally { cleanup(f.dir); }
});

test('evidence on ->ACT fails the step; a corrected doc resumes the run', () => {
  const f = lightFixture();
  try {
    const doc = (withEvidence) => ({
      schemaVersion: 1, id: 'retry-run',
      steps: [step('to-act', 'ACT', 0, {
        taskId: f.task.id,
        ...(withEvidence ? { args: { verification: passVerification } } : {}),
      })],
    });
    const first = runWorkflow(f.ctx, doc(true));
    assert.equal(first.run.status, 'failed');
    assert.equal(first.run.failedStep, 'to-act');
    assert.equal(first.run.results['to-act'].error.code, 'INVALID_EVIDENCE');
    // Same workflow id, corrected step: resumes at the incomplete step.
    const second = runWorkflow(f.ctx, doc(false));
    assert.equal(second.run.status, 'completed');
    assert.equal(getTask(f.ctx, f.task.id).state, 'ACT');
  } finally { cleanup(f.dir); }
});

test('canonical policy declares the runtime-enforced constraints (frozen)', () => {
  const c = loadPolicy().constraints;
  assert.deepEqual([...c.terminalDispositions].sort(),
    ['cancelled', 'discarded']);
  assert.equal(c.terminalDispositionTarget, 'ABANDON');
  assert.deepEqual([...c.methodologyRevalidatedTargets].sort(),
    ['ACCEPT', 'ACT', 'CLOSE']);
  assert.ok(Object.isFrozen(c));
});

test('terminal dispositions funnel to the policy-declared target via dist run', () => {
  const f = lightFixture();
  try {
    updateTaskMeta(f.ctx, { id: f.task.id, expectedRevision: 0,
      disposition: { kind: 'discarded', reason: 'triage fixture' } });
    const doc = (id, to) => ({ schemaVersion: 1, id,
      steps: [step('go', to, 1, { taskId: f.task.id })] });
    const blocked = runWorkflow(f.ctx, doc('disp-act', 'ACT'));
    assert.equal(blocked.run.status, 'failed');
    assert.equal(blocked.run.results.go.error.code, 'DISPOSITION_BLOCKS');
    const ok = runWorkflow(f.ctx, doc('disp-abandon', 'ABANDON'));
    assert.equal(ok.run.status, 'completed');
    assert.equal(getTask(f.ctx, f.task.id).state, 'ABANDON');
  } finally { cleanup(f.dir); }
});
