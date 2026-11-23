// SPDX-License-Identifier: Apache-2.0
// Bound capture store: typed note + ownership companion created through the
// strict journal seam and proven by a committed two-event operation.
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
import { applyJournaledCreation, applyJournaledRecordCreation,
  getJournalOperation, recoverJournalOperation }
  from '../src/core/journal.mjs';
import { validateCaptureNote, validateCaptureOwnership } from '../src/core/capture-data.mjs';
import { createCaptureStore } from '../src/core/captures.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, readJson, trySymlink, writeFile,
  writeJson } from './helpers.mjs';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

function fixture({ state = '.scopegrain/state', memory = '.scopegrain/memory',
  configRel = '.scopegrain/config.json' } = {}) {
  const dir = makeTempDir('captures');
  const answers = { ...VALID_ANSWERS, paths: { ...VALID_ANSWERS.paths, state, memory } };
  writeJson(dir, configRel, createConfig(dir, answers, {}));
  const ctx = resolveContext({ project: dir, config: configRel });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  const bound = bindWorkspace(ctx, { areaIds: [a, b] });
  const alphaBound = bindWorkspace(ctx, { areaIds: [a] });
  const make = (overrides = {}) => createCaptureStore(ctx,
    { areaIds: [a, b], origin: 'local-cli', ...overrides });
  return {
    dir, ctx, a, b, bound, alphaBound, make, memory, state,
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

function input(overrides = {}) {
  return { category: 'event', title: 'T', summary: 'S', areaIds: undefined,
    ...overrides };
}

function owned(store, f, overrides = {}) {
  return store.create(input({ areaIds: [f.a, f.b], ...overrides }));
}

test('store is frozen with only prepare/create/get; options and ctx mutations cannot redirect it', () => {
  const f = fixture();
  try {
    const options = { areaIds: [f.a, f.b], origin: 'local-cli' };
    const store = createCaptureStore(f.ctx, options);
    assert.equal(Object.isFrozen(store), true);
    assert.deepEqual(Object.keys(store).sort(), ['create', 'get', 'prepare']);
    for (const bad of [null, { areaIds: [f.a] }, { origin: 'x' },
      { ...options, extra: 1 }, { ...options, origin: 'Bad Origin' }]) {
      assert.throws(() => createCaptureStore(f.ctx, bad),
        (e) => e.code === 'INVALID_CAPTURE_INPUT');
    }
    options.areaIds.length = 0;
    f.ctx.config.paths.memory = 'redirect/memory';
    f.ctx.projectRoot = path.join(f.dir, 'other');
    const result = store.create(input({ areaIds: [f.a] }));
    assert.equal(result.status, undefined);
    assert.equal(result.mode, 'applied');
    assert.equal(result.sourceRel,
      `${f.memory}/captures/${result.record.id}.json`);
    assert.equal(fs.existsSync(path.join(f.dir, 'redirect/memory')), false);
    f.ctx.projectRoot = f.dir;
  } finally { cleanup(f.dir); }
});

test('all nine categories create exact two-event proof and get returns the proven current record', () => {
  const f = fixture();
  try {
    const store = f.make();
    for (const category of ['decision', 'event', 'attempt', 'discard', 'preference',
      'tool', 'skill', 'stack', 'lesson']) {
      const in_ = input({ areaIds: [f.b, f.a], title: '  literal title  ' });
      in_.category = category;
      if (category === 'preference') in_.subjectId = 'subject-1';
      const created = store.create(in_);
      assert.equal(created.mode, 'applied');
      assert.equal(created.ownershipConfirmed, true);
      assert.equal(created.journal.status, 'committed');
      assert.equal(created.journal.journalState, 'confirmed');
      assert.equal(created.journal.eventIds.length, 2);
      const record = created.record;
      assert.equal(record.schemaVersion, 1);
      assert.equal(record.kind, 'scopegrain.capture');
      assert.equal(record.revision, 0);
      assert.equal(record.category, category);
      assert.equal(record.title, '  literal title  ');
      assert.equal(record.basis ?? record.provenance?.basis, 'inferred');
      assert.equal(record.provenance.basis, 'inferred');
      assert.equal(record.provenance.origin, 'local-cli');
      assert.equal(record.subjectId, category === 'preference' ? 'subject-1' : null);
      assert.equal(record.supersedes, null);
      assert.deepEqual(record.scope, {
        workspaceId: f.bound.workspaceId, projectId: f.bound.projectId,
        repositoryId: f.bound.repositoryId, areaIds: [f.a, f.b].sort(),
      });
      const sourceRel = `${f.memory}/captures/${record.id}.json`;
      const ownershipRel = `${f.state}/record-ownership/capture/${record.id}.json`;
      assert.equal(created.sourceRel, sourceRel);
      assert.equal(created.ownershipRel, ownershipRel);
      const sourceBytes = fs.readFileSync(path.join(f.dir, ...sourceRel.split('/')));
      const ownershipBytes = fs.readFileSync(path.join(f.dir, ...ownershipRel.split('/')));
      assert.deepEqual(JSON.parse(sourceBytes.toString('utf8')), record);
      const ownership = JSON.parse(ownershipBytes.toString('utf8'));
      assert.doesNotThrow(() => validateCaptureNote(record));
      assert.doesNotThrow(() => validateCaptureOwnership(ownership));
      assert.equal(ownership.recordId, record.id);
      assert.equal(ownership.sourceRel, sourceRel);
      assert.equal(ownership.sourceHash, sha256(sourceBytes));
      assert.equal(ownership.operationId, created.journal.operationId);
      assert.equal(ownership.createdAt, record.capturedAt);
      assert.deepEqual(ownership.scope, record.scope);
      const op = getJournalOperation(f.bound, created.journal.operationId);
      assert.equal(op.state, 'committed');
      assert.equal(op.intent.events.length, 2);
      const kinds = op.intent.events.map((e) => e.sourceKind).sort();
      assert.deepEqual(kinds, ['capture', 'record-ownership']);
      for (const event of op.intent.events) {
        assert.equal(event.recordId, record.id);
        assert.equal(event.sourceRevision, 0);
        assert.equal(event.operation, 'create');
        assert.equal(event.createdAt, record.capturedAt);
        assert.deepEqual(event.areaIds, [f.a, f.b].sort());
      }
      const got = store.get(record.id);
      assert.deepEqual(got, {
        record, ownership, locator: { operationId: created.journal.operationId,
          eventId: op.intent.events.find((e) => e.sourceKind === 'capture').eventId },
        isCurrentSource: true, memoryConsulted: false,
      });
    }
  } finally { cleanup(f.dir); }
});

test('prepare is a read-only dry-run with provisional identity', () => {
  const f = fixture();
  try {
    const store = f.make();
    const before = tree(f.dir);
    const preview = store.prepare(input({ areaIds: [f.a], basis: 'declared',
      subjectId: null }));
    assert.deepEqual(Object.keys(preview).sort(),
      ['mode', 'ownershipRel', 'record', 'reservesIds', 'sourceRel']);
    assert.equal(preview.mode, 'dry-run');
    assert.equal(preview.reservesIds, false);
    assert.equal(preview.record.basis ?? preview.record.provenance.basis, 'declared');
    assert.match(preview.record.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(preview.sourceRel, `${f.memory}/captures/${preview.record.id}.json`);
    assert.equal(preview.ownershipRel,
      `${f.state}/record-ownership/capture/${preview.record.id}.json`);
    assert.doesNotThrow(() => validateCaptureNote(preview.record));
    assert.deepEqual(tree(f.dir), before);
    const created = owned(store, f);
    const afterCreate = tree(f.dir);
    const linked = store.prepare(input({ areaIds: [f.a, f.b],
      supersedes: created.record.id }));
    assert.equal(linked.record.supersedes, created.record.id);
    assert.throws(() => store.prepare(input({ areaIds: [f.a],
      supersedes: '99999999-9999-9999-9999-999999999999' })),
      (e) => e.code === 'CAPTURE_NOT_FOUND');
    assert.deepEqual(tree(f.dir), afterCreate);
  } finally { cleanup(f.dir); }
});

test('invalid, decorated and oversized input is rejected before any write', () => {
  const f = fixture();
  try {
    const store = f.make();
    const before = tree(f.dir);
    const getter = input({ areaIds: [f.a] });
    Object.defineProperty(getter, 'title', { enumerable: true, get() { return 'x'; } });
    const oversized = input({ areaIds: [f.a],
      title: 'x'.repeat(loadLimits().maxDocumentBytes) });
    for (const bad of [null, [], getter, input({ areaIds: [f.a], extra: 1 }),
      input({ areaIds: [] }), input({ areaIds: ['x'] }),
      input({ areaIds: [f.a], title: ' ' }),
      input({ areaIds: [f.a], category: 'other' }),
      input({ areaIds: [f.a], supersedes: 'x' }),
      input({ areaIds: [f.a], category: 'preference' })]) {
      for (const fn of [() => store.create(bad), () => store.prepare(bad)]) {
        assert.throws(fn, (e) => e.code === 'INVALID_CAPTURE_INPUT');
      }
    }
    for (const fn of [() => store.create(oversized), () => store.prepare(oversized)]) {
      assert.throws(fn, (e) => e.code === 'DOCUMENT_TOO_LARGE');
    }
    assert.deepEqual(tree(f.dir), before);
  } finally { cleanup(f.dir); }
});

test('all-of grants apply to create and read; separate scopes stay separate', () => {
  const f = fixture();
  try {
    const alpha = f.make({ areaIds: [f.a] });
    const denied = input({ areaIds: [f.a, f.b] });
    assert.throws(() => alpha.create(denied), (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => alpha.prepare(denied), (e) => e.code === 'SCOPE_DENIED');
    const ownedAlpha = alpha.create(input({ areaIds: [f.a] }));
    const both = f.make();
    const shared = both.create(input({ areaIds: [f.a, f.b] }));
    assert.throws(() => alpha.get(shared.record.id), (e) => e.code === 'SCOPE_DENIED');
    const beta = createCaptureStore(f.ctx, { areaIds: [f.b], origin: 'local-cli' });
    assert.throws(() => beta.get(ownedAlpha.record.id), (e) => e.code === 'SCOPE_DENIED');
    assert.equal(alpha.get(ownedAlpha.record.id).isCurrentSource, true);
    assert.throws(() => f.make({ areaIds: ['99999999-9999-9999-9999-999999999999'] }),
      (e) => e.code === 'SCOPE_DENIED');
    for (const badCtx of [null, { projectRoot: f.dir }, { config: f.ctx.config }]) {
      assert.throws(() => createCaptureStore(badCtx,
        { areaIds: [f.a], origin: 'o' }), (e) => e.code === 'INVALID_CAPTURE_INPUT');
    }
  } finally { cleanup(f.dir); }
});

test('supersession requires same category, subject and exact areas; inferred never supersedes declared preference', () => {
  const f = fixture();
  try {
    const store = f.make();
    const first = owned(store, f);
    const sourceAbs = path.join(f.dir, ...first.sourceRel.split('/'));
    const bytes = fs.readFileSync(sourceAbs);
    const next = owned(store, f, { supersedes: first.record.id });
    assert.equal(next.record.supersedes, first.record.id);
    assert.equal(fs.readFileSync(sourceAbs).equals(bytes), true);
    for (const bad of [
      input({ areaIds: [f.a, f.b], category: 'decision',
        supersedes: first.record.id }),
      input({ areaIds: [f.a], supersedes: first.record.id }),
      input({ areaIds: [f.a, f.b], subjectId: 's-1',
        supersedes: first.record.id }),
    ]) {
      assert.throws(() => store.create(bad),
        (e) => e.code === 'CAPTURE_SUPERSESSION_CONFLICT');
    }
    assert.throws(() => store.create(input({ areaIds: [f.a, f.b],
      supersedes: '99999999-9999-9999-9999-999999999999' })),
      (e) => e.code === 'CAPTURE_NOT_FOUND');
    const declaredPref = store.create(input({ areaIds: [f.a, f.b],
      category: 'preference', subjectId: 'me', basis: 'declared' }));
    assert.throws(() => store.create(input({ areaIds: [f.a, f.b],
      category: 'preference', subjectId: 'me', supersedes: declaredPref.record.id })),
      (e) => e.code === 'CAPTURE_SUPERSESSION_CONFLICT');
    const override = store.create(input({ areaIds: [f.a, f.b],
      category: 'preference', subjectId: 'me', basis: 'declared',
      supersedes: declaredPref.record.id }));
    assert.equal(override.record.supersedes, declaredPref.record.id);
    const inferredPref = store.create(input({ areaIds: [f.a, f.b],
      category: 'preference', subjectId: 'me' }));
    const promote = store.create(input({ areaIds: [f.a, f.b],
      category: 'preference', subjectId: 'me', basis: 'declared',
      supersedes: inferredPref.record.id }));
    assert.equal(promote.record.supersedes, inferredPref.record.id);
    const other = owned(store, f, { category: 'tool', subjectId: null });
    assert.throws(() => store.create(input({ areaIds: [f.a, f.b],
      category: 'tool', subjectId: 'x', supersedes: other.record.id })),
      (e) => e.code === 'CAPTURE_SUPERSESSION_CONFLICT');
  } finally { cleanup(f.dir); }
});

test('unowned files, uncommitted and abandoned operations are not owned', () => {
  const f = fixture();
  try {
    const store = f.make();
    const forged = crypto.randomUUID();
    const sourceRel = `${f.memory}/captures/${forged}.json`;
    const ownershipRel = `${f.state}/record-ownership/capture/${forged}.json`;
    const fakeNote = { schemaVersion: 1, kind: 'scopegrain.capture', id: forged,
      revision: 0, category: 'event', title: 'T', summary: 'S',
      scope: { workspaceId: f.bound.workspaceId, projectId: f.bound.projectId,
        repositoryId: f.bound.repositoryId, areaIds: [f.a] },
      provenance: { basis: 'inferred', origin: 'local-cli' },
      subjectId: null, supersedes: null, capturedAt: '2026-11-16T10:00:00.000Z' };
    writeFile(f.dir, sourceRel, json(fakeNote));
    writeJson(f.dir, ownershipRel, { schemaVersion: 1, sourceKind: 'capture',
      recordId: forged, sourceRevision: 0, sourceRel,
      sourceHash: sha256(Buffer.from(json(fakeNote))),
      operationId: crypto.randomUUID(),
      scope: fakeNote.scope, createdAt: fakeNote.capturedAt });
    assert.throws(() => store.get(forged), (e) => e.code === 'JOURNAL_NOT_FOUND');
    const created = owned(store, f);
    const commitAbs = path.join(f.journal, 'operations',
      created.journal.operationId, 'commit.json');
    fs.unlinkSync(commitAbs);
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'CAPTURE_NOT_COMMITTED');
    const op = getJournalOperation(f.bound, created.journal.operationId);
    recoverJournalOperation(f.bound, created.journal.operationId, {
      action: 'abandon-prepared', expectedIntentDigest: op.intentDigest,
      reason: 'test abandonment' });
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'CAPTURE_NOT_COMMITTED');
  } finally { cleanup(f.dir); }
});

test('forged sidecars, wrong companion events and mismatched proofs are malformed', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = owned(store, f);
    const ownRel = `${f.state}/record-ownership/capture/${created.record.id}.json`;
    const ownAbs = path.join(f.dir, ...ownRel.split('/'));
    const ownership = JSON.parse(fs.readFileSync(ownAbs, 'utf8'));
    const mutate = (patch) => {
      fs.writeFileSync(ownAbs, json({ ...ownership, ...patch }));
      assert.throws(() => store.get(created.record.id),
        (e) => e.code === 'CAPTURE_MALFORMED');
    };
    mutate({ recordId: crypto.randomUUID() });
    mutate({ sourceRel: 'other/path.json' });
    mutate({ sourceHash: 'b'.repeat(64) });
    mutate({ createdAt: '2026-11-16T10:00:00.001Z' });
    fs.writeFileSync(ownAbs, json(ownership));
    assert.equal(store.get(created.record.id).isCurrentSource, true);
    // A committed single-event operation is not two-event proof.
    const single = applyJournaledCreation(f.bound, [{ sourceKind: 'capture',
      recordId: created.record.id, sourceRevision: 0, areaIds: [f.a],
      file: { rel: `${f.memory}/captures/${crypto.randomUUID()}.json`,
        content: json(created.record) } }]);
    assert.equal(single.status, 'committed');
    fs.writeFileSync(ownAbs, json({ ...ownership, operationId: single.operationId }));
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'CAPTURE_MALFORMED');
    // A two-event operation with the wrong companion kind is not proof.
    const bogus = applyJournaledCreation(f.bound, [
      { sourceKind: 'capture', recordId: created.record.id, sourceRevision: 0,
        areaIds: [f.a],
        file: { rel: `${f.memory}/captures/${crypto.randomUUID()}.json`,
          content: json(created.record) } },
      { sourceKind: 'task', recordId: created.record.id, sourceRevision: 0,
        areaIds: [f.a], file: { rel: `${f.state}/record-ownership/capture/${crypto.randomUUID()}.json`,
          content: json(ownership) } }]);
    assert.equal(bogus.status, 'committed');
    fs.writeFileSync(ownAbs, json({ ...ownership, operationId: bogus.operationId }));
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'CAPTURE_MALFORMED');
  } finally { cleanup(f.dir); }
});

