// Journaled mutable-record updates: CAS on previousHash + expected
// sourceRevision, temp+rename apply inside the journal lock, identical
// prepared/committed recovery semantics. Create-path behavior unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { canonicalDigest } from '../src/core/digests.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import {
  applyJournaledRecordCreation, applyJournaledRecordUpdate,
  getJournalEvent, getJournalOperation, listJournalPending,
  prepareJournalRecovery, readJournalSnapshot, recoverJournalOperation,
} from '../src/core/journal.mjs';
import {
  isJournalOperation, resultingSourceRevision, validateRecordTransition,
  validateUpdateChange,
} from '../src/core/record-history.mjs';
import { createOwnedSpecificationStore } from '../src/core/owned-specifications.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, trySymlink, writeFile, writeJson }
  from './helpers.mjs';

const SHA = (content) =>
  crypto.createHash('sha256').update(content).digest('hex');

function fixture({ state = '.tasksystem/state', configRel = '.tasksystem/config.json' } = {}) {
  const dir = makeTempDir('journal-update');
  const answers = { ...VALID_ANSWERS, paths: { ...VALID_ANSWERS.paths, state } };
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
    alpha: bindWorkspace(ctx, { areaIds: [a] }),
    journal: path.join(dir, ...state.split('/'), 'journal'),
  };
}

function updateChange(areaIds, rel, content, previous, revision = 0, recordId = 'record-1') {
  return {
    sourceKind: 'task', recordId, sourceRevision: revision,
    previousHash: SHA(previous),
    areaIds, file: { rel, content },
  };
}

function createChange(areaIds, rel, content, recordId = 'record-1', sourceKind = 'task') {
  return { sourceKind, recordId, sourceRevision: 0, areaIds,
    file: { rel, content } };
}

function tree(dir) {
  const values = {};
  function visit(root, rel = '') {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(root, entry.name);
      if (entry.isDirectory()) {
        values[next] = 'directory';
        visit(abs, next);
      } else {
        values[next] = fs.readFileSync(abs);
      }
    }
  }
  if (fs.existsSync(dir)) visit(dir);
  return values;
}

function recoverOptions(bound, operationId, action, reason = 'operator decision') {
  return { action,
    expectedIntentDigest: getJournalOperation(bound, operationId).intentDigest,
    reason };
}

test('pure helpers classify operations and derive resulting revisions', () => {
  assert.equal(isJournalOperation('create'), true);
  assert.equal(isJournalOperation('update'), true);
  for (const bad of [null, undefined, 'replace', 'UPDATE', 0, {}]) {
    assert.equal(isJournalOperation(bad), false);
  }
  assert.equal(resultingSourceRevision({ operation: 'create', sourceRevision: 0 }), 0);
  assert.equal(resultingSourceRevision({ operation: 'create', sourceRevision: null }), null);
  assert.equal(resultingSourceRevision({ operation: 'update', sourceRevision: 0 }), 1);
  assert.equal(resultingSourceRevision({ operation: 'update', sourceRevision: 7 }), 8);
  for (const bad of [{ operation: 'replace', sourceRevision: 0 },
    { operation: 'update', sourceRevision: null },
    { operation: 'update', sourceRevision: -1 },
    { operation: 'update', sourceRevision: 1.5 },
    { operation: 'update' }]) {
    assert.throws(() => resultingSourceRevision(bad),
      (e) => e.code === 'INVALID_JOURNAL_INPUT');
  }
});

test('validateUpdateChange enforces the closed update shape purely', () => {
  const good = updateChange(['11111111-1111-4111-8111-111111111111'],
    'records/item', 'next', 'current', 2, 'task-1');
  assert.equal(validateUpdateChange(good, 'TEST_CODE', 'change'), undefined);
  const bad = [
    null, [], 'x',
    { ...good, extra: true },
    (({ previousHash, ...rest }) => rest)(good),
    { ...good, previousHash: null },
    { ...good, previousHash: 'zz' },
    { ...good, previousHash: 'A'.repeat(64) },
    { ...good, sourceRevision: null },
    { ...good, sourceRevision: -1 },
    { ...good, sourceRevision: 1.5 },
    { ...good, sourceRevision: '2' },
    { ...good, sourceKind: 'Task' },
    { ...good, recordId: 'bad/id' },
    { ...good, areaIds: 'x' },
    { ...good, file: { rel: 'records/item' } },
    { ...good, file: { rel: 'records/item', content: {}, extra: 1 } },
    Object.assign(Object.create({ recordId: 'inherited' }), good),
  ];
  for (const change of bad) {
    assert.throws(() => validateUpdateChange(change, 'TEST_CODE', 'change'),
      (e) => e.code === 'TEST_CODE');
  }
});

