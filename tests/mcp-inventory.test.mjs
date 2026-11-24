// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createMCPTools } from '../src/mcp/server.mjs';
import { buildMcpInventory } from '../src/core/mcp-inventory.mjs';
import {
  bootstrappedCtx, cleanup, VALID_ANSWERS,
} from './helpers.mjs';

function ctxTools() {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  return { dir, tools: createMCPTools(ctx, z) };
}

test('inventory covers every registered tool exactly once', async () => {
  const { dir, tools } = ctxTools();
  try {
    const inventory = buildMcpInventory(tools);
    const invNames = new Set(inventory.map((i) => i.name));
    assert.equal(invNames.size, inventory.length);
    assert.equal(inventory.length, tools.length);
    for (const t of tools) assert.ok(invNames.has(t.name), t.name);
  } finally {
    cleanup(dir);
  }
});

test('disposition mirrors annotations; contract fields are present', async () => {
  const { dir, tools } = ctxTools();
  try {
    const inventory = buildMcpInventory(tools);
    const readOnly = inventory.filter((i) => i.disposition === 'read-only');
    const writes = inventory.filter((i) => i.disposition === 'local-write');
    assert.ok(readOnly.length > writes.length);
    for (const i of inventory) {
      assert.equal(i.contract_version, '1');
      const tool = tools.find((t) => t.name === i.name);
      // Backend-spawning reads disclose local network reach; pure local
      // tools stay 'never'. Non-idempotent writes are not retryable.
      assert.equal(i.network,
        tool.config.annotations.openWorldHint === true ? 'local' : 'never',
        i.name);
      assert.equal(i.retryable,
        tool.config.annotations.idempotentHint !== false, i.name);
      assert.ok(Array.isArray(i.capabilities.arguments));
      assert.equal(i.disposition === 'read-only',
        tool.config.annotations.readOnlyHint === true);
      assert.equal(i.capabilities.destructive,
        tool.config.annotations.destructiveHint === true);
    }
  } finally {
    cleanup(dir);
  }
});

test('scopegrain_mcp_inventory tool returns the live inventory', async () => {
  const { dir, tools } = ctxTools();
  try {
    const tool = tools.find((t) => t.name === 'scopegrain_mcp_inventory');
    assert.ok(tool, 'inventory tool registered');
    const res = await tool.handler({});
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.length, tools.length);
    assert.ok(payload.find((i) => i.name === 'scopegrain_mcp_inventory'));
  } finally {
    cleanup(dir);
  }
});

test('operation descriptors carry typed request + retryable errors', async () => {
  const { dir, tools } = ctxTools();
  try {
    const { buildOperationRegistry } = await import('../src/core/operations.mjs');
    const { toErrorPayload, err } = await import('../src/core/errors.mjs');
    const ops = buildOperationRegistry(tools);
    assert.ok(ops.mcp_inventory);
    assert.equal(ops.mcp_inventory.network, 'never');
    assert.equal(ops.mcp_inventory.kind, 'read-only');
    const writeOps = Object.values(ops).filter((o) => o.kind === 'local-write');
    assert.ok(writeOps.length > 0);
    for (const o of writeOps) {
      const codes = o.errors.map((e) => e.code);
      assert.ok(codes.includes('CAS_MISMATCH'));
      assert.ok(o.errors.find((e) => e.code === 'CAS_MISMATCH').retryable);
      assert.ok(!o.errors.find((e) => e.code === 'INVALID_ARGS').retryable);
    }
    // Structured payloads now carry the retryable bit.
    const p = toErrorPayload(err('CAS_MISMATCH', 'x'));
    assert.deepEqual(p, { code: 'CAS_MISMATCH', message: 'x', retryable: true });
    const q = toErrorPayload(err('INVALID_ARGS', 'y'));
    assert.equal(q.retryable, false);
  } finally {
    cleanup(dir);
  }
});