test('current source drift, missing, non-regular and oversized reads fail closed', (t) => {
  const f = fixture();
  try {
    const store = f.make();
    const created = owned(store, f);
    const srcAbs = path.join(f.dir, ...created.sourceRel.split('/'));
    const bytes = fs.readFileSync(srcAbs);
    fs.writeFileSync(srcAbs, json({ ...created.record, title: 'drifted' }));
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'CAPTURE_SOURCE_CHANGED');
    fs.unlinkSync(srcAbs);
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'CAPTURE_NOT_FOUND');
    fs.mkdirSync(srcAbs, { recursive: true });
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'CAPTURE_SOURCE_CHANGED');
    fs.rmSync(srcAbs, { recursive: true });
    const target = makeTempDir('capture-source-target');
    try {
      writeFile(target, 'target.json', bytes);
      if (trySymlink(path.join(target, 'target.json'), srcAbs)) {
        assert.throws(() => store.get(created.record.id),
          (e) => e.code === 'SYMLINK_REJECTED');
      }
      fs.rmSync(srcAbs, { force: true });
      fs.writeFileSync(srcAbs, Buffer.alloc(loadLimits().maxDocumentBytes + 1));
      assert.throws(() => store.get(created.record.id),
        (e) => e.code === 'DOCUMENT_TOO_LARGE');
      fs.writeFileSync(srcAbs, bytes);
      assert.equal(store.get(created.record.id).isCurrentSource, true);
    } finally { cleanup(target); }
    const snapRel = path.join(f.journal, 'snapshots', `${sha256(bytes)}.blob`);
    fs.unlinkSync(snapRel);
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'JOURNAL_SNAPSHOT_MISSING');
  } finally { cleanup(f.dir); }
});

