// Bound owned-specification store: immutable V2 spec + ownership companion
// created through the strict journal seam and proven by a committed
// two-event operation. No adoption, listing, history or backend calls.
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
import { createOwnedSpecificationStore }
  from '../src/core/owned-specifications.mjs';
import { renderSpecification } from '../src/core/artifacts.mjs';
import { validateRecordOwnership }
  from '../src/core/record-ownership-data.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, trySymlink, writeFile,
  writeJson } from './helpers.mjs';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

const SPEC = {
  originalRequest: 'Add a dark-mode toggle to settings, verbatim request.',
  title: 'Dark mode toggle',
  outcome: { statement: 'users can toggle dark mode',
    evidencePlan: 'screenshot plus e2e run' },
  requirements: [{
    id: 'REQ-1',
    statement: 'Toggle persists across sessions',
    scenarios: [{ id: 'SC-1', given: 'a stored preference',
      when: 'the app restarts', then: 'dark mode applies immediately' }],
  }],
  scope: ['src/settings'],
  constraints: [], nonGoals: [], openQuestions: [], references: [],
};

function specIn(overrides = {}) { return { ...SPEC, ...overrides }; }

function fixture({ plans = 'docs/agent/plans', state = '.tasksystem/state',
  configRel = '.tasksystem/config.json' } = {}) {
  const dir = makeTempDir('ownedspec');
  const answers = { ...VALID_ANSWERS,
    paths: { ...VALID_ANSWERS.paths, plans, state } };
  writeJson(dir, configRel, createConfig(dir, answers, {}));
  const ctx = resolveContext({ project: dir, config: configRel });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  const bound = bindWorkspace(ctx, { areaIds: [a, b] });
  const alphaBound = bindWorkspace(ctx, { areaIds: [a] });
  const make = (overrides = {}) => createOwnedSpecificationStore(ctx,
    { areaIds: [a, b], ...overrides });
  return {
    dir, ctx, a, b, bound, alphaBound, make, plans, state,
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

function input(f, overrides = {}) {
  return { areaIds: [f.a, f.b], specification: specIn(), ...overrides };
}

function scopeOf(f, areaIds) {
  return { workspaceId: f.bound.workspaceId, projectId: f.bound.projectId,
    repositoryId: f.bound.repositoryId, areaIds: [...areaIds].sort() };
}

test('store is frozen with only prepare/create/get; closed options, cloned ctx and grants', () => {
  const f = fixture();
  try {
    const options = { areaIds: [f.a, f.b] };
    const store = createOwnedSpecificationStore(f.ctx, options);
    assert.equal(Object.isFrozen(store), true);
    assert.deepEqual(Object.keys(store).sort(), ['create', 'get', 'prepare']);
    for (const bad of [null, {}, { areaIds: [f.a], origin: 'local-cli' },
      { ...options, extra: 1 }, { areaIds: [] }, { areaIds: ['x'] },
      { areaIds: [f.a, f.a] }]) {
      assert.throws(() => createOwnedSpecificationStore(f.ctx, bad),
        (e) => e.code === 'INVALID_OWNED_SPEC_INPUT');
    }
    assert.throws(() => createOwnedSpecificationStore(f.ctx,
      { areaIds: ['99999999-9999-9999-9999-999999999999'] }),
      (e) => e.code === 'SCOPE_DENIED');
    for (const badCtx of [null, { projectRoot: f.dir },
      { config: f.ctx.config }]) {
      assert.throws(() => createOwnedSpecificationStore(badCtx,
        { areaIds: [f.a] }), (e) => e.code === 'INVALID_OWNED_SPEC_INPUT');
    }
    options.areaIds.length = 0;
    f.ctx.config.paths.plans = 'redirect/plans';
    f.ctx.config.paths.state = 'redirect/state';
    f.ctx.projectRoot = path.join(f.dir, 'other');
    const result = store.create(input(f, { areaIds: [f.a] }));
    assert.equal(result.mode, 'applied');
    assert.equal(result.sourceRel,
      `${f.plans}/specs/${result.record.id}.json`);
    assert.equal(fs.existsSync(path.join(f.dir, 'redirect')), false);
    f.ctx.projectRoot = f.dir;
  } finally { cleanup(f.dir); }
});

test('closed input rejects injected fields and decorated objects before any write', () => {
  const f = fixture();
  try {
    const store = f.make();
    const before = tree(f.dir);
    let calls = 0;
    const outerGetter = input(f);
    Object.defineProperty(outerGetter, 'specification',
      { enumerable: true, get() { calls += 1; return specIn(); } });
    const nestedGetter = { areaIds: [f.a], specification: specIn() };
    Object.defineProperty(nestedGetter.specification, 'title',
      { enumerable: true, get() { calls += 1; return 'x'; } });
    const sparseAreas = input(f);
    sparseAreas.areaIds = [f.a];
    sparseAreas.areaIds[2] = f.b;
    delete sparseAreas.areaIds[1];
    for (const bad of [null, [], 'x', outerGetter, input(f, { extra: 1 }),
      { specification: specIn() }, { areaIds: [f.a] },
      input(f, { areaIds: [] }), input(f, { areaIds: ['x'] }),
      input(f, { areaIds: [f.a, f.a] }), sparseAreas,
      { areaIds: [f.a], specification: 'x' },
      input(f, { specification: specIn({ id: crypto.randomUUID() }) }),
      input(f, { specification: specIn({ sourceRel: 'x/y.json' }) }),
      input(f, { specification: specIn({ sourceHash: 'a'.repeat(64) }) }),
      input(f, { specification: specIn({ title: '' }) }),
      input(f, { specification: specIn({ scope: ['../outside'] }) })]) {
      for (const fn of [() => store.create(bad), () => store.prepare(bad)]) {
        assert.throws(fn, (e) => e.code !== 'OK' && e.code !== undefined);
      }
    }
    // Outer closure rejects injected keys; inner spec errors keep their
    // existing domain codes (UNKNOWN_KEY / INVALID_ARTIFACT / SPEC_DATA_*).
    assert.throws(() => store.create(input(f, { recordId: f.a })),
      (e) => e.code === 'INVALID_OWNED_SPEC_INPUT');
    assert.throws(() => store.create(
      input(f, { specification: specIn({ id: f.a }) })),
      (e) => e.code === 'UNKNOWN_KEY');
    assert.throws(() => store.create(
      input(f, { specification: specIn({ title: '' }) })),
      (e) => e.code !== 'INVALID_OWNED_SPEC_INPUT');
    // Nested getters inside the specification reach the JSON clone and
    // fail as non-data without ever being invoked.
    for (const fn of [() => store.create(nestedGetter),
      () => store.prepare(nestedGetter)]) {
      assert.throws(fn, (e) => e.code === 'INVALID_JSON_VALUE');
    }
    assert.equal(calls, 0);
    // Oversized inputs fail the document bound without writes.
    const oversized = input(f, { areaIds: [f.a],
      specification: specIn({
        originalRequest: 'x'.repeat(loadLimits().maxDocumentBytes) }) });
    for (const fn of [() => store.create(oversized),
      () => store.prepare(oversized)]) {
      assert.throws(fn, (e) => e.code === 'DOCUMENT_TOO_LARGE');
    }
    assert.deepEqual(tree(f.dir), before);
  } finally { cleanup(f.dir); }
});

test('prepare is a read-only dry-run with fresh provisional IDs and no reservations', () => {
  const f = fixture();
  try {
    const store = f.make();
    const before = tree(f.dir);
    const first = store.prepare(input(f));
    const second = store.prepare(input(f));
    assert.notEqual(first.record.id, second.record.id);
    assert.deepEqual(Object.keys(first).sort(),
      ['mode', 'ownershipRel', 'record', 'reservesIds', 'sourceRel']);
    assert.equal(first.mode, 'dry-run');
    assert.equal(first.reservesIds, false);
    assert.equal(first.record.schemaVersion, 2);
    assert.equal(first.record.kind, 'spec');
    assert.equal(first.sourceRel, `${f.plans}/specs/${first.record.id}.json`);
    assert.equal(first.ownershipRel,
      `${f.state}/record-ownership/spec/${first.record.id}.json`);
    assert.deepEqual(tree(f.dir), before);
  } finally { cleanup(f.dir); }
});

test('create commits exactly two scoped events and get proves the current V2 record', () => {
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
    assert.equal(record.schemaVersion, 2);
    assert.equal(record.kind, 'spec');
    assert.equal(record.title, SPEC.title);
    assert.equal(record.data.originalRequest, SPEC.originalRequest);
    assert.deepEqual(record.data.requirements, SPEC.requirements);
    assert.equal(record.body.includes(SPEC.originalRequest), true);
    const sourceRel = `${f.plans}/specs/${record.id}.json`;
    const ownershipRel = `${f.state}/record-ownership/spec/${record.id}.json`;
    assert.equal(created.sourceRel, sourceRel);
    assert.equal(created.ownershipRel, ownershipRel);
    const sourceBytes = fs.readFileSync(
      path.join(f.dir, ...sourceRel.split('/')));
    const ownershipBytes = fs.readFileSync(
      path.join(f.dir, ...ownershipRel.split('/')));
    assert.deepEqual(JSON.parse(sourceBytes.toString('utf8')), record);
    const ownership = JSON.parse(ownershipBytes.toString('utf8'));
    assert.doesNotThrow(() => validateRecordOwnership(ownership, 'spec'));
    assert.equal(ownership.sourceKind, 'spec');
    assert.equal(ownership.recordId, record.id);
    assert.equal(ownership.sourceRel, sourceRel);
    assert.equal(ownership.sourceHash, sha256(sourceBytes));
    assert.equal(ownership.operationId, created.journal.operationId);
    assert.equal(ownership.createdAt, record.createdAt);
    assert.deepEqual(ownership.scope, scopeOf(f, [f.a, f.b]));
    const op = getJournalOperation(f.bound, created.journal.operationId);
    assert.equal(op.state, 'committed');
    assert.equal(op.intent.events.length, 2);
    const kinds = op.intent.events.map((e) => e.sourceKind).sort();
    assert.deepEqual(kinds, ['record-ownership', 'spec']);
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
      locator: { operationId: created.journal.operationId,
        eventId: op.intent.events.find((e) => e.sourceKind === 'spec').eventId },
      isCurrentSource: true, memoryConsulted: false,
    });
    assert.equal(got.record.data.originalRequest, SPEC.originalRequest);
  } finally { cleanup(f.dir); }
});

