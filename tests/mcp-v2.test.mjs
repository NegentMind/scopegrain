// SPDX-License-Identifier: Apache-2.0
// MCP wave-2 additions: task_transition/task_create (CLI parity, dry-run
// by default, apply commits), outputSchema + structuredContent on the
// wire, and the session_resume naming clarification. SDK/zod are hard
// dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/core/config.mjs';
import { createTask, getTask } from '../src/core/tasks.mjs';
import { transitionTask } from '../src/core/transition.mjs';
import {
  VALID_ANSWERS, bootstrappedCtx, cleanup, makeTempDir, writeJson,
} from './helpers.mjs';

const parsed = (res) => {
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  return JSON.parse(res.content[0].text);
};
const ownError = (res, code) => {
  assert.equal(res.isError, true);
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.code, code);
  return payload;
};

async function setup() {
  const { z } = await import('zod');
  const { createMCPTools } = await import('../src/mcp/server.mjs');
  const { resolveContext } = await import('../src/core/context.mjs');
  const dir = makeTempDir('mcp-v2');
  writeJson(dir, '.scopegrain/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir });
  const tools = new Map(createMCPTools(ctx, z).map((x) => [x.name, x]));
  return { dir, ctx, tools };
}

async function withWire(dir, body) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } =
    await import('@modelcontextprotocol/sdk/inMemory.js');
  const { createMCPServer } = await import('../src/mcp/server.mjs');
  const { server } = await createMCPServer({ project: dir });
  const client = new Client({ name: 'mcp-v2-test', version: '0.0.0' });
  try {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    await body(client);
  } finally {
    try { await client.close(); }
    finally { await server.close(); }
  }
}

test('task_transition drives the FSM: dry-run preview then applied CAS write', async () => {
  const { dir, ctx, tools } = await setup();
  try {
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const tool = tools.get('scopegrain_task_transition');
    // Default is dry-run: exact next record, no write.
    const dry = parsed(await tool.handler({
      taskId: task.id, to: 'ACT', expectedRevision: 0,
    }));
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.applied, false);
    assert.equal(dry.task.state, 'ACT');
    assert.equal(dry.task.revision, 1);
    assert.equal(getTask(ctx, task.id).state, 'PLAN'); // untouched
    // apply commits through transitionTask.
    const applied = parsed(await tool.handler({
      taskId: task.id, to: 'ACT', expectedRevision: 0, apply: true,
    }));
    assert.equal(applied.mode, 'applied');
    assert.equal(applied.applied, true);
    assert.equal(applied.task.state, 'ACT');
    assert.equal(getTask(ctx, task.id).state, 'ACT');
    // CAS rejection and policy rejection surface as domain errors.
    ownError(await tool.handler({
      taskId: task.id, to: 'VERIFY', expectedRevision: 0, apply: true,
    }), 'REVISION_MISMATCH');
    ownError(await tool.handler({
      taskId: task.id, to: 'CLOSE', expectedRevision: 1, apply: true,
    }), 'INVALID_TRANSITION');
    ownError(await tool.handler({
      taskId: task.id, to: 'ACT', expectedRevision: 1,
      verification: { checks: [] },
    }), 'INVALID_EVIDENCE');
    ownError(await tool.handler({ taskId: task.id, to: 'ACT' }),
      'REVISION_MISMATCH');
    ownError(await tool.handler({
      taskId: task.id, to: 'ACT', expectedRevision: 1, project: '/etc',
    }), 'INVALID_ARGS');
  } finally { cleanup(dir); }
});

