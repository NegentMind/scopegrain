// SPDX-License-Identifier: Apache-2.0
// Kill -9 durability: a REAL child process runs journaled creations and
// announces each committed operation on stdout before starting the next
// one. The parent kills it with SIGKILL at a random point. On reopen:
//
//   * every announced operation is durable: committed on disk, source
//     file bytes identical to its content-addressed snapshot
//   * at most ONE un-announced operation exists (the in-flight one), and
//     it is fully consistent — valid intent, complete snapshots — or a
//     reserved-but-unwritten intent recoverable via 'abandon-prepared'
//   * no ghosts: every file under kill9/records is referenced by a
//     persisted intent (sources are written only after the intent is
//     durable), and a committed op's sources match snapshots exactly
//   * a wedged head (activeOperation != null) is resolvable through the
//     structured recovery path, after which the journal is healthy
//
// Windows note: process.kill with any signal maps to TerminateProcess —
// SIGKILL is not distinguishable from SIGTERM there, but termination is
// still immediate and untrappable, which is the semantics under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import {
  countJournalPending, getJournalOperation, listJournalPending,
  prepareJournalRecovery, readJournalSnapshot, recoverJournalOperation,
} from '../src/core/journal.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, writeJson } from './helpers.mjs';
import {
  hardKill, mulberry32, sleep, spawnNode, waitForLines,
} from './eval/lib/child-procs.mjs';

const CHILD = fileURLToPath(new URL(
  './eval/lib/kill9-journal-child.mjs', import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fixture() {
  const dir = makeTempDir('kill9');
  writeJson(dir, '.scopegrain/config.json', createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir, config: '.scopegrain/config.json' });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a] = prepared.workspace.areas.map((area) => area.id);
  return {
    dir, ctx, a,
    bound: bindWorkspace(ctx, { areaIds: [a] }),
    journal: path.join(dir, '.scopegrain/state', 'journal'),
  };
}

async function verifyJournal(f, announced) {
  const { bound, dir, journal } = f;
  // 1. Every DONE op is durable: committed, source bytes == snapshot.
  //    A PENDING announce means the apply failed after the intent was
  //    durable — the op is consistent 'prepared', never 'committed'.
  const consistent = (opId, { committed }) => {
    const loaded = getJournalOperation(bound, opId);
    if (committed) {
      assert.equal(loaded.state, 'committed',
        `announced op ${opId} is not committed`);
    } else {
      assert.ok(['prepared', 'abandoned'].includes(loaded.state),
        `unconfirmed op ${opId} in unexpected state ${loaded.state}`);
    }
    for (const ev of loaded.intent.events) {
      // A persisted intent implies complete snapshots by write order.
      const snapshot = readJournalSnapshot(bound, opId, ev.eventId);
      if (committed) {
        const abs = path.join(dir, ...ev.sourceRel.split('/'));
        assert.ok(fs.existsSync(abs),
          `committed source missing: ${ev.sourceRel}`);
        assert.ok(fs.readFileSync(abs).equals(snapshot),
          `committed source diverged from snapshot: ${ev.sourceRel}`);
      }
    }
    return loaded;
  };
  const ghostOk = new Set();
  for (const [operationId, info] of announced) {
    const loaded = consistent(operationId, { committed: info.done });
    for (const ev of loaded.intent.events) ghostOk.add(ev.sourceRel);
    if (info.done) {
      assert.ok(fs.existsSync(path.join(dir, ...info.rel.split('/'))),
        `announced source missing: ${info.rel}`);
    }
  }
  // 2. Persisted ops beyond the announced set: at most one (sequential
  // writer), and it must be FULLY consistent — never partial garbage.
  const opsDir = path.join(journal, 'operations');
  const persisted = fs.existsSync(opsDir)
    ? fs.readdirSync(opsDir).filter((n) => UUID.test(n)) : [];
  const extra = persisted.filter((id) => !announced.has(id));
  assert.ok(extra.length <= 1,
    `more than one un-announced operation persisted: ${extra.join(',')}`);
  for (const opId of extra) {
    const loaded = getJournalOperation(bound, opId); // must validate
    assert.ok(['prepared', 'committed'].includes(loaded.state),
      `un-announced op ${opId} in unexpected state ${loaded.state}`);
    for (const ev of loaded.intent.events) {
      readJournalSnapshot(bound, opId, ev.eventId);
      ghostOk.add(ev.sourceRel);
    }
    if (loaded.state === 'committed') {
      for (const ev of loaded.intent.events) {
        const abs = path.join(dir, ...ev.sourceRel.split('/'));
        assert.ok(fs.existsSync(abs) && fs.readFileSync(abs).equals(
          readJournalSnapshot(bound, opId, ev.eventId)),
        `un-announced committed source diverged: ${ev.sourceRel}`);
      }
    }
  }
  // 3. No ghosts: every materialized record file is referenced by a
  // persisted intent (committed or prepared/abandoned — a killed
  // applyPlan may leave preserved sources for an unconfirmed op, and
  // they may be truncated, but they are always accounted for).
  const recordsDir = path.join(dir, 'kill9', 'records');
  const materialized = fs.existsSync(recordsDir)
    ? fs.readdirSync(recordsDir).filter((n) => n.endsWith('.json')) : [];
  for (const name of materialized) {
    assert.ok(ghostOk.has(`kill9/records/${name}`),
      `ghost file with no persisted intent: ${name}`);
  }
  // 4. Head: parseable, sequence covers every announced op plus at most
  // one reservation for the in-flight op (one event per child op).
  const head = JSON.parse(
    fs.readFileSync(path.join(journal, 'head.json'), 'utf8'));
  assert.ok(head.lastSequence >= announced.size,
    `head.lastSequence ${head.lastSequence} < announced ${announced.size}`);
  assert.ok(head.lastSequence <= announced.size + 1,
    `head.lastSequence ${head.lastSequence} skipped ahead of writes`);
  // 5. A wedged reservation resolves through structured recovery.
  if (head.activeOperation !== null) {
    const opId = head.activeOperation.operationId;
    let action = 'abandon-prepared';
    let digest = head.activeOperation.intentDigest;
    try {
      const loaded = getJournalOperation(bound, opId);
      digest = loaded.intentDigest;
      action = loaded.state === 'committed'
        ? 'finalize-committed' : 'abandon-prepared';
    } catch (e) {
      // Intent never persisted: the reserved digest in head is the proof.
      assert.equal(e.code, 'JOURNAL_NOT_FOUND',
        `unexpected op-read failure for wedged op: ${e.code}`);
    }
    const opts = { action, expectedIntentDigest: digest,
      reason: 'kill9 durability test' };
    const dry = prepareJournalRecovery(bound, opId, opts);
    assert.equal(dry.mode, 'dry-run');
    const applied = recoverJournalOperation(bound, opId, opts);
    assert.equal(applied.mode, 'applied');
    const headAfter = JSON.parse(
      fs.readFileSync(path.join(journal, 'head.json'), 'utf8'));
    assert.equal(headAfter.activeOperation, null);
  }
  // 6. Post-condition: the journal answers its normal reads.
  listJournalPending(bound);
  assert.equal(typeof countJournalPending(bound), 'number');
}

