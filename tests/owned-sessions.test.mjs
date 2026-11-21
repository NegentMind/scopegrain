// SPDX-License-Identifier: Apache-2.0
// Owned-session store: opt-in journal-backed mutable ownership over the
// strict create/update seams. Session open = one 2-event create op
// (session source + session-ownership sidecar at rev0); each registered
// operation = one 2-event CAS update op. get/resume prove the sidecar,
// the create/update chain and the current bytes. Legacy session path is
// byte-identical and never adopted.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan, preflightPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import {
  applyJournaledRecordUpdate, getJournalOperation,
  recoverJournalOperation,
} from '../src/core/journal.mjs';
import { validateRecordTransition } from '../src/core/record-history.mjs';
import { createOwnedSessionStore } from '../src/core/sessions.mjs';
import { getSession, prepareSession } from '../src/core/sessions.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, writeFile, writeJson }
  from './helpers.mjs';

const sha256 = (bytes) =>
  crypto.createHash('sha256').update(bytes).digest('hex');

function fixture({ state = '.tasksystem/state',
  configRel = '.tasksystem/config.json' } = {}) {
  const dir = makeTempDir('ownedsess');
  const answers = { ...VALID_ANSWERS, paths: { ...VALID_ANSWERS.paths, state } };
  writeJson(dir, configRel, createConfig(dir, answers, {}));
  const ctx = resolveContext({ project: dir, config: configRel });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  const bound = bindWorkspace(ctx, { areaIds: [a, b] });
  const alphaBound = bindWorkspace(ctx, { areaIds: [a] });
  const task = createTask(ctx, {
    title: 'T', contract: 'C', authorContext: 'a', scope: [],
  });
  const make = (overrides = {}) =>
    createOwnedSessionStore(ctx, { areaIds: [a, b], ...overrides });
  return {
    dir, ctx, a, b, bound, alphaBound, task, state,
    make: () => make(),
    makeWith: make,
    journal: path.join(dir, ...state.split('/'), 'journal'),
  };
}

function openIn(f, overrides = {}) {
  return { areaIds: [f.a, f.b],
    session: { taskId: f.task.id, limit: 3 }, ...overrides };
}

function recordIn(f, id, expectedRevision, action = 'read', overrides = {}) {
  return { areaIds: [f.a, f.b],
    record: { id, expectedRevision, action, evidence: 'ev', ...overrides } };
}

function tree(dir) {
  const values = {};
  function visit(root, rel = '') {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(root, entry.name);
      if (entry.isDirectory()) { values[next] = 'directory'; visit(abs, next); }
      else values[next] = fs.readFileSync(abs);
    }
  }
  if (fs.existsSync(dir)) visit(dir);
  return values;
}

function scopeOf(f, areaIds) {
  return { workspaceId: f.bound.workspaceId, projectId: f.bound.projectId,
    repositoryId: f.bound.repositoryId, areaIds: [...areaIds].sort() };
}

test('store is frozen with the owned method set; closed options and cloned ctx', () => {
  const f = fixture();
  try {
    const options = { areaIds: [f.a, f.b] };
    const store = createOwnedSessionStore(f.ctx, options);
    assert.equal(Object.isFrozen(store), true);
    assert.deepEqual(Object.keys(store).sort(),
      ['create', 'get', 'prepare', 'prepareRecord', 'record', 'resume']);
    for (const bad of [null, {}, { areaIds: [f.a], origin: 'x' },
      { ...options, extra: 1 }, { areaIds: [] }, { areaIds: ['x'] },
      { areaIds: [f.a, f.a] }]) {
      assert.throws(() => createOwnedSessionStore(f.ctx, bad),
        (e) => e.code === 'INVALID_OWNED_SESSION_INPUT');
    }
    assert.throws(() => createOwnedSessionStore(f.ctx,
      { areaIds: ['99999999-9999-9999-9999-999999999999'] }),
      (e) => e.code === 'SCOPE_DENIED');
    for (const badCtx of [null, { projectRoot: f.dir },
      { config: f.ctx.config }]) {
      assert.throws(() => createOwnedSessionStore(badCtx,
        { areaIds: [f.a] }), (e) => e.code === 'INVALID_OWNED_SESSION_INPUT');
    }
    // Caller mutation after construction cannot alter the store.
    options.areaIds.length = 0;
    f.ctx.config.paths.state = 'redirect/state';
    f.ctx.projectRoot = path.join(f.dir, 'other');
    const created = store.create(openIn(f, { areaIds: [f.a] }));
    assert.equal(created.mode, 'applied');
    assert.equal(fs.existsSync(path.join(f.dir, 'redirect')), false);
  } finally { cleanup(f.dir); }
});