test('sidecar drift, missing and non-regular files fail without returning history', (t) => {
  const f = fixture();
  try {
    const store = f.make();
    const created = owned(store, f);
    const ownAbs = path.join(f.dir, ...created.ownershipRel.split('/'));
    const bytes = fs.readFileSync(ownAbs);
    fs.appendFileSync(ownAbs, ' ');
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'CAPTURE_MALFORMED');
    fs.unlinkSync(ownAbs);
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'CAPTURE_NOT_FOUND');
    fs.mkdirSync(ownAbs, { recursive: true });
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'CAPTURE_MALFORMED');
    fs.rmSync(ownAbs, { recursive: true });
    const target = makeTempDir('capture-sidecar-target');
    try {
      writeFile(target, 'target.json', bytes);
      if (trySymlink(path.join(target, 'target.json'), ownAbs)) {
        assert.throws(() => store.get(created.record.id),
          (e) => e.code === 'SYMLINK_REJECTED');
      }
    } finally { cleanup(target); }
  } finally { cleanup(f.dir); }
});

function afterOutboxPersisted(callback) {
  const open = fs.openSync;
  const close = fs.closeSync;
  let fd = null;
  fs.openSync = function (file, flags, ...args) {
    const result = open.call(this, file, flags, ...args);
    if (String(file).includes(`${path.sep}outbox${path.sep}`) && flags === 'wx') fd = result;
    return result;
  };
  fs.closeSync = function (value) {
    const result = close.call(this, value);
    if (value === fd) {
      fd = null;
      callback();
    }
    return result;
  };
  return () => { fs.openSync = open; fs.closeSync = close; };
}

