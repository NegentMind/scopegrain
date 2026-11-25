// SPDX-License-Identifier: Apache-2.0
// eval replay: declarative fixtures compile real packets and evaluate
// expectations deterministically; baseline comparison emits honest
// better/worse/same verdicts without inventing scores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { prepareWorkspace } from '../src/core/workspaces.mjs';
import {
  compareReplay, replayEval,
} from '../src/core/eval-replay.mjs';
import { bootstrappedCtx, cleanup } from './helpers.mjs';

function fixture() {
  const { dir, ctx } = bootstrappedCtx();
  const ws = prepareWorkspace(ctx, { areas: [{ key: 'p', name: 'P' }] });
  applyPlan(dir, [ws.file]);
  return { dir, ctx };
}

// Context cases take no exclusion opts — replay forces
// noVantadb+noStructure so the floor stays read-only/deterministic.
const PACKET_CASE = {
  id: 'ctx-default',
  compile: { kind: 'context' },
  expect: [
    { path: 'tokenEstimate', op: 'exists' },
    { path: 'tasks', op: 'exists' },
  ],
};

test('replay compiles a context case and evaluates expectations', async () => {
  const { dir, ctx } = fixture();
  try {
    const out = await replayEval(ctx, {
      schemaVersion: 1, id: 'base', cases: [PACKET_CASE],
    });
    assert.equal(out.kind, 'eval-replay');
    const c = out.cases[0];
    assert.equal(c.satisfied, 2);
    assert.equal(c.failures.length, 0);
    assert.equal(out.summary.satisfied, 2);
    assert.equal(out.summary.errors, 0);
  } finally { cleanup(dir); }
});

test('failed expectations report path/op/expected/actual honestly', async () => {
  const { dir, ctx } = fixture();
  try {
    const out = await replayEval(ctx, {
      schemaVersion: 1, id: 'f', cases: [{
        id: 'neg', compile: { kind: 'context' },
        expect: [
          { path: 'no.such.key', op: 'exists' },
          { path: 'tokenEstimate.total', op: 'gte', value: 1e15 },
        ],
      }],
    });
    const c = out.cases[0];
    assert.equal(c.satisfied, 0);
    assert.equal(c.failures.length, 2);
    assert.equal(c.failures[0].found, false);
    assert.equal(c.failures[1].expected, 1e15);
    assert.equal(typeof c.failures[1].actual, 'number');
  } finally { cleanup(dir); }
});

test('compile errors surface per-case without aborting the replay', async () => {
  const { dir, ctx } = fixture();
  try {
    const out = await replayEval(ctx, {
      schemaVersion: 1, id: 'mixed',
      cases: [
        { id: 'bad', compile: { kind: 'workflow',
          opts: { command: 'no-such-command-xyz' } },
          expect: [{ path: 'x', op: 'exists' }] },
        PACKET_CASE,
      ],
    });
    const bad = out.cases.find((c) => c.id === 'bad');
    assert.equal(bad.satisfied, 0);
    assert.equal(typeof bad.error, 'string');
    assert.equal(out.cases.find((c) => c.id === 'ctx-default').satisfied, 2);
    assert.equal(out.summary.errors, 1);
  } finally { cleanup(dir); }
});

test('baseline comparison emits better/worse/same/new/dropped', async () => {
  const before = {
    schemaVersion: 1, kind: 'eval-replay',
    fixture: { id: 'f', cases: 2 },
    cases: [
      { id: 'a', satisfied: 1, total: 2 },
      { id: 'b', satisfied: 2, total: 2 },
      { id: 'c', satisfied: 1, total: 1 },
    ],
    summary: { satisfied: 4, total: 5, errors: 0 },
  };
  const after = {
    schemaVersion: 1, kind: 'eval-replay',
    cases: [
      { id: 'a', satisfied: 2, total: 2 },
      { id: 'b', satisfied: 1, total: 2 },
      { id: 'd', satisfied: 1, total: 1 },
    ],
    summary: { satisfied: 4, total: 5, errors: 0 },
  };
  const cmp = compareReplay(before, after);
  const byId = new Map(cmp.cases.map((c) => [c.id, c.verdict]));
  assert.equal(byId.get('a'), 'better');
  assert.equal(byId.get('b'), 'worse');
  assert.equal(byId.get('c'), 'dropped');
  assert.equal(byId.get('d'), 'new');
  assert.equal(cmp.overall, 'worse'); // any worse/dropped dominates
  // All-equal -> same; strictly-improved -> better.
  assert.equal(compareReplay(before, {
    schemaVersion: 1, cases: before.cases.map(
      (c) => ({ id: c.id, satisfied: c.satisfied })),
  }).overall, 'same');
  assert.equal(compareReplay(before, {
    schemaVersion: 1, cases: [
      { id: 'a', satisfied: 2 }, { id: 'b', satisfied: 2 },
      { id: 'c', satisfied: 1 },
    ],
  }).overall, 'better');
});

