// Task V3: semantic layer (backlog/disposition/priority/analysis/steps/...),
// metadata CAS updates, operational memory logs, goals and metrics.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import {
  createTask, getTask, listTasks, prepareTask,
} from '../src/core/tasks.mjs';
import { transitionTask, updateTaskMeta } from '../src/core/transition.mjs';
import {
  appendWorklog, readWorklog, listGoals, createGoal, transitionGoal,
  taskMetrics,
} from '../src/core/worklog.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, writeJson } from './helpers.mjs';

function setup() {
  const dir = makeTempDir('tasks-v3');
  const config = createConfig(dir, VALID_ANSWERS, {});
  writeJson(dir, '.tasksystem/config.json', config);
  return { dir, ctx: resolveContext({ project: dir }) };
}

const BASE = {
  title: 'T', contract: 'C', authorContext: 'a', scope: ['src/x'],
};

// ---------------- creation with semantic fields ----------------

test('V1 manual create + V3 fields upgrades to schemaVersion 3', () => {
  const { dir, ctx } = setup();
  try {
    const { task } = prepareTask(ctx, {
      ...BASE,
      backlog: 'core', priority: 'p1', severity: 'high', type: 'bug',
      effort: 'day', estimate: { turns: 4, appetite: 'day' }, source: 'FIND-1',
      dependsOn: [crypto.randomUUID()],
      relations: { see: ['ref-1'], blocks: ['ref-2'] },
      goalIds: [crypto.randomUUID()],
      analysis: { blastRadius: 'two modules', invariants: 'no data loss' },
      steps: [{ name: 'fix it' }],
      notes: ['first note'],
      skills: ['systematic-debugging'],
      uncertainty: { uphill: 2, downhill: 3 },
    });
    assert.equal(task.schemaVersion, 3);
    assert.equal(task.methodology, null); // V1 cannot carry methodology
    assert.equal(task.specId, null);
    assert.deepEqual(task.scenarioRefs, []);
    assert.equal(task.backlog, 'core');
    assert.equal(task.priority, 'p1');
    assert.equal(task.disposition, null);
    assert.equal(task.steps[0].status, 'pending'); // default applied
    assert.deepEqual(task.uncertainty, { uphill: 2, downhill: 3 });
    const applied = createTask(ctx, {
      ...BASE, backlog: 'core', priority: 'p0',
    });
    const stored = getTask(ctx, applied.id);
    assert.equal(stored.schemaVersion, 3);
    assert.equal(stored.backlog, 'core');
  } finally { cleanup(dir); }
});

test('no V3 fields keeps natural version; invalid enums rejected', () => {
  const { dir, ctx } = setup();
  try {
    const { task } = prepareTask(ctx, BASE);
    assert.equal(task.schemaVersion, 1);
    assert.throws(() => prepareTask(ctx, { ...BASE, priority: 'urgent' }),
      (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, { ...BASE, backlog: 'Bad_Name' }),
      (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, { ...BASE, type: 'chore' }),
      (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, { ...BASE, bogus: 1 }),
      (e) => e.code === 'UNKNOWN_KEY');
    assert.throws(() => prepareTask(ctx, {
      ...BASE, relations: { invented: ['x'] },
    }), (e) => e.code === 'UNKNOWN_KEY');
  } finally { cleanup(dir); }
});

// ---------------- metadata CAS updates ----------------

test('updateTaskMeta: set patch upgrades V1 and bumps revision', () => {
  const { dir, ctx } = setup();
  try {
    const task = createTask(ctx, BASE);
    assert.equal(task.schemaVersion, 1);
    const next = updateTaskMeta(ctx, {
      id: task.id, expectedRevision: 0,
      set: { priority: 'p2', backlog: 'negocio', type: 'feature' },
    });
    assert.equal(next.schemaVersion, 3);
    assert.equal(next.priority, 'p2');
    assert.equal(next.backlog, 'negocio');
    assert.equal(next.revision, 1);
    assert.equal(next.history.at(-1).event, 'meta-update');
    assert.ok(next.history.at(-1).fields.includes('priority'));
    // CAS enforcement
    assert.throws(() => updateTaskMeta(ctx, {
      id: task.id, expectedRevision: 0, set: { priority: 'p0' },
    }), (e) => e.code === 'REVISION_MISMATCH');
    // non-settable keys rejected
    assert.throws(() => updateTaskMeta(ctx, {
      id: task.id, expectedRevision: 1, set: { disposition: null },
    }), (e) => e.code === 'UNKNOWN_KEY');
    // meta update never touches state or evidence
    const stored = getTask(ctx, task.id);
    assert.equal(stored.state, 'PLAN');
    assert.equal(stored.verification, null);
  } finally { cleanup(dir); }
});

