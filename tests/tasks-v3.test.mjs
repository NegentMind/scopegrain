// SPDX-License-Identifier: Apache-2.0
// Task V3: semantic layer (backlog/disposition/priority/analysis/steps/...),
// metadata CAS updates, operational memory logs, goals and metrics.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import {
  createTask, getTask, listTasks, prepareTask, taskFilePath,
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
  writeJson(dir, '.scopegrain/config.json', config);
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

test('allowedTools: accept null/string-array, reject non-string items', () => {
  const { dir, ctx } = setup();
  try {
    const { task } = prepareTask(ctx, {
      ...BASE, allowedTools: ['shell.exec', 'web.fetch'],
    });
    assert.equal(task.schemaVersion, 3);
    assert.deepEqual(task.allowedTools, ['shell.exec', 'web.fetch']);
    assert.throws(() => prepareTask(ctx, { ...BASE, allowedTools: 'shell' }),
      (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, { ...BASE, allowedTools: ['ok', 7] }),
      (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, { ...BASE, allowedTools: [''] }),
      (e) => e.code === 'INVALID_VALUE');
    const applied = createTask(ctx, { ...BASE, allowedTools: null });
    assert.equal(applied.schemaVersion, 3);
    assert.equal(applied.allowedTools, null);
    // Metadata patch: set allowedTools through the CAS meta path.
    const next = updateTaskMeta(ctx, {
      id: applied.id, expectedRevision: 0,
      set: { allowedTools: ['task.doc'] },
    });
    assert.deepEqual(next.allowedTools, ['task.doc']);
    // Stored-shape: a malformed value on disk is rejected on read.
    const file = taskFilePath(ctx, applied.id);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.allowedTools = ['ok', 1];
    fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => getTask(ctx, applied.id),
      (e) => e.code === 'TASK_MALFORMED');
    // A stored V3 record that predates the key stays readable (the field
    // is an additive extension, never required on read).
    delete data.allowedTools;
    fs.writeFileSync(file, JSON.stringify(data));
    assert.equal(getTask(ctx, applied.id).allowedTools, undefined);
  } finally { cleanup(dir); }
});

test('requiredCapabilities: distinct from skills/allowedTools, same shape', () => {
  const { dir, ctx } = setup();
  try {
    const { task } = prepareTask(ctx, {
      ...BASE,
      skills: ['systematic-debugging'],
      allowedTools: ['shell.exec'],
      requiredCapabilities: ['python_exec', 'sql_read'],
    });
    assert.equal(task.schemaVersion, 3);
    assert.deepEqual(task.skills, ['systematic-debugging']);
    assert.deepEqual(task.allowedTools, ['shell.exec']);
    assert.deepEqual(task.requiredCapabilities, ['python_exec', 'sql_read']);
    assert.throws(() => prepareTask(ctx, {
      ...BASE, requiredCapabilities: 'python_exec',
    }), (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, {
      ...BASE, requiredCapabilities: ['ok', {}],
    }), (e) => e.code === 'INVALID_VALUE');
    const applied = createTask(ctx, { ...BASE, requiredCapabilities: null });
    assert.equal(applied.requiredCapabilities, null);
    const next = updateTaskMeta(ctx, {
      id: applied.id, expectedRevision: 0,
      set: { requiredCapabilities: ['sql_read'] },
    });
    assert.deepEqual(next.requiredCapabilities, ['sql_read']);
    // Stored-shape: malformed value rejected; absent key stays readable.
    const file = taskFilePath(ctx, applied.id);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.requiredCapabilities = 'sql';
    fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => getTask(ctx, applied.id),
      (e) => e.code === 'TASK_MALFORMED');
    delete data.requiredCapabilities;
    fs.writeFileSync(file, JSON.stringify(data));
    assert.equal(getTask(ctx, applied.id).requiredCapabilities, undefined);
  } finally { cleanup(dir); }
});