test('SIGKILL mid-run: announced ops durable, un-announced never corrupt', async (t) => {
  const f = fixture();
  const OPS = 24;
  try {
    const child = spawnNode(CHILD, [
      '--project', f.dir, '--config', '.scopegrain/config.json',
      '--ops', String(OPS),
    ], { timeoutMs: 120_000 });
    try {
      // Deterministic kill point: after K announced ops (0 < K < OPS),
      // plus a small seeded delay so the kill lands inside op K+1.
      const rand = mulberry32(0x9e3779b9);
      const killAfter = 1 + Math.floor(rand() * (OPS - 2));
      const ready = await waitForLines(
        child, (lines) => lines.length >= killAfter + 1
          || lines.includes('ALLDONE'));
      assert.ok(ready, 'child never announced its first operations');
      await sleep(Math.floor(rand() * 60));
      if (child.exitCode === null) hardKill(child);
      const exit = await child.exited;
      assert.notEqual(exit.timedOut, true, 'child timed out');
      // Parse announcements (lines: READY/DONE opId rel/...).
      const announced = new Map();
      for (const line of child.lines) {
        const m = /^(DONE|PENDING) ([0-9a-f-]{36}) (\S+)$/.exec(line);
        if (m) announced.set(m[2], { rel: m[3], done: m[1] === 'DONE' });
      }
      await verifyJournal(f, announced);
    } finally {
      if (child.exitCode === null) hardKill(child);
    }
  } finally {
    cleanup(f.dir);
  }
});

test('SIGKILL before first op: empty journal stays clean or reserved', async () => {
  const f = fixture();
  try {
    const child = spawnNode(CHILD, [
      '--project', f.dir, '--config', '.scopegrain/config.json',
      '--ops', '30',
    ], { timeoutMs: 120_000 });
    try {
      // Kill as soon as READY arrives — the first op is in flight.
      const ready = await waitForLines(child,
        (lines) => lines.includes('READY'));
      assert.ok(ready, 'child never bound the workspace');
      hardKill(child);
      await child.exited;
      // Zero or one op may have been announced before the kill landed.
      const announced = new Map();
      for (const line of child.lines) {
        const m = /^(DONE|PENDING) ([0-9a-f-]{36}) (\S+)$/.exec(line);
        if (m) announced.set(m[2], { rel: m[3], done: m[1] === 'DONE' });
      }
      const journalDir = f.journal;
      if (!fs.existsSync(journalDir)
          || !fs.existsSync(path.join(journalDir, 'head.json'))) {
        // Killed before the first head reservation: no journal at all.
        assert.equal(announced.size, 0);
        assert.equal(fs.existsSync(path.join(f.dir, 'kill9')), false,
          'records materialized with no journal history');
        return;
      }
      await verifyJournal(f, announced);
    } finally {
      if (child.exitCode === null) hardKill(child);
    }
  } finally {
    cleanup(f.dir);
  }
});
