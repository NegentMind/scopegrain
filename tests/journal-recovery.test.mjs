// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { canonicalDigest } from '../src/core/digests.mjs';
import { loadJournalPolicy, loadLimits } from '../src/core/policy.mjs';
import {
  ackJournalEvent, applyJournaledCreation, getJournalEvent, getJournalOperation,
  listJournalPending, prepareJournalRecovery, recoverJournalOperation,
} from '../src/core/journal.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import { createVantaDBProjector } from '../src/integrations/vantadb.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, trySymlink, writeFile, writeJson }
  from './helpers.mjs';

function fixture() {
  const dir = makeTempDir('journal-recovery');
  writeJson(dir, '.scopegrain/config.json', createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir, config: '.scopegrain/config.json' });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  return { dir, ctx, a, b, bound: bindWorkspace(ctx, { areaIds: [a, b] }),
    alpha: bindWorkspace(ctx, { areaIds: [a] }),
    journal: path.join(dir, '.scopegrain/state/journal') };
}

function change(areaIds, id, content = `content-${id}`) {
  return { sourceKind: 'task', recordId: id, sourceRevision: 0,
    areaIds, file: { rel: `records/${id}`, content } };
}

function options(f, result, action, reason = 'operator decision') {
  return { action, expectedIntentDigest: getJournalOperation(f.bound, result.operationId).intentDigest,
    reason };
}

function head(f) { return path.join(f.journal, 'head.json'); }
function index(f, r) { return path.join(f.journal, 'outbox', `${r.operationId}.json`); }
function operationFile(f, r, file) {
  return path.join(f.journal, 'operations', r.operationId, file);
}

function committedActive(f, changes = [change([f.a], 'item')]) {
  const rename = fs.renameSync;
  try {
    fs.renameSync = function (from, to, ...args) {
      if (to === head(f) && JSON.parse(fs.readFileSync(from)).activeOperation === null) {
        throw new Error('fixture head cleanup failure');
      }
      return rename.call(this, from, to, ...args);
    };
    const result = applyJournaledCreation(f.bound, changes);
    assert.equal(result.status, 'committed');
    assert.equal(result.journalState, 'confirmed');
    return result;
  } finally { fs.renameSync = rename; }
}

function prepared(f, variant = 'source', name = 'item') {
  const open = fs.openSync;
  try {
    fs.openSync = function (file, flags, ...args) {
      if (flags === 'wx' && ((variant === 'source' && file === path.join(f.dir, 'records', name))
          || (variant === 'marker' && String(file).endsWith(`${path.sep}commit.json`)))) {
        throw new Error(`fixture ${variant} failure`);
      }
      return open.call(this, file, flags, ...args);
    };
    const result = applyJournaledCreation(f.bound, [change([f.a], name)]);
    assert.equal(result.journalState, variant === 'source' ? 'prepared' : 'pending-finalization');
    return result;
  } finally { fs.openSync = open; }
}

function evidence(e) {
  return { backendId: 'fixture', remoteNamespace: 'fixture', remoteKey: e.eventId,
    eventDigest: canonicalDigest(e), sourceHash: e.sourceHash,
    confirmedAt: '2026-11-16T10:00:00.000Z' };
}

function tree(dir) {
  const result = {};
  function visit(abs, rel = '') {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { result[name] = 'directory'; visit(path.join(abs, entry.name), name); }
      else result[name] = fs.readFileSync(path.join(abs, entry.name));
    }
  }
  visit(dir);
  return result;
}

