// SPDX-License-Identifier: Apache-2.0
// CLI surface cases: JSON to stdout, errors to stderr, exit codes,
// no implicit writes without --apply or an interactive 'yes'.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/cli.mjs';
import { createConfig, KNOWN_HOSTS } from '../src/core/config.mjs';
import {
  VALID_ANSWERS, cleanup, exists, fakeIO, makeTempDir, readJson, writeJson,
} from './helpers.mjs';

function lastJson(io) {
  return JSON.parse(io.out.stdout[io.out.stdout.length - 1]);
}

function writeAnswers(dir) {
  const f = `${dir}-answers.json`;
  fs.writeFileSync(f, JSON.stringify(VALID_ANSWERS, null, 2));
  return f;
}

test('inspect prints JSON to stdout and writes nothing', async () => {
  const dir = makeTempDir('cli-inspect');
  try {
    writeJson(dir, 'package.json', { name: 'x', scripts: { test: 't' } });
    const io = fakeIO();
    assert.equal(await run(['inspect', '--project', dir], io), 0);
    const out = lastJson(io);
    assert.equal(out.schemaVersion, 1);
    assert.equal(out.stacks[0].name, 'node');
    assert.deepEqual(io.out.stderr, []);
  } finally { cleanup(dir); }
});

test('--version / -v / -V returns package version and -h returns help', async () => {
  for (const flag of ['--version', '-v', '-V']) {
    const io = fakeIO();
    assert.equal(await run([flag], io), 0);
    const out = lastJson(io);
    assert.equal(out.name, 'scopegrain');
    assert.match(out.version, /^\d+\.\d+\.\d+/);
    assert.equal(out.node, process.version);
  }
  const ioH = fakeIO();
  assert.equal(await run(['-h'], ioH), 0);
  assert.ok(lastJson(ioH).commands.length >= 8);
});

test('--help lists commands; unknown commands and flags fail', async () => {
  const io = fakeIO();
  assert.equal(await run(['--help'], io), 0);
  const help = lastJson(io);
  assert.ok(help.commands.length >= 8);
  const io2 = fakeIO();
  assert.equal(await run(['frobnicate'], io2), 2);
  assert.equal(JSON.parse(io2.out.stderr[0]).error.code, 'INVALID_ARGS');
  const io3 = fakeIO();
  // Missing --project still fails when no ancestor .scopegrain/config.json
  // exists (autodetection runs from cwd; os tmp is outside the repo).
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-noproj-'));
  const cwd0 = process.cwd();
  process.chdir(outside);
  try {
    assert.equal(await run(['task', 'list'], io3), 2);
  } finally {
    process.chdir(cwd0);
    fs.rmSync(outside, { recursive: true, force: true });
  }
  assert.equal(JSON.parse(io3.out.stderr[0]).error.code, 'INVALID_ARGS');
  const io4 = fakeIO();
  // Flag that does not belong to the command is rejected.
  assert.equal(await run(['inspect', '--project', 'x', '--apply'], io4), 2);
  const io5 = fakeIO();
  // A flag value must not silently consume the next flag.
  assert.equal(await run(['inspect', '--project', '--config'], io5), 2);
});

test('extra positionals are rejected before any write', async () => {
  const dir = makeTempDir('cli-pos');
  const answersFile = writeAnswers(dir);
  try {
    const io = fakeIO();
    const code = await run(
      ['init', '--project', dir, '--answers', answersFile, 'typo', '--apply'], io);
    assert.equal(code, 2);
    assert.equal(JSON.parse(io.out.stderr[0]).error.code, 'INVALID_ARGS');
    assert.ok(!exists(dir, '.scopegrain/config.json'));
    assert.ok(!exists(dir, 'AGENTS.md'));
  } finally { cleanup(dir); cleanup(answersFile); }
});

test('init --answers without --apply is a dry-run and writes nothing', async () => {
  const dir = makeTempDir('cli-init-dry');
  const answersFile = writeAnswers(dir);
  try {
    const io = fakeIO();
    assert.equal(await run(
      ['init', '--project', dir, '--answers', answersFile], io), 0);
    assert.equal(lastJson(io).mode, 'dry-run');
    assert.ok(!exists(dir, '.scopegrain/config.json'));
    assert.ok(!exists(dir, 'AGENTS.md'));
  } finally { cleanup(dir); cleanup(answersFile); }
});

