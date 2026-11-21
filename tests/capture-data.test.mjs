// SPDX-License-Identifier: Apache-2.0
// Closed data contracts for selective capture notes: input normalization,
// store options and stored note/ownership validators. Pure checks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeCaptureInput, validateCaptureNote, validateCaptureOwnership,
  validateCaptureStoreOptions,
} from '../src/core/capture-data.mjs';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const W = '33333333-3333-3333-3333-333333333333';
const P = '44444444-4444-4444-4444-444444444444';
const R = '55555555-5555-5555-5555-555555555555';
const N = '66666666-6666-6666-6666-666666666666';
const O = '77777777-7777-7777-7777-777777777777';
const HASH = 'a'.repeat(64);

function scope(overrides = {}) {
  return { workspaceId: W, projectId: P, repositoryId: R, areaIds: [A], ...overrides };
}

function note(overrides = {}) {
  return {
    schemaVersion: 1, kind: 'scopegrain.capture', id: N, revision: 0,
    category: 'event', title: 'Title', summary: 'Summary',
    scope: scope(), provenance: { basis: 'inferred', origin: 'local-cli' },
    subjectId: null, supersedes: null, capturedAt: '2026-11-16T10:00:00.000Z',
    ...overrides,
  };
}

function ownership(overrides = {}) {
  return {
    schemaVersion: 1, sourceKind: 'capture', recordId: N, sourceRevision: 0,
    sourceRel: '.tasksystem/memory/captures/66666666-6666-6666-6666-666666666666.json',
    sourceHash: HASH, operationId: O, scope: scope(),
    createdAt: '2026-11-16T10:00:00.000Z', ...overrides,
  };
}

test('all nine categories normalize with defaults, sorted unique areas and clones', () => {
  const categories = ['decision', 'event', 'attempt', 'discard', 'preference',
    'tool', 'skill', 'stack', 'lesson'];
  for (const category of categories) {
    const input = { category, title: '  spaced title  ', summary: 'S',
      areaIds: [B, A] };
    if (category === 'preference') input.subjectId = 'subject-1';
    const normalized = normalizeCaptureInput(input);
    assert.equal(normalized.category, category);
    assert.equal(normalized.title, '  spaced title  ');
    assert.equal(normalized.basis, 'inferred');
    assert.equal(normalized.subjectId, category === 'preference' ? 'subject-1' : null);
    assert.equal(normalized.supersedes, null);
    assert.deepEqual(normalized.areaIds, [A, B]);
    normalized.areaIds.push(W);
    assert.equal(normalizeCaptureInput(input).areaIds.length, 2);
    input.areaIds.push(W);
    assert.equal(normalizeCaptureInput(input).areaIds.length, 3);
  }
});

test('declared basis and literal fields are preserved without claims', () => {
  const result = normalizeCaptureInput({ category: 'decision', title: 'T',
    summary: 'S', areaIds: [A], basis: 'declared', subjectId: 'me',
    supersedes: N });
  assert.equal(result.basis, 'declared');
  assert.equal(result.subjectId, 'me');
  assert.equal(result.supersedes, N);
  const again = normalizeCaptureInput({ category: 'decision', title: 'T',
    summary: 'S', areaIds: [A], basis: 'declared', subjectId: 'me',
    supersedes: N });
  assert.notEqual(again.areaIds, result.areaIds);
  assert.deepEqual(again, result);
});

