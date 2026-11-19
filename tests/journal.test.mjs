import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { canonicalDigest } from '../src/core/digests.mjs';
import { loadJournalPolicy, loadLimits } from '../src/core/policy.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import {
  ackJournalEvent, applyJournaledCreation, applyJournaledRecordCreation,
  getJournalEvent, getJournalOperation, listJournalPending, readJournalSnapshot,
  prepareJournalRecovery, recoverJournalOperation,
} from '../src/core/journal.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, trySymlink, writeFile, writeJson }
  from './helpers.mjs';

function fixture({ state = '.tasksystem/state', configRel = '.tasksystem/config.json' } = {}) {
  const dir = makeTempDir('journal');
  const answers = { ...VALID_ANSWERS, paths: { ...VALID_ANSWERS.paths, state } };
  writeJson(dir, configRel, createConfig(dir, answers, {}));
  const ctx = resolveContext({ project: dir, config: configRel });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const workspace = prepared.workspace;
  const [a, b] = workspace.areas.map((area) => area.id);
  return {
    dir, ctx, workspace, a, b,
    bound: bindWorkspace(ctx, { areaIds: [a, b] }),
    alpha: bindWorkspace(ctx, { areaIds: [a] }),
    beta: bindWorkspace(ctx, { areaIds: [b] }),
    journal: path.join(dir, ...state.split('/'), 'journal'),
  };
}

function change(areaIds, rel, content = 'content', recordId = 'record-1') {
  return { sourceKind: 'task', recordId, sourceRevision: 0, areaIds,
    file: { rel, content } };
}

function evidence(event, overrides = {}) {
  return {
    backendId: 'fixture-backend',
    remoteNamespace: 'fixture-namespace',
    remoteKey: event.eventId,
    eventDigest: canonicalDigest(event),
    sourceHash: event.sourceHash,
    confirmedAt: '2026-11-09T12:00:00.000Z',
    ...overrides,
  };
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
  visit(dir);
  return values;
}

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

test('policy exposes authored bounds and returns independent values', () => {
  const policy = loadJournalPolicy();
  assert.deepEqual(policy, { schemaVersion: 1, maxOperationEvents: 101,
    maxPendingOperations: 10000, defaultPageSize: 50, maxPageSize: 100 });
  assert.notEqual(loadJournalPolicy(), policy);
});

test('read-only queries and all-noop apply do not create journal state', () => {
  const f = fixture();
  try {
    writeFile(f.dir, 'source/already.json', 'same');
    const before = tree(f.dir);
    const listed = listJournalPending(f.bound);
    assert.deepEqual(listed, { items: [], nextAfterSequence: null });
    const result = applyJournaledCreation(f.bound, [change([f.a], 'source/already.json', 'same')]);
    assert.deepEqual(result, {
      status: 'unchanged', operationId: null, eventIds: [], journalState: 'none',
      pendingMemory: false, result: { created: 0, files: ['source/already.json'] },
      cause: null, warnings: [],
    });
    assert.equal(fs.existsSync(f.journal), false);
    assert.deepEqual(tree(f.dir), before);
  } finally { cleanup(f.dir); }
});

test('committed changes preserve exact snapshots, separate events and contiguous sequences', () => {
  const f = fixture({ state: 'private/state' });
  try {
    const bytes = Buffer.from([0, 1, 13, 10, 255]);
    const result = applyJournaledCreation(f.bound, [
      change([f.a], 'source/first.bin', bytes, 'first'),
      change([f.b], 'source/second.bin', Buffer.from(bytes), 'second'),
    ]);
    assert.equal(result.status, 'committed');
    assert.equal(result.journalState, 'confirmed');
    assert.equal(result.pendingMemory, true);
    assert.equal(result.cause, null);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.result.created, 2);
    assert.equal(result.eventIds.length, 2);
    assert.notEqual(result.eventIds[0], result.eventIds[1]);
    const { intent, intentDigest, state } = getJournalOperation(f.bound, result.operationId);
    assert.equal(state, 'committed');
    assert.equal(intentDigest, canonicalDigest(intent));
    assert.equal(intent.operationId, result.operationId);
    assert.equal(intent.state, 'prepared');
    assert.deepEqual(intent.events.map((event) => event.eventId), result.eventIds);
    assert.deepEqual(intent.events.map((event) => event.journalSequence), [1, 2]);
    assert.equal(intent.events[0].sourceHash, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.equal(intent.events[0].sourceHash, intent.events[1].sourceHash);
    assert.equal(intent.events[0].snapshotRef,
      `private/state/journal/snapshots/${intent.events[0].sourceHash}.blob`);
    assert.equal(intent.events[0].previousHash, null);
    assert.equal(intent.events[0].operation, 'create');
    assert.deepEqual(fs.readFileSync(path.join(f.dir, 'source/first.bin')), bytes);
    for (const event of intent.events) {
      assert.deepEqual(readJournalSnapshot(f.bound, result.operationId, event.eventId), bytes);
    }
    assert.equal(fs.readdirSync(path.join(f.journal, 'snapshots')).length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.journal, 'head.json'))).lastSequence, 2);
    const more = applyJournaledCreation(f.bound, [change([f.a], 'source/third', 'x', 'third')]);
    assert.equal(getJournalEvent(f.bound, more.operationId, more.eventIds[0]).event.journalSequence, 3);
  } finally { cleanup(f.dir); }
});

test('current and legacy configured state paths are honored', () => {
  for (const settings of [
    { state: '.scopegrain/state', configRel: '.scopegrain/config.json' },
    { state: '.tasksystem/state', configRel: '.tasksystem/config.json' },
  ]) {
    const f = fixture(settings);
    try {
      const result = applyJournaledCreation(f.bound, [change([f.a], 'records/first')]);
      const event = getJournalEvent(f.bound, result.operationId, result.eventIds[0]).event;
      assert.equal(event.snapshotRef, `${settings.state}/journal/snapshots/${event.sourceHash}.blob`);
      assert.equal(fs.existsSync(path.join(f.journal, 'head.json')), true);
      const other = settings.state.startsWith('.scopegrain/') ? '.tasksystem' : '.scopegrain';
      assert.equal(fs.existsSync(path.join(f.dir, other)), false);
    } finally { cleanup(f.dir); }
  }
});

