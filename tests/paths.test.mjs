// SPDX-License-Identifier: Apache-2.0
// Path safety cases (implementation contract case 6 plus Windows aliases).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  assertDestination, assertDistinctPaths, assertNoSymlinkChain,
  detectProjectRoot, isSameOrAncestor, resolveInside, resolveProjectRoot,
  toCanonicalRelative,
} from '../src/core/paths.mjs';
import { cleanup, makeTempDir, trySymlink, writeFile } from './helpers.mjs';

const REJECTED = [
  '../escape', '..', './x', 'x/./y', '/abs/posix', 'C:/win', 'c:\\win',
  '\\\\server\\share', 'a:b', 'x:y/z', '', 'a//b', 'a/', '/',
  '.git', '.git/config', '.GIT/x', 'Node_Modules/pkg', 'LEGACY/old',
  '.opencode/x', 'node_modules/pkg', 'legacy/x',
  'a<b', 'a>b', 'a|b', 'a?b', 'a*b', 'a"b',
  'trail /x', 'trail./x', 'NUL', 'NUL.txt', 'con/x', 'COM1', 'lpt9.md',
  'aux/file',
];

test('unsafe, reserved and Windows-hostile paths are rejected', () => {
  for (const p of REJECTED) {
    assert.throws(() => assertDestination(p), (e) =>
      e.code === 'INVALID_PATH' || e.code === 'RESERVED_PATH',
    `expected rejection for ${JSON.stringify(p)}`);
  }
});

test('canonical relative paths accepted; Unicode and backslashes kept', () => {
  assert.equal(assertDestination('docs/agent/plans'), 'docs/agent/plans');
  assert.equal(assertDestination('docs\\agent\\plans'), 'docs/agent/plans');
  assert.equal(assertDestination('.scopegrain/memory'), '.scopegrain/memory');
  assert.equal(assertDestination('docs/españa/planes'), 'docs/españa/planes');
  assert.equal(assertDestination('日本語/ファイル'), '日本語/ファイル');
});

test('overlap detection is case-insensitive on all platforms', () => {
  assert.throws(
    () => assertDistinctPaths([['a', 'Docs/Tasks'], ['b', 'docs/tasks/x']]),
    (e) => e.code === 'PATH_OVERLAP');
  assert.throws(
    () => assertDistinctPaths([['a', 'X/Y'], ['b', 'x/y']]),
    (e) => e.code === 'PATH_OVERLAP');
  assertDistinctPaths([['a', 'x'], ['b', 'y']]);
});

test('isSameOrAncestor uses the portable comparison key', () => {
  assert.ok(isSameOrAncestor('A', 'a/b'));
  assert.ok(!isSameOrAncestor('a', 'ab'));
});

test('resolveInside enforces real containment and real ancestors', () => {
  const dir = makeTempDir('root');
  try {
    const root = resolveProjectRoot(dir);
    assert.equal(
      resolveInside(root, 'docs/x'), path.join(root, 'docs', 'x'));
    assert.throws(() => resolveInside(root, '../x'),
      (e) => e.code === 'INVALID_PATH' || e.code === 'OUTSIDE_ROOT');
    // A pre-existing regular FILE as ancestor is rejected.
    writeFile(dir, 'blocked', 'x');
    assert.throws(() => resolveInside(root, 'blocked/inner.txt'),
      (e) => e.code === 'FILE_ANCESTOR');
  } finally { cleanup(dir); }
});

test('symlink ancestors are rejected', (t) => {
  const dir = makeTempDir('root-link');
  try {
    const root = resolveProjectRoot(dir);
    writeFile(dir, 'real/inner.txt', 'x');
    const linked = path.join(dir, 'linked');
    let made = false;
    try {
      fs.symlinkSync(path.join(dir, 'real'), linked, 'junction');
      made = true;
    } catch (e) {
      if (['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(e.code)) {
        t.skip(`symlink creation unavailable: ${e.code}`);
        return;
      }
      throw e;
    }
    if (made) {
      assert.throws(() => resolveInside(root, 'linked/inner.txt'),
        (e) => e.code === 'SYMLINK_REJECTED');
      assert.throws(
        () => assertNoSymlinkChain(root, path.join(linked, 'inner.txt')),
        (e) => e.code === 'SYMLINK_REJECTED');
    }
  } finally { cleanup(dir); }
});

test('project root must exist and be a real directory', () => {
  const dir = makeTempDir('root-ok');
  try {
    assert.equal(resolveProjectRoot(dir), path.resolve(dir));
    assert.throws(() => resolveProjectRoot(path.join(dir, 'missing')),
      (e) => e.code === 'PROJECT_NOT_FOUND');
    const file = writeFile(dir, 'file.txt', 'x');
    assert.throws(() => resolveProjectRoot(file),
      (e) => e.code === 'PROJECT_NOT_DIR' || e.code === 'SYMLINK_REJECTED');
  } finally { cleanup(dir); }
});

test('detectProjectRoot ascends to the nearest .scopegrain/config.json marker', () => {
  const dir = makeTempDir('detect');
  try {
    const marker = path.join(dir, '.scopegrain', 'config.json');
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, '{malformed'); // still counts: loadConfig owns the error
    const nested = path.join(dir, 'a', 'b', 'c');
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(detectProjectRoot(nested), path.resolve(dir));
    assert.equal(detectProjectRoot(dir), path.resolve(dir));
    // The start dir itself is checked: a marker one level below the start
    // is not an ancestor marker. os tmp sits outside any project tree.
    const orphan = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-detect-orphan-'));
    try {
      fs.mkdirSync(path.join(orphan, 'child', '.scopegrain'), { recursive: true });
      assert.equal(detectProjectRoot(orphan), null);
    } finally { cleanup(orphan); }
    // maxLevels bounds the ascent: a marker 2 levels up is missed with 1.
    const deep = path.join(dir, 'a', 'b');
    assert.equal(detectProjectRoot(deep, { maxLevels: 1 }), null);
    assert.equal(detectProjectRoot(deep, { maxLevels: 2 }), path.resolve(dir));
  } finally { cleanup(dir); }
});

test('toCanonicalRelative rejects non-strings and control characters', () => {
  assert.throws(() => toCanonicalRelative(42), (e) => e.code === 'INVALID_PATH');
  assert.throws(
    () => toCanonicalRelative(['a', 'b'].join(String.fromCharCode(0))),
    (e) => e.code === 'INVALID_PATH');
  assert.throws(() => toCanonicalRelative(['a','b'].join(String.fromCharCode(31))), (e) => e.code === 'INVALID_PATH');
});

test('isSameOrAncestor caseSensitive: src does not authorize SRC', () => {
  assert.equal(isSameOrAncestor('src/app', 'src/app/child'), true);
  assert.equal(isSameOrAncestor('src/app', 'src/app2'), false);
  assert.equal(isSameOrAncestor('src/app', 'SRC/app',
    { caseSensitive: true }), false);
  assert.equal(isSameOrAncestor('src/app', 'SRC/app'), true); // default
  assert.equal(isSameOrAncestor('src/app', 'src/app/child',
    { caseSensitive: true }), true);
});
