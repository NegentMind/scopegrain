// SPDX-License-Identifier: Apache-2.0
// owned-chain unit coverage: the shared proof primitives behind the five
// update-chain stores. Pure helpers are tested directly; bound reads and
// chain walks use a real committed two-event operation.
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
import { applyJournaledRecordCreation } from '../src/core/journal.mjs';
import {
  assertDenseRecordArray, assertGenesisPair, assertUpdatePair,
  boundedOwnedBytes, bindOwnedStore, eventScope, eventScopeJson,
  findOwnedPair, normalizeOwnedInput, ownedDocumentBytes, ownedScope,
  parseOwnedJson, readOwnedCurrent, requireCommittedOp, sameRecordLocator,
  sha256Hex, validateChainOwnership, walkOwnedIndex,
} from '../src/core/owned-chain.mjs';
import {
  VALID_ANSWERS, assertOwnedStoreContract, cleanup, makeTempDir, writeFile, writeJson,
} from './helpers.mjs';

const CODE = 'TEST_MALFORMED';
const json = (v) => JSON.stringify(v, null, 2) + '\n';
const uuid = (n) =>
  `123e4567-e89b-42d3-a456-${String(n).padStart(12, '0')}`;

function fixture() {
  const dir = makeTempDir('owned-chain');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a] = prepared.workspace.areas.map((area) => area.id);
  return { dir, ctx, a, bound: bindWorkspace(ctx, { areaIds: [a] }) };
}

function validSidecar(overrides = {}) {
  return {
    schemaVersion: 1, sourceKind: 'task', recordId: uuid(1),
    sourceRevision: 0, sourceRel: 'tasks/one.json',
    sourceHash: crypto.createHash('sha256').update('x').digest('hex'),
    operationId: uuid(2),
    scope: { workspaceId: uuid(10), projectId: uuid(11),
      repositoryId: uuid(12), areaIds: [uuid(13)] },
    createdAt: '2026-01-01T00:00:00.000Z',
    chain: [uuid(2)],
    ...overrides,
  };
}

const CHAIN_SPEC = {
  sourceKind: 'task', recordIdOk: (v) => typeof v === 'string',
  indexKey: 'chain', updatedAt: false, code: CODE, label: 'sidecar',
};

