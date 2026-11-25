// SPDX-License-Identifier: Apache-2.0
// `task authorize`: the legal post-creation path for tasks wedged by
// AUTHORIZATION_MISSING. Only `missing` may become `authorized`, the write
// is a CAS meta mutation with a history entry, and the ACT gate unblocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/cli.mjs';
import { createTask, getTask } from '../src/core/tasks.mjs';
import { bootstrappedCtx, cleanup, fakeIO, DEFAULT_ANSWERS } from './helpers.mjs';
import { assessment } from './methodology-fixtures.mjs';

const missingAuth = {
  status: 'missing', actor: null, reference: null,
};

function fixture() {
  return bootstrappedCtx({
    ...DEFAULT_ANSWERS, hosts: ['claude'], methodology: 'organic-sdd',
  });
}

function lastJson(io) {
  return JSON.parse(io.out.stdout[io.out.stdout.length - 1]);
}

function seedTask(ctx, authOverrides = {}) {
  return createTask(ctx, {
    title: 'wedged', contract: 'C', authorContext: 'a', scope: [],
    methodology: assessment({
      authorization: { ...missingAuth, ...authOverrides } }),
  });
}

test('authorize previews then applies; CAS revision and history recorded', async () => {
  const { dir, ctx } = fixture();
  try {
    const task = seedTask(ctx);
    assert.equal(task.methodology.authorization.status, 'missing');
    const io = fakeIO();
    const preview = await run([
      'task', 'authorize', '--project', dir, task.id,
      '--revision', '0', '--actor', 'owner', '--reference', 'decision D-7',
    ], io);
    assert.equal(preview, 0);
    const dry = lastJson(io);
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.applied, false);
    assert.equal(dry.task.methodology.authorization.status, 'authorized');
    assert.equal(getTask(ctx, task.id).revision, 0);
    const applied = await run([
      'task', 'authorize', '--project', dir, task.id,
      '--revision', '0', '--actor', 'owner', '--reference', 'decision D-7',
      '--apply',
    ], io);
    assert.equal(applied, 0);
    const next = lastJson(io);
    assert.equal(next.revision, 1);
    const auth = next.methodology.authorization;
    assert.deepEqual(auth, {
      status: 'authorized', actor: 'owner', reference: 'decision D-7',
    });
    const last = next.history[next.history.length - 1];
    assert.equal(last.event, 'authorized');
    assert.equal(last.actor, 'owner');
    assert.equal(last.reference, 'decision D-7');
    assert.equal(last.revision, 1);
  } finally { cleanup(dir); }
});

test('authorize unblocks the ACT methodology gate end-to-end', async () => {
  const { dir, ctx } = fixture();
  try {
    const task = seedTask(ctx);
    const io = fakeIO();
    const blocked = await run([
      'task', 'transition', '--project', dir, task.id, 'ACT',
      '--revision', '0', '--apply',
    ], io);
    assert.equal(blocked, 1);
    const errOut = JSON.parse(io.out.stderr[io.out.stderr.length - 1]);
    assert.equal(errOut.error.code, 'METHODOLOGY_BLOCKED');
    await run([
      'task', 'authorize', '--project', dir, task.id,
      '--revision', '0', '--actor', 'owner', '--reference', 'D-7',
      '--apply',
    ], io);
    const moved = await run([
      'task', 'transition', '--project', dir, task.id, 'ACT',
      '--revision', '1', '--apply',
    ], io);
    assert.equal(moved, 0);
    assert.equal(getTask(ctx, task.id).state, 'ACT');
  } finally { cleanup(dir); }
});

test('authorize refuses non-missing statuses and null methodology', async () => {
  const { dir, ctx } = fixture();
  try {
    const authorized = seedTask(ctx, {
      status: 'authorized', actor: 'a', reference: 'r' });
    const declined = seedTask(ctx, {
      status: 'declined', actor: 'a', reference: 'r' });
    for (const t of [authorized, declined]) {
      const io = fakeIO();
      const code = await run([
        'task', 'authorize', '--project', dir, t.id,
        '--revision', '0', '--actor', 'o', '--reference', 'r', '--apply',
      ], io);
      assert.equal(code, 1, t.id);
      const errOut = JSON.parse(io.out.stderr[io.out.stderr.length - 1]);
      assert.equal(errOut.error.code, 'INVALID_VALUE');
      assert.equal(getTask(ctx, t.id).revision, 0);
    }
    const { evaluateTaskAuthorization } = await import(
      '../src/core/transition.mjs');
    const nullMethodology = { ...authorized, methodology: null };
    assert.throws(
      () => evaluateTaskAuthorization(ctx, nullMethodology,
        { id: authorized.id, expectedRevision: 0,
          actor: 'o', reference: 'r' }),
      { code: 'INVALID_VALUE' });
  } finally { cleanup(dir); }
});

test('authorize enforces CAS revision and required flags', async () => {
  const { dir, ctx } = fixture();
  try {
    const task = seedTask(ctx);
    const io = fakeIO();
    const stale = await run([
      'task', 'authorize', '--project', dir, task.id,
      '--revision', '9', '--actor', 'o', '--reference', 'r', '--apply',
    ], io);
    assert.equal(stale, 1);
    assert.equal(JSON.parse(io.out.stderr.at(-1)).error.code,
      'REVISION_MISMATCH');
    for (const args of [
      ['task', 'authorize', '--project', dir, task.id,
        '--actor', 'o', '--reference', 'r'],
      ['task', 'authorize', '--project', dir, task.id,
        '--revision', '0', '--reference', 'r'],
      ['task', 'authorize', '--project', dir, task.id,
        '--revision', '0', '--actor', 'o'],
    ]) {
      const io2 = fakeIO();
      const code = await run(args, io2);
      assert.equal(code, 2, args.join(' '));
      assert.equal(JSON.parse(io2.out.stderr.at(-1)).error.code,
        'INVALID_ARGS');
    }
    assert.equal(getTask(ctx, task.id).revision, 0);
  } finally { cleanup(dir); }
});

test('authorize input is closed and actor/reference non-empty', async () => {
  const { dir, ctx } = fixture();
  try {
    const task = seedTask(ctx);
    const { authorizeTask } = await import('../src/core/transition.mjs');
    for (const [input, code] of [
      [{ id: task.id, expectedRevision: 0, actor: 'o', reference: 'r',
        extra: 1 }, 'UNKNOWN_KEY'],
      [{ id: task.id, expectedRevision: -1, actor: 'o', reference: 'r' },
        'REVISION_MISMATCH'],
      [{ id: task.id, expectedRevision: 0, actor: '  ', reference: 'r' },
        'INVALID_VALUE'],
      [{ id: task.id, expectedRevision: 0, actor: 'o', reference: '' },
        'INVALID_VALUE'],
      [null, 'INVALID_ARGS'],
    ]) {
      assert.throws(() => authorizeTask(ctx, input), { code });
    }
    assert.equal(getTask(ctx, task.id).revision, 0);
  } finally { cleanup(dir); }
});