test('capture input rejects invalid, forged or decorated values', () => {
  const base = { category: 'event', title: 'T', summary: 'S', areaIds: [A] };
  const getter = { ...base };
  Object.defineProperty(getter, 'title', { enumerable: true, get() { throw new Error('no'); } });
  const inherited = Object.assign(Object.create({ hidden: 1 }), base);
  class Arr extends Array { }
  const sparse = new Array(1);
  const decorated = [A];
  decorated.extra = 'x';
  const nonEnumerable = [A];
  Object.defineProperty(nonEnumerable, '0', { value: A, enumerable: false });
  for (const input of [
    null, 7, 'x', [], () => {}, getter, inherited,
    { ...base, extra: true }, { ...base, category: 'other' },
    { ...base, title: '   ' }, { ...base, summary: '' },
    { ...base, title: 1 }, { ...base, areaIds: 'a' },
    { ...base, areaIds: [] }, { ...base, areaIds: ['x'] },
    { ...base, areaIds: [A, A] }, { ...base, areaIds: [A, null] },
    { ...base, areaIds: sparse }, { ...base, areaIds: decorated },
    { ...base, areaIds: nonEnumerable }, { ...base, areaIds: new Arr(A) },
    { ...base, basis: 'guessed' }, { ...base, basis: null },
    { ...base, subjectId: '' }, { ...base, subjectId: 1 },
    { ...base, supersedes: 'x' }, { ...base, supersedes: 1 },
    { category: 'preference', title: 'T', summary: 'S', areaIds: [A] },
    { category: 'preference', title: 'T', summary: 'S', areaIds: [A], subjectId: null },
    { category: 'preference', title: 'T', summary: 'S', areaIds: [A], subjectId: '  ' },
    { title: 'T', summary: 'S', areaIds: [A] },
    { category: 'event', summary: 'S', areaIds: [A] },
    { category: 'event', title: 'T', areaIds: [A] },
    { category: 'event', title: 'T', summary: 'S' },
  ]) {
    assert.throws(() => normalizeCaptureInput(input),
      (e) => e.code === 'INVALID_CAPTURE_INPUT');
  }
});

test('store options are a closed {areaIds,origin} object', () => {
  const options = { areaIds: [B, A], origin: 'local-cli' };
  const checked = validateCaptureStoreOptions(options);
  assert.deepEqual(checked.areaIds, [B, A]);
  checked.areaIds.push(W);
  assert.equal(options.areaIds.length, 2);
  for (const value of [
    null, {}, { areaIds: [A] }, { origin: 'local-cli' },
    { ...options, extra: 1 }, { areaIds: [A], origin: 'Local' },
    { areaIds: [A], origin: '-lead' }, { areaIds: [A], origin: 'a_b' },
    { areaIds: [A], origin: 'x'.repeat(65) }, { areaIds: ['x'], origin: 'ok' },
    { areaIds: [A, A], origin: 'ok' }, { areaIds: [], origin: 'ok' },
  ]) {
    assert.throws(() => validateCaptureStoreOptions(value),
      (e) => e.code === 'INVALID_CAPTURE_INPUT');
  }
});

test('stored note accepts every category and returns an independent clone', () => {
  for (const category of ['decision', 'event', 'attempt', 'discard', 'preference',
    'tool', 'skill', 'stack', 'lesson']) {
    const value = note({ category, subjectId: category === 'preference' ? 's' : null });
    const checked = validateCaptureNote(value);
    assert.deepEqual(checked, value);
    checked.scope.areaIds.push(B);
    assert.equal(value.scope.areaIds.length, 1);
    checked.title = 'mutated';
    assert.equal(value.title, 'Title');
  }
  const linked = note({ supersedes: B, category: 'decision' });
  assert.equal(validateCaptureNote(linked).supersedes, B);
});

