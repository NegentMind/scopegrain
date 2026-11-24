// SPDX-License-Identifier: Apache-2.0
// verify PATH pinning (audit C2): approval resolves and stores the
// realpath of argv[0]; run spawns the pin, not whatever PATH resolves
// later. Legacy records without the pin keep resolving on the fly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyAddCommand, applyApproveCommand, listVerifyCommands,
  prepareApproveCommand, runVerifyCommand, verifyStoreRel,
} from '../src/core/verify-commands.mjs';
import {
  bootstrappedMiniCtx, cleanup, readJson, trySymlink, withEnv,
  writeFile, writeJson,
} from './helpers.mjs';

const BARE = 'sgtest-tool';
const EXE_NAME = process.platform === 'win32' ? `${BARE}.exe` : BARE;

function makeExe(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, EXE_NAME);
  try {
    fs.linkSync(process.execPath, dest);
  } catch {
    fs.copyFileSync(process.execPath, dest);
  }
  return dest;
}

const ORIG_PATH = process.env.PATH;
const prepended = (dir) => dir + path.delimiter + ORIG_PATH;

test('approve pins the PATH-resolved realpath into the record', async () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  const binDir = path.join(dir, 'tmpbin-a');
  const exeAbs = makeExe(binDir);
  const pin = fs.realpathSync(exeAbs);
  try {
    writeFile(dir, 'scripts/ok.mjs', "console.log('vc-ok');\n");
    await withEnv({ PATH: prepended(binDir) }, async () => {
      const { record } = applyAddCommand(
        ctx, { command: `${BARE} scripts/ok.mjs` });
      assert.equal(record.exeRealpath, null);
      const preview = prepareApproveCommand(ctx, record.id);
      assert.equal(preview.record.exeRealpath, pin);
      const res = applyApproveCommand(ctx, record.id);
      assert.equal(res.changed, true);
      assert.equal(res.record.exeRealpath, pin);
      const stored = readJson(dir, verifyStoreRel(ctx));
      assert.equal(stored.commands[0].exeRealpath, pin);
      const result = await runVerifyCommand(ctx, record.id);
      assert.equal(result.status, 'exit');
      assert.equal(result.code, 0);
      assert.ok(result.stdout.includes('vc-ok'));
      assert.equal(result.resolvedExe, pin);
    });
  } finally { cleanup(dir); }
});

test('run spawns the pin even when a hostile PATH dir shadows the name', async () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  const dirA = path.join(dir, 'bin-a');
  const dirB = path.join(dir, 'bin-b');
  const exeAbs = makeExe(dirA);
  fs.mkdirSync(dirB, { recursive: true });
  fs.writeFileSync(path.join(dirB, EXE_NAME), 'not an executable\n');
  try {
    writeFile(dir, 'scripts/ok.mjs', "console.log('vc-ok');\n");
    let id;
    await withEnv({ PATH: prepended(dirA) }, async () => {
      id = applyAddCommand(ctx, { command: `${BARE} scripts/ok.mjs` })
        .record.id;
      applyApproveCommand(ctx, id);
    });
    await withEnv({ PATH: prepended(dirB) }, async () => {
      const result = await runVerifyCommand(ctx, id);
      assert.equal(result.status, 'exit');
      assert.equal(result.code, 0);
      assert.ok(result.stdout.includes('vc-ok'));
      assert.equal(result.resolvedExe, fs.realpathSync(exeAbs));
    });
  } finally { cleanup(dir); }
});

test('a vanished pinned executable fails VERIFY_EXEC_PIN_MISSING', async () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  const binDir = path.join(dir, 'tmpbin-gone');
  const exeAbs = makeExe(binDir);
  try {
    writeFile(dir, 'scripts/ok.mjs', "console.log('vc-ok');\n");
    let id;
    await withEnv({ PATH: prepended(binDir) }, async () => {
      id = applyAddCommand(ctx, { command: `${BARE} scripts/ok.mjs` })
        .record.id;
      applyApproveCommand(ctx, id);
    });
    fs.rmSync(exeAbs);
    await assert.rejects(runVerifyCommand(ctx, id),
      (e) => e.code === 'VERIFY_EXEC_PIN_MISSING');
  } finally { cleanup(dir); }
});