test('init --answers --apply creates the plan once', async () => {
  const dir = makeTempDir('cli-init-apply');
  const answersFile = writeAnswers(dir);
  try {
    const io = fakeIO();
    assert.equal(await run(
      ['init', '--project', dir, '--answers', answersFile, '--apply'], io), 0);
    const first = lastJson(io);
    assert.equal(first.mode, 'applied');
    assert.equal(first.applied, true);
    assert.ok(exists(dir, '.scopegrain/config.json'));
    assert.ok(exists(dir, 'CLAUDE.md'));
    // A truthful re-init: applied reflects that nothing was written,
    // files lists only writes and counts mirror the update shape.
    const io2 = fakeIO();
    assert.equal(await run(
      ['init', '--project', dir, '--answers', answersFile, '--apply'], io2), 0);
    const second = lastJson(io2);
    assert.equal(second.mode, 'applied');
    assert.equal(second.applied, false);
    assert.equal(second.created, 0);
    assert.deepEqual(second.files, []);
    assert.equal(second.counts.create, 0);
    assert.ok(second.counts.noop > 0);
    assert.equal(second.counts.conflict, 0);
  } finally { cleanup(dir); cleanup(answersFile); }
});

test('init --defaults applies investigation suggestions non-interactively', async () => {
  const dir = makeTempDir('cli-init-defaults');
  try {
    writeJson(dir, 'package.json', { name: 'defaults-probe' });
    fs.mkdirSync(path.join(dir, '.claude'));
    const io = fakeIO(); // no TTY: --defaults short-circuits the prompt loop
    assert.equal(await run(
      ['init', '--project', dir, '--defaults'], io), 0);
    const dry = lastJson(io);
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.answers.name, 'defaults-probe');
    assert.deepEqual(dry.answers.hosts, ['claude']); // detected signal
    assert.equal(dry.answers.methodology, 'organic-sdd');
    assert.equal(dry.answers.paths.state, '.scopegrain/state');
    assert.equal(dry.answers.versioning.plans, false);
    assert.ok(!exists(dir, '.scopegrain/config.json')); // preview writes nothing

    const io2 = fakeIO();
    assert.equal(await run(
      ['init', '--project', dir, '--defaults', '--apply'], io2), 0);
    const applied = lastJson(io2);
    assert.equal(applied.mode, 'applied');
    assert.equal(applied.applied, true);
    assert.ok(applied.created > 0);
    const config = readJson(dir, '.scopegrain/config.json');
    assert.equal(config.project.name, 'defaults-probe');
    assert.deepEqual(config.hosts, ['claude']);
    assert.ok(exists(dir, 'CLAUDE.md'));

    // Re-init on the configured project is the normal noop: the existing
    // config is replayed, never clashing with fresh suggestions.
    const io3 = fakeIO();
    assert.equal(await run(
      ['init', '--project', dir, '--defaults', '--apply'], io3), 0);
    const again = lastJson(io3);
    assert.equal(again.applied, false);
    assert.equal(again.created, 0);
    assert.equal(again.answers.name, 'defaults-probe');
  } finally { cleanup(dir); }
});

test('init --defaults with no signals uses wizard defaults; --answers conflicts', async () => {
  const dir = makeTempDir('cli-init-defaults-empty');
  const answersFile = writeAnswers(dir);
  try {
    const io = fakeIO();
    assert.equal(await run(['init', '--project', dir, '--defaults'], io), 0);
    const dry = lastJson(io);
    // No host signals -> the full interactive default list.
    assert.deepEqual(dry.answers.hosts, [...KNOWN_HOSTS]);
    assert.ok(dry.files.some((f) => f.path === 'AGENTS.md'));
    assert.ok(dry.files.some((f) => f.path === 'CLAUDE.md'));

    const both = fakeIO();
    assert.equal(await run(['init', '--project', dir, '--defaults',
      '--answers', answersFile], both), 2);
    assert.equal(JSON.parse(both.out.stderr[0]).error.code, 'INVALID_ARGS');
    assert.ok(!exists(dir, '.scopegrain/config.json'));
  } finally { cleanup(dir); cleanup(answersFile); }
});

