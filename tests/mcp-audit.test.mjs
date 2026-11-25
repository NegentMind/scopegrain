// SPDX-License-Identifier: Apache-2.0
// MCP audit fixes: honest inventory posture (network/retryable), human
// titles on all 37 tools, memory_recall machine-global leak warning,
// session_resume noVantadb/timeoutMs parity, structureDebounceMs on the
// context surface, untrusted-provenance marking, widened secret-egress
// patterns and persisted capture-review decisions.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan, preflightPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import { applyJournaledCreation } from '../src/core/journal.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { prepareSession } from '../src/core/sessions.mjs';
import { appendWorklog } from '../src/core/worklog.mjs';
import { secretEgressCheck } from '../src/integrations/vantadb.mjs';
import { buildMcpInventory } from '../src/core/mcp-inventory.mjs';
import {
  filterRejectedProposals, listProposalDecisions,
  persistProposalDecision, proposeFromInitAnswers, proposeFromJournal,
} from '../src/core/capture-proposals.mjs';
import {
  VALID_ANSWERS, bootstrappedCtx, cleanup, makeTempDir, writeJson,
} from './helpers.mjs';

const BACKEND_TOOLS = new Set([
  'scopegrain_context', 'scopegrain_session_resume',
  'scopegrain_memory_get', 'scopegrain_memory_search',
  'scopegrain_memory_recall', 'scopegrain_memory_context',
]);
const WRITE_TOOLS = new Set([
  'scopegrain_next_task', 'scopegrain_task_meta',
  'scopegrain_task_disposition', 'scopegrain_task_transition',
  'scopegrain_task_create', 'scopegrain_memory_add',
  'scopegrain_goal_create', 'scopegrain_goal_transition',
]);

async function toolsIn(ctx) {
  const { z } = await import('zod');
  const { createMCPTools } = await import('../src/mcp/server.mjs');
  return createMCPTools(ctx, z);
}

