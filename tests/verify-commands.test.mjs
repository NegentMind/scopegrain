// Supervised verification commands (debt B6): store contract, CLI
// preview/apply surface and the bounded, approval-gated executor.
// Nothing is auto-approved and nothing is auto-executed; `verify run`
// is the only executor and it refuses every unapproved record.
import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/cli.mjs';
import {
  applyAddCommand, applyApproveCommand, parseCommandArgv,
  runVerifyCommand, verifyStoreRel,
} from '../src/core/verify-commands.mjs';
import {
  bootstrappedCtx, cleanup, exists, fakeIO, readJson, writeFile,
  writeJson,
} from './helpers.mjs';

const lastJson = (io) => JSON.parse(io.out.stdout[io.out.stdout.length - 1]);
const lastErr = (io) => JSON.parse(io.out.stderr[io.out.stderr.length - 1]).error;

// --- literal argv parsing --------------------------------------------------

test('parseCommandArgv accepts bare executable plus literal args', () => {
  assert.deepEqual(parseCommandArgv('npm test'), ['npm', 'test']);
  assert.deepEqual(parseCommandArgv('  node   scripts/check.mjs '),
    ['node', 'scripts/check.mjs']);
  assert.deepEqual(
    parseCommandArgv('node --test tests/verify-commands.test.mjs'),
    ['node', '--test', 'tests/verify-commands.test.mjs']);
});

test('parseCommandArgv rejects shell syntax and path escapes', () => {
  for (const bad of [
    '',
    'npm test && rm -rf .',
    'npm test > out.txt',
    'npm test | cat',
    'npm test; rm x',
    'echo $(whoami)',
    'echo `id`',
    'node -e "process.exit(1)"',
    "node -e 'x'",
    'node ../outside.js',
    'node a/../b.js',
    'node /abs/script.js',
    'node C:/tools/x.js',
    'C:\\tools\\x.exe run',
    './local-bin run',
    'npm.cmd test',
    'helper.bat run',
    'check.ps1',
    'npm test ~',
    'npm test *.js',
  ]) {
    assert.throws(() => parseCommandArgv(bad),
      (e) => e.code === 'INVALID_VERIFY_COMMAND', `expected reject: ${bad}`);
  }
});

// --- store + CLI surface ---------------------------------------------------

test('verify list is empty on a fresh project', async () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const io = fakeIO();
    assert.equal(await run(['verify', 'list', '--project', dir], io), 0);
    const out = lastJson(io);
    assert.equal(out.store, verifyStoreRel(ctx));
    assert.deepEqual(out.commands, []);
  } finally { cleanup(dir); }
});

test('verify add previews first; --apply writes an unapproved record', async () => {
  const { dir, ctx } = bootstrappedCtx();
  const rel = verifyStoreRel(ctx);
  try {
    const io = fakeIO();
    assert.equal(await run(['verify', 'add', '--project', dir,
      '--command', 'node scripts/check.mjs'], io), 0);
    const dry = lastJson(io);
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.applied, false);
    assert.equal(dry.record.source, 'declared');
    assert.equal(dry.record.approved, false);
    assert.equal(dry.record.approvedAt, null);
    assert.match(dry.record.id, /^vc[0-9a-f]{12}$/);
    assert.match(dry.record.fingerprint, /^[0-9a-f]{64}$/);
    assert.deepEqual(dry.record.argv, ['node', 'scripts/check.mjs']);
    assert.equal(dry.file.action, 'create');
    assert.ok(!exists(dir, rel), 'dry-run must not write the store');

    const io2 = fakeIO();
    assert.equal(await run(['verify', 'add', '--project', dir,
      '--command', 'node scripts/check.mjs', '--apply'], io2), 0);
    const applied = lastJson(io2);
    assert.equal(applied.mode, 'applied');
    assert.equal(applied.added, true);
    assert.ok(exists(dir, rel));
    const stored = readJson(dir, rel);
    assert.equal(stored.schemaVersion, 1);
    assert.equal(stored.commands.length, 1);
    assert.equal(stored.commands[0].approved, false);
  } finally { cleanup(dir); }
});

