// SPDX-License-Identifier: Apache-2.0
// FIND-001..003/028/034 coverage: localized task-doc headers and wizard
// prompts honor config.locale, generated templates declare the language
// policy, mutating verbs preview unless --apply, and help documents the
// intake.mode config key.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli.mjs';
import { renderTaskDoc, writeTaskDoc } from '../src/core/taskdoc.mjs';
import { createTask, getTask } from '../src/core/tasks.mjs';
import {
  bootstrappedMiniCtx, cleanup, fakeIO, makeTempDir, writeJson,
  DEFAULT_ANSWERS, withEnv,
} from './helpers.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const MINI_TASK = {
  id: '11111111-2222-4333-8444-555555555555',
  title: 'sample task',
  state: 'PLAN',
  revision: 0,
  schemaVersion: 1,
  contract: 'do the thing',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  history: [{ at: '2026-01-01T00:00:00.000Z', event: 'created',
    state: 'PLAN', revision: 0 }],
};

// FIND-003 — taskdoc structural headers follow locale; record stays EN.
test('renderTaskDoc localizes structural headers, falls back to en', () => {
  const en = renderTaskDoc(MINI_TASK, 'en');
  assert.match(en, /## Contract/);
  assert.match(en, /## History/);
  const es = renderTaskDoc(MINI_TASK, 'es');
  assert.match(es, /## Contrato/);
  assert.match(es, /## Historial/);
  // Structural identity stays English under every locale.
  assert.match(es, /state: PLAN/);
  assert.match(es, /kind: task/);
  // Unknown or missing locale falls back to English headers.
  assert.match(renderTaskDoc(MINI_TASK, 'fr'), /## Contract/);
  assert.match(renderTaskDoc(MINI_TASK), /## Contract/);
});

test('writeTaskDoc renders with the configured project locale', () => {
  const { dir, ctx } = bootstrappedMiniCtx(
    { ...DEFAULT_ANSWERS, locale: 'es' });
  try {
    const task = createTask(ctx, {
      title: 't', contract: 'c', authorContext: 'a', scope: [],
    });
    const { path: docAbs } = writeTaskDoc(ctx, task.id);
    const md = fs.readFileSync(docAbs, 'utf8');
    assert.match(md, /## Contrato/);
    assert.doesNotMatch(md, /## Contract\n/);
  } finally { cleanup(dir); }
  const en = bootstrappedMiniCtx({ ...DEFAULT_ANSWERS, locale: 'en' });
  try {
    const task = createTask(en.ctx, {
      title: 't', contract: 'c', authorContext: 'a', scope: [],
    });
    const { path: docAbs } = writeTaskDoc(en.ctx, task.id);
    assert.match(fs.readFileSync(docAbs, 'utf8'), /## Contract/);
  } finally { cleanup(en.dir); }
});

// FIND-001 — generated templates declare the locale policy.
test('entrypoint and project-instructions templates declare locale policy', () => {
  for (const rel of ['templates/entrypoint.md',
    'templates/project-instructions.md']) {
    const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.match(text, /`locale`/, `${rel} names the project locale key`);
    assert.match(text, /{{configPath}}/, `${rel} keeps the config path var`);
    assert.match(text, /English/,
      `${rel} states canonical instructions stay English`);
  }
});

// FIND-002 — interactive wizard language follows the locale answer.
test('interactive init asks in English when locale answer is en', async () => {
  const dir = makeTempDir('wizard-en');
  try {
    await withEnv({ SCOPEGRAIN_USER_CONFIG: path.join(dir, 'no-user.json') },
      async () => {
        const io = fakeIO({ tty: true,
          replies: { 'Language / Idioma (es/en)': 'en' } });
        assert.equal(await run(['init', '--project', dir], io), 0);
        const labels = io.out.asked.map((a) => a.label);
        assert.ok(labels.includes('Project name'));
        assert.ok(labels.includes('Configuration path'));
        assert.ok(labels.includes('Create these files? (yes/no)'));
        assert.ok(!labels.includes('Nombre del proyecto'));
        assert.ok(!labels.includes('Ruta de configuracion'));
      });
  } finally { cleanup(dir); }
});

test('interactive init keeps Spanish prompts when locale answer is es', async () => {
  const dir = makeTempDir('wizard-es');
  try {
    await withEnv({ SCOPEGRAIN_USER_CONFIG: path.join(dir, 'no-user.json') },
      async () => {
        const io = fakeIO({ tty: true,
          replies: { 'Language / Idioma (es/en)': 'es' } });
        assert.equal(await run(['init', '--project', dir], io), 0);
        const labels = io.out.asked.map((a) => a.label);
        assert.ok(labels.includes('Nombre del proyecto'));
        assert.ok(labels.includes('Ruta de configuracion'));
        assert.ok(labels.includes('Crear estos archivos? (yes/no)'));
        assert.ok(!labels.includes('Project name'));
      });
  } finally { cleanup(dir); }
});

// FIND-028 — mutating verbs preview unless --apply.
test('task create flag form previews; --apply persists', async () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    const io = fakeIO();
    assert.equal(await run(['task', 'create', '--project', dir,
      '--title', 't', '--contract', 'c', '--author', 'a'], io), 0);
    const dry = JSON.parse(io.out.stdout.at(-1));
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.applied, false);
    assert.equal(dry.task.state, 'PLAN');
    const tasksDir = path.join(dir, '.tasksystem', 'tasks');
    assert.equal(fs.readdirSync(tasksDir).length, 0);
    const io2 = fakeIO();
    assert.equal(await run(['task', 'create', '--project', dir,
      '--title', 't', '--contract', 'c', '--author', 'a', '--apply'], io2), 0);
    const applied = JSON.parse(io2.out.stdout.at(-1));
    assert.equal(applied.mode, 'applied');
    assert.ok(getTask(ctx, applied.task.id).id === applied.task.id);
  } finally { cleanup(dir); }
});

test('task note/transition preview the exact record; --apply writes', async () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    const io0 = fakeIO();
    await run(['task', 'create', '--project', dir,
      '--title', 't', '--contract', 'c', '--author', 'a', '--apply'], io0);
    const id = JSON.parse(io0.out.stdout.at(-1)).task.id;
    // note: dry-run shows the record the write would produce, disk stays.
    const io1 = fakeIO();
    await run(['task', 'note', '--project', dir, id,
      '--revision', '0', '--text', 'hi'], io1);
    const dry = JSON.parse(io1.out.stdout.at(-1));
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.task.notes.length, 1);
    assert.equal(getTask(ctx, id).notes?.length ?? 0, 0);
    const io2 = fakeIO();
    await run(['task', 'note', '--project', dir, id,
      '--revision', '0', '--text', 'hi', '--apply'], io2);
    assert.equal(JSON.parse(io2.out.stdout.at(-1)).notes.length, 1);
    assert.equal(getTask(ctx, id).notes.length, 1);
    // transition: dry-run evaluates policy and CAS like the write path.
    const io3 = fakeIO();
    await run(['task', 'transition', '--project', dir, id, 'ACT',
      '--revision', '1'], io3);
    const dryT = JSON.parse(io3.out.stdout.at(-1));
    assert.equal(dryT.mode, 'dry-run');
    assert.equal(dryT.task.state, 'ACT');
    assert.equal(getTask(ctx, id).state, 'PLAN');
    const io4 = fakeIO();
    await run(['task', 'transition', '--project', dir, id, 'ACT',
      '--revision', '1', '--apply'], io4);
    assert.equal(getTask(ctx, id).state, 'ACT');
  } finally { cleanup(dir); }
});

test('goal create and memory add dry-run without --apply', async () => {
  const { dir } = bootstrappedMiniCtx();
  try {
    writeJson(dir, 'goal.json', { title: 'ship it' });
    const io = fakeIO();
    await run(['goal', 'create', '--project', dir,
      '--input', path.join(dir, 'goal.json')], io);
    const dry = JSON.parse(io.out.stdout.at(-1));
    assert.equal(dry.mode, 'dry-run');
    const io2 = fakeIO();
    await run(['goal', 'list', '--project', dir], io2);
    assert.equal(JSON.parse(io2.out.stdout.at(-1)).goals.length, 0);
    const io3 = fakeIO();
    await run(['goal', 'create', '--project', dir,
      '--input', path.join(dir, 'goal.json'), '--apply'], io3);
    const io4 = fakeIO();
    await run(['goal', 'list', '--project', dir], io4);
    assert.equal(JSON.parse(io4.out.stdout.at(-1)).goals.length, 1);
    writeJson(dir, 'lesson.json', { text: 'learned' });
    const io5 = fakeIO();
    await run(['memory', 'add', '--project', dir, '--log', 'lessons',
      '--input', path.join(dir, 'lesson.json')], io5);
    assert.equal(JSON.parse(io5.out.stdout.at(-1)).mode, 'dry-run');
    const lessonsAbs = path.join(dir, '.tasksystem', 'memory',
      'lessons.jsonl');
    assert.equal(fs.existsSync(lessonsAbs), false);
    const io6 = fakeIO();
    await run(['memory', 'add', '--project', dir, '--log', 'lessons',
      '--input', path.join(dir, 'lesson.json'), '--apply'], io6);
    assert.equal(fs.existsSync(lessonsAbs), true);
  } finally { cleanup(dir); }
});

test('journal compact and vantadb sync are dry-run by default', async () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    // journal verbs bind a workspace; enroll a minimal one first.
    const { prepareWorkspace } = await import('../src/core/workspaces.mjs');
    const { applyPlan } = await import('../src/core/bootstrap.mjs');
    const workspace = prepareWorkspace(ctx, {
      areas: [{ key: 'alpha', name: 'Alpha' }] });
    applyPlan(dir, [workspace.file]);
    const io = fakeIO();
    await run(['journal', 'compact', '--project', dir], io);
    const dry = JSON.parse(io.out.stdout.at(-1));
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.plan.pendingOperations, 0);
    const ioA = fakeIO();
    await run(['journal', 'compact', '--project', dir, '--apply'], ioA);
    assert.equal(JSON.parse(ioA.out.stdout.at(-1)).mode, 'applied');
    // vantadb verbs gate too; unenrolled/unworkspaced projects still fail
    // closed with an error before any sync happens.
    const io2 = fakeIO();
    const code = await run(['vantadb', 'sync', '--project', dir], io2);
    assert.equal(code, 1);
    const payload = JSON.parse(io2.out.stderr.at(-1));
    assert.equal(typeof payload.error.code, 'string');
  } finally { cleanup(dir); }
});

// FIND-034 — help output documents intake.mode and the gating matrix.
test('help notes document intake.mode and --apply gating', async () => {
  const io = fakeIO();
  assert.equal(await run(['--help'], io), 0);
  const help = JSON.parse(io.out.stdout.at(-1));
  const notes = help.notes.join('\n');
  assert.match(notes, /intake\.mode \(off\|capture\|suggest\|auto\)/);
  assert.match(notes, /dry-run/);
  assert.match(notes, /--apply/);
});
