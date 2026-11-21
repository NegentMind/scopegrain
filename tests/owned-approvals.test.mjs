// SPDX-License-Identifier: Apache-2.0
// Owned approval store: journal-backed mutable ownership for the
// content-addressed approval ledger. Question create = strict 2-event
// create op + rev0 sidecar; answers = CAS update ops (previousHash +
// expected revision) that advance record and sidecar tip together;
// get proves sidecar + create/update event chain + current bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import { getJournalOperation, recoverJournalOperation }
  from '../src/core/journal.mjs';
import { resultingSourceRevision, validateRecordTransition }
  from '../src/core/record-history.mjs';
import { prepareSpecification } from '../src/core/specifications.mjs';
import {
  createOwnedApprovalStore, describeApprovalTarget, prepareApproval,
} from '../src/core/approvals.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, writeFile, writeJson }
  from './helpers.mjs';

const sha256 = (bytes) =>
  crypto.createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

const SPEC = {
  originalRequest: 'verbatim request for owned approvals tests',
  title: 'Spec',
  outcome: { statement: 'o', evidencePlan: 'e' },
  requirements: [{ id: 'R1', statement: 's',
    scenarios: [{ id: 'S1', given: 'g', when: 'w', then: 't' }] }],
  scope: ['src/x'], constraints: [], nonGoals: [], openQuestions: [],
  references: [],
};

function fixture({ decisions = 'docs/agent/decisions',
  state = '.tasksystem/state', configRel = '.tasksystem/config.json' } = {}) {
  const dir = makeTempDir('ownedapp');
  const answers = { ...VALID_ANSWERS,
    paths: { ...VALID_ANSWERS.paths, decisions, state } };
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
    betaBound: bindWorkspace(ctx, { areaIds: [b] }),
    make: (overrides = {}) => createOwnedApprovalStore(ctx,
      { areaIds: [a, b], ...overrides }),
    decisions, state,
    journal: path.join(dir, ...state.split('/'), 'journal'),
  };
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

function makeTarget(ctx, dir, overrides = {}) {
  const p = prepareSpecification(ctx, { ...SPEC, ...overrides });
  applyPlan(dir, [p.file]);
  return describeApprovalTarget(ctx,
    { kind: 'artifact', artifactKind: 'spec', id: p.artifact.id }).target;
}

function input(f, overrides = {}) {
  return { areaIds: [f.a, f.b], target: f.target, ...overrides };
}

function answer(f, id, rev, digest, extra = {}) {
  return { id, answer: 'approve', expectedRevision: rev,
    expectedTargetDigest: digest, actor: 'tester', ...extra };
}

function sourceRel(f, id) {
  return `${f.decisions}/approvals/${id}.json`;
}

function ownershipRel(f, id) {
  return `${f.state}/record-ownership/approval/${id}.json`;
}

function scopeOf(f, areaIds) {
  return { workspaceId: f.bound.workspaceId, projectId: f.bound.projectId,
    repositoryId: f.bound.repositoryId, areaIds: [...areaIds].sort() };
}

test('store surface: frozen {prepare,create,get,answer}; closed options rejected', () => {
  const f = fixture();
  try {
    const store = f.make();
    assert.equal(Object.isFrozen(store), true);
    assert.deepEqual(Object.keys(store).sort(),
      ['answer', 'create', 'get', 'prepare']);
    for (const bad of [null, {}, { areaIds: [f.a], origin: 'local-cli' },
      { areaIds: [f.a, f.b], extra: 1 }, { areaIds: [] },
      { areaIds: ['x'] }, { areaIds: [f.a, f.a] }, { areaIds: 'x' }]) {
      assert.throws(() => createOwnedApprovalStore(f.ctx, bad),
        (e) => e.code === 'INVALID_OWNED_APPROVAL_INPUT');
    }
    assert.throws(() => createOwnedApprovalStore(f.ctx,
      { areaIds: ['99999999-9999-9999-9999-999999999999'] }),
      (e) => e.code === 'SCOPE_DENIED');
    for (const badCtx of [null, { projectRoot: f.dir },
      { config: f.ctx.config }]) {
      assert.throws(() => createOwnedApprovalStore(badCtx, { areaIds: [f.a] }),
        (e) => e.code === 'INVALID_OWNED_APPROVAL_INPUT');
    }
  } finally { cleanup(f.dir); }
});

