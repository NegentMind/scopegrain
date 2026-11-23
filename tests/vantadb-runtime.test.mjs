// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { applyJournaledCreation, listJournalPending } from '../src/core/journal.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import {
  DEFAULT_VANTADB_VERSION, VANTADB_BACKEND_ID, createStdioMcpClient,
  ensureVantaDBBinary, callVantaDBTool, getVantaDBRecord, loadVantaDBConfig, releaseAsset,
  vantaDBContext, vantaDBDistill, vantaDBProbe,
  requireVantaDBConfig, saveVantaDBConfig, syncVantaDB, targetTriple,
  vantaDBReinforce, vantaDBStatus, vantaDBSyncPersona, vantaDBSyncWorklogs,
} from '../src/integrations/vantadb-runtime.mjs';
import { createCaptureStore } from '../src/core/captures.mjs';
import { appendWorklog } from '../src/core/worklog.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeJson, withEnv,
} from './helpers.mjs';

const FAKE_SERVER = fileURLToPath(
  new URL('./fixtures/fake-vantadb-mcp.mjs', import.meta.url));

function fixture() {
  const dir = makeTempDir('vantadb-runtime');
  writeJson(dir, '.tasksystem/config.json', createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir, config: '.tasksystem/config.json' });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  return { dir, ctx, a, b, bound: bindWorkspace(ctx, { areaIds: [a, b] }) };
}

// Enrolled binaries must resolve OUTSIDE the project root (a versioned
// config must never select in-repo bytes to execute). Fixtures put the
// fake server in a sibling temp dir, mirroring the real installRoot
// under ~/.scopegrain/vantadb.
function cfg(dir, storagePath) {
  const binDir = path.join(path.dirname(dir), `bin-${path.basename(dir)}`);
  fs.mkdirSync(binDir, { recursive: true });
  const binaryPath = path.join(binDir, 'vantadb-server');
  // The enrolled digest is verified against the real file before every
  // spawn: write the placeholder once so cfg() returns a pinned config.
  // Call sites that rewrite 'placeholder' keep the same digest.
  if (!fs.existsSync(binaryPath)) fs.writeFileSync(binaryPath, 'placeholder');
  return {
    schemaVersion: 1, backendId: VANTADB_BACKEND_ID,
    version: DEFAULT_VANTADB_VERSION,
    binaryPath,
    binarySha256: crypto.createHash('sha256')
      .update(fs.readFileSync(binaryPath)).digest('hex'),
    storagePath: storagePath ?? path.join(dir, 'vanta-data'),
  };
}

function fakeSpawn() {
  return (binary, args, opts) => spawn(process.execPath, [FAKE_SERVER], opts);
}

function change(areaIds, recordId) {
  return { sourceKind: 'task', recordId, sourceRevision: 0, areaIds,
    file: { rel: `records/${recordId}`, content: `c-${recordId}` } };
}

test('targetTriple maps supported platforms and rejects the rest', () => {
  assert.equal(targetTriple('win32', 'x64').triple, 'x86_64-pc-windows-msvc');
  assert.equal(targetTriple('linux', 'x64').triple, 'x86_64-unknown-linux-gnu');
  assert.equal(targetTriple('linux', 'arm64').triple, 'aarch64-unknown-linux-gnu');
  assert.equal(targetTriple('darwin', 'arm64').triple, 'aarch64-apple-darwin');
  assert.equal(targetTriple('darwin', 'x64').triple, 'x86_64-apple-darwin');
  assert.throws(() => targetTriple('win32', 'arm64'),
    (e) => e.code === 'VANTADB_UNSUPPORTED_PLATFORM');
  assert.throws(() => targetTriple('freebsd', 'x64'),
    (e) => e.code === 'VANTADB_UNSUPPORTED_PLATFORM');
});

