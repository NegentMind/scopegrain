// SPDX-License-Identifier: Apache-2.0
// Structural index: inventory, metrics heuristics, dependency edges,
// fingerprint change detection and persistence under state/cache.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  readStructureIndex, scanStructure, structureStatus, writeStructureIndex,
} from '../src/discovery/structure.mjs';
import { run } from '../src/cli.mjs';
import {
  DEFAULT_ANSWERS, bootstrappedCtx, cleanup, exists, fakeIO, makeTempDir,
  writeFile,
} from './helpers.mjs';

function codeProject() {
  const dir = makeTempDir('structure');
  writeFile(dir, 'package.json', JSON.stringify({ name: 'demo' }));
  writeFile(dir, 'src/index.js',
    'import { a } from "./lib/a.js";\nimport express from "express";\n'
    + '// entry point\n\nexport function main() {\n'
    + '  if (a) { return a(); }\n  return null;\n}\n');
  writeFile(dir, 'src/lib/a.js',
    'export function a() {\n  for (let i = 0; i < 3; i++) {}\n  return 1;\n}\n');
  writeFile(dir, 'src/lib/unused.js', 'export const dead = true;\n');
  writeFile(dir, 'pkg/tool.py', 'import os\nfrom . import helper\n\ndef run():\n'
    + '    pass\n');
  writeFile(dir, 'node_modules/skip/ignored.js', 'should never appear\n');
  writeFile(dir, 'assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFile(dir, '.env', 'SECRET=x\n');
  return dir;
}

test('scanStructure inventories code, skips dependencies and binaries', () => {
  const dir = codeProject();
  try {
    const idx = scanStructure(dir);
    const rels = idx.files.map((f) => f[0]);
    assert.ok(rels.includes('src/index.js'));
    assert.ok(!rels.some((r) => r.includes('node_modules')));
    assert.ok(!rels.some((r) => r.startsWith('.')));
    // PNG inventoried but never opened for metrics; .env skipped entirely.
    const png = idx.files.find((f) => f[0] === 'assets/logo.png');
    assert.ok(png);
    assert.equal(png[3], -1); // lines: not metricized
    assert.ok(!rels.some((r) => r === '.env'));
    assert.ok(idx.totals.files >= 5);
    assert.equal(idx.statOnly, false);
    assert.equal(typeof idx.fingerprint, 'string');
    assert.equal(idx.fingerprint.length, 64);
  } finally { cleanup(dir); }
});

test('per-language metrics: lines, comments, functions, complexity', () => {
  const dir = codeProject();
  try {
    const idx = scanStructure(dir);
    const js = idx.languages.javascript;
    assert.ok(js.files >= 3);
    assert.ok(js.lines >= 10);
    assert.ok(js.functions >= 2); // main + a
    const indexRow = idx.files.find((f) => f[0] === 'src/index.js');
    assert.ok(indexRow[3] >= 8);    // lines
    assert.ok(indexRow[4] >= 6);    // code (comments/blanks excluded)
    assert.ok(indexRow[6] >= 1);    // complexity: one `if`
    const py = idx.languages.python;
    assert.ok(py);
    assert.ok(py.functions >= 1);
  } finally { cleanup(dir); }
});

test('internal edges resolve to files; bare specifiers are external', () => {
  const dir = codeProject();
  try {
    const idx = scanStructure(dir);
    assert.ok(idx.edges.internal >= 1);
    assert.ok(idx.edges.external.includes('express'));
    const fanIn = idx.top.fanIn.find((f) => f.rel === 'src/lib/a.js');
    assert.ok(fanIn && fanIn.importedBy >= 1);
  } finally { cleanup(dir); }
});

test('statOnly rescan detects change via fingerprint without reads', () => {
  const dir = codeProject();
  try {
    const a = scanStructure(dir, { statOnly: true });
    assert.equal(a.files, null);
    const b = scanStructure(dir, { statOnly: true });
    assert.equal(a.fingerprint, b.fingerprint);
    writeFile(dir, 'src/newfile.js', 'export const n = 1;\n');
    const c = scanStructure(dir, { statOnly: true });
    assert.notEqual(a.fingerprint, c.fingerprint);
  } finally { cleanup(dir); }
});

test('index persists under state/cache and round-trips', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const idx = scanStructure(dir);
    const rel = writeStructureIndex(ctx, idx);
    assert.equal(rel, '.tasksystem/state/cache/structure-index.json');
    assert.ok(exists(dir, rel));
    const back = readStructureIndex(ctx);
    assert.equal(back.fingerprint, idx.fingerprint);
    assert.equal(back.totals.files, idx.totals.files);
    // stat-only rescan right after write -> fresh.
    const status = structureStatus(ctx);
    assert.equal(status.indexed, true);
    assert.equal(status.stale, false);
    assert.equal(status.summary.files, idx.totals.files);
    // A file write flips staleness.
    writeFile(dir, 'new-src.js', 'export {};\n');
    assert.equal(structureStatus(ctx).stale, true);
  } finally { cleanup(dir); }
});

test('malformed index fails closed', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    writeFile(dir, '.tasksystem/state/cache/structure-index.json', '{bad');
    assert.throws(() => readStructureIndex(ctx),
      (e) => e.code === 'STRUCTURE_MALFORMED');
  } finally { cleanup(dir); }
});