test('unenrolled workspace and stale bindings are denied', () => {
  const dir = makeTempDir('ownedapp-nowork');
  try {
    const answers = { ...VALID_ANSWERS };
    writeJson(dir, '.tasksystem/config.json', createConfig(dir, answers, {}));
    const ctx = resolveContext({ project: dir });
    assert.throws(() => createOwnedApprovalStore(ctx,
      { areaIds: [crypto.randomUUID()] }),
      (e) => e.code === 'WORKSPACE_NOT_FOUND'
        || e.code === 'SCOPE_DENIED');
  } finally { cleanup(dir); }
  const f = fixture();
  try {
    const store = f.make();
    fs.unlinkSync(path.join(f.dir, f.state, 'workspace.json'));
    assert.throws(() => store.create({ areaIds: [f.a],
      target: makeTarget(f.ctx, f.dir) }),
      (e) => e.code === 'WORKSPACE_STALE');
  } finally { cleanup(f.dir); }
});

test('closed input rejects extra keys, bad areas and bad ids before any write', () => {
  const f = fixture();
  try {
    f.target = makeTarget(f.ctx, f.dir);
    const store = f.make();
    const target = makeTarget(f.ctx, f.dir, { title: 'other' });
    const before = tree(f.dir);
    for (const bad of [null, [], 'x', input(f, { extra: 1 }),
      { target }, { areaIds: [f.a] }, input(f, { areaIds: [] }),
      input(f, { areaIds: ['x'] }), input(f, { areaIds: [f.a, f.a] }),
      input(f, { areaIds: [f.a], target: null }),
      input(f, { areaIds: [f.a], target: { ...target, extra: 1 } })]) {
      for (const fn of [() => store.create(bad), () => store.prepare(bad)]) {
        assert.throws(fn, (e) => e.code !== 'OK' && e.code !== undefined);
      }
    }
    assert.throws(() => store.prepare({ areaIds: [f.a], recordId: f.a }),
      (e) => e.code === 'INVALID_OWNED_APPROVAL_INPUT');
    assert.throws(() => store.prepare({ areaIds: [f.a],
      target: { kind: 'bogus', id: f.a, digest: 'a'.repeat(64) } }),
      (e) => e.code === 'APPROVAL_INVALID');
    for (const bad of ['x', 'A'.repeat(64), 1, null, undefined]) {
      assert.throws(() => store.get(bad),
        (e) => e.code === 'INVALID_OWNED_APPROVAL_INPUT');
    }
    for (const bad of [null, {}, { ...answer(f, 'a'.repeat(64), 0,
      'a'.repeat(64)), extra: 1 }]) {
      assert.throws(() => store.answer(bad),
        (e) => e.code === 'INVALID_OWNED_APPROVAL_INPUT');
    }
    assert.throws(() => store.answer(answer(f, 'zz', 0, 'a'.repeat(64))),
      (e) => e.code === 'APPROVAL_INVALID'
        || e.code === 'INVALID_OWNED_APPROVAL_INPUT');
    assert.deepEqual(tree(f.dir), before);
  } finally { cleanup(f.dir); }
});

test('prepare is a read-only dry-run with deterministic id and no writes', () => {
  const f = fixture();
  try {
    f.target = makeTarget(f.ctx, f.dir);
    const store = f.make();
    const before = tree(f.dir);
    const first = store.prepare(input(f));
    const second = store.prepare(input(f));
    assert.equal(first.mode, 'dry-run');
    assert.equal(first.reservesIds, false);
    assert.equal(first.record.id, first.record.target.digest);
    assert.equal(first.record.id, second.record.id); // content-addressed
    assert.equal(first.record.status, 'pending');
    assert.equal(first.record.revision, 0);
    assert.equal(first.sourceRel, sourceRel(f, first.record.id));
    assert.equal(first.ownershipRel, ownershipRel(f, first.record.id));
    assert.deepEqual(tree(f.dir), before);
  } finally { cleanup(f.dir); }
});

