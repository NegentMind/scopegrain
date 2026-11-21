// SPDX-License-Identifier: Apache-2.0
// Real stores and journal proof. REVIEW states and verification below are
// explicitly SYNTHETIC declarations, never evidence of executed commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import { prepareDesign, prepareSpecification } from '../src/core/specifications.mjs';
import { getArtifact, prepareArtifact } from '../src/core/artifacts.mjs';
import { prepareTask } from '../src/core/tasks.mjs';
import { canonicalDigest, taskStaticProjection } from '../src/core/digests.mjs';
import { checkMethodology } from '../src/core/methodology.mjs';
import { getJournalOperation, applyJournaledRecordCreation } from '../src/core/journal.mjs';
import { createOwnedDesignStore } from '../src/core/owned-designs.mjs';
import { createOwnedOutcomeStore } from '../src/core/owned-outcomes.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import { seedState, verification, refs } from './methodology-fixtures.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, trySymlink, writeFile,
  writeJson } from './helpers.mjs';

const UNKNOWN = '01234567-89ab-4cde-8fab-0123456789ab';
const BODY = '  Dise\u{f1}o / resultado \u{ed}ntegro: \u{f1}, \u{6771}\u{4eac}, \u{1f9ea}\r\nSin normalizar.\n';
const json = (v) => JSON.stringify(v, null, 2) + '\n';
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const SPEC = {
  originalRequest: 'Synthetic formal ownership fixture',
  title: 'Real structured parent',
  outcome: { statement: 'Scoped ownership', evidencePlan: 'Declared fixture checks' },
  requirements: [{ id: 'R1', statement: 'Proven bytes',
    scenarios: [{ id: 'S1', given: 'a record', when: 'read', then: 'proof holds' }] }],
  scope: ['src/a'], openQuestions: [],
};
const TYPES = [
  { family: 'design', kind: 'design', prefix: 'OWNED_DESIGN',
    factory: createOwnedDesignStore },
  { family: 'outcome', kind: 'report', prefix: 'OWNED_OUTCOME',
    factory: createOwnedOutcomeStore },
];

function fixture(type, { enrolled = true, plans = 'custom/plans',
  reports = 'custom/reports', state = 'private/state' } = {}) {
  const dir = makeTempDir(`owned-${type.family}`);
  writeJson(dir, 'config/settings.json', createConfig(dir, { ...VALID_ANSWERS,
    methodology: 'sdd',
    paths: { ...VALID_ANSWERS.paths, plans, reports, state } }, {}));
  const ctx = resolveContext({ project: dir, config: 'config/settings.json' });
  const w = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  if (enrolled) applyPlan(dir, [w.file]);
  const [a, b] = w.workspace.areas.map((v) => v.id);
  // Parent specification deliberately uses the ordinary writer: parent
  // ownership is NOT a prerequisite for owned design creation.
  const spec = prepareSpecification(ctx, structuredClone(SPEC));
  applyPlan(dir, [spec.file]);
  const f = { dir, ctx, a, b, plans, reports, state, type, spec, workspaceFile: w.file };
  if (type.family === 'outcome') {
    const design = prepareDesign(ctx, { specId: spec.artifact.id,
      title: 'Ordinary design', body: BODY });
    applyPlan(dir, [design.file]);
    const task = prepareTask(ctx, { title: 'Synthetic formal fixture',
      contract: 'Ownership is not execution', scope: ['src/a'],
      authorContext: 'synthetic-author', specId: spec.artifact.id,
      designId: design.artifact.id, scenarioRefs: refs('S1') });
    applyPlan(dir, [task.file]);
    f.design = design;
    f.planTask = task.task;
    f.task = seedState(f, task.task); // SYNTHETIC REVIEW + declared verification.
  }
  f.dto = type.family === 'design'
    ? { specId: spec.artifact.id, title: 'Owned design', body: BODY }
    : { taskId: f.task.id, title: 'Owned outcome', body: BODY };
  f.input = (overrides = {}) => ({ areaIds: [a, b],
    [type.family]: structuredClone(f.dto), ...overrides });
  f.make = (areaIds = [a, b]) => type.factory(ctx, { areaIds });
  if (enrolled) f.bound = bindWorkspace(ctx, { areaIds: [a, b] });
  f.sourceDir = type.kind === 'design' ? `${plans}/designs` : reports;
  return f;
}

