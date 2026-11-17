// MCP input hardening: tool arguments are bounded in BOTH layers. The zod
// inputSchema carries per-field maxLength (advertised in tools/list), and
// strictify rejects oversized serialized args for direct handler calls,
// which bypass zod. Skipped with reason without the optional deps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/core/config.mjs';
import {
  VALID_ANSWERS, bootstrappedCtx, cleanup, makeTempDir, writeJson,
} from './helpers.mjs';

const MAX_ARGS_BYTES = 65536;
const MAX_ARG_CHARS = 4096;

async function depsAvailable() {
  try {
    await import('@modelcontextprotocol/sdk/server/mcp.js');
    await import('zod');
    return true;
  } catch {
    return false;
  }
}

test('oversized serialized tool arguments are rejected INVALID_ARGS', async (t) => {
  if (!(await depsAvailable())) {
    t.skip('optional MCP dependencies are not installed');
    return;
  }
  const { z } = await import('zod');
  const { createMCPTools } = await import('../src/mcp/server.mjs');
  const { dir, ctx } = bootstrappedCtx();
  try {
    const tools = createMCPTools(ctx, z);
    const search = tools.find((x) => x.name === 'scopegrain_resource_search');
    // A free-text argument above the serialized ceiling must not reach the
    // handler: direct calls skip zod, so strictify is the real gate.
    const huge = await search.handler({ query: 'q'.repeat(MAX_ARGS_BYTES + 1) });
    assert.equal(huge.isError, true);
    const payload = JSON.parse(huge.content[0].text);
    assert.equal(payload.code, 'INVALID_ARGS');
    assert.ok(/exceed/.test(payload.message));
    // Combined args over the ceiling are rejected even when each is small.
    const packet = tools.find((x) => x.name === 'scopegrain_workflow_packet');
    const per = 'x'.repeat(Math.floor(MAX_ARGS_BYTES / 2));
    const combined = await packet.handler({ command: per, taskId: per });
    assert.equal(combined.isError, true);
    assert.equal(JSON.parse(combined.content[0].text).code, 'INVALID_ARGS');
    // A legitimately-sized free-text query still reaches domain logic.
    const ok = await search.handler({ query: 'skill' });
    assert.notEqual(ok.isError, true);
    // Unknown-arg rejection still fires under the cap.
    const bad = await search.handler({ query: 'skill', project: '/etc' });
    assert.equal(bad.isError, true);
    assert.match(JSON.parse(bad.content[0].text).message, /unknown tool argument/);
  } finally { cleanup(dir); }
});

test('advertised input schemas bound every string argument', async (t) => {
  if (!(await depsAvailable())) {
    t.skip('optional MCP dependencies are not installed');
    return;
  }
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { createMCPServer } = await import('../src/mcp/server.mjs');
  const dir = makeTempDir('mcp-limits');
  let server;
  let client;
  try {
    writeJson(dir, '.tasksystem/config.json',
      createConfig(dir, VALID_ANSWERS, {}));
    ({ server } = await createMCPServer({ project: dir }));
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    const { tools } = await client.listTools();
    assert.ok(tools.length > 0);
    for (const tool of tools) {
      const props = tool.inputSchema?.properties ?? {};
      for (const [name, prop] of Object.entries(props)) {
        assert.ok(
          Array.isArray(prop.enum)
            || (typeof prop.maxLength === 'number'
              && prop.maxLength <= MAX_ARG_CHARS),
          `${tool.name}.${name} lacks maxLength: ${JSON.stringify(prop)}`);
      }
    }
    // An over-limit argument is rejected through the real wire too.
    const res = await client.callTool({
      name: 'scopegrain_get_task',
      arguments: { id: 'x'.repeat(MAX_ARG_CHARS + 1) },
    });
    assert.equal(res.isError, true);
  } finally {
    try { if (client) await client.close(); }
    finally {
      try { if (server) await server.close(); }
      finally { cleanup(dir); }
    }
  }
});
