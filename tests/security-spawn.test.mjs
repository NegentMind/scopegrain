// SPDX-License-Identifier: Apache-2.0
// Security remediation coverage (audit batch FIND-011/012/027/029 and
// the b-* lows): enrollment digest is required fail-closed, binary
// trust resolves through realpath, spawned children inherit only an
// env allowlist, secret material never egresses to the memory backend,
// '%' is rejected in stored argv, and MCP annotations honestly mark
// backend-spawning read tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { applyJournaledCreation } from '../src/core/journal.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import {
  DEFAULT_VANTADB_VERSION, VANTADB_BACKEND_ID, callVantaDBTool,
  loadVantaDBConfig, saveVantaDBConfig, vantaDBSyncWorklogs,
} from '../src/integrations/vantadb-runtime.mjs';
import {
  createVantaDBProjector, secretEgressCheck,
} from '../src/integrations/vantadb.mjs';
import {
  applyAddCommand, applyApproveCommand, controlledSpawnEnv,
  parseCommandArgv, runVerifyCommand,
} from '../src/core/verify-commands.mjs';
import { appendWorklog } from '../src/core/worklog.mjs';
import {
  VALID_ANSWERS, bootstrappedMiniCtx, cleanup, makeTempDir,
  trySymlink, withEnv, writeFile, writeJson,
} from './helpers.mjs';

const FAKE_SERVER = fileURLToPath(
  new URL('./fixtures/fake-vantadb-mcp.mjs', import.meta.url));

function fixture() {
  const dir = makeTempDir('security-spawn');
  writeJson(dir, '.scopegrain/config.json', createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir, config: '.scopegrain/config.json' });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a] = prepared.workspace.areas.map((area) => area.id);
  return { dir, ctx, a, bound: bindWorkspace(ctx, { areaIds: [a] }) };
}

// Enrolled binaries must resolve OUTSIDE the project root. The helper
// writes a placeholder binary and pins its digest — the shape the
// enrollment flow now requires fail-closed.
function cfg(dir) {
  const binDir = path.join(path.dirname(dir), `bin-${path.basename(dir)}`);
  fs.mkdirSync(binDir, { recursive: true });
  const binaryPath = path.join(binDir, 'vantadb-server');
  fs.writeFileSync(binaryPath, 'placeholder');
  return {
    schemaVersion: 1, backendId: VANTADB_BACKEND_ID,
    version: DEFAULT_VANTADB_VERSION,
    binaryPath,
    storagePath: path.join(dir, 'vanta-data'),
    binarySha256: crypto.createHash('sha256')
      .update(fs.readFileSync(binaryPath)).digest('hex'),
  };
}

function fakeSpawn() {
  return (_binary, _args, opts) => spawn(process.execPath,
    [FAKE_SERVER], opts);
}

// --- FIND-011: binarySha256 is required (fail-closed) -----------------

test('config without binarySha256 is rejected at save AND load', () => {
  const f = fixture();
  try {
    const c = cfg(f.dir);
    const noDigest = { ...c };
    delete noDigest.binarySha256;
    assert.throws(() => saveVantaDBConfig(f.ctx, noDigest),
      (e) => e.code === 'VANTADB_CONFIG_MALFORMED'
        && /setup --apply|re-enroll/i.test(e.message));
    writeJson(f.dir, '.scopegrain/vantadb.json', noDigest);
    assert.throws(() => loadVantaDBConfig(f.ctx),
      (e) => e.code === 'VANTADB_CONFIG_MALFORMED'
        && /setup --apply|re-enroll/i.test(e.message));
  } finally { cleanup(f.dir); }
});

test('enrolled config with pinned digest still round-trips', () => {
  const f = fixture();
  try {
    const c = cfg(f.dir);
    saveVantaDBConfig(f.ctx, c);
    const loaded = loadVantaDBConfig(f.ctx);
    assert.deepEqual(loaded, c);
    assert.equal(Object.isFrozen(loaded), true);
  } finally { cleanup(f.dir); }
});

