// activity record + hooks: retroactive registration of out-of-loop work.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createConfig } from '../src/core/config.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeJson, fakeIO,
} from './helpers.mjs';
import { run } from '../src/cli.mjs';
import {
  recordActivity, normalizeActivityInput,
} from '../src/core/activity.mjs';
import {
  gitHooksDir, installHooks, uninstallHooks, planHooks,
} from '../src/core/hooks.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { appendWorklog, readWorklog } from '../src/core/worklog.mjs';
import { getTask } from '../src/core/tasks.mjs';

function fixture(methodology = 'manual') {
  const dir = makeTempDir('activity');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, { ...VALID_ANSWERS, methodology }, {}));
  fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
  return { dir, ctx: resolveContext({ project: dir }) };
}

test('hooks install refuses a .git gitdir pointer escaping the project', () => {
  const dir = makeTempDir('activity-gitdir');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, { ...VALID_ANSWERS }, {}));
  // A crafted pointer must not redirect hook writes outside the root.
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: ../../elsewhere\n');
  const ctx = resolveContext({ project: dir });
  try {
    assert.throws(() => gitHooksDir(ctx), (e) => e.code === 'INVALID_PATH');
    assert.throws(() => installHooks(ctx, { binAbs: '/x/bin.mjs' }),
      (e) => e.code === 'INVALID_PATH');
  } finally { cleanup(dir); }
});

test('hook block single-quotes interpolated paths (shell injection guard)', () => {
  const { dir, ctx } = fixture();
  try {
    const plan = planHooks(ctx, { binAbs: '/x/scopegrain.mjs' });
    // Paths appear inside single quotes; a hostile project name cannot
    // reach the shell through double-quote interpolation.
    assert.ok(plan.nextContent.includes(`--project '${dir.replace(/\\/g, '/')}'`));
    assert.ok(!plan.nextContent.includes('--project "'));
  } finally { cleanup(dir); }
});

test('recordActivity creates an ops task and a progress entry', () => {
  const { dir, ctx } = fixture();
  try {
    const r = recordActivity(ctx, {
      kind: 'commit', title: 'commit abc1234: fix crash',
      ref: 'abc1234', summary: 'fix crash', files: ['src/x.mjs'],
      author: 'eros',
    });
    assert.equal(r.created, true);
    const task = getTask(ctx, r.taskId);
    assert.equal(task.type, 'ops');
    assert.equal(task.source, 'activity:commit');
    assert.equal(task.state, 'PLAN');
    const { entries } = readWorklog(ctx, 'progress');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].taskId, task.id);
    assert.equal(entries[0].kind, 'commit');
    assert.equal(entries[0].ref, 'abc1234');
    assert.deepEqual(entries[0].files, ['src/x.mjs']);
    assert.equal(entries[0].linked, false);
  } finally { cleanup(dir); }
});

test('recordActivity on existing taskId links without creating', () => {
  const { dir, ctx } = fixture();
  try {
    const first = recordActivity(ctx, { title: 'first action' });
    const linked = recordActivity(ctx, {
      title: 'follow-up commit', taskId: first.taskId, ref: 'deadbeef',
    });
    assert.equal(linked.created, false);
    assert.equal(linked.taskId, first.taskId);
    const { entries } = readWorklog(ctx, 'progress');
    assert.equal(entries.length, 2);
    assert.equal(entries[1].linked, true);
    assert.equal(entries[1].ref, 'deadbeef');
  } finally { cleanup(dir); }
});

test('gated modes get a declared, never fabricated, assessment', () => {
  const { dir, ctx } = fixture('organic-sdd');
  try {
    const r = recordActivity(ctx, {
      title: 'outside work', ref: 'feedface', author: 'owner',
    });
    const task = getTask(ctx, r.taskId);
    assert.equal(task.methodology.authorization.status, 'authorized');
    assert.equal(task.methodology.authorization.actor, 'owner');
    assert.equal(task.methodology.authorization.reference, 'feedface');
  } finally { cleanup(dir); }
});

test('activity input is closed: unknown keys and bad taskId rejected', () => {
  assert.throws(() => normalizeActivityInput({ title: 'x', bogus: 1 }),
    (e) => e.code === 'UNKNOWN_KEY');
  assert.throws(() => normalizeActivityInput({ title: 'x', taskId: 'nope' }),
    (e) => e.code === 'INVALID_ID');
  assert.throws(() => normalizeActivityInput({ title: 'x', kind: 'magic' }),
    (e) => e.code === 'INVALID_VALUE');
});

