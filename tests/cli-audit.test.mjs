// SPDX-License-Identifier: Apache-2.0
// CLI audit regressions: alias flag parity, strict integer flags,
// dist remove/uninstall preview+--apply, outside-root --input warning,
// explicit session dispatch, view port fallback, --structure-debounce.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../src/cli.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { prepareWorkspace } from '../src/core/workspaces.mjs';
import {
  registerExtension, registerPreset, setExtensionState,
} from '../src/core/distribution.mjs';
import {
  VALID_ANSWERS, bootstrappedCtx, bootstrappedMiniCtx, cleanup, fakeIO,
  makeTempDir, writeJson,
} from './helpers.mjs';

const lastJson = (io) => JSON.parse(io.out.stdout[io.out.stdout.length - 1]);
const errPayload = (io) => JSON.parse(io.out.stderr[io.out.stderr.length - 1]);

async function call(args) {
  const io = fakeIO();
  const code = await run(args, io);
  return { code, io,
    output: code === 0 ? lastJson(io) : errPayload(io).error };
}

function enrolled() {
  const { dir, ctx } = bootstrappedMiniCtx();
  const ws = prepareWorkspace(ctx, { areas: [{ key: 'p', name: 'P' }] });
  applyPlan(dir, [ws.file]);
  return { dir, ctx: resolveContext({ project: dir }) };
}

// ---------- 1. workflow alias flag parity ----------

test('catalog aliases accept --lazy/--arguments/--script like workflow', async () => {
  const { dir } = bootstrappedCtx();
  try {
    const io = fakeIO();
    const code = await run(
      ['pipeline', '--project', dir, '--lazy',
        '--arguments', 'a1', '--script', 's1'], io);
    assert.equal(code, 0, io.out.stderr.join('\n'));
    const packet = lastJson(io);
    assert.equal(packet.lazy, true);
    assert.equal(packet.posture.current, 'lazy');
  } finally { cleanup(dir); }
});

// ---------- 2. strict integer flags (no silent NaN) ----------

test('non-decimal integer flags fail INVALID_ARGS instead of NaN', async () => {
  const { dir, ctx } = enrolled();
  try {
    assert.ok(ctx.config);
    const cases = [
      ['journal', 'list', '--limit', 'abc'],
      ['journal', 'list', '--since-sequence', '-1'],
      ['dist', 'journal', '--tail', 'x'],
      ['memory', 'list', '--log', 'lessons', '--tail', 'nan'],
      ['report', 'list', '--tail', '1.5'],
      ['vantadb', 'status', '--timeout', 'soon'],
      ['context', '--structure-debounce', 'x'],
    ];
    for (const args of cases) {
      const io = fakeIO();
      assert.equal(await run([...args, '--project', dir], io), 1,
        JSON.stringify(args));
      assert.equal(errPayload(io).error.code, 'INVALID_ARGS',
        JSON.stringify(args));
    }
  } finally { cleanup(dir); }
});

test('memory list accepts goals|activity logs', async () => {
  const { dir } = enrolled();
  try {
    for (const log of ['goals', 'activity']) {
      const io = fakeIO();
      assert.equal(await run(
        ['memory', 'list', '--project', dir, '--log', log], io), 0);
      assert.ok(Array.isArray(lastJson(io).entries));
    }
    const bad = fakeIO();
    assert.equal(await run(
      ['memory', 'list', '--project', dir, '--log', 'bogus'], bad), 1);
    assert.equal(errPayload(bad).error.code, 'INVALID_ARGS');
  } finally { cleanup(dir); }
});

// ---------- 3. dist remove/uninstall preview + --apply ----------