test('replay carries comparison when baseline is provided', async () => {
  const { dir, ctx } = fixture();
  try {
    const baseline = {
      schemaVersion: 1, kind: 'eval-replay',
      cases: [{ id: 'ctx-default', satisfied: 0, total: 2 }],
      summary: { satisfied: 0, total: 2, errors: 0 },
    };
    const out = await replayEval(ctx, {
      schemaVersion: 1, id: 'f', cases: [PACKET_CASE],
    }, { baseline });
    assert.equal(out.comparison.overall, 'better');
    assert.equal(out.comparison.cases[0].before, 0);
    assert.equal(out.comparison.cases[0].after, 2);
  } finally { cleanup(dir); }
});

test('fixture boundary: closed shapes, unique ids, op contracts', async () => {
  const { dir, ctx } = fixture();
  try {
    const bad = (fixture, why) => assert.rejects(
      () => replayEval(ctx, fixture),
      (e) => e.code === 'EVAL_MALFORMED', why);
    await bad({ schemaVersion: 2, id: 'x', cases: [PACKET_CASE] },
      'schemaVersion must be 1');
    await bad({ schemaVersion: 1, id: 'x', cases: [] },
      'cases must be non-empty');
    await bad({ schemaVersion: 1, id: 'x', cases: [PACKET_CASE],
      extra: 1 }, 'closed fixture keys');
    await bad({ schemaVersion: 1, id: 'x', cases: [
      { ...PACKET_CASE, bogus: 1 }] }, 'closed case keys');
    await bad({ schemaVersion: 1, id: 'x', cases: [
      PACKET_CASE, PACKET_CASE] }, 'case ids unique');
    await bad({ schemaVersion: 1, id: 'x', cases: [{
      id: 'k', compile: { kind: 'bogus' },
      expect: [{ path: 'a', op: 'exists' }] }] }, 'compile kind enum');
    await bad({ schemaVersion: 1, id: 'x', cases: [{
      id: 'k', compile: { kind: 'context', opts: { bogus: 1 } },
      expect: [{ path: 'a', op: 'exists' }] }] }, 'closed opts keys');
    await bad({ schemaVersion: 1, id: 'x', cases: [{
      id: 'k', compile: { kind: 'context' },
      expect: [{ path: 'a', op: 'mid', value: 1 }] }] }, 'op enum');
    await bad({ schemaVersion: 1, id: 'x', cases: [{
      id: 'k', compile: { kind: 'context' },
      expect: [{ path: 'a', op: 'gte' }] }] }, 'gte requires value');
    await bad({ schemaVersion: 1, id: 'x', cases: [{
      id: 'k', compile: { kind: 'workflow', opts: {} },
      expect: [{ path: 'a', op: 'exists' }] }] },
      'workflow requires command');
    await bad({ schemaVersion: 1, id: 'x', cases: [{
      id: 'k', compile: { kind: 'context', opts: { noVantadb: true } },
      expect: [{ path: 'a', op: 'exists' }] }] },
      'exclusion opts are forced, not declarable');
    await bad({ schemaVersion: 1, id: 'x', cases: [{
      id: 'k', compile: { kind: 'context',
        opts: { structureDebounceMs: 5 } },
      expect: [{ path: 'a', op: 'exists' }] }] },
      'cache-writing debounce opt rejected');
    await bad({ schemaVersion: 1, id: 'x', cases: [{
      id: 'k', compile: { kind: 'context', opts: { tail: -1 } },
      expect: [{ path: 'a', op: 'exists' }] }] },
      'numeric opts bounded below');
    await bad({ schemaVersion: 1, id: 'x', cases: [{
      id: 'k', compile: { kind: 'context', opts: { tail: NaN } },
      expect: [{ path: 'a', op: 'exists' }] }] },
      'numeric opts finite');
    await bad({ schemaVersion: 1, id: 'x', cases: [{
      id: 'k', compile: { kind: 'context' },
      expect: [{ path: 'a', op: 'gte', value: 'x' }] }] },
      'gte requires numeric value');
    await bad({ schemaVersion: 1, id: 'x', cases: [{
      id: 'k', compile: { kind: 'context' },
      expect: [{ path: 'a', op: 'lte', value: [] }] }] },
      'lte rejects non-finite value');
    await bad({ schemaVersion: 1, id: 'x', cases: [{
      id: 'k', compile: { kind: 'context' },
      expect: [{ path: 'a', op: 'regex', value: '(' }] }] },
      'invalid pattern is malformed, not a crash');
    await bad({ schemaVersion: 1, id: 'x', cases: [{
      id: 'k', compile: { kind: 'context' },
      expect: [{ path: 'a', op: 'regex',
        value: 'x'.repeat(201) }] }] },
      'pattern length bounded');
  } finally { cleanup(dir); }
});