test('create commits a scoped 2-event op + rev0 sidecar; get proves the question', () => {
  const f = fixture();
  try {
    f.target = makeTarget(f.ctx, f.dir);
    const store = f.make();
    const created = store.create(input(f));
    assert.equal(created.mode, 'applied');
    assert.equal(created.ownershipConfirmed, true);
    assert.equal(created.journal.status, 'committed');
    assert.equal(created.journal.journalState, 'confirmed');
    assert.equal(created.journal.eventIds.length, 2);
    const record = created.record;
    assert.equal(record.status, 'pending');
    assert.equal(record.revision, 0);
    assert.equal(record.id, record.target.digest);
    assert.equal(created.sourceRel, sourceRel(f, record.id));
    assert.equal(created.ownershipRel, ownershipRel(f, record.id));
    const sourceBytes = fs.readFileSync(
      path.join(f.dir, ...created.sourceRel.split('/')));
    assert.deepEqual(JSON.parse(sourceBytes.toString('utf8')), record);
    const ownership = JSON.parse(fs.readFileSync(
      path.join(f.dir, ...created.ownershipRel.split('/')), 'utf8'));
    assert.equal(ownership.sourceKind, 'approval');
    assert.equal(ownership.recordId, record.id);
    assert.equal(ownership.sourceRevision, 0);
    assert.equal(ownership.sourceRel, created.sourceRel);
    assert.equal(ownership.sourceHash, sha256(sourceBytes));
    assert.equal(ownership.operationId, created.journal.operationId);
    assert.deepEqual(ownership.chain, [created.journal.operationId]);
    assert.deepEqual(ownership.scope, scopeOf(f, [f.a, f.b]));
    assert.equal(ownership.createdAt, record.createdAt);
    const op = getJournalOperation(f.bound, created.journal.operationId);
    assert.equal(op.state, 'committed');
    assert.equal(op.intent.events.length, 2);
    const kinds = op.intent.events.map((e) => e.sourceKind).sort();
    assert.deepEqual(kinds, ['approval', 'record-ownership']);
    for (const event of op.intent.events) {
      assert.equal(event.recordId, record.id);
      assert.equal(event.sourceRevision, 0);
      assert.equal(event.operation, 'create');
      assert.equal(event.createdAt, record.createdAt);
      assert.deepEqual(event.areaIds, [f.a, f.b].sort());
    }
    const got = store.get(record.id);
    assert.equal(got.isCurrentSource, true);
    assert.equal(got.memoryConsulted, false);
    assert.deepEqual(got.record, record);
    assert.deepEqual(got.ownership, ownership);
    assert.equal(got.locator.operationId, created.journal.operationId);
    assert.equal(got.locator.eventId,
      op.intent.events.find((e) => e.sourceKind === 'approval').eventId);
  } finally { cleanup(f.dir); }
});