test('all-of grants apply to create and read; UUID argument is strict', () => {
  const f = fixture();
  try {
    const alpha = f.make({ areaIds: [f.a] });
    assert.throws(() => alpha.create(input(f)), (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => alpha.prepare(input(f)), (e) => e.code === 'SCOPE_DENIED');
    const ownedAlpha = alpha.create(input(f, { areaIds: [f.a] }));
    const both = f.make();
    const shared = both.create(input(f));
    assert.throws(() => alpha.get(shared.record.id),
      (e) => e.code === 'SCOPE_DENIED');
    const beta = createOwnedSpecificationStore(f.ctx, { areaIds: [f.b] });
    assert.throws(() => beta.get(ownedAlpha.record.id),
      (e) => e.code === 'SCOPE_DENIED');
    assert.equal(alpha.get(ownedAlpha.record.id).isCurrentSource, true);
    for (const bad of ['x',
      'abcdef12-3456-4789-8abc-def012345678'.toUpperCase(), 1, null]) {
      assert.throws(() => both.get(bad),
        (e) => e.code === 'INVALID_OWNED_SPEC_INPUT');
    }
  } finally { cleanup(f.dir); }
});

test('unowned files, uncommitted operations and committed V1 proof are rejected', () => {
  const f = fixture();
  try {
    const store = f.make();
    // A plausible unowned V2 file plus sidecar without any journal op.
    const forged = crypto.randomUUID();
    const sourceRel = `${f.plans}/specs/${forged}.json`;
    const ownershipRel = `${f.state}/record-ownership/spec/${forged}.json`;
    const v2Data = { schemaVersion: 1, originalRequest: 'r',
      outcome: { statement: 's', evidencePlan: 'e' },
      requirements: [{ id: 'R', statement: 's',
        scenarios: [{ id: 'S', given: 'g', when: 'w', then: 't' }] }],
      scope: ['src/settings'], constraints: [], nonGoals: [],
      openQuestions: [] };
    const v2 = { schemaVersion: 2, id: forged, kind: 'spec', title: 'T',
      body: renderSpecification('T', v2Data), references: [],
      createdAt: '2026-11-16T10:00:00.000Z', data: v2Data };
    writeFile(f.dir, sourceRel, json(v2));
    writeJson(f.dir, ownershipRel, { schemaVersion: 1, sourceKind: 'spec',
      recordId: forged, sourceRevision: 0, sourceRel,
      sourceHash: sha256(Buffer.from(json(v2))),
      operationId: crypto.randomUUID(), scope: scopeOf(f, [f.a]),
      createdAt: v2.createdAt });
    assert.throws(() => store.get(forged), (e) => e.code === 'JOURNAL_NOT_FOUND');
    // A legacy V1 file alone is simply not owned.
    const legacy = crypto.randomUUID();
    writeFile(f.dir, `${f.plans}/specs/${legacy}.json`,
      json({ schemaVersion: 1, id: legacy, kind: 'spec', title: 'T',
        body: 'B', references: [], createdAt: '2026-11-16T10:00:00.000Z' }));
    assert.throws(() => store.get(legacy),
      (e) => e.code === 'OWNED_SPEC_NOT_FOUND');
    // Genuine committed two-event proof whose source is a V1 artifact:
    // proven bytes still fail the structured-V2 requirement.
    let v1Id;
    const op = applyJournaledRecordCreation(f.bound, (identity) => {
      v1Id = crypto.randomUUID();
      const v1Rel = `${f.plans}/specs/${v1Id}.json`;
      const v1Own = `${f.state}/record-ownership/spec/${v1Id}.json`;
      const v1Doc = { schemaVersion: 1, id: v1Id, kind: 'spec', title: 'T',
        body: 'B', references: [], createdAt: identity.createdAt };
      const v1Bytes = Buffer.from(json(v1Doc), 'utf8');
      const sidecar = { schemaVersion: 1, sourceKind: 'spec', recordId: v1Id,
        sourceRevision: 0, sourceRel: v1Rel, sourceHash: sha256(v1Bytes),
        operationId: identity.operationId, scope: scopeOf(f, [f.a, f.b]),
        createdAt: identity.createdAt };
      return [
        { sourceKind: 'spec', recordId: v1Id, sourceRevision: 0,
          areaIds: [f.a, f.b], file: { rel: v1Rel, content: v1Bytes } },
        { sourceKind: 'record-ownership', recordId: v1Id, sourceRevision: 0,
          areaIds: [f.a, f.b],
          file: { rel: v1Own, content: Buffer.from(json(sidecar), 'utf8') } },
      ];
    });
    assert.equal(op.status, 'committed');
    assert.throws(() => store.get(v1Id),
      (e) => e.code === 'SPEC_STRUCTURED_REQUIRED');
    // Uncommitted operation receipts never become ownership.
    const created = store.create(input(f, { areaIds: [f.a] }));
    const commitAbs = path.join(f.journal, 'operations',
      created.journal.operationId, 'commit.json');
    fs.unlinkSync(commitAbs);
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_SPEC_NOT_COMMITTED');
    const loaded = getJournalOperation(f.bound, created.journal.operationId);
    recoverJournalOperation(f.bound, created.journal.operationId, {
      action: 'abandon-prepared', expectedIntentDigest: loaded.intentDigest,
      reason: 'test abandonment' });
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_SPEC_NOT_COMMITTED');
  } finally { cleanup(f.dir); }
});

test('forged sidecars, wrong companion events and mismatched proofs are malformed', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
    const ownRel = `${f.state}/record-ownership/spec/${created.record.id}.json`;
    const ownAbs = path.join(f.dir, ...ownRel.split('/'));
    const ownership = JSON.parse(fs.readFileSync(ownAbs, 'utf8'));
    const mutate = (patch) => {
      fs.writeFileSync(ownAbs, json({ ...ownership, ...patch }));
      assert.throws(() => store.get(created.record.id),
        (e) => e.code === 'OWNED_SPEC_MALFORMED');
    };
    mutate({ recordId: crypto.randomUUID() });
    mutate({ sourceRel: 'other/path.json' });
    mutate({ sourceHash: 'b'.repeat(64) });
    mutate({ createdAt: '2026-11-16T10:00:00.001Z' });
    mutate({ scope: scopeOf(f, [f.a]) });
    fs.writeFileSync(ownAbs, json(ownership));
    assert.equal(store.get(created.record.id).isCurrentSource, true);
    // A committed single-event operation is not two-event proof.
    const single = applyJournaledCreation(f.bound, [{ sourceKind: 'spec',
      recordId: created.record.id, sourceRevision: 0, areaIds: [f.a],
      file: { rel: `${f.plans}/specs/${crypto.randomUUID()}.json`,
        content: json(created.record) } }]);
    assert.equal(single.status, 'committed');
    fs.writeFileSync(ownAbs, json({ ...ownership, operationId: single.operationId }));
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_SPEC_MALFORMED');
    // A two-event operation with the wrong companion kind is not proof.
    const bogus = applyJournaledCreation(f.bound, [
      { sourceKind: 'spec', recordId: created.record.id, sourceRevision: 0,
        areaIds: [f.a],
        file: { rel: `${f.plans}/specs/${crypto.randomUUID()}.json`,
          content: json(created.record) } },
      { sourceKind: 'task', recordId: created.record.id, sourceRevision: 0,
        areaIds: [f.a],
        file: { rel: `${f.state}/record-ownership/spec/${crypto.randomUUID()}.json`,
          content: json(ownership) } }]);
    assert.equal(bogus.status, 'committed');
    fs.writeFileSync(ownAbs, json({ ...ownership, operationId: bogus.operationId }));
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_SPEC_MALFORMED');
  } finally { cleanup(f.dir); }
});

