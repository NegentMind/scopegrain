// SPDX-License-Identifier: Apache-2.0
// MCP cases: importing never connects; descriptors are read-only and share
// the same bound context as the CLI. SDK/zod are hard dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/core/config.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { applyPlan, prepareInit } from '../src/core/bootstrap.mjs';
import {
  VALID_ANSWERS, bootstrappedCtx, cleanup, makeTempDir, writeJson,
} from './helpers.mjs';

const EXPECTED_TOOLS = [
  'scopegrain_inspect', 'scopegrain_status', 'scopegrain_context',
  'scopegrain_list_tasks',
  'scopegrain_get_task', 'scopegrain_check_action',
  'scopegrain_task_suggest',
  'scopegrain_catalog_list', 'scopegrain_catalog_get',
  'scopegrain_workflow_packet', 'scopegrain_plan_get',
  'scopegrain_plan_next', 'scopegrain_artifact_get',
  'scopegrain_session_get', 'scopegrain_session_resume',
  'scopegrain_resource_search', 'scopegrain_resource_diagnose',
  'scopegrain_specification_get', 'scopegrain_approval_get',
  'scopegrain_methodology_check',
  'scopegrain_memory_status', 'scopegrain_memory_get',
  'scopegrain_memory_search', 'scopegrain_memory_recall',
  'scopegrain_memory_context',
  'scopegrain_next_task', 'scopegrain_task_meta',
  'scopegrain_task_disposition', 'scopegrain_task_transition',
  'scopegrain_task_create', 'scopegrain_memory_add',
  'scopegrain_memory_read', 'scopegrain_goal_create',
  'scopegrain_goal_list', 'scopegrain_goal_transition',
  'scopegrain_metrics', 'scopegrain_mcp_inventory',
];

test('importing server.mjs does not start a server or require deps', async () => {
  const mod = await import('../src/mcp/server.mjs');
  assert.equal(typeof mod.startMCPServer, 'function');
  assert.equal(typeof mod.createMCPServer, 'function');
  assert.equal(typeof mod.createMCPTools, 'function');
});

test('descriptors are exactly 37 tools bound to ctx', async (t) => {
  const { z } = await import('zod');
  const { createMCPTools } = await import('../src/mcp/server.mjs');
  const { resolveContext } = await import('../src/core/context.mjs');
  const { dir, ctx } = bootstrappedCtx();
  try {
    const tools = createMCPTools(ctx, z);
    assert.equal(tools.length, 37);
    assert.equal(new Set(tools.map((x) => x.name)).size, 37);
    assert.deepEqual(tools.map((x) => x.name).sort(), [...EXPECTED_TOOLS].sort());
    const BACKEND_TOOLS = new Set([
      'scopegrain_context', 'scopegrain_session_resume',
      'scopegrain_memory_get', 'scopegrain_memory_search',
      'scopegrain_memory_recall', 'scopegrain_memory_context',
    ]);
    const DISCARD_TOOLS = new Set([
      'scopegrain_task_disposition', 'scopegrain_goal_transition',
    ]);
    for (const tool of tools) {
      assert.equal(
        tool.config.annotations.destructiveHint,
        DISCARD_TOOLS.has(tool.name), tool.name);
      assert.equal(
        tool.config.annotations.openWorldHint,
        BACKEND_TOOLS.has(tool.name), tool.name);
    }
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const get = tools.find((x) => x.name === 'scopegrain_get_task');
    // Unknown args are rejected outright, never silently redirected.
    const rejected = await get.handler({ id: task.id, project: '/etc' });
    assert.equal(rejected.isError, true);
    const res = await get.handler({ id: task.id });
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.id, task.id);
    const bad = await get.handler({ id: '../escape' });
    assert.equal(bad.isError, true);
    const check = tools.find((x) => x.name === 'scopegrain_check_action');
    const ok = await check.handler({ taskId: task.id, action: 'read' });
    assert.equal(JSON.parse(ok.content[0].text).allowed, true);
  } finally { cleanup(dir); }
});

test('in-memory transport round-trip lists and calls tools', async (t) => {
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { createMCPServer } = await import('../src/mcp/server.mjs');
  const dir = makeTempDir('mcp-transport');
  let server;
  let client;
  try {
    writeJson(dir, '.scopegrain/config.json',
      createConfig(dir, VALID_ANSWERS, {}));
    ({ server } = await createMCPServer({ project: dir }));
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([
      server.connect(serverT), client.connect(clientT),
    ]);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 37);
    assert.equal(new Set(tools.map((x) => x.name)).size, 37);
    assert.deepEqual(tools.map((x) => x.name).sort(), [...EXPECTED_TOOLS].sort());
    const DISCARD_TOOLS = new Set([
      'scopegrain_task_disposition', 'scopegrain_goal_transition',
    ]);
    assert.ok(tools.every((x) =>
      x.annotations?.destructiveHint === DISCARD_TOOLS.has(x.name)));
    const res = await client.callTool({
      name: 'scopegrain_check_action',
      arguments: { taskId: '00000000-0000-4000-8000-000000000000', action: 'read' },
    });
    assert.equal(res.isError, true); // task does not exist -> isError, not crash
  } finally {
    try { if (client) await client.close(); }
    finally {
      try { if (server) await server.close(); }
      finally { cleanup(dir); }
    }
  }
});