function tree(root) {
  const out = {};
  function walk(dir, prefix = '') {
    for (const name of fs.readdirSync(dir).sort()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const abs = path.join(dir, name);
      const st = fs.lstatSync(abs);
      out[rel] = st.isSymbolicLink() ? { link: fs.readlinkSync(abs) }
        : st.isDirectory() ? 'directory' : fs.readFileSync(abs);
      if (st.isDirectory() && !st.isSymbolicLink()) walk(abs, rel);
    }
  }
  walk(root);
  return out;
}
function scope(f, areas = [f.a, f.b]) {
  return { workspaceId: f.bound.workspaceId, projectId: f.bound.projectId,
    repositoryId: f.bound.repositoryId, areaIds: [...areas].sort() };
}
function code(fn, expected) {
  assert.throws(fn, (e) => e.code === expected,
    `expected ${expected}`);
}
function noWrite(f, fn) {
  const before = tree(f.dir);
  try { return fn(); } finally { assert.deepEqual(tree(f.dir), before); }
}
function operationPath(f, created, name) {
  return path.join(f.dir, f.state, 'journal', 'operations',
    created.journal.operationId, name);
}

for (const type of TYPES) {
  const INPUT = `INVALID_${type.prefix}_INPUT`;
  test(`${type.family}: frozen closed store clones context/options and inputs before IO`, (t) => {
    const f = fixture(type);
    try {
      const opts = { areaIds: [f.a, f.b] };
      const store = type.factory(f.ctx, opts);
      assert.equal(Object.isFrozen(store), true);
      assert.deepEqual(Object.keys(store).sort(), ['create', 'get', 'prepare']);
      for (const bad of [null, {}, { areaIds: [] }, { areaIds: ['bad'] },
        { areaIds: [f.a, f.a] }, { areaIds: [f.a, , f.b] },
        { areaIds: [f.a], origin: 'cli' }]) {
        noWrite(f, () => code(() => type.factory(f.ctx, bad), INPUT));
      }
      code(() => f.make([UNKNOWN]), 'SCOPE_DENIED');
      for (const ctx of [null, { projectRoot: f.dir }, { config: f.ctx.config }]) {
        code(() => type.factory(ctx, { areaIds: [f.a] }), INPUT);
      }
      const dto = f.input({ areaIds: [f.a] });
      opts.areaIds.length = 0;
      f.ctx.config.paths.plans = 'redirect/plans';
      f.ctx.config.paths.reports = 'redirect/reports';
      f.ctx.config.paths.state = 'redirect/state';
      f.ctx.projectRoot = path.join(f.dir, 'not-the-root');
      const open = fs.openSync;
      const spy = t.mock.method(fs, 'openSync', function (file, flags, ...rest) {
        dto[type.family].body = 'mutated caller body';
        dto.areaIds.push(f.b);
        return open.call(this, file, flags, ...rest);
      });
      let created;
      try { created = store.create(dto); } finally { spy.mock.restore(); }
      assert.equal(created.record.body, BODY);
      assert.equal(created.sourceRel, `${f.sourceDir}/${created.record.id}.json`);
      assert.deepEqual(store.get(created.record.id).ownership.scope.areaIds, [f.a]);
      assert.equal(fs.existsSync(path.join(f.dir, 'redirect')), false);
    } finally { cleanup(f.dir); }
  });

  test(`${type.family}: accessors/injected fields and invalid areas fail read-only in the intended order`, () => {
    const f = fixture(type);
    try {
      const store = f.make();
      let called = 0;
      const outer = f.input();
      Object.defineProperty(outer, type.family, {
        enumerable: true, get() { called++; return f.dto; },
      });
      const inner = f.input();
      Object.defineProperty(inner[type.family], 'body', {
        enumerable: true, get() { called++; return BODY; },
      });
      const options = {};
      Object.defineProperty(options, 'areaIds', {
        enumerable: true, get() { called++; return [f.a]; },
      });
      noWrite(f, () => code(() => type.factory(f.ctx, options), INPUT));
      const sparse = [f.a, , f.b];
      const decorated = f.input(); decorated[Symbol('extra')] = true;
      for (const dto of [null, [], {}, outer, decorated,
        f.input({ areaIds: [] }), f.input({ areaIds: [f.a, f.a] }),
        f.input({ areaIds: sparse }), f.input({ areaIds: ['bad'] }),
        ...['id', 'recordId', 'path', 'sourceRel', 'ownershipRel', 'sourceHash',
          'hash', 'operationId', 'revision', 'sourceRevision', 'origin', 'extra']
          .map((key) => f.input({ [key]: 'injected' }))]) {
        for (const method of ['prepare', 'create']) {
          noWrite(f, () => code(() => store[method](dto), INPUT));
        }
      }
      noWrite(f, () => code(() => store.prepare(inner), 'INVALID_JSON_VALUE'));
      assert.equal(called, 0);
      for (const key of ['id', 'path', 'sourceHash', 'specDigest',
        'taskDigest', 'verificationDigest']) {
        noWrite(f, () => code(() => store.prepare(f.input({
          [type.family]: { ...f.dto, [key]: 'caller-supplied' },
        })), 'UNKNOWN_KEY'));
      }
      const alpha = f.make([f.a]);
      for (const method of ['prepare', 'create']) {
        noWrite(f, () => code(() => alpha[method](f.input()), 'SCOPE_DENIED'));
        noWrite(f, () => code(() => store[method](f.input({
          areaIds: [UNKNOWN], [type.family]: null,
        })), 'SCOPE_DENIED'));
      }
      const created = store.create(f.input());
      noWrite(f, () => code(() => alpha.get(created.record.id), 'SCOPE_DENIED'));
      for (const id of [null, 1, 'bad', 'ABCDEF12-3456-4789-8ABC-DEF012345678']) {
        noWrite(f, () => code(() => store.get(id), INPUT));
      }
    } finally { cleanup(f.dir); }
  });

  test(`${type.family}: enrollment required; bound metadata changes deny every operation`, () => {
    const missing = fixture(type, { enrolled: false });
    try { noWrite(missing, () => code(() => missing.make(), 'WORKSPACE_NOT_FOUND')); }
    finally { cleanup(missing.dir); }
    const f = fixture(type);
    try {
      const store = f.make();
      const created = store.create(f.input());
      const w = JSON.parse(fs.readFileSync(f.workspaceFile.abs, 'utf8'));
      writeJson(f.dir, f.workspaceFile.rel, { ...w, revision: w.revision + 1 });
      for (const method of ['prepare', 'create', 'get']) {
        noWrite(f, () => code(() => store[method](method === 'get'
          ? created.record.id : f.input()), 'WORKSPACE_STALE'));
      }
    } finally { cleanup(f.dir); }
  });

  test(`${type.family}: previews reserve nothing; committed pair proves exact bytes/scopes/hashes/time`, () => {
    const f = fixture(type);
    try {
      const store = f.make();
      const dto = f.input({ areaIds: [f.b, f.a] });
      const p = noWrite(f, () => store.prepare(dto));
      const p2 = noWrite(f, () => store.prepare(dto));
      assert.equal(p.mode, 'dry-run');
      assert.equal(p.reservesIds, false);
      assert.notEqual(p.record.id, p2.record.id);
      const created = store.create(dto);
      const { record } = created;
      assert.notEqual(record.id, p.record.id);
      assert.equal(record.schemaVersion, 2);
      assert.equal(record.kind, type.kind);
      assert.equal(record.body, BODY);
      assert.equal(created.mode, 'applied');
      assert.equal(created.ownershipConfirmed, true);
      assert.equal(created.sourceRel, `${f.sourceDir}/${record.id}.json`);
      assert.equal(created.ownershipRel,
        `${f.state}/record-ownership/${type.kind}/${record.id}.json`);
      const source = fs.readFileSync(path.join(f.dir, created.sourceRel));
      const companion = fs.readFileSync(path.join(f.dir, created.ownershipRel));
      assert.deepEqual(JSON.parse(source), record);
      const ownership = JSON.parse(companion);
      assert.deepEqual(Object.keys(ownership).sort(), ['schemaVersion', 'sourceKind',
        'recordId', 'sourceRevision', 'sourceRel', 'sourceHash', 'operationId',
        'scope', 'createdAt'].sort());
      assert.equal(ownership.sourceKind, type.kind);
      assert.equal(ownership.recordId, record.id);
      assert.equal(ownership.sourceHash, hash(source));
      assert.equal(ownership.sourceRel, created.sourceRel);
      assert.equal(ownership.sourceRevision, 0);
      assert.equal(ownership.operationId, created.journal.operationId);
      assert.equal(ownership.createdAt, record.createdAt);
      assert.deepEqual(ownership.scope, scope(f));
      const op = getJournalOperation(f.bound, created.journal.operationId);
      assert.equal(op.state, 'committed');
      assert.equal(op.intent.events.length, 2);
      assert.deepEqual(op.intent.events.map((e) => e.sourceKind).sort(),
        [type.kind, 'record-ownership'].sort());
      for (const event of op.intent.events) {
        assert.equal(event.recordId, record.id);
        assert.equal(event.operation, 'create');
        assert.equal(event.sourceRevision, 0);
        assert.equal(event.createdAt, record.createdAt);
        assert.equal(event.workspaceId, f.bound.workspaceId);
        assert.equal(event.projectId, f.bound.projectId);
        assert.equal(event.repositoryId, f.bound.repositoryId);
        assert.deepEqual(event.areaIds, [f.a, f.b].sort());
        const expected = event.sourceKind === type.kind ? source : companion;
        assert.equal(event.sourceHash, hash(expected));
        assert.deepEqual(fs.readFileSync(path.join(f.dir, event.snapshotRef)), expected);
      }
      assert.deepEqual(noWrite(f, () => store.get(record.id)), {
        record, ownership, isCurrentSource: true, memoryConsulted: false,
        locator: { operationId: created.journal.operationId,
          eventId: op.intent.events.find((e) => e.sourceKind === type.kind).eventId },
      });
    } finally { cleanup(f.dir); }
  });

  test(`${type.family}: unknown/unowned, changed source/companion/snapshot and uncommitted proof never fall back`, () => {
    const f = fixture(type);
    try {
      const store = f.make();
      noWrite(f, () => code(() => store.get(UNKNOWN), `${type.prefix}_NOT_FOUND`));
      const created = store.create(f.input());
      const sourceAbs = path.join(f.dir, created.sourceRel);
      const ownAbs = path.join(f.dir, created.ownershipRel);
      const source = fs.readFileSync(sourceAbs);
      const companion = fs.readFileSync(ownAbs);
      const ownership = JSON.parse(companion);
      fs.unlinkSync(ownAbs);
      noWrite(f, () => code(() => store.get(created.record.id), `${type.prefix}_NOT_FOUND`));
      fs.writeFileSync(ownAbs, companion);
      fs.writeFileSync(sourceAbs, json({ ...created.record, body: 'changed' }));
      noWrite(f, () => code(() => store.get(created.record.id), `${type.prefix}_SOURCE_CHANGED`));
      fs.writeFileSync(sourceAbs, Buffer.alloc(loadLimits().maxDocumentBytes + 1, 0x20));
      noWrite(f, () => code(() => store.get(created.record.id), 'DOCUMENT_TOO_LARGE'));
      fs.writeFileSync(sourceAbs, source);
      for (const patch of [{ sourceKind: type.kind === 'design' ? 'report' : 'design' },
        { sourceHash: 'a'.repeat(64) }, { recordId: UNKNOWN }]) {
        fs.writeFileSync(ownAbs, json({ ...ownership, ...patch }));
        noWrite(f, () => code(() => store.get(created.record.id), `${type.prefix}_MALFORMED`));
      }
      fs.writeFileSync(ownAbs, companion);
      const blob = path.join(f.dir, f.state, 'journal', 'snapshots',
        `${ownership.sourceHash}.blob`);
      const originalBlob = fs.readFileSync(blob);
      fs.writeFileSync(blob, 'tampered snapshot');
      noWrite(f, () => code(() => store.get(created.record.id), 'JOURNAL_SNAPSHOT_MISMATCH'));
      fs.writeFileSync(blob, originalBlob);
      fs.unlinkSync(operationPath(f, created, 'commit.json'));
      noWrite(f, () => code(() => store.get(created.record.id), `${type.prefix}_NOT_COMMITTED`));
    } finally { cleanup(f.dir); }
  });

  test(`${type.family}: document limits and unsafe/linked destinations fail closed without writes`, (t) => {
    const f = fixture(type);
    const target = makeTempDir(`owned-${type.family}-link-target`);
    try {
      const store = f.make();
      noWrite(f, () => code(() => store.prepare(f.input({
        [type.family]: { ...f.dto, body: '\u{e9}'.repeat(loadLimits().maxDocumentBytes) },
      })), 'DOCUMENT_TOO_LARGE'));
      const block = `${f.state}/record-ownership`;
      writeFile(f.dir, block, 'fixture-owned blocker');
      noWrite(f, () => code(() => store.prepare(f.input()), 'FILE_ANCESTOR'));
      fs.unlinkSync(path.join(f.dir, block));
      fs.mkdirSync(path.join(f.dir, f.state, 'record-ownership'), { recursive: true });
      const link = path.join(f.dir, f.state, 'record-ownership', type.kind);
      if (!trySymlink(target, link)) {
        t.skip('directory junctions unavailable');
        return;
      }
      noWrite(f, () => code(() => store.prepare(f.input()), 'SYMLINK_REJECTED'));
      assert.deepEqual(fs.readdirSync(target), []);
    } finally { cleanup(f.dir); cleanup(target); }
  });

  test(`${type.family}: genuine mid-apply failure preserves complete uncertain receipt and cannot be read as owned`, (t) => {
    const f = fixture(type);
    try {
      const store = f.make();
      const open = fs.openSync;
      const spy = t.mock.method(fs, 'openSync', function (file, flags, ...rest) {
        if (flags === 'wx' && String(file).includes('record-ownership')) {
          throw Object.assign(new Error('synthetic companion write failure'), { code: 'EIO' });
        }
        return open.call(this, file, flags, ...rest);
      });
      let result;
      try { result = store.create(f.input()); } finally { spy.mock.restore(); }
      assert.equal(result.mode, 'applied');
      assert.equal(result.ownershipConfirmed, false);
      assert.equal(result.journal.status, 'unconfirmed');
      assert.equal(result.journal.eventIds.length, 2);
      assert.equal(typeof result.journal.operationId, 'string');
      assert.notEqual(result.journal.cause, null);
      assert.equal(result.journal.pendingMemory, true);
      // Rollback succeeds in this fixture and removes the created source.
      // Cleanup is best-effort; proof never relies on its success.
      assert.equal(fs.existsSync(path.join(f.dir, result.sourceRel)), false);
      assert.equal(fs.existsSync(path.join(f.dir, result.ownershipRel)), false);
      const operation = getJournalOperation(f.bound, result.journal.operationId);
      assert.equal(operation.state, 'prepared');
      assert.equal(operation.intent.events.length, 2);
      for (const event of operation.intent.events) {
        const snapshot = fs.readFileSync(path.join(f.dir, event.snapshotRef));
        assert.equal(hash(snapshot), event.sourceHash);
      }
      noWrite(f, () => code(() => store.get(result.record.id), `${type.prefix}_NOT_FOUND`));
    } finally { cleanup(f.dir); }
  });
}