test('CLI: scan previews, --apply persists, status reports freshness', async () => {
  const { dir } = bootstrappedCtx();
  try {
    const io1 = fakeIO();
    assert.equal(await run(['structure', 'scan', '--project', dir], io1), 0);
    const preview = JSON.parse(io1.out.stdout.at(-1));
    assert.equal(preview.mode, 'preview');
    assert.equal(exists(dir, '.tasksystem/state/cache/structure-index.json'), false);

    const io2 = fakeIO();
    assert.equal(await run(
      ['structure', 'scan', '--project', dir, '--apply'], io2), 0);
    const applied = JSON.parse(io2.out.stdout.at(-1));
    assert.equal(applied.mode, 'applied');
    assert.ok(exists(dir, '.tasksystem/state/cache/structure-index.json'));

    const io3 = fakeIO();
    assert.equal(await run(['structure', 'status', '--project', dir], io3), 0);
    assert.equal(JSON.parse(io3.out.stdout.at(-1)).stale, false);
  } finally { cleanup(dir); }
});

test('CLI: context packet surfaces index freshness read-only', async () => {
  const { dir } = bootstrappedCtx();
  try {
    // context requires an enrolled workspace.
    const ioWs = fakeIO();
    assert.equal(await run(
      ['workspace', 'init', '--project', dir, '--apply'], ioWs), 0);
    const io0 = fakeIO();
    assert.equal(await run(['context', '--project', dir], io0), 0);
    const before = JSON.parse(io0.out.stdout.at(-1));
    assert.equal(before.structure.indexed, false);

    const io1 = fakeIO();
    await run(['structure', 'scan', '--project', dir, '--apply'], io1);

    const io2 = fakeIO();
    assert.equal(await run(['context', '--project', dir], io2), 0);
    const packet = JSON.parse(io2.out.stdout.at(-1));
    assert.equal(packet.structure.indexed, true);
    assert.equal(packet.structure.stale, false);
    assert.equal(packet.structure.refreshPolicy, 'explicit');
    assert.equal(packet.structure.recommendedCommand, null);
    assert.equal(typeof packet.structure.summary.files, 'number');
  } finally { cleanup(dir); }
});

test('CLI: structure refresh is noop when fresh and bounded preview/apply when stale', async () => {
  const { dir } = bootstrappedCtx();
  try {
    const ioPreview = fakeIO();
    assert.equal(await run(['structure', 'refresh', '--project', dir], ioPreview), 0);
    const p = JSON.parse(ioPreview.out.stdout.at(-1));
    assert.equal(p.mode, 'preview');
    assert.equal(p.refreshed, false);
    assert.equal(p.reason, 'missing');
    assert.equal(p.status.refreshPolicy, 'explicit');
    assert.ok(p.status.recommendedCommand);

    const ioApply = fakeIO();
    assert.equal(await run(['structure', 'refresh', '--project', dir, '--apply'], ioApply), 0);
    const a = JSON.parse(ioApply.out.stdout.at(-1));
    assert.equal(a.mode, 'applied');
    assert.equal(a.refreshed, true);
    assert.equal(a.status.stale, false);

    // Calling refresh again without tree changes is a stat-only noop.
    const ioNoop = fakeIO();
    assert.equal(await run(['structure', 'refresh', '--project', dir, '--apply'], ioNoop), 0);
    const n = JSON.parse(ioNoop.out.stdout.at(-1));
    assert.equal(n.mode, 'noop');
    assert.equal(n.refreshed, false);
    assert.equal(n.reason, 'fresh');

    // Adding a file makes it stale again; refresh updates it.
    writeFile(dir, 'src/added.js', 'export const x = 1;\n');
    const ioAgain = fakeIO();
    assert.equal(await run(['structure', 'refresh', '--project', dir, '--apply'], ioAgain), 0);
    const r = JSON.parse(ioAgain.out.stdout.at(-1));
    assert.equal(r.mode, 'applied');
    assert.equal(r.refreshed, true);
  } finally { cleanup(dir); }
});

test('secret-adjacent files are inventoried but never opened', () => {
  const dir = codeProject();
  try {
    const idx = scanStructure(dir);
    const env = idx.files.find((f) => f[0] === '.env' || f[0].endsWith('.env'));
    // .env may be skipped at the dotfile level or inventoried without
    // metrics — either way its content never produced a metrics row.
    if (env) assert.equal(env[3], -1);
    assert.equal(idx.warnings.filter((w) => w.code === 'SCAN_READ').length, 0);
  } finally { cleanup(dir); }
});

test('init --apply seeds the structural index', async () => {
  const dir = makeTempDir('init-struct');
  try {
    writeFile(dir, 'package.json', JSON.stringify({ name: 'seeded' }));
    writeFile(dir, 'src/x.js', 'export const x = 1;\n');
    const io = fakeIO();
    assert.equal(await run(
      ['init', '--project', dir, '--defaults', '--apply'], io), 0);
    const out = JSON.parse(io.out.stdout.at(-1));
    assert.equal(out.applied, true);
    assert.ok(out.structureIndex.written);
    assert.ok(fs.existsSync(
      `${dir}/${out.structureIndex.written}`.replace(/\//g, '\\') ));
  } finally { cleanup(dir); }
});
