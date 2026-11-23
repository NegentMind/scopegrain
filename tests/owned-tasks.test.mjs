// SPDX-License-Identifier: Apache-2.0
// Bound owned-task store: mutable task documents with journal-backed
// ownership. Creates write a task plus a record-ownership companion in
// one recoverable two-event operation; transitions write one two-event
// CAS update operation (task source + sidecar chain head) that must
// honor the same workflow/methodology gates as the legacy writer; get
// proves the current bytes by walking the sidecar's per-record
// operation chain, never by enumerating the journal. No adoption, no
// legacy fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import {
  getJournalOperation, recoverJournalOperation,
} from '../src/core/journal.mjs';
import { validateRecordTransition } from '../src/core/record-history.mjs';
import { createOwnedTaskStore, transitionTask } from '../src/core/transition.mjs';
import { createTask, getTask, taskFilePath } from '../src/core/tasks.mjs';
import {
  prepareDesign, prepareSpecification,
} from '../src/core/specifications.mjs';
import { approve, refs } from './methodology-fixtures.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeJson,
} from './helpers.mjs';

const SHA = (content) =>
  crypto.createHash('sha256').update(content).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

function fixture({ tasks = 'docs/agent/tasks', state = '.scopegrain/state',
  configRel = '.scopegrain/config.json' } = {}) {
  const dir = makeTempDir('ownedtask');
  const answers = { ...VALID_ANSWERS,
    paths: { ...VALID_ANSWERS.paths, tasks, state } };
  writeJson(dir, configRel, createConfig(dir, answers, {}));
  const ctx = resolveContext({ project: dir, config: configRel });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  return {
    dir, ctx, a, b,
    bound: bindWorkspace(ctx, { areaIds: [a, b] }),
    alphaBound: bindWorkspace(ctx, { areaIds: [a] }),
    make: (overrides = {}) =>
      createOwnedTaskStore(ctx, { areaIds: [a, b], ...overrides }),
    tasks, state,
    journal: path.join(dir, ...state.split('/'), 'journal'),
  };
}

function input(f, overrides = {}) {
  return {
    areaIds: [f.a, f.b],
    task: {
      title: 'Owned task',
      contract: 'deliver the thing',
      authorContext: 'owned-author',
      scope: ['src/x'],
    },
    ...overrides,
  };
}

function transitionIn(f, id, to, expectedRevision, extra = {}) {
  return {
    areaIds: [f.a, f.b],
    transition: { id, to, expectedRevision, ...extra },
  };
}

function scopeOf(f, areaIds) {
  return {
    workspaceId: f.bound.workspaceId, projectId: f.bound.projectId,
    repositoryId: f.bound.repositoryId, areaIds: [...areaIds].sort(),
  };
}

function readSource(f, sourceRel) {
  return fs.readFileSync(path.join(f.dir, ...sourceRel.split('/')));
}

// Formal fixture: real spec + design artifacts, no approvals unless asked.
function formal(f) {
  const s = prepareSpecification(f.ctx, {
    originalRequest: 'owned formal spec', title: 'Owned spec',
    outcome: { statement: 'assigned outcomes', evidencePlan: 'declared' },
    requirements: [{ id: 'R1', statement: 'requirement',
      scenarios: [{ id: 'S1', given: 'g', when: 'w', then: 't' }] }],
    scope: ['src/a', 'src/b'], openQuestions: [],
  });
  applyPlan(f.dir, [s.file]);
  const d = prepareDesign(f.ctx, { specId: s.artifact.id,
    title: 'Owned design', body: 'declared design' });
  applyPlan(f.dir, [d.file]);
  return { spec: s.artifact, design: d.artifact };
}