function miniCtx() {
  const dir = makeTempDir('mcp-audit');
  writeJson(dir, '.scopegrain/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  return { dir, ctx: resolveContext({ project: dir }) };
}

test('every registered tool advertises a non-empty human title, on the wire too', async (t) => {
  const { dir, ctx } = miniCtx();
  let server;
  let client;
  try {
    const tools = await toolsIn(ctx);
    assert.equal(tools.length, 39);
    for (const tool of tools) {
      assert.ok(typeof tool.config.title === 'string'
        && tool.config.title.trim() !== '', tool.name);
    }
    const { InMemoryTransport } =
      await import('@modelcontextprotocol/sdk/inMemory.js');
    const { Client } =
      await import('@modelcontextprotocol/sdk/client/index.js');
    const { createMCPServer } = await import('../src/mcp/server.mjs');
    ({ server } = await createMCPServer({ project: dir }));
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    const { tools: listed } = await client.listTools();
    for (const tool of listed) {
      assert.ok(typeof tool.title === 'string' && tool.title !== '',
        tool.name);
    }
  } finally {
    try { if (client) await client.close(); }
    finally {
      try { if (server) await server.close(); }
      finally { cleanup(dir); }
    }
  }
});

test('inventory reports honest network class and retryable posture', async () => {
  const { dir, ctx } = miniCtx();
  try {
    const tools = await toolsIn(ctx);
    const inventory = buildMcpInventory(tools);
    for (const i of inventory) {
      assert.equal(i.network, BACKEND_TOOLS.has(i.name) ? 'local' : 'never',
        i.name);
      assert.equal(i.retryable, !WRITE_TOOLS.has(i.name), i.name);
    }
  } finally { cleanup(dir); }
});

test('memory_recall schema discloses the machine-global cross-project leak', async () => {
  const { dir, ctx } = miniCtx();
  try {
    const tools = await toolsIn(ctx);
    const tool = tools.find((x) => x.name === 'scopegrain_memory_recall');
    assert.match(tool.config.description, /machine-global/);
    assert.match(tool.config.description, /other projects/i);
    assert.match(
      tool.config.inputSchema.scope.description, /machine-global/);
    assert.match(
      tool.config.inputSchema.scope.description, /cross-project/);
  } finally { cleanup(dir); }
});

test('session_resume honors noVantadb/timeoutMs parity with the CLI', async () => {
  const { dir, ctx } = miniCtx();
  try {
    const tools = new Map(
      (await toolsIn(ctx)).map((x) => [x.name, x]));
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const prepared = prepareSession(ctx, { taskId: task.id, limit: 3 });
    applyPlan(dir, preflightPlan(dir, [prepared.file]));
    const tool = tools.get('scopegrain_session_resume');
    const skipped = await tool.handler(
      { id: prepared.session.id, noVantadb: true });
    assert.equal(skipped.isError, undefined);
    const parsed = JSON.parse(skipped.content[0].text);
    assert.equal(parsed.vantadb.skipped, true);
    // Untrusted marking rides along on the resume payload.
    assert.equal(parsed.trust, 'untrusted');
    assert.equal(skipped._meta['scopegrain/trust'], 'untrusted');
    assert.equal(
      skipped.content[0]._meta['scopegrain/trust'], 'untrusted');
    // timeoutMs is accepted; unenrolled backend degrades to enrolled:false.
    const bounded = await tool.handler(
      { id: prepared.session.id, timeoutMs: 5000 });
    const parsedBounded = JSON.parse(bounded.content[0].text);
    assert.equal(parsedBounded.vantadb.enrolled, false);
    // Unknown args are still rejected.
    const bad = await tool.handler(
      { id: prepared.session.id, vantadb: true });
    assert.equal(bad.isError, true);
  } finally { cleanup(dir); }
});

test('context exposes structureDebounceMs and marks the packet untrusted', async () => {
  const { dir, ctx } = miniCtx();
  try {
    const prepared = prepareWorkspace(ctx,
      { areas: [{ key: 'p', name: 'P' }] });
    applyPlan(dir, [prepared.file]);
    const tools = new Map(
      (await toolsIn(ctx)).map((x) => [x.name, x]));
    const tool = tools.get('scopegrain_context');
    const res = await tool.handler(
      { noVantadb: true, structureDebounceMs: 60000 });
    assert.equal(res.isError, undefined);
    const packet = JSON.parse(res.content[0].text);
    assert.ok('structure' in packet);
    assert.equal(packet.trust, 'untrusted');
    assert.equal(packet.source, 'session-packet');
    // A debounced second call serves the same fresh status from cache.
    const cached = await tool.handler(
      { noVantadb: true, structureDebounceMs: 60000 });
    assert.equal(cached.isError, undefined);
    assert.equal(
      JSON.parse(cached.content[0].text).structure.cached, true);
  } finally { cleanup(dir); }
});

test('untrusted marking lands on catalog and worklog payloads at both levels', async () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const tools = new Map(
      (await toolsIn(ctx)).map((x) => [x.name, x]));
    const list = await tools.get('scopegrain_catalog_list').handler({});
    assert.equal(list._meta['scopegrain/trust'], 'untrusted');
    assert.equal(list.content[0]._meta['scopegrain/trust'], 'untrusted');
    const listed = JSON.parse(list.content[0].text);
    assert.equal(listed.trust, 'untrusted');
    assert.equal(listed.source, 'catalog');
    const e0 = listed.entries[0];
    const get = await tools.get('scopegrain_catalog_get')
      .handler({ kind: e0.kind, id: e0.id });
    const got = JSON.parse(get.content[0].text);
    assert.equal(got.trust, 'untrusted');
    assert.ok(typeof got.content === 'string' && got.content.length > 0);
    appendWorklog(ctx, 'progress', {
      taskId: crypto.randomUUID(), title: 'note', kind: 'action',
    });
    const read = await tools.get('scopegrain_memory_read')
      .handler({ log: 'progress' });
    const log = JSON.parse(read.content[0].text);
    assert.equal(log.trust, 'untrusted');
    assert.equal(log.source, 'worklog');
    assert.equal(log.entries.length, 1);
    // Structured record readers stay unmarked.
    const status = await tools.get('scopegrain_memory_status').handler({});
    assert.equal(status._meta, undefined);
    assert.equal(JSON.parse(status.content[0].text).trust, undefined);
  } finally { cleanup(dir); }
});