test('validateRecordTransition enforces chain coherence for history readers', () => {
  const previous = {
    operation: 'create', sourceKind: 'task', recordId: 'task-1',
    sourceRevision: 0, sourceHash: 'a'.repeat(64),
  };
  const next = {
    operation: 'update', sourceKind: 'task', recordId: 'task-1',
    sourceRevision: 0, previousHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64),
  };
  assert.equal(validateRecordTransition(previous, next), undefined);
  const chained = { ...next, operation: 'update',
    sourceRevision: 1, previousHash: next.sourceHash };
  assert.equal(validateRecordTransition(next, chained), undefined);
  for (const [prev, upd] of [
    [{ ...previous, operation: 'replace' }, next],
    [previous, { ...next, operation: 'create' }],
    [{ ...previous, recordId: 'other' }, next],
    [{ ...previous, sourceKind: 'session' }, next],
    [previous, { ...next, sourceRevision: 1 }],
    [previous, { ...next, previousHash: 'c'.repeat(64) }],
    [next, { ...chained, sourceRevision: 0 }],
    [next, { ...chained, previousHash: 'd'.repeat(64) }],
  ]) {
    assert.throws(() => validateRecordTransition(prev, upd),
      (e) => e.code === 'INVALID_JOURNAL_INPUT');
  }
});

test('strict update seam rejects bad callbacks and shapes before any write', () => {
  const f = fixture();
  try {
    const before = tree(f.dir);
    writeFile(f.dir, 'records/item', 'current');
    const good = updateChange([f.a], 'records/item', 'next', 'current');
    for (const callback of [null, 7, 'callback', {}, []]) {
      assert.throws(() => applyJournaledRecordUpdate(f.bound, callback),
        (e) => e.code === 'INVALID_JOURNAL_INPUT');
    }
    assert.throws(() => applyJournaledRecordUpdate(f.bound,
      async () => [good]), (e) => e.code === 'INVALID_JOURNAL_INPUT');
    for (const value of [undefined, 'x', {}, new Array(1),
      [null], [{ bad: true }],
      [{ ...good, extra: true }],
      [((({ previousHash, ...rest }) => rest)(good))],
      [{ ...good, previousHash: null }],
      [{ ...good, previousHash: 'not-a-hash' }],
      [{ ...good, sourceRevision: null }],
      [{ ...good, sourceRevision: -1 }],
      [{ ...good, sourceRevision: 1.5 }],
      [{ ...good, areaIds: [] }],
      [{ ...good, file: { rel: 'records/item', content: {} } }],
      [good, updateChange([f.a], 'records/other', 'x', 'y', 0, 'record-1')],
    ]) {
      assert.throws(() => applyJournaledRecordUpdate(f.bound, () => value),
        (e) => ['INVALID_JOURNAL_INPUT', 'SCOPE_DENIED',
          'JOURNAL_SOURCE_CONFLICT'].includes(e.code));
    }
    assert.throws(() => applyJournaledRecordUpdate(f.bound, () => [
      updateChange([f.a], 'records/big', 'x', 'current', 0, 'big'),
    ].map((c) => ({ ...c, file: { rel: c.file.rel,
      content: Buffer.alloc(loadLimits().maxDocumentBytes + 1) } }))),
    (e) => e.code === 'DOCUMENT_TOO_LARGE');
    assert.throws(() => applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a], '.TASKSYSTEM/STATE/JOURNAL/injected', 'x', 'y')]),
      (e) => e.code === 'INVALID_JOURNAL_INPUT');
    assert.throws(() => applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a], '../escape', 'x', 'y')]),
      (e) => e.code === 'INVALID_PATH');
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/item'), 'utf8'), 'current');
    assert.equal(fs.existsSync(f.journal), false);
  } finally { cleanup(f.dir); }
});