test('prepare rejects unsafe destinations and stays read-only', (t) => {
  const f = fixture();
  try {
    const store = f.make();
    writeFile(f.dir, `${f.memory}/captures`, 'block');
    assert.throws(() => store.prepare(input({ areaIds: [f.a] })),
      (e) => e.code === 'FILE_ANCESTOR');
    fs.rmSync(path.join(f.dir, ...`${f.memory}/captures`.split('/')));
    const target = makeTempDir('capture-dest-target');
    try {
      if (!trySymlink(target,
        path.join(f.dir, ...f.state.split('/'), 'record-ownership'))) {
        t.skip('directory junctions unavailable');
        return;
      }
      assert.throws(() => store.prepare(input({ areaIds: [f.a] })),
        (e) => e.code === 'SYMLINK_REJECTED');
      assert.deepEqual(fs.readdirSync(target), []);
      assert.equal(fs.existsSync(
        path.join(f.dir, f.memory, 'captures')), false);
    } finally { cleanup(target); }
  } finally { cleanup(f.dir); }
});

test('get revalidates the binding before reading the current source', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = owned(store, f);
    const srcAbs = path.join(f.dir, ...created.sourceRel.split('/'));
    const hash = sha256(fs.readFileSync(srcAbs));
    const wsAbs = path.join(f.dir, f.state, 'workspace.json');
    const open = fs.openSync;
    const close = fs.closeSync;
    let snapshotFd = null;
    let sourceOpened = false;
    fs.openSync = function (file, flags, ...args) {
      if (String(file) === srcAbs) sourceOpened = true;
      const result = open.call(this, file, flags, ...args);
      if (String(file).endsWith(`${path.sep}${hash}.blob`)) snapshotFd = result;
      return result;
    };
    fs.closeSync = function (value) {
      const result = close.call(this, value);
      if (value === snapshotFd) {
        snapshotFd = null;
        const workspace = JSON.parse(fs.readFileSync(wsAbs, 'utf8'));
        workspace.revision = (workspace.revision ?? 0) + 1;
        fs.writeFileSync(wsAbs, JSON.stringify(workspace, null, 2) + '\n');
      }
      return result;
    };
    try {
      assert.throws(() => store.get(created.record.id),
        (e) => e.code === 'WORKSPACE_STALE');
    } finally { fs.openSync = open; fs.closeSync = close; }
    assert.equal(sourceOpened, false);
  } finally { cleanup(f.dir); }
});