test('invalid change shapes, duplicates, paths and budgets fail before writes', () => {
  const f = fixture();
  try {
    const good = change([f.a], 'records/a');
    const inherited = Object.assign(Object.create({ recordId: 'inherited' }),
      { sourceKind: 'task', sourceRevision: 0, areaIds: [f.a],
        file: { rel: 'records/a', content: 'x' } });
    const bad = [
      null, [], {}, [null], [inherited], [{ ...good, extra: true }],
      [{ ...good, sourceKind: 'Task' }], [{ ...good, recordId: 'bad/name' }],
      [{ ...good, sourceRevision: -1 }], [{ ...good, sourceRevision: 1.5 }],
      [{ ...good, areaIds: [] }], [{ ...good, file: null }],
      [{ ...good, file: { rel: 'records/a', content: {}, extra: 1 } }],
      [{ ...good, file: { rel: 'records/a', content: {} } }],
      new Array(1),
      Array.from({ length: 102 }, (_, i) => change([f.a], `records/${i}`, 'x', `r-${i}`)),
      [good, change([f.a], 'records/b', 'x', 'record-1')],
    ];
    const before = tree(f.dir);
    for (const changes of bad) {
      assert.throws(() => applyJournaledCreation(f.bound, changes),
        (e) => ['INVALID_JOURNAL_INPUT', 'SCOPE_DENIED'].includes(e.code));
    }
    assert.throws(() => applyJournaledCreation(f.bound,
      [change([f.a], '../escape')]), (e) => e.code === 'INVALID_PATH');
    assert.throws(() => applyJournaledCreation(f.bound,
      [change([f.a], '.TASKSYSTEM/STATE/JOURNAL/injected')]),
    (e) => e.code === 'INVALID_JOURNAL_INPUT');
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/big',
      Buffer.alloc(loadLimits().maxDocumentBytes + 1))]),
    (e) => e.code === 'DOCUMENT_TOO_LARGE');
    assert.throws(() => applyJournaledCreation(f.bound, [
      good, change([f.a], 'records/a', 'other', 'different'),
    ]), (e) => e.code === 'PLAN_CONFLICT');
    assert.deepEqual(tree(f.dir), before);
  } finally { cleanup(f.dir); }
});

