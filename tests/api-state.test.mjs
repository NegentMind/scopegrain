// SPDX-License-Identifier: Apache-2.0
// API coverage for the F7 state stores: reviewer checklists, the versioned
// constitution and the active-task pointer (env/file resolution and
// degraded-pointer surfacing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { createChecklist } from '../src/core/checklists.mjs';
import { setConstitution } from '../src/core/constitution.mjs';
import { setActiveTask, clearActiveTask } from '../src/core/active.mjs';
import { createApiServer } from '../src/api/server.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeFile, writeJson,
} from './helpers.mjs';

const CONFIG_REL = '.scopegrain/config.json';

function baseFixture() {
  const dir = makeTempDir('api-state');
  writeJson(dir, CONFIG_REL, createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir, config: CONFIG_REL });
  return { dir, ctx };
}

async function serve(fixture) {
  const api = createApiServer({
    project: fixture.dir, config: CONFIG_REL, port: 0,
  });
  const bound = await api.listen();
  const base = `http://${api.host}:${bound.port}`;
  return {
    base,
    get: async (rel) => {
      const res = await fetch(`${base}${rel}`);
      return { status: res.status, body: await res.json() };
    },
    close: () => api.close(),
  };
}

const mkTask = (ctx, title) => createTask(ctx, {
  title, contract: 'C', authorContext: 'a', scope: [],
});

test('checklists list is empty then carries items and verdict counts', async () => {
  const f = baseFixture();
  const srv = await serve(f);
  try {
    const empty = await srv.get('/api/checklists');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.checklists, []);
    assert.equal(empty.body.truncated, false);

    const task = mkTask(f.ctx, 'audited task');
    createChecklist(f.ctx, {
      taskId: task.id, title: 'Review pass',
      items: [
        { text: 'spec complete', status: 'pass' },
        { text: 'tests green', status: 'pending' },
        { text: 'n/a item', status: 'na' },
        { text: 'failing item', status: 'fail' },
      ],
    });
    const res = await srv.get('/api/checklists');
    assert.equal(res.status, 200);
    assert.equal(res.body.checklists.length, 1);
    const c = res.body.checklists[0];
    assert.equal(c.taskId, task.id);
    assert.equal(c.title, 'Review pass');
    assert.equal(c.items.length, 4);
    assert.equal(c.items[0].id, 'CHK001');
    assert.equal(c.items[0].status, 'pass');
    assert.deepEqual(c.counts, { pending: 1, pass: 1, fail: 1, na: 1 });
    // Non-UUID stems surface as malformed, never dropped silently.
    writeJson(f.dir, '.scopegrain/checklists/not-a-uuid.json', {});
    const res2 = await srv.get('/api/checklists');
    assert.equal(res2.body.malformed.length, 1);
    assert.equal(res2.body.malformed[0].file, 'not-a-uuid.json');
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

test('constitution is null until recorded, then returns the doc', async () => {
  const f = baseFixture();
  const srv = await serve(f);
  try {
    const empty = await srv.get('/api/constitution');
    assert.equal(empty.status, 200);
    assert.equal(empty.body.constitution, null);

    setConstitution(f.ctx, {
      version: '1.0.0', bump: 'major', summary: 'genesis',
      principles: [
        { id: 'P-ONE', title: 'First', statement: 'Do it right.' },
      ],
    });
    const res = await srv.get('/api/constitution');
    assert.equal(res.status, 200);
    const c = res.body.constitution;
    assert.equal(c.version, '1.0.0');
    assert.equal(c.principles.length, 1);
    assert.equal(c.principles[0].id, 'P-ONE');
    assert.equal(c.history.length, 1);
    assert.equal(c.history[0].bump, 'major');
    assert.equal(c.complexity.principles, 1);
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

test('active-task reports null, file source, env override and broken pointer', async () => {
  const f = baseFixture();
  const srv = await serve(f);
  try {
    const none = await srv.get('/api/active-task');
    assert.equal(none.status, 200);
    assert.equal(none.body.task, null);
    assert.equal(none.body.source, null);

    const a = mkTask(f.ctx, 'file task');
    const b = mkTask(f.ctx, 'env task');
    setActiveTask(f.ctx, a.slug);
    const file = await srv.get('/api/active-task');
    assert.equal(file.body.task.id, a.id);
    assert.equal(file.body.source, 'file');

    process.env.SCOPEGRAIN_TASK = b.id;
    try {
      const env = await srv.get('/api/active-task');
      assert.equal(env.body.task.id, b.id);
      assert.equal(env.body.source, 'env');
    } finally {
      delete process.env.SCOPEGRAIN_TASK;
    }

    clearActiveTask(f.ctx);
    writeFile(f.dir, '.scopegrain/active-task', 'bogus-ref\n');
    const broken = await srv.get('/api/active-task');
    assert.equal(broken.status, 200);
    assert.equal(broken.body.task, null);
    assert.equal(broken.body.error.code, 'NOT_FOUND');
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

test('state endpoints stay read-only and strictly queried', async () => {
  const f = baseFixture();
  const srv = await serve(f);
  try {
    const badQuery = await srv.get('/api/checklists?hack=1');
    assert.equal(badQuery.status, 400);
    assert.equal(badQuery.body.error.code, 'INVALID_QUERY');
    const badLimit = await srv.get('/api/checklists?limit=0');
    assert.equal(badLimit.status, 400);
    for (const rel of ['/api/checklists', '/api/constitution',
      '/api/active-task']) {
      const res = await fetch(`${srv.base}${rel}`, { method: 'POST' });
      assert.equal(res.status, 405);
      assert.equal((await res.json()).error.code, 'METHOD_NOT_ALLOWED');
    }
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});