test('stored note rejects malformed shape, scope, provenance and identity', () => {
  class Arr extends Array { }
  const nonEnumScope = scope();
  Object.defineProperty(nonEnumScope.areaIds, '0', { value: A, enumerable: false });
  const cases = [
    null, [], 'x', { ...note(), extra: 1 }, note({ schemaVersion: 2 }),
    note({ kind: 'other' }), note({ id: 'x' }), note({ revision: 1 }),
    note({ category: 'none' }), note({ title: ' ' }), note({ summary: 2 }),
    note({ scope: null }), note({ scope: { ...scope(), extra: 1 } }),
    note({ scope: scope({ workspaceId: 'x' }) }),
    note({ scope: scope({ areaIds: [] }) }),
    note({ scope: scope({ areaIds: [A, A] }) }),
    note({ scope: scope({ areaIds: ['x'] }) }),
    note({ scope: { ...scope(), areaIds: new Arr(A) } }),
    note({ scope: nonEnumScope }),
    note({ provenance: { basis: 'declared', origin: 'o', extra: 1 } }),
    note({ provenance: { basis: 'verified', origin: 'o' } }),
    note({ provenance: { basis: 'inferred', origin: 'Bad' } }),
    note({ subjectId: '' }), note({ subjectId: 3 }),
    note({ category: 'preference', subjectId: null }),
    note({ supersedes: 'x' }), note({ supersedes: N }),
    note({ capturedAt: '2026-11-16' }), note({ capturedAt: 'not a date' }),
    note({ capturedAt: '2026-11-16T10:00:00.000+00:00' }),
  ];
  for (const value of cases) {
    assert.throws(() => validateCaptureNote(value),
      (e) => e.code === 'CAPTURE_MALFORMED');
  }
});

test('stored ownership accepts canonical shape and returns an independent clone', () => {
  const value = ownership();
  const checked = validateCaptureOwnership(value);
  assert.deepEqual(checked, value);
  checked.scope.areaIds.push(B);
  assert.equal(value.scope.areaIds.length, 1);
});

test('stored ownership rejects malformed fields and non-canonical paths', () => {
  for (const value of [
    null, [], ownership({ extra: 1 }), ownership({ schemaVersion: 0 }),
    ownership({ sourceKind: 'task' }), ownership({ recordId: 'x' }),
    ownership({ sourceRevision: 1 }), ownership({ sourceRel: 'a\\b/c.json' }),
    ownership({ sourceRel: '../x.json' }), ownership({ sourceRel: 'a/../b.json' }),
    ownership({ sourceRel: '/abs/x.json' }), ownership({ sourceRel: 'C:/x.json' }),
    ownership({ sourceRel: 'a//b.json' }), ownership({ sourceRel: './x.json' }),
    ownership({ sourceRel: 'a/./b.json' }), ownership({ sourceRel: '' }),
    ownership({ sourceRel: 'a/x.json ' }), ownership({ sourceHash: 'z'.repeat(64) }),
    ownership({ sourceHash: HASH.slice(0, 63) }), ownership({ operationId: 'x' }),
    ownership({ scope: scope({ areaIds: [A, A] }) }),
    ownership({ scope: scope({ repositoryId: 'x' }) }),
    ownership({ createdAt: 'yesterday' }),
    ownership({ createdAt: '2026-11-16 10:00:00' }),
  ]) {
    assert.throws(() => validateCaptureOwnership(value),
      (e) => e.code === 'CAPTURE_MALFORMED');
  }
});

test('schema files encode the closed contracts literally', () => {
  const noteSchema = JSON.parse(fs.readFileSync(
    new URL('../schemas/capture.schema.json', import.meta.url), 'utf8'));
  const ownSchema = JSON.parse(fs.readFileSync(
    new URL('../schemas/record-ownership.schema.json', import.meta.url), 'utf8'));
  assert.equal(noteSchema.additionalProperties, false);
  assert.equal(noteSchema.properties.kind.const, 'scopegrain.capture');
  assert.deepEqual(noteSchema.properties.category.enum.sort(), [
    'attempt', 'decision', 'discard', 'event', 'lesson', 'preference',
    'skill', 'stack', 'tool']);
  assert.deepEqual(noteSchema.required, ['schemaVersion', 'kind', 'id', 'revision',
    'category', 'title', 'summary', 'scope', 'provenance', 'subjectId',
    'supersedes', 'capturedAt']);
  assert.equal(ownSchema.additionalProperties, false);
  assert.equal(ownSchema.properties.sourceKind.const, 'capture');
  assert.equal(ownSchema.properties.sourceRevision.const, 0);
  assert.deepEqual(ownSchema.required, ['schemaVersion', 'sourceKind', 'recordId',
    'sourceRevision', 'sourceRel', 'sourceHash', 'operationId', 'scope',
    'createdAt']);
});
