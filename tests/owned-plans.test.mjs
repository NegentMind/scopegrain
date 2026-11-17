// Owned plans: opt-in journal-backed mutable plan documents. 2-event
// create op (plan + plan-ownership rev0), CAS update ops for membership/
// state, chain proof on read. Legacy path must stay byte-identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan, preflightPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import {
  createOwnedPlanStore, getPlan, nextPlanTasks, preparePlan,
} from '../src/core/plans.mjs';
import { createTask, getTask } from '../src/core/tasks.mjs';
import {
  prepareDesign, prepareSpecification,
} from '../src/core/specifications.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import {
  getJournalEvent, getJournalOperation, listJournalPending,
  recoverJournalOperation,
} from '../src/core/journal.mjs';
import { validateRecordTransition } from '../src/core/record-history.mjs';
import {
  VALID_ANSWERS, cleanup, exists, makeTempDir, readJson, writeFile,
  writeJson,
} from './helpers.mjs';

const SHA = (content) =>
  crypto.createHash('sha256').update(content).digest('hex');

const GOOD = {
  key: 'rel-1', title: 'Release 1', authorContext: 'ctx-a',
  tasks: [
    { key: 'base', title: 'Base', contract: 'c', scope: [], dependsOn: [] },
    { key: 'api', title: 'API', contract: 'c', scope: [], dependsOn: ['base'] },
  ],
};

const SPEC = {
  originalRequest: 'Synthetic owned-plan parent',
  title: 'Owned plan parent',
  outcome: { statement: 'Scoped ownership', evidencePlan: 'Fixture checks' },
  requirements: [{ id: 'R1', statement: 'Proven bytes',
    scenarios: [{ id: 'S1', given: 'a plan', when: 'read', then: 'proof' }] }],
  scope: ['src/a'], openQuestions: [],
};

function fixture() {
  const dir = makeTempDir('owned-plans');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  return {
    dir, ctx, a, b,
    bound: bindWorkspace(ctx, { areaIds: [a, b] }),
    store: createOwnedPlanStore(ctx, { areaIds: [a, b] }),
  };
}

// V2 parents via the ordinary writers: parent ownership is NOT required.
function formalFixture(f) {
  const spec = prepareSpecification(f.ctx, structuredClone(SPEC));
  applyPlan(f.dir, [spec.file]);
  const design = prepareDesign(f.ctx, {
    specId: spec.artifact.id, title: 'Formal design', body: 'body',
  });
  applyPlan(f.dir, [design.file]);
  const input = {
    key: 'v2-plan', title: 'V2 plan', authorContext: 'ctx-a',
    specId: spec.artifact.id, designId: design.artifact.id,
    tasks: [{
      key: 't1', title: 'Formal task', contract: 'c', scope: ['src/a'],
      scenarioRefs: [{ requirementId: 'R1', scenarioId: 'S1' }],
      dependsOn: [],
    }],
  };
  return { spec, design, input };
}

test('store construction validates ctx, options, enrollment and grants', () => {
  const f = fixture();
  const bare = makeTempDir('owned-plans-bare');
  try {
    writeJson(bare, '.tasksystem/config.json',
      createConfig(bare, VALID_ANSWERS, {}));
    const bareCtx = resolveContext({ project: bare });
    for (const bad of [
      () => createOwnedPlanStore(null, { areaIds: [f.a] }),
      () => createOwnedPlanStore(f.ctx, null),
      () => createOwnedPlanStore(f.ctx, { areaIds: [] }),
      () => createOwnedPlanStore(f.ctx, { areaIds: ['nope'] }),
      () => createOwnedPlanStore(f.ctx, { areaIds: [f.a], extra: 1 }),
      () => createOwnedPlanStore(f.ctx, { areaIds: [f.a, f.a] }),
    ]) {
      assert.throws(bad, (e) => e.code === 'INVALID_OWNED_PLAN_INPUT');
    }
    assert.throws(() => createOwnedPlanStore(bareCtx, { areaIds: [f.a] }),
      (e) => e.code === 'WORKSPACE_NOT_FOUND');
    assert.throws(() => createOwnedPlanStore(f.ctx, {
      areaIds: ['01234567-89ab-4cde-8fab-0123456789ab'],
    }), (e) => e.code === 'SCOPE_DENIED');
  } finally { cleanup(f.dir); cleanup(bare); }
});