test('store is frozen with prepare/create/get/transition; options and ctx validated', () => {
  const f = fixture();
  try {
    const store = f.make();
    assert.equal(Object.isFrozen(store), true);
    assert.deepEqual(Object.keys(store).sort(),
      ['create', 'get', 'prepare', 'transition']);
    for (const bad of [null, {}, { areaIds: [] }, { areaIds: ['x'] },
      { areaIds: [f.a, f.a] }, { areaIds: [f.a], extra: 1 },
      { areaIds: [f.a], origin: 'cli' }]) {
      assert.throws(() => createOwnedTaskStore(f.ctx, bad),
        (e) => e.code === 'INVALID_OWNED_TASK_INPUT');
    }
    assert.throws(() => createOwnedTaskStore(f.ctx,
      { areaIds: ['99999999-9999-9999-9999-999999999999'] }),
      (e) => e.code === 'SCOPE_DENIED');
    for (const badCtx of [null, { projectRoot: f.dir },
      { config: f.ctx.config }]) {
      assert.throws(() => createOwnedTaskStore(badCtx, { areaIds: [f.a] }),
        (e) => e.code === 'INVALID_OWNED_TASK_INPUT');
    }
  } finally { cleanup(f.dir); }
  const bare = makeTempDir('ownedtask-bare');
  try {
    writeJson(bare, '.scopegrain/config.json',
      createConfig(bare, VALID_ANSWERS, {}));
    const ctx = resolveContext({ project: bare });
    assert.throws(() => createOwnedTaskStore(ctx, { areaIds: [crypto.randomUUID()] }),
      (e) => e.code === 'WORKSPACE_NOT_FOUND');
  } finally { cleanup(bare); }
});

test('closed create input rejects injected keys before any write', () => {
  const f = fixture();
  try {
    const store = f.make();
    const dirTree = () => fs.existsSync(f.journal);
    for (const bad of [null, [], 'x',
      { task: { title: 't', contract: 'c', authorContext: 'a' } },
      { areaIds: [f.a] },
      input(f, { extra: 1 }),
      input(f, { recordId: f.a }),
      input(f, { areaIds: [] }),
      input(f, { areaIds: [f.a, f.a] }),
      input(f, { task: 'x' })]) {
      for (const fn of [() => store.create(bad), () => store.prepare(bad)]) {
        assert.throws(fn, (e) => e.code !== 'OK' && e.code !== undefined);
      }
    }
    assert.equal(dirTree(), false);
  } finally { cleanup(f.dir); }
});

test('prepare is a read-only dry-run with provisional ids', () => {
  const f = fixture();
  try {
    const store = f.make();
    const first = store.prepare(input(f));
    const second = store.prepare(input(f));
    assert.notEqual(first.record.id, second.record.id);
    assert.deepEqual(Object.keys(first).sort(),
      ['mode', 'ownershipRel', 'record', 'reservesIds', 'sourceRel']);
    assert.equal(first.mode, 'dry-run');
    assert.equal(first.reservesIds, false);
    assert.equal(first.record.state, 'PLAN');
    assert.equal(first.record.revision, 0);
    assert.equal(first.sourceRel,
      `${f.tasks}/${first.record.id}.json`);
    assert.equal(first.ownershipRel,
      `${f.state}/record-ownership/task/${first.record.id}.json`);
    assert.equal(fs.existsSync(f.journal), false);
    assert.equal(fs.existsSync(path.join(f.dir, f.tasks)), false);
  } finally { cleanup(f.dir); }
});

