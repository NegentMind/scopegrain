// Pure shared ownership primitives: closed nine-field sidecar shape for
// capture/spec revision0 only, canonical clones, no defaults.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRecordObject, cloneRecordJSON, isRecordTime, isRecordUUID,
  recordAreaIds, validateRecordOwnership, validateRecordScope,
} from '../src/core/record-ownership-data.mjs';
import { validateCaptureOwnership } from '../src/core/capture-data.mjs';

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const WS = '33333333-3333-4333-8333-333333333333';
const PRJ = '44444444-4444-4444-8444-444444444444';
const REPO = '55555555-5555-4555-8555-555555555555';
const AREA_A = '66666666-6666-4666-8666-666666666666';
const AREA_B = '77777777-7777-4777-8777-777777777777';
const TIME = '2026-11-16T10:00:00.000Z';

function scope(overrides = {}) {
  return { workspaceId: WS, projectId: PRJ, repositoryId: REPO,
    areaIds: [AREA_A, AREA_B], ...overrides };
}

function ownership(overrides = {}) {
  return { schemaVersion: 1, sourceKind: 'capture', recordId: ID1,
    sourceRevision: 0, sourceRel: 'mem/captures/x.json',
    sourceHash: 'a'.repeat(64), operationId: ID2, scope: scope(),
    createdAt: TIME, ...overrides };
}

test('capture and spec revision0 sidecars validate and return independent clones', () => {
  for (const kind of ['capture', 'spec']) {
    const input = ownership({ sourceKind: kind });
    const out = validateRecordOwnership(input, kind);
    assert.deepEqual(out, input);
    assert.notEqual(out, input);
    assert.notEqual(out.scope, input.scope);
    out.recordId = 'mutated';
    out.scope.areaIds.push('x');
    assert.equal(input.recordId, ID1);
    assert.equal(input.scope.areaIds.length, 2);
    input.sourceHash = 'b'.repeat(64);
    const again = validateRecordOwnership(ownership({ sourceKind: kind }), kind);
    assert.equal(again.sourceHash, 'a'.repeat(64));
  }
});

test('cross-kind, unsupported kinds, revisions and schema versions are rejected', () => {
  assert.throws(() => validateRecordOwnership(ownership(), 'spec'),
    (e) => e.code === 'RECORD_OWNERSHIP_MALFORMED');
  assert.throws(() => validateRecordOwnership(
    ownership({ sourceKind: 'spec' }), 'capture'),
    (e) => e.code === 'RECORD_OWNERSHIP_MALFORMED');
  assert.throws(() => validateRecordOwnership(
    ownership({ sourceKind: 'task' }), 'task'),
    (e) => e.code === 'RECORD_OWNERSHIP_MALFORMED');
  assert.throws(() => validateRecordOwnership(
    ownership({ sourceKind: 'design' }), 'design'),
    (e) => e.code === 'RECORD_OWNERSHIP_MALFORMED');
  assert.throws(() => validateRecordOwnership(
    ownership({ sourceRevision: 1 }), 'capture'),
    (e) => e.code === 'RECORD_OWNERSHIP_MALFORMED');
  assert.throws(() => validateRecordOwnership(
    ownership({ schemaVersion: 2 }), 'capture'),
    (e) => e.code === 'RECORD_OWNERSHIP_MALFORMED');
});

test('decorated, symbol-keyed, sparse and non-plain shapes are rejected without invoking accessors', () => {
  let called = 0;
  const getter = ownership();
  Object.defineProperty(getter, 'title',
    { enumerable: true, get() { called += 1; return 'x'; } });
  const sym = ownership();
  sym[Symbol('k')] = 1;
  const nonEnum = ownership();
  Object.defineProperty(nonEnum, 'hidden',
    { enumerable: false, value: 1 });
  for (const bad of [null, undefined, 'x', [], new Date(), getter, sym,
    nonEnum, ownership({ extra: 1 })]) {
    for (const kind of ['capture', 'spec']) {
      assert.throws(() => validateRecordOwnership(bad, kind),
        (e) => e.code === 'RECORD_OWNERSHIP_MALFORMED');
    }
  }
  assert.equal(called, 0);
  // A null-prototype object is still plain JSON data and accepted.
  const nullProto = Object.assign(Object.create(null), ownership());
  assert.doesNotThrow(() => validateRecordOwnership(nullProto, 'capture'));
});

test('unsafe sourceRel, hash, identifiers and time are rejected', () => {
  for (const patch of [
    { sourceRel: 'mem\\captures\\x.json' }, { sourceRel: '../x.json' },
    { sourceRel: '/abs/x.json' }, { sourceRel: 'a/./b.json' },
    { sourceRel: 'a//b.json' }, { sourceRel: 'C:/x.json' },
    { sourceRel: 'x.json ' }, { sourceHash: 'a'.repeat(63) },
    { sourceHash: 'A'.repeat(64) }, { sourceHash: 'g'.repeat(64) },
    { recordId: 'x' },
    { recordId: 'abcdef12-3456-4789-8abc-def012345678'.toUpperCase() },
    { operationId: 'x' }, { createdAt: '2026-11-16' },
    { createdAt: 'not-a-date' }, { createdAt: 1 },
  ]) {
    assert.throws(() => validateRecordOwnership(ownership(patch), 'capture'),
      (e) => e.code === 'RECORD_OWNERSHIP_MALFORMED');
  }
});