test('design: ordinary structured parent accepted; current foreign binding checked without rereading design via getArtifact', (t) => {
  const f = fixture(TYPES[0]);
  try {
    const store = f.make();
    assert.equal(fs.existsSync(path.join(f.dir, f.state, 'record-ownership', 'spec')), false);
    const created = store.create(f.input());
    assert.equal(created.record.data.specDigest, canonicalDigest(f.spec.artifact));
    const sourceAbs = path.join(f.dir, created.sourceRel);
    const read = fs.readFileSync;
    let sourceReads = 0;
    const spy = t.mock.method(fs, 'readFileSync', function (file, ...args) {
      if (typeof file === 'string' && path.resolve(file) === sourceAbs) sourceReads++;
      return read.call(this, file, ...args);
    });
    try {
      assert.deepEqual(store.get(created.record.id).record, created.record);
      // Shared proof reads the current source via bounded FD reading; a
      // getArtifact reread would add a second source open (checked below).
      assert.equal(sourceReads, 0);
    } finally { spy.mock.restore(); }
    const open = fs.openSync;
    let sourceOpens = 0;
    const opened = t.mock.method(fs, 'openSync', function (file, ...rest) {
      if (typeof file === 'string' && path.resolve(file) === sourceAbs) sourceOpens++;
      return open.call(this, file, ...rest);
    });
    try { store.get(created.record.id); assert.equal(sourceOpens, 1); }
    finally { opened.mock.restore(); }
    const changed = { ...f.spec.artifact, title: 'Changed parent' };
    // Title participates in rendered spec body; re-prepare a valid changed
    // spec and preserve the original ID/time rather than seed malformed data.
    const next = prepareSpecification(f.ctx, { ...SPEC, title: changed.title }).artifact;
    const validChanged = { ...next, id: f.spec.artifact.id,
      createdAt: f.spec.artifact.createdAt };
    writeJson(f.dir, f.spec.file.rel, validChanged);
    noWrite(f, () => code(() => store.get(created.record.id), 'ARTIFACT_DRIFT'));
    // Combined faults still surface the parent binding error: the shared
    // proof validates bindings on the snapshot record BEFORE comparing
    // the current source bytes.
    const originalSource = fs.readFileSync(sourceAbs);
    fs.writeFileSync(sourceAbs,
      json({ ...created.record, body: 'changed current source' }));
    noWrite(f, () => code(() => store.get(created.record.id), 'ARTIFACT_DRIFT'));
    fs.writeFileSync(sourceAbs, originalSource);
    fs.unlinkSync(f.spec.file.abs);
    noWrite(f, () => code(() => store.get(created.record.id), 'ARTIFACT_NOT_FOUND'));
    writeFile(f.dir, f.spec.file.rel, '{malformed');
    noWrite(f, () => code(() => store.get(created.record.id), 'ARTIFACT_MALFORMED'));
  } finally { cleanup(f.dir); }
});