test('create commits two scoped events; get proves the current task', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
    assert.equal(created.mode, 'applied');
    assert.equal(created.ownershipConfirmed, true);
    assert.equal(created.journal.status, 'committed');
    assert.equal(created.journal.journalState, 'confirmed');
    assert.equal(created.journal.eventIds.length, 2);
    const record = created.record;
    assert.equal(record.state, 'PLAN');
    assert.equal(record.revision, 0);
    const sourceBytes = readSource(f, created.sourceRel);
    assert.deepEqual(JSON.parse(sourceBytes.toString('utf8')), record);
    const ownBytes = fs.readFileSync(
      path.join(f.dir, ...created.ownershipRel.split('/')));
    const ownership = JSON.parse(ownBytes.toString('utf8'));
    assert.equal(ownership.schemaVersion, 1);
    assert.equal(ownership.sourceKind, 'task');
    assert.equal(ownership.recordId, record.id);
    assert.equal(ownership.sourceRevision, 0);
    assert.equal(ownership.sourceRel, created.sourceRel);
    assert.equal(ownership.sourceHash, SHA(sourceBytes));
    assert.equal(ownership.operationId, created.journal.operationId);
    assert.equal(ownership.createdAt, record.createdAt);
    assert.deepEqual(ownership.scope, scopeOf(f, [f.a, f.b]));
    assert.deepEqual(ownership.chain, [created.journal.operationId]);
    const op = getJournalOperation(f.bound, created.journal.operationId);
    assert.equal(op.state, 'committed');
    assert.equal(op.intent.events.length, 2);
    assert.deepEqual(op.intent.events.map((e) => e.sourceKind).sort(),
      ['record-ownership', 'task']);
    for (const event of op.intent.events) {
      assert.equal(event.recordId, record.id);
      assert.equal(event.sourceRevision, 0);
      assert.equal(event.operation, 'create');
      assert.equal(event.createdAt, record.createdAt);
      assert.deepEqual(event.areaIds, [f.a, f.b].sort());
    }
    const got = store.get(record.id);
    assert.deepEqual(got, {
      record, ownership,
      locator: {
        operationId: created.journal.operationId,
        eventId: op.intent.events.find((e) => e.sourceKind === 'task').eventId,
      },
      isCurrentSource: true, memoryConsulted: false,
    });
  } finally { cleanup(f.dir); }
});

test('transition commits a two-event CAS op; sidecar chain proves revision 1', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
    const v0 = readSource(f, created.sourceRel);
    const ownAbs = path.join(f.dir, ...created.ownershipRel.split('/'));
    const s0 = fs.readFileSync(ownAbs);
    const moved = store.transition(
      transitionIn(f, created.record.id, 'ACT', 0));
    assert.equal(moved.mode, 'applied');
    assert.equal(moved.updateConfirmed, true);
    assert.equal(moved.journal.status, 'committed');
    assert.equal(moved.journal.eventIds.length, 2);
    assert.equal(moved.record.state, 'ACT');
    assert.equal(moved.record.revision, 1);
    assert.equal(moved.ownershipRel, created.ownershipRel);
    const v1 = readSource(f, created.sourceRel);
    assert.equal(SHA(v1), SHA(Buffer.from(json(moved.record), 'utf8')));
    const updateOp = getJournalOperation(f.bound, moved.journal.operationId);
    assert.equal(updateOp.intent.events.length, 2);
    const source = updateOp.intent.events.find(
      (e) => e.sourceKind === 'task');
    const side = updateOp.intent.events.find(
      (e) => e.sourceKind === 'record-ownership');
    assert.equal(source.operation, 'update');
    assert.equal(source.recordId, created.record.id);
    assert.equal(source.sourceRevision, 0);
    assert.equal(source.previousHash, SHA(v0));
    assert.equal(source.sourceHash, SHA(v1));
    // The sidecar advanced in lockstep: rev0 bytes -> rev1 chain head.
    const s1 = fs.readFileSync(ownAbs);
    const sidecar = JSON.parse(s1.toString('utf8'));
    assert.equal(side.operation, 'update');
    assert.equal(side.recordId, created.record.id);
    assert.equal(side.sourceRevision, 0);
    assert.equal(side.previousHash, SHA(s0));
    assert.equal(side.sourceHash, SHA(s1));
    assert.equal(sidecar.sourceRevision, 1);
    assert.equal(sidecar.sourceHash, SHA(v1));
    assert.equal(sidecar.operationId, moved.journal.operationId);
    assert.equal(sidecar.createdAt, updateOp.intent.createdAt);
    assert.deepEqual(sidecar.chain,
      [created.journal.operationId, moved.journal.operationId]);
    // Both file series chain their events to the create op.
    const createOp = getJournalOperation(f.bound, created.journal.operationId);
    const createSource = createOp.intent.events.find(
      (e) => e.sourceKind === 'task');
    const createSide = createOp.intent.events.find(
      (e) => e.sourceKind === 'record-ownership');
    assert.equal(validateRecordTransition(createSource, source), undefined);
    assert.equal(validateRecordTransition(createSide, side), undefined);
    const got = store.get(created.record.id);
    assert.equal(got.record.revision, 1);
    assert.equal(got.record.state, 'ACT');
    assert.equal(got.locator.operationId, moved.journal.operationId);
    assert.equal(got.locator.eventId, source.eventId);
    assert.equal(got.isCurrentSource, true);
    // Legacy reads see the same bytes; only the proof differs.
    assert.equal(getTask(f.ctx, created.record.id).state, 'ACT');
  } finally { cleanup(f.dir); }
});