test('hooks install is idempotent and uninstall removes only the block', () => {
  const { dir, ctx } = fixture();
  try {
    const binAbs = path.join(dir, 'bin', 'scopegrain.mjs');
    const first = installHooks(ctx, { binAbs });
    assert.equal(first.applied, true);
    assert.equal(first.state, 'create');
    const hook = fs.readFileSync(planHooks(ctx, { binAbs }).file, 'utf8');
    assert.ok(hook.includes('### scopegrain-activity >>>'));
    assert.ok(hook.includes('activity record'));
    const again = installHooks(ctx, { binAbs });
    assert.equal(again.applied, false);
    assert.equal(again.reason, 'already-installed');
    const gone = uninstallHooks(ctx);
    assert.equal(gone.applied, true);
    const after = fs.existsSync(planHooks(ctx, { binAbs }).file)
      ? fs.readFileSync(planHooks(ctx, { binAbs }).file, 'utf8') : '';
    assert.ok(!after.includes('scopegrain-activity'));
  } finally { cleanup(dir); }
});

test('hooks install appends to an existing user hook without touching it', () => {
  const { dir, ctx } = fixture();
  try {
    const hookFile = path.join(gitHooksDir(ctx), 'post-commit');
    fs.writeFileSync(hookFile, '#!/bin/sh\necho user-hook\n');
    const plan = planHooks(ctx, { binAbs: '/x/scopegrain.mjs' });
    assert.equal(plan.state, 'append');
    installHooks(ctx, { binAbs: '/x/scopegrain.mjs' });
    const hook = fs.readFileSync(hookFile, 'utf8');
    assert.ok(hook.startsWith('#!/bin/sh\necho user-hook'));
    assert.ok(hook.includes('scopegrain-activity'));
    uninstallHooks(ctx);
    assert.equal(fs.readFileSync(hookFile, 'utf8'), '#!/bin/sh\necho user-hook\n');
  } finally { cleanup(dir); }
});

test('CLI: activity record dry-run writes nothing, --apply persists', async () => {
  const { dir } = fixture();
  try {
    writeJson(dir, 'in.json', { title: 'cli action', ref: 'cafe' });
    const io = fakeIO();
    assert.equal(await run(
      ['activity', 'record', '--project', dir, '--input',
        path.join(dir, 'in.json')], io), 0);
    assert.equal(JSON.parse(io.out.stdout.at(-1)).mode, 'dry-run');
    const io2 = fakeIO();
    assert.equal(await run(
      ['activity', 'record', '--project', dir, '--input',
        path.join(dir, 'in.json'), '--apply'], io2), 0);
    const applied = JSON.parse(io2.out.stdout.at(-1));
    assert.equal(applied.mode, 'applied');
    assert.equal(applied.created, true);
    const io3 = fakeIO();
    assert.equal(await run(
      ['hooks', 'install', '--project', dir], io3), 0);
    assert.equal(JSON.parse(io3.out.stdout.at(-1)).mode, 'dry-run');
  } finally { cleanup(dir); }
});

test('oversized worklog rotates the segment into memory/archive, append survives', () => {
  const { dir, ctx } = fixture();
  try {
    const memoryDir = path.join(dir, '.tasksystem', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    const logFile = path.join(memoryDir, 'progress.jsonl');
    const taskId = '123e4567-e89b-42d3-a456-426614174000';
    // >1 MiB of valid JSONL lines.
    const pad = 'x'.repeat(1024);
    const lines = [];
    while (lines.join('').length < 1050 * 1024) {
      lines.push(JSON.stringify(
        { at: '2026-01-01T00:00:00Z', taskId, title: pad }) + '\n');
    }
    fs.writeFileSync(logFile, lines.join(''));
    const original = fs.readFileSync(logFile);
    const rec = appendWorklog(ctx, 'progress',
      { taskId, title: 'after-rotate' });
    // The whole original segment moved to an immutable archive file.
    const archived = fs.readdirSync(path.join(memoryDir, 'archive'))
      .filter((f) => f.startsWith('progress-') && f.endsWith('.jsonl'));
    assert.equal(archived.length, 1);
    assert.ok(fs.readFileSync(
      path.join(memoryDir, 'archive', archived[0])).equals(original));
    // The active segment holds only the new entry; no truncation marker.
    const { entries, truncated } = readWorklog(ctx, 'progress');
    assert.equal(truncated, false);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, 'after-rotate');
    assert.equal(entries[0].taskId, rec.taskId);
  } finally { cleanup(dir); }
});

test('oversized worklog reads a bounded tail of newest entries only', () => {
  const { dir, ctx } = fixture();
  try {
    const memoryDir = path.join(dir, '.tasksystem', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    const logFile = path.join(memoryDir, 'lessons.jsonl');
    const pad = 'y'.repeat(1024);
    const lines = [];
    while (lines.join('').length < 1050 * 1024) {
      lines.push(JSON.stringify(
        { at: '2026-01-01T00:00:00Z', topic: 't', text: pad }) + '\n');
    }
    lines.push(JSON.stringify(
      { at: '2026-01-02T00:00:00Z', topic: 'newest', text: 'tail' }) + '\n');
    fs.writeFileSync(logFile, lines.join(''));
    const { entries, malformed, truncated } = readWorklog(ctx, 'lessons');
    assert.equal(truncated, true);
    assert.equal(malformed.length, 0);
    assert.ok(entries.length <= 50);
    assert.equal(entries.at(-1).topic, 'newest');
  } finally { cleanup(dir); }
});