test('spawn gate rejects missing or stale digests before executing', async () => {
  const f = fixture();
  try {
    const c = cfg(f.dir);
    const noDigest = { ...c };
    delete noDigest.binarySha256;
    await assert.rejects(
      callVantaDBTool({ cfg: noDigest, name: 'memory_get',
        arguments: { namespace: 'n', key: 'k' }, spawnImpl: fakeSpawn() }),
      (e) => e.code === 'VANTADB_CONFIG_MALFORMED');
    await assert.rejects(
      callVantaDBTool({ cfg: { ...c, binarySha256: 'f'.repeat(64) },
        name: 'memory_get', arguments: { namespace: 'n', key: 'k' },
        spawnImpl: fakeSpawn() }),
      (e) => e.code === 'VANTADB_HASH_MISMATCH');
  } finally { cleanup(f.dir); }
});

test('binary trust resolves through realpath: symlink into project is rejected', (t) => {
  const f = fixture();
  try {
    // A binaryPath lexically outside the root but symlinked INTO it must
    // fail the containment check after realpath resolution.
    fs.writeFileSync(path.join(f.dir, 'vantadb-server'), 'payload');
    const outside = path.join(path.dirname(f.dir),
      `link-${path.basename(f.dir)}`);
    fs.mkdirSync(outside, { recursive: true });
    const link = path.join(outside, 'sym');
    if (!trySymlink(f.dir, link, 'junction')) {
      t.skip('symlinks unsupported in this environment');
      return;
    }
    const c = cfg(f.dir);
    saveVantaDBConfig(f.ctx, c);
    writeJson(f.dir, '.scopegrain/vantadb.json',
      { ...c, binaryPath: path.join(link, 'vantadb-server') });
    assert.throws(() => loadVantaDBConfig(f.ctx),
      (e) => e.code === 'VANTADB_BINARY_UNTRUSTED');
    cleanup(outside);
  } finally { cleanup(f.dir); }
});

// --- FIND-027: env allowlist for spawned children ----------------------

test('controlledSpawnEnv strips non-allowlisted vars and applies overrides', () => {
  withEnv({ SG_SECRET_TOKEN: 's3cr3t', SG_CUSTOM_FLAG: 'x' }, () => {
    const env = controlledSpawnEnv({ VANTADB_QUIET: '1' });
    assert.equal(env.SG_SECRET_TOKEN, undefined);
    assert.equal(env.SG_CUSTOM_FLAG, undefined);
    assert.equal(env.VANTADB_QUIET, '1');
    if (typeof process.env.PATH === 'string') {
      assert.equal(env.PATH, process.env.PATH);
    }
  });
});

test('verify run child inherits no credential env but resolves PATH', async () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    writeFile(dir, 'scripts/env.mjs',
      'process.stdout.write(String(process.env.SG_SECRET_TOKEN ?? "UNSET"));\n');
    const { record } = applyAddCommand(ctx, { command: 'node scripts/env.mjs' });
    applyApproveCommand(ctx, record.id);
    await withEnv({ SG_SECRET_TOKEN: 's3cr3t' }, async () => {
      const result = await runVerifyCommand(ctx, record.id);
      assert.equal(result.status, 'exit');
      assert.equal(result.stdout, 'UNSET');
    });
  } finally { cleanup(dir); }
});

// --- FIND-029: secret egress guard ------------------------------------

test('secretEgressCheck tags credential shapes and stays quiet on clean text', () => {
  for (const text of [
    '-----BEGIN RSA PRIVATE KEY-----\nMIIxx\n-----END RSA PRIVATE KEY-----',
    '"api_key": "0123456789abcdef"',
    'password=supersecretvalue123',
    'aws id AKIAIOSFODNN7EXAMPLE',
  ]) {
    assert.notEqual(secretEgressCheck(text), null, text);
  }
  assert.equal(secretEgressCheck('{"title":"rotate the api keys"}'), null);
  assert.equal(secretEgressCheck('x', 'records/id_rsa'), 'secret-filename');
  assert.equal(secretEgressCheck('x', '.env'), 'secret-filename');
  assert.equal(secretEgressCheck('x', 'records/t1.json'), null);
});

