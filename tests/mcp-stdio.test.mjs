// SPDX-License-Identifier: Apache-2.0
// MCP stdio end-to-end: spawns the REAL server as a child process
// (bin/scopegrain.mjs mcp --project <dir>) and talks JSON-RPC over
// stdio through the official SDK client: initialize handshake,
// tools/list, real tool calls, clean close. The repo path contains a
// space ("VantaDB Proyect"), so everything goes through argv arrays —
// the SDK transport spawns without a shell and preserves them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport }
  from '@modelcontextprotocol/sdk/client/stdio.js';
import { createTask } from '../src/core/tasks.mjs';
import {
  VALID_ANSWERS, bootstrappedMiniCtx, cleanup,
} from './helpers.mjs';
import { cleanEnv } from './eval/lib/driver.mjs';

const BIN = fileURLToPath(new URL('../bin/scopegrain.mjs', import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('MCP stdio e2e: handshake, tools/list, real calls, clean close', async (t) => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    const task = createTask(ctx, {
      title: 'Stdio task', contract: 'C', authorContext: 'a', scope: [],
    });
    let stderrText = '';
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN, 'mcp', '--project', dir, '--config', '.scopegrain/config.json'],
      env: cleanEnv(),
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk) => { stderrText += chunk; });
    const client = new Client(
      { name: 'scopegrain-e2e-test', version: '0.0.0' },
      { capabilities: {} });
    let pid = null;
    try {
      await client.connect(transport); // initialize handshake
      pid = transport.pid;
      assert.ok(Number.isInteger(pid) && pid > 0, 'no child pid');
      // The server reserved stdout for the protocol; its notice went
      // to stderr, proving the stream separation held end to end.
      assert.ok(stderrText.includes('stdout is reserved'),
        `missing protocol note on stderr: ${stderrText.slice(0, 200)}`);

      const listed = await client.listTools();
      assert.ok(Array.isArray(listed.tools));
      assert.equal(listed.tools.length, 37);
      assert.ok(listed.tools.every((tool) =>
        typeof tool.name === 'string' && tool.name.startsWith('scopegrain_')));

      // A real call against stored state: the task we created in the
      // bound project must come back over the wire.
      const tasks = await client.callTool({
        name: 'scopegrain_list_tasks', arguments: {} });
      assert.notEqual(tasks.isError, true);
      const payload = JSON.parse(tasks.content[0].text);
      assert.ok(Array.isArray(payload.tasks));
      assert.ok(payload.tasks.some((item) => item.id === task.id),
        'stored task missing from list_tasks over stdio');

      // Self-describing inventory (bare array), derived from live
      // descriptors — must mirror tools/list exactly.
      const inventory = await client.callTool({
        name: 'scopegrain_mcp_inventory', arguments: {} });
      const inv = JSON.parse(inventory.content[0].text);
      assert.ok(Array.isArray(inv));
      assert.equal(inv.length, 37,
        `inventory drifted: ${JSON.stringify(inv).slice(0, 300)}`);
      assert.deepEqual(inv.map((entry) => entry.name).sort(),
        listed.tools.map((tool) => tool.name).sort());

      // Structured error surface, not a protocol crash: bogus args are
      // rejected with isError and the connection stays alive.
      const bad = await client.callTool({
        name: 'scopegrain_get_task', arguments: { id: '../escape' } });
      assert.equal(bad.isError, true);
      const alive = await client.callTool({
        name: 'scopegrain_list_tasks', arguments: {} });
      assert.notEqual(alive.isError, true);
    } finally {
      await client.close().catch(() => {});
    }
    // Clean close: stdin EOF must end the server process promptly
    // (transport.close() escalates to SIGKILL if it does not).
    if (pid !== null) {
      let gone = false;
      for (let i = 0; i < 40 && !gone; i += 1) {
        try {
          process.kill(pid, 0);
          await sleep(50);
        } catch {
          gone = true;
        }
      }
      assert.ok(gone, `server pid ${pid} still alive after close`);
    }
  } finally {
    cleanup(dir);
  }
}, { timeout: 120_000 });
