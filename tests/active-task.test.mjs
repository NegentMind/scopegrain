// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  slugifyTitle, nextTaskSlug, createTask,
} from '../src/core/tasks.mjs';
import {
  getActiveTask, setActiveTask, clearActiveTask, resolveTaskRef,
} from '../src/core/active.mjs';
import {
  bootstrappedMiniCtx, cleanup, writeJson, VALID_ANSWERS,
} from './helpers.mjs';

const mkInput = (title) => ({
  title, contract: 'c', authorContext: 'a', scope: [],
});

test('slugifyTitle normalizes to kebab bounded slug', () => {
  assert.equal(slugifyTitle('My Feature: Auth!'), 'my-feature-auth');
  assert.equal(slugifyTitle('   '), 'task');
});

test('new tasks carry monotonic NNN- slugs', () => {
  const { dir, ctx } = bootstrappedMiniCtx(VALID_ANSWERS);
  try {
    const a = createTask(ctx, mkInput('first'));
    const b = createTask(ctx, mkInput('second task'));
    assert.match(a.slug, /^001-/);
    assert.match(b.slug, /^002-second-task$/);
    assert.equal(nextTaskSlug(ctx, 'x').startsWith('003-'), true);
  } finally {
    cleanup(dir);
  }
});

test('resolveTaskRef accepts slug and uuid', () => {
  const { dir, ctx } = bootstrappedMiniCtx(VALID_ANSWERS);
  try {
    const t = createTask(ctx, mkInput('ref me'));
    assert.equal(resolveTaskRef(ctx, t.slug).id, t.id);
    assert.equal(resolveTaskRef(ctx, t.id).id, t.id);
    assert.throws(() => resolveTaskRef(ctx, 'nope'), (e) => e.code === 'NOT_FOUND');
  } finally {
    cleanup(dir);
  }
});

test('active pointer: env wins over file; file persists', () => {
  const { dir, ctx } = bootstrappedMiniCtx(VALID_ANSWERS);
  try {
    const a = createTask(ctx, mkInput('file task'));
    const b = createTask(ctx, mkInput('env task'));
    setActiveTask(ctx, a.slug);
    const filePick = getActiveTask(ctx, {});
    assert.equal(filePick.task.id, a.id);
    assert.equal(filePick.source, 'file');
    const envPick = getActiveTask(ctx, { SCOPEGRAIN_TASK: b.id });
    assert.equal(envPick.task.id, b.id);
    assert.equal(envPick.source, 'env');
    clearActiveTask(ctx);
    const empty = getActiveTask(ctx, {});
    assert.equal(empty.task, null);
  } finally {
    cleanup(dir);
  }
});

test('tampered pointer file surfaces an error, not a crash', () => {
  const { dir, ctx } = bootstrappedMiniCtx(VALID_ANSWERS);
  try {
    fs.mkdirSync(`${dir}/.tasksystem`, { recursive: true });
    fs.writeFileSync(`${dir}/.tasksystem/active-task`, 'bogus-ref\n');
    assert.throws(() => getActiveTask(ctx, {}), (e) => e.code === 'NOT_FOUND');
  } finally {
    cleanup(dir);
  }
});