test('missing, mismatched, linked or non-regular sources conflict before journal state', (t) => {
  const f = fixture();
  try {
    const before = tree(f.dir);
    for (const rel of ['records/missing', 'records/dir']) {
      if (rel === 'records/dir') fs.mkdirSync(path.join(f.dir, 'records/dir'), { recursive: true });
      assert.throws(() => applyJournaledRecordUpdate(f.bound,
        () => [updateChange([f.a], rel, 'next', 'a'.repeat(64))]),
        (e) => e.code === 'JOURNAL_SOURCE_CONFLICT', rel);
    }
    writeFile(f.dir, 'records/item', 'current');
    assert.throws(() => applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a], 'records/item', 'next', 'b'.repeat(64))]),
      (e) => e.code === 'JOURNAL_SOURCE_CONFLICT');
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/item'), 'utf8'), 'current');
    const link = path.join(f.dir, 'records', 'linked');
    if (trySymlink(path.join(f.dir, 'records', 'item'), link, 'file')) {
      assert.throws(() => applyJournaledRecordUpdate(f.bound,
        () => [updateChange([f.a], 'records/linked', 'next', 'current')]),
        (e) => ['JOURNAL_SOURCE_CONFLICT', 'SYMLINK_REJECTED'].includes(e.code));
    } else {
      t.diagnostic('file symlinks unavailable');
    }
    const after = tree(f.dir);
    for (const [rel, value] of Object.entries(after)) {
      if (rel.startsWith('.tasksystem/state/journal')) {
        assert.fail(`journal state was written: ${rel}`);
      }
    }
    assert.equal(fs.existsSync(f.journal), false);
  } finally { cleanup(f.dir); }
});

test('successful update commits CAS event fields and advances the journal revision', () => {
  const f = fixture();
  try {
    const created = applyJournaledRecordCreation(f.bound,
      () => [createChange([f.a], 'records/task-1', 'v0-bytes', 'task-1')]);
    assert.equal(created.status, 'committed');
    let seen;
    const result = applyJournaledRecordUpdate(f.bound, (identity) => {
      seen = identity;
      assert.equal(Object.isFrozen(identity), true);
      return [updateChange([f.a], 'records/task-1', 'v1-bytes', 'v0-bytes', 0, 'task-1')];
    });
    assert.equal(result.status, 'committed');
    assert.equal(result.journalState, 'confirmed');
    assert.equal(result.operationId, seen.operationId);
    assert.equal(result.result.updated, 1);
    assert.deepEqual(result.result.files, ['records/task-1']);
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/task-1'), 'utf8'), 'v1-bytes');
    const { event, intentDigest } = getJournalEvent(f.bound, result.operationId, result.eventIds[0]);
    assert.equal(intentDigest, canonicalDigest(getJournalOperation(f.bound, result.operationId).intent));
    assert.equal(event.operation, 'update');
    assert.equal(event.sourceRevision, 0);
    assert.equal(event.previousHash, SHA('v0-bytes'));
    assert.equal(event.sourceHash, SHA('v1-bytes'));
    assert.equal(event.journalSequence, 2);
    assert.equal(event.createdAt, seen.createdAt);
    assert.deepEqual(readJournalSnapshot(f.bound, result.operationId, event.eventId),
      Buffer.from('v1-bytes'));
    assert.equal(resultingSourceRevision(event), 1);
    const preimage = path.join(f.journal, 'snapshots', `${SHA('v0-bytes')}.blob`);
    assert.deepEqual(fs.readFileSync(preimage), Buffer.from('v0-bytes'));
    const createEvent = getJournalEvent(f.bound, created.operationId, created.eventIds[0]).event;
    assert.equal(validateRecordTransition(createEvent, event), undefined);
    const pending = listJournalPending(f.bound);
    assert.deepEqual(pending.items.map((item) => item.event.operation),
      ['create', 'update']);
  } finally { cleanup(f.dir); }
});