test('prepare is a read-only dry-run with provisional identity', () => {
  const f = fixture();
  try {
    const out = f.store.prepare({ areaIds: [f.a], plan: GOOD });
    assert.equal(out.mode, 'dry-run');
    assert.equal(out.reservesIds, false);
    assert.equal(out.record.key, 'rel-1');
    assert.equal(out.sourceRel, 'docs/agent/plans/rel-1.json');
    assert.equal(out.ownershipRel,
      '.tasksystem/state/plan-ownership/rel-1.json');
    // 2 task files + plan + sidecar.
    assert.equal(out.files.length, 4);
    assert.ok(out.files.every((file) => file.action === 'create'));
    assert.ok(!exists(f.dir, 'docs/agent/plans/rel-1.json'));
    assert.ok(!exists(f.dir, '.tasksystem/state/plan-ownership'));
    assert.ok(!exists(f.dir, '.tasksystem/state/journal'));
    for (const bad of [
      {}, { areaIds: [f.a] }, { plan: GOOD },
      { areaIds: [f.a], plan: GOOD, extra: true },
      { areaIds: [], plan: GOOD },
      { areaIds: [f.b, f.a], plan: GOOD, specification: {} },
    ]) {
      assert.throws(() => f.store.prepare(bad),
        (e) => e.code === 'INVALID_OWNED_PLAN_INPUT');
    }
    assert.throws(() => f.store.prepare({ areaIds: [f.a], plan: { ...GOOD,
      tasks: [{ key: 'a', title: 't', contract: 'c', dependsOn: ['a'] }] } }),
      (e) => e.code === 'INVALID_PLAN');
    const narrow = createOwnedPlanStore(f.ctx, { areaIds: [f.a] });
    assert.throws(() => narrow.prepare({ areaIds: [f.a, f.b], plan: GOOD }),
      (e) => e.code === 'SCOPE_DENIED');
  } finally { cleanup(f.dir); }
});

test('create commits a 2-event op and get proves the genesis chain', () => {
  const f = fixture();
  try {
    const created = f.store.create({ areaIds: [f.a], plan: GOOD });
    assert.equal(created.mode, 'applied');
    assert.equal(created.ownershipConfirmed, true);
    assert.equal(created.journal.status, 'committed');
    assert.equal(created.journal.journalState, 'confirmed');
    assert.equal(created.record.key, 'rel-1');
    assert.equal(created.taskFiles.length, 2);
    const op = getJournalOperation(f.bound, created.journal.operationId);
    assert.equal(op.intent.events.length, 2);
    const kinds = op.intent.events.map((e) => e.sourceKind).sort();
    assert.deepEqual(kinds, ['plan', 'plan-ownership']);
    for (const e of op.intent.events) {
      assert.equal(e.operation, 'create');
      assert.equal(e.sourceRevision, 0);
      assert.equal(e.recordId, 'rel-1');
      assert.deepEqual(e.areaIds, [f.a]);
    }
    assert.ok(exists(f.dir, 'docs/agent/plans/rel-1.json'));
    assert.ok(exists(f.dir, '.tasksystem/state/plan-ownership/rel-1.json'));
    for (const rel of created.taskFiles) assert.ok(exists(f.dir, rel));
    const got = f.store.get('rel-1');
    assert.equal(got.record.key, 'rel-1');
    assert.equal(got.sourceRevision, 0);
    assert.equal(got.isCurrentSource, true);
    assert.equal(got.memoryConsulted, false);
    assert.equal(got.ownership.operations.length, 1);
    assert.equal(got.locator.operationId, created.journal.operationId);
    // The owned doc is still a normal plan file for structural reads and
    // derived (unproven) readiness.
    assert.equal(getPlan(f.ctx, 'rel-1').key, 'rel-1');
    const next = nextPlanTasks(f.ctx, 'rel-1');
    assert.equal(next.find((t) => t.key === 'base').status, 'ready');
    assert.equal(next.find((t) => t.key === 'api').status, 'blocked');
  } finally { cleanup(f.dir); }
});