test('createMCPServer registers all tools without connecting', async (t) => {
  const { createMCPServer } = await import('../src/mcp/server.mjs');
  const dir = makeTempDir('mcp-server');
  let server;
  try {
    writeJson(dir, '.scopegrain/config.json',
      createConfig(dir, VALID_ANSWERS, {}));
    const created = await createMCPServer({ project: dir });
    server = created.server;
    assert.ok(server);
    assert.equal(created.ctx.projectRoot, dir);
  } finally {
    try { if (server) await server.close(); }
    finally { cleanup(dir); }
  }
});

test('memory tools: status reports unenrolled; get/search/recall fail closed without config', async (t) => {
  const { z } = await import('zod');
  const { resolveContext } = await import('../src/core/context.mjs');
  const { prepareWorkspace } = await import('../src/core/workspaces.mjs');
  const { createMCPTools } = await import('../src/mcp/server.mjs');
  const dir = makeTempDir('mcp-memory');
  try {
    writeJson(dir, '.scopegrain/config.json',
      createConfig(dir, VALID_ANSWERS, {}));
    const ctx = resolveContext({ project: dir });
    const prepared = prepareWorkspace(ctx, { areas: [{ key: 'a', name: 'A' }] });
    applyPlan(dir, [prepared.file]);
    const tools = new Map(createMCPTools(ctx, z).map((x) => [x.name, x]));

    const status = await tools.get('scopegrain_memory_status').handler({});
    const parsed = JSON.parse(status.content[0].text);
    assert.equal(parsed.configured, false);
    assert.equal(parsed.pendingCommittedEvents, 0);

    for (const [name, args] of [
      ['scopegrain_memory_get', { namespace: 'n', key: 'k' }],
      ['scopegrain_memory_search', { namespace: 'n', query: 'q' }],
      ['scopegrain_memory_recall', { query: 'q' }],
    ]) {
      const res = await tools.get(name).handler(args);
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /VANTADB_NOT_CONFIGURED/);
    }
    // Arg bounds rejected by wrap() before the handler runs.
    const bad = await tools.get('scopegrain_memory_get')
      .handler({ namespace: 'x'.repeat(5000), key: 'k' });
    assert.equal(bad.isError, true);
  } finally { cleanup(dir); }
});

test('scopegrain_context returns the shared session-start packet', async () => {
  const { z } = await import('zod');
  const { createMCPTools } = await import('../src/mcp/server.mjs');
  const { assembleContextPacket } =
    await import('../src/core/context-packet.mjs');
  const { prepareWorkspace } = await import('../src/core/workspaces.mjs');
  const { applyPlan } = await import('../src/core/bootstrap.mjs');
  const { dir, ctx } = bootstrappedCtx();
  try {
    // getWorkspace is intentionally fatal (same as the CLI): materialize
    // a minimal workspace before comparing packets.
    const ws = prepareWorkspace(ctx, { areas: [{ key: 'p', name: 'P' }] });
    applyPlan(dir, [ws.file]);
    const tools = createMCPTools(ctx, z);
    const tool = tools.find((x) => x.name === 'scopegrain_context');
    assert.ok(tool);
    const res = await tool.handler({});
    assert.equal(res.isError, undefined);
    const viaMcp = JSON.parse(res.content[0].text);
    // Untrusted-provenance marking is MCP-surface metadata — the packet
    // itself is identical modulo the two mark fields.
    assert.equal(viaMcp.trust, 'untrusted');
    assert.equal(viaMcp.source, 'session-packet');
    const direct = await assembleContextPacket(ctx, {});
    // Parity contract: identical section set; generatedAt/vantadb timing
    // legitimately differs between two calls.
    assert.deepEqual(Object.keys(viaMcp)
      .filter((k) => !['trust', 'source'].includes(k)).sort(),
      Object.keys(direct).sort());
    for (const key of ['instructions', 'config', 'methodology', 'intake',
        'project', 'workspace', 'tasks', 'goals',
        'pendingJournalOperations']) {
      assert.deepEqual(viaMcp[key], direct[key]);
    }
    // Unknown args are rejected by strictify, never silently stripped.
    const rejected = await tool.handler({ bogus: 1 });
    assert.equal(rejected.isError, true);
  } finally { cleanup(dir); }
});