test('answer commits a CAS update advancing record and sidecar; chain proven', () => {
  const f = fixture();
  try {
    f.target = makeTarget(f.ctx, f.dir);
    const store = f.make();
    const created = store.create(input(f));
    const id = created.record.id;
    const rev0Bytes = fs.readFileSync(
      path.join(f.dir, ...created.sourceRel.split('/')));
    const answered = store.answer(answer(f, id, 0,
      created.record.target.digest));
    assert.equal(answered.mode, 'applied');
    assert.equal(answered.ownershipConfirmed, true);
    assert.equal(answered.journal.status, 'committed');
    assert.equal(answered.journal.eventIds.length, 2);
    assert.equal(answered.record.revision, 1);
    assert.equal(answered.record.status, 'approved');
    assert.equal(answered.record.updatedAt,
      getJournalOperation(f.bound, answered.journal.operationId)
        .intent.createdAt);
    // Revoke from approved advances the chain once more.
    const revoked = store.answer(answer(f, id, 1,
      created.record.target.digest,
      { answer: 'revoke', comment: 'superseded' }));
    assert.equal(revoked.record.revision, 2);
    assert.equal(revoked.record.status, 'revoked');
    const sidecar = JSON.parse(fs.readFileSync(
      path.join(f.dir, ...created.ownershipRel.split('/')), 'utf8'));
    assert.equal(sidecar.sourceRevision, 2);
    assert.equal(sidecar.operationId, revoked.journal.operationId);
    assert.equal(sidecar.createdAt,
      getJournalOperation(f.bound, revoked.journal.operationId)
        .intent.createdAt);
    const rev2Bytes = fs.readFileSync(
      path.join(f.dir, ...created.sourceRel.split('/')));
    assert.equal(sidecar.sourceHash, sha256(rev2Bytes));
    assert.deepEqual(sidecar.chain, [created.journal.operationId,
      answered.journal.operationId, revoked.journal.operationId]);
    // Update ops carry two update events each, chained per file series.
    const createOp = getJournalOperation(f.bound, created.journal.operationId);
    const createApproval = createOp.intent.events
      .find((e) => e.sourceKind === 'approval');
    const createSidecar = createOp.intent.events
      .find((e) => e.sourceKind === 'record-ownership');
    assert.equal(createApproval.sourceHash, sha256(rev0Bytes));
    let prevApproval = createApproval;
    let prevSidecar = createSidecar;
    for (const opId of [answered.journal.operationId,
      revoked.journal.operationId]) {
      const op = getJournalOperation(f.bound, opId);
      assert.equal(op.intent.events.length, 2);
      const app = op.intent.events.find((e) => e.sourceKind === 'approval');
      const own = op.intent.events
        .find((e) => e.sourceKind === 'record-ownership');
      assert.equal(app.operation, 'update');
      assert.equal(own.operation, 'update');
      assert.equal(validateRecordTransition(prevApproval, app), undefined);
      assert.equal(validateRecordTransition(prevSidecar, own), undefined);
      prevApproval = app;
      prevSidecar = own;
    }
    assert.equal(resultingSourceRevision(prevApproval), 2);
    const got = store.get(id);
    assert.equal(got.isCurrentSource, true);
    assert.equal(got.record.revision, 2);
    assert.equal(got.record.status, 'revoked');
    assert.equal(got.ownership.operationId, revoked.journal.operationId);
    assert.equal(got.locator.operationId, revoked.journal.operationId);
    assert.equal(got.locator.eventId, prevApproval.eventId);
  } finally { cleanup(f.dir); }
});

test('second answer from the same revision is a journal CAS conflict', () => {
  const f = fixture();
  try {
    f.target = makeTarget(f.ctx, f.dir);
    const store = f.make();
    const created = store.create(input(f));
    const id = created.record.id;
    const digest = created.record.target.digest;
    store.answer(answer(f, id, 0, digest));
    // Same claimed base revision: the declared previousHash is stale
    // vs current bytes -> closed conflict, no journal state consumed.
    assert.throws(() => store.answer(answer(f, id, 0, digest,
      { answer: 'reject', comment: 'late veto' })),
      (e) => e.code === 'JOURNAL_SOURCE_CONFLICT');
    const got = store.get(id);
    assert.equal(got.record.revision, 1);
    assert.equal(got.record.status, 'approved');
    // A fabricated future revision has no proven hash to claim.
    assert.throws(() => store.answer(answer(f, id, 5, digest,
      { answer: 'reject', comment: 'future' })),
      (e) => e.code === 'REVISION_MISMATCH');
    assert.equal(store.get(id).record.revision, 1);
  } finally { cleanup(f.dir); }
});

