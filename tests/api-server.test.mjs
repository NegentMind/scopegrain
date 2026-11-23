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
import { fileURLToPath } from 'node:url';
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

const CONFIG_REL = '.scopegrain/config.json';

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

async function serve(fixture, options = {}) {
  const api = createApiServer({
    project: fixture.dir, config: CONFIG_REL, port: 0, ...options,
  });
  const bound = await api.listen();
  const base = `http://${api.host}:${bound.port}`;
  return {
    base,
    get: async (rel) => {
      const res = await fetch(`${base}${rel}`);
      return { status: res.status, body: await res.json() };
    },
    put: async (rel, payload, headers = {}) => {
      const res = await fetch(`${base}${rel}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: typeof payload === 'string' ? payload : JSON.stringify(payload),
      });
      return { status: res.status, body: await res.json() };
    },
    getRaw: (rel) => fetch(`${base}${rel}`),
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
    writeFile(f.dir, `.scopegrain/${rel}`, content);
  }
  writeJson(f.dir, '.scopegrain/catalog.json', {
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
  writeFile(f.dir, '.scopegrain/prompts/demo-prompt.md', body);
  writeJson(f.dir, '.scopegrain/catalog.json', {
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

// --- PUT /api/catalog/:kind/:id (opt-in --allow-write) --------------------
//
// One pinned prompt entry in a minimal catalog.json snapshot; the sha256
// pin is real so the verified workspace-catalog load succeeds.
function writableCatalogFixture() {
  const f = baseFixture();
  const body = 'Prompt body\nsecond line\n';
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  writeFile(f.dir, '.scopegrain/prompts/demo-prompt.md', body);
  writeJson(f.dir, '.scopegrain/catalog.json', {
    schemaVersion: 2,
    entries: [
      { kind: 'prompt', id: 'demo-prompt', path: 'prompts/demo-prompt.md',
        description: 'Demo prompt', sha256: sha },
    ],
  });
  return { ...f, body, sha };
}

const PROMPT_FILE = '.scopegrain/prompts/demo-prompt.md';
const sha256Of = (s) =>
  crypto.createHash('sha256').update(s).digest('hex');
const readDoc = (dir) =>
  fs.readFileSync(path.join(dir, ...PROMPT_FILE.split('/')), 'utf8');
const readManifest = (dir) => JSON.parse(
  fs.readFileSync(path.join(dir, '.scopegrain/catalog.json'), 'utf8'));

test('PUT catalog doc without --allow-write is 403 WRITE_DISABLED', async () => {
  const f = writableCatalogFixture();
  const srv = await serve(f); // no allowWrite
  try {
    const res = await srv.put('/api/catalog/prompt/demo-prompt',
      { content: 'edited\n', expectedSha256: f.sha });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'WRITE_DISABLED');
    // Nothing changed on disk or in the manifest.
    assert.equal(readDoc(f.dir), f.body);
    assert.equal(readManifest(f.dir).entries[0].sha256, f.sha);
    // The doc reports itself read-only.
    const doc = await srv.get('/api/catalog/prompt/demo-prompt');
    assert.equal(doc.body.doc.writable, false);
    // Other write verbs on write-capable and plain routes stay 405/404.
    const otherMethod = await fetch(
      `${srv.base}/api/catalog/prompt/demo-prompt`, { method: 'DELETE' });
    assert.equal(otherMethod.status, 405);
    await otherMethod.text();
    const wrongRoute = await srv.put('/api/tasks',
      { content: 'x', expectedSha256: f.sha });
    assert.equal(wrongRoute.status, 405);
    const unknown = await srv.put('/api/nope',
      { content: 'x', expectedSha256: f.sha });
    assert.equal(unknown.status, 404);
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

test('PUT catalog doc applies atomically, repins and GET reflects', async () => {
  const f = writableCatalogFixture();
  const srv = await serve(f, { allowWrite: true });
  try {
    // The write-enabled doc advertises writability.
    const before = await srv.get('/api/catalog/prompt/demo-prompt');
    assert.equal(before.body.doc.writable, true);

    const next = 'Prompt body\nedited line\n';
    const newSha = sha256Of(next);
    const res = await srv.put('/api/catalog/prompt/demo-prompt',
      { content: next, expectedSha256: f.sha });
    assert.equal(res.status, 200);
    assert.equal(res.body.applied, true);
    assert.equal(res.body.sha256, newSha);
    assert.equal(res.body.id, 'demo-prompt');
    assert.equal(readDoc(f.dir), next);
    // Only the matching entry's pin is updated.
    assert.equal(readManifest(f.dir).entries[0].sha256, newSha);
    // The verified snapshot stays internally consistent: the catalog
    // endpoint still loads and the doc serves the new body + pin.
    const cat = await srv.get('/api/catalog');
    assert.equal(cat.status, 200);
    const got = await srv.get('/api/catalog/prompt/demo-prompt');
    assert.equal(got.status, 200);
    assert.equal(got.body.doc.body, next);
    assert.equal(got.body.doc.sha256, newSha);
    // CAS moves forward: the stale pin now conflicts, the fresh one passes.
    const stale = await srv.put('/api/catalog/prompt/demo-prompt',
      { content: 'again\n', expectedSha256: f.sha });
    assert.equal(stale.status, 409);
    const chained = await srv.put('/api/catalog/prompt/demo-prompt',
      { content: 'again\n', expectedSha256: newSha });
    assert.equal(chained.status, 200);
    assert.equal(readDoc(f.dir), 'again\n');
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

test('PUT catalog doc rejects stale sha, bad input and oversized bodies', async () => {
  const f = writableCatalogFixture();
  const srv = await serve(f, { allowWrite: true });
  try {
    // Stale CAS token → 409, nothing written.
    const stale = await srv.put('/api/catalog/prompt/demo-prompt',
      { content: 'clobber\n', expectedSha256: '0'.repeat(64) });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'WRITE_CONFLICT');
    assert.equal(readDoc(f.dir), f.body);
    assert.equal(readManifest(f.dir).entries[0].sha256, f.sha);

    // Traversal/invalid ids are rejected before any filesystem touch.
    const badId = await srv.put('/api/catalog/prompt/Bad..Id',
      { content: 'x', expectedSha256: f.sha });
    assert.equal(badId.status, 400);
    assert.equal(badId.body.error.code, 'INVALID_ID');
    const traversal = await srv.put('/api/catalog/rule/..%2Fsecret',
      { content: 'x', expectedSha256: f.sha });
    assert.equal(traversal.status, 400);
    const missingEntry = await srv.put('/api/catalog/prompt/nope',
      { content: 'x', expectedSha256: f.sha });
    assert.equal(missingEntry.status, 404);

    // Closed request schema: wrong content-type, non-JSON body, missing
    // or extra keys and malformed sha all fail closed.
    const wrongType = await srv.put('/api/catalog/prompt/demo-prompt',
      'content=x', { 'Content-Type': 'text/plain' });
    assert.equal(wrongType.status, 400);
    assert.equal(wrongType.body.error.code, 'INVALID_BODY');
    const notJson = await srv.put('/api/catalog/prompt/demo-prompt',
      '{nope');
    assert.equal(notJson.status, 400);
    assert.equal(notJson.body.error.code, 'INVALID_BODY');
    const missingSha = await srv.put('/api/catalog/prompt/demo-prompt',
      { content: 'x' });
    assert.equal(missingSha.status, 400);
    const badSha = await srv.put('/api/catalog/prompt/demo-prompt',
      { content: 'x', expectedSha256: 'not-a-sha' });
    assert.equal(badSha.status, 400);
    const extraKey = await srv.put('/api/catalog/prompt/demo-prompt',
      { content: 'x', expectedSha256: f.sha, hack: true });
    assert.equal(extraKey.status, 400);
    const wrongContent = await srv.put('/api/catalog/prompt/demo-prompt',
      { content: 42, expectedSha256: f.sha });
    assert.equal(wrongContent.status, 400);
    const badQuery = await srv.put('/api/catalog/prompt/demo-prompt?x=1',
      { content: 'x', expectedSha256: f.sha });
    assert.equal(badQuery.status, 400);
    assert.equal(badQuery.body.error.code, 'INVALID_QUERY');

    // Content above the document cap → 422; the file is untouched.
    const oversize = 'x'.repeat(1048576 + 1); // > maxDocumentBytes
    const tooBig = await srv.put('/api/catalog/prompt/demo-prompt',
      { content: oversize, expectedSha256: f.sha });
    assert.equal(tooBig.status, 422);
    assert.equal(tooBig.body.error.code, 'DOCUMENT_TOO_LARGE');
    assert.equal(readDoc(f.dir), f.body);
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

// --- sendStatic (viewer/dist static mount) -----------------------------------
//
// sendStatic serves viewer/dist — a gitignored build artifact that may not
// exist on a clean checkout. The tests materialize the minimal files they
// need and remove only what they created, so they pass both against a real
// build and against an absent dist directory.
const VIEWER_DIST = fileURLToPath(
  new URL('../viewer/dist/', import.meta.url));

function staticFixture() {
  const created = [];
  const distExisted = fs.existsSync(VIEWER_DIST);
  const assetsDir = path.join(VIEWER_DIST, 'assets');
  const assetsExisted = fs.existsSync(assetsDir);
  const ensure = (rel, content) => {
    const abs = path.join(VIEWER_DIST, ...rel.split('/'));
    if (fs.existsSync(abs)) return;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    created.push(abs);
  };
  ensure('index.html', '<!doctype html><title>static fixture</title>\n');
  ensure('assets/static-fixture.css', 'body{}\n');
  return {
    cleanup() {
      for (const abs of created) fs.rmSync(abs, { force: true });
      if (!assetsExisted) {
        fs.rmSync(assetsDir, { recursive: true, force: true });
      }
      if (!distExisted) {
        fs.rmSync(VIEWER_DIST, { recursive: true, force: true });
      }
    },
  };
}

test('sendStatic rejects traversal segments and out-of-root paths', async () => {
  const f = baseFixture();
  const srv = await serve(f);
  try {
    // Encoded '.'/'..' segments are decoded after the URL split, so the
    // traversal guard sees them; when the Node URL parser normalizes
    // %2e%2e before the split, the segment collapses harmlessly into a
    // plain in-root path (404 without dist, or the SPA index.html when a
    // viewer build exists). Any outcome is safe as long as no file from
    // outside the root is served — so accept a rejection or the HTML
    // fallback, never a 200 serving non-HTML file content.
    for (const rel of [
      '/%2e%2e/secret',
      '/%2E%2E/%2E%2E/etc/passwd',
      '/assets/..%2F..%2Fpackage.json',
    ]) {
      const res = await srv.getRaw(rel);
      const type = res.headers.get('content-type') ?? '';
      assert.ok(
        res.status === 400 || res.status === 404
          || (res.status === 200 && type.includes('text/html')),
        `${rel} -> ${res.status} ${type}`);
    }
  } finally {
    await srv.close();
    cleanup(f.dir);
  }
});

test('sendStatic SPA fallback serves index.html with no-store', async () => {
  const f = baseFixture();
  const fix = staticFixture();
  const srv = await serve(f);
  try {
    // Extensionless paths that do not match a file fall back to the SPA
    // entry point so client-side routes load.
    const res = await fetch(`${srv.base}/tasks`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(await res.text(), /html/i);

    // A missing path with an extension must NOT fall back.
    const missing = await srv.get('/no-such-file.css');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
  } finally {
    await srv.close();
    fix.cleanup();
    cleanup(f.dir);
  }
});

test('sendStatic types bodies and caches hashed assets immutably', async () => {
  const f = baseFixture();
  const fix = staticFixture();
  const srv = await serve(f);
  try {
    const css = await fetch(`${srv.base}/assets/static-fixture.css`);
    assert.equal(css.status, 200);
    assert.equal(
      css.headers.get('content-type'), 'text/css; charset=utf-8');
    // Content-addressed assets are immutable; index.html is not.
    assert.equal(css.headers.get('cache-control'),
      'public, max-age=31536000, immutable');
    await css.text();

    const index = await fetch(`${srv.base}/index.html`);
    assert.equal(index.status, 200);
    assert.equal(
      index.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(index.headers.get('cache-control'), 'no-store');
    assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
    assert.match(
      String(index.headers.get('content-security-policy')),
      /default-src 'self'/);
    await index.text();
  } finally {
    await srv.close();
    fix.cleanup();
    cleanup(f.dir);
  }
});