test('update chains CAS ops and get proves each revision', () => {
  const f = fixture();
  try {
    const created = f.store.create({ areaIds: [f.a], plan: GOOD });
    const doc = getPlan(f.ctx, 'rel-1');
    const api = doc.tasks.find((t) => t.key === 'api');
    const nextDoc = {
      ...doc, title: 'Release 1.1',
      tasks: doc.tasks.map((t) => t.key === 'api'
        ? { ...t, dependsOn: [] } : t),
    };
    const upd = f.store.update({
      key: 'rel-1', expectedRevision: 0, plan: nextDoc });
    assert.equal(upd.mode, 'applied');
    assert.equal(upd.sourceRevision, 1);
    assert.equal(upd.updateConfirmed, true);
    assert.equal(upd.record.title, 'Release 1.1');
    const uop = getJournalOperation(f.bound, upd.journal.operationId);
    assert.equal(uop.intent.events.length, 2);
    for (const e of uop.intent.events) {
      assert.equal(e.operation, 'update');
      assert.equal(e.sourceRevision, 0);
      assert.equal(typeof e.previousHash, 'string');
    }
    const createPlan = op_plan_event(created.journal.operationId, f.bound);
    const updatePlan = op_plan_event(upd.journal.operationId, f.bound);
    assert.equal(validateRecordTransition(createPlan, updatePlan), undefined);
    const got = f.store.get('rel-1');
    assert.equal(got.sourceRevision, 1);
    assert.equal(got.record.title, 'Release 1.1');
    assert.equal(got.ownership.operations.length, 2);
    // dependsOn removal is visible to derived readiness.
    assert.equal(nextPlanTasks(f.ctx, 'rel-1')
      .find((t) => t.key === 'api').status, 'ready');
    // Second update chains to revision 2.
    const doc2 = getPlan(f.ctx, 'rel-1');
    const upd2 = f.store.update({ key: 'rel-1', expectedRevision: 1,
      plan: { ...doc2, title: 'Release 1.2' } });
    assert.equal(upd2.sourceRevision, 2);
    const got2 = f.store.get('rel-1');
    assert.equal(got2.sourceRevision, 2);
    assert.equal(got2.record.title, 'Release 1.2');
    assert.equal(got2.ownership.operations.length, 3);
  } finally { cleanup(f.dir); }
});

test('stale expectedRevision and byte drift both fail closed', () => {
  const f = fixture();
  try {
    f.store.create({ areaIds: [f.a], plan: GOOD });
    const doc = getPlan(f.ctx, 'rel-1');
    f.store.update({ key: 'rel-1', expectedRevision: 0,
      plan: { ...doc, title: 'Newer' } });
    assert.throws(() => f.store.update({ key: 'rel-1', expectedRevision: 0,
      plan: { ...doc, title: 'Stale write' } }),
      (e) => e.code === 'REVISION_MISMATCH');
    assert.throws(() => f.store.update({ key: 'rel-1',
      expectedRevision: '0', plan: doc }),
      (e) => e.code === 'INVALID_OWNED_PLAN_INPUT');
    // Byte drift between proof and CAS: inject a foreign write under the
    // journal lock acquisition.
    const planAbs = path.join(f.dir, 'docs', 'agent', 'plans', 'rel-1.json');
    const open = fs.openSync;
    fs.openSync = function (file, flags, ...args) {
      const fd = open.call(this, file, flags, ...args);
      if (String(file).endsWith('.lock') && flags === 'wx') {
        fs.writeFileSync(planAbs, JSON.stringify({ ...doc, title: 'Raced' },
          null, 2) + '\n');
      }
      return fd;
    };
    try {
      assert.throws(() => f.store.update({ key: 'rel-1',
        expectedRevision: 1, plan: { ...doc, title: 'CAS loser' } }),
        (e) => e.code === 'JOURNAL_SOURCE_CONFLICT'
          || e.code === 'OWNED_PLAN_SOURCE_CHANGED');
    } finally { fs.openSync = open; }
  } finally { cleanup(f.dir); }
});