test('domain rules are preserved: digest, revoke gating, comments, openQuestions', () => {
  const f = fixture();
  try {
    f.target = makeTarget(f.ctx, f.dir);
    const store = f.make();
    const created = store.create(input(f));
    const id = created.record.id;
    const digest = created.record.target.digest;
    assert.throws(() => store.answer(answer(f, id, 0, 'f'.repeat(64))),
      (e) => e.code === 'APPROVAL_STALE_TARGET');
    assert.throws(() => store.answer(answer(f, id, 0, digest,
      { answer: 'revoke', comment: 'x' })),
      (e) => e.code === 'APPROVAL_INVALID');
    assert.throws(() => store.answer(answer(f, id, 0, digest,
      { actor: '  ' })), (e) => e.code === 'APPROVAL_INVALID');
    assert.throws(() => store.answer(answer(f, id, 0, digest,
      { answer: 'bogus' })), (e) => e.code === 'APPROVAL_INVALID');
    const got = store.get(id);
    assert.equal(got.record.status, 'pending');
    const answered = store.answer(answer(f, id, 0, digest));
    assert.equal(answered.record.status, 'approved');
    // Re-answer on non-pending requires a comment.
    assert.throws(() => store.answer(answer(f, id, 1, digest,
      { answer: 'custom' })), (e) => e.code === 'APPROVAL_INVALID');
    // Spec openQuestions block approve only.
    const qTarget = makeTarget(f.ctx, f.dir,
      { title: 'with-open-questions', openQuestions: ['open q'] });
    const q = store.create({ areaIds: [f.a], target: qTarget });
    assert.throws(() => store.answer(answer(f, q.record.id, 0,
      q.record.target.digest)),
      (e) => e.code === 'APPROVAL_OPEN_QUESTIONS');
    const rej = store.answer(answer(f, q.record.id, 0,
      q.record.target.digest, { answer: 'reject', comment: 'no' }));
    assert.equal(rej.record.status, 'rejected');
  } finally { cleanup(f.dir); }
});

test('tampered source, sidecar and snapshots fail closed', () => {
  const f = fixture();
  try {
    f.target = makeTarget(f.ctx, f.dir);
    const store = f.make();
    const created = store.create(input(f));
    const id = created.record.id;
    const srcAbs = path.join(f.dir, ...created.sourceRel.split('/'));
    const ownAbs = path.join(f.dir, ...created.ownershipRel.split('/'));
    const srcBytes = fs.readFileSync(srcAbs);
    const ownBytes = fs.readFileSync(ownAbs);
    fs.appendFileSync(srcAbs, ' ');
    assert.throws(() => store.get(id),
      (e) => e.code === 'OWNED_APPROVAL_SOURCE_CHANGED');
    fs.writeFileSync(srcAbs, srcBytes);
    assert.equal(store.get(id).isCurrentSource, true);
    fs.writeFileSync(ownAbs, json({ ...JSON.parse(ownBytes.toString('utf8')),
      sourceHash: 'b'.repeat(64) }));
    assert.throws(() => store.get(id),
      (e) => e.code === 'OWNED_APPROVAL_MALFORMED');
    fs.unlinkSync(ownAbs);
    assert.throws(() => store.get(id),
      (e) => e.code === 'OWNED_APPROVAL_NOT_FOUND');
    fs.writeFileSync(ownAbs, ownBytes);
    assert.equal(store.get(id).isCurrentSource, true);
    fs.unlinkSync(srcAbs);
    assert.throws(() => store.get(id),
      (e) => e.code === 'OWNED_APPROVAL_NOT_FOUND');
    fs.writeFileSync(srcAbs, srcBytes);
    assert.equal(store.get(id).isCurrentSource, true);
    const snapRel = path.join(f.journal, 'snapshots',
      `${sha256(srcBytes)}.blob`);
    const snapBytes = fs.readFileSync(snapRel);
    fs.appendFileSync(snapRel, Buffer.from([0]));
    assert.throws(() => store.get(id),
      (e) => e.code === 'JOURNAL_SNAPSHOT_MISMATCH');
    fs.writeFileSync(snapRel, snapBytes);
    fs.unlinkSync(snapRel);
    assert.throws(() => store.get(id),
      (e) => e.code === 'JOURNAL_SNAPSHOT_MISSING');
  } finally { cleanup(f.dir); }
});

