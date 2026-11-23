// SPDX-License-Identifier: Apache-2.0
// Suggestive task-type -> capability heuristic: ranked candidates with
// declared reasons, declared skills excluded, nothing ever injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestCapabilities } from '../src/core/task-suggest.mjs';
import { buildWorkflowPacket } from '../src/core/workflows.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { bootstrappedCtx, cleanup } from './helpers.mjs';

test('type:bug surfaces debugging/recovery skills with type reasons', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'fix crash', contract: 'C', authorContext: 'a', scope: [],
      type: 'bug',
    });
    const r = suggestCapabilities(ctx, task);
    assert.equal(r.taskId, task.id);
    assert.equal(r.type, 'bug');
    assert.ok(r.suggestions.length > 0);
    const top = r.suggestions.find((s) => s.id === 'systematic-debugging'
      || s.id === 'debugging-and-error-recovery');
    assert.ok(top, 'a debugging skill must rank');
    assert.ok(top.reasons.some((x) => x.startsWith('type:bug')));
  } finally { cleanup(dir); }
});

test('declared task.skills are excluded and echoed under declared', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'fix crash', contract: 'C', authorContext: 'a', scope: [],
      type: 'bug', skills: ['systematic-debugging'],
    });
    const r = suggestCapabilities(ctx, task);
    assert.deepEqual(r.declared, ['systematic-debugging']);
    assert.ok(!r.suggestions.some((s) => s.id === 'systematic-debugging'));
  } finally { cleanup(dir); }
});

test('scope tests/ contributes scope reasons', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'coverage', contract: 'C', authorContext: 'a',
      scope: ['tests/unit/coverage.test.mjs'],
    });
    const r = suggestCapabilities(ctx, task);
    const withScope = r.suggestions.filter(
      (s) => s.reasons.some((x) => x.startsWith('scope:')));
    assert.ok(withScope.length > 0, 'scope segment must score');
  } finally { cleanup(dir); }
});

test('suggestions never mutate the task record or inject into packets', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'fix crash', contract: 'C', authorContext: 'a', scope: [],
      type: 'bug',
    });
    const before = JSON.parse(JSON.stringify(task));
    suggestCapabilities(ctx, task);
    assert.deepEqual(JSON.parse(JSON.stringify(task)), before);
    assert.equal(task.skills, null);
    // Packet: trace is declared under suggested; the skills bucket only
    // ever carries what was explicitly declared.
    const p = buildWorkflowPacket(ctx, {
      command: 'pipeline', mode: 'task', taskId: task.id,
    });
    assert.ok(Array.isArray(p.taskRouting.suggested));
    assert.equal(p.taskRouting.included.length, 0);
    for (const s of p.taskRouting.suggested) {
      assert.ok(Array.isArray(s.reasons) && s.reasons.length > 0);
    }
  } finally { cleanup(dir); }
});

test('null/unknown type still ranks on title+contract tokens', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'documentation adr writing', contract: 'docs contract',
      authorContext: 'a', scope: [],
    });
    const r = suggestCapabilities(ctx, task);
    assert.equal(r.type, null);
    assert.ok(r.suggestions.length > 0);
    assert.ok(r.suggestions.every((s) => !s.reasons.some(
      (x) => x.startsWith('type:'))));
  } finally { cleanup(dir); }
});

test('limit bounds the list and must be an integer in [1,50]', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'fix crash', contract: 'C', authorContext: 'a', scope: [],
      type: 'bug',
    });
    const one = suggestCapabilities(ctx, task, { limit: 1 });
    assert.equal(one.suggestions.length, 1);
    for (const bad of [0, 51, 1.5]) {
      assert.throws(() => suggestCapabilities(ctx, task, { limit: bad }),
        (e) => e.code === 'INVALID_ARGS');
    }
  } finally { cleanup(dir); }
});

test('ranking is deterministic across repeated calls', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'fix crash', contract: 'C', authorContext: 'a', scope: [],
      type: 'bug',
    });
    const a = suggestCapabilities(ctx, task).suggestions;
    const b = suggestCapabilities(ctx, task).suggestions;
    assert.deepEqual(a, b);
  } finally { cleanup(dir); }
});