test('current source drift, missing, non-regular and oversized reads fail closed', (t) => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
    const srcAbs = path.join(f.dir, ...created.sourceRel.split('/'));
    const bytes = fs.readFileSync(srcAbs);
    fs.writeFileSync(srcAbs, json({ ...created.record, title: 'drifted' }));
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_SPEC_SOURCE_CHANGED');
    fs.unlinkSync(srcAbs);
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_SPEC_NOT_FOUND');
    fs.mkdirSync(srcAbs, { recursive: true });
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_SPEC_SOURCE_CHANGED');
    fs.rmSync(srcAbs, { recursive: true });
    const target = makeTempDir('ownedspec-source-target');
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
    // A corrupted (present but wrong) snapshot fails its digest check;
    // only an absent snapshot is reported missing.
    const snapBytes = fs.readFileSync(snapRel);
    fs.appendFileSync(snapRel, Buffer.from([0]));
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'JOURNAL_SNAPSHOT_MISMATCH');
    fs.writeFileSync(snapRel, snapBytes);
    fs.unlinkSync(snapRel);
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'JOURNAL_SNAPSHOT_MISSING');
  } finally { cleanup(f.dir); }
});

test('sidecar drift, missing, malformed and non-regular files fail without returning history', (t) => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
    const ownAbs = path.join(f.dir, ...created.ownershipRel.split('/'));
    const bytes = fs.readFileSync(ownAbs);
    fs.appendFileSync(ownAbs, ' ');
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_SPEC_MALFORMED');
    fs.unlinkSync(ownAbs);
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_SPEC_NOT_FOUND');
    fs.mkdirSync(ownAbs, { recursive: true });
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_SPEC_MALFORMED');
    fs.rmSync(ownAbs, { recursive: true });
    // An oversized current sidecar is rejected by the document bound.
    fs.writeFileSync(ownAbs, Buffer.alloc(loadLimits().maxDocumentBytes + 1));
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'DOCUMENT_TOO_LARGE');
    fs.rmSync(ownAbs, { force: true });
    const target = makeTempDir('ownedspec-sidecar-target');
    try {
      writeFile(target, 'target.json', bytes);
      if (trySymlink(path.join(target, 'target.json'), ownAbs)) {
        assert.throws(() => store.get(created.record.id),
          (e) => e.code === 'SYMLINK_REJECTED');
        fs.rmSync(ownAbs, { force: true });
      }
    } finally { cleanup(target); }
    // Malformed JSON and non-UTF8 sidecars fail shape checks, never history.
    fs.writeFileSync(ownAbs, '{not json');
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_SPEC_MALFORMED');
    fs.writeFileSync(ownAbs, Buffer.from([0x7b, 0xff, 0x7d]));
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_SPEC_MALFORMED');
  } finally { cleanup(f.dir); }
});

