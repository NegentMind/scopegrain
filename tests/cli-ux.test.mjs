// SPDX-License-Identifier: Apache-2.0
// UX surface fixes: per-command help, GNU flag forms, --project
// autodetection, INVALID_ARGS exit code, --fields/--compact projection,
// wizard prompts on stderr.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/cli.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { prepareWorkspace } from '../src/core/workspaces.mjs';
import {
  bootstrappedMiniCtx, cleanup, fakeIO, makeTempDir,
} from './helpers.mjs';

const lastJson = (io) => JSON.parse(io.out.stdout[io.out.stdout.length - 1]);
const errPayload = (io) => JSON.parse(io.out.stderr[io.out.stderr.length - 1]);

function enrolled() {
  const { dir, ctx } = bootstrappedMiniCtx();
  const ws = prepareWorkspace(ctx, { areas: [{ key: 'p', name: 'P' }] });
  applyPlan(dir, [ws.file]);
  return { dir, ctx: resolveContext({ project: dir }) };
}

// cwd outside any project tree (os tmp, never the repo): autodetection
// must find no marker so the legacy missing-flag error is preserved.
function outsideDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ux-outside-'));
}

async function chdir(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try { return await fn(); } finally { process.chdir(prev); }
}

test('per-command --help and -h print the command entry', async () => {
  for (const args of [
    ['task', 'list', '--help'], ['task', 'show', '-h'],
    ['init', '--help'], ['context', '-h'],
  ]) {
    const io = fakeIO();
    assert.equal(await run(args, io), 0, JSON.stringify(args));
    const help = lastJson(io);
    assert.equal(help.command, args.slice(0, args[0] === 'task' ? 2 : 1).join(' '));
    assert.match(help.usage, /^scopegrain /);
    assert.ok(Array.isArray(help.flags));
    assert.equal(typeof help.description, 'string');
    assert.notEqual(help.description, help.command);
    assert.deepEqual(io.out.stderr, []);
  }
  // Unknown command + --help falls back to the global table.
  const io = fakeIO();
  assert.equal(await run(['frobnicate', '--help'], io), 0);
  assert.ok(Array.isArray(lastJson(io).commands));
});

test('global help carries real family descriptions, not echo names', async () => {
  const io = fakeIO();
  assert.equal(await run(['--help'], io), 0);
  const help = lastJson(io);
  const byUsage = new Map(help.commands.map((c) => [c.command, c.description]));
  assert.equal(
    byUsage.get('task list --project PATH [--backlog NAME]'),
    'task lifecycle records (create, meta, transition, gate...)');
  for (const c of help.commands) {
    assert.ok(c.description && c.description.length > 0);
    assert.notEqual(c.description, c.command.split(' ')[0]);
  }
});

test('GNU --flag=value and the -- separator', async () => {
  const { dir } = enrolled();
  try {
    const io = fakeIO();
    assert.equal(await run(
      ['task', 'list', `--project=${dir}`], io), 0);
    assert.ok(Array.isArray(lastJson(io).tasks));
    // -- ends flag parsing: --apply lands in positionals.
    const sep = fakeIO();
    assert.equal(await run(
      ['task', 'list', '--project', dir, '--', '--apply'], sep), 2);
    assert.equal(errPayload(sep).error.code, 'INVALID_ARGS');
    // A boolean flag never takes a value.
    const bv = fakeIO();
    assert.equal(await run(
      ['task', 'list', '--project', dir, '--apply=x'], bv), 2);
    assert.equal(errPayload(bv).error.code, 'INVALID_ARGS');
    assert.match(errPayload(bv).error.message, /does not take a value/);
    // Unknown and rejected flags keep failing in the = form.
    for (const a of ['--bogus=x', '--yes=true']) {
      const e = fakeIO();
      assert.equal(await run(
        ['task', 'list', '--project', dir, a], e), 2, a);
      assert.equal(errPayload(e).error.code, 'INVALID_ARGS');
    }
  } finally { cleanup(dir); }
});