test('agentRole: non-empty string or null; unresolved reference allowed', () => {
  const { dir, ctx } = setup();
  try {
    const { task } = prepareTask(ctx, {
      ...BASE, agentRole: 'reviewers/finance-senior',
    });
    assert.equal(task.agentRole, 'reviewers/finance-senior');
    assert.throws(() => prepareTask(ctx, { ...BASE, agentRole: '' }),
      (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, { ...BASE, agentRole: ['a'] }),
      (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, { ...BASE, agentRole: 42 }),
      (e) => e.code === 'INVALID_VALUE');
    const applied = createTask(ctx, { ...BASE, agentRole: null });
    assert.equal(applied.agentRole, null);
    const next = updateTaskMeta(ctx, {
      id: applied.id, expectedRevision: 0,
      set: { agentRole: 'agents/architect' },
    });
    assert.equal(next.agentRole, 'agents/architect');
    // Stored-shape: non-string and empty-string values are rejected;
    // an absent key (pre-extension record) stays readable.
    const file = taskFilePath(ctx, applied.id);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.agentRole = '';
    fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => getTask(ctx, applied.id),
      (e) => e.code === 'TASK_MALFORMED');
    delete data.agentRole;
    fs.writeFileSync(file, JSON.stringify(data));
    assert.equal(getTask(ctx, applied.id).agentRole, undefined);
  } finally { cleanup(dir); }
});

test('expectedOutputs: canonical paths, closed item keys, bool flags', () => {
  const { dir, ctx } = setup();
  try {
    const { task } = prepareTask(ctx, {
      ...BASE,
      expectedOutputs: [
        { path: 'docs/report.md' },
        { path: 'src/out.json', mustExist: true, mustBeNonEmpty: true },
      ],
    });
    assert.equal(task.schemaVersion, 3);
    assert.deepEqual(task.expectedOutputs[0], { path: 'docs/report.md' });
    assert.deepEqual(task.expectedOutputs[1], {
      path: 'src/out.json', mustExist: true, mustBeNonEmpty: true,
    });
    const badPath = (code) => (e) => e.code === code;
    for (const p of ['../x', '/abs/x', 'a//b', './x']) {
      assert.throws(() => prepareTask(ctx, {
        ...BASE, expectedOutputs: [{ path: p }],
      }), (e) => ['INVALID_PATH', 'RESERVED_PATH', 'INVALID_VALUE']
        .includes(e.code), `path ${p} must be rejected`);
    }
    assert.throws(() => prepareTask(ctx, {
      ...BASE, expectedOutputs: [{ path: 'a/b', extra: 1 }],
    }), (e) => e.code === 'UNKNOWN_KEY');
    assert.throws(() => prepareTask(ctx, {
      ...BASE, expectedOutputs: [{ path: 'a/b', mustExist: 'yes' }],
    }), (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, {
      ...BASE, expectedOutputs: 'docs/report.md',
    }), (e) => e.code === 'INVALID_VALUE');
    const applied = createTask(ctx, { ...BASE, expectedOutputs: null });
    assert.equal(applied.expectedOutputs, null);
    const next = updateTaskMeta(ctx, {
      id: applied.id, expectedRevision: 0,
      set: { expectedOutputs: [{ path: 'docs/done.md', mustExist: true }] },
    });
    assert.deepEqual(next.expectedOutputs, [
      { path: 'docs/done.md', mustExist: true },
    ]);
    const file = taskFilePath(ctx, applied.id);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.expectedOutputs = [{ path: 'a/../b' }];
    fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => getTask(ctx, applied.id),
      (e) => ['TASK_MALFORMED', 'INVALID_PATH', 'RESERVED_PATH']
        .includes(e.code));
    delete data.expectedOutputs;
    fs.writeFileSync(file, JSON.stringify(data));
    assert.equal(getTask(ctx, applied.id).expectedOutputs, undefined);
  } finally { cleanup(dir); }
});

test('sideEffects: enum none|reversible|irreversible or null', () => {
  const { dir, ctx } = setup();
  try {
    for (const v of ['none', 'reversible', 'irreversible']) {
      const { task } = prepareTask(ctx, { ...BASE, sideEffects: v });
      assert.equal(task.sideEffects, v);
    }
    assert.throws(() => prepareTask(ctx, { ...BASE, sideEffects: 'maybe' }),
      (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, { ...BASE, sideEffects: 3 }),
      (e) => e.code === 'INVALID_VALUE');
    const applied = createTask(ctx, { ...BASE, sideEffects: null });
    assert.equal(applied.sideEffects, null);
    const next = updateTaskMeta(ctx, {
      id: applied.id, expectedRevision: 0,
      set: { sideEffects: 'irreversible' },
    });
    assert.equal(next.sideEffects, 'irreversible');
    const file = taskFilePath(ctx, applied.id);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.sideEffects = 'explosive';
    fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => getTask(ctx, applied.id),
      (e) => e.code === 'TASK_MALFORMED');
    delete data.sideEffects;
    fs.writeFileSync(file, JSON.stringify(data));
    assert.equal(getTask(ctx, applied.id).sideEffects, undefined);
  } finally { cleanup(dir); }
});

