// SPDX-License-Identifier: Apache-2.0
// Audit 2026-11-24 regressions: archived-op recovery path, head-existence
// coverage, verified-vs-head sequence check, reconcile re-hash, journal
// orphan temp sweep and the obsolete stale-lock message.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan, preflightPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { canonicalDigest } from '../src/core/digests.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import {
  ackJournalEvent, applyJournaledCreation, compactJournal,
  countJournalPending, getJournalEvent, getJournalOperation,
  listJournalAcked, listJournalPending, recoverJournalOperation,
} from '../src/core/journal.mjs';
import { applyUpdate, prepareAdopt, prepareUpdate }
  from '../src/core/lifecycle.mjs';
import { runDoctor } from '../src/core/doctor.mjs';
import { createTask } from '../src/core/tasks.mjs';
import {
  prepareSession, recordSession, sessionFileAbs,
} from '../src/core/sessions.mjs';
import {
  VALID_ANSWERS, bootstrappedCtx, cleanup, makeTempDir, writeFile, writeJson,
} from './helpers.mjs';
import {
  bootstrappedMiniCtx, configuredCtx, destroyLifecycleInstall,
} from './helpers/lifecycle-fixture.mjs';

after(() => destroyLifecycleInstall());

function fixture() {
  const dir = makeTempDir('journal-audit');
  writeJson(dir, '.scopegrain/config.json', createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  return { dir, ctx, a, b, bound: bindWorkspace(ctx, { areaIds: [a, b] }),
    journal: path.join(dir, '.scopegrain/state/journal') };
}

function change(areaIds, rel, content = 'content', recordId = 'record-1') {
  return { sourceKind: 'task', recordId, sourceRevision: 0, areaIds,
    file: { rel, content } };
}

function evidence(event) {
  return { backendId: 'fixture-backend', remoteNamespace: 'fixture-namespace',
    remoteKey: event.eventId, eventDigest: canonicalDigest(event),
    sourceHash: event.sourceHash, confirmedAt: '2026-11-24T12:00:00.000Z' };
}

function archivedOp(f, rel = 'records/arch') {
  const r = applyJournaledCreation(f.bound, [change([f.a], rel, 'x', 'arch')]);
  const event = getJournalEvent(f.bound, r.operationId, r.eventIds[0]).event;
  ackJournalEvent(f.bound, r.operationId, event.eventId, evidence(event));
  assert.deepEqual(compactJournal(f.bound).archived, [r.operationId]);
  return r;
}

test('recover on an archived op writes its receipt into archive, never a live shadow dir', () => {
  const f = fixture();
  try {
    const r = archivedOp(f);
    const liveDir = path.join(f.journal, 'operations', r.operationId);
    const archDir = path.join(f.journal, 'archive', 'operations', r.operationId);
    assert.equal(fs.existsSync(liveDir), false);
    assert.equal(fs.existsSync(archDir), true);
    const digest = getJournalOperation(f.bound, r.operationId).intentDigest;
    const result = recoverJournalOperation(f.bound, r.operationId, {
      action: 'finalize-committed', expectedIntentDigest: digest,
      reason: 'audit decision' });
    assert.equal(result.mode, 'applied');
    assert.equal(fs.existsSync(path.join(archDir, 'recovery.json')), true);
    // The historical bug left a shadow operations/<id> that wedged every
    // subsequent read of this op; the receipt must live next to the intent.
    assert.equal(fs.existsSync(liveDir), false);
    const loaded = getJournalOperation(f.bound, r.operationId);
    assert.equal(loaded.state, 'committed');
    assert.equal(loaded.recovery.action, 'finalize-committed');
    assert.deepEqual(listJournalPending(f.bound),
      { items: [], nextAfterSequence: null });
    assert.equal(listJournalAcked(f.bound).items.length, 1);
    assert.deepEqual(compactJournal(f.bound).archived, []);
    // Recovery stays idempotent on the archived op: same decision, same
    // receipt, no further writes.
    const receipt = fs.readFileSync(path.join(archDir, 'recovery.json'));
    const again = recoverJournalOperation(f.bound, r.operationId, {
      action: 'finalize-committed', expectedIntentDigest: digest,
      reason: 'audit decision' });
    assert.deepEqual(fs.readFileSync(path.join(archDir, 'recovery.json')), receipt);
    assert.equal(again.recovery.action, 'finalize-committed');
    assert.equal(fs.existsSync(liveDir), false);
  } finally { cleanup(f.dir); }
});

test('missing head with archive-only history fails closed on every journal read', () => {
  const f = fixture();
  try {
    const r = archivedOp(f);
    fs.rmSync(path.join(f.journal, 'head.json'));
    for (const call of [
      () => countJournalPending(f.bound),
      () => listJournalPending(f.bound),
      () => getJournalOperation(f.bound, r.operationId),
      () => listJournalAcked(f.bound),
      () => compactJournal(f.bound),
    ]) {
      assert.throws(call,
        (e) => e.code === 'JOURNAL_MALFORMED'
          && e.message.includes('head is missing while history exists'));
    }
  } finally { cleanup(f.dir); }
});

test('snapshot-only remnants without a head do not wedge the journal', () => {
  const f = fixture();
  try {
    applyJournaledCreation(f.bound, [change([f.a], 'records/x')]);
    for (const rel of ['operations', 'outbox', 'archive', 'head.json']) {
      fs.rmSync(path.join(f.journal, rel), { recursive: true, force: true });
    }
    // Orphaned blobs are content-addressed, sequence-free garbage: with no
    // operation records left, nothing can collide on journalSequence, so a
    // lone snapshots/ dir must never block a clean restart (the same
    // posture that tolerates a foreign blob until it is referenced).
    assert.equal(countJournalPending(f.bound), 0);
    const next = applyJournaledCreation(f.bound, [change([f.a], 'records/next')]);
    assert.equal(next.status, 'committed');
    assert.equal(getJournalEvent(f.bound, next.operationId,
      next.eventIds[0]).event.journalSequence, 1);
  } finally { cleanup(f.dir); }
});

test('an operation whose events run ahead of the head is reported, not silently verified', () => {
  const f = fixture();
  try {
    const r = applyJournaledCreation(f.bound, [change([f.a], 'records/x')]);
    const headPath = path.join(f.journal, 'head.json');
    const head = JSON.parse(fs.readFileSync(headPath));
    head.lastSequence = 0; // rewound head: verified chain must not accept it
    fs.writeFileSync(headPath, JSON.stringify(head));
    assert.throws(() => getJournalOperation(f.bound, r.operationId),
      (e) => e.code === 'JOURNAL_MALFORMED'
        && e.message.includes('head precedes operation'));
    assert.throws(() => listJournalAcked(f.bound),
      (e) => e.code === 'JOURNAL_MALFORMED');
    assert.throws(() => listJournalPending(f.bound),
      (e) => e.code === 'JOURNAL_MALFORMED');
  } finally { cleanup(f.dir); }
});

test('adopt flags archived journal history without head; blob remnants stay idle', () => {
  for (const variant of ['archive', 'snapshots']) {
    const { dir } = configuredCtx();
    try {
      const rel = variant === 'archive'
        ? `.scopegrain/state/journal/archive/operations/${crypto.randomUUID()}/intent.json`
        : `.scopegrain/state/journal/snapshots/${'a'.repeat(64)}.blob`;
      writeJson(dir, rel, {});
      const report = prepareAdopt(dir);
      assert.equal(report.journalState,
        variant === 'archive' ? 'attention' : 'idle', variant);
      if (variant === 'archive') {
        assert.ok(report.issues.some((i) => i.code === 'JOURNAL_MALFORMED'));
      }
    } finally { cleanup(dir); }
  }
});

test('update --reconcile re-hashes the diverged file before unlinking it', () => {
  const a = bootstrappedMiniCtx();
  const b = bootstrappedMiniCtx();
  try {
    writeFile(a.dir, '.scopegrain/instructions.md', 'user edited');
    const ok = applyUpdate(a.ctx, { installRoot: a.installRoot, reconcile: true });
    assert.ok(ok.reconciled.some(
      (r) => r.path === '.scopegrain/instructions.md'));

    const target = writeFile(b.dir, '.scopegrain/instructions.md', 'user edited');
    const open = fs.openSync;
    let reads = 0;
    // Every read of the target after the first (the classify compare read
    // that captured the diverged hash) sees swapped foreign bytes, so the
    // apply-time re-hash must refuse the delete.
    fs.openSync = function (file, flags, ...args) {
      if (file === target && flags === 'r' && (reads += 1) > 1) {
        fs.writeFileSync(target, 'swapped foreign bytes');
      }
      return open.call(this, file, flags, ...args);
    };
    let res;
    try {
      res = applyUpdate(b.ctx, { installRoot: b.installRoot, reconcile: true });
    } finally { fs.openSync = open; }
    assert.ok(!res.reconciled.some(
      (r) => r.path === '.scopegrain/instructions.md'));
    assert.ok(res.conflicts.some((c) => c.path === '.scopegrain/instructions.md'
      && c.reason.includes('changed during apply')));
    assert.equal(fs.readFileSync(target, 'utf8'), 'swapped foreign bytes');
  } finally { cleanup(a.dir); cleanup(b.dir); }
});

test('update --reconcile never deletes diverged bytes it cannot verify', () => {
  const a = bootstrappedMiniCtx();
  try {
    const big = Buffer.alloc(loadLimits().maxDocumentBytes + 1, 0x78);
    writeFile(a.dir, '.scopegrain/instructions.md', big);
    const preview = prepareUpdate(a.ctx,
      { installRoot: a.installRoot, reconcile: true });
    const entry = preview.conflicts.find(
      (c) => c.path === '.scopegrain/instructions.md');
    assert.ok(entry && entry.reconcile === false);
    const res = applyUpdate(a.ctx,
      { installRoot: a.installRoot, reconcile: true });
    assert.ok(!res.reconciled.some(
      (r) => r.path === '.scopegrain/instructions.md'));
    assert.ok(res.conflicts.some(
      (c) => c.path === '.scopegrain/instructions.md'));
    assert.ok(fs.readFileSync(
      path.join(a.dir, '.scopegrain/instructions.md')).equals(big));
  } finally { cleanup(a.dir); }
});

test('doctor flags history without head and orphan journal temp files', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const journalRel = '.scopegrain/state/journal';
    writeFile(dir,
      `${journalRel}/archive/operations/${crypto.randomUUID()}/intent.json`, '{}');
    let report = runDoctor(ctx);
    const head = report.checks.find((c) => c.name === 'journal');
    assert.ok(head && !head.ok
      && head.detail.includes('head is missing while history exists'));
    const tmp = report.checks.find((c) => c.name === 'journal-tmp');
    assert.ok(tmp && tmp.ok);
    writeFile(dir, `${journalRel}/.head-${crypto.randomUUID()}.tmp`, '{}');
    report = runDoctor(ctx);
    const orphan = report.checks.find((c) => c.name === 'journal-tmp');
    assert.ok(orphan && !orphan.ok && orphan.severity === 'warning');
    assert.ok(orphan.detail.includes('.head-'));
  } finally { cleanup(dir); }
});

test('session lock message no longer claims stale locks are unrecoverable', () => {
  const dir = makeTempDir('audit-session');
  try {
    writeJson(dir, '.scopegrain/config.json',
      createConfig(dir, VALID_ANSWERS, {}));
    const ctx = resolveContext({ project: dir });
    const task = createTask(ctx,
      { title: 'T', contract: 'C', authorContext: 'a', scope: [] });
    const prepared = prepareSession(ctx, { taskId: task.id, limit: 3 });
    applyPlan(ctx.projectRoot,
      preflightPlan(ctx.projectRoot, [prepared.file]));
    fs.writeFileSync(`${sessionFileAbs(ctx, prepared.session.id)}.lock`,
      'foreign-sentinel', { flag: 'wx' });
    assert.throws(() => recordSession(ctx, { id: prepared.session.id,
      expectedRevision: 0, action: 'read', evidence: 'e' }),
    (e) => e.code === 'SESSION_LOCKED'
      && e.message === 'session is locked by another operation');
  } finally { cleanup(dir); }
});