// Genuine two-event committed proof whose internal contract is forged in
// exactly one place per variant: current bytes equal the snapshots, so only
// the cross-record checks can reject it.
function fakePair(f, mutate) {
  let recordId;
  const result = applyJournaledRecordCreation(f.bound, (identity) => {
    recordId = crypto.randomUUID();
    const sourceRel = `${f.plans}/specs/${recordId}.json`;
    const ownershipRel = `${f.state}/record-ownership/spec/${recordId}.json`;
    const scopeV = scopeOf(f, [f.a, f.b]);
    const data = { schemaVersion: 1, originalRequest: 'r',
      outcome: { statement: 's', evidencePlan: 'e' },
      requirements: [{ id: 'R', statement: 's',
        scenarios: [{ id: 'S', given: 'g', when: 'w', then: 't' }] }],
      scope: ['src/settings'], constraints: [], nonGoals: [],
      openQuestions: [] };
    const artifact = { schemaVersion: 2, id: recordId, kind: 'spec',
      title: 'T', body: renderSpecification('T', data), references: [],
      createdAt: identity.createdAt, data };
    const sourceBytes = Buffer.from(json(artifact), 'utf8');
    const ownership = { schemaVersion: 1, sourceKind: 'spec', recordId,
      sourceRevision: 0, sourceRel, sourceHash: sha256(sourceBytes),
      operationId: identity.operationId, scope: scopeV,
      createdAt: identity.createdAt };
    const pair = mutate({ artifact, ownership, sourceBytes, sourceRel,
      ownershipRel, scopeV });
    return [
      { sourceKind: 'spec', recordId, sourceRevision: 0, areaIds: [f.a, f.b],
        file: { rel: pair.sourceRel, content: pair.sourceBytes } },
      { sourceKind: 'record-ownership', recordId, sourceRevision: 0,
        areaIds: [f.a, f.b],
        file: { rel: pair.ownershipRel,
          content: Buffer.from(json(pair.ownership), 'utf8') } },
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
      // Sidecar hash disagrees with the spec event hash.
      (p) => ({ ...p, ownership: { ...p.ownership, sourceHash: 'c'.repeat(64) } }),
      // Artifact id disagrees with the proved record id.
      (p) => { const artifact = { ...p.artifact, id: crypto.randomUUID() };
        const sourceBytes = Buffer.from(json(artifact), 'utf8');
        return { ...p, artifact, sourceBytes,
          ownership: { ...p.ownership, sourceHash: sha256(sourceBytes) } }; },
      // Artifact time disagrees with the event/sidecar time.
      (p) => { const artifact = { ...p.artifact,
          createdAt: '2020-01-01T00:00:00.000Z' };
        const sourceBytes = Buffer.from(json(artifact), 'utf8');
        return { ...p, artifact, sourceBytes,
          ownership: { ...p.ownership, sourceHash: sha256(sourceBytes) } }; },
      // Source snapshot is not roundtrippable UTF-8.
      (p) => { const sourceBytes = Buffer.from(p.sourceBytes);
        const token = Buffer.from('"title": "T"');
        const start = sourceBytes.indexOf(token);
        assert.notEqual(start, -1);
        sourceBytes[start + Buffer.byteLength('"title": "')] = 0xff;
        return { ...p, sourceBytes,
          ownership: { ...p.ownership, sourceHash: sha256(sourceBytes) } }; },
    ]) {
      const pair = fakePair(f, mutate);
      assert.throws(() => store.get(pair.recordId),
        (e) => e.code === 'OWNED_SPEC_MALFORMED');
    }
  } finally { cleanup(f.dir); }
});