test('two transitions chain to revision 2; stale snapshot conflicts', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
    const first = store.transition(
      transitionIn(f, created.record.id, 'ACT', 0));
    const second = store.transition(
      transitionIn(f, created.record.id, 'VERIFY', 1));
    assert.equal(second.record.state, 'VERIFY');
    assert.equal(second.record.revision, 2);
    assert.equal(second.journal.eventIds.length, 2);
    const e1 = getJournalOperation(f.bound, first.journal.operationId)
      .intent.events.find((e) => e.sourceKind === 'task');
    const e2 = getJournalOperation(f.bound, second.journal.operationId)
      .intent.events.find((e) => e.sourceKind === 'task');
    assert.equal(e2.sourceRevision, 1);
    assert.equal(e2.previousHash, e1.sourceHash);
    assert.equal(validateRecordTransition(e1, e2), undefined);
    // The rev0->1->2 chain is proven by the sidecar's operation index.
    const sidecar = JSON.parse(fs.readFileSync(
      path.join(f.dir, ...created.ownershipRel.split('/')), 'utf8'));
    assert.equal(sidecar.sourceRevision, 2);
    assert.deepEqual(sidecar.chain, [created.journal.operationId,
      first.journal.operationId, second.journal.operationId]);
    const got = store.get(created.record.id);
    assert.equal(got.record.revision, 2);
    assert.equal(got.locator.operationId, second.journal.operationId);
    // A second writer holding the rev0 snapshot conflicts, never forks.
    assert.throws(() => store.transition(
      transitionIn(f, created.record.id, 'ACT', 0)),
      (e) => e.code === 'REVISION_MISMATCH');
    const after = store.get(created.record.id);
    assert.equal(after.record.state, 'VERIFY');
    assert.equal(after.record.revision, 2);
  } finally { cleanup(f.dir); }
});

test('unowned tasks are never adopted by get or transition', () => {
  const f = fixture();
  try {
    const store = f.make();
    const legacy = createTask(f.ctx, {
      title: 'legacy', contract: 'c', authorContext: 'a', scope: ['src/x'],
    });
    assert.throws(() => store.get(legacy.id),
      (e) => e.code === 'OWNED_TASK_NOT_FOUND');
    assert.throws(() => store.transition(
      transitionIn(f, legacy.id, 'ACT', 0)),
      (e) => e.code === 'OWNED_TASK_NOT_FOUND');
    // Bytes are untouched: the failed transition wrote nothing.
    assert.equal(getTask(f.ctx, legacy.id).revision, 0);
    assert.throws(() => store.get('not-a-uuid'),
      (e) => e.code === 'INVALID_OWNED_TASK_INPUT');
  } finally { cleanup(f.dir); }
});

test('foreign legacy writes are detected, never explained away', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
    // A legacy transition mutates bytes outside the journal chain.
    transitionTask(f.ctx, { id: created.record.id, to: 'ACT',
      expectedRevision: 0 });
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_TASK_SOURCE_CHANGED');
    assert.throws(() => store.transition(
      transitionIn(f, created.record.id, 'ACT', 1)),
      (e) => e.code === 'OWNED_TASK_SOURCE_CHANGED');
  } finally { cleanup(f.dir); }
});