test('non-enrolled workspace and partial grants are denied', () => {
  const dir = makeTempDir('ownedsess-unenrolled');
  try {
    writeJson(dir, '.tasksystem/config.json',
      createConfig(dir, VALID_ANSWERS, {}));
    const ctx = resolveContext({ project: dir });
    assert.throws(() => createOwnedSessionStore(ctx,
      { areaIds: ['11111111-1111-4111-8111-111111111111'] }),
      (e) => e.code === 'WORKSPACE_NOT_FOUND');
  } finally { cleanup(dir); }
  const f = fixture();
  try {
    const alpha = createOwnedSessionStore(f.ctx, { areaIds: [f.a] });
    assert.throws(() => alpha.create(openIn(f)), (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => alpha.prepare(openIn(f)), (e) => e.code === 'SCOPE_DENIED');
  } finally { cleanup(f.dir); }
});

test('open is a 2-event create op at rev0; prepare is read-only and unreserved', () => {
  const f = fixture();
  try {
    const store = f.make();
    const before = tree(f.dir);
    const first = store.prepare(openIn(f));
    const second = store.prepare(openIn(f));
    assert.notEqual(first.record.id, second.record.id);
    assert.equal(first.mode, 'dry-run');
    assert.equal(first.reservesIds, false);
    assert.equal(first.record.used, 0);
    assert.equal(first.record.revision, 0);
    assert.equal(first.sourceRel,
      `${f.state}/sessions/${first.record.id}.json`);
    assert.equal(first.ownershipRel,
      `${f.state}/session-ownership/${first.record.id}.json`);
    assert.deepEqual(tree(f.dir), before);
    const created = store.create(openIn(f));
    assert.equal(created.mode, 'applied');
    assert.equal(created.ownershipConfirmed, true);
    assert.equal(created.journal.status, 'committed');
    assert.equal(created.journal.journalState, 'confirmed');
    assert.equal(created.journal.eventIds.length, 2);
    const record = created.record;
    // Legacy readers can still read the bytes structurally (no ownership implied).
    assert.deepEqual(getSession(f.ctx, record.id), record);
    const sidecar = JSON.parse(fs.readFileSync(
      path.join(f.dir, ...created.ownershipRel.split('/')), 'utf8'));
    assert.equal(sidecar.schemaVersion, 1);
    assert.equal(sidecar.sourceKind, 'session');
    assert.equal(sidecar.recordId, record.id);
    assert.equal(sidecar.sourceRevision, 0);
    assert.equal(sidecar.sourceRel, created.sourceRel);
    assert.equal(sidecar.sourceHash,
      sha256(fs.readFileSync(path.join(f.dir, ...created.sourceRel.split('/')))));
    assert.equal(sidecar.operationId, created.journal.operationId);
    assert.equal(sidecar.createOperationId, created.journal.operationId);
    assert.equal(sidecar.previousOperationId, null);
    assert.equal(sidecar.createdAt, record.createdAt);
    assert.equal(sidecar.updatedAt, record.createdAt);
    assert.deepEqual(sidecar.scope, scopeOf(f, [f.a, f.b]));
    const op = getJournalOperation(f.bound, created.journal.operationId);
    assert.equal(op.state, 'committed');
    assert.equal(op.intent.events.length, 2);
    assert.deepEqual(op.intent.events.map((e) => e.sourceKind).sort(),
      ['session', 'session-ownership']);
    for (const event of op.intent.events) {
      assert.equal(event.operation, 'create');
      assert.equal(event.sourceRevision, 0);
      assert.equal(event.recordId, record.id);
      assert.equal(event.createdAt, record.createdAt);
      assert.deepEqual(event.areaIds, [f.a, f.b].sort());
    }
  } finally { cleanup(f.dir); }
});

test('open + record + resume chain is proven end to end', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(openIn(f));
    const id = created.record.id;
    const dry = store.prepareRecord(recordIn(f, id, 0));
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.record.used, 1);
    assert.equal(dry.reservesIds, false);
    const first = store.record(recordIn(f, id, 0));
    assert.equal(first.journal.status, 'committed');
    assert.equal(first.journal.eventIds.length, 2);
    const second = store.record(recordIn(f, id, 1,
      'research', { context: 'ctx' }));
    assert.equal(second.journal.status, 'committed');
    const got = store.get(id);
    assert.equal(got.isCurrentSource, true);
    assert.equal(got.memoryConsulted, false);
    assert.equal(got.record.used, 2);
    assert.equal(got.record.revision, 2);
    assert.equal(got.record.events.length, 2);
    assert.equal(got.record.events[1].action, 'research');
    assert.equal(got.ownership.sourceRevision, 2);
    assert.equal(got.ownership.operationId, second.journal.operationId);
    assert.equal(got.ownership.previousOperationId, first.journal.operationId);
    assert.equal(got.ownership.createOperationId,
      created.journal.operationId);
    assert.equal(got.locator.operationId, second.journal.operationId);
    // Journal chain coherence on both event streams.
    const ops = [created, first, second].map((r) =>
      getJournalOperation(f.bound, r.journal.operationId));
    for (const op of ops) {
      assert.equal(op.state, 'committed');
      assert.equal(op.intent.events.length, 2);
    }
    const src = (op) => op.intent.events.find(
      (e) => e.sourceKind === 'session');
    const side = (op) => op.intent.events.find(
      (e) => e.sourceKind === 'session-ownership');
    for (let i = 0; i < ops.length - 1; i += 1) {
      assert.doesNotThrow(() =>
        validateRecordTransition(src(ops[i]), src(ops[i + 1])));
      assert.doesNotThrow(() =>
        validateRecordTransition(side(ops[i]), side(ops[i + 1])));
      assert.equal(src(ops[i + 1]).operation, 'update');
      assert.equal(side(ops[i + 1]).operation, 'update');
    }
    // resume over the proven record.
    const resumed = store.resume(id);
    assert.equal(resumed.session.id, id);
    assert.equal(resumed.session.used, 2);
    assert.equal(resumed.task.id, f.task.id);
    assert.equal(resumed.task.state, 'PLAN');
    assert.equal(resumed.usage.remaining, 1);
    assert.equal(resumed.usage.measures,
      'explicitly-recorded-operations-only');
    assert.equal(resumed.recovery.reference, 'references/task-system.md');
    assert.equal(resumed.ownership.sourceRevision, 2);
    assert.equal(resumed.locator.operationId, second.journal.operationId);
  } finally { cleanup(f.dir); }
});