test('verify add is idempotent: the same command+cwd is not duplicated', async () => {
  const { dir } = bootstrappedCtx();
  try {
    for (const args of [
      ['verify', 'add', '--project', dir, '--command', 'npm test', '--apply'],
      ['verify', 'add', '--project', dir, '--command', 'npm  test', '--apply'],
    ]) {
      const io = fakeIO();
      assert.equal(await run(args, io), 0);
    }
    const io = fakeIO();
    await run(['verify', 'list', '--project', dir], io);
    assert.equal(lastJson(io).commands.length, 1);
  } finally { cleanup(dir); }
});

test('verify add rejects invalid commands and requires --command', async () => {
  const { dir } = bootstrappedCtx();
  try {
    const io = fakeIO();
    assert.equal(await run(
      ['verify', 'add', '--project', dir], io), 1);
    assert.equal(lastErr(io).code, 'INVALID_ARGS');
    const io2 = fakeIO();
    assert.equal(await run(['verify', 'add', '--project', dir,
      '--command', 'npm test && rm -rf .', '--apply'], io2), 1);
    assert.equal(lastErr(io2).code, 'INVALID_VERIFY_COMMAND');
    assert.ok(!exists(dir, '.tasksystem/state/verify-commands.json'));
  } finally { cleanup(dir); }
});

test('verify run refuses unapproved commands; approve is preview+apply', async () => {
  const { dir, ctx } = bootstrappedCtx();
  const rel = verifyStoreRel(ctx);
  try {
    writeFile(dir, 'scripts/check.mjs',
      "console.log('vc-ok'); process.exitCode = 7;\n");
    const add = applyAddCommand(ctx, { command: 'node scripts/check.mjs' });
    const id = add.record.id;

    const ioRun = fakeIO();
    assert.equal(await run(['verify', 'run', '--project', dir, id], ioRun), 1);
    assert.equal(lastErr(ioRun).code, 'VERIFY_COMMAND_NOT_APPROVED');

    const ioDry = fakeIO();
    assert.equal(await run(['verify', 'approve', '--project', dir, id], ioDry), 0);
    const dry = lastJson(ioDry);
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.record.approved, true);
    assert.equal(readJson(dir, rel).commands[0].approved, false,
      'approve dry-run must not persist');

    const ioApply = fakeIO();
    assert.equal(await run(
      ['verify', 'approve', '--project', dir, id, '--apply'], ioApply), 0);
    const applied = lastJson(ioApply);
    assert.equal(applied.mode, 'applied');
    assert.equal(applied.record.approved, true);
    assert.equal(typeof applied.record.approvedAt, 'string');
    assert.equal(readJson(dir, rel).commands[0].approved, true);

    const ioRun2 = fakeIO();
    assert.equal(await run(['verify', 'run', '--project', dir, id], ioRun2), 0);
    const result = lastJson(ioRun2);
    assert.equal(result.status, 'exit');
    assert.equal(result.code, 7);
    assert.ok(result.stdout.includes('vc-ok'));
    assert.equal(result.truncated, false);
    assert.equal(typeof result.durationMs, 'number');
  } finally { cleanup(dir); }
});

test('verify run/approve report unknown ids with structured errors', async () => {
  const { dir } = bootstrappedCtx();
  try {
    const io = fakeIO();
    assert.equal(await run(
      ['verify', 'run', '--project', dir, 'vc000000000000'], io), 1);
    assert.equal(lastErr(io).code, 'VERIFY_COMMAND_NOT_FOUND');
    const io2 = fakeIO();
    assert.equal(await run(
      ['verify', 'approve', '--project', dir, 'vc000000000000', '--apply'],
      io2), 1);
    assert.equal(lastErr(io2).code, 'VERIFY_COMMAND_NOT_FOUND');
    const io3 = fakeIO();
    assert.equal(await run(
      ['verify', 'run', '--project', dir, 'not-an-id'], io3), 1);
    assert.equal(lastErr(io3).code, 'INVALID_ID');
  } finally { cleanup(dir); }
});

