// SPDX-License-Identifier: Apache-2.0
// MCP wave-2 tools: next_task selection/claim, meta patches, dispositions,
// worklog add/read, goals and metrics through the real handlers.
// SDK/zod are hard dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/core/config.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { updateTaskMeta } from '../src/core/transition.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeJson,
} from './helpers.mjs';

async function setup() {
  const { createMCPTools } = await import('../src/mcp/server.mjs');
  const { z } = await import('zod');
  const dir = makeTempDir('mcp-worklog');
  writeJson(dir, '.scopegrain/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  const { resolveContext } = await import('../src/core/context.mjs');
  const ctx = resolveContext({ project: dir });
  const tools = new Map(createMCPTools(ctx, z).map((x) => [x.name, x]));
  return { dir, ctx, tools };
}

const call = async (tools, name, args) => {
  const res = await tools.get(name).handler(args);
  if (res.isError) {
    throw new Error(res.content[0].text);
  }
  return JSON.parse(res.content[0].text);
};

const BASE = {
  title: 'T', contract: 'C', authorContext: 'a', scope: ['src/x'],
};

test('next_task selects by priority, skips claimed/iced/met-deps', async (t) => {
  const { dir, ctx, tools } = await setup();
  try {
    const low = createTask(ctx, { ...BASE, priority: 'p3' });
    const hi = createTask(ctx, { ...BASE, priority: 'p0' });
    createTask(ctx, BASE); // no priority, unclaimed
    const dep = createTask(ctx, {
      ...BASE, dependsOn: ['not-a-real-id'], priority: 'p0',
    });
    const iced = createTask(ctx, { ...BASE, priority: 'p0' });
    updateTaskMeta(ctx, {
      id: iced.id, expectedRevision: iced.revision,
      disposition: { kind: 'icebox' },
    });
    const r1 = await call(tools, 'scopegrain_next_task', {});
    assert.equal(r1.next.id, hi.id); // p0 beats p3 and unset
    // claim it; the next call must skip it
    const r2 = await call(tools, 'scopegrain_next_task',
      { claimBy: 'agent-a' });
    assert.equal(r2.claimed, true);
    const r3 = await call(tools, 'scopegrain_next_task', {});
    assert.equal(r3.next.id, low.id); // claimed + iced + unmet-deps all skipped
    // backlog filter
    const bl = createTask(ctx, { ...BASE, backlog: 'futuro' });
    const r4 = await call(tools, 'scopegrain_next_task',
      { backlog: 'futuro' });
    assert.equal(r4.next.id, bl.id);
  } finally { cleanup(dir); }
});

test('task_meta, disposition and memory/goal/metrics via handlers', async (t) => {
  const { dir, ctx, tools } = await setup();
  try {
    const task = createTask(ctx, {
      ...BASE, steps: [{ name: 'a' }],
    });
    const meta = await call(tools, 'scopegrain_task_meta', {
      id: task.id, expectedRevision: task.revision,
      set: { priority: 'p1', backlog: 'core' },
      addNote: 'from mcp',
      stepIndex: 0, stepStatus: 'done',
    });
    assert.equal(meta.schemaVersion, 3);
    assert.equal(meta.priority, 'p1');
    assert.equal(meta.steps[0].status, 'done');
    assert.deepEqual(meta.notes, ['from mcp']);
    const disp = await call(tools, 'scopegrain_task_disposition', {
      id: task.id, expectedRevision: meta.revision,
      kind: 'deferred', reason: 'waiting', by: 'mcp',
    });
    assert.equal(disp.disposition.kind, 'deferred');
    // memory logs
    const added = await call(tools, 'scopegrain_memory_add', {
      log: 'lessons', entry: { topic: 'x', text: 'learned' },
    });
    assert.ok(added.at);
    const read = await call(tools, 'scopegrain_memory_read',
      { log: 'lessons' });
    assert.equal(read.entries.length, 1);
    // goals
    const g = await call(tools, 'scopegrain_goal_create',
      { title: 'Ship', horizon: 'Q1' });
    await call(tools, 'scopegrain_goal_transition',
      { id: g.id, to: 'achieved' });
    const goals = await call(tools, 'scopegrain_goal_list', {});
    assert.equal(goals.goals[0].status, 'achieved');
    // metrics reflects everything
    const m = await call(tools, 'scopegrain_metrics', {});
    assert.equal(m.tasks.total, 1);
    assert.equal(m.tasks.byDisposition.deferred, 1);
    // error paths surface as isError, not throws
    const bad = await tools.get('scopegrain_task_meta').handler({
      id: task.id, expectedRevision: 99, set: { priority: 'p0' },
    });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /REVISION_MISMATCH/);
    const badKind = await tools.get('scopegrain_task_disposition').handler({
      id: task.id, expectedRevision: disp.revision, kind: 'bogus',
    });
    // strictify rejects the unknown enum? no - kind is a known arg; the
    // core validator rejects the invalid kind value.
    assert.equal(badKind.isError, true);
  } finally { cleanup(dir); }
});
