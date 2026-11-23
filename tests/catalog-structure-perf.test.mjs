// SPDX-License-Identifier: Apache-2.0
// Cross-process catalog fingerprint cache and skippable/debounced
// structure status — the per-CLI-invocation cost controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  loadWorkspaceCatalog,
} from '../src/core/catalog.mjs';
import {
  scanStructure, storedStructureStatus, structureStatus,
  writeStructureIndex,
} from '../src/discovery/structure.mjs';
import { assembleContextPacket } from '../src/core/context-packet.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { prepareWorkspace } from '../src/core/workspaces.mjs';
import { bootstrappedCtx, cleanup, writeFile } from './helpers.mjs';

const FP_REL = '.tasksystem/state/cache/catalog-fingerprint.json';
const CATALOG_MJS = new URL('../src/core/catalog.mjs', import.meta.url).href;

function probe(dir, extra = '') {
  const script = `
import { loadWorkspaceCatalog, getResource }
  from ${JSON.stringify(CATALOG_MJS)};
const ctx = { projectRoot: ${JSON.stringify(dir)}, configDir: '.tasksystem' };
try {
  const cat = loadWorkspaceCatalog(ctx);
  let serve = null;
  try { getResource('command', 'plan-work', { catalog: cat }); }
  catch (e) { serve = e.code ?? String(e); }
  console.log(JSON.stringify({ ok: true, integrity: cat.integrity,
    entries: cat.entries.length, serve, ${extra} }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, code: e.code ?? String(e) }));
}`;
  const r = spawnSync(process.execPath,
    ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, `child failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').at(-1));
}

test('verified fingerprint persists and is honored by a fresh process', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    loadWorkspaceCatalog(ctx); // verify + persist
    const fpAbs = path.join(dir, ...FP_REL.split('/'));
    assert.ok(fs.existsSync(fpAbs), 'fingerprint file must be written');
    const doc = JSON.parse(fs.readFileSync(fpAbs, 'utf8'));
    assert.equal(doc.schemaVersion, 1);
    assert.equal(doc.configDir, path.resolve(dir, '.tasksystem'));
    assert.equal(typeof doc.fingerprint, 'string');
    assert.ok(doc.fingerprint.length > 64);
    // A fresh process reuses it: catalog resolves, hash-verified label.
    const out = probe(dir);
    assert.equal(out.ok, true);
    assert.equal(out.integrity, 'hash-verified');
    assert.ok(out.entries > 100);
    assert.equal(out.serve, null);
  } finally { cleanup(dir); }
});

test('forged fingerprint record is ignored — verify stays fail-closed', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    loadWorkspaceCatalog(ctx);
    const fpAbs = path.join(dir, ...FP_REL.split('/'));
    fs.writeFileSync(fpAbs, '{corrupt');
    const out = probe(dir);
    // Corrupt record -> miss -> full verify -> still a working catalog,
    // and the record is rewritten on success.
    assert.equal(out.ok, true);
    const doc = JSON.parse(fs.readFileSync(fpAbs, 'utf8'));
    assert.equal(doc.schemaVersion, 1);
    assert.equal(typeof doc.fingerprint, 'string');
  } finally { cleanup(dir); }
});

test('stat-changing tamper invalidates the persisted fingerprint', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    loadWorkspaceCatalog(ctx); // persist fingerprint F1
    const f = `${dir}/.tasksystem/commands/plan-work.md`;
    const orig = fs.readFileSync(f);
    fs.writeFileSync(f, Buffer.concat([orig, Buffer.from('X')])); // size+
    const out = probe(dir);
    assert.equal(out.ok, false);
    assert.equal(out.code, 'RESOURCE_INTEGRITY_MISMATCH');
    fs.writeFileSync(f, orig);
  } finally { cleanup(dir); }
});

test('stat-preserving tamper skips only the eager pass — delivery fails', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const f = `${dir}/.tasksystem/commands/plan-work.md`;
    const orig = fs.readFileSync(f);
    const fixed = new Date(1700000000000);
    fs.utimesSync(f, fixed, fixed);
    loadWorkspaceCatalog(ctx); // verify + persist under pinned tuples
    // Forge identical size + mtime: invisible to stat tuples by design.
    fs.writeFileSync(f, Buffer.alloc(orig.length, 'X'));
    fs.utimesSync(f, fixed, fixed);
    const out = probe(dir);
    assert.equal(out.ok, true, 'fresh process honors the fingerprint');
    // getResource re-hashes served bytes — delivery still fails closed.
    assert.equal(out.serve, 'RESOURCE_INTEGRITY_MISMATCH');
    fs.writeFileSync(f, orig);
    fs.utimesSync(f, fixed, fixed);
  } finally { cleanup(dir); }
});

test('structureStatus debounce serves a cached answer inside the window', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const first = structureStatus(ctx, { debounceMs: 60_000 });
    assert.equal(first.cached, undefined);
    assert.equal(typeof first.stale, 'boolean');
    const cacheRel = '.tasksystem/state/cache/structure-status.json';
    assert.ok(fs.existsSync(path.join(dir, ...cacheRel.split('/'))));
    const second = structureStatus(ctx, { debounceMs: 60_000 });
    assert.equal(second.cached, true);
    assert.equal(second.stale, first.stale);
    // A tree change inside the window is masked by debounce — declared
    // semantics of an opt-in time-window cache.
    writeFile(dir, 'src/late.js', 'export const x = 1;\n');
    assert.equal(
      structureStatus(ctx, { debounceMs: 60_000 }).cached, true);
    // Without the opt-in flag the rescan always runs (read-only default).
    const live = structureStatus(ctx);
    assert.equal(live.cached, undefined);
    assert.equal(live.stale, true);
  } finally { cleanup(dir); }
});

test('cached status is invalidated when the stored index is refreshed', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    structureStatus(ctx, { debounceMs: 60_000 }); // prime cache
    const idx = scanStructure(dir);
    writeStructureIndex(ctx, idx); // stored fingerprint changes
    const next = structureStatus(ctx, { debounceMs: 60_000 });
    assert.equal(next.cached, undefined);
    assert.equal(next.indexed, true);
    assert.equal(next.stale, false);
  } finally { cleanup(dir); }
});

test('storedStructureStatus reports index without a live rescan', async () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const none = storedStructureStatus(ctx);
    assert.deepEqual([none.indexed, none.stale, none.checked],
      [false, null, false]);
    assert.equal(none.liveFiles, null);
    const idx = scanStructure(dir);
    writeStructureIndex(ctx, idx);
    const stored = storedStructureStatus(ctx);
    assert.equal(stored.indexed, true);
    assert.equal(stored.checked, false);
    assert.equal(stored.stale, null);
    assert.equal(stored.summary.files, idx.totals.files);
    // Wired through the packet opt: --no-structure posture.
    const ws = prepareWorkspace(ctx, { areas: [{ key: 'p', name: 'P' }] });
    applyPlan(dir, [ws.file]);
    const out = await assembleContextPacket(ctx,
      { noVantadb: true, noStructure: true });
    assert.equal(out.structure.checked, false);
    assert.equal(out.structure.stale, null);
    assert.equal(out.structure.indexed, true);
    const live = await assembleContextPacket(ctx, { noVantadb: true });
    assert.equal(typeof live.structure.stale, 'boolean');
    assert.equal(live.structure.checked, undefined);
  } finally { cleanup(dir); }
});