test('projector blocks secret-bearing events and never transmits them', async () => {
  const f = fixture();
  try {
    const secret = applyJournaledCreation(f.bound, [{
      sourceKind: 'task', recordId: 'sec-1', sourceRevision: 0,
      areaIds: [f.a],
      file: { rel: 'records/sec-1',
        content: '"api_key": "0123456789abcdef"' },
    }]);
    const clean = applyJournaledCreation(f.bound, [{
      sourceKind: 'task', recordId: 'ok-1', sourceRevision: 0,
      areaIds: [f.a], file: { rel: 'records/ok-1', content: 'fine' },
    }]);
    const calls = [];
    const store = new Map();
    const invoke = async ({ name, arguments: args }) => {
      calls.push({ name, args });
      const id = `${args.namespace}${args.key}`;
      if (name === 'memory_get') {
        return store.has(id)
          ? { structuredContent: { namespace: args.namespace, key: args.key,
              payload: store.get(id) } }
          : { isError: true, content: [{ type: 'text', text: JSON.stringify({
              code: -32004, message: 'not found',
              data: { code: 'VANTADB_NOT_FOUND', retriable: false },
            }) }] };
      }
      assert.equal(name, 'memory_put');
      store.set(id, args.payload);
      return { structuredContent: { namespace: args.namespace,
        key: args.key, payload: args.payload } };
    };
    const p = createVantaDBProjector(f.bound,
      { backendId: 'fixture', invoke });
    const result = await p.drain({ limit: 50 });
    assert.equal(result.failure, null);
    assert.deepEqual(result.blockedEventIds, secret.eventIds);
    assert.deepEqual(result.acknowledgedEventIds, clean.eventIds);
    assert.ok(result.warnings
      .some((w) => w.code === 'BRAIN_SECRET_EGRESS_BLOCKED'));
    // The blocked event's bytes never reached the backend at all.
    for (const payload of store.values()) {
      assert.doesNotMatch(payload, /0123456789abcdef/);
    }
  } finally { cleanup(f.dir); }
});

test('worklog sync blocks entries carrying credential material', async () => {
  const f = fixture();
  try {
    const c = cfg(f.dir);
    appendWorklog(f.ctx, 'progress', {
      taskId: crypto.randomUUID(), title: 'leaked note',
      kind: 'action',
      summary: 'pasted -----BEGIN PRIVATE KEY-----\nMII\n' });
    appendWorklog(f.ctx, 'progress', {
      taskId: crypto.randomUUID(), title: 'clean note', kind: 'action' });
    const out = await vantaDBSyncWorklogs({ ctx: f.ctx, bound: f.bound,
      cfg: c, spawnImpl: fakeSpawn() });
    assert.equal(out.projected.length, 1);
    assert.equal(out.blocked.length, 1);
    assert.equal(out.failed.length, 0);
  } finally { cleanup(f.dir); }
});

// --- b-32: '%' is cmd expansion syntax, never literal argv -------------

test('parseCommandArgv rejects cmd-style percent expansion', () => {
  for (const bad of ['echo %PATH%', 'npm test %CI%', 'node x%y.mjs']) {
    assert.throws(() => parseCommandArgv(bad),
      (e) => e.code === 'INVALID_VERIFY_COMMAND', `expected reject: ${bad}`);
  }
});

// --- FIND-012 + b-30: honest MCP annotations ----------------------------

test('backend-spawning read tools disclose openWorld and spawn+egress', async () => {
  const { z } = await import('zod');
  const { createMCPTools } = await import('../src/mcp/server.mjs');
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    const tools = createMCPTools(ctx, z);
    const backend = new Set([
      'scopegrain_context', 'scopegrain_session_resume',
      'scopegrain_memory_get', 'scopegrain_memory_search',
      'scopegrain_memory_recall', 'scopegrain_memory_context',
    ]);
    for (const tool of tools) {
      if (backend.has(tool.name)) {
        assert.equal(tool.config.annotations.openWorldHint, true, tool.name);
        assert.equal(tool.config.annotations.readOnlyHint, true, tool.name);
        assert.match(tool.config.description, /vantadb-server|backend/i,
          tool.name);
      } else {
        assert.equal(tool.config.annotations.openWorldHint, false, tool.name);
      }
    }
    // Discard semantics carry destructiveHint (b-30).
    for (const name of
      ['scopegrain_task_disposition', 'scopegrain_goal_transition']) {
      const tool = tools.find((x) => x.name === name);
      assert.equal(tool.config.annotations.destructiveHint, true, name);
    }
    // Local reads stay fully closed-world.
    for (const name of
      ['scopegrain_memory_status', 'scopegrain_get_task']) {
      const tool = tools.find((x) => x.name === name);
      assert.equal(tool.config.annotations.openWorldHint, false, name);
    }
  } finally { cleanup(dir); }
});