test('DAG violations are rejected through the journalized path', () => {
  const f = fixture();
  try {
    assert.throws(() => f.store.create({ areaIds: [f.a], plan: { ...GOOD,
      key: 'cyc', tasks: [
        { key: 'a', title: 't', contract: 'c', dependsOn: ['b'] },
        { key: 'b', title: 't', contract: 'c', dependsOn: ['a'] },
      ] } }), (e) => e.code === 'INVALID_PLAN');
    assert.ok(!exists(f.dir, '.tasksystem/state/journal'));
    f.store.create({ areaIds: [f.a], plan: GOOD });
    const doc = getPlan(f.ctx, 'rel-1');
    const cyclic = { ...doc,
      tasks: doc.tasks.map((t) => t.key === 'base'
        ? { ...t, dependsOn: ['api'] } : t) };
    assert.throws(() => f.store.update({ key: 'rel-1',
      expectedRevision: 0, plan: cyclic }),
      (e) => e.code === 'PLAN_MALFORMED');
    const selfDep = { ...doc,
      tasks: doc.tasks.map((t) => t.key === 'base'
        ? { ...t, dependsOn: ['base'] } : t) };
    assert.throws(() => f.store.update({ key: 'rel-1',
      expectedRevision: 0, plan: selfDep }),
      (e) => e.code === 'PLAN_MALFORMED');
    const ghostDep = { ...doc,
      tasks: doc.tasks.map((t) => t.key === 'api'
        ? { ...t, dependsOn: ['ghost'] } : t) };
    assert.throws(() => f.store.update({ key: 'rel-1',
      expectedRevision: 0, plan: ghostDep }),
      (e) => e.code === 'PLAN_MALFORMED');
    // The failed updates wrote no journal state and changed no bytes.
    const got = f.store.get('rel-1');
    assert.equal(got.sourceRevision, 0);
    const pending = listJournalPending(f.bound);
    assert.equal(
      new Set(pending.items.map((item) => item.operationId)).size, 1);
  } finally { cleanup(f.dir); }
});

test('membership rules: existing task required, ids stable, fields locked', () => {
  const f = fixture();
  try {
    f.store.create({ areaIds: [f.a], plan: GOOD });
    const doc = getPlan(f.ctx, 'rel-1');
    // Add a member bound to an existing task file.
    const extra = createTask(f.ctx, {
      title: 'Extra', contract: 'c', authorContext: 'ctx-a', scope: [] });
    const grown = { ...doc,
      tasks: [...doc.tasks,
        { key: 'extra', id: extra.id, dependsOn: ['base'] }] };
    const upd = f.store.update({
      key: 'rel-1', expectedRevision: 0, plan: grown });
    assert.equal(upd.mode, 'applied');
    assert.equal(f.store.get('rel-1').record.tasks.length, 3);
    // New member must reference a real task file.
    const ghosted = { ...doc,
      tasks: [...doc.tasks,
        { key: 'ghost', id: crypto.randomUUID(), dependsOn: [] }] };
    assert.throws(() => f.store.update({ key: 'rel-1',
      expectedRevision: 1, plan: ghosted }),
      (e) => e.code === 'TASK_NOT_FOUND');
    // A surviving key cannot be rebound to a different task id.
    const rebound = { ...doc,
      tasks: doc.tasks.map((t) => t.key === 'base'
        ? { ...t, id: extra.id } : t) };
    assert.throws(() => f.store.update({ key: 'rel-1',
      expectedRevision: 1, plan: rebound }),
      (e) => e.code === 'INVALID_OWNED_PLAN_INPUT');
    // Immutable provenance fields.
    for (const mutated of [
      { ...doc, createdAt: '2099-01-01T00:00:00.000Z' },
      { ...doc, key: 'other-key' },
      { ...doc, inputDigest: 'f'.repeat(64) },
      { ...doc, schemaVersion: 2 },
      { ...doc, authorContext: 'other-author' },
      { ...doc, specId: crypto.randomUUID() },
      { ...doc, designId: crypto.randomUUID() },
    ]) {
      assert.throws(() => f.store.update({ key: 'rel-1',
        expectedRevision: 1, plan: mutated }),
        (e) => e.code === 'INVALID_OWNED_PLAN_INPUT'
          || e.code === 'PLAN_MALFORMED');
    }
    // Byte-identical update is an unchanged no-op: no journal op.
    const before = f.store.get('rel-1');
    const noop = f.store.update({ key: 'rel-1',
      expectedRevision: 1, plan: getPlan(f.ctx, 'rel-1') });
    assert.equal(noop.mode, 'unchanged');
    assert.equal(f.store.get('rel-1').sourceRevision,
      before.sourceRevision);
  } finally { cleanup(f.dir); }
});