test('stored bytes are tamper-evident: edits are reported, never honored', async () => {
  const { dir, ctx } = bootstrappedCtx();
  const rel = verifyStoreRel(ctx);
  try {
    const add = applyAddCommand(ctx, { command: 'node scripts/check.mjs' });
    writeJson(dir, rel, { schemaVersion: 1, commands: [{ bogus: 1 }] });
    const io = fakeIO();
    assert.equal(await run(['verify', 'list', '--project', dir], io), 1);
    assert.equal(lastErr(io).code, 'VERIFY_STORE_MALFORMED');

    // Flipping approved on disk without approve+approvedAt is incoherent.
    const doc = {
      schemaVersion: 1,
      commands: [{ ...add.record, approved: true }],
    };
    writeJson(dir, rel, doc);
    const io2 = fakeIO();
    assert.equal(await run(
      ['verify', 'run', '--project', dir, add.record.id], io2), 1);
    assert.equal(lastErr(io2).code, 'VERIFY_STORE_MALFORMED');
  } finally { cleanup(dir); }
});

test('verify discover stores inferred candidates, never approved', async () => {
  const { dir, ctx } = bootstrappedCtx();
  const rel = verifyStoreRel(ctx);
  try {
    writeJson(dir, 'package.json', {
      name: 'fixture', packageManager: 'npm@10.0.0',
      scripts: { test: 'echo t', lint: 'echo l' },
    });
    const io = fakeIO();
    assert.equal(await run(['verify', 'discover', '--project', dir], io), 0);
    const dry = lastJson(io);
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.candidates.length, 2);
    for (const c of dry.candidates) {
      assert.equal(c.source, 'inferred');
      assert.equal(c.approved, false);
      assert.equal(c.evidence, 'package.json');
    }
    assert.ok(!exists(dir, rel));

    const io2 = fakeIO();
    assert.equal(await run(
      ['verify', 'discover', '--project', dir, '--apply'], io2), 0);
    const applied = lastJson(io2);
    assert.equal(applied.added.length, 2);
    const stored = readJson(dir, rel);
    assert.equal(stored.commands.length, 2);
    const inferred = stored.commands[0];
    assert.equal(inferred.source, 'inferred');
    assert.equal(inferred.approved, false);

    const ioRun = fakeIO();
    assert.equal(await run(
      ['verify', 'run', '--project', dir, inferred.id], ioRun), 1);
    assert.equal(lastErr(ioRun).code, 'VERIFY_COMMAND_NOT_APPROVED');

    // Second discovery is a no-op: nothing duplicated.
    const io3 = fakeIO();
    assert.equal(await run(
      ['verify', 'discover', '--project', dir, '--apply'], io3), 0);
    assert.equal(lastJson(io3).added.length, 0);
    assert.equal(lastJson(io3).existing.length, 2);
  } finally { cleanup(dir); }
});

test('ambiguous package managers produce skipped candidates, not commands', async () => {
  const { dir } = bootstrappedCtx();
  try {
    writeJson(dir, 'package.json', {
      name: 'fixture', scripts: { test: 'echo t' },
    });
    const io = fakeIO();
    assert.equal(await run(
      ['verify', 'discover', '--project', dir, '--apply'], io), 0);
    const out = lastJson(io);
    assert.equal(out.added.length, 0);
    assert.equal(out.skipped.length, 1);
    assert.equal(out.skipped[0].reason, 'unresolved-command');
  } finally { cleanup(dir); }
});

// --- bounded executor ------------------------------------------------------

test('runVerifyCommand enforces the timeout budget', async () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    writeFile(dir, 'scripts/slow.mjs', 'setTimeout(() => {}, 30000);\n');
    const { record } = applyAddCommand(
      ctx, { command: 'node scripts/slow.mjs' });
    applyApproveCommand(ctx, record.id);
    const result = await runVerifyCommand(ctx, record.id, { timeoutMs: 300 });
    assert.equal(result.status, 'timeout');
  } finally { cleanup(dir); }
});

test('runVerifyCommand bounds captured output', async () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    writeFile(dir, 'scripts/loud.mjs',
      'process.stdout.write("x".repeat(65536));\n');
    const { record } = applyAddCommand(
      ctx, { command: 'node scripts/loud.mjs' });
    applyApproveCommand(ctx, record.id);
    const result = await runVerifyCommand(
      ctx, record.id, { maxOutputBytes: 1024 });
    assert.equal(result.status, 'exit');
    assert.equal(result.code, 0);
    assert.equal(result.truncated, true);
    assert.ok(result.stdout.length <= 1024);
  } finally { cleanup(dir); }
});