test('executionType: atomic|delegated|hitl; consensus excluded by design', () => {
  const { dir, ctx } = setup();
  try {
    for (const v of ['atomic', 'delegated', 'hitl']) {
      const { task } = prepareTask(ctx, { ...BASE, executionType: v });
      assert.equal(task.executionType, v);
    }
    // 'consensus' is a documented anti-pattern, not a valid value.
    assert.throws(() => prepareTask(ctx, { ...BASE, executionType: 'consensus' }),
      (e) => e.code === 'INVALID_VALUE');
    const applied = createTask(ctx, { ...BASE, executionType: null });
    assert.equal(applied.executionType, null);
    const next = updateTaskMeta(ctx, {
      id: applied.id, expectedRevision: 0,
      set: { executionType: 'hitl' },
    });
    assert.equal(next.executionType, 'hitl');
    const file = taskFilePath(ctx, applied.id);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.executionType = 'consensus';
    fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => getTask(ctx, applied.id),
      (e) => e.code === 'TASK_MALFORMED');
    delete data.executionType;
    fs.writeFileSync(file, JSON.stringify(data));
    assert.equal(getTask(ctx, applied.id).executionType, undefined);
  } finally { cleanup(dir); }
});

test('outputContract: non-empty string or null', () => {
  const { dir, ctx } = setup();
  try {
    const { task } = prepareTask(ctx, {
      ...BASE, outputContract: 'schemas/report.schema.json',
    });
    assert.equal(task.outputContract, 'schemas/report.schema.json');
    assert.throws(() => prepareTask(ctx, { ...BASE, outputContract: '' }),
      (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, { ...BASE, outputContract: {} }),
      (e) => e.code === 'INVALID_VALUE');
    const applied = createTask(ctx, { ...BASE, outputContract: null });
    assert.equal(applied.outputContract, null);
    const next = updateTaskMeta(ctx, {
      id: applied.id, expectedRevision: 0,
      set: { outputContract: 'templates/handoff.md' },
    });
    assert.equal(next.outputContract, 'templates/handoff.md');
    const file = taskFilePath(ctx, applied.id);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.outputContract = 7;
    fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => getTask(ctx, applied.id),
      (e) => e.code === 'TASK_MALFORMED');
    delete data.outputContract;
    fs.writeFileSync(file, JSON.stringify(data));
    assert.equal(getTask(ctx, applied.id).outputContract, undefined);
  } finally { cleanup(dir); }
});

test('reviewRubric: non-empty string or null', () => {
  const { dir, ctx } = setup();
  try {
    const { task } = prepareTask(ctx, {
      ...BASE, reviewRubric: 'responde a todos los puntos; min 8/10',
    });
    assert.equal(task.reviewRubric, 'responde a todos los puntos; min 8/10');
    assert.throws(() => prepareTask(ctx, { ...BASE, reviewRubric: ' ' }),
      (e) => e.code === 'INVALID_VALUE');
    const applied = createTask(ctx, { ...BASE, reviewRubric: null });
    assert.equal(applied.reviewRubric, null);
    const next = updateTaskMeta(ctx, {
      id: applied.id, expectedRevision: 0,
      set: { reviewRubric: 'rubric v2' },
    });
    assert.equal(next.reviewRubric, 'rubric v2');
    const file = taskFilePath(ctx, applied.id);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.reviewRubric = [];
    fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => getTask(ctx, applied.id),
      (e) => e.code === 'TASK_MALFORMED');
    delete data.reviewRubric;
    fs.writeFileSync(file, JSON.stringify(data));
    assert.equal(getTask(ctx, applied.id).reviewRubric, undefined);
  } finally { cleanup(dir); }
});

