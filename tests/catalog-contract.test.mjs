// SPDX-License-Identifier: Apache-2.0
// Packaging contract: every manifest entry resolves to a real file and
// every resource file on disk is declared. Drift in either direction is
// a packaging bug (spec-kit firstparty_bundle_catalog_consistency parity).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = path.join(ROOT, 'resources', 'manifest.json');
const RESOURCES = path.join(ROOT, 'resources');
const KIND_DIRS = {
  agent: 'agents', command: 'commands', mcp: 'mcps', profile: 'profiles',
  prompt: 'prompts', reference: 'references', rule: 'rules',
  skill: 'skills',
};

function manifest() {
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

test('every manifest entry resolves to an existing file under resources/', () => {
  const m = manifest();
  assert.ok(m.entries.length > 0);
  for (const e of m.entries) {
    assert.ok(KIND_DIRS[e.kind], `unknown kind '${e.kind}' for ${e.id}`);
    const abs = path.join(ROOT, e.path);
    assert.ok(e.path.startsWith('resources/'),
      `${e.kind}/${e.id} path escapes resources/: ${e.path}`);
    assert.ok(fs.existsSync(abs), `missing file for ${e.kind}/${e.id}: ${e.path}`);
    assert.ok(fs.lstatSync(abs).isFile(), `${e.path} is not a regular file`);
  }
});

test('every resource file on disk is declared in the manifest', () => {
  const declared = new Set(manifest().entries.map((e) => e.path));
  const undeclared = [];
  for (const [kind, dir] of Object.entries(KIND_DIRS)) {
    const abs = path.join(RESOURCES, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).sort()) {
      const p = path.join(abs, f);
      if (!fs.lstatSync(p).isFile()) continue;
      const rel = `resources/${dir}/${f}`;
      if (!declared.has(rel)) undeclared.push(`${kind}: ${rel}`);
    }
  }
  assert.deepEqual(undeclared, []);
});

test('manifest ids and paths are unique case-insensitively per kind', () => {
  const ids = new Map(); const paths = new Map();
  for (const e of manifest().entries) {
    const idKey = `${e.kind}/${e.id}`.toLowerCase();
    const pKey = e.path.toLowerCase();
    assert.ok(!ids.has(idKey), `duplicate ${idKey}`);
    assert.ok(!paths.has(pKey), `duplicate path ${pKey}`);
    ids.set(idKey, true); paths.set(pKey, true);
  }
});

test('manifest carries a semver content version', () => {
  const m = manifest();
  assert.match(m.version, /^[0-9]+\.[0-9]+\.[0-9]+$/,
    'resources/manifest.json needs a semver "version" (G5b guard)');
});

test('version-bump guard: pure decision logic is fail-closed', async () => {
  const { semverCompare, resourcesChanged, evaluateBump } =
    await import('../scripts/check-manifest-version.mjs');
  assert.equal(semverCompare('1.2.3', '1.2.3'), 0);
  assert.equal(semverCompare('1.10.0', '1.9.9'), 1);
  assert.equal(semverCompare('0.9.9', '1.0.0'), -1);
  assert.throws(() => semverCompare('x.y', '1.0.0'), /non-semver/);
  assert.ok(resourcesChanged(['resources/commands/x.md']));
  assert.ok(resourcesChanged(['resources/manifest.json']));
  assert.ok(!resourcesChanged(['src/core/x.mjs', 'docs/a.md']));
  // No resource change -> no bump required.
  assert.equal(evaluateBump({
    changedPaths: ['src/x.mjs'], baseVersion: '0.1.0',
    headVersion: '0.1.0' }).ok, true);
  // Resource change with equal or lower version fails.
  assert.equal(evaluateBump({
    changedPaths: ['resources/rules/r.md'], baseVersion: '0.1.0',
    headVersion: '0.1.0' }).ok, false);
  assert.equal(evaluateBump({
    changedPaths: ['resources/rules/r.md'], baseVersion: '0.2.0',
    headVersion: '0.1.0' }).ok, false);
  // Missing head version fails; missing base counts as 0.0.0.
  assert.equal(evaluateBump({
    changedPaths: ['resources/rules/r.md'], baseVersion: '0.1.0',
    headVersion: null }).ok, false);
  assert.equal(evaluateBump({
    changedPaths: ['resources/rules/r.md'], baseVersion: null,
    headVersion: '0.0.1' }).ok, true);
  // A strict semver bump passes — including bump-only diffs.
  assert.equal(evaluateBump({
    changedPaths: ['resources/manifest.json'], baseVersion: '0.1.0',
    headVersion: '0.1.1' }).ok, true);
});

test('SCOPEGRAIN_* env vars do not alter context resolution', async () => {
  // Environment isolation: a hostile/polluted env must not redirect
  // resolution away from the explicit --project boundary.
  const { resolveContext } = await import('../src/core/context.mjs');
  const { bootstrappedCtx, cleanup, VALID_ANSWERS, withEnv } =
    await import('./helpers.mjs');
  const { dir } = bootstrappedCtx(VALID_ANSWERS);
  try {
    withEnv({ SCOPEGRAIN_TASK: 'forged-task',
      SCOPEGRAIN_PROJECT: '/etc/passwd', SCOPEGRAIN_CONFIG: 'evil.json' },
      () => {
        const ctx = resolveContext({ project: dir });
        assert.equal(ctx.projectRoot, fs.realpathSync(dir));
      });
  } finally {
    cleanup(dir);
  }
});
