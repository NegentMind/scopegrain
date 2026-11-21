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

test('SCOPEGRAIN_* env vars do not alter context resolution', async () => {
  // Environment isolation: a hostile/polluted env must not redirect
  // resolution away from the explicit --project boundary.
  const { resolveContext } = await import('../src/core/context.mjs');
  const { bootstrappedCtx, cleanup, VALID_ANSWERS } =
    await import('./helpers.mjs');
  const { dir } = bootstrappedCtx(VALID_ANSWERS);
  const saved = { ...process.env };
  try {
    process.env.SCOPEGRAIN_TASK = 'forged-task';
    process.env.SCOPEGRAIN_PROJECT = '/etc/passwd';
    process.env.SCOPEGRAIN_CONFIG = 'evil.json';
    const ctx = resolveContext({ project: dir });
    assert.equal(ctx.projectRoot, fs.realpathSync(dir));
  } finally {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('SCOPEGRAIN_')) delete process.env[k];
    }
    Object.assign(process.env, saved);
    cleanup(dir);
  }
});