test('unowned and forged records are never adopted', () => {
  const f = fixture();
  try {
    // Legacy plan without sidecar: never adopted.
    applyPlan(f.dir, preflightPlan(f.dir, preparePlan(f.ctx,
      { ...GOOD, key: 'legacy' }).files));
    assert.throws(() => f.store.get('legacy'),
      (e) => e.code === 'OWNED_PLAN_NOT_FOUND');
    // Sidecar copied from a real owned plan still names the wrong record.
    f.store.create({ areaIds: [f.a], plan: GOOD });
    applyPlan(f.dir, preflightPlan(f.dir, preparePlan(f.ctx,
      { ...GOOD, key: 'forged' }).files));
    fs.copyFileSync(
      path.join(f.dir, '.tasksystem/state/plan-ownership/rel-1.json'),
      path.join(f.dir, '.tasksystem/state/plan-ownership/forged.json'));
    assert.throws(() => f.store.get('forged'),
      (e) => e.code === 'OWNED_PLAN_MALFORMED');
    // Sidecar naming a nonexistent operation: fail closed.
    const fake = readJson(f.dir,
      '.tasksystem/state/plan-ownership/rel-1.json');
    fake.recordId = 'forged';
    fake.operations = [crypto.randomUUID()];
    fake.operationId = fake.operations[0];
    writeJson(f.dir, '.tasksystem/state/plan-ownership/forged.json', fake);
    assert.throws(() => f.store.get('forged'),
      (e) => ['JOURNAL_NOT_FOUND', 'OWNED_PLAN_MALFORMED',
        'OWNED_PLAN_NOT_COMMITTED'].includes(e.code));
    // Raw non-journal edit of the plan doc: detected as changed source.
    const doc = getPlan(f.ctx, 'rel-1');
    writeJson(f.dir, 'docs/agent/plans/rel-1.json',
      { ...doc, title: 'Foreign write' });
    assert.throws(() => f.store.get('rel-1'),
      (e) => e.code === 'OWNED_PLAN_SOURCE_CHANGED');
    // A stale sidecar file (rolled back bytes) is equally detected.
    writeJson(f.dir, 'docs/agent/plans/rel-1.json', doc);
    const sidecar = readJson(f.dir,
      '.tasksystem/state/plan-ownership/rel-1.json');
    writeJson(f.dir, '.tasksystem/state/plan-ownership/rel-1.json',
      { ...sidecar, sourceRevision: 9 });
    assert.throws(() => f.store.get('rel-1'),
      (e) => ['OWNED_PLAN_MALFORMED', 'JOURNAL_NOT_FOUND',
        'OWNED_PLAN_NOT_COMMITTED'].includes(e.code));
  } finally { cleanup(f.dir); }
});

test('scope is all-of and immutable: narrow grants cannot read or update', () => {
  const f = fixture();
  try {
    const narrow = createOwnedPlanStore(f.ctx, { areaIds: [f.a] });
    assert.throws(() => narrow.create({ areaIds: [f.a, f.b], plan: GOOD }),
      (e) => e.code === 'SCOPE_DENIED');
    f.store.create({ areaIds: [f.a, f.b], plan: GOOD });
    assert.throws(() => narrow.get('rel-1'),
      (e) => e.code === 'SCOPE_DENIED');
    const doc = getPlan(f.ctx, 'rel-1');
    assert.throws(() => narrow.update({ key: 'rel-1', expectedRevision: 0,
      plan: { ...doc, title: 'denied' } }),
      (e) => e.code === 'SCOPE_DENIED');
  } finally { cleanup(f.dir); }
});