test('design: V1/missing parent rejected and parent digest re-derived between preview and apply', () => {
  const f = fixture(TYPES[0]);
  try {
    const store = f.make();
    const preview = noWrite(f, () => store.prepare(f.input()));
    const next = prepareSpecification(f.ctx, { ...SPEC, originalRequest: 'Changed real parent' }).artifact;
    const changed = { ...next, id: f.spec.artifact.id, createdAt: f.spec.artifact.createdAt };
    writeJson(f.dir, f.spec.file.rel, changed);
    const created = store.create(f.input());
    assert.notEqual(created.record.data.specDigest, preview.record.data.specDigest);
    assert.equal(created.record.data.specDigest, canonicalDigest(changed));
    const legacy = prepareArtifact(f.ctx, 'spec', { title: 'V1 spec', body: 'Legacy' });
    applyPlan(f.dir, [legacy.file]);
    for (const [id, expected] of [[legacy.artifact.id, 'SPEC_STRUCTURED_REQUIRED'],
      [UNKNOWN, 'ARTIFACT_NOT_FOUND']]) {
      noWrite(f, () => code(() => store.prepare(f.input({
        design: { ...f.dto, specId: id },
      })), expected));
    }
  } finally { cleanup(f.dir); }
});

test('outcome: derives real formal REVIEW task/verification digests; rejects PLAN, no verification and unhealthy bindings', () => {
  const f = fixture(TYPES[1]);
  try {
    const store = f.make();
    const record = store.prepare(f.input()).record;
    assert.equal(record.data.taskId, f.task.id);
    assert.equal(record.data.taskRevision, f.task.revision);
    assert.equal(record.data.taskDigest, canonicalDigest(taskStaticProjection(f.task)));
    assert.equal(record.data.specDigest, canonicalDigest(f.spec.artifact));
    assert.equal(record.data.designDigest, canonicalDigest(f.design.artifact));
    assert.equal(record.data.planDigest, null);
    assert.equal(record.data.verificationDigest, canonicalDigest(verification()));
    seedState(f, f.planTask, 'PLAN', null);
    noWrite(f, () => code(() => store.prepare(f.input()), 'OUTCOME_INVALID'));
    seedState(f, f.planTask, 'REVIEW', null);
    noWrite(f, () => code(() => store.prepare(f.input()), 'OUTCOME_INVALID'));
    seedState(f, f.planTask);
    fs.unlinkSync(f.design.file.abs);
    noWrite(f, () => code(() => store.prepare(f.input()), 'OUTCOME_INVALID'));
  } finally { cleanup(f.dir); }
});