test('a second update chains to revision 2 with the expected current hash', () => {
  const f = fixture();
  try {
    applyJournaledRecordCreation(f.bound,
      () => [createChange([f.a], 'records/task-1', 'v0', 'task-1')]);
    const first = applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a], 'records/task-1', 'v1', 'v0', 0, 'task-1')]);
    const second = applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a], 'records/task-1', 'v2', 'v1', 1, 'task-1')]);
    assert.equal(second.status, 'committed');
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/task-1'), 'utf8'), 'v2');
    const e1 = getJournalEvent(f.bound, first.operationId, first.eventIds[0]).event;
    const e2 = getJournalEvent(f.bound, second.operationId, second.eventIds[0]).event;
    assert.equal(e2.sourceRevision, 1);
    assert.equal(resultingSourceRevision(e2), 2);
    assert.equal(e2.journalSequence, 3);
    assert.equal(validateRecordTransition(e1, e2), undefined);
  } finally { cleanup(f.dir); }
});

test('stale view introduced under the lock conflicts before reserving journal state', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    writeFile(f.dir, 'records/item', 'current');
    const lockFile = path.join(f.journal, '.lock');
    fs.openSync = function (file, flags, ...args) {
      const fd = open.call(this, file, flags, ...args);
      if (file === lockFile && flags === 'wx') {
        writeFile(f.dir, 'records/item', 'racing bytes');
      }
      return fd;
    };
    assert.throws(() => applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a], 'records/item', 'next', 'current')]),
      (e) => e.code === 'JOURNAL_SOURCE_CONFLICT');
    fs.openSync = open;
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/item'), 'utf8'), 'racing bytes');
    assert.equal(fs.existsSync(path.join(f.journal, 'head.json')), false);
    assert.equal(fs.existsSync(path.join(f.journal, 'operations')), false);
    assert.equal(fs.existsSync(path.join(f.journal, 'outbox')), false);
    assert.equal(fs.existsSync(lockFile), false);
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('non-journaled legacy files update with caller-declared revision metadata', () => {
  const f = fixture();
  try {
    writeFile(f.dir, 'records/legacy', 'legacy-v0');
    const result = applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a], 'records/legacy', 'legacy-v1', 'legacy-v0', 5, 'legacy')]);
    assert.equal(result.status, 'committed');
    const { event } = getJournalEvent(f.bound, result.operationId, result.eventIds[0]);
    assert.equal(event.operation, 'update');
    assert.equal(event.sourceRevision, 5);
    assert.equal(resultingSourceRevision(event), 6);
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/legacy'), 'utf8'), 'legacy-v1');
  } finally { cleanup(f.dir); }
});

test('noop update returns unchanged and never journals; wrong hash is conflict, not noop', () => {
  const f = fixture();
  try {
    writeFile(f.dir, 'records/item', 'same bytes');
    const before = tree(f.dir);
    const result = applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a], 'records/item', 'same bytes', 'same bytes')]);
    assert.equal(result.status, 'unchanged');
    assert.equal(result.operationId, null);
    assert.equal(result.journalState, 'none');
    assert.equal(result.result.updated, 0);
    assert.deepEqual(result.result.files, ['records/item']);
    assert.equal(fs.existsSync(f.journal), false);
    assert.deepEqual(tree(f.dir), before);
    assert.throws(() => applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a], 'records/item', 'same bytes', 'b'.repeat(64))]),
      (e) => e.code === 'JOURNAL_SOURCE_CONFLICT');
    assert.equal(fs.existsSync(f.journal), false);
  } finally { cleanup(f.dir); }
});

test('multi-record update commits contiguous sequences in one operation', () => {
  const f = fixture();
  try {
    writeFile(f.dir, 'records/one', 'one-v0');
    writeFile(f.dir, 'records/two', 'two-v0');
    const result = applyJournaledRecordUpdate(f.bound, () => [
      updateChange([f.a], 'records/one', 'one-v1', 'one-v0', 0, 'one'),
      updateChange([f.b], 'records/two', 'two-v1', 'two-v0', 0, 'two'),
    ]);
    assert.equal(result.status, 'committed');
    assert.equal(result.result.updated, 2);
    assert.equal(result.eventIds.length, 2);
    const loaded = getJournalOperation(f.bound, result.operationId);
    assert.deepEqual(loaded.intent.events.map((e) => e.operation), ['update', 'update']);
    assert.deepEqual(loaded.intent.events.map((e) => e.journalSequence), [1, 2]);
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/one'), 'utf8'), 'one-v1');
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/two'), 'utf8'), 'two-v1');
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.journal, 'head.json'))).lastSequence, 2);
  } finally { cleanup(f.dir); }
});