test('unowned approvals are never adopted or proven', () => {
  const f = fixture();
  try {
    f.target = makeTarget(f.ctx, f.dir);
    // Legacy path: same record bytes, no sidecar, no journal op.
    const prepared = prepareApproval(f.ctx, { target: f.target });
    applyPlan(f.dir, [prepared.file]);
    const store = f.make();
    const id = prepared.approval.id;
    assert.throws(() => store.get(id),
      (e) => e.code === 'OWNED_APPROVAL_NOT_FOUND');
    // Owned create on an existing source is a closed conflict, never
    // adoption: differing bytes -> PLAN_CONFLICT at preflight; identical
    // bytes -> JOURNAL_SOURCE_CONFLICT (record creation is all-new).
    assert.throws(() => store.create(input(f)),
      (e) => ['PLAN_CONFLICT', 'JOURNAL_SOURCE_CONFLICT'].includes(e.code));
    // A forged sidecar without a journal operation is not proof.
    const forged = 'a'.repeat(64);
    writeJson(f.dir, ownershipRel(f, forged), {
      schemaVersion: 1, sourceKind: 'approval', recordId: forged,
      sourceRevision: 0, sourceRel: sourceRel(f, forged),
      sourceHash: 'c'.repeat(64), operationId: crypto.randomUUID(),
      scope: scopeOf(f, [f.a]),
      createdAt: '2026-11-17T00:00:00.000Z',
      chain: [crypto.randomUUID()] });
    assert.throws(() => store.get(forged),
      (e) => ['JOURNAL_NOT_FOUND', 'OWNED_APPROVAL_MALFORMED',
        'OWNED_APPROVAL_NOT_COMMITTED'].includes(e.code));
  } finally { cleanup(f.dir); }
});