test('budget CAS conflict and denied gates leave bytes and journal untouched', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(openIn(f));
    const id = created.record.id;
    const intentCount = () => Object.keys(tree(f.dir)).filter((rel) =>
      rel.endsWith('intent.json')).length;
    assert.equal(intentCount(), 1);
    // Denied action: 'edit' not allowed in PLAN.
    assert.throws(() => store.record(recordIn(f, id, 0, 'edit')),
      (e) => e.code === 'SESSION_ACTION_DENIED');
    assert.equal(intentCount(), 1);
    // Stale revision after a committed record.
    store.record(recordIn(f, id, 0));
    assert.throws(() => store.record(recordIn(f, id, 0)),
      (e) => e.code === 'REVISION_MISMATCH');
    // Budget exhaustion: limit is 3, use the remaining 2 then fail.
    store.record(recordIn(f, id, 1));
    store.record(recordIn(f, id, 2));
    assert.throws(() => store.record(recordIn(f, id, 3)),
      (e) => e.code === 'SESSION_LIMIT_EXHAUSTED');
    const current = store.get(id);
    assert.equal(current.record.used, 3);
    assert.equal(current.record.revision, 3);
    // Denied inputs never touched the journal (only real ops exist).
    assert.equal(intentCount(), 4); // 1 create + 3 updates only
  } finally { cleanup(f.dir); }
});

