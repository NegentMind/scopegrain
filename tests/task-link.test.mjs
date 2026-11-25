// SPDX-License-Identifier: Apache-2.0
// `task link`/`task unlink`: convenience sugar over updateTaskMeta that
// unions/removes dependsOn ids and typed relations without a JSON file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { run } from '../src/cli.mjs';
import { getTask } from '../src/core/tasks.mjs';
import { resolveContext } from '../src/core/context.mjs';
import {
  VALID_ANSWERS, cleanup, fakeIO, makeTempDir, writeJson,
} from './helpers.mjs';

const lastJson = (io) => JSON.parse(io.out.stdout[io.out.stdout.length - 1]);
const errCode = (io) => JSON.parse(io.out.stderr[0]).error.code;

function bootstrapped() {
  const dir = makeTempDir('task-link');
  const answersFile = `${dir}-answers.json`;
  fs.writeFileSync(answersFile, JSON.stringify(VALID_ANSWERS, null, 2));
  return { dir, answersFile };
}

async function createTask(dir, title) {
  const io = fakeIO();
  assert.equal(await run(['task', 'create', '--project', dir,
    '--title', title, '--contract', 'C', '--author', 'ctx-a',
    '--scope', 'src/x', '--apply'], io), 0);
  const created = lastJson(io);
  return (created.task ?? created).id;
}

test('link/unlink: dependsOn union+diff, relations by kind, CAS', async () => {
  const { dir, answersFile } = bootstrapped();
  try {
    const ioI = fakeIO();
    await run(['init', '--project', dir, '--answers', answersFile,
      '--apply'], ioI);
    const ctx = resolveContext({ project: dir });
    const a = await createTask(dir, 'A');
    const b = await createTask(dir, 'B');
    const c = await createTask(dir, 'C');

    // dry-run previews the union without writing
    let io = fakeIO();
    assert.equal(await run(['task', 'link', '--project', dir, a, b,
      '--revision', '0'], io), 0);
    assert.deepEqual(lastJson(io).task.dependsOn, [b]);
    assert.equal(getTask(ctx, a).dependsOn, undefined); // nothing persisted

    // apply: V1 record upgrades to V3 and stores the dep
    io = fakeIO();
    assert.equal(await run(['task', 'link', '--project', dir, a, b,
      '--revision', '0', '--apply'], io), 0);
    assert.equal(getTask(ctx, a).schemaVersion, 3);
    assert.deepEqual(getTask(ctx, a).dependsOn, [b]);

    // second link unions, no duplicates
    io = fakeIO();
    assert.equal(await run(['task', 'link', '--project', dir, a, c,
      '--revision', '1', '--apply'], io), 0);
    io = fakeIO();
    assert.equal(await run(['task', 'link', '--project', dir, a, c,
      '--revision', '2', '--apply'], io), 0);
    assert.deepEqual(getTask(ctx, a).dependsOn.sort(), [b, c].sort());

    // --kind writes typed relations (external refs allowed)
    io = fakeIO();
    assert.equal(await run(['task', 'link', '--project', dir, a,
      'ext:doc-42', '--kind', 'see', '--revision', '3', '--apply'], io), 0);
    assert.deepEqual(getTask(ctx, a).relations, { see: ['ext:doc-42'] });

    // unlink removes the edge and drops empty relation kinds
    io = fakeIO();
    assert.equal(await run(['task', 'unlink', '--project', dir, a,
      'ext:doc-42', '--kind', 'see', '--revision', '4', '--apply'], io), 0);
    assert.deepEqual(getTask(ctx, a).relations, {});
    io = fakeIO();
    assert.equal(await run(['task', 'unlink', '--project', dir, a, c,
      '--revision', '5', '--apply'], io), 0);
    assert.deepEqual(getTask(ctx, a).dependsOn, [b]);
  } finally { cleanup(dir); cleanup(answersFile); }
});

test('link rejects: self-edge, unknown kind, missing target, bad CAS', async () => {
  const { dir, answersFile } = bootstrapped();
  try {
    const ioI = fakeIO();
    await run(['init', '--project', dir, '--answers', answersFile,
      '--apply'], ioI);
    const a = await createTask(dir, 'A');

    let io = fakeIO();
    assert.equal(await run(['task', 'link', '--project', dir, a, a,
      '--revision', '0'], io), 1);
    assert.equal(errCode(io), 'INVALID_VALUE');

    io = fakeIO();
    assert.equal(await run(['task', 'link', '--project', dir, a,
      'ext:x', '--kind', 'bogus', '--revision', '0'], io), 1);
    assert.equal(errCode(io), 'INVALID_VALUE');

    // dependsOn targets must be real task records (no dead edges)
    io = fakeIO();
    assert.equal(await run(['task', 'link', '--project', dir, a,
      crypto.randomUUID(), '--revision', '0'], io), 1);

    // stale revision fails closed like every meta mutation
    io = fakeIO();
    const b = await createTask(dir, 'B');
    assert.equal(await run(['task', 'link', '--project', dir, a, b,
      '--revision', '99'], io), 1);
    assert.equal(errCode(io), 'REVISION_MISMATCH');
  } finally { cleanup(dir); cleanup(answersFile); }
});