test('previews and invalid requests are strictly read-only', () => {
  const f = fixture();
  try {
    const r = committedActive(f);
    const o = options(f, r, 'finalize-committed', '  keep this reason  ');
    const before = tree(f.dir);
    const preview = prepareJournalRecovery(f.bound, r.operationId, o);
    assert.deepEqual(preview, { mode: 'dry-run', operationId: r.operationId,
      intentDigest: o.expectedIntentDigest, action: o.action, reason: o.reason,
      state: 'committed', sourceOutcome: 'committed', preservesSources: true,
      pendingEventIds: r.eventIds, recovery: null, warnings: [] });
    assert.deepEqual(tree(f.dir), before);
    const getter = { ...o };
    Object.defineProperty(getter, 'reason', { enumerable: true, get() { throw new Error('getter'); } });
    for (const invalid of [null, {}, [], { ...o, extra: true }, { ...o, reason: '  ' },
      { ...o, action: 'other' }, { ...o, expectedIntentDigest: 'A'.repeat(64) },
      Object.assign(Object.create({ reason: 'x' }), o), getter]) {
      assert.throws(() => prepareJournalRecovery(f.bound, r.operationId, invalid),
        (e) => e.code === 'INVALID_JOURNAL_INPUT');
      assert.throws(() => recoverJournalOperation(f.bound, r.operationId, invalid),
        (e) => e.code === 'INVALID_JOURNAL_INPUT');
    }
    assert.throws(() => recoverJournalOperation(f.bound, crypto.randomUUID(), o),
      (e) => e.code === 'JOURNAL_NOT_FOUND');
    assert.throws(() => recoverJournalOperation(f.bound, r.operationId,
      { ...o, reason: 'x'.repeat(loadLimits().maxDocumentBytes) }),
    (e) => e.code === 'DOCUMENT_TOO_LARGE');
    assert.deepEqual(tree(f.dir), before);
  } finally { cleanup(f.dir); }
});

test('finalize preserves immutable artifacts and next create advances sequence', () => {
  const f = fixture();
  try {
    const r = committedActive(f);
    const event = getJournalEvent(f.bound, r.operationId, r.eventIds[0]).event;
    const preserved = [
      path.join(f.dir, event.sourceRel), path.join(f.dir, event.snapshotRef),
      operationFile(f, r, 'intent.json'), operationFile(f, r, 'commit.json'),
    ];
    const bytes = preserved.map((file) => fs.readFileSync(file));
    const o = options(f, r, 'finalize-committed');
    const result = recoverJournalOperation(f.bound, r.operationId, o);
    assert.equal(result.mode, 'applied');
    assert.equal(result.state, 'committed');
    assert.equal(result.sourceOutcome, 'committed');
    assert.deepEqual(result.pendingEventIds, r.eventIds);
    assert.equal(result.preservesSources, true);
    assert.deepEqual(preserved.map((file) => fs.readFileSync(file)), bytes);
    assert.equal(JSON.parse(fs.readFileSync(head(f))).activeOperation, null);
    assert.deepEqual(getJournalOperation(f.bound, r.operationId).recovery, result.recovery);
    const next = applyJournaledCreation(f.bound, [change([f.a], 'next')]);
    assert.ok(getJournalEvent(f.bound, next.operationId, next.eventIds[0]).event.journalSequence
      > event.journalSequence);
  } finally { cleanup(f.dir); }
});