test('fallback: closed {onFail: stall|abandon|needs-human, note?} or null', () => {
  const { dir, ctx } = setup();
  try {
    const { task } = prepareTask(ctx, {
      ...BASE, fallback: { onFail: 'needs-human', note: 'ask owner' },
    });
    assert.deepEqual(task.fallback, { onFail: 'needs-human', note: 'ask owner' });
    const minimal = prepareTask(ctx, { ...BASE, fallback: { onFail: 'stall' } });
    assert.deepEqual(minimal.task.fallback, { onFail: 'stall' });
    assert.throws(() => prepareTask(ctx, {
      ...BASE, fallback: { onFail: 'retry-forever' },
    }), (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, {
      ...BASE, fallback: { onFail: 'stall', extra: 1 },
    }), (e) => e.code === 'UNKNOWN_KEY');
    assert.throws(() => prepareTask(ctx, {
      ...BASE, fallback: { onFail: 'stall', note: 5 },
    }), (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, { ...BASE, fallback: 'stall' }),
      (e) => e.code === 'INVALID_VALUE');
    const applied = createTask(ctx, { ...BASE, fallback: null });
    assert.equal(applied.fallback, null);
    const next = updateTaskMeta(ctx, {
      id: applied.id, expectedRevision: 0,
      set: { fallback: { onFail: 'abandon' } },
    });
    assert.deepEqual(next.fallback, { onFail: 'abandon' });
    const file = taskFilePath(ctx, applied.id);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.fallback = { onFail: 'explode' };
    fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => getTask(ctx, applied.id),
      (e) => e.code === 'TASK_MALFORMED');
    delete data.fallback;
    fs.writeFileSync(file, JSON.stringify(data));
    assert.equal(getTask(ctx, applied.id).fallback, undefined);
  } finally { cleanup(dir); }
});

test('contextInheritance: enum isolated|summary|full or null', () => {
  const { dir, ctx } = setup();
  try {
    const { task } = prepareTask(ctx, { ...BASE, contextInheritance: 'summary' });
    assert.equal(task.contextInheritance, 'summary');
    assert.throws(() => prepareTask(ctx, {
      ...BASE, contextInheritance: 'everything',
    }), (e) => e.code === 'INVALID_VALUE');
    const applied = createTask(ctx, { ...BASE, contextInheritance: null });
    assert.equal(applied.contextInheritance, null);
    const next = updateTaskMeta(ctx, {
      id: applied.id, expectedRevision: 0,
      set: { contextInheritance: 'full' },
    });
    assert.equal(next.contextInheritance, 'full');
    const file = taskFilePath(ctx, applied.id);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.contextInheritance = 'partial';
    fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => getTask(ctx, applied.id),
      (e) => e.code === 'TASK_MALFORMED');
    delete data.contextInheritance;
    fs.writeFileSync(file, JSON.stringify(data));
    assert.equal(getTask(ctx, applied.id).contextInheritance, undefined);
  } finally { cleanup(dir); }
});

test('modelTier: enum fast|standard|reasoning or null', () => {
  const { dir, ctx } = setup();
  try {
    const { task } = prepareTask(ctx, { ...BASE, modelTier: 'reasoning' });
    assert.equal(task.modelTier, 'reasoning');
    assert.throws(() => prepareTask(ctx, { ...BASE, modelTier: 'gpt-5' }),
      (e) => e.code === 'INVALID_VALUE');
    const applied = createTask(ctx, { ...BASE, modelTier: null });
    assert.equal(applied.modelTier, null);
    const next = updateTaskMeta(ctx, {
      id: applied.id, expectedRevision: 0, set: { modelTier: 'fast' },
    });
    assert.equal(next.modelTier, 'fast');
    const file = taskFilePath(ctx, applied.id);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.modelTier = 'expensive';
    fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => getTask(ctx, applied.id),
      (e) => e.code === 'TASK_MALFORMED');
    delete data.modelTier;
    fs.writeFileSync(file, JSON.stringify(data));
    assert.equal(getTask(ctx, applied.id).modelTier, undefined);
  } finally { cleanup(dir); }
});