test('a pinned path now resolving elsewhere fails VERIFY_EXEC_PIN_CHANGED', async () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  const binDir = path.join(dir, 'tmpbin-swap');
  const exeAbs = makeExe(binDir);
  try {
    writeFile(dir, 'scripts/ok.mjs', "console.log('vc-ok');\n");
    let id;
    await withEnv({ PATH: prepended(binDir) }, async () => {
      id = applyAddCommand(ctx, { command: `${BARE} scripts/ok.mjs` })
        .record.id;
      applyApproveCommand(ctx, id);
    });
    fs.rmSync(exeAbs);
    if (!trySymlink(process.execPath, exeAbs, 'file')) {
      return; // platform cannot fabricate the swap; nothing to detect
    }
    await assert.rejects(runVerifyCommand(ctx, id),
      (e) => e.code === 'VERIFY_EXEC_PIN_CHANGED');
  } finally { cleanup(dir); }
});

test('approved records predating the pin still resolve on the fly', async () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  const rel = verifyStoreRel(ctx);
  try {
    writeFile(dir, 'scripts/ok.mjs', "console.log('vc-ok');\n");
    const { record } = applyAddCommand(
      ctx, { command: 'node scripts/ok.mjs' });
    applyApproveCommand(ctx, record.id);
    const doc = readJson(dir, rel);
    delete doc.commands[0].exeRealpath;
    writeJson(dir, rel, doc);
    const nodeDir = path.dirname(process.execPath);
    await withEnv({ PATH: prepended(nodeDir) }, async () => {
      const result = await runVerifyCommand(ctx, record.id);
      assert.equal(result.status, 'exit');
      assert.equal(result.code, 0);
      assert.ok(result.stdout.includes('vc-ok'));
      assert.equal(result.resolvedExe, 'node');
    });
  } finally { cleanup(dir); }
});

test('re-approving an approved-but-unpinned record backfills the pin', async () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  const binDir = path.join(dir, 'tmpbin-backfill');
  const exeAbs = makeExe(binDir);
  const rel = verifyStoreRel(ctx);
  try {
    writeFile(dir, 'scripts/ok.mjs', "console.log('vc-ok');\n");
    const { record } = applyAddCommand(
      ctx, { command: `${BARE} scripts/ok.mjs` });
    const doc = readJson(dir, rel);
    doc.commands[0].approved = true;
    doc.commands[0].approvedAt = '2026-01-01T00:00:00.000Z';
    delete doc.commands[0].exeRealpath;
    writeJson(dir, rel, doc);
    await withEnv({ PATH: prepended(binDir) }, async () => {
      const res = applyApproveCommand(ctx, record.id);
      assert.equal(res.changed, true);
      assert.equal(res.record.approvedAt, '2026-01-01T00:00:00.000Z');
      assert.equal(res.record.exeRealpath, fs.realpathSync(exeAbs));
      const again = applyApproveCommand(ctx, record.id);
      assert.equal(again.changed, false);
    });
  } finally { cleanup(dir); }
});

test('exeRealpath must be absent, null or a non-empty string', () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  const rel = verifyStoreRel(ctx);
  try {
    applyAddCommand(ctx, { command: 'node scripts/ok.mjs' });
    for (const bad of [42, '', {}]) {
      const doc = readJson(dir, rel);
      doc.commands[0].exeRealpath = bad;
      writeJson(dir, rel, doc);
      assert.throws(() => listVerifyCommands(ctx),
        (e) => e.code === 'VERIFY_STORE_MALFORMED', `value: ${bad}`);
    }
    const doc = readJson(dir, rel);
    delete doc.commands[0].exeRealpath;
    writeJson(dir, rel, doc);
    assert.equal(listVerifyCommands(ctx).commands.length, 1);
  } finally { cleanup(dir); }
});