test('uncertain receipt: apply failure preserves the prepared operation', () => {
  const f = fixture();
  const open = fs.openSync;
  const planAbs = path.join(f.dir, 'docs', 'agent', 'plans', 'rel-1.json');
  try {
    fs.openSync = function (file, flags, ...args) {
      if (String(file) === planAbs && flags === 'wx') {
        const error = new Error('fixture apply failure');
        error.code = 'EIO';
        throw error;
      }
      return open.call(this, file, flags, ...args);
    };
    const created = f.store.create({ areaIds: [f.a], plan: GOOD });
    fs.openSync = open;
    assert.equal(created.mode, 'applied');
    assert.equal(created.ownershipConfirmed, false);
    assert.equal(created.journal.status, 'unconfirmed');
    assert.equal(created.journal.journalState, 'prepared');
    assert.equal(created.journal.pendingMemory, true);
    assert.ok(created.journal.cause);
    const loaded = getJournalOperation(f.bound, created.journal.operationId);
    assert.equal(loaded.state, 'prepared');
    // No sidecar was applied: the record cannot be proven.
    assert.throws(() => f.store.get('rel-1'),
      (e) => e.code === 'OWNED_PLAN_NOT_FOUND');
    // The journal blocks further writes until explicit recovery.
    assert.throws(() => f.store.create({ areaIds: [f.a],
      plan: { ...GOOD, key: 'rel-2' } }),
      (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    const done = recoverJournalOperation(f.bound, created.journal.operationId, {
      action: 'abandon-prepared',
      expectedIntentDigest: loaded.intentDigest,
      reason: 'fixture cleanup decision',
    });
    assert.equal(done.state, 'abandoned');
    const retry = f.store.create({ areaIds: [f.a],
      plan: { ...GOOD, key: 'rel-2' } });
    assert.equal(retry.ownershipConfirmed, true);
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('V2 formal plan: coverage and member refs enforced on update', () => {
  const f = fixture();
  try {
    const { input } = formalFixture(f);
    const created = f.store.create({ areaIds: [f.a], plan: input });
    assert.equal(created.ownershipConfirmed, true);
    const doc = getPlan(f.ctx, 'v2-plan');
    // Removing the only member breaks scenario coverage: rejected.
    const hollow = { ...doc, tasks: [] };
    assert.throws(() => f.store.update({ key: 'v2-plan',
      expectedRevision: 0, plan: hollow }),
      (e) => ['PLAN_MALFORMED', 'INVALID_PLAN',
        'INVALID_OWNED_PLAN_INPUT'].includes(e.code));
    // A member without matching formal refs is rejected.
    const light = createTask(f.ctx, {
      title: 'Light task', contract: 'c', authorContext: 'ctx-a', scope: [] });
    const alien = { ...doc,
      tasks: [...doc.tasks,
        { key: 'alien', id: light.id, dependsOn: [] }] };
    assert.throws(() => f.store.update({ key: 'v2-plan',
      expectedRevision: 0, plan: alien }),
      (e) => e.code === 'PLAN_MEMBERSHIP_INVALID');
    // A member that exists but was not created for this plan key fails too.
    const t2 = createTask(f.ctx, {
      title: 'Other formal', contract: 'c', authorContext: 'ctx-a',
      scope: ['src/a'], specId: input.specId, designId: input.designId,
      scenarioRefs: [{ requirementId: 'R1', scenarioId: 'S1' }] });
    const wrongPlan = { ...doc,
      tasks: [...doc.tasks, { key: 't2', id: t2.id, dependsOn: [] }] };
    assert.throws(() => f.store.update({ key: 'v2-plan',
      expectedRevision: 0, plan: wrongPlan }),
      (e) => e.code === 'PLAN_MEMBERSHIP_INVALID');
  } finally { cleanup(f.dir); }
});

test('get validates ids and stays structural-only for readiness', () => {
  const f = fixture();
  try {
    for (const bad of ['', 'Bad Key', 'a/b', null, 7]) {
      assert.throws(() => f.store.get(bad),
        (e) => e.code === 'INVALID_OWNED_PLAN_INPUT');
    }
    assert.throws(() => f.store.get('missing'),
      (e) => e.code === 'OWNED_PLAN_NOT_FOUND');
    for (const bad of [
      {}, { key: 'rel-1' },
      { key: 'rel-1', expectedRevision: 0 },
      { key: 'rel-1', expectedRevision: 0, plan: {}, extra: 1 },
    ]) {
      assert.throws(() => f.store.update(bad),
        (e) => e.code === 'INVALID_OWNED_PLAN_INPUT');
    }
  } finally { cleanup(f.dir); }
});

function op_plan_event(operationId, bound) {
  const op = getJournalOperation(bound, operationId);
  return op.intent.events.find((e) => e.sourceKind === 'plan');
}

test('update events carry CAS fields and chain to the create op', () => {
  const f = fixture();
  try {
    const created = f.store.create({ areaIds: [f.a], plan: GOOD });
    const doc = getPlan(f.ctx, 'rel-1');
    const upd = f.store.update({ key: 'rel-1', expectedRevision: 0,
      plan: { ...doc, title: 'v1' } });
    const createdOp = getJournalOperation(f.bound, created.journal.operationId);
    const updateOp = getJournalOperation(f.bound, upd.journal.operationId);
    assert.equal(updateOp.intent.events[0].journalSequence, 3);
    assert.equal(updateOp.intent.events[1].journalSequence, 4);
    const planUpdate = updateOp.intent.events
      .find((e) => e.sourceKind === 'plan');
    const createEvent = createdOp.intent.events
      .find((e) => e.sourceKind === 'plan');
    assert.equal(planUpdate.previousHash, createEvent.sourceHash);
    const { event } = getJournalEvent(f.bound, upd.journal.operationId,
      planUpdate.eventId);
    assert.equal(event.operation, 'update');
  } finally { cleanup(f.dir); }
});