test('outcome: apply re-derives mutable task and declared verification after a preview', () => {
  const f = fixture(TYPES[1]);
  try {
    const store = f.make();
    const preview = noWrite(f, () => store.prepare(f.input()));
    const changedVerification = verification();
    changedVerification.checks[0].evidence = 'Changed SYNTHETIC declaration, not execution';
    const changedTask = seedState(f, { ...f.planTask,
      contract: 'Changed synthetic task contract' }, 'REVIEW', changedVerification);
    const created = store.create(f.input());
    assert.notEqual(created.record.data.taskDigest, preview.record.data.taskDigest);
    assert.notEqual(created.record.data.verificationDigest, preview.record.data.verificationDigest);
    assert.equal(created.record.data.taskDigest, canonicalDigest(taskStaticProjection(changedTask)));
    assert.equal(created.record.data.verificationDigest, canonicalDigest(changedVerification));
    assert.equal(created.record.data.taskRevision, changedTask.revision);
  } finally { cleanup(f.dir); }
});

test('outcome: get proves report bytes only, not mutable task currency or ACCEPT eligibility', () => {
  const f = fixture(TYPES[1]);
  try {
    const store = f.make();
    const created = store.create(f.input());
    const proof = store.get(created.record.id);
    seedState(f, { ...f.planTask, title: 'Changed synthetic task digest' }, 'ACT', null);
    assert.deepEqual(noWrite(f, () => store.get(created.record.id)), proof);
    assert.deepEqual(getArtifact(f.ctx, 'report', created.record.id), created.record);
    assert.equal(checkMethodology(f.ctx, { taskId: f.task.id,
      to: 'ACCEPT', outcomeEvidenceId: created.record.id }).allowed, false);
    // Even removing the task must not turn a report-integrity read into a
    // fresh task lookup. There is no claim this authorizes acceptance.
    fs.unlinkSync(path.join(f.dir, f.ctx.config.paths.tasks, `${f.task.id}.json`));
    assert.deepEqual(noWrite(f, () => store.get(created.record.id)), proof);
  } finally { cleanup(f.dir); }
});

