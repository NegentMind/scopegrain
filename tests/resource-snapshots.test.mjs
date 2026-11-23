// SPDX-License-Identifier: Apache-2.0
// Workspace snapshot: hash verification, tamper detection, V1 warning,
// installation-independence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  getResource, loadWorkspaceCatalog,
} from '../src/core/catalog.mjs';
import { buildWorkflowPacket } from '../src/core/workflows.mjs';
import { bootstrappedCtx, cleanup } from './helpers.mjs';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('snapshot tampering blocks resource delivery', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const f = `${dir}/.tasksystem/commands/plan-work.md`;
    const orig = fs.readFileSync(f);
    fs.writeFileSync(f, 'TAMPERED\n');
    assert.throws(() => loadWorkspaceCatalog(ctx),
      (e) => e.code === 'RESOURCE_INTEGRITY_MISMATCH');
    fs.writeFileSync(f, orig); // restore; entry-level check too
    // Entry-level: hash re-verified on every getResource.
    const cat = loadWorkspaceCatalog(ctx);
    fs.writeFileSync(f, 'TAMPERED\n');
    assert.throws(() => getResource('command', 'plan-work', { catalog: cat }),
      (e) => e.code === 'RESOURCE_INTEGRITY_MISMATCH');
    fs.writeFileSync(f, orig);
  } finally { cleanup(dir); }
});

test('project without snapshot fails structurally', () => {
  const { dir } = bootstrappedCtx();
  try {
    fs.rmSync(`${dir}/.tasksystem/catalog.json`);
    assert.throws(() => loadWorkspaceCatalog(ctxStub(dir)),
      (e) => e.code === 'WORKSPACE_CATALOG_MISSING');
  } finally { cleanup(dir); }
});

function ctxStub(dir) {
  return { projectRoot: dir, configDir: '.tasksystem' };
}

test('installation change does not alter project resources', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const before = getResource('command', 'plan-work',
      { catalog: loadWorkspaceCatalog(ctx) }).content.toString('utf8');
    // A DIFFERENT (fake) installation with changed bytes: project stays
    // pinned to its own snapshot regardless of the origin content.
    const fake = `${dir}-fakeinstall`;
    fs.mkdirSync(`${fake}/resources/commands`, { recursive: true });
    fs.mkdirSync(`${fake}/resources/profiles`, { recursive: true });
    fs.writeFileSync(`${fake}/resources/manifest.json`, JSON.stringify({
      schemaVersion: 1,
      entries: [
        { kind: 'command', id: 'plan-work',
          path: 'resources/commands/plan-work.md',
          description: 'changed install body', modes: ['default'] },
        { kind: 'profile', id: 'core',
          path: 'resources/profiles/core.json', description: 'core' },
      ],
    }));
    fs.writeFileSync(`${fake}/resources/commands/plan-work.md`, 'CHANGED\n');
    fs.writeFileSync(`${fake}/resources/profiles/core.json`, JSON.stringify({
      schemaVersion: 1, id: 'core', description: 'c',
      skills: [], rules: [], references: [],
      activation: 'always', externalServices: [],
    }));
    const fakeRes = getResource('command', 'plan-work',
      { installRoot: fake });
    assert.equal(fakeRes.content.toString('utf8'), 'CHANGED\n');
    const after = getResource('command', 'plan-work',
      { catalog: loadWorkspaceCatalog(ctx) }).content.toString('utf8');
    assert.equal(before, after);
    fs.rmSync(fake, { recursive: true, force: true });
  } finally { cleanup(dir); }
});

test('packet labels snapshot authority + policy digest, budget enforced', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const p = buildWorkflowPacket(ctx, { command: 'pipeline' });
    assert.equal(p.authority.resourceSource, 'workspace-snapshot');
    assert.equal(p.authority.snapshotIntegrity, 'hash-verified');
    assert.equal(p.authority.runtimePolicySource, 'installed-runtime');
    assert.match(p.authority.policyDigest, /^[0-9a-f]{64}$/);
    assert.equal(p.command.id, 'pipeline'); // requested id preserved
    assert.equal(p.command.canonicalId, 'plan-work');
    assert.equal(p.interaction, 'direct');
    const g = buildWorkflowPacket(ctx, {
      command: 'pipeline', mode: 'interactive',
    });
    assert.equal(g.interaction, 'guided');
    assert.throws(() => buildWorkflowPacket(ctx, {
      command: 'pipeline', mode: 'interactive', interaction: 'direct',
    }), (e) => e.code === 'INVALID_ARGS');
    // Core always supplements.
    const spec = buildWorkflowPacket(ctx, {
      command: 'specify-change', profile: 'web',
    });
    assert.ok(spec.resources.rules.some((r) => r.id === 'safety'));
  } finally { cleanup(dir); }
});