test('explicit finalize restores missing index for active and null pointers without history scans', () => {
  for (const active of [true, false]) {
    const f = fixture();
    const opendir = fs.opendirSync;
    try {
      const r = active ? committedActive(f) : applyJournaledCreation(f.bound, [change([f.a], 'item')]);
      const o = options(f, r, 'finalize-committed');
      fs.unlinkSync(index(f, r));
      const before = tree(f.dir);
      if (active) {
        assert.throws(() => listJournalPending(f.bound), (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
      } else {
        assert.deepEqual(listJournalPending(f.bound), { items: [], nextAfterSequence: null });
      }
      assert.deepEqual(tree(f.dir), before);
      fs.opendirSync = function (dir, ...args) {
        if (dir === path.join(f.journal, 'operations')) {
          throw new Error('unexpected history enumeration');
        }
        return opendir.call(this, dir, ...args);
      };
      const preview = prepareJournalRecovery(f.bound, r.operationId, o);
      assert.deepEqual(preview.pendingEventIds, r.eventIds);
      assert.deepEqual(tree(f.dir), before);
      const applied = recoverJournalOperation(f.bound, r.operationId, o);
      assert.deepEqual(applied.pendingEventIds, r.eventIds);
      fs.opendirSync = opendir;
      assert.deepEqual(listJournalPending(f.bound).items.map((item) => item.event.eventId), r.eventIds);
      assert.deepEqual(JSON.parse(fs.readFileSync(index(f, r))), {
        schemaVersion: 1, operationId: r.operationId, intentDigest: o.expectedIntentDigest,
      });
    } finally { fs.opendirSync = opendir; cleanup(f.dir); }
  }
});

test('recovery rejects a full outbox before any receipt or metadata mutation', () => {
  const f = fixture();
  const opendir = fs.opendirSync;
  try {
    const r = committedActive(f);
    const o = options(f, r, 'finalize-committed');
    fs.unlinkSync(index(f, r));
    const before = tree(f.dir);
    const max = loadJournalPolicy().maxPendingOperations;
    const outbox = path.join(f.journal, 'outbox');
    let scans = 0;
    fs.opendirSync = function (dir, ...args) {
      if (dir === path.join(f.journal, 'operations')) throw new Error('unexpected history scan');
      if (dir !== outbox) return opendir.call(this, dir, ...args);
      scans += 1;
      let count = 0;
      return {
        readSync() {
          if (count++ >= max) return null;
          return { name: '00000000-0000-0000-0000-000000000000.json', isFile: () => true };
        },
        closeSync() {},
      };
    };
    assert.throws(() => prepareJournalRecovery(f.bound, r.operationId, o),
      (e) => e.code === 'JOURNAL_CAPACITY');
    assert.deepEqual(tree(f.dir), before);
    assert.throws(() => recoverJournalOperation(f.bound, r.operationId, o),
      (e) => e.code === 'JOURNAL_CAPACITY');
    assert.ok(scans >= 2);
    assert.deepEqual(tree(f.dir), before);
    assert.equal(fs.existsSync(operationFile(f, r, 'recovery.json')), false);
    assert.equal(fs.existsSync(index(f, r)), false);
  } finally { fs.opendirSync = opendir; cleanup(f.dir); }
});

test('finalize fully acked operation leaves index absent and retains original ACK bytes', () => {
  const f = fixture();
  try {
    const r = committedActive(f);
    const e = getJournalEvent(f.bound, r.operationId, r.eventIds[0]).event;
    ackJournalEvent(f.bound, r.operationId, e.eventId, evidence(e));
    const ack = operationFile(f, r, `acks/${e.eventId}.json`);
    const before = fs.readFileSync(ack);
    assert.equal(fs.existsSync(index(f, r)), false);
    const o = options(f, r, 'finalize-committed');
    const result = recoverJournalOperation(f.bound, r.operationId, o);
    assert.deepEqual(result.pendingEventIds, []);
    assert.equal(fs.existsSync(index(f, r)), false);
    assert.deepEqual(fs.readFileSync(ack), before);
    assert.equal(JSON.parse(fs.readFileSync(head(f))).activeOperation, null);
  } finally { cleanup(f.dir); }
});

test('matching source without marker cannot finalize; abandon preserves it and unblocks writes', async () => {
  const f = fixture();
  try {
    const r = prepared(f, 'marker');
    const source = path.join(f.dir, 'records/item');
    const bytes = fs.readFileSync(source);
    const finalize = options(f, r, 'finalize-committed');
    const abandon = options(f, r, 'abandon-prepared');
    const before = tree(f.dir);
    assert.throws(() => prepareJournalRecovery(f.bound, r.operationId, finalize),
      (e) => e.code === 'JOURNAL_RECOVERY_CONFLICT');
    assert.deepEqual(tree(f.dir), before);
    const preview = prepareJournalRecovery(f.bound, r.operationId, abandon);
    assert.equal(preview.state, 'prepared');
    assert.equal(preview.sourceOutcome, 'unconfirmed');
    assert.deepEqual(tree(f.dir), before);
    const result = recoverJournalOperation(f.bound, r.operationId, abandon);
    assert.equal(result.state, 'abandoned');
    assert.equal(result.sourceOutcome, 'unconfirmed');
    assert.deepEqual(result.pendingEventIds, []);
    assert.deepEqual(fs.readFileSync(source), bytes);
    assert.equal(fs.existsSync(operationFile(f, r, 'commit.json')), false);
    const e = getJournalEvent(f.bound, r.operationId, r.eventIds[0]).event;
    assert.throws(() => ackJournalEvent(f.bound, r.operationId, e.eventId, evidence(e)),
      (error) => error.code === 'JOURNAL_NOT_COMMITTED');
    let calls = 0;
    const p = createVantaDBProjector(f.bound, { backendId: 'fixture',
      invoke: async () => { calls += 1; throw new Error('unexpected'); } });
    await assert.rejects(p.project(r.operationId, e.eventId),
      (error) => error.code === 'JOURNAL_NOT_COMMITTED');
    assert.equal(calls, 0);
    const next = applyJournaledCreation(f.bound, [change([f.a], 'next')]);
    assert.equal(next.status, 'committed');
    assert.notEqual(next.operationId, r.operationId);
  } finally { cleanup(f.dir); }
});

test('abandon does not alter absent, partial, or foreign sources', () => {
  for (const variant of ['absent', 'partial', 'foreign']) {
    const f = fixture();
    try {
      const r = prepared(f);
      const source = path.join(f.dir, 'records/item');
      if (variant !== 'absent') {
        writeFile(f.dir, 'records/item', variant === 'partial' ? 'part' : 'foreign bytes');
      }
      const expected = fs.existsSync(source) ? fs.readFileSync(source) : null;
      const result = recoverJournalOperation(f.bound, r.operationId,
        options(f, r, 'abandon-prepared'));
      assert.equal(result.state, 'abandoned');
      assert.deepEqual(fs.existsSync(source) ? fs.readFileSync(source) : null, expected);
      assert.equal(fs.existsSync(operationFile(f, r, 'commit.json')), false);
    } finally { cleanup(f.dir); }
  }
});

test('abandon preserves a foreign matching file from a create-to-noop race', () => {
  const f = fixture();
  const open = fs.openSync;
  const close = fs.closeSync;
  let outboxFd;
  try {
    fs.openSync = function (file, flags, ...args) {
      const fd = open.call(this, file, flags, ...args);
      if (String(file).includes(`${path.sep}outbox${path.sep}`) && flags === 'wx') outboxFd = fd;
      return fd;
    };
    fs.closeSync = function (fd) {
      const result = close.call(this, fd);
      if (fd === outboxFd) {
        outboxFd = undefined;
        writeFile(f.dir, 'records/item', 'content-item');
      }
      return result;
    };
    const r = applyJournaledCreation(f.bound, [change([f.a], 'item')]);
    fs.openSync = open;
    fs.closeSync = close;
    assert.equal(r.status, 'unconfirmed');
    assert.equal(r.cause.code, 'JOURNAL_SOURCE_UNCONFIRMED');
    const source = path.join(f.dir, 'records/item');
    const bytes = fs.readFileSync(source);
    assert.equal(recoverJournalOperation(f.bound, r.operationId,
      options(f, r, 'abandon-prepared')).state, 'abandoned');
    assert.deepEqual(fs.readFileSync(source), bytes);
    assert.equal(fs.existsSync(operationFile(f, r, 'commit.json')), false);
  } finally { fs.openSync = open; fs.closeSync = close; cleanup(f.dir); }
});

test('abandon resumes after head or index cleanup failure using the first receipt', () => {
  for (const variant of ['head', 'index']) {
    const f = fixture();
    const rename = fs.renameSync;
    const unlink = fs.unlinkSync;
    try {
      const r = prepared(f);
      const o = options(f, r, 'abandon-prepared');
      if (variant === 'head') {
        fs.renameSync = function (from, to, ...args) {
          if (to === head(f) && JSON.parse(fs.readFileSync(from)).activeOperation === null) {
            throw new Error('fixture head failure');
          }
          return rename.call(this, from, to, ...args);
        };
      } else {
        fs.unlinkSync = function (file, ...args) {
          if (file === index(f, r)) throw new Error('fixture index failure');
          return unlink.call(this, file, ...args);
        };
      }
      assert.throws(() => recoverJournalOperation(f.bound, r.operationId, o));
      fs.renameSync = rename;
      fs.unlinkSync = unlink;
      const receipt = operationFile(f, r, 'recovery.json');
      const bytes = fs.readFileSync(receipt);
      assert.throws(() => listJournalPending(f.bound),
        (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
      const last = JSON.parse(fs.readFileSync(head(f))).lastSequence;
      const result = recoverJournalOperation(f.bound, r.operationId, o);
      assert.equal(result.state, 'abandoned');
      assert.deepEqual(fs.readFileSync(receipt), bytes);
      assert.equal(JSON.parse(fs.readFileSync(head(f))).lastSequence, last);
      assert.equal(fs.existsSync(index(f, r)), false);
    } finally { fs.renameSync = rename; fs.unlinkSync = unlink; cleanup(f.dir); }
  }
});

test('conflicting decisions and malformed metadata fail without further writes', () => {
  for (const variant of ['digest', 'action', 'receipt-extra', 'receipt-marker', 'head',
    'head-behind', 'active-digest', 'index', 'ack-prepared', 'snapshot-missing', 'snapshot-tampered']) {
    const f = fixture();
    try {
      const r = variant === 'receipt-marker' ? prepared(f) : committedActive(f);
      const o = options(f, r, variant === 'receipt-marker' ? 'abandon-prepared' : 'finalize-committed');
      const e = getJournalEvent(f.bound, r.operationId, r.eventIds[0]).event;
      if (variant === 'digest') o.expectedIntentDigest = 'a'.repeat(64);
      if (variant === 'action') o.action = 'abandon-prepared';
      if (variant === 'receipt-extra' || variant === 'receipt-marker') {
        const receipt = { schemaVersion: 1, operationId: r.operationId,
          intentDigest: o.expectedIntentDigest,
          action: 'finalize-committed', sourceOutcome: 'committed',
          reason: o.reason, decidedAt: '2026-11-16T10:00:00.000Z' };
        if (variant === 'receipt-extra') receipt.extra = true;
        fs.writeFileSync(operationFile(f, r, 'recovery.json'), JSON.stringify(receipt));
      }
      if (variant === 'head') fs.writeFileSync(head(f), '{bad');
      if (variant === 'head-behind' || variant === 'active-digest') {
        const h = JSON.parse(fs.readFileSync(head(f)));
        if (variant === 'head-behind') h.lastSequence = 0;
        else h.activeOperation.intentDigest = 'b'.repeat(64);
        fs.writeFileSync(head(f), JSON.stringify(h));
      }
      if (variant === 'index') fs.writeFileSync(index(f, r), '{}');
      if (variant === 'ack-prepared') {
        fs.unlinkSync(operationFile(f, r, 'commit.json'));
        writeJson(f.dir, `.scopegrain/state/journal/operations/${r.operationId}/acks/${e.eventId}.json`,
          { schemaVersion: 1, operationId: r.operationId, eventId: e.eventId, evidence: evidence(e) });
      }
      const snapshot = path.join(f.dir, ...e.snapshotRef.split('/'));
      if (variant === 'snapshot-missing') fs.unlinkSync(snapshot);
      if (variant === 'snapshot-tampered') fs.writeFileSync(snapshot, 'tampered');
      const before = tree(f.dir);
      const expected = variant === 'digest' || variant === 'action' ? 'JOURNAL_RECOVERY_CONFLICT'
        : variant === 'snapshot-missing' ? 'JOURNAL_SNAPSHOT_MISSING'
          : variant === 'snapshot-tampered' ? 'JOURNAL_SNAPSHOT_MISMATCH' : 'JOURNAL_MALFORMED';
      assert.throws(() => recoverJournalOperation(f.bound, r.operationId, o),
        (error) => error.code === expected, variant);
      assert.deepEqual(tree(f.dir), before, variant);
    } finally { cleanup(f.dir); }
  }
});

test('retained decision cannot change reason or act while another operation is active', () => {
  const f = fixture();
  try {
    const old = committedActive(f);
    const o = options(f, old, 'finalize-committed');
    recoverJournalOperation(f.bound, old.operationId, o);
    const receipt = fs.readFileSync(operationFile(f, old, 'recovery.json'));
    const priorHead = fs.readFileSync(head(f));
    recoverJournalOperation(f.bound, old.operationId, o);
    assert.deepEqual(fs.readFileSync(operationFile(f, old, 'recovery.json')), receipt);
    assert.deepEqual(fs.readFileSync(head(f)), priorHead);
    assert.throws(() => recoverJournalOperation(f.bound, old.operationId, { ...o, reason: 'different' }),
      (e) => e.code === 'JOURNAL_RECOVERY_CONFLICT');
    const another = prepared(f, 'source', 'another');
    const before = tree(f.dir);
    assert.throws(() => recoverJournalOperation(f.bound, old.operationId, o),
      (e) => e.code === 'JOURNAL_RECOVERY_CONFLICT');
    assert.deepEqual(tree(f.dir), before);
    assert.deepEqual(fs.readFileSync(operationFile(f, old, 'recovery.json')), receipt);
    assert.equal(JSON.parse(fs.readFileSync(head(f))).activeOperation.operationId, another.operationId);
  } finally { cleanup(f.dir); }
});

test('all scopes, authentic binding, stale roots and stored snapshots are required', () => {
  const f = fixture();
  try {
    const r = committedActive(f, [change([f.a], 'a'), change([f.b], 'b'),
      change([f.a, f.b], 'both')]);
    const o = options(f, r, 'finalize-committed');
    const before = tree(f.dir);
    assert.throws(() => prepareJournalRecovery(f.alpha, r.operationId, o),
      (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => recoverJournalOperation(f.alpha, r.operationId, o),
      (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => recoverJournalOperation({ ...f.bound }, r.operationId, o),
      (e) => e.code === 'SCOPE_DENIED');
    assert.deepEqual(tree(f.dir), before);
    const metadata = path.join(f.dir, '.scopegrain/state/workspace.json');
    const value = JSON.parse(fs.readFileSync(metadata));
    value.revision += 1;
    fs.writeFileSync(metadata, JSON.stringify(value));
    const staleBefore = tree(f.dir);
    assert.throws(() => recoverJournalOperation(f.bound, r.operationId, o),
      (e) => e.code === 'WORKSPACE_STALE');
    assert.deepEqual(tree(f.dir), staleBefore);
  } finally { cleanup(f.dir); }
});

test('caller options are copied before filesystem activity; existing locks are never stolen', () => {
  const f = fixture();
  const lstat = fs.lstatSync;
  try {
    const r = committedActive(f);
    const o = options(f, r, 'finalize-committed', 'original');
    let mutated = false;
    fs.lstatSync = function (...args) {
      if (!mutated) { mutated = true; o.reason = 'changed'; }
      return lstat.apply(this, args);
    };
    const result = recoverJournalOperation(f.bound, r.operationId, o);
    fs.lstatSync = lstat;
    assert.equal(result.reason, 'original');
    assert.equal(result.recovery.reason, 'original');
    const lock = path.join(f.journal, '.lock');
    fs.writeFileSync(lock, 'foreign lock');
    assert.throws(() => recoverJournalOperation(f.bound, r.operationId,
      { ...o, reason: 'original' }), (e) => e.code === 'JOURNAL_LOCKED');
    assert.equal(fs.readFileSync(lock, 'utf8'), 'foreign lock');
  } finally { fs.lstatSync = lstat; cleanup(f.dir); }
});

for (const variant of ['creation', 'ack', 'recovery']) {
  test(`same-token replaced lock survives ${variant} release`, () => {
    const f = fixture();
    const rename = fs.renameSync;
    const unlink = fs.unlinkSync;
    try {
      const r = variant === 'recovery' ? committedActive(f)
        : variant === 'ack' ? applyJournaledCreation(f.bound, [change([f.a], 'item')]) : null;
      const e = r ? getJournalEvent(f.bound, r.operationId, r.eventIds[0]).event : null;
      const o = variant === 'recovery' ? options(f, r, 'finalize-committed') : null;
      const lock = path.join(f.journal, '.lock');
      const replacement = path.join(f.journal, '.foreign-lock');
      let foreign;
      let token;
      function replaceLock() {
        if (foreign) return;
        const original = fs.lstatSync(lock, { bigint: true });
        token = fs.readFileSync(lock);
        fs.writeFileSync(replacement, token, { flag: 'wx' });
        foreign = fs.lstatSync(replacement, { bigint: true });
        assert.ok(original.dev !== foreign.dev || original.ino !== foreign.ino);
        rename.call(fs, replacement, lock);
      }
      fs.renameSync = function (from, to, ...args) {
        const isFinalHead = to === head(f)
          && JSON.parse(fs.readFileSync(from)).activeOperation === null;
        const result = rename.call(this, from, to, ...args);
        if (variant !== 'ack' && isFinalHead) replaceLock();
        return result;
      };
      fs.unlinkSync = function (file, ...args) {
        const result = unlink.call(this, file, ...args);
        if (variant === 'ack' && file === index(f, r)) replaceLock();
        return result;
      };
      if (variant === 'ack') {
        assert.throws(() => ackJournalEvent(f.bound, r.operationId, e.eventId, evidence(e)),
          (error) => error.code === 'JOURNAL_LOCKED');
        assert.equal(fs.existsSync(operationFile(f, r, `acks/${e.eventId}.json`)), true);
        assert.equal(fs.existsSync(index(f, r)), false);
      } else {
        const result = variant === 'creation'
          ? applyJournaledCreation(f.bound, [change([f.a], 'item')])
          : recoverJournalOperation(f.bound, r.operationId, o);
        assert.ok(result.warnings.some((warning) => warning.code === 'JOURNAL_LOCKED'));
        assert.equal(result.status ?? result.state, 'committed');
      }
      assert.ok(foreign);
      assert.deepEqual(fs.readFileSync(lock), token);
      const remaining = fs.lstatSync(lock, { bigint: true });
      assert.equal(remaining.dev, foreign.dev);
      assert.equal(remaining.ino, foreign.ino);
    } finally { fs.renameSync = rename; fs.unlinkSync = unlink; cleanup(f.dir); }
  });
}

test('replaced project root or journal link never redirects recovery', (t) => {
  const f = fixture();
  const moved = `${f.dir}-moved`;
  try {
    const r = committedActive(f);
    const o = options(f, r, 'finalize-committed');
    fs.renameSync(f.dir, moved);
    if (!trySymlink(moved, f.dir)) { t.skip('directory junctions unavailable'); return; }
    assert.throws(() => recoverJournalOperation(f.bound, r.operationId, o),
      (e) => e.code === 'SYMLINK_REJECTED');
  } finally { cleanup(f.dir); cleanup(moved); }
});