test('init without --answers refuses non-interactive sessions', async () => {
  const dir = makeTempDir('cli-init-notty');
  try {
    const io = fakeIO({ tty: false });
    assert.equal(await run(['init', '--project', dir], io), 1);
    assert.equal(JSON.parse(io.out.stderr[0]).error.code, 'INTERACTIVE_REQUIRED');
    assert.ok(!exists(dir, '.scopegrain/config.json'));
  } finally { cleanup(dir); }
});

test('--yes and --force are rejected explicitly', async () => {
  const dir = makeTempDir('cli-flags');
  try {
    for (const flag of ['--yes', '--force']) {
      const io = fakeIO({ tty: true });
      assert.equal(await run(['init', '--project', dir, flag], io), 2);
      assert.equal(JSON.parse(io.out.stderr[0]).error.code, 'INVALID_ARGS');
    }
  } finally { cleanup(dir); }
});

test('task lifecycle through the CLI', async () => {
  const dir = makeTempDir('cli-task');
  const answersFile = writeAnswers(dir);
  const evidenceFile = `${dir}-evidence.json`;
  try {
    fs.writeFileSync(evidenceFile, JSON.stringify({
      verification: {
        checks: [{ command: 'npm test', cwd: '.', status: 'pass', evidence: 'x' }],
      },
      review: {
        mode: 'fresh', reviewer: 'r', authorContext: 'ctx-a',
        reviewerContext: 'ctx-b', verdict: 'approve',
      },
    }));
    const io = fakeIO();
    await run(['init', '--project', dir, '--answers', answersFile, '--apply'], io);
    const ioC = fakeIO();
    await run(['task', 'create', '--project', dir, '--title', 'T',
      '--contract', 'C', '--author', 'ctx-a', '--scope', 'src/x',
      '--apply'], ioC);
    const created = lastJson(ioC);
    const task = created.task ?? created;
    assert.equal(task.state, 'PLAN');
    const ioL = fakeIO();
    await run(['task', 'list', '--project', dir], ioL);
    assert.equal(lastJson(ioL).tasks.length, 1);
    const ioS = fakeIO();
    await run(['task', 'show', '--project', dir, task.id], ioS);
    assert.equal(lastJson(ioS).id, task.id);
    const ioT = fakeIO();
    await run(['task', 'transition', '--project', dir, task.id, 'ACT',
      '--revision', '0', '--apply'], ioT);
    const transitioned = lastJson(ioT);
    assert.equal((transitioned.task ?? transitioned).state, 'ACT');
    const ioBad = fakeIO();
    const code = await run(['task', 'transition', '--project', dir, task.id,
      'ACCEPT', '--revision', '1'], ioBad);
    assert.equal(code, 1);
    assert.equal(JSON.parse(ioBad.out.stderr[0]).error.code, 'INVALID_TRANSITION');
    const ioE = fakeIO();
    assert.equal(await run(['task', 'transition', '--project', dir, task.id,
      'VERIFY', '--revision', '1', '--evidence', evidenceFile,
      '--apply'], ioE), 0);
    const verified = lastJson(ioE);
    assert.equal((verified.task ?? verified).state, 'VERIFY');
    const ioCE = fakeIO();
    const badEvidence = `${dir}-bad.json`;
    fs.writeFileSync(badEvidence, JSON.stringify({ verification: {}, unknown: 1 }));
    await run(['task', 'transition', '--project', dir, task.id, 'EVALUATE',
      '--revision', '2', '--evidence', badEvidence], ioCE);
    assert.equal(JSON.parse(ioCE.out.stderr[0]).error.code, 'INVALID_EVIDENCE');
    cleanup(badEvidence);
  } finally { cleanup(dir); cleanup(answersFile); cleanup(evidenceFile); }
});

test('doctor reports needs-attention before bootstrap files exist', async () => {
  const dir = makeTempDir('cli-doctor');
  try {
    writeJson(dir, '.scopegrain/config.json',
      createConfig(dir, VALID_ANSWERS, { fingerprint: 'x', stacks: [], evidence: [] }));
    const io = fakeIO();
    assert.equal(await run(['doctor', '--project', dir], io), 0);
    const out = lastJson(io);
    assert.equal(out.status, 'needs-attention');
    assert.equal(out.changedDiscovery, true);
  } finally { cleanup(dir); }
});