test('disposition set/clear, notes and step status', () => {
  const { dir, ctx } = setup();
  try {
    const task = createTask(ctx, {
      ...BASE, steps: [{ name: 'a' }, { name: 'b' }],
    });
    let rev = task.revision;
    const d1 = updateTaskMeta(ctx, {
      id: task.id, expectedRevision: rev++,
      disposition: { kind: 'deferred', reason: 'waiting', by: 'owner' },
    });
    assert.equal(d1.disposition.kind, 'deferred');
    assert.equal(d1.disposition.reason, 'waiting');
    assert.ok(d1.disposition.at);
    const d2 = updateTaskMeta(ctx, {
      id: task.id, expectedRevision: rev++,
      disposition: null, // reactivate
    });
    assert.equal(d2.disposition, null);
    const d3 = updateTaskMeta(ctx, {
      id: task.id, expectedRevision: rev++, addNote: 'investigated root cause',
    });
    assert.deepEqual(d3.notes, ['investigated root cause']);
    const d4 = updateTaskMeta(ctx, {
      id: task.id, expectedRevision: rev++,
      stepStatus: { index: 1, status: 'done' },
    });
    assert.equal(d4.steps[0].status, 'pending');
    assert.equal(d4.steps[1].status, 'done');
    assert.throws(() => updateTaskMeta(ctx, {
      id: task.id, expectedRevision: rev,
      stepStatus: { index: 9, status: 'done' },
    }), (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => updateTaskMeta(ctx, {
      id: task.id, expectedRevision: rev,
      disposition: { kind: 'parked' },
    }), (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => updateTaskMeta(ctx, {
      id: task.id, expectedRevision: rev,
    }), (e) => e.code === 'INVALID_ARGS'); // no mutation
  } finally { cleanup(dir); }
});

// ---------------- operational memory + goals + metrics ----------------

test('worklog append/read: lessons, outcomes, progress', () => {
  const { dir, ctx } = setup();
  try {
    const task = createTask(ctx, BASE);
    const l = appendWorklog(ctx, 'lessons', {
      topic: 'locks', text: 'CAS revision prevents lost update',
      taskId: task.id,
    });
    assert.ok(l.at);
    appendWorklog(ctx, 'outcomes', {
      taskId: task.id, outcome: 'ok',
      skills: ['contract-execution', 'systematic-debugging'],
    });
    appendWorklog(ctx, 'progress', {
      taskId: task.id, title: task.title, result: 'closed',
      domain: 'core',
    });
    const lessons = readWorklog(ctx, 'lessons');
    assert.equal(lessons.entries.length, 1);
    assert.equal(lessons.entries[0].topic, 'locks');
    const outcomes = readWorklog(ctx, 'outcomes', { tail: 5 });
    assert.equal(outcomes.entries[0].outcome, 'ok');
    assert.throws(() => appendWorklog(ctx, 'outcomes', {
      taskId: 'not-a-uuid', outcome: 'ok', skills: [],
    }), (e) => e.code === 'INVALID_ID');
    assert.throws(() => appendWorklog(ctx, 'outcomes', {
      taskId: task.id, outcome: 'maybe', skills: [],
    }), (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => appendWorklog(ctx, 'nope', {}),
      (e) => e.code === 'INVALID_ARGS');
    // entries actually land under paths.memory
    const memDir = path.join(dir, '.tasksystem', 'memory');
    assert.ok(fs.existsSync(path.join(memDir, 'lessons.jsonl')));
    assert.ok(fs.existsSync(path.join(memDir, 'progress.jsonl')));
  } finally { cleanup(dir); }
});

test('goals: create, list dedup, transition appends', () => {
  const { dir, ctx } = setup();
  try {
    const g = createGoal(ctx, {
      title: 'Ship v1', description: 'first release', horizon: 'Q1',
    });
    assert.ok(g.id);
    assert.equal(g.status, 'open');
    const t = transitionGoal(ctx, g.id, 'achieved');
    assert.equal(t.status, 'achieved');
    const { goals } = listGoals(ctx);
    assert.equal(goals.length, 1); // latest entry per id wins
    assert.equal(goals[0].status, 'achieved');
    assert.throws(() => transitionGoal(ctx, g.id, 'bogus'),
      (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => transitionGoal(ctx, crypto.randomUUID(), 'open'),
      (e) => e.code === 'INVALID_ID');
  } finally { cleanup(dir); }
});

test('taskMetrics aggregates store + outcome rates', () => {
  const { dir, ctx } = setup();
  try {
    const t1 = createTask(ctx, { ...BASE, backlog: 'core', priority: 'p1' });
    createTask(ctx, { ...BASE, type: 'docs' });
    appendWorklog(ctx, 'outcomes', {
      taskId: t1.id, outcome: 'ok', skills: ['a', 'b'],
    });
    appendWorklog(ctx, 'outcomes', {
      taskId: t1.id, outcome: 'fail', skills: ['a'],
    });
    const m = taskMetrics(ctx);
    assert.equal(m.tasks.total, 2);
    assert.equal(m.tasks.byState.PLAN, 2);
    assert.equal(m.tasks.byBacklog.core, 1);
    assert.equal(m.tasks.byBacklog.default, 1);
    assert.equal(m.tasks.byPriority.p1, 1);
    assert.equal(m.tasks.byType.docs, 1);
    assert.equal(m.tasks.byDisposition.active, 2);
    assert.deepEqual(m.skillOutcomes.a, { ok: 1, fail: 1 });
    assert.deepEqual(m.skillOutcomes.b, { ok: 1, fail: 0 });
  } finally { cleanup(dir); }
});

test('listTasks surfaces V3 records; stored shape strict', () => {
  const { dir, ctx } = setup();
  try {
    const t = createTask(ctx, { ...BASE, backlog: 'x', priority: 'p3' });
    const { tasks } = listTasks(ctx);
    const found = tasks.find((r) => r.id === t.id);
    assert.equal(found.backlog, 'x');
    assert.equal(found.priority, 'p3');
    // Disposition must not leak into lifecycle decisions: task still
    // transitions normally through the workflow.
    updateTaskMeta(ctx, {
      id: t.id, expectedRevision: t.revision,
      disposition: { kind: 'icebox' },
    });
    const iced = getTask(ctx, t.id);
    assert.equal(iced.disposition.kind, 'icebox');
    const act = transitionTask(ctx, {
      id: t.id, to: 'ACT', expectedRevision: iced.revision,
    });
    assert.equal(act.state, 'ACT');
  } finally { cleanup(dir); }
});