test('gitattributes pins -text for every snapshot payload inside cfgDir', () => {
  const { dir } = bootstrappedCtx();
  try {
    const gi = fs.readFileSync(`${dir}/.tasksystem/.gitattributes`, 'utf8');
    assert.ok(gi.startsWith(
      '# Preserve generated harness bytes; root project attributes are unchanged.\n'));
    assert.ok(gi.includes('"/catalog.json" -text'));
    assert.ok(gi.includes('"/commands/plan-work.md" -text'));
    assert.ok(!fs.existsSync(`${dir}/.gitattributes`));
  } finally { cleanup(dir); }
});

test('stat-fingerprint cache: stat-changing write forces re-verification', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    // First load populates the per-process verified cache.
    loadWorkspaceCatalog(ctx);
    const f = `${dir}/.tasksystem/commands/plan-work.md`;
    const orig = fs.readFileSync(f);
    // A different-size write changes the stat tuple: fingerprint differs,
    // the cache misses and the eager pass catches the tamper.
    fs.writeFileSync(f, orig + 'TAMPERED-BYTES\n');
    assert.throws(() => loadWorkspaceCatalog(ctx),
      (e) => e.code === 'RESOURCE_INTEGRITY_MISMATCH');
    fs.writeFileSync(f, orig);
    // Restored bytes verify again.
    loadWorkspaceCatalog(ctx);
  } finally { cleanup(dir); }
});

test('stat-preserving byte edit escapes the eager pass but not delivery', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const f = `${dir}/.tasksystem/commands/plan-work.md`;
    const orig = fs.readFileSync(f);
    // Pin an exact whole-ms timestamp first — utimesSync round-trips it
    // losslessly, so the forged write below can restore the same tuple.
    const fixed = new Date(1700000000000);
    fs.utimesSync(f, fixed, fixed);
    loadWorkspaceCatalog(ctx); // populate cache
    // Forged bytes with identical size AND restored mtime: the declared
    // TOCTOU limitation — the stat fingerprint cannot see it.
    fs.writeFileSync(f, Buffer.alloc(orig.length, 'X'));
    fs.utimesSync(f, fixed, fixed);
    const cat = loadWorkspaceCatalog(ctx); // cache hit: no throw
    // getResource re-hashes served bytes — delivery still fails closed.
    assert.throws(() => getResource('command', 'plan-work', { catalog: cat }),
      (e) => e.code === 'RESOURCE_INTEGRITY_MISMATCH');
    fs.writeFileSync(f, orig);
    fs.utimesSync(f, fixed, fixed);
  } finally { cleanup(dir); }
});

test('mounted entries are covered by the stat fingerprint', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const bundleRel = '.tasksystem/bundles/b1/skills/x/SKILL.md';
    fs.mkdirSync(`${dir}/.tasksystem/bundles/b1/skills/x`, { recursive: true });
    const body = Buffer.from('# mounted skill\n', 'utf8');
    fs.writeFileSync(`${dir}/${bundleRel}`, body);
    fs.writeFileSync(`${dir}/.tasksystem/mounted-catalog.json`,
      JSON.stringify({ schemaVersion: 1, entries: [{
        kind: 'skill', id: 'x', bundle: 'b1',
        path: 'bundles/b1/skills/x/SKILL.md',
        sha256: sha(body),
      }] }) + '\n');
    const cat = loadWorkspaceCatalog(ctx); // populates cache
    assert.equal(cat.mounted, 1);
    // Tampering a mounted file changes its stat tuple -> re-verify -> fail.
    fs.writeFileSync(`${dir}/${bundleRel}`, '# mounted skill TAMPERED\n');
    assert.throws(() => loadWorkspaceCatalog(ctx),
      (e) => e.code === 'RESOURCE_INTEGRITY_MISMATCH');
  } finally { cleanup(dir); }
});
