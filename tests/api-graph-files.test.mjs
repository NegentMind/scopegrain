// SPDX-License-Identifier: Apache-2.0
// GET /api/graph/files: Meta->Plan->Task nodes crossed with the
// structure index and recorded file paths. Deterministic; a path absent
// from the index reports indexed:null — never invented metadata.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { createApiQueries } from '../src/api/queries.mjs';
import { createApiServer } from '../src/api/server.mjs';
import { appendWorklog } from '../src/core/worklog.mjs';
import { writeStructureIndex } from '../src/discovery/structure.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeJson,
} from './helpers.mjs';

const CONFIG_REL = '.scopegrain/config.json';

function baseFixture() {
  const dir = makeTempDir('api-graph');
  writeJson(dir, CONFIG_REL, createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir, config: CONFIG_REL });
  return { dir, ctx };
}

const INDEX = {
  schemaVersion: 1, root: 'x', generatedAt: '2026-01-01T00:00:00.000Z',
  fingerprint: 'f'.repeat(64), statOnly: false, warnings: [],
  totals: { files: 2 }, languages: {}, edges: {}, top: {},
  filesTruncated: false,
  files: [
    ['src/core/a.mjs', 'javascript', 100, 10, -1, -1, -1, 0],
    ['src/core/sub/b.mjs', 'javascript', 200, 20, -1, -1, -1, 0],
    // Sibling dir sharing the region prefix: 'src' must NOT match it —
    // containment is `region` or `region/` exactly, no false positives.
    ['src2/other.mjs', 'javascript', 50, 5, -1, -1, -1, 0],
  ],
};

test('graph files: scope match, recorded files, no invented paths', () => {
  const { dir, ctx } = baseFixture();
  try {
    writeStructureIndex(ctx, INDEX);
    const task = createTask(ctx, {
      title: 'T', contract: 'c', authorContext: 'a',
      scope: ['src/core'],
      steps: [{ name: 's1', files: ['src/core/a.mjs'] }],
    });
    appendWorklog(ctx, 'activity', {
      taskId: task.id, title: 'commit',
      files: ['src/core/sub/b.mjs', 'docs/missing.md'],
    });
    appendWorklog(ctx, 'progress', {
      taskId: task.id, title: 'p', files: ['src/core/sub/b.mjs'],
    });
    const q = createApiQueries(ctx);
    const out = q.graphFiles({ limit: 100, offset: 0 });
    assert.equal(out.index.present, true);
    // The worklog tail window is disclosed, never implied complete.
    assert.deepEqual(out.worklogTail.progress,
      { tail: 1000, truncated: false, malformed: 0 });
    assert.deepEqual(out.worklogTail.activity,
      { tail: 1000, truncated: false, malformed: 0 });
    const node = out.tasks.find((t) => t.id === task.id);
    // Scope region matches both indexed files via containment —
    // 'src2/other.mjs' shares the prefix but is a sibling, not a child.
    assert.deepEqual(node.scope, [{
      region: 'src/core', matched: 2,
      sample: ['src/core/a.mjs', 'src/core/sub/b.mjs'],
    }]);
    const byPath = new Map(node.files.map((f) => [f.path, f]));
    // Step file carries via:step and index metadata.
    assert.deepEqual(byPath.get('src/core/a.mjs').via, ['step']);
    assert.equal(byPath.get('src/core/a.mjs').indexed.lang, 'javascript');
    // Shared file merges progress+activity vias.
    assert.deepEqual(byPath.get('src/core/sub/b.mjs').via,
      ['activity', 'progress']);
    // Recorded path absent from the index: null, never invented.
    assert.equal(byPath.get('docs/missing.md').indexed, null);
    assert.deepEqual(byPath.get('docs/missing.md').via, ['activity']);
  } finally { cleanup(dir); }
});

test('graph files: absent index degrades honestly', () => {
  const { dir, ctx } = baseFixture();
  try {
    const task = createTask(ctx, {
      title: 'T', contract: 'c', authorContext: 'a',
      scope: ['src/core'],
    });
    const q = createApiQueries(ctx);
    const out = q.graphFiles({ limit: 100, offset: 0 });
    assert.equal(out.index.present, false);
    const node = out.tasks.find((t) => t.id === task.id);
    assert.deepEqual(node.scope,
      [{ region: 'src/core', matched: null, sample: [] }]);
    // Deterministic across calls.
    assert.deepEqual(q.graphFiles({ limit: 100, offset: 0 }), out);
  } finally { cleanup(dir); }
});

test('graph files: malformed index degrades instead of crashing', () => {
  const { dir, ctx } = baseFixture();
  try {
    // Envelope passes validation (schemaVersion 1, object) but the
    // files tuples are corrupt — the query degrades to present:false.
    writeStructureIndex(ctx, {
      schemaVersion: 1, generatedAt: 'x', files: { not: 'an array' },
    });
    createTask(ctx, {
      title: 'T', contract: 'c', authorContext: 'a', scope: ['src/core'],
    });
    const out = createApiQueries(ctx).graphFiles({ limit: 100, offset: 0 });
    assert.equal(out.index.present, false);
    assert.equal(out.tasks[0].scope[0].matched, null);
  } finally { cleanup(dir); }
});

test('graph files: pagination bounds tasks, not the graph', () => {
  const { dir, ctx } = baseFixture();
  try {
    writeStructureIndex(ctx, INDEX);
    for (const t of ['a', 'b', 'c']) {
      createTask(ctx, {
        title: t, contract: 'c', authorContext: 'a', scope: [],
      });
    }
    const q = createApiQueries(ctx);
    const page = q.graphFiles({ limit: 2, offset: 0 });
    assert.equal(page.tasks.length, 2);
    assert.equal(page.tasksTotal, 3);
    assert.equal(page.truncated, true);
    const rest = q.graphFiles({ limit: 2, offset: 2 });
    assert.equal(rest.tasks.length, 1);
    assert.equal(rest.truncated, false);
    // Deterministic order: pages are disjoint and total is stable.
    const ids = new Set([
      ...page.tasks.map((t) => t.id), ...rest.tasks.map((t) => t.id)]);
    assert.equal(ids.size, 3);
  } finally { cleanup(dir); }
});

test('GET /api/graph/files serves the graph and linkages', async () => {
  const f = baseFixture();
  const srv = await createApiServer({
    project: f.dir, config: CONFIG_REL, port: 0,
  });
  const bound = await srv.listen();
  const base = `http://${srv.host}:${bound.port}`;
  try {
    writeStructureIndex(f.ctx, INDEX);
    const task = createTask(f.ctx, {
      title: 'T', contract: 'c', authorContext: 'a', scope: ['src/core'],
    });
    const res = await fetch(`${base}/api/graph/files`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.schemaVersion, 1);
    assert.equal(body.index.present, true);
    assert.equal(body.tasksTotal, 1);
    const node = body.tasks.find((t) => t.id === task.id);
    assert.equal(node.scope[0].matched, 2);
    // Goals/plans sections are present even when empty.
    assert.deepEqual(body.goals, []);
    assert.deepEqual(body.plans, []);
    // Unknown query keys are rejected by the strict route schema.
    const bad = await fetch(`${base}/api/graph/files?bogus=1`);
    assert.equal(bad.status, 400);
  } finally {
    srv.close();
    cleanup(f.dir);
  }
});