test('apply-phase failure preserves the unconfirmed receipt and leaves sources untouched', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    writeFile(f.dir, 'records/item', 'v0');
    fs.openSync = function (file, flags, ...args) {
      if (String(file).includes('.upd-') && flags === 'wx') {
        const error = new Error('fixture temp failure');
        error.code = 'EIO';
        throw error;
      }
      return open.call(this, file, flags, ...args);
    };
    const result = applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a], 'records/item', 'v1', 'v0')]);
    fs.openSync = open;
    assert.equal(result.status, 'unconfirmed');
    assert.equal(result.journalState, 'prepared');
    assert.equal(result.pendingMemory, true);
    assert.equal(result.result, null);
    assert.ok(result.cause);
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/item'), 'utf8'), 'v0');
    const loaded = getJournalOperation(f.bound, result.operationId);
    assert.equal(loaded.state, 'prepared');
    assert.equal(loaded.intent.events[0].operation, 'update');
    assert.throws(() => applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a], 'records/item', 'v2', 'v0')]),
      (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    const preview = prepareJournalRecovery(f.bound, result.operationId,
      recoverOptions(f.bound, result.operationId, 'abandon-prepared'));
    assert.equal(preview.mode, 'dry-run');
    assert.equal(preview.sourceOutcome, 'unconfirmed');
    const done = recoverJournalOperation(f.bound, result.operationId,
      recoverOptions(f.bound, result.operationId, 'abandon-prepared'));
    assert.equal(done.state, 'abandoned');
    assert.equal(done.sourceOutcome, 'unconfirmed');
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/item'), 'utf8'), 'v0');
    const next = applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a], 'records/item', 'v1', 'v0')]);
    assert.equal(next.status, 'committed');
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('partial multi-record application stays unconfirmed and abandon never restores pre-image', () => {
  const f = fixture();
  const rename = fs.renameSync;
  try {
    writeFile(f.dir, 'records/one', 'one-v0');
    writeFile(f.dir, 'records/two', 'two-v0');
    let renames = 0;
    fs.renameSync = function (from, to, ...args) {
      if (String(from).includes('.upd-')) {
        renames += 1;
        if (renames === 2) {
          const error = new Error('fixture rename failure');
          error.code = 'EIO';
          throw error;
        }
      }
      return rename.call(this, from, to, ...args);
    };
    const result = applyJournaledRecordUpdate(f.bound, () => [
      updateChange([f.a], 'records/one', 'one-v1', 'one-v0', 0, 'one'),
      updateChange([f.a], 'records/two', 'two-v1', 'two-v0', 0, 'two'),
    ]);
    fs.renameSync = rename;
    assert.equal(result.status, 'unconfirmed');
    assert.equal(result.journalState, 'prepared');
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/one'), 'utf8'), 'one-v1');
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/two'), 'utf8'), 'two-v0');
    const done = recoverJournalOperation(f.bound, result.operationId,
      recoverOptions(f.bound, result.operationId, 'abandon-prepared'));
    assert.equal(done.state, 'abandoned');
    // Abandon never restores the pre-image: the applied rename stays applied.
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/one'), 'utf8'), 'one-v1');
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/two'), 'utf8'), 'two-v0');
    const preimage = path.join(f.journal, 'snapshots', `${SHA('one-v0')}.blob`);
    assert.deepEqual(fs.readFileSync(preimage), Buffer.from('one-v0'));
  } finally { fs.renameSync = rename; cleanup(f.dir); }
});