test('input mutation at the first IO cannot alter the validated record', () => {
  const f = fixture();
  try {
    const store = f.make();
    const in_ = input(f, { areaIds: [f.a] });
    const open = fs.openSync;
    fs.openSync = function (file, flags, ...args) {
      in_.specification.title = 'forged';
      in_.specification.originalRequest = 'forged request';
      in_.areaIds.push(f.b);
      return open.call(this, file, flags, ...args);
    };
    let created;
    try {
      created = store.create(in_);
    } finally { fs.openSync = open; }
    assert.equal(created.record.title, SPEC.title);
    assert.equal(created.record.data.originalRequest, SPEC.originalRequest);
    const got = store.get(created.record.id);
    assert.equal(got.record.title, SPEC.title);
    assert.deepEqual(got.ownership.scope.areaIds, [f.a]);
  } finally { cleanup(f.dir); }
});

test('prepare rejects unsafe destinations and stays read-only', (t) => {
  const f = fixture();
  try {
    const store = f.make();
    writeFile(f.dir, `${f.plans}/specs`, 'block');
    assert.throws(() => store.prepare(input(f)),
      (e) => e.code === 'FILE_ANCESTOR');
    fs.rmSync(path.join(f.dir, ...`${f.plans}/specs`.split('/')));
    const target = makeTempDir('ownedspec-dest-target');
    try {
      if (!trySymlink(target,
        path.join(f.dir, ...f.state.split('/'), 'record-ownership'))) {
        t.skip('directory junctions unavailable');
        return;
      }
      assert.throws(() => store.prepare(input(f)),
        (e) => e.code === 'SYMLINK_REJECTED');
      assert.deepEqual(fs.readdirSync(target), []);
      assert.equal(fs.existsSync(path.join(f.dir, f.plans, 'specs')), false);
    } finally { cleanup(target); }
  } finally { cleanup(f.dir); }
});

