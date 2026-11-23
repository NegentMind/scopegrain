// SPDX-License-Identifier: Apache-2.0
// Automatic context rehydration: project-level L1 recall for the
// session-start packet and record-level sg-formal scan for session
// resume. Both degrade instead of throwing: unenrolled fails closed
// with enrolled:false; runtime failures surface as error markers.
// The project-level read is memory_search over the project's own
// l1/sg-<projectHash> namespace — the engine's memory_recall pool is
// machine-global (every l1/* with default identity), so it must never
// feed an automatic packet.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { resolveContext } from '../src/core/context.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { prepareWorkspace, bindWorkspace, getWorkspace }
  from '../src/core/workspaces.mjs';
import {
  callVantaDBTool, saveVantaDBConfig, DEFAULT_VANTADB_VERSION,
  VANTADB_BACKEND_ID, projectL1Namespace, vantaDBSyncWorklogs,
} from '../src/integrations/vantadb-runtime.mjs';
import {
  projectRehydration, recordRehydration,
} from '../src/integrations/vantadb-rehydrate.mjs';
import { appendWorklog } from '../src/core/worklog.mjs';
import { estimateTokens } from '../src/core/tokens.mjs';
import { createConfig } from '../src/core/config.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, writeJson }
  from './helpers.mjs';

const FAKE_SERVER = fileURLToPath(
  new URL('./fixtures/fake-vantadb-mcp.mjs', import.meta.url));

function fixture(tag = 'rehydration', storagePath) {
  const dir = makeTempDir(tag);
  writeJson(dir, '.scopegrain/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir,
    config: '.scopegrain/config.json' });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a] = prepared.workspace.areas.map((area) => area.id);
  return { dir, ctx, bound: bindWorkspace(ctx, { areaIds: [a] }),
    storagePath: storagePath ?? path.join(dir, 'vanta-data') };
}

// Enrolled binaries must resolve OUTSIDE the project root. The config
// pins binarySha256 — verified against the file before every spawn —
// so the fixture writes the placeholder first and digests its bytes.
function enroll(dir, storagePath) {
  const binDir = path.join(path.dirname(dir), `bin-${path.basename(dir)}`);
  fs.mkdirSync(binDir, { recursive: true });
  const binaryPath = path.join(binDir, 'vantadb-server');
  fs.writeFileSync(binaryPath, 'placeholder');
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
  return (_binary, _args, opts) => spawn(process.execPath,
    [FAKE_SERVER], opts);
}

test('unenrolled project fails closed on both rehydration surfaces', async () => {
  const f = fixture();
  try {
    const p = await projectRehydration({ ctx: f.ctx });
    assert.equal(p.enrolled, false);
    assert.equal(p.recall, null);
    const r = await recordRehydration({ ctx: f.ctx, recordId: 'some-record' });
    assert.equal(r.enrolled, false);
    assert.equal(r.context, null);
  } finally {
    cleanup(f.dir);
  }
});

test('projectRehydration recalls the project L1 namespace over a real stdio session', async () => {
  const f = fixture();
  try {
    const c = enroll(f.dir);
    saveVantaDBConfig(f.ctx, c);
    const namespace = projectL1Namespace(getWorkspace(f.ctx));
    // Seed one curated L1 episodic record, as vantaDBDistill writes them.
    await callVantaDBTool({ cfg: c, name: 'memory_put',
      arguments: {
        namespace, key: 'sg-worklog-progress-x',
        payload: JSON.stringify({
          content: 'Scopegrain progress entry: rehydration test',
          agent_id: 'default', team_id: 'default', type: 'episodic',
        }),
      },
      spawnImpl: fakeSpawn() });

    const out = await projectRehydration({ ctx: f.ctx, query: 'rehydration',
      spawnImpl: fakeSpawn() });
    assert.equal(out.enrolled, true);
    assert.equal(out.recall.tool, 'memory_search');
    assert.equal(out.recall.pool, 'project');
    assert.equal(out.recall.namespace, namespace);
    assert.equal(out.recall.recalled.length, 1);
    assert.match(out.recall.recalled[0].content, /rehydration test/);
    assert.equal(out.recall.recalled[0].type, 'episodic');
    assert.equal(typeof out.recall.prepend_context, 'string');
    // Advisory estimate over the (post-cap) locally built prepend_context.
    assert.deepEqual(out.recall.prependContextEstimate,
      estimateTokens(out.recall.prepend_context));

    // No hits -> null prepend_context -> no estimate field at all.
    const empty = await projectRehydration({ ctx: f.ctx,
      query: 'no-such-memory', spawnImpl: fakeSpawn() });
    assert.equal(empty.recall.prepend_context, null);
    assert.equal('prependContextEstimate' in empty.recall, false);
  } finally {
    cleanup(f.dir);
  }
});