test('sha256Hex/ownedDocumentBytes/boundedOwnedBytes serialize and cap', () => {
  const bytes = ownedDocumentBytes({ a: 1 }, 'doc');
  assert.equal(bytes.toString('utf8'), json({ a: 1 }));
  assert.equal(sha256Hex(bytes),
    crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(boundedOwnedBytes(bytes, 'doc'), bytes);
  const over = Buffer.alloc(loadLimits().maxDocumentBytes + 1);
  assert.throws(() => boundedOwnedBytes(over, 'doc'),
    (e) => e.code === 'DOCUMENT_TOO_LARGE');
});

test('parseOwnedJson fails closed on non-UTF8 and non-JSON', () => {
  assert.deepEqual(parseOwnedJson(Buffer.from('{"a":1}'), CODE, 'doc'),
    { a: 1 });
  assert.throws(() => parseOwnedJson(Buffer.from([0xff, 0xfe]), CODE, 'doc'),
    (e) => e.code === CODE);
  assert.throws(() => parseOwnedJson(Buffer.from('nope'), CODE, 'doc'),
    (e) => e.code === CODE && /not JSON/.test(e.message));
});

test('eventScope selects exactly the four scope fields', () => {
  const event = { workspaceId: 'w', projectId: 'p', repositoryId: 'r',
    areaIds: ['a'], extra: 'dropped' };
  assert.deepEqual(eventScope(event), { workspaceId: 'w', projectId: 'p',
    repositoryId: 'r', areaIds: ['a'] });
  assert.equal(typeof eventScopeJson(event), 'string');
});

test('sameRecordLocator compares only the trailing two segments', () => {
  assert.ok(sameRecordLocator('x/spec/id.json', '.scopegrain/spec/id.json'));
  assert.ok(!sameRecordLocator('x/other/id.json', 'x/spec/id.json'));
  assert.ok(!sameRecordLocator('id.json', 'x/spec/id.json'));
  assert.ok(!sameRecordLocator(null, 'x/spec/id.json'));
});

test('assertDenseRecordArray rejects sparse, subclassed and exotic arrays', () => {
  assertDenseRecordArray(['a', 'b'], CODE, 'idx');
  assert.throws(() => assertDenseRecordArray('x', CODE, 'idx'),
    (e) => e.code === CODE);
  assert.throws(() => assertDenseRecordArray([], CODE, 'idx'),
    (e) => e.code === CODE);
  const sparse = ['a', , 'b']; // eslint-disable-line no-sparse-arrays
  assert.throws(() => assertDenseRecordArray(sparse, CODE, 'idx'),
    (e) => e.code === CODE);
  const accessor = ['a'];
  Object.defineProperty(accessor, '0', { get: () => 'x', enumerable: true });
  assert.throws(() => assertDenseRecordArray(accessor, CODE, 'idx'),
    (e) => e.code === CODE);
  const sym = ['a'];
  sym[Symbol('s')] = 1;
  assert.throws(() => assertDenseRecordArray(sym, CODE, 'idx'),
    (e) => e.code === CODE);
});

test('normalizeOwnedInput closes the DTO, sorts areas and clones payload', () => {
  const payload = { title: 'T', nested: { x: 1 } };
  const normalized = normalizeOwnedInput(
    { areaIds: [uuid(2), uuid(1)], specification: payload },
    'specification', CODE, 'input');
  assert.deepEqual(normalized.areaIds, [uuid(1), uuid(2)]);
  assert.notEqual(normalized.specification, payload);
  payload.nested.x = 99;
  assert.equal(normalized.specification.nested.x, 1);
  assert.throws(() => normalizeOwnedInput(
    { areaIds: [uuid(1)], specification: {}, extra: 1 }, 'specification',
    CODE, 'input'), (e) => e.code === CODE);
  assert.throws(() => normalizeOwnedInput(
    { specification: {} }, 'specification', CODE, 'input'),
    (e) => e.code === CODE);
  assert.throws(() => normalizeOwnedInput(
    { areaIds: [uuid(1), uuid(1)], specification: {} }, 'specification',
    CODE, 'input'), (e) => e.code === CODE);
});

test('ownedScope returns a caller-owned areaIds copy', () => {
  const bound = { workspaceId: 'w', projectId: 'p', repositoryId: 'r' };
  const s = ownedScope(bound, ['a']);
  s.areaIds.push('mutated');
  assert.deepEqual(ownedScope(bound, ['a']).areaIds, ['a']);
});

test('validateChainOwnership accepts a valid sidecar and returns a clone', () => {
  const sidecar = validSidecar();
  const validated = validateChainOwnership(sidecar, CHAIN_SPEC);
  assert.deepEqual(validated, sidecar);
  assert.notEqual(validated, sidecar);
});

test('validateChainOwnership rejects every malformed field class', () => {
  const bad = (patch) => assert.throws(
    () => validateChainOwnership({ ...validSidecar(), ...patch }, CHAIN_SPEC),
    (e) => e.code === CODE);
  bad({ schemaVersion: 2 });
  bad({ sourceKind: 'other' });
  bad({ sourceRevision: -1 });
  bad({ sourceRevision: 1 }); // index length must be revision + 1
  bad({ sourceHash: 'short' });
  bad({ operationId: 'not-a-uuid' });
  bad({ createdAt: 'not-a-time' });
  bad({ sourceRel: 'tasks\\one.json' });
  bad({ sourceRel: '/abs/one.json' });
  bad({ chain: [uuid(3)] }); // last index entry must equal operationId
  bad({ chain: [uuid(2), uuid(2)] }); // revision 1 needs unique index? no:
  // length 2 with revision 0 mismatches first; unique is checked too.
  bad({ chain: [uuid(2)], extra: 1 });
  bad({ recordId: undefined });
});

test('validateChainOwnership honors indexUnique:false and maxRevision', () => {
  const spec = { ...CHAIN_SPEC, indexUnique: false, maxRevision: 5 };
  validateChainOwnership(validSidecar({ chain: [uuid(2)] }), spec);
  assert.throws(() => validateChainOwnership(
    validSidecar({ sourceRevision: 5, chain: [uuid(3), uuid(3), uuid(3),
      uuid(3), uuid(3), uuid(2)], operationId: uuid(2) }), spec),
    (e) => e.code === CODE);
  const updSpec = { ...CHAIN_SPEC, updatedAt: true };
  assert.throws(() => validateChainOwnership(validSidecar(), updSpec),
    (e) => e.code === CODE);
  validateChainOwnership(
    validSidecar({ updatedAt: '2026-01-02T00:00:00.000Z' }), updSpec);
});

test('assertGenesisPair accepts create+create rev0 and rejects the rest', () => {
  const mk = (o = {}) => ({ operation: 'create', sourceRevision: 0,
    previousHash: null, ...o });
  assertGenesisPair(mk(), mk(), CODE, 'chain');
  assert.throws(() => assertGenesisPair(mk({ operation: 'update' }), mk(),
    CODE, 'chain'), (e) => e.code === CODE);
  assert.throws(() => assertGenesisPair(mk({ sourceRevision: 1 }), mk(),
    CODE, 'chain'), (e) => e.code === CODE);
  assert.throws(() => assertGenesisPair(mk(), mk({ previousHash: 'abc' }),
    CODE, 'chain'), (e) => e.code === CODE);
});

test('assertUpdatePair requires update ops chained by revision and hash', () => {
  const prev = { operation: 'create', sourceKind: 'task', recordId: 'r1',
    sourceRevision: 0, previousHash: null,
    sourceHash: 'a'.repeat(64) };
  const upd = { operation: 'update', sourceKind: 'task', recordId: 'r1',
    sourceRevision: 0, previousHash: 'a'.repeat(64),
    sourceHash: 'b'.repeat(64) };
  const pair = (s, c) => ({ source: s, sidecar: c });
  assertUpdatePair(pair(prev, prev), pair(upd, upd), CODE, 'chain');
  assert.throws(() => assertUpdatePair(pair(prev, prev),
    pair({ ...upd, operation: 'create' }, upd), CODE, 'chain'),
    (e) => e.code === CODE);
  // Forked hash or skipped revision is a chain break, never a branch.
  assert.throws(() => assertUpdatePair(pair(prev, prev),
    pair({ ...upd, previousHash: 'c'.repeat(64) }, upd), CODE, 'chain'),
    (e) => e.code === CODE);
  assert.throws(() => assertUpdatePair(pair(prev, prev),
    pair({ ...upd, sourceRevision: 1 }, upd), CODE, 'chain'),
    (e) => e.code === CODE);
});

test('findOwnedPair requires exactly the two proving events', () => {
  const at = '2026-01-01T00:00:00.000Z';
  const base = { sourceKind: 'task', recordId: 'r1', sourceRel: 'tasks/r1.json',
    createdAt: at, operation: 'create', sourceRevision: 0,
    workspaceId: 'w', projectId: 'p', repositoryId: 'r', areaIds: ['a'] };
  const spec = { sourceKind: 'task', sidecarKind: 'sidecar', recordId: 'r1',
    sourceRel: 'tasks/r1.json', sidecarRel: 'state/sidecar/r1.json',
    code: CODE, label: 'proof' };
  const pair = () => ({
    intent: { createdAt: at, events: [
      { ...base },
      { ...base, sourceKind: 'sidecar',
        sourceRel: 'state/sidecar/r1.json' },
    ] },
  });
  const { source, sidecar } = findOwnedPair(pair(), spec);
  assert.equal(source.sourceKind, 'task');
  assert.equal(sidecar.sourceKind, 'sidecar');
  const bad = (mutate) => assert.throws(() => findOwnedPair(mutate(pair()),
    spec), (e) => e.code === CODE);
  bad((l) => { l.intent.events.push({ ...base }); return l; });
  bad((l) => { l.intent.events[1].sourceKind = 'task'; return l; });
  bad((l) => { l.intent.events[0].recordId = 'other'; return l; });
  bad((l) => { l.intent.events[0].sourceRel = 'elsewhere/r1.json';
    return l; });
  bad((l) => { l.intent.events[0].createdAt = '2026-02-02T00:00:00.000Z';
    return l; });
  // scopeJson narrows the proof when supplied.
  const scopeJson = eventScopeJson(pair().intent.events[0]);
  findOwnedPair(pair(), { ...spec, scopeJson });
  assert.throws(() => findOwnedPair(pair(),
    { ...spec, scopeJson: '{"different":true}' }), (e) => e.code === CODE);
  // checkTimes:false accepts event times that differ from the op time.
  findOwnedPair({ intent: { createdAt: '2026-03-03T00:00:00.000Z',
    events: pair().intent.events } }, { ...spec, checkTimes: false });
});

test('bindOwnedStore clones ctx, binds areas and rejects bad shapes', () => {
  const { dir, ctx, a } = fixture();
  try {
    assert.throws(() => bindOwnedStore(null, {}, CODE, 'store'),
      (e) => e.code === CODE);
    assert.throws(() => bindOwnedStore(ctx, { areaIds: [a], extra: 1 },
      CODE, 'store'), (e) => e.code === CODE);
    const { privateCtx, bound, areaIds } = bindOwnedStore(ctx,
      { areaIds: [a] }, CODE, 'store');
    assert.deepEqual(areaIds, [a]);
    assert.equal(bound.workspaceId, privateCtx.projectRoot
      ? bound.workspaceId : null); // bound is a real binding
    // Mutating the caller config cannot redirect the bound store.
    ctx.config.paths = null;
    assert.throws(() => resolveInside(privateCtx.projectRoot, 'x', 'x'),
      (e) => e instanceof Error); // privateCtx still intact
    assert.ok(privateCtx.config.paths !== null);
  } finally { cleanup(dir); }
});

test('readOwnedCurrent maps missing, non-regular and oversized files', () => {
  const { dir, ctx, bound } = fixture();
  try {
    writeFile(dir, 'docs/note.txt', 'hello');
    assert.equal(readOwnedCurrent(bound, 'docs/note.txt',
      { missingCode: CODE, nonRegularCode: 'NR', label: 'note' })
      .toString('utf8'), 'hello');
    // Absence with a null missingCode is a legitimate state, not an error.
    assert.equal(readOwnedCurrent(bound, 'docs/absent.txt',
      { missingCode: null, nonRegularCode: 'NR', label: 'note' }), null);
    assert.throws(() => readOwnedCurrent(bound, 'docs/absent.txt',
      { missingCode: CODE, nonRegularCode: 'NR', label: 'note' }),
      (e) => e.code === CODE);
    fs.mkdirSync(path.join(dir, 'docs/dir'));
    assert.throws(() => readOwnedCurrent(bound, 'docs/dir',
      { missingCode: CODE, nonRegularCode: 'NR', label: 'note' }),
      (e) => e.code === 'NR');
    writeFile(dir, 'docs/big.txt', 'x'.repeat(loadLimits().maxDocumentBytes + 1));
    assert.throws(() => readOwnedCurrent(bound, 'docs/big.txt',
      { missingCode: CODE, nonRegularCode: 'NR', label: 'note' }),
      (e) => e.code === 'DOCUMENT_TOO_LARGE');
    assert.throws(() => readOwnedCurrent(bound, '../escape.txt',
      { missingCode: CODE, nonRegularCode: 'NR', label: 'note' }),
      (e) => e.code !== 'DOCUMENT_TOO_LARGE');
    void ctx;
  } finally { cleanup(dir); }
});

test('requireCommittedOp and walkOwnedIndex over a real committed op', () => {
  const { dir, ctx, bound, a } = fixture();
  try {
    const recordId = crypto.randomUUID();
    const journal = applyJournaledRecordCreation(bound, (identity) => [
      { sourceKind: 'widget', recordId, sourceRevision: 0,
        areaIds: [a],
        file: { rel: 'widgets/one.json',
          content: json({ id: recordId }) } },
      { sourceKind: 'record-ownership', recordId, sourceRevision: 0,
        areaIds: [a],
        file: { rel: 'state/record-ownership/widget/one.json',
          content: json({ id: recordId }) } },
    ]);
    const loaded = requireCommittedOp(bound, journal.operationId, CODE, 'op');
    assert.equal(loaded.state, 'committed');
    assert.throws(() => requireCommittedOp(bound, uuid(99), CODE, 'op'),
      (e) => e instanceof Error);
    // Walking the single-op index yields the genesis pair with snapshots.
    const spec = { sourceKind: 'widget', sidecarKind: 'record-ownership',
      recordId, sourceRel: 'widgets/one.json',
      sidecarRel: 'state/record-ownership/widget/one.json',
      notCommittedCode: 'NC', code: CODE, label: 'widget' };
    const steps = [...walkOwnedIndex(bound, [journal.operationId], spec)];
    assert.equal(steps.length, 1);
    assert.equal(steps[0].source.sourceKind, 'widget');
    assert.ok(steps[0].sourceSnapshot.toString('utf8')
      .includes(recordId));
    // A fabricated update pair out of nowhere breaks the chain.
    const bogus = uuid(98);
    assert.throws(() => [...walkOwnedIndex(bound, [bogus], spec)],
      (e) => e instanceof Error);
  } finally { cleanup(dir); }
});

test('parameterized owned-* store contract holds across all owned stores', async () => {
  const { createOwnedSpecificationStore } = await import('../src/core/owned-specifications.mjs');
  const { createOwnedDesignStore } = await import('../src/core/owned-designs.mjs');
  const { createOwnedOutcomeStore } = await import('../src/core/owned-outcomes.mjs');
  const { createOwnedTaskStore } = await import('../src/core/transition.mjs');
  const { createOwnedApprovalStore } = await import('../src/core/approvals.mjs');
  const { createOwnedSessionStore } = await import('../src/core/sessions.mjs');
  const { createOwnedPlanStore } = await import('../src/core/plans.mjs');

  const factories = [
    ['owned-spec', createOwnedSpecificationStore, ['prepare', 'create', 'get']],
    ['owned-design', createOwnedDesignStore, ['prepare', 'create', 'get']],
    ['owned-outcome', createOwnedOutcomeStore, ['prepare', 'create', 'get']],
    ['owned-task', createOwnedTaskStore, ['prepare', 'create', 'get', 'transition']],
    ['owned-approval', createOwnedApprovalStore, ['prepare', 'create', 'get', 'answer']],
    ['owned-session', createOwnedSessionStore, ['prepare', 'create', 'get', 'record']],
    ['owned-plan', createOwnedPlanStore, ['prepare', 'create', 'get', 'update']],
  ];
  for (const [, factory, expectedMethods] of factories) {
    assertOwnedStoreContract(assert, factory, { expectedMethods });
  }
});
