// SPDX-License-Identifier: Apache-2.0
// Local JSON API (viewer block G): route whitelist, error envelope,
// bounded lists, localhost binding and read-only coverage of tasks, plans,
// artifacts, journal operations and owned captures.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { preparePlan } from '../src/core/plans.mjs';
import { prepareArtifact } from '../src/core/artifacts.mjs';
import { prepareWorkspace } from '../src/core/workspaces.mjs';
import { createCaptureStore } from '../src/core/captures.mjs';
import { createApiServer } from '../src/api/server.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeFile, writeJson,
} from './helpers.mjs';

const CONFIG_REL = '.tasksystem/config.json';

function baseFixture() {
  const dir = makeTempDir('api');
  writeJson(dir, CONFIG_REL, createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir, config: CONFIG_REL });
  return { dir, ctx };
}

// Enrolled project: workspace + tasks + plan + artifact + one committed
// capture (which also produces a committed two-event journal operation).
function enrolledFixture() {
  const { dir, ctx } = baseFixture();
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  const taskA = createTask(ctx, {
    title: 'First task', contract: 'Deliver thing one',
    authorContext: 'owner', scope: [],
  });
  const taskB = createTask(ctx, {
    title: 'Second task', contract: 'Deliver thing two',
    authorContext: 'owner', scope: [],
  });
  const { plan, files } = preparePlan(ctx, {
    key: 'demo-plan', title: 'Demo plan', authorContext: 'owner',
    tasks: [{ key: 't1', title: 'T1', contract: 'C1' }],
  });
  applyPlan(dir, files);
  const { artifact, file } = prepareArtifact(ctx, 'decision', {
    title: 'Pick v4', body: 'Tailwind v4 it is.', references: [],
  });
  applyPlan(dir, [file]);
  const store = createCaptureStore(ctx, {
    areaIds: [a, b], origin: 'local-cli' });
  const created = store.create({
    category: 'decision', title: 'Viewer note', summary: 'S',
    areaIds: [a, b],
  });
  return {
    dir, ctx, a, b, taskA, taskB, plan, artifact,
    captureId: created.record.id,
    operationId: created.journal.operationId,
  };
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

test('health responds without workspace access', async () => {
  const f = baseFixture();
  const srv = await serve(f);
  try {
    const res = await srv.get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.api, 'scopegrain-viewer');
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

test('rejects non-loopback hosts and non-GET methods', async () => {
  const f = baseFixture();
  try {
    assert.throws(() => createApiServer({
      project: f.dir, config: CONFIG_REL, host: '0.0.0.0', port: 0,
    }), (e) => e.code === 'INVALID_HOST');
    assert.throws(() => createApiServer({
      project: f.dir, config: CONFIG_REL, host: 'example.internal', port: 0,
    }), (e) => e.code === 'INVALID_HOST');
    // 'localhost' is a name, not a literal loopback address: DNS can map
    // it off-loopback, so only '127.0.0.1' and '::1' are accepted.
    assert.throws(() => createApiServer({
      project: f.dir, config: CONFIG_REL, host: 'localhost', port: 0,
    }), (e) => e.code === 'INVALID_HOST');
    const srv = await serve(f);
    try {
      const res = await fetch(`${srv.base}/api/health`, { method: 'POST' });
      assert.equal(res.status, 405);
      const body = await res.json();
      assert.equal(body.error.code, 'METHOD_NOT_ALLOWED');
      const gone = await srv.get('/api/nope');
      assert.equal(gone.status, 404);
      assert.equal(gone.body.error.code, 'NOT_FOUND');
      const badQuery = await srv.get('/api/tasks?hack=1');
      assert.equal(badQuery.status, 400);
      assert.equal(badQuery.body.error.code, 'INVALID_QUERY');
    } finally {
      await srv.close();
    }
  } finally {
    cleanup(f.dir);
  }
});

test('rejects non-loopback Host and Origin (DNS-rebinding guard)', async () => {
  const f = enrolledFixture();
  const srv = await serve(f);
  try {
    const url = new URL(`${srv.base}/api/health`);
    const rawGet = (headers) => new Promise((resolve, reject) => {
      const req = http.request({
        hostname: url.hostname, port: url.port, path: url.pathname,
        method: 'GET', headers,
      }, (res) => {
        res.resume();
        res.on('end', () => resolve(res));
      });
      req.on('error', reject);
      req.end();
    });
    const evil = await rawGet({ Host: 'evil.example:7731' });
    assert.equal(evil.statusCode, 421);
    const evilOrigin = await rawGet({
      Host: url.host, Origin: 'http://evil.example',
    });
    assert.equal(evilOrigin.statusCode, 421);
    const good = await rawGet({ Host: url.host });
    assert.equal(good.statusCode, 200);
    assert.equal(good.headers['cross-origin-resource-policy'], 'same-origin');
    assert.ok(String(good.headers['content-security-policy'])
      .includes("default-src 'none'"));
    const local = await rawGet({ Host: 'localhost:7731' });
    assert.equal(local.statusCode, 200);
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

test('workspace summarizes project, enrollment and counts', async () => {
  const f = enrolledFixture();
  const srv = await serve(f);
  try {
    const res = await srv.get('/api/workspace');
    assert.equal(res.status, 200);
    assert.equal(res.body.project.name, VALID_ANSWERS.name);
    assert.equal(res.body.workspace.areas.length, 2);
    assert.equal(res.body.counts.tasks, 3); // 2 direct + 1 from plan
    assert.equal(res.body.counts.tasksByState.PLAN, 3);
    assert.equal(res.body.counts.plans, 1);
    assert.equal(res.body.counts.artifacts.decision, 1);
    assert.equal(res.body.counts.captures, 1);
    assert.equal(res.body.counts.journalOperations, 1);
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

test('tasks list/detail with bounds and error envelope', async () => {
  const f = enrolledFixture();
  const srv = await serve(f);
  try {
    const all = await srv.get('/api/tasks');
    assert.equal(all.status, 200);
    assert.equal(all.body.tasks.length, 3);
    const ids = all.body.tasks.map((t) => t.id);
    assert.ok(ids.includes(f.taskA.id));
    const summary = all.body.tasks.find((t) => t.id === f.taskA.id);
    assert.equal(summary.state, 'PLAN');
    assert.equal(summary.title, 'First task');

    const one = await srv.get(`/api/tasks/${f.taskA.id}`);
    assert.equal(one.status, 200);
    assert.equal(one.body.task.contract, 'Deliver thing one');
    assert.ok(Array.isArray(one.body.task.history));

    const bounded = await srv.get('/api/tasks?limit=1');
    assert.equal(bounded.status, 200);
    assert.equal(bounded.body.tasks.length, 1);
    assert.equal(bounded.body.truncated, true);

    const badId = await srv.get('/api/tasks/not-a-uuid');
    assert.equal(badId.status, 400);
    assert.equal(badId.body.error.code, 'INVALID_ID');
    const missing = await srv.get(
      '/api/tasks/00000000-0000-0000-0000-000000000000');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'TASK_NOT_FOUND');
    const badLimit = await srv.get('/api/tasks?limit=0');
    assert.equal(badLimit.status, 400);
    const tooBig = await srv.get('/api/tasks?limit=9999');
    assert.equal(tooBig.status, 400);
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

test('plans list exposes readiness per task', async () => {
  const f = enrolledFixture();
  const srv = await serve(f);
  try {
    const res = await srv.get('/api/plans');
    assert.equal(res.status, 200);
    assert.equal(res.body.plans.length, 1);
    const plan = res.body.plans[0];
    assert.equal(plan.key, 'demo-plan');
    assert.equal(plan.taskCount, 1);
    assert.equal(plan.readiness[0].status, 'ready');
    const detail = await srv.get('/api/plans/demo-plan');
    assert.equal(detail.status, 200);
    assert.equal(detail.body.plan.key, 'demo-plan');
    const missing = await srv.get('/api/plans/no-such-plan');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'PLAN_NOT_FOUND');
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

test('artifacts require a valid kind and bound ids', async () => {
  const f = enrolledFixture();
  const srv = await serve(f);
  try {
    const listed = await srv.get('/api/artifacts?kind=decision');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.artifacts.length, 1);
    assert.equal(listed.body.artifacts[0].id, f.artifact.id);
    assert.equal(listed.body.artifacts[0].bodyTruncated, false);

    const one = await srv.get(`/api/artifacts/decision/${f.artifact.id}`);
    assert.equal(one.status, 200);
    assert.equal(one.body.artifact.body, 'Tailwind v4 it is.');

    const noKind = await srv.get('/api/artifacts');
    assert.equal(noKind.status, 400);
    const badKind = await srv.get('/api/artifacts?kind=tasks');
    assert.equal(badKind.status, 400);
    assert.equal(badKind.body.error.code, 'INVALID_KIND');
    const missing = await srv.get(
      '/api/artifacts/report/00000000-0000-0000-0000-000000000000');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'ARTIFACT_NOT_FOUND');
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

test('journal operations list state and events', async () => {
  const f = enrolledFixture();
  const srv = await serve(f);
  try {
    const ops = await srv.get('/api/journal/operations');
    assert.equal(ops.status, 200);
    assert.equal(ops.body.operations.length, 1);
    const op = ops.body.operations[0];
    assert.equal(op.operationId, f.operationId);
    assert.equal(op.state, 'committed');
    assert.equal(op.eventCount, 2);
    assert.deepEqual(op.sourceKinds.sort(),
      ['capture', 'record-ownership']);

    const one = await srv.get(`/api/journal/operations/${f.operationId}`);
    assert.equal(one.status, 200);
    assert.equal(one.body.intent.events.length, 2);
    const kinds = one.body.intent.events.map((e) => e.sourceKind);
    assert.ok(kinds.includes('capture'));
    assert.ok(kinds.includes('record-ownership'));

    const missing = await srv.get(
      '/api/journal/operations/00000000-0000-0000-0000-000000000000');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'JOURNAL_NOT_FOUND');
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

test('captures surface ownership proof and drift', async () => {
  const f = enrolledFixture();
  const srv = await serve(f);
  try {
    const res = await srv.get('/api/captures');
    assert.equal(res.status, 200);
    assert.equal(res.body.captures.length, 1);
    const cap = res.body.captures[0];
    assert.equal(cap.id, f.captureId);
    assert.equal(cap.status, 'proved');
    assert.equal(cap.ownershipConfirmed, true);
    assert.equal(cap.record.title, 'Viewer note');
    assert.equal(cap.record.category, 'decision');
    assert.equal(cap.scope.areaIds.length, 2);

    // Drift: rewrite the current source bytes so the snapshot proof fails.
    const rel = `${f.ctx.config.paths.memory}/captures/${f.captureId}.json`;
    const abs = path.join(f.dir, ...rel.split('/'));
    fs.writeFileSync(abs, JSON.stringify({ tampered: true }));
    const res2 = await srv.get('/api/captures');
    const drifted = res2.body.captures.find((c) => c.id === f.captureId);
    assert.equal(drifted.status, 'drifted');
    assert.equal(drifted.ownershipConfirmed, false);
    assert.equal(drifted.error.code, 'CAPTURE_SOURCE_CHANGED');
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

// The workspace catalog snapshot (configDir/catalog.json, schemaVersion 2)
// is hash-pinned: fixture files carry their real sha256 so the verified
// load succeeds, including a command with prompt/skill bindings.
test('catalog groups entries by kind and exposes dep bindings', async () => {
  const f = baseFixture();
  const bodies = {
    'commands/demo-cmd.md': '# Demo command\n',
    'prompts/demo-prompt.md': 'Prompt body\n',
    'skills/demo-skill.md': 'Skill body\n',
  };
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  for (const [rel, content] of Object.entries(bodies)) {
    writeFile(f.dir, `.tasksystem/${rel}`, content);
  }
  writeJson(f.dir, '.tasksystem/catalog.json', {
    schemaVersion: 2,
    entries: [
      { kind: 'command', id: 'demo-cmd', path: 'commands/demo-cmd.md',
        description: 'Demo command', modes: ['default'],
        prompts: ['demo-prompt'], skills: ['demo-skill'],
        sha256: sha(bodies['commands/demo-cmd.md']) },
      { kind: 'prompt', id: 'demo-prompt', path: 'prompts/demo-prompt.md',
        description: 'Demo prompt',
        sha256: sha(bodies['prompts/demo-prompt.md']) },
      { kind: 'skill', id: 'demo-skill', path: 'skills/demo-skill.md',
        description: 'Demo skill',
        sha256: sha(bodies['skills/demo-skill.md']) },
    ],
  });
  const srv = await serve(f);
  try {
    const res = await srv.get('/api/catalog');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.catalog.counts,
      { command: 1, prompt: 1, skill: 1 });
    const cmd = res.body.catalog.entries.command[0];
    assert.equal(cmd.id, 'demo-cmd');
    assert.equal(cmd.path, 'commands/demo-cmd.md');
    assert.deepEqual(cmd.modes, ['default']);
    assert.deepEqual(cmd.prompts, ['demo-prompt']);
    assert.deepEqual(cmd.skills, ['demo-skill']);
    assert.equal(res.body.catalog.entries.prompt[0].id, 'demo-prompt');
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

test('catalog doc endpoint serves the projected entry body', async () => {
  const f = baseFixture();
  const body = 'Prompt body\nsecond line\n';
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  writeFile(f.dir, '.tasksystem/prompts/demo-prompt.md', body);
  writeJson(f.dir, '.tasksystem/catalog.json', {
    schemaVersion: 2,
    entries: [
      { kind: 'prompt', id: 'demo-prompt', path: 'prompts/demo-prompt.md',
        description: 'Demo prompt', sha256: sha },
    ],
  });
  const srv = await serve(f);
  try {
    const res = await srv.get('/api/catalog/prompt/demo-prompt');
    assert.equal(res.status, 200);
    assert.equal(res.body.doc.id, 'demo-prompt');
    assert.equal(res.body.doc.body, body);
    assert.equal(res.body.doc.sha256, sha);
    const missing = await srv.get('/api/catalog/prompt/nope');
    assert.equal(missing.status, 404);
    const badId = await srv.get('/api/catalog/prompt/Bad..Id');
    assert.equal(badId.status, 400);
    const traversal = await srv.get('/api/catalog/rule/..%2Fsecret');
    assert.ok(traversal.status === 400 || traversal.status === 404);
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

test('unenrolled project reports null workspace and 404 scoped endpoints', async () => {
  const f = baseFixture();
  const srv = await serve(f);
  try {
    const ws = await srv.get('/api/workspace');
    assert.equal(ws.status, 200);
    assert.equal(ws.body.workspace, null);
    const ops = await srv.get('/api/journal/operations');
    assert.equal(ops.status, 404);
    assert.equal(ops.body.error.code, 'WORKSPACE_NOT_FOUND');
    const caps = await srv.get('/api/captures');
    assert.equal(caps.status, 404);
    assert.equal(caps.body.error.code, 'WORKSPACE_NOT_FOUND');
    const tasks = await srv.get('/api/tasks');
    assert.equal(tasks.status, 200);
    assert.equal(tasks.body.tasks.length, 0);
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});
