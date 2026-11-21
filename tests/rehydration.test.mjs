// SPDX-License-Identifier: Apache-2.0
// Automatic context rehydration: project-level L1 recall for the
// session-start packet and record-level sg-formal scan for session
// resume. Both degrade instead of throwing: unenrolled fails closed
// with enrolled:false; runtime failures surface as error markers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { resolveContext } from '../src/core/context.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { prepareWorkspace, bindWorkspace } from '../src/core/workspaces.mjs';
import {
  callVantaDBTool, saveVantaDBConfig, DEFAULT_VANTADB_VERSION,
  VANTADB_BACKEND_ID,
} from '../src/integrations/vantadb-runtime.mjs';
import {
  projectRehydration, recordRehydration,
} from '../src/integrations/vantadb-rehydrate.mjs';
import { createConfig } from '../src/core/config.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, writeJson }
  from './helpers.mjs';

const FAKE_SERVER = fileURLToPath(
  new URL('./fixtures/fake-vantadb-mcp.mjs', import.meta.url));

function fixture() {
  const dir = makeTempDir('rehydration');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir,
    config: '.tasksystem/config.json' });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a] = prepared.workspace.areas.map((area) => area.id);
  return { dir, ctx, bound: bindWorkspace(ctx, { areaIds: [a] }) };
}

// Enrolled binaries must resolve OUTSIDE the project root.
function enroll(dir) {
  const binDir = path.join(path.dirname(dir), `bin-${path.basename(dir)}`);
  fs.mkdirSync(binDir, { recursive: true });
  const c = {
    schemaVersion: 1, backendId: VANTADB_BACKEND_ID,
    version: DEFAULT_VANTADB_VERSION,
    binaryPath: path.join(binDir, 'vantadb-server'),
    storagePath: path.join(dir, 'vanta-data'),
  };
  fs.writeFileSync(c.binaryPath, 'placeholder');
  return c;
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

test('projectRehydration recalls seeded L1 memories over a real stdio session', async () => {
  const f = fixture();
  try {
    const c = enroll(f.dir);
    saveVantaDBConfig(f.ctx, c);
    // Seed one curated L1 episodic record, as vantaDBDistill writes them.
    await callVantaDBTool({ cfg: c, name: 'memory_put',
      arguments: {
        namespace: 'l1/scopegrain', key: 'sg-worklog-progress-x',
        payload: JSON.stringify({
          content: 'Scopegrain progress entry: rehydration test',
          agent_id: 'default', team_id: 'default', type: 'episodic',
        }),
      },
      spawnImpl: fakeSpawn() });

    const out = await projectRehydration({ ctx: f.ctx, query: 'rehydration',
      spawnImpl: fakeSpawn() });
    assert.equal(out.enrolled, true);
    assert.equal(out.recall.recalled.length, 1);
    assert.match(out.recall.recalled[0].content, /rehydration test/);
    assert.equal(typeof out.recall.prepend_context, 'string');
  } finally {
    cleanup(f.dir);
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