test('CAS drift under the journal lock conflicts before reserving state', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    const store = f.make();
    const created = store.create(input(f));
    const v0 = readSource(f, created.sourceRel);
    const lockFile = path.join(f.journal, '.lock');
    fs.openSync = function (file, flags, ...args) {
      const fd = open.call(this, file, flags, ...args);
      if (file === lockFile && flags === 'wx') {
        // A non-cooperative writer lands after the proof but inside the
        // journal critical section: byte CAS must still win.
        fs.writeFileSync(path.join(f.dir, ...created.sourceRel.split('/')),
          json({ ...created.record, title: 'raced' }));
      }
      return fd;
    };
    assert.throws(() => store.transition(
      transitionIn(f, created.record.id, 'ACT', 0)),
      (e) => e.code === 'JOURNAL_SOURCE_CONFLICT');
    fs.openSync = open;
    assert.equal(fs.readFileSync(
      path.join(f.dir, ...created.sourceRel.split('/')), 'utf8')
      .includes('raced'), true);
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_TASK_SOURCE_CHANGED');
    // Restore bytes: proof is by content, the chain is unharmed.
    fs.writeFileSync(path.join(f.dir, ...created.sourceRel.split('/')), v0);
    assert.equal(store.get(created.record.id).isCurrentSource, true);
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('update respects the task lock; get stays read-only under a held lock', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
    const lock = taskFilePath(f.ctx, created.record.id) + '.lock';
    fs.writeFileSync(lock, 'held', { flag: 'wx' });
    assert.throws(() => store.transition(
      transitionIn(f, created.record.id, 'ACT', 0)),
      (e) => e.code === 'TASK_LOCKED');
    assert.equal(store.get(created.record.id).isCurrentSource, true);
    fs.rmSync(lock);
    const moved = store.transition(
      transitionIn(f, created.record.id, 'ACT', 0));
    assert.equal(moved.record.state, 'ACT');
    assert.equal(fs.existsSync(lock), false);
  } finally { cleanup(f.dir); }
});