test('task_create preview/apply with flat fields and full input document', async () => {
  const { dir, ctx, tools } = await setup();
  try {
    const tool = tools.get('scopegrain_task_create');
    // Flat form dry-run: record preview, nothing written.
    const dry = parsed(await tool.handler({
      title: 'From MCP', contract: 'Do X', authorContext: 'agent',
      scope: ['src/x'], dependsOn: [],
    }));
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.task.state, 'PLAN');
    assert.equal(dry.task.slug !== null, true);
    // Flat form apply persists a readable record.
    const applied = parsed(await tool.handler({
      title: 'From MCP', contract: 'Do X', authorContext: 'agent',
      scope: ['src/x'], apply: true,
    }));
    assert.equal(applied.mode, 'applied');
    assert.equal(getTask(ctx, applied.task.id).title, 'From MCP');
    // Full input document form (V3 fields flow through normalization).
    const viaInput = parsed(await tool.handler({
      input: {
        title: 'Doc input', contract: 'C', authorContext: 'a',
        scope: [], priority: 'p1', backlog: 'core',
      },
      apply: true,
    }));
    assert.equal(viaInput.task.priority, 'p1');
    assert.equal(getTask(ctx, viaInput.task.id).backlog, 'core');
    // input + flat field is rejected, same as --input + legacy flags.
    ownError(await tool.handler({
      input: { title: 'x', contract: 'c', authorContext: 'a' },
      title: 'x',
    }), 'INVALID_ARGS');
    // Missing required content fails through the core validator.
    ownError(await tool.handler({ title: 'only title' }), 'INVALID_VALUE');
    // Unknown keys on the input document surface UNKNOWN_KEY.
    ownError(await tool.handler({
      input: { title: 'x', contract: 'c', authorContext: 'a', bogus: 1 },
    }), 'UNKNOWN_KEY');
  } finally { cleanup(dir); }
});

test('wire: both new tools round-trip with structuredContent and advertised outputSchema', async () => {
  const { dir } = await setup();
  try {
    await withWire(dir, async (client) => {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 39);
      for (const t of tools) {
        assert.equal(t.outputSchema?.type, 'object', t.name);
      }
      const created = await client.callTool({
        name: 'scopegrain_task_create',
        arguments: {
          title: 'Wire task', contract: 'C', authorContext: 'a',
          apply: true,
        },
      });
      assert.equal(created.isError, undefined);
      assert.equal(created.structuredContent.mode, 'applied');
      const id = created.structuredContent.task.id;
      const transition = await client.callTool({
        name: 'scopegrain_task_transition',
        arguments: {
          taskId: id, to: 'ACT', expectedRevision: 0, apply: true,
        },
      });
      assert.equal(transition.structuredContent.task.state, 'ACT');
      // Wire-level input validation still rejects unknown args first.
      const bad = await client.callTool({
        name: 'scopegrain_task_transition',
        arguments: { taskId: id, to: 'ACT', expectedRevision: 1, extra: 1 },
      });
      assert.equal(bad.isError, true);
      assert.match(bad.content[0].text, /Input validation error/);
      // Domain errors ride back as the JSON payload, not a crash.
      const stale = await client.callTool({
        name: 'scopegrain_task_transition',
        arguments: { taskId: id, to: 'VERIFY', expectedRevision: 0,
          apply: true },
      });
      assert.equal(stale.isError, true);
      assert.equal(JSON.parse(stale.content[0].text).code,
        'REVISION_MISMATCH');
    });
  } finally { cleanup(dir); }
});

test('structuredContent mirrors text on success, including untrusted payloads', async () => {
  const { dir, ctx, tools } = await setup();
  const { dir: dir2, ctx: ctx2 } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const get = await tools.get('scopegrain_get_task')
      .handler({ id: task.id });
    assert.equal(get.structuredContent.id, task.id);
    assert.deepEqual(get.structuredContent,
      JSON.parse(get.content[0].text));
    // Non-object payloads are enveloped so structuredContent stays an
    // object (the inventory returns a bare array).
    const inv = await tools.get('scopegrain_mcp_inventory').handler({});
    assert.equal(Array.isArray(inv.structuredContent.result), true);
    assert.equal(inv.structuredContent.result.length, 39);
    // Untrusted payloads keep the mark at the structured level too.
    const { z } = await import('zod');
    const { createMCPTools } = await import('../src/mcp/server.mjs');
    const cat = await createMCPTools(ctx2, z)
      .find((x) => x.name === 'scopegrain_catalog_list').handler({});
    assert.equal(cat.structuredContent.trust, 'untrusted');
    assert.equal(cat.structuredContent.source, 'catalog');
  } finally { cleanup(dir); cleanup(dir2); }
});

test('session_resume description discloses operational-only restore semantics', async () => {
  const { dir, tools } = await setup();
  try {
    const tool = tools.get('scopegrain_session_resume');
    assert.match(tool.config.description, /NOT conversation history/i);
    assert.match(tool.config.description, /operational/i);
  } finally { cleanup(dir); }
});
