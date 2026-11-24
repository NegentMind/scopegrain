// SPDX-License-Identifier: Apache-2.0
// Multi-process lock contention: N real child processes compete for
// acquireVerifiedLock on the SAME path. While holding, each writes its
// pid to a shared marker file, holds, and re-reads — any other pid
// means two holders were simultaneously inside the critical section.
//
// Invariants:
//   * zero VIOLATION lines across all workers (mutual exclusion holds)
//   * losers always receive the structured lock code, never a crash
//   * every successful acquire released cleanly (no lock/marker left)
//   * a stale lock (dead pid / aged legacy token) is reclaimed by a
//     later acquirer; a LIVE pid lock is never broken
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, makeTempDir } from './helpers.mjs';
import { spawnNode } from './eval/lib/child-procs.mjs';

const CHILD = fileURLToPath(new URL(
  './eval/lib/lock-contender-child.mjs', import.meta.url));

test('N processes contending one lock: exclusion + structured refusals', async (t) => {
  const dir = makeTempDir('multiproc');
  try {
    const lock = path.join(dir, 'shared.json.lock');
    const marker = path.join(dir, 'holder.txt');
    const WORKERS = 3;
    const ROUNDS = 8;
    const children = [];
    for (let k = 0; k < WORKERS; k += 1) {
      const logPath = path.join(dir, `worker-${k}.log`);
      children.push({ logPath, child: spawnNode(CHILD, [
        '--lock', lock, '--marker', marker, '--log', logPath,
        '--rounds', String(ROUNDS), '--hold', '15',
        '--stale', '600000', '--orphan-stale', '600000',
      ], { timeoutMs: 120_000 }) });
    }
    const exits = await Promise.all(
      children.map(({ child }) => child.exited));
    for (const [i, exit] of exits.entries()) {
      assert.equal(exit.timedOut, false, `worker ${i} timed out`);
      assert.equal(exit.code, 0,
        `worker ${i} exited ${exit.code}: ${children[i].child.stderrText.slice(0, 400)}`);
    }
    let acquired = 0;
    for (const [i, { logPath }] of children.entries()) {
      const text = fs.readFileSync(logPath, 'utf8');
      assert.ok(!text.includes('VIOLATION'),
        `worker ${i} saw a second holder: ${text}`);
      assert.ok(!text.includes('STARVED'),
        `worker ${i} starved on the lock: ${text}`);
      assert.ok(!text.includes('SECTION_ERROR')
        && !text.includes('RELEASE_ERROR'), `worker ${i}: ${text}`);
      for (const line of text.trim().split('\n')) {
        if (line.startsWith('LOCKED ')) {
          // Losers get the structured code, never a raw fs error.
          assert.equal(line, 'LOCKED TEST_LOCKED');
        }
        if (line.startsWith('OK ')) acquired += 1;
      }
      const summary = /SUMMARY acquired=(\d+) locked=(\d+) violations=(\d+)/
        .exec(text);
      assert.ok(summary, `worker ${i} printed no summary: ${text}`);
      assert.equal(Number(summary[1]), ROUNDS,
        `worker ${i} acquired ${summary[1]} times, expected ${ROUNDS}`);
      assert.equal(summary[3], '0');
    }
    assert.equal(acquired, WORKERS * ROUNDS);
    // The section is empty at the end: no holder marker, no lock file.
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(lock), false);
  } finally {
    cleanup(dir);
  }
});

test('a dead-pid lock is reclaimed by another process', async () => {
  const dir = makeTempDir('multiproc-stale');
  try {
    const lock = path.join(dir, 'stale.json.lock');
    const marker = path.join(dir, 'holder.txt');
    const logPath = path.join(dir, 'worker.log');
    // Simulate a crashed holder: payload names a provably dead pid.
    fs.writeFileSync(lock, `${JSON.stringify({
      t: 'deadbeef', pid: 0x7fffffff - 1, at: Date.now() })}\n`);
    const child = spawnNode(CHILD, [
      '--lock', lock, '--marker', marker, '--log', logPath,
      '--rounds', '1', '--hold', '5',
    ], { timeoutMs: 60_000 });
    const exit = await child.exited;
    assert.equal(exit.code, 0, child.stderrText.slice(0, 400));
    const text = fs.readFileSync(logPath, 'utf8');
    assert.ok(text.includes('OK 0'), `dead-pid lock was not reclaimed: ${text}`);
    assert.ok(!text.includes('VIOLATION'));
  } finally {
    cleanup(dir);
  }
});

test('an aged legacy lock is reclaimed past its TTL', async () => {
  const dir = makeTempDir('multiproc-legacy');
  try {
    const lock = path.join(dir, 'legacy.json.lock');
    const marker = path.join(dir, 'holder.txt');
    const logPath = path.join(dir, 'worker.log');
    // Legacy bare-token lock, aged well past the child's stale window.
    fs.writeFileSync(lock, 'bare-token', { flag: 'wx' });
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(lock, old, old);
    const child = spawnNode(CHILD, [
      '--lock', lock, '--marker', marker, '--log', logPath,
      '--rounds', '1', '--hold', '5', '--stale', '1000',
      '--orphan-stale', '500',
    ], { timeoutMs: 60_000 });
    const exit = await child.exited;
    assert.equal(exit.code, 0, child.stderrText.slice(0, 400));
    const text = fs.readFileSync(logPath, 'utf8');
    assert.ok(text.includes('OK 0'), `aged lock was not reclaimed: ${text}`);
  } finally {
    cleanup(dir);
  }
});

test('a LIVE pid lock is never broken, no matter its age', async () => {
  const dir = makeTempDir('multiproc-live');
  try {
    const lock = path.join(dir, 'live.json.lock');
    const marker = path.join(dir, 'holder.txt');
    const logPath = path.join(dir, 'worker.log');
    // A lock naming OUR pid is alive: even an ancient mtime must not
    // break it — the contender must fail with the structured code.
    fs.writeFileSync(lock, `${JSON.stringify({
      t: 'held', pid: process.pid, at: 1 })}\n`);
    const ancient = new Date(0);
    fs.utimesSync(lock, ancient, ancient);
    const child = spawnNode(CHILD, [
      '--lock', lock, '--marker', marker, '--log', logPath,
      '--rounds', '3', '--tries', '10', '--hold', '5', '--stale', '1000',
      '--orphan-stale', '500',
    ], { timeoutMs: 60_000 });
    const exit = await child.exited;
    assert.equal(exit.code, 0, child.stderrText.slice(0, 400));
    const text = fs.readFileSync(logPath, 'utf8');
    assert.ok(!text.includes('OK '), `live lock was broken: ${text}`);
    assert.ok(!text.includes('VIOLATION'));
    assert.ok(text.includes('LOCKED TEST_LOCKED'), text);
    // Our lock content and file survive untouched.
    assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).t, 'held');
  } finally {
    cleanup(dir);
  }
});