test('unresolvable executables fail with a structured error', async () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { record } = applyAddCommand(ctx,
      { command: 'scopegrain-definitely-missing-exe run' });
    applyApproveCommand(ctx, record.id);
    await assert.rejects(
      runVerifyCommand(ctx, record.id),
      (e) => e.code === 'VERIFY_EXEC_FAILED'
        || e.code === 'VERIFY_EXEC_REJECTED');
  } finally { cleanup(dir); }
});

test('approved commands with missing cwd are refused', async () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { record } = applyAddCommand(ctx,
      { command: 'node check.mjs', cwd: 'scripts' });
    applyApproveCommand(ctx, record.id);
    await assert.rejects(runVerifyCommand(ctx, record.id),
      (e) => e.code === 'VERIFY_CWD_REJECTED');
  } finally { cleanup(dir); }
});

test('verify run --fail-on-error propagates non-clean exits; default stays 0', async () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    writeFile(dir, 'scripts/ok.mjs', "console.log('vc-ok');\n");
    writeFile(dir, 'scripts/fail.mjs', "process.exitCode = 7;\n");
    writeFile(dir, 'scripts/slow.mjs', 'setTimeout(() => {}, 30000);\n');
    const ids = {};
    for (const [key, command] of Object.entries({
      ok: 'node scripts/ok.mjs',
      fail: 'node scripts/fail.mjs',
      slow: 'node scripts/slow.mjs',
    })) {
      const { record } = applyAddCommand(ctx, { command });
      applyApproveCommand(ctx, record.id);
      ids[key] = record.id;
    }

    // Default contract unchanged: failing run prints JSON, exits 0.
    const ioDef = fakeIO();
    assert.equal(await run(
      ['verify', 'run', '--project', dir, ids.fail], ioDef), 0);
    assert.equal(lastJson(ioDef).code, 7);

    // Clean exit-0 stays 0 even with the flag.
    const ioOk = fakeIO();
    assert.equal(await run(['verify', 'run', '--project', dir, ids.ok,
      '--fail-on-error'], ioOk), 0);
    assert.equal(lastJson(ioOk).status, 'exit');

    // Non-zero child code propagates verbatim; result JSON still on stdout.
    const ioFail = fakeIO();
    assert.equal(await run(['verify', 'run', '--project', dir, ids.fail,
      '--fail-on-error'], ioFail), 7);
    const failJson = lastJson(ioFail);
    assert.equal(failJson.status, 'exit');
    assert.equal(failJson.code, 7);

    // Timeout has no reliable child code: maps to 1, status stays 'timeout'.
    const ioSlow = fakeIO();
    assert.equal(await run(['verify', 'run', '--project', dir, ids.slow,
      '--timeout', '300', '--fail-on-error'], ioSlow), 1);
    assert.equal(lastJson(ioSlow).status, 'timeout');

    // The flag belongs to verify run only.
    const ioBad = fakeIO();
    assert.equal(await run(['verify', 'list', '--project', dir,
      '--fail-on-error'], ioBad), 1);
    assert.equal(lastErr(ioBad).code, 'INVALID_ARGS');
  } finally { cleanup(dir); }
});

// --- CLI plumbing ----------------------------------------------------------

test('unknown verify subcommands, bad arity and stray flags fail', async () => {
  const { dir } = bootstrappedCtx();
  try {
    const io = fakeIO();
    assert.equal(await run(['verify', 'frobnicate', '--project', dir], io), 1);
    assert.equal(lastErr(io).code, 'INVALID_ARGS');
    const io2 = fakeIO();
    assert.equal(await run(['verify', 'run', '--project', dir], io2), 1);
    assert.equal(lastErr(io2).code, 'INVALID_ARGS');
    const io3 = fakeIO();
    assert.equal(await run(
      ['verify', 'list', '--project', dir, '--timeout', '5'], io3), 1);
    assert.equal(lastErr(io3).code, 'INVALID_ARGS');
  } finally { cleanup(dir); }
});