test('get revalidates the binding before reading the current source', () => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f));
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

test('stored scope paths that become junctions after creation fail the read', (t) => {
  const f = fixture();
  try {
    const store = f.make();
    const created = store.create(input(f, {
      specification: specIn({ scope: ['zzz-scope/leaf'] }) }));
    const target = makeTempDir('ownedspec-scope-target');
    try {
      writeFile(target, 'leaf', 'x');
      if (!trySymlink(target, path.join(f.dir, 'zzz-scope'))) {
        t.skip('directory junctions unavailable');
        return;
      }
      assert.throws(() => store.get(created.record.id),
        (e) => e.code !== 'OK' && e.code !== 'OWNED_SPEC_NOT_FOUND');
    } finally { cleanup(target); }
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
      result = store.create(input(f, { areaIds: [f.a] }));
    } finally { fs.openSync = open; }
    assert.equal(result.journal.status, 'unconfirmed');
    assert.equal(result.ownershipConfirmed, false);
    assert.equal(result.journal.eventIds.length, 2);
    assert.notEqual(result.journal.cause, null);
    assert.throws(() => store.get(result.record.id),
      (e) => e.code === 'OWNED_SPEC_NOT_FOUND');
  } finally { cleanup(f.dir); }
});

test('unconfirmed source and commit failures preserve receipts and deny reads', () => {
  const f = fixture();
  try {
    const store = f.make();
    const open = fs.openSync;
    const close = fs.closeSync;
    let fd = null;
    fs.openSync = function (file, flags, ...args) {
      const result = open.call(this, file, flags, ...args);
      if (String(file).includes(`${path.sep}outbox${path.sep}`)
          && flags === 'wx') fd = result;
      return result;
    };
    fs.closeSync = function (value) {
      const result = close.call(this, value);
      if (value === fd) {
        fd = null;
        writeFile(f.dir, `${f.plans}/specs`, 'block');
      }
      return result;
    };
    let unconfirmed;
    try {
      unconfirmed = store.create(input(f, { areaIds: [f.a] }));
    } finally { fs.openSync = open; fs.closeSync = close; }
    assert.equal(unconfirmed.mode, 'applied');
    assert.equal(unconfirmed.journal.status, 'unconfirmed');
    assert.equal(unconfirmed.ownershipConfirmed, false);
    assert.equal(unconfirmed.journal.eventIds.length, 2);
    assert.notEqual(unconfirmed.journal.cause, null);
    assert.throws(() => store.get(unconfirmed.record.id),
      (e) => e.code === 'OWNED_SPEC_NOT_FOUND');
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
      result = store.create(input(g, { areaIds: [g.a] }));
    } finally { fs.openSync = open; }
    assert.equal(result.journal.status, 'committed');
    assert.equal(result.journal.journalState, 'pending-finalization');
    assert.equal(result.ownershipConfirmed, false);
    assert.notEqual(result.journal.cause, null);
    assert.throws(() => store.get(result.record.id),
      (e) => e.code === 'OWNED_SPEC_NOT_COMMITTED');
  } finally { cleanup(g.dir); }
});

test('stale bindings are denied and custom plans/state paths are honored', () => {
  const f = fixture();
  try {
    const store = f.make();
    fs.unlinkSync(path.join(f.dir, f.state, 'workspace.json'));
    assert.throws(() => store.create(input(f, { areaIds: [f.a] })),
      (e) => e.code === 'WORKSPACE_STALE');
  } finally { cleanup(f.dir); }
  const g = fixture({ plans: 'custom/plans', state: 'meta/state' });
  try {
    const store = g.make();
    const created = store.create(input(g, { areaIds: [g.a] }));
    assert.equal(created.sourceRel,
      `custom/plans/specs/${created.record.id}.json`);
    assert.equal(created.ownershipRel,
      `meta/state/record-ownership/spec/${created.record.id}.json`);
    assert.equal(fs.existsSync(
      path.join(g.dir, 'docs/agent/plans/specs')), false);
    assert.equal(store.get(created.record.id).isCurrentSource, true);
  } finally { cleanup(g.dir); }
});