test('releaseAsset composes names, urls and binary name; validates semver', () => {
  const win = releaseAsset('0.9.0', 'win32', 'x64');
  assert.equal(win.name, 'vantadb-x86_64-pc-windows-msvc.zip');
  assert.equal(win.binaryRel, 'vantadb-server.exe');
  assert.match(win.url, /ness-e\/Vantadb\/releases\/download\/v0\.9\.0\//);
  const lin = releaseAsset('1.2.3', 'linux', 'arm64');
  assert.equal(lin.name, 'vantadb-aarch64-unknown-linux-gnu.tar.gz');
  assert.equal(lin.binaryRel, 'vantadb-server');
  assert.equal(lin.sha256Url, `${lin.url}.sha256`);
  for (const bad of ['v0.9.0', '0.9', 'latest', '0.9.0-beta', 'x.y.z']) {
    assert.throws(() => releaseAsset(bad), (e) => e.code === 'VANTADB_INVALID_VERSION');
  }
});

test('ensureVantaDBBinary verifies sha256, extracts and caches; mismatch fails closed', async () => {
  const dir = makeTempDir('vantadb-ensure');
  try {
    const payload = Buffer.from('fake-archive-bytes');
    const hash = 'a'.repeat(64);
    let fetched = 0;
    const fetchImpl = async (url) => {
      fetched += 1;
      if (url.endsWith('.sha256')) {
        return Buffer.from(`${hash}  vantadb-x86_64-unknown-linux-gnu.tar.gz\n`);
      }
      return payload;
    };
    const execImpl = (cmd, args) => {
      assert.equal(cmd, 'tar');
      const dest = args[args.length - 1];
      fs.writeFileSync(path.join(dest, 'vantadb-server'), '#!/bin/sh\n');
    };
    const wrongHash = await ensureVantaDBBinary({ version: '0.9.0',
      installRoot: path.join(dir, 'root'), platform: 'linux', arch: 'x64',
      fetchImpl, execImpl }).then(() => null, (e) => e);
    assert.equal(wrongHash.code, 'VANTADB_HASH_MISMATCH');
    assert.equal(fs.existsSync(path.join(dir, 'root', '0.9.0')), false);

    const realHash = 'b'.repeat(64);
    const fetch2 = async (url) => url.endsWith('.sha256')
      ? Buffer.from(`${realHash}  vantadb-x86_64-unknown-linux-gnu.tar.gz\n`)
      : 'BYTES_WITH_WRONG_DIGEST';
    // digest of the payload does not match sidecar -> still fails
    await assert.rejects(
      ensureVantaDBBinary({ version: '0.9.0', installRoot: path.join(dir, 'root'),
        platform: 'linux', arch: 'x64', fetchImpl: fetch2, execImpl }),
      (e) => e.code === 'VANTADB_HASH_MISMATCH');

    // correct sidecar for the actual payload digest
    const crypto = await import('node:crypto');
    const goodHash = crypto.createHash('sha256').update(payload).digest('hex');
    const fetch3 = async (url) => url.endsWith('.sha256')
      ? Buffer.from(`${goodHash}  vantadb-x86_64-unknown-linux-gnu.tar.gz\n`)
      : payload;
    const first = await ensureVantaDBBinary({ version: '0.9.0',
      installRoot: path.join(dir, 'root'), platform: 'linux', arch: 'x64',
      fetchImpl: fetch3, execImpl });
    assert.equal(first.downloaded, true);
    assert.equal(first.sha256, goodHash);
    assert.ok(first.binaryPath.endsWith(path.join('0.9.0', 'vantadb-server')));
    // second call is a cache hit: no fetch, no exec
    const second = await ensureVantaDBBinary({ version: '0.9.0',
      installRoot: path.join(dir, 'root'), platform: 'linux', arch: 'x64',
      fetchImpl: async () => { throw new Error('network must not run'); },
      execImpl: () => { throw new Error('extract must not run'); } });
    assert.equal(second.downloaded, false);
    assert.equal(second.binaryPath, first.binaryPath);
    assert.ok(fetched > 0);
  } finally {
    cleanup(dir);
  }
});

test('config save/load round-trip; absent, malformed and invalid fail closed', () => {
  const f = fixture();
  try {
    assert.equal(loadVantaDBConfig(f.ctx), null);
    assert.throws(() => requireVantaDBConfig(f.ctx),
      (e) => e.code === 'VANTADB_NOT_CONFIGURED');
    const c = cfg(f.dir);
    const abs = saveVantaDBConfig(f.ctx, c);
    assert.ok(abs.endsWith(`vantadb.json`));
    const loaded = loadVantaDBConfig(f.ctx);
    assert.deepEqual(loaded, c);
    assert.equal(Object.isFrozen(loaded), true);

    writeJson(f.dir, '.tasksystem/vantadb.json', { schemaVersion: 1, extra: true });
    assert.throws(() => loadVantaDBConfig(f.ctx),
      (e) => e.code === 'VANTADB_CONFIG_MALFORMED');
    writeJson(f.dir, '.tasksystem/vantadb.json', { ...c, backendId: 'other' });
    assert.throws(() => loadVantaDBConfig(f.ctx),
      (e) => e.code === 'VANTADB_CONFIG_MALFORMED');
    writeJson(f.dir, '.tasksystem/vantadb.json', { ...c, binaryPath: 'rel/x' });
    assert.throws(() => loadVantaDBConfig(f.ctx),
      (e) => e.code === 'VANTADB_CONFIG_MALFORMED');
    assert.throws(() => saveVantaDBConfig(f.ctx, { ...c, version: 'latest' }),
      (e) => e.code === 'VANTADB_CONFIG_MALFORMED');

    // Binary trust: a versioned config must never select in-repo bytes
    // to execute, nor an arbitrarily named executable.
    writeJson(f.dir, '.tasksystem/vantadb.json',
      { ...c, binaryPath: path.join(f.dir, 'payload', 'vantadb-server') });
    assert.throws(() => loadVantaDBConfig(f.ctx),
      (e) => e.code === 'VANTADB_BINARY_UNTRUSTED');
    writeJson(f.dir, '.tasksystem/vantadb.json',
      { ...c, binaryPath: path.join(path.dirname(f.dir), 'evil.exe') });
    assert.throws(() => loadVantaDBConfig(f.ctx),
      (e) => e.code === 'VANTADB_BINARY_UNTRUSTED');
    assert.throws(() => saveVantaDBConfig(f.ctx,
      { ...c, binaryPath: path.join(f.dir, 'vantadb-server') }),
      (e) => e.code === 'VANTADB_BINARY_UNTRUSTED');
    writeJson(f.dir, '.tasksystem/vantadb.json',
      { ...c, binarySha256: 'not-hex' });
    assert.throws(() => loadVantaDBConfig(f.ctx),
      (e) => e.code === 'VANTADB_CONFIG_MALFORMED');
  } finally {
    cleanup(f.dir);
  }
});

test('stdio client does handshake, memory_put/get round-trip and clean close', async () => {
  const dir = makeTempDir('vantadb-stdio');
  try {
    const client = createStdioMcpClient({
      binaryPath: 'unused', storagePath: dir, spawnImpl: fakeSpawn(),
    });
    await client.start();
    assert.equal(client.serverInfo().name, 'fake-vantadb');
    const put = await client.invoke({ name: 'memory_put',
      arguments: { namespace: 'ns', key: 'k', payload: 'hello' } });
    assert.equal(put.structuredContent.payload, 'hello');
    const get = await client.invoke({ name: 'memory_get',
      arguments: { namespace: 'ns', key: 'k' } });
    assert.equal(get.structuredContent.payload, 'hello');
    const miss = await client.invoke({ name: 'memory_get',
      arguments: { namespace: 'ns', key: 'absent' } });
    assert.equal(miss.isError, true);
    await client.close();
    await assert.rejects(
      client.invoke({ name: 'memory_get', arguments: { namespace: 'n', key: 'k' } }),
      (e) => e.code === 'VANTADB_PROCESS_EXIT');
  } finally {
    cleanup(dir);
  }
});

test('syncVantaDB drains committed events through a real stdio child', async () => {
  const f = fixture();
  try {
    const c = cfg(f.dir);
    fs.writeFileSync(c.binaryPath, 'placeholder');
    saveVantaDBConfig(f.ctx, c);
    applyJournaledCreation(f.bound, [change([f.a], 'r1'), change([f.b], 'r2')]);
    const pending = listJournalPending(f.bound, { afterSequence: 0, limit: 50 }).items
      .filter((item) => item.state === 'committed');
    assert.ok(pending.length >= 2);

    const statusBefore = vantaDBStatus({ ctx: f.ctx, bound: f.bound });
    assert.equal(statusBefore.configured, true);
    assert.equal(statusBefore.binaryPresent, true);
    assert.ok(statusBefore.pendingCommittedEvents >= 2);

    const result = await syncVantaDB({
      ctx: f.ctx, bound: f.bound, cfg: c, spawnImpl: fakeSpawn(),
    });
    assert.equal(result.failure, null);
    assert.equal(result.acknowledgedEventIds.length, pending.length);
    assert.equal(result.serverInfo.name, 'fake-vantadb');
    const after = vantaDBStatus({ ctx: f.ctx, bound: f.bound });
    assert.equal(after.pendingCommittedEvents, 0);
  } finally {
    cleanup(f.dir);
  }
});

test('getVantaDBRecord reads through stdio; missing binary and bad ids fail closed', async () => {
  const f = fixture();
  try {
    const c = cfg(f.dir);
    fs.writeFileSync(c.binaryPath, 'placeholder');
    const got = await getVantaDBRecord({
      cfg: c, namespace: 'ns', key: 'missing', spawnImpl: fakeSpawn() });
    assert.equal(got.isError, true);
    await assert.rejects(
      getVantaDBRecord({ cfg: { ...c, binaryPath: path.join(f.dir, 'absent') },
        namespace: 'ns', key: 'k', spawnImpl: fakeSpawn() }),
      (e) => e.code === 'VANTADB_BINARY_MISSING');
    await assert.rejects(
      getVantaDBRecord({ cfg: c, namespace: '', key: 'k' }),
      (e) => e.code === 'VANTADB_INVALID_INPUT');
  } finally {
    cleanup(f.dir);
  }
});

test('callVantaDBTool proxies search/list/recall over stdio and validates input', async () => {
  const f = fixture();
  try {
    const c = cfg(f.dir);
    fs.writeFileSync(c.binaryPath, 'placeholder');
    const sp = fakeSpawn();
    // Seed one record via put so list/search see it.
    const put = await callVantaDBTool({ cfg: c, name: 'memory_put',
      arguments: { namespace: 'sg-formal-v1-x', key: 'k1',
        payload: { type: 'scopegrain.journal-event', marker: 'drift' } },
      spawnImpl: sp });
    assert.equal(put.isError, undefined);

    const search = await callVantaDBTool({ cfg: c, name: 'memory_search',
      arguments: { namespace: 'sg-formal-v1-x', text_query: 'drift', top_k: 5 },
      spawnImpl: fakeSpawn() });
    assert.equal(search.structuredContent.hits.length, 1);
    assert.equal(search.structuredContent.hits[0].key, 'k1');

    const list = await callVantaDBTool({ cfg: c, name: 'memory_list',
      arguments: { namespace: 'sg-formal-v1-x' }, spawnImpl: fakeSpawn() });
    // Real shape: records + next_cursor (not hits).
    assert.equal(list.structuredContent.records.length, 1);
    assert.equal(list.structuredContent.next_cursor, null);

    const recall = await callVantaDBTool({ cfg: c, name: 'memory_recall',
      arguments: { query: 'what changed', scope: 'agent', top_k: 5 },
      spawnImpl: fakeSpawn() });
    // No l1/* records seeded: honest empty pool, keyword mode.
    assert.equal(recall.structuredContent.recalled.length, 0);
    assert.equal(recall.structuredContent.effective_mode, 'keyword');

    // Input bounds fail closed before any spawn.
    for (const [name, args, want] of [
      ['Bad Name!', {}, 'VANTADB_INVALID_INPUT'],
      ['memory_get', 'not-an-object', 'VANTADB_INVALID_INPUT'],
      ['memory_get', { circular: null }, 'VANTADB_INVALID_INPUT'],
    ]) {
      if (args && typeof args === 'object') args.circular = args;
      await assert.rejects(
        callVantaDBTool({ cfg: c, name, arguments: args, spawnImpl: fakeSpawn() }),
        (e) => e.code === want);
    }
    const big = { data: 'x'.repeat(70000) };
    await assert.rejects(
      callVantaDBTool({ cfg: c, name: 'memory_get', arguments: big,
        spawnImpl: fakeSpawn() }),
      (e) => e.code === 'VANTADB_INVALID_INPUT');
  } finally {
    cleanup(f.dir);
  }
});

test('vantaDBContext scans sg-formal namespaces for a record ID', async () => {
  const f = fixture();
  try {
    const c = cfg(f.dir);
    fs.writeFileSync(c.binaryPath, 'placeholder');
    const rid = '327dc5cb-0cee-4d96-ac6c-bf6165429972';
    // Seed two scopes: one formal with the recordId, one unrelated.
    for (const [ns, key, payload] of [
      ['sg-formal-v1-aaa', 'e1', { event: { recordId: rid }, type: 'x' }],
      ['sg-formal-v1-bbb', 'e2', { event: { recordId: 'other' }, type: 'x' }],
      ['user-notes', 'n1', { text: rid }],
    ]) {
      await callVantaDBTool({ cfg: c, name: 'memory_put',
        arguments: { namespace: ns, key, payload }, spawnImpl: fakeSpawn() });
    }
    const out = await vantaDBContext({ cfg: c, recordId: rid,
      spawnImpl: fakeSpawn() });
    assert.equal(out.namespacesFound, 2); // only sg-formal-v1-* count
    assert.equal(out.namespacesScanned, 2);
    assert.equal(out.hits.length, 1);
    assert.equal(out.hits[0].namespace, 'sg-formal-v1-aaa');
    assert.equal(out.truncated, false);

    await assert.rejects(
      vantaDBContext({ cfg: c, recordId: 'x', spawnImpl: fakeSpawn() }),
      (e) => e.code === 'VANTADB_INVALID_INPUT');
    await assert.rejects(
      vantaDBContext({ cfg: c, recordId: 'ok-record-id', topK: 999,
        spawnImpl: fakeSpawn() }),
      (e) => e.code === 'VANTADB_INVALID_INPUT');
  } finally {
    cleanup(f.dir);
  }
});

test('vantaDBDistill writes curated L1 records recallable via memory_recall', async () => {
  const f = fixture();
  try {
    const c = cfg(f.dir);
    fs.writeFileSync(c.binaryPath, 'placeholder');
    const sp = fakeSpawn();
    // Seed a committed+projected journal event via the real drain path.
    await applyJournaledCreation(f.bound, [change([f.a], 'rec-1')]);
    const synced = await syncVantaDB({ ctx: f.ctx, bound: f.bound, cfg: c,
      spawnImpl: fakeSpawn() });
    assert.equal(synced.acknowledgedEventIds.length, 1);

    const out = await vantaDBDistill({ bound: f.bound, cfg: c, spawnImpl: sp });
    assert.equal(out.candidateEvents, 1);
    assert.equal(out.failed.length, 0);
    assert.equal(out.distilled.length, 1);
    assert.match(out.distilled[0].namespace, /^l1\/sg-[0-9a-f]{16}$/);

    // Re-run is idempotent (upsert by eventId key).
    const again = await vantaDBDistill({ bound: f.bound, cfg: c, spawnImpl: sp });
    assert.equal(again.distilled.length, 1);

    // The recall pool sees it under agent scope (agent_id: 'default').
    const recall = await callVantaDBTool({ cfg: c, name: 'memory_recall',
      arguments: { query: 'rec-1', scope: 'agent', top_k: 5 },
      spawnImpl: fakeSpawn() });
    assert.equal(recall.structuredContent.recalled.length, 1);
    assert.match(recall.structuredContent.recalled[0].content, /rec-1/);
  } finally {
    cleanup(f.dir);
  }
});

test('vantaDBProbe surfaces embedding capability state; unenrolled fails closed', async () => {
  const f = fixture();
  try {
    const c = cfg(f.dir);
    fs.writeFileSync(c.binaryPath, 'placeholder');
    const probe = await vantaDBProbe({ cfg: c, spawnImpl: fakeSpawn() });
    assert.equal(probe.embedding.provider, 'fake-local');
    assert.equal(probe.embedding.fallback, true);
    assert.equal(probe.embedding.model_present, false);
    assert.equal(probe.vector_search, true);
    await assert.rejects(
      vantaDBProbe({ cfg: { ...c, binaryPath: path.join(f.dir, 'absent') },
        spawnImpl: fakeSpawn() }),
      (e) => e.code === 'VANTADB_BINARY_MISSING');
  } finally {
    cleanup(f.dir);
  }
});

test('vantaDBReinforce proxies memory_reinforce and validates outcome locally', async () => {
  const f = fixture();
  try {
    const c = cfg(f.dir);
    fs.writeFileSync(c.binaryPath, 'placeholder');
    await callVantaDBTool({ cfg: c, name: 'memory_put',
      arguments: { namespace: 'l1/sg-test', key: 'k1', payload: 'x' },
      spawnImpl: fakeSpawn() });
    const r = await vantaDBReinforce({ cfg: c, namespace: 'l1/sg-test',
      key: 'k1', outcome: 'used', spawnImpl: fakeSpawn() });
    assert.equal(r.structuredContent.outcome, 'used');
    assert.equal(r.structuredContent.confidence <= 1, true);
    await assert.rejects(
      vantaDBReinforce({ cfg: c, namespace: 'l1/sg-test', key: 'k1',
        outcome: 'magic', spawnImpl: fakeSpawn() }),
      (e) => e.code === 'VANTADB_INVALID_INPUT');
    // Not-found surfaces the exact -32004 contract.
    const miss = await vantaDBReinforce({ cfg: c, namespace: 'l1/sg-test',
      key: 'absent', outcome: 'used', spawnImpl: fakeSpawn() });
    assert.equal(miss.isError, true);
  } finally {
    cleanup(f.dir);
  }
});

test('spawn env pins brain profile, injection ACL, tool allowlist, dedup and strict embeddings; strips overrides', async () => {
  const f = fixture();
  let captured = null;
  try {
    await withEnv({ VANTADB_MCP_PROFILE: 'memory',
      VANTADB_MCP_INJECT_NAMESPACES: 'evil/',
      VANTADB_MCP_ALLOW_TOOLS: 'evil_tool',
      VANTADB_DEDUP_POLICY: 'semantic',
      VANTADB_STRICT_EMBEDDINGS: '0',
      VANTADB_MCP_BYTE_BUDGET: '1' }, async () => {
      const c = cfg(f.dir);
      fs.writeFileSync(c.binaryPath, 'placeholder');
      const spawnImpl = (bin, args, opts) => {
        captured = opts.env;
        return spawn(process.execPath,
          ['-e', 'setTimeout(()=>{},3000)'], opts);
      };
      await assert.rejects(callVantaDBTool({ cfg: c, name: 'memory_get',
        arguments: { namespace: 'n', key: 'k', },
        timeoutMs: 1500, spawnImpl }));
      assert.equal(captured.VANTADB_MCP_PROFILE, 'brain');
      assert.equal(captured.VANTADB_MCP_INJECT_NAMESPACES, 'l1/,l3/');
      assert.equal(captured.VANTADB_MCP_ALLOW_TOOLS,
        'capabilities,memory_get,memory_list,memory_list_namespaces,'
        + 'memory_put,memory_recall,memory_reinforce,memory_search');
      assert.equal(captured.VANTADB_DEDUP_POLICY, 'off');
      assert.equal(captured.VANTADB_STRICT_EMBEDDINGS, 'true');
      assert.equal(captured.VANTADB_MCP_BYTE_BUDGET, undefined);
      assert.equal(captured.VANTADB_STORAGE_PATH, c.storagePath);
      assert.equal(captured.VANTADB_QUIET, '1');
    });
  } finally {
    cleanup(f.dir);
  }
});

test('vantaDBSyncWorklogs projects JSONL entries to L1 and skips repeats', async () => {
  const f = fixture();
  try {
    const c = cfg(f.dir);
    fs.writeFileSync(c.binaryPath, 'placeholder');
    appendWorklog(f.ctx, 'progress', { taskId: crypto.randomUUID(),
      title: 'w1', kind: 'action' });
    appendWorklog(f.ctx, 'progress', { taskId: crypto.randomUUID(),
      title: 'w2', kind: 'commit', ref: 'abc' });

    const out = await vantaDBSyncWorklogs({ ctx: f.ctx, bound: f.bound, cfg: c,
      spawnImpl: fakeSpawn() });
    assert.equal(out.failed.length, 0);
    assert.equal(out.projected.length, 2);
    assert.match(out.namespace, /^l1\/sg-[0-9a-f]{16}$/);

    // Idempotent: unchanged entries are skipped on re-run.
    const again = await vantaDBSyncWorklogs({ ctx: f.ctx, bound: f.bound,
      cfg: c, spawnImpl: fakeSpawn() });
    assert.equal(again.projected.length, 0);
    assert.equal(again.skipped.length, 2);
  } finally {
    cleanup(f.dir);
  }
});

test('vantaDBSyncWorklogs reports divergent remote records as conflicted, never skipped or overwritten', async () => {
  const f = fixture();
  try {
    const c = cfg(f.dir);
    fs.writeFileSync(c.binaryPath, 'placeholder');
    appendWorklog(f.ctx, 'progress', { taskId: crypto.randomUUID(),
      title: 'w1', kind: 'action' });
    const first = await vantaDBSyncWorklogs({ ctx: f.ctx, bound: f.bound,
      cfg: c, spawnImpl: fakeSpawn() });
    assert.equal(first.projected.length, 1);
    // Tamper the remote record in place — same key, wrong payload.
    await callVantaDBTool({ cfg: c, name: 'memory_put',
      arguments: { namespace: first.namespace,
        key: first.projected[0].key, payload: '{"forged":true}' },
      spawnImpl: fakeSpawn() });
    const again = await vantaDBSyncWorklogs({ ctx: f.ctx, bound: f.bound,
      cfg: c, spawnImpl: fakeSpawn() });
    assert.equal(again.skipped.length, 0);
    assert.equal(again.projected.length, 0);
    assert.equal(again.conflicted.length, 1);
    assert.equal(again.conflicted[0].key, first.projected[0].key);
    // The foreign value is reported, never overwritten.
    const got = await callVantaDBTool({ cfg: c, name: 'memory_get',
      arguments: { namespace: first.namespace,
        key: first.projected[0].key }, spawnImpl: fakeSpawn() });
    assert.equal(got.structuredContent.payload, '{"forged":true}');
  } finally {
    cleanup(f.dir);
  }
});

test('vantaDBSyncPersona projects proved preference/decision captures to L3 idempotently and skips unproved', async () => {
  const f = fixture();
  try {
    const c = cfg(f.dir);
    fs.writeFileSync(c.binaryPath, 'placeholder');
    const store = createCaptureStore(f.ctx, {
      areaIds: f.bound.areaIds, origin: 'cli-test',
    });
    const pref = store.create({
      category: 'preference',
      title: 'Respond in Spanish',
      summary: 'Owner prefers concise technical Spanish with tables.',
      areaIds: [f.bound.areaIds[0]],
      basis: 'declared',
      subjectId: 'owner',
    });
    const dec = store.create({
      category: 'decision',
      title: 'Keep context read-only',
      summary: 'Context packet never mutates disk.',
      areaIds: [f.bound.areaIds[0]],
      basis: 'declared',
    });
    // Non-persona category must be ignored.
    store.create({
      category: 'lesson',
      title: 'Lesson ignored by L3 persona',
      summary: 'Belongs to L1/worklogs, not persona.',
      areaIds: [f.bound.areaIds[0]],
      basis: 'inferred',
    });
    // Unproved raw capture file must never be adopted.
    const fakeUuid = crypto.randomUUID();
    writeJson(f.dir, `.tasksystem/memory/captures/${fakeUuid}.json`, {
      schemaVersion: 1, kind: 'scopegrain.capture', id: fakeUuid,
      category: 'preference', title: 'Forged', summary: 'No ownership proof',
    });

    // Preview does not spawn VantaDB and surfaces only proved candidates + skippedUnproved.
    const preview = await vantaDBSyncPersona({
      ctx: f.ctx, bound: f.bound, cfg: null, apply: false,
    });
    assert.equal(preview.mode, 'preview');
    assert.match(preview.namespace, /^l3\/sg-persona-[0-9a-f]{16}$/);
    assert.equal(preview.candidates.length, 2);
    assert.equal(preview.skippedUnproved.length, 1);
    assert.equal(preview.skippedUnproved[0].id, fakeUuid);

    // Apply projects both proved captures and verifies readback.
    const applied = await vantaDBSyncPersona({
      ctx: f.ctx, bound: f.bound, cfg: c, apply: true, spawnImpl: fakeSpawn(),
    });
    assert.equal(applied.mode, 'applied');
    assert.equal(applied.failed.length, 0);
    assert.equal(applied.projected.length, 2);
    assert.deepEqual(
      applied.projected.map((p) => p.id).sort(),
      [pref.record.id, dec.record.id].sort());
    assert.equal(applied.skippedUnproved.length, 1);

    // Re-running is idempotent: both records are skipped.
    const second = await vantaDBSyncPersona({
      ctx: f.ctx, bound: f.bound, cfg: c, apply: true, spawnImpl: fakeSpawn(),
    });
    assert.equal(second.projected.length, 0);
    assert.equal(second.skipped.length, 2);
    assert.equal(second.failed.length, 0);
  } finally {
    cleanup(f.dir);
  }
});