// Genuine two-event committed proof whose internal contract is forged in
// exactly one place per variant: current bytes equal the snapshots, so only
// the cross-record checks can reject it.
function fakePair(f, mutate) {
  let recordId;
  const result = applyJournaledRecordCreation(f.bound, (identity) => {
    recordId = crypto.randomUUID();
    const sourceRel = `${f.memory}/captures/${recordId}.json`;
    const ownershipRel = `${f.state}/record-ownership/capture/${recordId}.json`;
    const scopeV = { workspaceId: f.bound.workspaceId,
      projectId: f.bound.projectId, repositoryId: f.bound.repositoryId,
      areaIds: [f.a, f.b].sort() };
    const note = { schemaVersion: 1, kind: 'scopegrain.capture', id: recordId,
      revision: 0, category: 'event', title: 'T', summary: 'S', scope: scopeV,
      provenance: { basis: 'inferred', origin: 'local-cli' }, subjectId: null,
      supersedes: null, capturedAt: identity.createdAt };
    const sourceBytes = Buffer.from(JSON.stringify(note, null, 2) + '\n', 'utf8');
    const ownership = { schemaVersion: 1, sourceKind: 'capture', recordId,
      sourceRevision: 0, sourceRel, sourceHash: sha256(sourceBytes),
      operationId: identity.operationId, scope: scopeV,
      createdAt: identity.createdAt };
    const pair = mutate({ note, ownership, sourceBytes, sourceRel,
      ownershipRel, scopeV });
    return [
      { sourceKind: 'capture', recordId, sourceRevision: 0, areaIds: [f.a, f.b],
        file: { rel: pair.sourceRel, content: pair.sourceBytes } },
      { sourceKind: 'record-ownership', recordId, sourceRevision: 0,
        areaIds: [f.a, f.b],
        file: { rel: pair.ownershipRel,
          content: Buffer.from(JSON.stringify(pair.ownership, null, 2) + '\n', 'utf8') } },
    ];
  });
  assert.equal(result.status, 'committed');
  assert.equal(result.journalState, 'confirmed');
  return { recordId, operationId: result.operationId };
}

