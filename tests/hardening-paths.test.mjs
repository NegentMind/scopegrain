// SPDX-License-Identifier: Apache-2.0
// Post-mkdir TOCTOU re-verification, orphan-lock short TTL and
// path-sanitized error messages.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { acquireVerifiedLock, releaseVerifiedLock }
  from '../src/core/locks.mjs';
import {
  assertRealDirChain, mkdirpVerified, resolveProjectRoot,
} from '../src/core/paths.mjs';
import {
  displayPath, mkdirpSync, readJsonFile, setPathDisplayRoot,
} from '../src/core/fsx.mjs';
import { cleanup, makeTempDir, trySymlink, writeFile } from './helpers.mjs';

const acquire = (p, opts) =>
  acquireVerifiedLock(p, 'TEST_LOCKED', 'held', opts);

const age = (p, ms) => {
  const t = new Date(Date.now() - ms);
  fs.utimesSync(p, t, t);
};

test('zero-byte and unreadable locks reclaim after the short TTL', () => {
  const dir = makeTempDir('orphan-lock');
  try {
    const p = path.join(dir, 'a.json.lock');
    // Fresh zero-byte sentinel: inside the short TTL, still a conflict.
    fs.writeFileSync(p, '', { flag: 'wx' });
    assert.throws(() => acquire(p), (e) => e.code === 'TEST_LOCKED');
    // Aged past the orphan TTL (default ~60s): reclaimed.
    age(p, 61_000);
    const lock = acquire(p);
    assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).t, lock.token);
    releaseVerifiedLock(lock);
    // Unreadable/oversized payloads get the same short TTL.
    fs.writeFileSync(p, Buffer.alloc(5000, 0x41), { flag: 'wx' });
    age(p, 61_000);
    const lock2 = acquire(p);
    assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).t, lock2.token);
    releaseVerifiedLock(lock2);
    // A readable metadata-less payload keeps the long TTL.
    fs.writeFileSync(p, 'bare-token', { flag: 'wx' });
    age(p, 61_000);
    assert.throws(() => acquire(p), (e) => e.code === 'TEST_LOCKED');
    fs.rmSync(p);
    // orphanStaleMs overrides the default for callers/tests.
    fs.writeFileSync(p, '', { flag: 'wx' });
    age(p, 50);
    const lock3 = acquireVerifiedLock(p, 'TEST_LOCKED', 'held',
      { orphanStaleMs: 0 });
    releaseVerifiedLock(lock3);
  } finally { cleanup(dir); }
});

test('mkdirpVerified creates chains and re-verifies them post-mkdir', (t) => {
  const dir = makeTempDir('mkdir-verified');
  try {
    const root = resolveProjectRoot(dir);
    const deep = path.join(root, 'a', 'b', 'c');
    mkdirpVerified(root, deep);
    assert.equal(fs.lstatSync(deep).isDirectory(), true);
    assertRealDirChain(root, deep);
    // A symlink ancestor swapped in between check and mkdir is caught.
    fs.mkdirSync(path.join(dir, 'outside'), { recursive: true });
    const linked = path.join(dir, 'linked');
    if (!trySymlink(path.join(dir, 'outside'), linked)) {
      t.skip('symlink creation unavailable');
      return;
    }
    assert.throws(() => mkdirpVerified(root, path.join(linked, 'x')),
      (e) => e.code === 'SYMLINK_REJECTED');
    assert.throws(() => assertRealDirChain(root, path.join(linked, 'x')),
      (e) => e.code === 'SYMLINK_REJECTED');
  } finally { cleanup(dir); }
});

test('assertRealDirChain rejects non-dir leaf, missing leaf, escapes', () => {
  const dir = makeTempDir('real-chain');
  try {
    const root = resolveProjectRoot(dir);
    const file = writeFile(dir, 'leaf.txt', 'x');
    assert.throws(() => assertRealDirChain(root, file),
      (e) => e.code === 'FILE_ANCESTOR');
    assert.throws(
      () => assertRealDirChain(root, path.join(root, 'missing')),
      (e) => e.code === 'FILE_ANCESTOR');
    assert.throws(
      () => assertRealDirChain(root, path.join(dir, '..', 'escape')),
      (e) => e.code === 'OUTSIDE_ROOT');
    // A file swapped in as a mid-chain ancestor is caught too.
    writeFile(dir, 'mid', 'x');
    assert.throws(
      () => assertRealDirChain(root, path.join(root, 'mid', 'x')),
      (e) => e.code === 'FILE_ANCESTOR');
  } finally { cleanup(dir); }
});

test('mkdirpSync post-check refuses a non-directory target', (t) => {
  const dir = makeTempDir('mkdirp-leaf');
  try {
    const file = writeFile(dir, 'occupied', 'x');
    t.mock.method(fs, 'mkdirSync', () => {}); // simulate post-mkdir swap
    assert.throws(() => mkdirpSync(file),
      (e) => e.code === 'FILE_ANCESTOR');
  } finally { t.mock.restoreAll(); cleanup(dir); }
});

test('displayPath relativizes to the display root, keeps basename', () => {
  const dir = makeTempDir('display');
  try {
    const inside = path.join(dir, 'sub', 'f.json');
    const outside = path.join(dir, '..', `outside-${Date.now()}.json`);
    assert.equal(displayPath(inside), 'f.json'); // no root bound yet
    setPathDisplayRoot(dir);
    assert.equal(displayPath(inside), 'sub/f.json');
    assert.equal(displayPath(dir), '.');
    assert.equal(displayPath(outside), path.basename(outside));
    // readJsonFile error text carries the relative path, not the root.
    let caught = null;
    try { readJsonFile(inside, 'doc'); } catch (e) { caught = e; }
    assert.equal(caught.code, 'READ_FAILED');
    assert.ok(caught.message.includes('sub/f.json'));
    assert.ok(!caught.message.includes(dir));
    setPathDisplayRoot(null);
    try { readJsonFile(inside, 'doc'); } catch (e) { caught = e; }
    assert.ok(!caught.message.includes(dir));
    assert.ok(caught.message.includes('f.json'));
  } finally { setPathDisplayRoot(null); cleanup(dir); }
});