test('dist preset-remove previews then deletes only with --apply', async () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    registerPreset(ctx, { id: 'p1',
      overrides: [{ target: '*', op: 'replace', content: 'x' }] });
    const missing = await call(
      ['dist', 'preset-remove', '--project', dir, 'nope']);
    assert.equal(missing.code, 1);
    assert.equal(missing.output.code, 'NOT_FOUND');
    const dry = await call(
      ['dist', 'preset-remove', '--project', dir, 'p1']);
    assert.equal(dry.code, 0);
    assert.equal(dry.output.mode, 'dry-run');
    assert.equal(dry.output.applied, false);
    assert.equal(dry.output.plan.id, 'p1');
    const still = await call(['dist', 'preset-list', '--project', dir]);
    assert.equal(still.output.presets.length, 1);
    const applied = await call(
      ['dist', 'preset-remove', '--project', dir, 'p1', '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.output.removed, 'p1');
    const gone = await call(['dist', 'preset-list', '--project', dir]);
    assert.equal(gone.output.presets.length, 0);
  } finally { cleanup(dir); }
});

test('dist extension-remove previews; active state conflicts in preview', async () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    registerExtension(ctx,
      { id: 'ext-1', version: '1.0.0', contributes: [] });
    const dry = await call(
      ['dist', 'extension-remove', '--project', dir, 'ext-1']);
    assert.equal(dry.code, 0);
    assert.equal(dry.output.mode, 'dry-run');
    assert.equal(dry.output.plan.extension.id, 'ext-1');
    setExtensionState(ctx, 'ext-1', 'active');
    const conflict = await call(
      ['dist', 'extension-remove', '--project', dir, 'ext-1']);
    assert.equal(conflict.code, 1);
    assert.equal(conflict.output.code, 'CONFLICT');
    setExtensionState(ctx, 'ext-1', 'disabled');
    const applied = await call(
      ['dist', 'extension-remove', '--project', dir, 'ext-1', '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.output.removed, 'ext-1');
  } finally { cleanup(dir); }
});