test('single forged contracts inside genuine committed proof are malformed', () => {
  const f = fixture();
  try {
    const store = f.make();
    for (const mutate of [
      // Sidecar hash disagrees with the capture event hash.
      (p) => ({ ...p, ownership: { ...p.ownership, sourceHash: 'c'.repeat(64) } }),
      // Note scope disagrees with the authorized event/sidecar scope.
      (p) => { const note = { ...p.note, scope: { ...p.scopeV, areaIds: [f.a] } };
        const sourceBytes = Buffer.from(JSON.stringify(note, null, 2) + '\n', 'utf8');
        return { ...p, note, sourceBytes,
          ownership: { ...p.ownership, sourceHash: sha256(sourceBytes) } }; },
      // Note capture time disagrees with the event time.
      (p) => { const note = { ...p.note, capturedAt: '2020-01-01T00:00:00.000Z' };
        const sourceBytes = Buffer.from(JSON.stringify(note, null, 2) + '\n', 'utf8');
        return { ...p, note, sourceBytes,
          ownership: { ...p.ownership, sourceHash: sha256(sourceBytes) } }; },
      // Source snapshot is not roundtrippable UTF-8: a byte inside the
      // summary VALUE is corrupted, so Node's lossy decode still parses as
      // a shape-valid note and only the UTF-8 barrier can reject it.
      (p) => { const sourceBytes = Buffer.from(p.sourceBytes);
        const token = Buffer.from('"summary": "S"');
        const start = sourceBytes.indexOf(token);
        assert.notEqual(start, -1);
        sourceBytes[start + Buffer.byteLength('"summary": "')] = 0xff;
        assert.doesNotThrow(() =>
          validateCaptureNote(JSON.parse(sourceBytes.toString('utf8'))));
        return { ...p, sourceBytes,
          ownership: { ...p.ownership, sourceHash: sha256(sourceBytes) } }; },
    ]) {
      const pair = fakePair(f, mutate);
      assert.throws(() => store.get(pair.recordId),
        (e) => e.code === 'CAPTURE_MALFORMED');
    }
  } finally { cleanup(f.dir); }
});