test('outcome: genuine committed two-event V1 report proof still fails OWNED_OUTCOME_MALFORMED', () => {
  const f = fixture(TYPES[1]);
  try {
    let id;
    const receipt = applyJournaledRecordCreation(f.bound, (identity) => {
      id = crypto.randomUUID();
      const sourceRel = `${f.reports}/${id}.json`;
      const source = Buffer.from(json({ schemaVersion: 1, id, kind: 'report',
        title: 'Legacy report', body: BODY, references: [], createdAt: identity.createdAt }));
      const ownership = { schemaVersion: 1, sourceKind: 'report', recordId: id,
        sourceRevision: 0, sourceRel, sourceHash: hash(source),
        operationId: identity.operationId, scope: scope(f), createdAt: identity.createdAt };
      return [
        { sourceKind: 'report', recordId: id, sourceRevision: 0, areaIds: [f.a, f.b],
          file: { rel: sourceRel, content: source } },
        { sourceKind: 'record-ownership', recordId: id, sourceRevision: 0,
          areaIds: [f.a, f.b], file: {
            rel: `${f.state}/record-ownership/report/${id}.json`,
            content: Buffer.from(json(ownership)) } },
      ];
    });
    assert.equal(receipt.status, 'committed');
    assert.equal(receipt.eventIds.length, 2);
    noWrite(f, () => code(() => f.make().get(id), 'OWNED_OUTCOME_MALFORMED'));
  } finally { cleanup(f.dir); }
});