test('committed update op recovers identically via finalize-committed', () => {
  const f = fixture();
  const rename = fs.renameSync;
  try {
    writeFile(f.dir, 'records/item', 'v0');
    fs.renameSync = function (from, to, ...args) {
      if (to === path.join(f.journal, 'head.json')
          && JSON.parse(fs.readFileSync(from)).activeOperation === null) {
        throw new Error('fixture head cleanup failure');
      }
      return rename.call(this, from, to, ...args);
    };
    const result = applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a], 'records/item', 'v1', 'v0')]);
    fs.renameSync = rename;
    assert.equal(result.status, 'committed');
    assert.equal(result.journalState, 'confirmed');
    assert.ok(result.warnings.some((w) => w.code === 'JOURNAL_RECOVERY_REQUIRED'));
    const head = JSON.parse(fs.readFileSync(path.join(f.journal, 'head.json')));
    assert.equal(head.activeOperation.operationId, result.operationId);
    assert.throws(() => applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a], 'records/item', 'v2', 'v1')]),
      (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    const done = recoverJournalOperation(f.bound, result.operationId,
      recoverOptions(f.bound, result.operationId, 'finalize-committed'));
    assert.equal(done.state, 'committed');
    assert.deepEqual(done.pendingEventIds, result.eventIds);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.journal, 'head.json'))).activeOperation,
      null);
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/item'), 'utf8'), 'v1');
  } finally { fs.renameSync = rename; cleanup(f.dir); }
});

test('updating a rev0-owned source breaks its ownership proof closed', () => {
  const f = fixture();
  try {
    const store = createOwnedSpecificationStore(f.ctx, { areaIds: [f.a, f.b] });
    const created = store.create({
      areaIds: [f.a, f.b],
      specification: {
        title: 'T', originalRequest: 'R',
        outcome: { statement: 'S', evidencePlan: 'E' },
        requirements: [{
          id: 'REQ-1', statement: 'St',
          scenarios: [{ id: 'SC-1', given: 'g', when: 'w', then: 't' }],
        }],
        scope: ['src'], constraints: [], nonGoals: [], openQuestions: [],
        references: [],
      },
    });
    assert.equal(created.journal.status, 'committed');
    const current = fs.readFileSync(path.join(f.dir, created.sourceRel));
    const updated = applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a, f.b], created.sourceRel,
        `${current.toString('utf8')}/* drifted */`, current, 0, created.record.id)]);
    assert.equal(updated.status, 'committed');
    assert.throws(() => store.get(created.record.id),
      (e) => e.code === 'OWNED_SPEC_SOURCE_CHANGED');
  } finally { cleanup(f.dir); }
});

test('tampered stored update intents fail closed on read', () => {
  const f = fixture();
  try {
    writeFile(f.dir, 'records/item', 'v0');
    const result = applyJournaledRecordUpdate(f.bound,
      () => [updateChange([f.a], 'records/item', 'v1', 'v0')]);
    const intentPath = path.join(f.journal, 'operations', result.operationId, 'intent.json');
    const parsed = JSON.parse(fs.readFileSync(intentPath));
    for (const mutation of [
      (e) => { e.previousHash = null; },
      (e) => { e.operation = 'replace'; },
      (e) => { e.sourceRevision = null; },
      (e) => { e.previousHash = 'not-a-hash'; },
    ]) {
      const copy = JSON.parse(JSON.stringify(parsed));
      mutation(copy.events[0]);
      fs.writeFileSync(intentPath, JSON.stringify(copy));
      assert.throws(() => getJournalOperation(f.bound, result.operationId),
        (e) => e.code === 'JOURNAL_MALFORMED');
    }
  } finally { cleanup(f.dir); }
});

test('update requires all-of scope grants and denies forged bindings', () => {
  const f = fixture();
  const other = fixture();
  try {
    writeFile(f.dir, 'records/beta-item', 'v0');
    writeFile(f.dir, 'records/shared', 'v0');
    assert.throws(() => applyJournaledRecordUpdate(f.alpha,
      () => [updateChange([f.b], 'records/beta-item', 'v1', 'v0')]),
      (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => applyJournaledRecordUpdate(f.alpha,
      () => [updateChange([f.a, f.b], 'records/shared', 'v1', 'v0')]),
      (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => applyJournaledRecordUpdate({ ...f.bound },
      () => [updateChange([f.a], 'records/beta-item', 'v1', 'v0')]),
      (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => applyJournaledRecordUpdate(other.bound,
      () => [updateChange([f.a], 'records/beta-item', 'v1', 'v0')]),
      (e) => e.code === 'SCOPE_DENIED');
    const alphaUpdate = applyJournaledRecordUpdate(f.alpha,
      () => [updateChange([f.a], 'records/beta-item', 'v1', 'v0')]);
    assert.equal(alphaUpdate.status, 'committed');
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/beta-item'), 'utf8'), 'v1');
  } finally { cleanup(f.dir); cleanup(other.dir); }
});