test('input mutation at the first IO cannot alter the validated record', () => {
  const f = fixture();
  try {
    const store = f.make();
    const in_ = input({ areaIds: [f.a], title: 'original', basis: 'declared' });
    const open = fs.openSync;
    fs.openSync = function (file, flags, ...args) {
      in_.title = 'forged';
      in_.basis = 'inferred';
      in_.areaIds.push(f.b);
      return open.call(this, file, flags, ...args);
    };
    let created;
    try {
      created = store.create(in_);
    } finally { fs.openSync = open; }
    assert.equal(created.record.title, 'original');
    assert.equal(created.record.provenance.basis, 'declared');
    assert.deepEqual(created.record.scope.areaIds, [f.a]);
    assert.equal(store.get(created.record.id).record.title, 'original');
  } finally { cleanup(f.dir); }
});

test('a sidecar write failure mid-apply stays unconfirmed and adopts nothing', () => {
  const f = fixture();
  try {
    const store = f.make();
    const open = fs.openSync;
    fs.openSync = function (file, flags, ...args) {
      if (flags === 'wx' && String(file).includes('record-ownership')) {
        throw Object.assign(new Error('sidecar write failed'), { code: 'EIO' });
      }
      return open.call(this, file, flags, ...args);
    };
    let result;
    try {
      result = store.create(input({ areaIds: [f.a] }));
    } finally { fs.openSync = open; }
    assert.equal(result.journal.status, 'unconfirmed');
    assert.equal(result.ownershipConfirmed, false);
    assert.equal(result.journal.eventIds.length, 2);
    assert.notEqual(result.journal.cause, null);
    assert.throws(() => store.get(result.record.id),
      (e) => e.code === 'CAPTURE_NOT_FOUND');
  } finally { cleanup(f.dir); }
});