test('sourceHash requires a primitive string without coercion', () => {
  let calls = 0;
  const coercible = { [Symbol.toPrimitive]() { calls += 1; return 'a'.repeat(64); },
    toString() { calls += 1; return 'a'.repeat(64); } };
  for (const bad of [['a'.repeat(64)], new String('a'.repeat(64)),
    Symbol('hash'), coercible]) {
    for (const kind of ['capture', 'spec']) {
      assert.throws(() => validateRecordOwnership(
        ownership({ sourceKind: kind, sourceHash: bad }), kind),
        (e) => e.code === 'RECORD_OWNERSHIP_MALFORMED');
    }
    assert.throws(() => validateCaptureOwnership(
      ownership({ sourceHash: bad })),
      (e) => e.code === 'CAPTURE_MALFORMED');
  }
  assert.equal(calls, 0);
});

test('scope is closed: UUID identities, dense unique UUID areas', () => {
  for (const badScope of [
    { workspaceId: 'x' }, { projectId: 'x' }, { repositoryId: 'x' },
    { areaIds: [] }, { areaIds: ['x'] }, { areaIds: [AREA_A, AREA_A] },
    { extra: 1 }, scope({ areaIds: undefined }),
  ]) {
    const value = ownership({ scope: { ...scope(), ...badScope } });
    assert.throws(() => validateRecordOwnership(value, 'capture'),
      (e) => e.code === 'RECORD_OWNERSHIP_MALFORMED');
  }
  const subclass = ownership();
  subclass.scope.areaIds = new (class extends Array {})(...[AREA_A]);
  assert.throws(() => validateRecordOwnership(subclass, 'capture'),
    (e) => e.code === 'RECORD_OWNERSHIP_MALFORMED');
  const sparse = ownership();
  sparse.scope.areaIds = [AREA_A];
  sparse.scope.areaIds[2] = AREA_B;
  delete sparse.scope.areaIds[1];
  assert.throws(() => validateRecordOwnership(sparse, 'capture'),
    (e) => e.code === 'RECORD_OWNERSHIP_MALFORMED');
});

test('default code/labels and caller-selected overrides', () => {
  assert.throws(() => validateRecordOwnership({}, 'capture'), (e) =>
    e.code === 'RECORD_OWNERSHIP_MALFORMED'
    && e.message.includes('record ownership'));
  assert.throws(() => validateRecordOwnership({}, 'capture',
    { code: 'X_MALFORMED', label: 'spec ownership',
      scopeLabel: 'spec scope' }), (e) =>
    e.code === 'X_MALFORMED' && e.message.includes('spec ownership'));
  assert.throws(() => validateRecordOwnership(
    ownership({ scope: { bad: 1 } }), 'capture',
    { code: 'X', label: 'spec ownership', scopeLabel: 'spec scope' }),
    (e) => e.code === 'X' && e.message.includes('spec scope'));
});

test('primitives: UUID/time rules, JSON clone, dense area set, closed scope', () => {
  assert.equal(isRecordUUID(ID1), true);
  assert.equal(isRecordUUID('abcdef12-3456-4789-8abc-def012345678'.toUpperCase()),
    false);
  assert.equal(isRecordUUID(`${ID1} `), false);
  assert.equal(isRecordTime(TIME), true);
  assert.equal(isRecordTime('2026-11-16T10:00:00Z'), false);
  assert.equal(isRecordTime('Sat, 01 Jan 2022'), false);
  const cloned = cloneRecordJSON({ b: 1, a: [2] });
  assert.deepEqual(cloned, { b: 1, a: [2] });
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => cloneRecordJSON(cyclic),
    (e) => e.code === 'INVALID_JSON_VALUE');
  assert.throws(() => cloneRecordJSON({ v: undefined }),
    (e) => e.code === 'INVALID_JSON_VALUE');
  // recordAreaIds preserves input order (no sort) and returns a clone.
  const areas = [AREA_B, AREA_A];
  const out = recordAreaIds(areas, 'X', 'opt');
  assert.deepEqual(out, [AREA_B, AREA_A]);
  assert.notEqual(out, areas);
  for (const bad of [[], ['x'], [AREA_A, AREA_A], 'x', null,
    new (class extends Array {})(AREA_A)]) {
    assert.throws(() => recordAreaIds(bad, 'X', 'opt'), (e) => e.code === 'X');
  }
  assert.deepEqual(validateRecordScope(scope(), 'X', 's'), undefined);
  assert.throws(() => validateRecordScope(scope({ extra: 1 }), 'X', 's'),
    (e) => e.code === 'X');
  assert.throws(() => assertRecordObject({ a: 1 }, ['a'], ['a', 'b'], 'X', 'o'),
    (e) => e.code === 'X' && e.message.includes('missing'));
});

test('capture ownership delegates with its domain code and labels', () => {
  const valid = ownership();
  assert.deepEqual(validateCaptureOwnership(valid), valid);
  assert.throws(() => validateCaptureOwnership(
    ownership({ sourceKind: 'spec' })),
    (e) => e.code === 'CAPTURE_MALFORMED');
  assert.throws(() => validateCaptureOwnership(ownership({ scope: { x: 1 } })),
    (e) => e.code === 'CAPTURE_MALFORMED'
      && e.message.includes('capture scope'));
});