test('directives/sharedContext: bounded declarative fields or null', () => {
  const { dir, ctx } = setup();
  try {
    const { task } = prepareTask(ctx, {
      ...BASE,
      directives: ['strict TS', 'answer in Spanish'],
      sharedContext: { repo_url: 'https://x', brand_tone: 'warm' },
    });
    assert.deepEqual(task.directives, ['strict TS', 'answer in Spanish']);
    assert.deepEqual(task.sharedContext,
      { repo_url: 'https://x', brand_tone: 'warm' });
    assert.throws(() => prepareTask(ctx, {
      ...BASE, directives: [''],
    }), (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, {
      ...BASE, sharedContext: { k: 42 },
    }), (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, {
      ...BASE, sharedContext: { '': 'x' },
    }), (e) => e.code === 'INVALID_VALUE');
    const overKeys = {};
    for (let i = 0; i < 33; i += 1) overKeys[`k${i}`] = 'v';
    assert.throws(() => prepareTask(ctx, {
      ...BASE, sharedContext: overKeys,
    }), (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, {
      ...BASE, sharedContext: { big: 'x'.repeat(1025) },
    }), (e) => e.code === 'INVALID_VALUE');
    const applied = createTask(ctx, { ...BASE, sharedContext: null });
    assert.equal(applied.sharedContext, null);
    const next = updateTaskMeta(ctx, {
      id: applied.id, expectedRevision: 0,
      set: { sharedContext: { env: 'prod' } },
    });
    assert.deepEqual(next.sharedContext, { env: 'prod' });
    const file = taskFilePath(ctx, applied.id);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.sharedContext = { k: null };
    fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => getTask(ctx, applied.id),
      (e) => e.code === 'TASK_MALFORMED');
    delete data.sharedContext;
    fs.writeFileSync(file, JSON.stringify(data));
    assert.equal(getTask(ctx, applied.id).sharedContext, undefined);
  } finally { cleanup(dir); }
});

test('dataClassification: bounded enum or null, meta-settable', () => {
  const { dir, ctx } = setup();
  try {
    const { task } = prepareTask(ctx, {
      ...BASE, dataClassification: 'confidential',
    });
    assert.equal(task.dataClassification, 'confidential');
    for (const bad of ['top-secret', 'PII', 5]) {
      assert.throws(() => prepareTask(ctx, {
        ...BASE, dataClassification: bad,
      }), (e) => e.code === 'INVALID_VALUE', JSON.stringify(bad));
    }
    const applied = createTask(ctx, { ...BASE, dataClassification: 'pii' });
    const next = updateTaskMeta(ctx, {
      id: applied.id, expectedRevision: 0,
      set: { dataClassification: 'internal' },
    });
    assert.equal(next.dataClassification, 'internal');
    const file = taskFilePath(ctx, applied.id);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.dataClassification = 'top-secret';
    fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => getTask(ctx, applied.id),
      (e) => e.code === 'TASK_MALFORMED');
    delete data.dataClassification;
    fs.writeFileSync(file, JSON.stringify(data));
    assert.equal(getTask(ctx, applied.id).dataClassification, undefined);
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

test('terminal dispositions block non-ABANDON transitions; ABANDON is terminal', () => {
  const { dir, ctx } = setup();
  try {
    const task = createTask(ctx, BASE);
    const d1 = updateTaskMeta(ctx, {
      id: task.id, expectedRevision: task.revision,
      disposition: { kind: 'discarded', reason: 'superseded', by: 'owner' },
    });
    assert.throws(() => transitionTask(ctx, {
      id: task.id, to: 'ACT', expectedRevision: d1.revision,
    }), (e) => e.code === 'DISPOSITION_BLOCKS');
    const abandoned = transitionTask(ctx, {
      id: task.id, to: 'ABANDON', expectedRevision: d1.revision,
    });
    assert.equal(abandoned.state, 'ABANDON');
    assert.throws(() => transitionTask(ctx, {
      id: task.id, to: 'PLAN', expectedRevision: abandoned.revision,
    }), (e) => e.code === 'INVALID_TRANSITION');
    // A soft disposition (deferred) does not block forward transitions.
    const soft = createTask(ctx, { ...BASE, title: 'T2' });
    const d2 = updateTaskMeta(ctx, {
      id: soft.id, expectedRevision: soft.revision,
      disposition: { kind: 'deferred', reason: 'waiting', by: 'owner' },
    });
    const act = transitionTask(ctx, {
      id: soft.id, to: 'STALL', expectedRevision: d2.revision,
    });
    assert.equal(act.state, 'STALL');
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
    const memDir = path.join(dir, '.scopegrain', 'memory');
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