test('stale writer between callback and kernel CAS is a clean conflict', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    const store = f.make();
    const created = store.create(openIn(f));
    const id = created.record.id;
    const srcAbs = path.join(f.dir, ...created.sourceRel.split('/'));
    const lockFile = path.join(f.journal, '.lock');
    fs.openSync = function (file, flags, ...args) {
      const fd = open.call(this, file, flags, ...args);
      if (String(file) === lockFile && flags === 'wx') {
        fs.writeFileSync(srcAbs, 'racing bytes');
      }
      return fd;
    };
    assert.throws(() => store.record(recordIn(f, id, 0)),
      (e) => e.code === 'JOURNAL_SOURCE_CONFLICT');
    fs.openSync = open;
    // Racing bytes win outside the journal; proof fails closed.
    assert.equal(fs.readFileSync(srcAbs, 'utf8'), 'racing bytes');
    assert.throws(() => store.get(id),
      (e) => e.code === 'OWNED_SESSION_SOURCE_CHANGED');
    assert.equal(fs.existsSync(path.join(f.journal, 'head.json')), true);
    const head = JSON.parse(
      fs.readFileSync(path.join(f.journal, 'head.json')));
    assert.equal(head.activeOperation, null);
    const intentCount = Object.keys(tree(f.dir)).filter((rel) =>
      rel.endsWith('intent.json')).length;
    assert.equal(intentCount, 1); // conflict consumed no journal state
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('unowned legacy sessions are never adopted', () => {
  const f = fixture();
  try {
    const store = f.make();
    // Legacy create path: no sidecar, no journal op.
    const prepared = prepareSession(f.ctx, { taskId: f.task.id, limit: 3 });
    applyPlan(f.dir, preflightPlan(f.dir, [prepared.file]));
    const legacyId = prepared.session.id;
    assert.throws(() => store.get(legacyId),
      (e) => e.code === 'OWNED_SESSION_NOT_FOUND');
    assert.throws(() => store.resume(legacyId),
      (e) => e.code === 'OWNED_SESSION_NOT_FOUND');
    assert.throws(() => store.record(
      recordIn(f, legacyId, 0)), (e) => e.code === 'OWNED_SESSION_NOT_FOUND');
    // Plausible file + forged sidecar without any journal operation.
    const forged = crypto.randomUUID();
    const forgedOp = crypto.randomUUID();
    writeFile(f.dir, `${f.state}/session-ownership/${forged}.json`,
      JSON.stringify({ schemaVersion: 1, sourceKind: 'session',
        recordId: forged, sourceRevision: 0,
        sourceRel: `${f.state}/sessions/${forged}.json`,
        sourceHash: 'a'.repeat(64), operationId: forgedOp,
        previousOperationId: null, createOperationId: forgedOp,
        scope: scopeOf(f, [f.a, f.b]),
        createdAt: '2026-11-17T00:00:00.000Z',
        updatedAt: '2026-11-17T00:00:00.000Z' }, null, 2) + '\n');
    assert.throws(() => store.get(forged),
      (e) => e.code === 'JOURNAL_NOT_FOUND');
  } finally { cleanup(f.dir); }
});

test('enrollment scope is all-of for open, record and read', () => {
  const f = fixture();
  try {
    const alpha = f.makeWith({ areaIds: [f.a] });
    const both = f.make();
    const alphaOwned = alpha.create({ areaIds: [f.a],
      session: { taskId: f.task.id, limit: 2 } });
    const shared = both.create(openIn(f));
    // alpha-granted store cannot read/record the [a,b]-scoped session.
    assert.throws(() => alpha.get(shared.record.id),
      (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => alpha.record(
      { areaIds: [f.a, f.b], record: { id: shared.record.id,
        expectedRevision: 0, action: 'read', evidence: 'e' } }),
      (e) => e.code === 'SCOPE_DENIED');
    // Recording with a scope that is not the enrolled scope fails.
    assert.throws(() => both.record(
      { areaIds: [f.a], record: { id: shared.record.id,
        expectedRevision: 0, action: 'read', evidence: 'e' } }),
      (e) => e.code === 'INVALID_OWNED_SESSION_INPUT');
    // Alpha session records fine under its own scope.
    const next = alpha.record({ areaIds: [f.a],
      record: { id: alphaOwned.record.id, expectedRevision: 0,
        action: 'read', evidence: 'e' } });
    assert.equal(next.record.revision, 1);
    assert.equal(alpha.get(alphaOwned.record.id).isCurrentSource, true);
    const beta = createOwnedSessionStore(f.ctx, { areaIds: [f.b] });
    assert.throws(() => beta.get(alphaOwned.record.id),
      (e) => e.code === 'SCOPE_DENIED');
    // Strict UUID on the read/record/resume entry points.
    for (const bad of ['x', 'ABCDEF12-3456-4789-8ABC-DEF012345678', 1, null]) {
      assert.throws(() => both.get(bad),
        (e) => e.code === 'INVALID_OWNED_SESSION_INPUT');
      assert.throws(() => both.resume(bad),
        (e) => e.code === 'INVALID_OWNED_SESSION_INPUT');
    }
  } finally { cleanup(f.dir); }
});

test('uncertain create receipt is preserved and denied until explicit recovery', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    const store = f.make();
    fs.openSync = function (file, flags, ...args) {
      if (flags === 'wx' && String(file).includes('session-ownership')
          && !String(file).includes('journal')) {
        throw Object.assign(new Error('sidecar write failed'),
          { code: 'EIO' });
      }
      return open.call(this, file, flags, ...args);
    };
    let result;
    try {
      result = store.create(openIn(f, { areaIds: [f.a] }));
    } finally { fs.openSync = open; }
    assert.equal(result.mode, 'applied');
    assert.equal(result.journal.status, 'unconfirmed');
    assert.equal(result.journal.journalState, 'prepared');
    assert.equal(result.ownershipConfirmed, false);
    assert.equal(result.journal.eventIds.length, 2);
    assert.notEqual(result.journal.cause, null);
    // Sidecar absent -> not found; further ops blocked by the active op.
    assert.throws(() => store.get(result.record.id),
      (e) => e.code === 'OWNED_SESSION_NOT_FOUND');
    assert.throws(() => store.create(openIn(f, { areaIds: [f.a] })),
      (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    const loaded = getJournalOperation(f.bound, result.journal.operationId);
    const done = recoverJournalOperation(f.bound,
      result.journal.operationId, {
        action: 'abandon-prepared',
        expectedIntentDigest: loaded.intentDigest,
        reason: 'test abandonment' });
    assert.equal(done.state, 'abandoned');
    // Partial source remains but is never adopted.
    assert.throws(() => store.get(result.record.id),
      (e) => e.code === 'OWNED_SESSION_NOT_FOUND');
    const retry = store.create(openIn(f, { areaIds: [f.a] }));
    assert.equal(retry.journal.status, 'committed');
    assert.equal(retry.ownershipConfirmed, true);
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('drift outside the journal breaks the proof closed', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(openIn(f));
    const id = created.record.id;
    store.record(recordIn(f, id, 0));
    const srcAbs = path.join(f.dir, ...created.sourceRel.split('/'));
    const ownAbs = path.join(f.dir, ...created.ownershipRel.split('/'));
    const srcBytes = fs.readFileSync(srcAbs);
    const ownBytes = fs.readFileSync(ownAbs);
    fs.writeFileSync(srcAbs, JSON.stringify(
      { ...JSON.parse(srcBytes.toString('utf8')), limit: 99 }, null, 2) + '\n');
    assert.throws(() => store.get(id),
      (e) => e.code === 'OWNED_SESSION_SOURCE_CHANGED');
    fs.writeFileSync(srcAbs, srcBytes);
    fs.writeFileSync(ownAbs, ' ');
    assert.throws(() => store.get(id),
      (e) => e.code === 'OWNED_SESSION_MALFORMED');
    fs.writeFileSync(ownAbs, ownBytes);
    assert.equal(store.get(id).isCurrentSource, true);
    // A direct journaled update bypassing the store also breaks the proof.
    const updated = applyJournaledRecordUpdate(f.bound, () => [{
      sourceKind: 'session', recordId: id, sourceRevision: 1,
      previousHash: sha256(srcBytes), areaIds: [f.a, f.b],
      file: { rel: created.sourceRel,
        content: `${srcBytes.toString('utf8')} ` } }]);
    assert.equal(updated.status, 'committed');
    assert.throws(() => store.get(id),
      (e) => e.code === 'OWNED_SESSION_SOURCE_CHANGED');
  } finally { cleanup(f.dir); }
});

test('closed inputs reject injected keys and wrong shapes before any write', () => {
  const f = fixture();
  try {
    const store = f.make();
    const before = tree(f.dir);
    for (const bad of [null, [], 'x', { areaIds: [f.a] },
      openIn(f, { extra: 1 }),
      { areaIds: [f.a], session: 'x' },
      openIn(f, { areaIds: [] }), openIn(f, { areaIds: ['x'] }),
      openIn(f, { areaIds: [f.a, f.a] })]) {
      for (const fn of [() => store.create(bad), () => store.prepare(bad)]) {
        assert.throws(fn, (e) => e.code !== 'OK' && e.code !== undefined);
      }
    }
    const created = store.create(openIn(f));
    const id = created.record.id;
    for (const bad of [
      { areaIds: [f.a], record: { id, expectedRevision: 0, action: 'read',
        evidence: 'e', bogus: 1 } },
      { areaIds: [f.a], record: { id, expectedRevision: -1, action: 'read',
        evidence: 'e' } },
      { areaIds: [f.a], record: { id, expectedRevision: 0, action: 'nope',
        evidence: 'e' } },
      { areaIds: [f.a], record: { id, expectedRevision: 0, action: 'read' } },
      { areaIds: [f.a], record: { id: 'x', expectedRevision: 0, action: 'read',
        evidence: 'e' } },
      { areaIds: [f.a], record: { id: id.toUpperCase(), expectedRevision: 0,
        action: 'read', evidence: 'e' } },
    ]) {
      for (const fn of [() => store.record(bad), () => store.prepareRecord(bad)]) {
        assert.throws(fn, (e) => e.code !== 'OK' && e.code !== undefined);
      }
    }
    assert.equal(store.get(id).record.revision, 0);
    const after = tree(f.dir);
    const createdOps = Object.keys(after).filter((rel) =>
      rel.endsWith('intent.json'));
    assert.equal(createdOps.length, 1); // only the create op exists
    void before;
  } finally { cleanup(f.dir); }
});