test('--project autodetects upward; explicit flag wins; init stays explicit', async () => {
  const { dir } = enrolled();
  const nested = path.join(dir, 'deep', 'nest');
  try {
    fs.mkdirSync(nested, { recursive: true });
    await chdir(nested, async () => {
      const io = fakeIO();
      assert.equal(await run(['task', 'list'], io), 0);
      assert.ok(Array.isArray(lastJson(io).tasks));
      // init names the directory to initialize — never inferred.
      const ioInit = fakeIO({ tty: false });
      assert.equal(await run(['init'], ioInit), 2);
      assert.equal(errPayload(ioInit).error.code, 'INVALID_ARGS');
      // Explicit --project always wins over the detected ancestor.
      const other = outsideDir();
      try {
        const io2 = fakeIO();
        assert.equal(await run(['inspect', '--project', other], io2), 0);
      } finally { cleanup(other); }
    });
  } finally { cleanup(dir); }
});

test('without any ancestor config the error is the legacy INVALID_ARGS', async () => {
  const dir = outsideDir();
  try {
    await chdir(dir, async () => {
      const io = fakeIO();
      assert.equal(await run(['task', 'list'], io), 2);
      assert.equal(errPayload(io).error.code, 'INVALID_ARGS');
      assert.match(errPayload(io).error.message, /--project is required/);
    });
  } finally { cleanup(dir); }
});

test('usage errors exit 2; other failures stay at exit 1', async () => {
  const { dir } = enrolled();
  try {
    for (const args of [
      ['frobnicate'],
      ['task', 'list', '--project', dir, '--apply'],
      ['task', 'show', '--project', dir],
      ['inspect', '--project', '--config'],
    ]) {
      const io = fakeIO();
      assert.equal(await run(args, io), 2, JSON.stringify(args));
      assert.equal(errPayload(io).error.code, 'INVALID_ARGS');
    }
    const io = fakeIO();
    assert.equal(await run(
      ['task', 'show', '--project', dir,
        '00000000-0000-4000-8000-000000000000'], io), 1);
    assert.match(errPayload(io).error.code, /NOT_FOUND|INVALID/);
  } finally { cleanup(dir); }
});

test('context honors --fields top-level projection and --compact', async () => {
  const { dir } = enrolled();
  try {
    const io = fakeIO();
    assert.equal(await run(
      ['context', '--project', dir, '--no-vantadb',
        '--fields', 'project,methodology'], io), 0);
    const out = lastJson(io);
    assert.deepEqual(Object.keys(out).sort(),
      ['methodology', 'project']);
    // --compact emits a single-line JSON document.
    const io2 = fakeIO();
    assert.equal(await run(
      ['context', '--project', dir, '--no-vantadb', '--compact'], io2), 0);
    const raw = io2.out.stdout.at(-1);
    assert.ok(!raw.includes('\n'));
    assert.equal(JSON.parse(raw).schemaVersion, 1);
    // Flags are whitelisted per command: --fields/--compact are packet
    // projections, not global modifiers.
    const bad = fakeIO();
    assert.equal(await run(
      ['task', 'list', '--project', dir, '--compact'], bad), 2);
    assert.equal(errPayload(bad).error.code, 'INVALID_ARGS');
  } finally { cleanup(dir); }
});

test('dist registry verbs mutate immediately (documented exception)', async () => {
  const { dir } = enrolled();
  const input = `${dir}-ext.json`;
  try {
    fs.writeFileSync(input, JSON.stringify({
      id: 'ext-1', version: '1.0.0', contributes: [],
    }));
    const io = fakeIO();
    assert.equal(await run(
      ['dist', 'extension-register', '--project', dir,
        '--input', input], io), 0);
    // No --apply needed: register is a bounded local-registry append
    // (CONFLICT on duplicates), not a file-tree mutation.
    const io2 = fakeIO();
    assert.equal(await run(
      ['dist', 'extension-list', '--project', dir], io2), 0);
    assert.equal(lastJson(io2).extensions[0].state, 'registered');
    const io3 = fakeIO();
    assert.equal(await run(
      ['dist', 'extension-activate', '--project', dir, 'ext-1'], io3), 0);
    assert.equal(lastJson(io3).state, 'active');
  } finally { cleanup(dir); cleanup(input); }
});