test('enrollment and all-of scope enforcement on create/answer/get', () => {
  const f = fixture();
  try {
    f.target = makeTarget(f.ctx, f.dir);
    const alpha = f.make({ areaIds: [f.a] });
    assert.throws(() => alpha.create(input(f)),
      (e) => e.code === 'SCOPE_DENIED');
    const created = alpha.create({ areaIds: [f.a], target: f.target });
    const id = created.record.id;
    const digest = created.record.target.digest;
    const both = f.make();
    const shared = both.create({ areaIds: [f.a, f.b],
      target: makeTarget(f.ctx, f.dir, { title: 'shared' }) });
    const beta = createOwnedApprovalStore(f.ctx, { areaIds: [f.b] });
    // Narrower grant cannot read or answer a broader-scope record.
    assert.throws(() => beta.get(id), (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => alpha.get(shared.record.id),
      (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => alpha.answer(answer(f, shared.record.id, 0,
      shared.record.target.digest)), (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => beta.answer(answer(f, id, 0, digest)),
      (e) => e.code === 'SCOPE_DENIED');
    // Matching grants work end to end.
    assert.equal(alpha.get(id).isCurrentSource, true);
    const answered = alpha.answer(answer(f, id, 0, digest));
    assert.equal(answered.record.status, 'approved');
    assert.equal(alpha.get(id).record.revision, 1);
  } finally { cleanup(f.dir); }
});

test('uncertain receipts: unconfirmed ops and removed commit markers fail closed', () => {
  const f = fixture();
  try {
    f.target = makeTarget(f.ctx, f.dir);
    const store = f.make();
    const created = store.create(input(f));
    const id = created.record.id;
    // Removing the commit marker makes the owning op non-committed.
    const commitAbs = path.join(f.journal, 'operations',
      created.journal.operationId, 'commit.json');
    fs.unlinkSync(commitAbs);
    assert.throws(() => store.get(id),
      (e) => e.code === 'OWNED_APPROVAL_NOT_COMMITTED');
    const loaded = getJournalOperation(f.bound, created.journal.operationId);
    recoverJournalOperation(f.bound, created.journal.operationId, {
      action: 'abandon-prepared', expectedIntentDigest: loaded.intentDigest,
      reason: 'test abandonment' });
    assert.throws(() => store.get(id),
      (e) => e.code === 'OWNED_APPROVAL_NOT_COMMITTED');
  } finally { cleanup(f.dir); }
  const g = fixture();
  try {
    g.target = makeTarget(g.ctx, g.dir);
    const store = g.make();
    const created = store.create({ areaIds: [g.a], target: g.target });
    const id = created.record.id;
    const digest = created.record.target.digest;
    // An update whose apply phase fails stays unconfirmed; the last
    // committed tip remains provable and the journal blocks new writes.
    const open = fs.openSync;
    fs.openSync = function (file, flags, ...args) {
      if (flags === 'wx' && String(file).includes('.upd-')) {
        throw Object.assign(new Error('update apply failed'),
          { code: 'EIO' });
      }
      return open.call(this, file, flags, ...args);
    };
    let result;
    try {
      result = store.answer(answer(g, id, 0, digest));
    } finally { fs.openSync = open; }
    assert.equal(result.journal.status, 'unconfirmed');
    assert.equal(result.journal.journalState, 'prepared');
    assert.equal(result.ownershipConfirmed, false);
    assert.equal(store.get(id).record.revision, 0);
    assert.throws(() => store.answer(answer(g, id, 0, digest)),
      (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    const loaded = getJournalOperation(g.bound, result.journal.operationId);
    const done = recoverJournalOperation(g.bound,
      result.journal.operationId, {
        action: 'abandon-prepared',
        expectedIntentDigest: loaded.intentDigest,
        reason: 'test abandonment' });
    assert.equal(done.state, 'abandoned');
    const next = store.answer(answer(g, id, 0, digest));
    assert.equal(next.record.revision, 1);
    assert.equal(store.get(id).record.status, 'approved');
  } finally { cleanup(g.dir); }
});

test('a forged chain inside genuine committed proof is malformed', () => {
  const f = fixture();
  try {
    f.target = makeTarget(f.ctx, f.dir);
    const store = f.make();
    const created = store.create(input(f));
    const id = created.record.id;
    const ownAbs = path.join(f.dir, ...created.ownershipRel.split('/'));
    const ownership = JSON.parse(fs.readFileSync(ownAbs, 'utf8'));
    const mutate = (patch) => {
      fs.writeFileSync(ownAbs, json({ ...ownership, ...patch }));
      assert.throws(() => store.get(id),
        (e) => ['OWNED_APPROVAL_MALFORMED',
          'JOURNAL_NOT_FOUND'].includes(e.code));
    };
    mutate({ recordId: 'b'.repeat(64) });
    mutate({ sourceRel: 'other/path.json' });
    mutate({ sourceHash: 'b'.repeat(64) });
    mutate({ sourceRevision: 1 });
    mutate({ chain: [crypto.randomUUID()] });
    mutate({ chain: [created.journal.operationId, crypto.randomUUID()] });
    mutate({ operationId: crypto.randomUUID() });
    mutate({ scope: scopeOf(f, [f.a]) });
    fs.writeFileSync(ownAbs, json(ownership));
    assert.equal(store.get(id).isCurrentSource, true);
    // A sidecar write that stays consistent vs the snapshot but forges
    // the approval document itself: rewrite source bytes so the tip
    // comparison fails, never silently reinterpreted.
    const srcAbs = path.join(f.dir, ...created.sourceRel.split('/'));
    fs.writeFileSync(srcAbs, json({ ...created.record, status: 'approved' }));
    assert.throws(() => store.get(id),
      (e) => e.code === 'OWNED_APPROVAL_SOURCE_CHANGED');
  } finally { cleanup(f.dir); }
});