test('mid-apply update failure preserves the unconfirmed receipt', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    const store = f.make();
    const created = store.create(input(f));
    const v0 = readSource(f, created.sourceRel);
    fs.openSync = function (file, flags, ...args) {
      if (String(file).includes('.upd-') && flags === 'wx') {
        throw Object.assign(new Error('staged temp failure'), { code: 'EIO' });
      }
      return open.call(this, file, flags, ...args);
    };
    const result = store.transition(
      transitionIn(f, created.record.id, 'ACT', 0));
    fs.openSync = open;
    assert.equal(result.mode, 'applied');
    assert.equal(result.updateConfirmed, false);
    assert.equal(result.journal.status, 'unconfirmed');
    assert.equal(result.journal.journalState, 'prepared');
    assert.notEqual(result.journal.cause, null);
    // The source was never renamed; the committed tip still proves rev0.
    assert.equal(readSource(f, created.sourceRel).toString('utf8'),
      v0.toString('utf8'));
    const got = store.get(created.record.id);
    assert.equal(got.record.revision, 0);
    assert.equal(got.isCurrentSource, true);
    // The journal refuses new writes until explicit recovery.
    assert.throws(() => store.transition(
      transitionIn(f, created.record.id, 'ACT', 0)),
      (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    const loaded = getJournalOperation(f.bound, result.journal.operationId);
    const done = recoverJournalOperation(f.bound, result.journal.operationId, {
      action: 'abandon-prepared',
      expectedIntentDigest: loaded.intentDigest,
      reason: 'test abandonment',
    });
    assert.equal(done.state, 'abandoned');
    const moved = store.transition(
      transitionIn(f, created.record.id, 'ACT', 0));
    assert.equal(moved.updateConfirmed, true);
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('all-of scope: record areas must be granted and named exactly', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
    const alpha = createOwnedTaskStore(f.ctx, { areaIds: [f.a] });
    assert.throws(() => alpha.get(created.record.id),
      (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => alpha.transition(
      transitionIn(f, created.record.id, 'ACT', 0)),
      (e) => e.code === 'SCOPE_DENIED');
    // A granted-but-partial scope request is not the record scope.
    assert.throws(() => store.transition({
      areaIds: [f.a],
      transition: { id: created.record.id, to: 'ACT', expectedRevision: 0 },
    }), (e) => e.code === 'SCOPE_DENIED');
    const solo = alpha.create(input(f, { areaIds: [f.a] }));
    const beta = createOwnedTaskStore(f.ctx, { areaIds: [f.b] });
    assert.throws(() => beta.get(solo.record.id),
      (e) => e.code === 'SCOPE_DENIED');
    // A superset grant covers the record scope.
    const both = f.make();
    assert.equal(both.get(solo.record.id).isCurrentSource, true);
    assert.equal(alpha.get(solo.record.id).isCurrentSource, true);
  } finally { cleanup(f.dir); }
});

test('journalized transition still enforces methodology gates', () => {
  const f = fixture();
  try {
    const { spec, design } = formal(f);
    const store = f.make();
    const created = store.create(input(f, {
      task: {
        title: 'Formal owned', contract: 'C', authorContext: 'owned-author',
        scope: ['src/a'], specId: spec.id, designId: design.id,
        scenarioRefs: refs('S1'),
      },
    }));
    assert.equal(created.record.schemaVersion, 2);
    const before = readSource(f, created.sourceRel);
    const opsBefore = fs.readdirSync(path.join(f.journal, 'operations'));
    assert.throws(() => store.transition(
      transitionIn(f, created.record.id, 'ACT', 0)),
      (e) => e.code === 'METHODOLOGY_BLOCKED'
        && e.issues.some((i) => i.code === 'APPROVAL_NOT_FOUND'));
    // Blocked gate: no update event, no byte change.
    assert.equal(readSource(f, created.sourceRel).toString('utf8'),
      before.toString('utf8'));
    assert.deepEqual(fs.readdirSync(path.join(f.journal, 'operations')),
      opsBefore);
    approve(f, 'spec', spec.id);
    approve(f, 'design', design.id);
    approve(f, 'task', created.record.id);
    const moved = store.transition(
      transitionIn(f, created.record.id, 'ACT', 0));
    assert.equal(moved.record.state, 'ACT');
    assert.equal(store.get(created.record.id).record.revision, 1);
  } finally { cleanup(f.dir); }
});

test('tampered sidecar, missing commit and forged records fail closed', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
    const ownAbs = path.join(f.dir, ...created.ownershipRel.split('/'));
    const ownership = JSON.parse(fs.readFileSync(ownAbs, 'utf8'));
    fs.writeFileSync(ownAbs, json({ ...ownership, sourceRevision: 1 }));
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_TASK_MALFORMED');
    fs.writeFileSync(ownAbs, json({ ...ownership, sourceKind: 'spec' }));
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_TASK_MALFORMED');
    // A forged chain entry cannot reach a committed operation.
    fs.writeFileSync(ownAbs, json({ ...ownership,
      chain: [crypto.randomUUID()] }));
    assert.throws(() => store.get(created.record.id),
      (e) => ['OWNED_TASK_MALFORMED', 'JOURNAL_NOT_FOUND',
        'OWNED_TASK_NOT_COMMITTED'].includes(e.code));
    fs.writeFileSync(ownAbs, json(ownership));
    assert.equal(store.get(created.record.id).isCurrentSource, true);
    const commitAbs = path.join(f.journal, 'operations',
      created.journal.operationId, 'commit.json');
    const commit = fs.readFileSync(commitAbs);
    fs.unlinkSync(commitAbs);
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_TASK_NOT_COMMITTED');
    fs.writeFileSync(commitAbs, commit);
    fs.unlinkSync(ownAbs);
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_TASK_NOT_FOUND');
  } finally { cleanup(f.dir); }
});

test('a corrupted tip snapshot cannot be explained away by intact files', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
    const moved = store.transition(
      transitionIn(f, created.record.id, 'ACT', 0));
    // Corrupt the stored update snapshot: the tip can no longer prove
    // current bytes even though the file itself is intact.
    const event = getJournalOperation(f.bound, moved.journal.operationId)
      .intent.events.find((e) => e.sourceKind === 'task');
    const snapAbs = path.join(f.journal, 'snapshots',
      `${event.sourceHash}.blob`);
    fs.appendFileSync(snapAbs, Buffer.from([0]));
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'JOURNAL_SNAPSHOT_MISMATCH');
  } finally { cleanup(f.dir); }
});