test('snapshot preparation failure cannot write a source file', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    const destination = path.join(f.dir, 'records', 'item');
    fs.openSync = function (file, flags, ...args) {
      if (String(file).includes(`${path.sep}snapshots${path.sep}`) && flags === 'wx') {
        const error = new Error('snapshot failure');
        error.code = 'EIO';
        throw error;
      }
      return open.call(this, file, flags, ...args);
    };
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/item')]));
    assert.equal(fs.existsSync(destination), false);
    const head = JSON.parse(fs.readFileSync(path.join(f.journal, 'head.json')));
    assert.ok(head.activeOperation);
    fs.openSync = open;
    const before = tree(f.dir);
    assert.throws(() => listJournalPending(f.bound),
      (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    assert.deepEqual(tree(f.dir), before);
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/next')]),
      (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('an existing corrupt hash-path blob is never overwritten or used for a source', () => {
  const f = fixture();
  try {
    const expectedHash = crypto.createHash('sha256').update('content').digest('hex');
    const blob = writeFile(f.dir,
      `.tasksystem/state/journal/snapshots/${expectedHash}.blob`, 'corrupt');
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/item')]),
      (e) => e.code === 'JOURNAL_SNAPSHOT_MISMATCH');
    assert.equal(fs.readFileSync(blob, 'utf8'), 'corrupt');
    assert.equal(fs.existsSync(path.join(f.dir, 'records/item')), false);
  } finally { cleanup(f.dir); }
});

test('create-to-noop races remain unconfirmed and retain foreign and partial files', () => {
  for (const variant of ['all', 'partial']) {
    const f = fixture();
    let restore = () => {};
    try {
      const changes = [
        change([f.a], 'records/one', 'one', 'one'),
        change([f.a], 'records/two', 'two', 'two'),
      ];
      restore = afterOutboxPersisted(() => {
        writeFile(f.dir, 'records/one', 'one');
        if (variant === 'all') writeFile(f.dir, 'records/two', 'two');
      });
      const result = applyJournaledCreation(f.bound, changes);
      restore();
      assert.equal(result.status, 'unconfirmed');
      assert.equal(result.journalState, 'prepared');
      assert.equal(result.result, null);
      assert.equal(result.cause.code, 'JOURNAL_SOURCE_UNCONFIRMED');
      assert.equal(result.pendingMemory, true);
      assert.equal(fs.readFileSync(path.join(f.dir, 'records/one'), 'utf8'), 'one');
      assert.equal(fs.readFileSync(path.join(f.dir, 'records/two'), 'utf8'), 'two');
      const loaded = getJournalOperation(f.bound, result.operationId);
      assert.equal(loaded.state, 'prepared');
      assert.equal(fs.existsSync(path.join(f.journal, 'operations',
        result.operationId, 'commit.json')), false);
      assert.throws(() => ackJournalEvent(f.bound, result.operationId,
        result.eventIds[0], evidence(loaded.intent.events[0])),
      (e) => e.code === 'JOURNAL_NOT_COMMITTED');
      assert.throws(() => applyJournaledCreation(f.bound,
        [change([f.a], 'records/next')]), (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    } finally { restore(); cleanup(f.dir); }
  }
});

test('excluded noop source is never recreated if it disappears before apply', () => {
  const f = fixture();
  let restore = () => {};
  try {
    const noop = writeFile(f.dir, 'records/noop', 'existing');
    restore = afterOutboxPersisted(() => fs.unlinkSync(noop));
    const result = applyJournaledCreation(f.bound, [
      change([f.a], 'records/noop', 'existing', 'noop'),
      change([f.a], 'records/create', 'new', 'create'),
    ]);
    restore();
    assert.equal(result.status, 'committed');
    assert.equal(result.result.created, 1);
    assert.equal(result.eventIds.length, 1);
    assert.equal(fs.existsSync(noop), false);
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/create'), 'utf8'), 'new');
    const op = getJournalOperation(f.bound, result.operationId);
    assert.equal(op.intent.events[0].sourceRel, 'records/create');
  } finally { restore(); cleanup(f.dir); }
});

test('initial noop deleted before locking stays excluded from the journal and apply', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    const noop = writeFile(f.dir, 'records/noop', 'existing');
    const lock = path.join(f.journal, '.lock');
    fs.openSync = function (file, flags, ...args) {
      if (file === lock && flags === 'wx') fs.unlinkSync(noop);
      return open.call(this, file, flags, ...args);
    };
    const result = applyJournaledCreation(f.bound, [
      change([f.a], 'records/noop', 'existing', 'noop'),
      change([f.a], 'records/create', 'new', 'create'),
    ]);
    fs.openSync = open;
    assert.equal(result.status, 'committed');
    assert.equal(result.eventIds.length, 1);
    assert.equal(result.result.created, 1);
    assert.equal(fs.existsSync(noop), false);
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/create'), 'utf8'), 'new');
    assert.equal(getJournalOperation(f.bound, result.operationId).intent.events[0].sourceRel,
      'records/create');
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('caller mutation during journal IO cannot change authorized snapshot or source', () => {
  const f = fixture();
  let restore = () => {};
  try {
    const bytes = Buffer.from('original bytes');
    const areaIds = [f.a];
    restore = afterOutboxPersisted(() => { bytes.fill(0); areaIds[0] = f.b; });
    const result = applyJournaledCreation(f.bound, [change(areaIds, 'records/data', bytes)]);
    restore();
    const event = getJournalEvent(f.alpha, result.operationId, result.eventIds[0]).event;
    assert.equal(result.status, 'committed');
    assert.deepEqual(event.areaIds, [f.a]);
    assert.deepEqual(readJournalSnapshot(f.alpha, result.operationId, event.eventId),
      Buffer.from('original bytes'));
    assert.deepEqual(fs.readFileSync(path.join(f.dir, 'records/data')),
      Buffer.from('original bytes'));
  } finally { restore(); cleanup(f.dir); }
});

test('source failure remains unconfirmed and blocks later writes even if source matches', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    const destination = path.join(f.dir, 'records', 'item');
    fs.openSync = function (file, flags, ...args) {
      if (file === destination && flags === 'wx') {
        const error = new Error('fixture source failure');
        error.code = 'EIO';
        throw error;
      }
      return open.call(this, file, flags, ...args);
    };
    const result = applyJournaledCreation(f.bound, [change([f.a], 'records/item')]);
    fs.openSync = open;
    assert.equal(result.status, 'unconfirmed');
    assert.equal(result.journalState, 'prepared');
    assert.equal(result.pendingMemory, true);
    assert.equal(result.result, null);
    assert.equal(result.cause.code, 'INTERNAL');
    const loaded = getJournalOperation(f.bound, result.operationId);
    assert.equal(loaded.state, 'prepared');
    assert.deepEqual(readJournalSnapshot(f.bound, result.operationId, result.eventIds[0]),
      Buffer.from('content'));
    assert.equal(listJournalPending(f.bound).items[0].state, 'prepared');
    assert.throws(() => ackJournalEvent(f.bound, result.operationId, result.eventIds[0],
      evidence(loaded.intent.events[0])), (e) => e.code === 'JOURNAL_NOT_COMMITTED');
    writeFile(f.dir, 'records/item', 'content');
    const noop = applyJournaledCreation(f.bound, [change([f.a], 'records/item')]);
    assert.equal(noop.status, 'unchanged');
    assert.equal(getJournalOperation(f.bound, result.operationId).state, 'prepared');
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/next')]),
      (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    assert.equal(fs.existsSync(path.join(f.dir, 'records', 'next')), false);
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('commit-marker failure reports committed with pending finalization, never replay', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    fs.openSync = function (file, flags, ...args) {
      if (String(file).endsWith(`${path.sep}commit.json`) && flags === 'wx') {
        const error = new Error('fixture marker failure');
        error.code = 'EIO';
        throw error;
      }
      return open.call(this, file, flags, ...args);
    };
    const result = applyJournaledCreation(f.bound, [change([f.a], 'records/item')]);
    fs.openSync = open;
    assert.equal(result.status, 'committed');
    assert.equal(result.journalState, 'pending-finalization');
    assert.equal(result.pendingMemory, true);
    assert.equal(result.result.created, 1);
    assert.equal(result.cause.code, 'INTERNAL');
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/item'), 'utf8'), 'content');
    assert.equal(getJournalOperation(f.bound, result.operationId).state, 'prepared');
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/new')]),
      (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('unconfirmed history cannot be bypassed by a missing outbox index', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    const destination = path.join(f.dir, 'records', 'item');
    fs.openSync = function (file, flags, ...args) {
      if (file === destination && flags === 'wx') {
        const error = new Error('fixture source failure');
        error.code = 'EIO';
        throw error;
      }
      return open.call(this, file, flags, ...args);
    };
    const result = applyJournaledCreation(f.bound, [change([f.a], 'records/item')]);
    fs.openSync = open;
    assert.equal(result.status, 'unconfirmed');
    fs.unlinkSync(path.join(f.journal, 'outbox', `${result.operationId}.json`));
    const before = tree(f.dir);
    assert.throws(() => listJournalPending(f.bound),
      (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    assert.deepEqual(tree(f.dir), before);
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/next')]),
      (e) => ['JOURNAL_RECOVERY_REQUIRED', 'JOURNAL_MALFORMED'].includes(e.code));
    assert.equal(fs.existsSync(path.join(f.dir, 'records/next')), false);
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('active pointer digest disagreement with indexed intent fails listing read-only', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    const destination = path.join(f.dir, 'records', 'item');
    fs.openSync = function (file, flags, ...args) {
      if (file === destination && flags === 'wx') throw new Error('fixture source failure');
      return open.call(this, file, flags, ...args);
    };
    const result = applyJournaledCreation(f.bound, [change([f.a], 'records/item')]);
    fs.openSync = open;
    assert.equal(result.status, 'unconfirmed');
    assert.equal(listJournalPending(f.bound).items[0].state, 'prepared');
    const headPath = path.join(f.journal, 'head.json');
    const head = JSON.parse(fs.readFileSync(headPath));
    head.activeOperation.intentDigest = head.activeOperation.intentDigest === 'a'.repeat(64)
      ? 'b'.repeat(64) : 'a'.repeat(64);
    fs.writeFileSync(headPath, JSON.stringify(head));
    const before = tree(f.dir);
    assert.throws(() => listJournalPending(f.bound), (e) => e.code === 'JOURNAL_MALFORMED');
    assert.deepEqual(tree(f.dir), before);
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('missing or corrupt head fails closed; sequence exhaustion never writes source', () => {
  for (const variant of ['missing', 'malformed', 'exhausted']) {
    const f = fixture();
    try {
      applyJournaledCreation(f.bound, [change([f.a], 'records/initial')]);
      const head = path.join(f.journal, 'head.json');
      if (variant === 'missing') fs.unlinkSync(head);
      else if (variant === 'malformed') fs.writeFileSync(head, '{"lastSequence":-1}');
      else fs.writeFileSync(head, JSON.stringify({ schemaVersion: 1,
        lastSequence: Number.MAX_SAFE_INTEGER, activeOperation: null }));
      assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/next')]),
        (e) => e.code === (variant === 'exhausted'
          ? 'JOURNAL_SEQUENCE_EXHAUSTED' : 'JOURNAL_MALFORMED'));
      assert.equal(fs.existsSync(path.join(f.dir, 'records', 'next')), false);
    } finally { cleanup(f.dir); }
  }
});

test('head behind an indexed event fails closed instead of reusing sequences', () => {
  const f = fixture();
  try {
    applyJournaledCreation(f.bound, [change([f.a], 'records/initial')]);
    fs.writeFileSync(path.join(f.journal, 'head.json'),
      JSON.stringify({ schemaVersion: 1, lastSequence: 0, activeOperation: null }));
    assert.throws(() => listJournalPending(f.bound), (e) => e.code === 'JOURNAL_MALFORMED');
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/next')]),
      (e) => e.code === 'JOURNAL_MALFORMED');
    assert.equal(fs.existsSync(path.join(f.dir, 'records/next')), false);
  } finally { cleanup(f.dir); }
});

test('pending capacity overflow fails before creating a source', () => {
  const f = fixture();
  const opendir = fs.opendirSync;
  try {
    const maxPending = loadJournalPolicy().maxPendingOperations;
    fs.mkdirSync(path.join(f.journal, 'outbox'), { recursive: true });
    fs.writeFileSync(path.join(f.journal, 'head.json'),
      JSON.stringify({ schemaVersion: 1, lastSequence: 0, activeOperation: null }));
    fs.opendirSync = function (dir, ...args) {
      if (dir !== path.join(f.journal, 'outbox')) return opendir.call(this, dir, ...args);
      let count = 0;
      return {
        readSync() {
          if (count++ > maxPending) return null;
          return { name: '00000000-0000-0000-0000-000000000000.json', isFile: () => true };
        },
        closeSync() {},
      };
    };
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/item')]),
      (e) => e.code === 'JOURNAL_CAPACITY');
    assert.equal(fs.existsSync(path.join(f.dir, 'records/item')), false);
  } finally { fs.opendirSync = opendir; cleanup(f.dir); }
});

test('a saturated outbox stays listable and drainable while writes fail closed', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    const ops = ['records/first', 'records/second', 'records/third'].map(
      (rel, index) => applyJournaledCreation(f.bound,
        [change([f.a], rel, 'content', `record-${index}`)]));
    // Shrink the authored pending bound below the live outbox depth by
    // redirecting the journal-policy read to a fixture copy.
    const shrunk = path.join(f.dir, 'journal-policy-shrunk.json');
    fs.writeFileSync(shrunk, JSON.stringify({ schemaVersion: 1,
      maxOperationEvents: 101, maxPendingOperations: 2,
      defaultPageSize: 50, maxPageSize: 100 }));
    fs.openSync = function (file, flags, ...args) {
      return open.call(this,
        String(file).endsWith(`${path.sep}journal.json`) ? shrunk : file,
        flags, ...args);
    };
    // Three indexes over the bound: the listing returns the bounded
    // window instead of deadlocking on JOURNAL_CAPACITY.
    const listed = listJournalPending(f.bound);
    assert.equal(listed.items.length, 2);
    const hidden = ops.find((op) =>
      listed.items.every((item) => item.operationId !== op.operationId));
    assert.ok(hidden);
    // Producers still fail closed at/over the bound.
    assert.throws(() => applyJournaledCreation(f.bound,
        [change([f.a], 'records/fourth', 'content', 'record-4')]),
      (e) => e.code === 'JOURNAL_CAPACITY');
    // Draining stays available per operation: ack removes the index.
    const event = getJournalEvent(f.bound, hidden.operationId,
      hidden.eventIds[0]).event;
    ackJournalEvent(f.bound, hidden.operationId, event.eventId, evidence(event));
    assert.equal(fs.existsSync(path.join(f.journal, 'outbox',
      `${hidden.operationId}.json`)), false);
    // At the bound every pending operation is visible; writes still fail.
    assert.equal(listJournalPending(f.bound).items.length, 2);
    assert.throws(() => applyJournaledCreation(f.bound,
        [change([f.a], 'records/fourth', 'content', 'record-4')]),
      (e) => e.code === 'JOURNAL_CAPACITY');
    // Recovery of a concrete operation also stays available.
    const target = ops.find((op) => op !== hidden);
    const { intentDigest } = getJournalOperation(f.bound, target.operationId);
    const preview = prepareJournalRecovery(f.bound, target.operationId, {
      action: 'finalize-committed', expectedIntentDigest: intentDigest,
      reason: 'capacity regression drain check' });
    assert.equal(preview.mode, 'dry-run');
    assert.deepEqual(preview.pendingEventIds, target.eventIds);
    const applied = recoverJournalOperation(f.bound, target.operationId, {
      action: 'finalize-committed', expectedIntentDigest: intentDigest,
      reason: 'capacity regression drain check' });
    assert.equal(applied.mode, 'applied');
    // Draining below the bound unblocks producers again.
    const last = ops.find((op) => op !== hidden && op !== target);
    const lastEvent = getJournalEvent(f.bound, last.operationId,
      last.eventIds[0]).event;
    ackJournalEvent(f.bound, last.operationId, lastEvent.eventId,
      evidence(lastEvent));
    const created = applyJournaledCreation(f.bound,
      [change([f.a], 'records/fourth', 'content', 'record-4')]);
    assert.ok(created.operationId);
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/fourth'), 'utf8'),
      'content');
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('head pointer cleanup failure keeps committed marker and blocks later writes', () => {
  const f = fixture();
  const rename = fs.renameSync;
  try {
    fs.renameSync = function (from, to, ...args) {
      if (to === path.join(f.journal, 'head.json')) {
        const candidate = JSON.parse(fs.readFileSync(from, 'utf8'));
        if (candidate.activeOperation === null) {
          const error = new Error('fixture head cleanup failure');
          error.code = 'EIO';
          throw error;
        }
      }
      return rename.call(this, from, to, ...args);
    };
    const result = applyJournaledCreation(f.bound, [change([f.a], 'records/item')]);
    fs.renameSync = rename;
    assert.equal(result.status, 'committed');
    assert.equal(result.journalState, 'confirmed');
    assert.equal(result.result.created, 1);
    assert.ok(result.warnings.some((warning) => warning.code === 'JOURNAL_RECOVERY_REQUIRED'));
    assert.equal(getJournalOperation(f.bound, result.operationId).state, 'committed');
    const head = JSON.parse(fs.readFileSync(path.join(f.journal, 'head.json')));
    assert.equal(head.activeOperation.operationId, result.operationId);
    const before = tree(f.dir);
    const listing = listJournalPending(f.bound);
    assert.equal(listing.items.length, 1);
    assert.equal(listing.items[0].operationId, result.operationId);
    assert.equal(listing.items[0].state, 'committed');
    assert.deepEqual(tree(f.dir), before);
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/next')]),
      (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/item'), 'utf8'), 'content');
    assert.equal(fs.existsSync(path.join(f.dir, 'records/next')), false);
  } finally { fs.renameSync = rename; cleanup(f.dir); }
});

test('cooperative lock contention is explicit; a replaced token is never removed', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    fs.mkdirSync(f.journal, { recursive: true });
    const lock = path.join(f.journal, '.lock');
    fs.writeFileSync(lock, 'foreign lock');
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/first')]),
      (e) => e.code === 'JOURNAL_LOCKED');
    assert.equal(fs.readFileSync(lock, 'utf8'), 'foreign lock');
    fs.unlinkSync(lock);
    fs.openSync = function (file, flags, ...args) {
      if (String(file).endsWith(`${path.sep}commit.json`) && flags === 'wx') {
        fs.writeFileSync(lock, 'replacement token');
      }
      return open.call(this, file, flags, ...args);
    };
    const result = applyJournaledCreation(f.bound, [change([f.a], 'records/first')]);
    fs.openSync = open;
    assert.equal(result.status, 'committed');
    assert.ok(result.warnings.length > 0);
    assert.equal(fs.readFileSync(lock, 'utf8'), 'replacement token');
    assert.equal(fs.readFileSync(path.join(f.dir, 'records/first'), 'utf8'), 'content');
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('lock acquisition failure does not remove a replaced token', () => {
  const f = fixture();
  const open = fs.openSync;
  const write = fs.writeSync;
  let lockFd;
  try {
    const lock = path.join(f.journal, '.lock');
    fs.openSync = function (file, flags, ...args) {
      const result = open.call(this, file, flags, ...args);
      if (file === lock && flags === 'wx') lockFd = result;
      return result;
    };
    fs.writeSync = function (fd, ...args) {
      if (fd === lockFd) {
        fs.writeFileSync(lock, 'replacement token');
        const error = new Error('fixture lock write failure');
        error.code = 'EIO';
        throw error;
      }
      return write.call(this, fd, ...args);
    };
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/item')]));
    fs.openSync = open;
    fs.writeSync = write;
    assert.equal(fs.readFileSync(lock, 'utf8'), 'replacement token');
    assert.equal(fs.existsSync(path.join(f.dir, 'records/item')), false);
  } finally { fs.openSync = open; fs.writeSync = write; cleanup(f.dir); }
});

test('snapshot missing or tampered and persisted metadata tampering fail explicitly', () => {
  const f = fixture();
  try {
    const result = applyJournaledCreation(f.bound, [change([f.a], 'records/item')]);
    const { event } = getJournalEvent(f.bound, result.operationId, result.eventIds[0]);
    const snapshot = path.join(f.dir, ...event.snapshotRef.split('/'));
    fs.writeFileSync(snapshot, 'different');
    assert.throws(() => readJournalSnapshot(f.bound, result.operationId, event.eventId),
      (e) => e.code === 'JOURNAL_SNAPSHOT_MISMATCH');
    assert.throws(() => ackJournalEvent(f.bound, result.operationId, event.eventId, evidence(event)),
      (e) => e.code === 'JOURNAL_SNAPSHOT_MISMATCH');
    fs.unlinkSync(snapshot);
    assert.throws(() => readJournalSnapshot(f.bound, result.operationId, event.eventId),
      (e) => e.code === 'JOURNAL_SNAPSHOT_MISSING');
    const intent = path.join(f.journal, 'operations', result.operationId, 'intent.json');
    const parsed = JSON.parse(fs.readFileSync(intent));
    parsed.events[0].sourceRel = '../escape';
    fs.writeFileSync(intent, JSON.stringify(parsed));
    assert.throws(() => getJournalOperation(f.bound, result.operationId));
  } finally { cleanup(f.dir); }
});

test('event reads require only their own all-of grants and pagination hides foreign areas', () => {
  const f = fixture();
  try {
    const result = applyJournaledCreation(f.bound, [
      change([f.a], 'records/a', 'a', 'a'),
      change([f.b], 'records/b', 'b', 'b'),
      change([f.a, f.b], 'records/shared', 'shared', 'shared'),
      change([f.a], 'records/a2', 'a2', 'a2'),
    ]);
    assert.throws(() => getJournalOperation(f.alpha, result.operationId),
      (e) => e.code === 'SCOPE_DENIED');
    const a = getJournalEvent(f.alpha, result.operationId, result.eventIds[0]);
    assert.equal(a.event.recordId, 'a');
    assert.deepEqual(Object.keys(a).sort(), ['event', 'intentDigest', 'state']);
    assert.deepEqual(readJournalSnapshot(f.alpha, result.operationId, result.eventIds[0]),
      Buffer.from('a'));
    for (const eventId of result.eventIds.slice(1, 3)) {
      assert.throws(() => getJournalEvent(f.alpha, result.operationId, eventId),
        (e) => e.code === 'SCOPE_DENIED');
      assert.throws(() => readJournalSnapshot(f.alpha, result.operationId, eventId),
        (e) => e.code === 'SCOPE_DENIED');
    }
    const first = listJournalPending(f.alpha, { afterSequence: 0, limit: 1 });
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0].event.recordId, 'a');
    assert.equal(first.nextAfterSequence, first.items[0].event.journalSequence);
    const second = listJournalPending(f.alpha,
      { afterSequence: first.nextAfterSequence, limit: 1 });
    assert.equal(second.items.length, 1);
    assert.equal(second.items[0].event.recordId, 'a2');
    assert.equal(second.nextAfterSequence, null);
    assert.deepEqual(listJournalPending(f.beta).items.map((item) => item.event.recordId),
      ['b']);
    for (const bad of [
      null, [], { extra: true }, { afterSequence: -1 }, { afterSequence: 1.5 },
      { limit: 0 }, { limit: 101 }, { limit: 1.5 },
      Object.assign(Object.create({ limit: 1 }), {}),
    ]) {
      assert.throws(() => listJournalPending(f.bound, bad),
        (e) => e.code === 'INVALID_JOURNAL_INPUT');
    }
  } finally { cleanup(f.dir); }
});

test('ack requires committed event and verified snapshot, retains first receipt and removes only index', () => {
  const f = fixture();
  try {
    const result = applyJournaledCreation(f.bound, [
      change([f.a], 'records/a', 'a', 'a'),
      change([f.b], 'records/b', 'b', 'b'),
    ]);
    const first = getJournalEvent(f.bound, result.operationId, result.eventIds[0]).event;
    const second = getJournalEvent(f.bound, result.operationId, result.eventIds[1]).event;
    const index = path.join(f.journal, 'outbox', `${result.operationId}.json`);
    for (const bad of [
      evidence(first, { remoteKey: second.eventId }),
      evidence(first, { eventDigest: 'a'.repeat(64) }),
      evidence(first, { sourceHash: 'a'.repeat(64) }),
      evidence(first, { confirmedAt: 'yesterday' }),
      evidence(first, { backendId: 'Bad' }),
      { ...evidence(first), extra: true },
    ]) {
      assert.throws(() => ackJournalEvent(f.bound, result.operationId, first.eventId, bad));
      assert.equal(fs.existsSync(index), true);
    }
    assert.throws(() => ackJournalEvent(f.alpha, result.operationId, second.eventId,
      evidence(second)), (e) => e.code === 'SCOPE_DENIED');
    ackJournalEvent(f.alpha, result.operationId, first.eventId, evidence(first));
    const ack = path.join(f.journal, 'operations', result.operationId, 'acks', `${first.eventId}.json`);
    const firstBytes = fs.readFileSync(ack);
    ackJournalEvent(f.alpha, result.operationId, first.eventId,
      evidence(first, { confirmedAt: '2026-11-10T12:00:00.000Z' }));
    assert.deepEqual(fs.readFileSync(ack), firstBytes);
    assert.throws(() => ackJournalEvent(f.alpha, result.operationId, first.eventId,
      evidence(first, { remoteNamespace: 'different' })),
    (e) => e.code === 'JOURNAL_ACK_CONFLICT');
    for (const conflicting of [
      evidence(first, { remoteKey: second.eventId }),
      evidence(first, { eventDigest: 'a'.repeat(64) }),
      evidence(first, { sourceHash: 'a'.repeat(64) }),
    ]) {
      assert.throws(() => ackJournalEvent(f.alpha, result.operationId, first.eventId, conflicting),
        (e) => e.code === 'JOURNAL_ACK_CONFLICT');
    }
    assert.equal(fs.existsSync(index), true);
    assert.deepEqual(listJournalPending(f.bound).items.map((item) => item.event.eventId),
      [second.eventId]);
    const intent = path.join(f.journal, 'operations', result.operationId, 'intent.json');
    const commit = path.join(f.journal, 'operations', result.operationId, 'commit.json');
    const intentBytes = fs.readFileSync(intent);
    const commitBytes = fs.readFileSync(commit);
    const sourceBytes = fs.readFileSync(path.join(f.dir, 'records/a'));
    ackJournalEvent(f.beta, result.operationId, second.eventId, evidence(second));
    assert.equal(fs.existsSync(index), false);
    assert.deepEqual(listJournalPending(f.bound), { items: [], nextAfterSequence: null });
    assert.deepEqual(fs.readFileSync(intent), intentBytes);
    assert.deepEqual(fs.readFileSync(commit), commitBytes);
    assert.deepEqual(fs.readFileSync(path.join(f.dir, 'records/a')), sourceBytes);
    assert.deepEqual(fs.readFileSync(ack), firstBytes);
    assert.deepEqual(readJournalSnapshot(f.alpha, result.operationId, first.eventId),
      Buffer.from('a'));
  } finally { cleanup(f.dir); }
});

test('malformed outbox index fails closed on reads and new writes', () => {
  const f = fixture();
  try {
    const result = applyJournaledCreation(f.bound, [change([f.a], 'records/a')]);
    const index = path.join(f.journal, 'outbox', `${result.operationId}.json`);
    fs.writeFileSync(index, JSON.stringify({
      schemaVersion: 1, operationId: result.operationId, intentDigest: 'a'.repeat(64),
    }));
    assert.throws(() => listJournalPending(f.bound), (e) => e.code === 'JOURNAL_MALFORMED');
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/b')]),
      (e) => e.code === 'JOURNAL_MALFORMED');
    assert.equal(fs.existsSync(path.join(f.dir, 'records/b')), false);
  } finally { cleanup(f.dir); }
});

test('forged and stale bindings are denied; original context mutation cannot redirect writes', () => {
  const f = fixture();
  const other = fixture();
  try {
    const input = [change([f.a], 'records/item')];
    assert.throws(() => applyJournaledCreation({ ...f.bound }, input),
      (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => applyJournaledCreation(f.alpha, [change([f.a, f.b], 'records/shared')]),
      (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => applyJournaledCreation(other.bound, input),
      (e) => e.code === 'SCOPE_DENIED');
    f.ctx.projectRoot = other.dir;
    f.ctx.config.paths.state = '.tasksystem/redirect';
    const result = applyJournaledCreation(f.bound, input);
    assert.equal(result.status, 'committed');
    assert.equal(fs.existsSync(path.join(f.dir, 'records/item')), true);
    assert.equal(fs.existsSync(path.join(other.dir, 'records/item')), false);
    const metadata = path.join(f.dir, '.tasksystem/state/workspace.json');
    fs.unlinkSync(metadata);
    assert.throws(() => listJournalPending(f.bound), (e) => e.code === 'WORKSPACE_STALE');
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/new')]),
      (e) => e.code === 'WORKSPACE_STALE');
  } finally { cleanup(f.dir); cleanup(other.dir); }
});

test('journal path links are rejected without following them', (t) => {
  const f = fixture();
  const target = makeTempDir('journal-link-target');
  try {
    if (!trySymlink(target, f.journal)) {
      t.skip('directory junctions unavailable');
      return;
    }
    assert.throws(() => listJournalPending(f.bound), (e) => e.code === 'SYMLINK_REJECTED');
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/item')]),
      (e) => e.code === 'SYMLINK_REJECTED');
    assert.deepEqual(fs.readdirSync(target), []);
  } finally { cleanup(f.dir); cleanup(target); }
});

test('outbox index links are rejected without reading their targets', (t) => {
  const f = fixture();
  const target = makeTempDir('journal-index-target');
  try {
    const result = applyJournaledCreation(f.bound, [change([f.a], 'records/item')]);
    const index = path.join(f.journal, 'outbox', `${result.operationId}.json`);
    const contents = fs.readFileSync(index);
    const targetFile = writeFile(target, 'index.json', contents);
    fs.unlinkSync(index);
    if (!trySymlink(targetFile, index, 'file')) {
      t.skip('file symlinks unavailable');
      return;
    }
    assert.throws(() => listJournalPending(f.bound), (e) => e.code === 'SYMLINK_REJECTED');
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/other')]),
      (e) => e.code === 'SYMLINK_REJECTED');
    assert.deepEqual(fs.readFileSync(targetFile), contents);
  } finally { cleanup(f.dir); cleanup(target); }
});

test('bound project root removal and junction replacement deny journal access', (t) => {
  const f = fixture();
  const moved = `${f.dir}-moved`;
  try {
    fs.renameSync(f.dir, moved);
    assert.throws(() => listJournalPending(f.bound), (e) => e.code === 'PROJECT_NOT_FOUND');
    if (!trySymlink(moved, f.dir)) {
      t.skip('directory junctions unavailable');
      return;
    }
    assert.throws(() => listJournalPending(f.bound), (e) => e.code === 'SYMLINK_REJECTED');
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/item')]),
      (e) => e.code === 'SYMLINK_REJECTED');
  } finally { cleanup(f.dir); cleanup(moved); }
});

test('strict record seam shares one frozen generated identity across both events', () => {
  const f = fixture();
  try {
    let seen;
    const result = applyJournaledRecordCreation(f.bound, (identity) => {
      seen = identity;
      assert.equal(Object.isFrozen(identity), true);
      const operationId = identity.operationId;
      try { identity.operationId = 'mutated-caller-value'; } catch { /* strict modules */ }
      assert.equal(identity.operationId, operationId);
      assert.equal(new Date(identity.createdAt).toISOString(), identity.createdAt);
      return [
        change([f.a], 'records/capture', 'note', 'note-id'),
        { ...change([f.b], 'records/ownership', 'sidecar', 'note-id'),
          sourceKind: 'record-ownership' },
      ];
    });
    assert.equal(result.status, 'committed');
    assert.equal(result.journalState, 'confirmed');
    assert.equal(result.operationId, seen.operationId);
    assert.equal(result.eventIds.length, 2);
    const loaded = getJournalOperation(f.bound, result.operationId);
    assert.equal(loaded.intent.operationId, seen.operationId);
    assert.equal(loaded.intent.createdAt, seen.createdAt);
    for (const eventId of result.eventIds) {
      const { event } = getJournalEvent(f.bound, result.operationId, eventId);
      assert.equal(event.operationId, seen.operationId);
      assert.equal(event.createdAt, seen.createdAt);
    }
  } finally { cleanup(f.dir); }
});

test('strict record seam rejects invalid callbacks and returns before any write', () => {
  const f = fixture();
  try {
    const before = tree(f.dir);
    for (const callback of [null, 7, 'callback', {}, []]) {
      assert.throws(() => applyJournaledRecordCreation(f.bound, callback),
        (e) => e.code === 'INVALID_JOURNAL_INPUT');
    }
    assert.throws(() => applyJournaledRecordCreation(f.bound,
      async () => [change([f.a], 'records/item')]),
      (e) => e.code === 'INVALID_JOURNAL_INPUT');
    for (const value of [undefined, 'x', {}, [{ bad: true }]]) {
      assert.throws(() => applyJournaledRecordCreation(f.bound, () => value),
        (e) => e.code === 'INVALID_JOURNAL_INPUT');
    }
    assert.deepEqual(tree(f.dir), before);
  } finally { cleanup(f.dir); }
});

test('strict record seam rejects existing matching files before any reservation', () => {
  for (const variant of ['all-noop', 'mixed']) {
    const f = fixture();
    try {
      writeFile(f.dir, 'records/item', 'content');
      const before = tree(f.dir);
      const changes = [change([f.a], 'records/item', 'content')];
      if (variant === 'mixed') {
        changes.push(change([f.a], 'records/new', 'fresh', 'record-2'));
      }
      assert.throws(() => applyJournaledRecordCreation(f.bound, () => changes),
        (e) => e.code === 'JOURNAL_SOURCE_CONFLICT');
      assert.deepEqual(tree(f.dir), before);
      assert.equal(fs.existsSync(path.join(f.dir, 'records', 'new')), false);
    } finally { cleanup(f.dir); }
  }
});

test('strict record seam rejects a noop introduced before under-lock preflight', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    const lockFile = path.join(f.journal, '.lock');
    fs.openSync = function (file, flags, ...args) {
      const fd = open.call(this, file, flags, ...args);
      if (file === lockFile && flags === 'wx') {
        writeFile(f.dir, 'records/item', 'content-item');
      }
      return fd;
    };
    assert.throws(() => applyJournaledRecordCreation(f.bound,
      () => [change([f.a], 'records/item', 'content-item')]),
      (e) => e.code === 'JOURNAL_SOURCE_CONFLICT');
    assert.equal(fs.readFileSync(path.join(f.dir, 'records', 'item'), 'utf8'), 'content-item');
    assert.equal(fs.existsSync(path.join(f.journal, 'head.json')), false);
    assert.equal(fs.existsSync(path.join(f.journal, 'operations')), false);
    assert.equal(fs.existsSync(path.join(f.journal, 'outbox')), false);
    assert.equal(fs.existsSync(path.join(f.journal, 'snapshots')), false);
    assert.equal(fs.existsSync(lockFile), false);
  } finally { fs.openSync = open; cleanup(f.dir); }
});

// Crash seam: persistIntent reserves the head first, so a failed intent
// write leaves head.activeOperation pointing at an intent.json that never
// landed - the wedged state this block of tests recovers from.
function wedgedIntent(f) {
  const open = fs.openSync;
  try {
    fs.openSync = function (file, flags, ...args) {
      if (flags === 'wx' && String(file).endsWith(`${path.sep}intent.json`)) {
        const error = new Error('fixture intent failure');
        error.code = 'EIO';
        throw error;
      }
      return open.call(this, file, flags, ...args);
    };
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/item')]));
  } finally { fs.openSync = open; }
  const headPath = path.join(f.journal, 'head.json');
  const head = JSON.parse(fs.readFileSync(headPath));
  assert.ok(head.activeOperation);
  const operationId = head.activeOperation.operationId;
  const operationDir = path.join(f.journal, 'operations', operationId);
  const intent = path.join(operationDir, 'intent.json');
  assert.equal(fs.existsSync(intent), false);
  assert.equal(fs.existsSync(path.join(f.journal, 'outbox', `${operationId}.json`)), false);
  return { operationId, intentDigest: head.activeOperation.intentDigest,
    lastSequence: head.lastSequence, headPath, operationDir, intent };
}

function abandonOptions(wedged, overrides = {}) {
  return { action: 'abandon-prepared', expectedIntentDigest: wedged.intentDigest,
    reason: 'wedged reservation', ...overrides };
}

test('abandon resolves a head reservation whose intent was never persisted', () => {
  const f = fixture();
  try {
    const wedged = wedgedIntent(f);
    const options = abandonOptions(wedged);
    assert.throws(() => listJournalPending(f.bound),
      (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    assert.throws(() => applyJournaledCreation(f.bound, [change([f.a], 'records/next')]),
      (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    assert.throws(() => getJournalOperation(f.bound, wedged.operationId),
      (e) => e.code === 'JOURNAL_NOT_FOUND');
    const before = tree(f.dir);
    const preview = prepareJournalRecovery(f.bound, wedged.operationId, options);
    assert.equal(preview.mode, 'dry-run');
    assert.equal(preview.state, 'missing');
    assert.equal(preview.intentDigest, wedged.intentDigest);
    assert.equal(preview.action, 'abandon-prepared');
    assert.equal(preview.sourceOutcome, 'unconfirmed');
    assert.equal(preview.preservesSources, true);
    assert.deepEqual(preview.pendingEventIds, []);
    assert.deepEqual(tree(f.dir), before);
    const result = recoverJournalOperation(f.bound, wedged.operationId, options);
    assert.equal(result.mode, 'applied');
    assert.equal(result.state, 'abandoned');
    assert.equal(result.intentDigest, wedged.intentDigest);
    assert.deepEqual(result.pendingEventIds, []);
    const receipt = JSON.parse(fs.readFileSync(
      path.join(wedged.operationDir, 'recovery.json')));
    assert.equal(receipt.action, 'abandon-prepared');
    assert.equal(receipt.intentDigest, wedged.intentDigest);
    assert.equal(receipt.sourceOutcome, 'unconfirmed');
    const head = JSON.parse(fs.readFileSync(wedged.headPath));
    assert.equal(head.activeOperation, null);
    assert.equal(head.lastSequence, wedged.lastSequence);
    assert.deepEqual(listJournalPending(f.bound), { items: [], nextAfterSequence: null });
    const next = applyJournaledCreation(f.bound,
      [change([f.a], 'records/next', 'next', 'next')]);
    assert.equal(next.status, 'committed');
    assert.equal(getJournalEvent(f.bound, next.operationId, next.eventIds[0])
      .event.journalSequence, wedged.lastSequence + 1);
    const again = recoverJournalOperation(f.bound, wedged.operationId, options);
    assert.equal(again.state, 'abandoned');
    assert.deepEqual(again.recovery, receipt);
  } finally { cleanup(f.dir); }
});

test('abandon unlinks a stranded outbox index for a missing intent', () => {
  const f = fixture();
  try {
    const wedged = wedgedIntent(f);
    writeJson(f.dir,
      `.tasksystem/state/journal/outbox/${wedged.operationId}.json`,
      { schemaVersion: 1, operationId: wedged.operationId,
        intentDigest: wedged.intentDigest });
    const result = recoverJournalOperation(f.bound, wedged.operationId,
      abandonOptions(wedged));
    assert.equal(result.state, 'abandoned');
    assert.equal(fs.existsSync(
      path.join(f.journal, 'outbox', `${wedged.operationId}.json`)), false);
    assert.equal(JSON.parse(fs.readFileSync(wedged.headPath)).activeOperation, null);
    const next = applyJournaledCreation(f.bound,
      [change([f.a], 'records/next', 'next', 'next')]);
    assert.equal(next.status, 'committed');
  } finally { cleanup(f.dir); }
});

test('wedged abandon resumes after head cleanup failure reusing the receipt', () => {
  const f = fixture();
  const rename = fs.renameSync;
  try {
    const wedged = wedgedIntent(f);
    const options = abandonOptions(wedged);
    fs.renameSync = function (from, to, ...args) {
      if (to === wedged.headPath
          && JSON.parse(fs.readFileSync(from)).activeOperation === null) {
        throw new Error('fixture head cleanup failure');
      }
      return rename.call(this, from, to, ...args);
    };
    assert.throws(() => recoverJournalOperation(f.bound, wedged.operationId, options));
    fs.renameSync = rename;
    const receipt = path.join(wedged.operationDir, 'recovery.json');
    const bytes = fs.readFileSync(receipt);
    assert.ok(JSON.parse(fs.readFileSync(wedged.headPath)).activeOperation);
    const result = recoverJournalOperation(f.bound, wedged.operationId, options);
    assert.equal(result.state, 'abandoned');
    assert.deepEqual(fs.readFileSync(receipt), bytes);
    assert.equal(JSON.parse(fs.readFileSync(wedged.headPath)).activeOperation, null);
    const next = applyJournaledCreation(f.bound,
      [change([f.a], 'records/next', 'next', 'next')]);
    assert.equal(next.status, 'committed');
  } finally { fs.renameSync = rename; cleanup(f.dir); }
});

test('missing intent recovery still fails closed on conflicts and artifacts', () => {
  for (const variant of ['malformed-intent', 'commit-marker', 'bad-index',
    'wrong-digest', 'other-action', 'other-reason', 'foreign-active',
    'unknown-operation']) {
    const f = fixture();
    try {
      const wedged = wedgedIntent(f);
      const options = abandonOptions(wedged);
      let operationId = wedged.operationId;
      if (variant === 'malformed-intent') fs.writeFileSync(wedged.intent, '{bad');
      if (variant === 'commit-marker') {
        fs.writeFileSync(path.join(wedged.operationDir, 'commit.json'), '{}');
      }
      if (variant === 'bad-index') {
        writeJson(f.dir,
          `.tasksystem/state/journal/outbox/${wedged.operationId}.json`,
          { schemaVersion: 1, operationId: wedged.operationId,
            intentDigest: 'a'.repeat(64) });
      }
      if (variant === 'wrong-digest') options.expectedIntentDigest = 'a'.repeat(64);
      if (variant === 'other-action') options.action = 'finalize-committed';
      if (variant === 'other-reason') options.reason = 'different decision';
      if (variant === 'foreign-active') {
        const head = JSON.parse(fs.readFileSync(wedged.headPath));
        head.activeOperation.operationId = crypto.randomUUID();
        fs.writeFileSync(wedged.headPath, JSON.stringify(head));
      }
      if (variant === 'other-reason' || variant === 'foreign-active') {
        fs.writeFileSync(path.join(wedged.operationDir, 'recovery.json'),
          JSON.stringify({ schemaVersion: 1, operationId: wedged.operationId,
            intentDigest: wedged.intentDigest, action: 'abandon-prepared',
            sourceOutcome: 'unconfirmed', reason: 'wedged reservation',
            decidedAt: '2026-11-17T00:00:00.000Z' }));
      }
      if (variant === 'unknown-operation') {
        fs.writeFileSync(wedged.headPath, JSON.stringify({ schemaVersion: 1,
          lastSequence: wedged.lastSequence, activeOperation: null }));
        operationId = crypto.randomUUID();
      }
      const expected = variant === 'wrong-digest' || variant === 'foreign-active'
          || variant === 'other-reason'
        ? 'JOURNAL_RECOVERY_CONFLICT'
        : variant === 'other-action' || variant === 'unknown-operation'
          ? 'JOURNAL_NOT_FOUND' : 'JOURNAL_MALFORMED';
      const before = tree(f.dir);
      assert.throws(() => prepareJournalRecovery(f.bound, operationId, options),
        (e) => e.code === expected, variant);
      assert.throws(() => recoverJournalOperation(f.bound, operationId, options),
        (e) => e.code === expected, variant);
      assert.deepEqual(tree(f.dir), before, variant);
    } finally { cleanup(f.dir); }
  }
});
