// SPDX-License-Identifier: Apache-2.0
// Verified token locks: the F-01 invariant — a stale release must never
// unlink a lock a new owner recreated at the same path. Covers the helper
// directly plus one end-to-end caller path (task transition) proving the
// successor's file survives mid-flight replacement.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  acquireVerifiedLock, releaseVerifiedLock,
} from '../src/core/locks.mjs';
import { transitionTask } from '../src/core/transition.mjs';
import { getTask, taskFilePath } from '../src/core/tasks.mjs';
import { lightFixture } from './methodology-fixtures.mjs';
import { cleanup, makeTempDir } from './helpers.mjs';

const acquire = (p) => acquireVerifiedLock(p, 'TEST_LOCKED', 'held');

test('acquire+release roundtrip; legacy zero-byte lock still conflicts', () => {
  const dir = makeTempDir('locks');
  try {
    const p = path.join(dir, 'a.json.lock');
    const lock = acquire(p);
    const payload = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.deepEqual([payload.t, payload.pid], [lock.token, process.pid]);
    assert.equal(typeof payload.at, 'number');
    releaseVerifiedLock(lock);
    assert.equal(fs.existsSync(p), false);
    // A pre-existing zero-byte sentinel stays a conflict, never recovered.
    fs.writeFileSync(p, '', { flag: 'wx' });
    assert.throws(() => acquire(p), (e) => e.code === 'TEST_LOCKED');
    assert.equal(fs.readFileSync(p, 'utf8'), '');
  } finally { cleanup(dir); }
});

test('a dead-pid lock is reclaimed; a live-pid lock never breaks', () => {
  const dir = makeTempDir('locks');
  try {
    const p = path.join(dir, 'a.json.lock');
    // Dead pid: a crashed writer cannot finish, so the lock is broken.
    fs.writeFileSync(p, JSON.stringify({ t: 'x', pid: 0x7fffffff - 1,
      at: Date.now() }));
    const lock = acquire(p);
    assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).t, lock.token);
    releaseVerifiedLock(lock);
    // Live pid (ours): never reclaimed, no matter how it ages.
    fs.writeFileSync(p, JSON.stringify({ t: 'held', pid: process.pid,
      at: 1 }));
    fs.utimesSync(p, new Date(0), new Date(0)); // ancient mtime
    assert.throws(() => acquire(p), (e) => e.code === 'TEST_LOCKED');
    assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).t, 'held');
    fs.rmSync(p);
  } finally { cleanup(dir); }
});

test('legacy locks reclaim only past TTL and re-verify dev/ino', () => {
  const dir = makeTempDir('locks');
  try {
    const p = path.join(dir, 'a.json.lock');
    const opts = { staleMs: 50 };
    const acquireStale = () =>
      acquireVerifiedLock(p, 'TEST_LOCKED', 'held', opts);
    // Fresh legacy token: inside TTL, still a conflict.
    fs.writeFileSync(p, 'bare-token', { flag: 'wx' });
    assert.throws(acquireStale, (e) => e.code === 'TEST_LOCKED');
    // Aged past TTL: reclaimed and replaced by our lock.
    fs.utimesSync(p, new Date(Date.now() - 60_000),
      new Date(Date.now() - 60_000));
    const lock = acquireStale();
    assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).t, lock.token);
    releaseVerifiedLock(lock);
  } finally { cleanup(dir); }
});

test('release after delete+recreate never unlinks the new owner', () => {
  const dir = makeTempDir('locks');
  try {
    const p = path.join(dir, 'a.json.lock');
    const stale = acquire(p);
    // The first holder died without releasing; a successor acquired the
    // same path. The stale handle's release must refuse, not delete.
    fs.rmSync(p);
    const successor = acquire(p);
    assert.throws(() => releaseVerifiedLock(stale),
      (e) => e.code === 'TEST_LOCKED');
    assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).t, successor.token);
    // The live owner still releases cleanly.
    releaseVerifiedLock(successor);
    assert.equal(fs.existsSync(p), false);
  } finally { cleanup(dir); }
});

test('release detects rewritten token bytes on the same inode', () => {
  const dir = makeTempDir('locks');
  try {
    const p = path.join(dir, 'a.json.lock');
    const lock = acquire(p);
    fs.writeFileSync(p, 'tampered'); // same file, foreign content
    assert.throws(() => releaseVerifiedLock(lock),
      (e) => e.code === 'TEST_LOCKED');
    assert.equal(fs.readFileSync(p, 'utf8'), 'tampered');
    fs.rmSync(p);
  } finally { cleanup(dir); }
});

test('release detects a removed lock', () => {
  const dir = makeTempDir('locks');
  try {
    const p = path.join(dir, 'a.json.lock');
    const lock = acquire(p);
    fs.rmSync(p);
    assert.throws(() => releaseVerifiedLock(lock),
      (e) => e.code === 'TEST_LOCKED');
  } finally { cleanup(dir); }
});

test('transition surfaces a mid-flight lock replacement and preserves it', (t) => {
  const f = lightFixture();
  try {
    const lockPath = taskFilePath(f.ctx, f.task.id) + '.lock';
    const real = fs.renameSync;
    t.mock.method(fs, 'renameSync', (from, to) => {
      real(from, to); // commit the write, then replace the lock file
      fs.rmSync(lockPath);
      fs.writeFileSync(lockPath, 'successor', { flag: 'wx' });
    });
    assert.throws(() => transitionTask(f.ctx, { id: f.task.id, to: 'ACT',
      expectedRevision: 0 }), (e) => e.code === 'TASK_LOCKED');
    assert.equal(fs.readFileSync(lockPath, 'utf8'), 'successor');
    // The committed write is not rolled back; only the unlink was refused.
    assert.equal(getTask(f.ctx, f.task.id).state, 'ACT');
  } finally { t.mock.restoreAll(); cleanup(f.dir); }
});

test('a primary failure wins over a release error; successor still kept', (t) => {
  const f = lightFixture();
  try {
    const lockPath = taskFilePath(f.ctx, f.task.id) + '.lock';
    const tmpLeft = () => fs.readdirSync(path.dirname(lockPath))
      .filter((n) => n.includes('.tmp-'));
    t.mock.method(fs, 'renameSync', () => {
      fs.rmSync(lockPath);
      fs.writeFileSync(lockPath, 'successor', { flag: 'wx' });
      throw Object.assign(new Error('injected rename'), { code: 'EIO' });
    });
    assert.throws(() => transitionTask(f.ctx, { id: f.task.id, to: 'ACT',
      expectedRevision: 0 }), (e) => e.code === 'EIO');
    assert.equal(fs.readFileSync(lockPath, 'utf8'), 'successor');
    assert.deepEqual(tmpLeft(), []);
  } finally { t.mock.restoreAll(); cleanup(f.dir); }
});