test('unconfirmed source and commit failures preserve receipts and deny reads', () => {
  const f = fixture();
  try {
    const store = f.make();
    // Apply failure injected after intent/outbox persistence: the captures
    // parent appears as a file so the apply-side preflight cannot proceed.
    const restore = afterOutboxPersisted(() => {
      writeFile(f.dir, `${f.memory}/captures`, 'block');
    });
    let unconfirmed;
    try {
      unconfirmed = store.create(input({ areaIds: [f.a] }));
    } finally { restore(); }
    assert.equal(unconfirmed.mode, 'applied');
    assert.equal(unconfirmed.journal.status, 'unconfirmed');
    assert.equal(unconfirmed.ownershipConfirmed, false);
    assert.equal(unconfirmed.journal.eventIds.length, 2);
    assert.notEqual(unconfirmed.journal.cause, null);
    // Rolled-back sources are never adopted; the record stays unowned.
    assert.throws(() => store.get(unconfirmed.record.id),
      (e) => e.code === 'CAPTURE_NOT_FOUND');
  } finally { cleanup(f.dir); }
  const g = fixture();
  try {
    const store = g.make();
    const open = fs.openSync;
    fs.openSync = function (file, flags, ...args) {
      if (String(file).endsWith(`${path.sep}commit.json`)) {
        throw Object.assign(new Error('marker write failed'), { code: 'EIO' });
      }
      return open.call(this, file, flags, ...args);
    };
    let result;
    try {
      result = store.create(input({ areaIds: [g.a] }));
    } finally { fs.openSync = open; }
    assert.equal(result.journal.status, 'committed');
    assert.equal(result.journal.journalState, 'pending-finalization');
    assert.equal(result.ownershipConfirmed, false);
    assert.notEqual(result.journal.cause, null);
    assert.throws(() => store.get(result.record.id),
      (e) => e.code === 'CAPTURE_NOT_COMMITTED');
  } finally { cleanup(g.dir); }
});

test('stale bindings, forged bindings and link replacements are denied', (t) => {
  const f = fixture();
  try {
    const store = f.make();
    assert.throws(() => store.get('x'), (e) => e.code === 'INVALID_CAPTURE_INPUT');
    fs.unlinkSync(path.join(f.dir, f.state, 'workspace.json'));
    assert.throws(() => store.create(input({ areaIds: [f.a] })),
      (e) => e.code === 'WORKSPACE_STALE');
    const g = fixture();
    try {
      const gStore = g.make();
      const created = gStore.create(input({ areaIds: [g.a] }));
      const journalDir = g.journal;
      fs.rmSync(journalDir, { recursive: true });
      const target = makeTempDir('capture-journal-target');
      try {
        if (trySymlink(target, journalDir)) {
          assert.throws(() => gStore.get(created.record.id),
            (e) => e.code === 'SYMLINK_REJECTED');
        }
      } finally { cleanup(target); }
    } finally { cleanup(g.dir); }
  } finally { cleanup(f.dir); }
});

test('custom memory/state paths are honored and default directories are not created', () => {
  const f = fixture({ memory: 'data/memory', state: 'meta/state' });
  try {
    const store = f.make();
    const created = owned(store, f);
    assert.equal(created.sourceRel, `data/memory/captures/${created.record.id}.json`);
    assert.equal(created.ownershipRel,
      `meta/state/record-ownership/capture/${created.record.id}.json`);
    assert.equal(fs.existsSync(path.join(f.dir, 'data/memory/captures')), true);
    assert.equal(fs.existsSync(path.join(f.dir, '.scopegrain/memory')), false);
    assert.equal(store.get(created.record.id).isCurrentSource, true);
  } finally { cleanup(f.dir); }
});