test('secretEgressCheck catches JWT, Azure, Stripe and Slack app shapes', () => {
  for (const text of [
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0'
      + '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    'DefaultEndpointsProtocol=https;AccountName=store;'
      + 'AccountKey=AKs7d9f8g7h6j5k4l3m2n1b0v9c8x7z6a5s4d3f2g1h==',
    'AccountKey=AKs7d9f8g7h6j5k4l3m2n1b0v9c8x7z6a5s4d3f2g1h==',
    'key = sk_live_4eC39HqLyjWDarjtT1zdp7dc',
    'token xapp-A0ABC12345-1234567890-abcdef123456',
  ]) {
    assert.notEqual(secretEgressCheck(text), null, text);
  }
  assert.equal(secretEgressCheck('plain note about deploys'), null);
});

function proposalFixture() {
  const { dir, ctx } = miniCtx();
  const prepared = prepareWorkspace(ctx,
    { areas: [{ key: 'a', name: 'A' }] });
  applyPlan(dir, [prepared.file]);
  const [a] = prepared.workspace.areas.map((area) => area.id);
  const bound = bindWorkspace(ctx, { areaIds: [a] });
  return { dir, ctx, a, bound };
}

test('persisted rejections suppress re-emission and stay hash-bound', () => {
  const f = proposalFixture();
  try {
    applyJournaledCreation(f.bound, [{
      sourceKind: 'task', recordId: 't-1', sourceRevision: 0,
      areaIds: [f.a],
      file: { rel: 'records/t-1', content: 'created t-1' },
    }]);
    const proposals = proposeFromJournal(f.bound);
    assert.ok(proposals.length >= 1);
    const target = proposals[0];
    // Pure path writes nothing.
    const { review, decision } = persistProposalDecision(
      f.bound, target, { action: 'reject', reason: 'noise' });
    assert.equal(review.status, 'rejected');
    assert.equal(decision.schemaVersion, 1);
    assert.equal(decision.action, 'reject');
    assert.match(decision.proposalHash, /^[0-9a-f]{64}$/);
    const log = path.join(
      f.dir, '.scopegrain/state/capture-proposal-decisions.jsonl');
    assert.ok(fs.existsSync(log));
    const { decisions, malformed } = listProposalDecisions(f.bound);
    assert.equal(malformed.length, 0);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].proposalId, target.proposalId);
    // The rejected proposal no longer reappears.
    assert.equal(proposeFromJournal(f.bound)
      .some((p) => p.proposalId === target.proposalId), false);
    // A reject bound to a different proposal hash never suppresses.
    const other = { ...decision, proposalHash: '0'.repeat(64) };
    assert.equal(filterRejectedProposals(proposals, [other]).length,
      proposals.length);
    // Latest decision wins: a re-approve re-opens emission.
    persistProposalDecision(f.bound, target, { action: 'approve' });
    assert.equal(proposeFromJournal(f.bound)
      .some((p) => p.proposalId === target.proposalId), true);
    // Pure producers apply the same rule through the exported filter.
    const prefs = proposeFromInitAnswers(VALID_ANSWERS,
      { areaIds: [f.a] });
    persistProposalDecision(f.bound, prefs[0], { action: 'reject' });
    const stored = listProposalDecisions(f.bound).decisions;
    assert.equal(filterRejectedProposals(prefs, stored)
      .some((p) => p.proposalId === prefs[0].proposalId), false);
    // Invalid proposals/decisions never reach the log.
    assert.throws(() => persistProposalDecision(f.bound,
      { ...target, proposalId: 'nope' }, { action: 'reject' }),
      (e) => e.code === 'INVALID_PROPOSAL');
    assert.throws(() => persistProposalDecision(f.bound,
      target, { action: 'bogus' }), (e) => e.code === 'INVALID_PROPOSAL');
    assert.equal(
      fs.readFileSync(log, 'utf8').trim().split('\n').length, 3);
  } finally { cleanup(f.dir); }
});