test('dist bundle-uninstall previews delete candidates; --apply removes', async () => {
  const { dir } = bootstrappedMiniCtx();
  try {
    const missing = await call(
      ['dist', 'bundle-uninstall', '--project', dir, 'b1']);
    assert.equal(missing.code, 1);
    assert.equal(missing.output.code, 'NOT_FOUND');
    const fileRel = '.scopegrain/bundles/b1/f.txt';
    const sha = crypto.createHash('sha256')
      .update('payload').digest('hex');
    writeJson(dir, '.scopegrain/bundles/b1/provenance.json',
      { schemaVersion: 1, id: 'b1', files: [{ rel: fileRel, sha256: sha }] });
    fs.writeFileSync(path.join(dir, ...fileRel.split('/')), 'payload');
    const dry = await call(
      ['dist', 'bundle-uninstall', '--project', dir, 'b1']);
    assert.equal(dry.code, 0);
    assert.equal(dry.output.mode, 'dry-run');
    assert.deepEqual(dry.output.plan.deleteCandidates.sort(),
      ['.scopegrain/bundles/b1/provenance.json', fileRel].sort());
    assert.ok(fs.existsSync(path.join(dir, ...fileRel.split('/'))));
    const applied = await call(
      ['dist', 'bundle-uninstall', '--project', dir, 'b1', '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.output.bundle, 'b1');
    assert.ok(!fs.existsSync(path.join(dir, ...fileRel.split('/'))));
    assert.ok(!fs.existsSync(
      path.join(dir, '.scopegrain/bundles/b1/provenance.json')));
  } finally { cleanup(dir); }
});

// ---------- 4. --input outside project root warning ----------

test('--input outside the project root warns on stderr after success', async () => {
  const { dir } = enrolled();
  const outside = `${dir}-outside-input.json`;
  try {
    fs.writeFileSync(outside, JSON.stringify({ text: 'lesson' }));
    const io = fakeIO();
    assert.equal(await run(
      ['memory', 'add', '--project', dir, '--log', 'lessons',
        '--input', outside], io), 0);
    assert.equal(io.out.stderr.length, 1);
    const warning = JSON.parse(io.out.stderr[0]);
    assert.equal(warning.warning.code, 'INPUT_OUTSIDE_PROJECT');
    assert.equal(lastJson(io).mode, 'dry-run');
    // Inside-root input: no warning at all.
    fs.writeFileSync(path.join(dir, 'in.json'),
      JSON.stringify({ text: 'lesson' }));
    const io2 = fakeIO();
    assert.equal(await run(
      ['memory', 'add', '--project', dir, '--log', 'lessons',
        '--input', path.join(dir, 'in.json')], io2), 0);
    assert.deepEqual(io2.out.stderr, []);
    // Failure path: the error owns stderr, no warning noise before it.
    fs.writeFileSync(outside, '{broken');
    const io3 = fakeIO();
    assert.equal(await run(
      ['memory', 'add', '--project', dir, '--log', 'lessons',
        '--input', outside], io3), 1);
    assert.equal(io3.out.stderr.length, 1);
    assert.equal(errPayload(io3).error.code, 'MALFORMED_JSON');
  } finally { cleanup(dir); cleanup(outside); }
});

// ---------- 5. explicit session dispatch ----------

test('session subcommands still route; unknown commands fail closed', async () => {
  const { dir } = enrolled();
  try {
    const io = fakeIO();
    const code = await run(['session', 'show', 'x', '--project', dir], io);
    assert.equal(code, 1);
    assert.match(errPayload(io).error.code, /NOT_FOUND|INVALID/);
    const bad = fakeIO();
    assert.equal(await run(['frobnicate', 'x'], bad), 1);
    assert.equal(errPayload(bad).error.code, 'INVALID_ARGS');
  } finally { cleanup(dir); }
});

// ---------- 6/8. context --structure-debounce ----------

test('context --structure-debounce serves the bounded status cache', async () => {
  const { dir } = enrolled();
  try {
    const first = await call(
      ['context', '--project', dir, '--structure-debounce', '60000',
        '--no-vantadb']);
    assert.equal(first.code, 0);
    assert.ok(fs.existsSync(path.join(dir,
      '.scopegrain', 'state', 'cache', 'structure-status.json')));
    const second = await call(
      ['context', '--project', dir, '--structure-debounce', '60000',
        '--no-vantadb']);
    assert.equal(second.code, 0);
    assert.equal(second.output.structure.cached, true);
  } finally { cleanup(dir); }
});

// ---------- 7. view port fallback ----------

test('view walks to the next free port; explicit --port fails fast', async () => {
  const { dir } = bootstrappedMiniCtx();
  const io1 = fakeIO();
  const io2 = fakeIO();
  try {
    assert.equal(await run(['view', '--project', dir], io1), 0);
    const first = lastJson(io1);
    assert.equal(await run(['view', '--project', dir], io2), 0);
    const second = lastJson(io2);
    assert.equal(second.port, first.port + 1);
    const io3 = fakeIO();
    assert.equal(await run(
      ['view', '--project', dir, '--port', String(first.port)], io3), 1);
    assert.equal(io3.viewServer, undefined);
    const io4 = fakeIO();
    assert.equal(await run(
      ['view', '--project', dir, '--port', 'abc'], io4), 1);
    assert.equal(errPayload(io4).error.code, 'INVALID_ARGS');
  } finally {
    if (io1.viewServer) await io1.viewServer.close();
    if (io2.viewServer) await io2.viewServer.close();
    cleanup(dir);
  }
});

// ---------- help surface reflects the audit fixes ----------

test('--help usages cover the new flags and log names', async () => {
  const io = fakeIO();
  assert.equal(await run(['--help'], io), 0);
  const usages = lastJson(io).commands.map((c) => c.command);
  for (const u of [
    'memory list --project PATH --log lessons|outcomes|progress|goals|activity [--tail N]',
    'context --project PATH [--tail N] [--no-vantadb] [--no-structure] [--structure-debounce MS] [--timeout MS]',
    'dist bundle-uninstall --project PATH ID [--keep-files] [--apply]',
    'dist extension-remove --project PATH ID [--apply]',
    'dist preset-remove --project PATH ID [--apply]',
  ]) {
    assert.ok(usages.includes(u), `missing usage: ${u}`);
  }
  const notes = lastJson(io).notes.join('\n');
  assert.match(notes, /sync-persona/);
  assert.match(notes, /INPUT_OUTSIDE_PROJECT/);
});