test('regex/contains/gte ops evaluate honestly over the packet', async () => {
  const { dir, ctx } = fixture();
  try {
    const out = await replayEval(ctx, {
      schemaVersion: 1, id: 'ops', cases: [{
        id: 'ops', compile: { kind: 'context' },
        expect: [
          { path: 'tasks', op: 'exists' },
          { path: 'tokenEstimate.total', op: 'lte', value: 1e9 },
          // contains on a string requires a string needle —
          // '5'.includes(5) style coercion must fail, not pass.
          { path: 'intake.mode', op: 'contains', value: 5 },
          // Inherited names are not packet data.
          { path: 'tasks.__proto__', op: 'exists' },
          { path: 'tokenEstimate.constructor', op: 'exists' },
        ],
      }],
    });
    const c = out.cases[0];
    assert.equal(c.satisfied, 2);
    assert.equal(c.failures.length, 3);
    assert.deepEqual(c.failures.map((f) => f.path), [
      'intake.mode', 'tasks.__proto__', 'tokenEstimate.constructor',
    ]);
  } finally { cleanup(dir); }
});

test('workflow case compiles a real packet', async () => {
  const { dir, ctx } = fixture();
  try {
    const out = await replayEval(ctx, {
      schemaVersion: 1, id: 'wf', cases: [{
        id: 'pipeline', compile: { kind: 'workflow',
          opts: { command: 'pipeline' } },
        expect: [
          { path: 'command.id', op: 'eq', value: 'pipeline' },
          { path: 'resources.agents.0', op: 'exists' },
          { path: 'capabilities.executesAgent', op: 'eq', value: false },
        ],
      }],
    });
    assert.equal(out.cases[0].satisfied, 3);
    assert.equal(out.cases[0].failures.length, 0);
  } finally { cleanup(dir); }
});

test('baseline validation rejects non-replay shapes', async () => {
  const { dir, ctx } = fixture();
  try {
    const replay = { schemaVersion: 1, cases: [] };
    const bad = (b, why) => assert.throws(
      () => compareReplay(b, replay),
      (e) => e.code === 'EVAL_MALFORMED', why);
    bad({ schemaVersion: 1, cases: [] }, 'kind required');
    // The fixture itself passes the old envelope check — it must be
    // rejected, or 'same' is reported over a corrupt baseline.
    bad({ schemaVersion: 1, id: 'f', cases: [{ id: 'a' }] },
      'fixture-as-baseline rejected');
    bad({ schemaVersion: 1, kind: 'eval-replay', cases: [null] },
      'null entry rejected');
    bad({ schemaVersion: 1, kind: 'eval-replay',
      cases: [{ id: 'a' }] }, 'satisfied required');
    bad({ schemaVersion: 1, kind: 'eval-replay',
      cases: [{ id: 'a', satisfied: NaN }] }, 'satisfied finite');
    const ok = compareReplay(
      { schemaVersion: 1, kind: 'eval-replay',
        cases: [{ id: 'a', satisfied: 1 }] },
      { schemaVersion: 1, cases: [{ id: 'a', satisfied: 1 }] });
    assert.equal(ok.overall, 'same');
    assert.deepEqual(ok.summary,
      { better: 0, worse: 0, same: 1, new: 0, dropped: 0 });
  } finally { cleanup(dir); }
});

test('SCOPEGRAIN_TASK ambient state does not leak into packets', async () => {
  const { dir, ctx } = fixture();
  const prev = process.env.SCOPEGRAIN_TASK;
  process.env.SCOPEGRAIN_TASK = 'b1110a99-e1f8-4719-806c-fc018232a93f';
  try {
    const out = await replayEval(ctx, {
      schemaVersion: 1, id: 'env', cases: [{
        id: 'env', compile: { kind: 'context' },
        expect: [{ path: 'activeTask', op: 'eq', value: null }],
      }],
    });
    assert.equal(out.cases[0].satisfied, 1,
      JSON.stringify(out.cases[0].failures));
    assert.equal(process.env.SCOPEGRAIN_TASK,
      'b1110a99-e1f8-4719-806c-fc018232a93f',
      'ambient env restored after replay');
  } finally {
    if (prev === undefined) delete process.env.SCOPEGRAIN_TASK;
    else process.env.SCOPEGRAIN_TASK = prev;
    cleanup(dir);
  }
});