test('an earlier-revision sidecar cannot hide newer source bytes', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
    const ownAbs = path.join(f.dir, ...created.ownershipRel.split('/'));
    const rev0Sidecar = fs.readFileSync(ownAbs);
    store.transition(transitionIn(f, created.record.id, 'ACT', 0));
    // Rewind the chain head to the still-committed rev0 sidecar: the
    // document is internally coherent (its snapshot still matches) but
    // proves an older tip than the current source bytes.
    fs.writeFileSync(ownAbs, rev0Sidecar);
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_TASK_SOURCE_CHANGED');
    assert.throws(() => store.transition(
      transitionIn(f, created.record.id, 'VERIFY', 1)),
      (e) => e.code === 'OWNED_TASK_SOURCE_CHANGED');
  } finally { cleanup(f.dir); }
});

test('a forged chain inside a genuine sidecar fails closed', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
    const moved = store.transition(
      transitionIn(f, created.record.id, 'ACT', 0));
    const ownAbs = path.join(f.dir, ...created.ownershipRel.split('/'));
    const ownership = JSON.parse(fs.readFileSync(ownAbs, 'utf8'));
    const closed = ['OWNED_TASK_MALFORMED', 'JOURNAL_NOT_FOUND',
      'OWNED_TASK_NOT_COMMITTED', 'OWNED_TASK_SOURCE_CHANGED'];
    const mutate = (patch) => {
      fs.writeFileSync(ownAbs, json({ ...ownership, ...patch }));
      assert.throws(() => store.get(created.record.id),
        (e) => closed.includes(e.code));
    };
    mutate({ recordId: crypto.randomUUID() });
    mutate({ sourceRel: 'other/path.json' });
    mutate({ sourceHash: 'b'.repeat(64) });
    mutate({ sourceRevision: 2 });
    mutate({ chain: [crypto.randomUUID(), moved.journal.operationId] });
    mutate({ chain: [created.journal.operationId,
      created.journal.operationId] });
    mutate({ operationId: created.journal.operationId });
    fs.writeFileSync(ownAbs, json(ownership));
    assert.equal(store.get(created.record.id).isCurrentSource, true);
  } finally { cleanup(f.dir); }
});

test('unrelated committed operations do not affect owned reads', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
    const moved = store.transition(
      transitionIn(f, created.record.id, 'ACT', 0));
    // Many unrelated committed operations share the same journal.
    for (let i = 0; i < 12; i += 1) {
      store.create(input(f));
    }
    const other = store.create(input(f));
    store.transition(transitionIn(f, other.record.id, 'ACT', 0));
    const opsDir = path.join(f.journal, 'operations');
    assert.ok(fs.readdirSync(opsDir).length >= 15);
    // Reads must never enumerate journal/operations: the sidecar chain
    // is the only index. Guard the whole get() against any listing.
    const opendir = fs.opendirSync;
    const readdir = fs.readdirSync;
    const guard = (p) => {
      if (String(p).replaceAll('\\', '/').endsWith('/journal/operations')) {
        throw Object.assign(
          new Error('operations dir must not be enumerated'),
          { code: 'ESCAN' });
      }
    };
    fs.opendirSync = function (p, ...rest) {
      guard(p);
      return opendir.call(this, p, ...rest);
    };
    fs.readdirSync = function (p, ...rest) {
      guard(p);
      return readdir.call(this, p, ...rest);
    };
    try {
      const got = store.get(created.record.id);
      assert.equal(got.record.revision, 1);
      assert.equal(got.locator.operationId, moved.journal.operationId);
      assert.equal(got.isCurrentSource, true);
      // The write path walks the same per-record chain, not the journal.
      const next = store.transition(
        transitionIn(f, created.record.id, 'VERIFY', 1));
      assert.equal(next.record.revision, 2);
      assert.equal(store.get(created.record.id).record.revision, 2);
    } finally {
      fs.opendirSync = opendir;
      fs.readdirSync = readdir;
    }
  } finally { cleanup(f.dir); }
});

test('oversized current source and document bound stay enforced', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
    const srcAbs = path.join(f.dir, ...created.sourceRel.split('/'));
    const bytes = fs.readFileSync(srcAbs);
    fs.writeFileSync(srcAbs, Buffer.alloc(loadLimits().maxDocumentBytes + 1));
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'DOCUMENT_TOO_LARGE');
    fs.writeFileSync(srcAbs, bytes);
    assert.equal(store.get(created.record.id).isCurrentSource, true);
  } finally { cleanup(f.dir); }
});