test('project rehydration is cross-session and isolated per project on shared storage', async () => {
  const shared = makeTempDir('rehydration-shared');
  const a = fixture('rehydration-a', path.join(shared, 'vanta-data'));
  const b = fixture('rehydration-b', path.join(shared, 'vanta-data'));
  try {
    const cfgA = enroll(a.dir, a.storagePath);
    const cfgB = enroll(b.dir, b.storagePath);
    saveVantaDBConfig(a.ctx, cfgA);
    saveVantaDBConfig(b.ctx, cfgB);
    const nsA = projectL1Namespace(getWorkspace(a.ctx));
    const nsB = projectL1Namespace(getWorkspace(b.ctx));
    assert.notEqual(nsA, nsB);

    // Both projects project into the SAME storage via the real write
    // path — each lands in its own derived namespace.
    appendWorklog(a.ctx, 'progress', { taskId: crypto.randomUUID(),
      title: 'alpha-only-marker', kind: 'action' });
    appendWorklog(b.ctx, 'progress', { taskId: crypto.randomUUID(),
      title: 'beta-only-marker', kind: 'action' });
    await vantaDBSyncWorklogs({ ctx: a.ctx, bound: a.bound, cfg: cfgA,
      spawnImpl: fakeSpawn() });
    await vantaDBSyncWorklogs({ ctx: b.ctx, bound: b.bound, cfg: cfgB,
      spawnImpl: fakeSpawn() });

    // Session A rehydrates (fresh spawn, persisted store): sees only
    // project A records — project B content cannot leak in.
    const ra = await projectRehydration({ ctx: a.ctx, query: 'marker',
      spawnImpl: fakeSpawn() });
    assert.equal(ra.enrolled, true);
    assert.equal(ra.recall.namespace, nsA);
    assert.ok(ra.recall.recalled.length >= 1);
    assert.ok(ra.recall.recalled.every((h) => /alpha/.test(h.content)));
    assert.match(ra.recall.prepend_context, /alpha-only-marker/);
    assert.equal(ra.recall.prepend_context.includes('beta'), false);

    const rb = await projectRehydration({ ctx: b.ctx, query: 'marker',
      spawnImpl: fakeSpawn() });
    assert.equal(rb.recall.namespace, nsB);
    assert.ok(rb.recall.recalled.every((h) => /beta/.test(h.content)));
    assert.equal(rb.recall.prepend_context.includes('alpha'), false);
  } finally {
    cleanup(a.dir);
    cleanup(b.dir);
    cleanup(shared);
  }
});

test('enrolled project without a workspace degrades before any spawn', async () => {
  const dir = makeTempDir('rehydration-noworkspace');
  try {
    writeJson(dir, '.scopegrain/config.json',
      createConfig(dir, VALID_ANSWERS, {}));
    const ctx = resolveContext({ project: dir,
      config: '.scopegrain/config.json' });
    const c = enroll(dir);
    saveVantaDBConfig(ctx, c);
    let spawns = 0;
    const counting = (...args) => { spawns += 1; return fakeSpawn()(...args); };
    const out = await projectRehydration({ ctx, spawnImpl: counting });
    assert.equal(out.enrolled, true);
    assert.equal(out.recall, null);
    assert.equal(out.error.code, 'WORKSPACE_NOT_FOUND');
    assert.equal(spawns, 0);
  } finally {
    cleanup(dir);
  }
});

test('recordRehydration scans sg-formal namespaces for the record', async () => {
  const f = fixture();
  try {
    const c = enroll(f.dir);
    saveVantaDBConfig(f.ctx, c);
    const out = await recordRehydration({ ctx: f.ctx,
      recordId: 'rec-abcdef', spawnImpl: fakeSpawn() });
    assert.equal(out.enrolled, true);
    assert.equal(out.context.recordId, 'rec-abcdef');
    assert.ok(out.context.namespacesScanned >= 0);
    // Record context carries no prepend_context -> no estimate field.
    assert.equal('prependContextEstimate' in out.context, false);
  } finally {
    cleanup(f.dir);
  }
});

test('malformed enrollment degrades to an error marker, never throws', async () => {
  const f = fixture();
  try {
    const cfgFile = path.join(f.ctx.projectRoot,
      f.ctx.configDir, 'vantadb.json');
    fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
    fs.writeFileSync(cfgFile, '{not json');
    const p = await projectRehydration({ ctx: f.ctx });
    assert.equal(p.enrolled, true);
    assert.equal(p.recall, null);
    assert.equal(typeof p.error.code, 'string');
    const r = await recordRehydration({ ctx: f.ctx, recordId: 'x-12345' });
    assert.equal(r.enrolled, true);
    assert.equal(r.context, null);
    assert.equal(typeof r.error.code, 'string');
  } finally {
    cleanup(f.dir);
  }
});

test('spawn failure degrades to an error marker instead of aborting', async () => {
  const f = fixture();
  try {
    const c = enroll(f.dir);
    saveVantaDBConfig(f.ctx, c);
    const deny = () => { throw new Error('spawn denied'); };
    const p = await projectRehydration({ ctx: f.ctx, spawnImpl: deny });
    assert.equal(p.enrolled, true);
    assert.equal(p.recall, null);
    assert.match(p.error.message, /spawn denied/);
  } finally {
    cleanup(f.dir);
  }
});
