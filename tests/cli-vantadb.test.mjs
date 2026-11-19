import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../src/cli.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { applyJournaledCreation } from '../src/core/journal.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import { VALID_ANSWERS, cleanup, fakeIO, makeTempDir, writeJson } from './helpers.mjs';

function fixture() {
  const dir = makeTempDir('cli-vantadb');
  const configRel = 'custom/config.json';
  const answers = { ...VALID_ANSWERS,
    paths: { ...VALID_ANSWERS.paths, state: 'custom/state' } };
  writeJson(dir, configRel, createConfig(dir, answers, {}));
  const ctx = resolveContext({ project: dir, config: configRel });
  const workspace = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }],
  });
  applyPlan(dir, [workspace.file]);
  const areaIds = workspace.workspace.areas.map((area) => area.id);
  return { dir, ctx, configRel, bound: bindWorkspace(ctx, { areaIds }) };
}

async function call(args) {
  const io = fakeIO();
  const code = await run(args, io);
  return { code, output: code === 0 ? JSON.parse(io.out.stdout.at(-1))
    : JSON.parse(io.out.stderr.at(-1)).error };
}

function tree(dir) {
  const result = {};
  function visit(abs, rel = '') {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { result[next] = 'directory'; visit(path.join(abs, entry.name), next); }
      else result[next] = fs.readFileSync(path.join(abs, entry.name));
    }
  }
  visit(dir);
  return result;
}

test('help lists exactly the authored vantadb usages', async () => {
  const result = await call(['--help']);
  assert.equal(result.code, 0);
  const usages = result.output.commands.map((command) => command.command);
  assert.ok(usages.includes('vantadb setup --project PATH [--version X] [--storage PATH] [--binary PATH] [--install-dir DIR] [--apply]'));
  assert.ok(usages.includes('vantadb status --project PATH'));
  assert.ok(usages.includes('vantadb sync --project PATH [--limit N] [--timeout MS]'));
  assert.ok(usages.includes('vantadb get --project PATH --namespace NS --key K [--timeout MS]'));
  assert.ok(usages.includes('vantadb search --project PATH --namespace NS --query TEXT [--top-k N] [--timeout MS]'));
  assert.ok(usages.includes('vantadb list --project PATH --namespace NS [--timeout MS]'));
  assert.ok(usages.includes('vantadb recall --project PATH --query TEXT [--scope session|agent|team] [--top-k N] [--timeout MS]'));
});

test('setup preview is read-only: no config, no storage dir, no writes', async () => {
  const f = fixture();
  try {
    const before = tree(f.dir);
    const result = await call(['vantadb', 'setup', '--project', f.dir,
      '--config', f.configRel]);
    assert.equal(result.code, 0);
    assert.equal(result.output.preview, true);
    assert.match(result.output.asset.name, /^vantadb-.*(zip|tar\.gz)$/);
    assert.deepEqual(tree(f.dir), before);
  } finally {
    cleanup(f.dir);
  }
});

test('setup --apply with explicit --binary enrolls config; status reflects it', async () => {
  const f = fixture();
  try {
    const binary = path.join(f.dir, 'bin', 'vantadb-server.exe');
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(binary, 'placeholder');
    const storage = path.join(f.dir, 'store');
    const applied = await call(['vantadb', 'setup', '--project', f.dir,
      '--config', f.configRel, '--binary', binary, '--storage', storage,
      '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.output.applied, true);
    assert.equal(applied.output.downloaded, false);
    assert.equal(applied.output.config.binaryPath, binary);
    assert.equal(applied.output.config.storagePath, storage);
    assert.ok(fs.existsSync(applied.output.configPath));
    assert.ok(fs.existsSync(storage));

    const status = await call(['vantadb', 'status', '--project', f.dir,
      '--config', f.configRel]);
    assert.equal(status.code, 0);
    assert.equal(status.output.configured, true);
    assert.equal(status.output.binaryPresent, true);
    assert.equal(status.output.storagePresent, true);
    assert.equal(status.output.pendingCommittedEvents, 0);
  } finally {
    cleanup(f.dir);
  }
});

test('setup --apply rejects a missing --binary file before any write', async () => {
  const f = fixture();
  try {
    const before = tree(f.dir);
    const result = await call(['vantadb', 'setup', '--project', f.dir,
      '--config', f.configRel, '--binary', path.join(f.dir, 'nope.exe'),
      '--apply']);
    assert.equal(result.code, 1);
    assert.equal(result.output.code, 'VANTADB_BINARY_MISSING');
    assert.deepEqual(tree(f.dir), before);
  } finally {
    cleanup(f.dir);
  }
});

test('sync and get without enrollment fail closed VANTADB_NOT_CONFIGURED', async () => {
  const f = fixture();
  try {
    const sync = await call(['vantadb', 'sync', '--project', f.dir,
      '--config', f.configRel]);
    assert.equal(sync.code, 1);
    assert.equal(sync.output.code, 'VANTADB_NOT_CONFIGURED');
    const get = await call(['vantadb', 'get', '--project', f.dir,
      '--config', f.configRel, '--namespace', 'n', '--key', 'k']);
    assert.equal(get.code, 1);
    assert.equal(get.output.code, 'VANTADB_NOT_CONFIGURED');
    for (const verb of [
      ['search', '--namespace', 'n', '--query', 'q'],
      ['list', '--namespace', 'n'],
      ['recall', '--query', 'q'],
    ]) {
      const r = await call(['vantadb', verb[0], '--project', f.dir,
        '--config', f.configRel, ...verb.slice(1)]);
      assert.equal(r.code, 1);
      assert.equal(r.output.code, 'VANTADB_NOT_CONFIGURED');
    }
  } finally {
    cleanup(f.dir);
  }
});

test('unreachable enrolled binary surfaces as structured spawn/exit error', async () => {
  const f = fixture();
  try {
    // process.execPath is a real binary but not an MCP server: node dies on
    // the unknown '--mcp' flag -> VANTADB_PROCESS_EXIT, never a crash.
    const applied = await call(['vantadb', 'setup', '--project', f.dir,
      '--config', f.configRel, '--binary', process.execPath,
      '--storage', path.join(f.dir, 'store'), '--apply']);
    assert.equal(applied.code, 0);
    const get = await call(['vantadb', 'get', '--project', f.dir,
      '--config', f.configRel, '--namespace', 'n', '--key', 'k',
      '--timeout', '5000']);
    assert.equal(get.code, 1);
    assert.ok(['VANTADB_PROCESS_EXIT', 'VANTADB_TIMEOUT', 'VANTADB_SPAWN_FAILED']
      .includes(get.output.code), `unexpected code: ${get.output.code}`);
  } finally {
    cleanup(f.dir);
  }
});

test('vantadb commands reject unknown flags and missing required flags', async () => {
  const f = fixture();
  try {
    const bad = await call(['vantadb', 'setup', '--project', f.dir,
      '--config', f.configRel, '--bogus', '1']);
    assert.equal(bad.code, 1);
    assert.equal(bad.output.code, 'INVALID_ARGS');
    const noNs = await call(['vantadb', 'get', '--project', f.dir,
      '--config', f.configRel, '--key', 'k']);
    assert.equal(noNs.code, 1);
    assert.equal(noNs.output.code, 'INVALID_ARGS');
    const pending = await call(['vantadb', 'pending', '--project', f.dir]);
    assert.equal(pending.code, 1);
    assert.equal(pending.output.code, 'INVALID_ARGS');
    // Read verbs validate required flags before touching config (pre-IO).
    const noQuery = await call(['vantadb', 'recall', '--project', f.dir,
      '--config', f.configRel]);
    assert.equal(noQuery.code, 1);
    assert.equal(noQuery.output.code, 'INVALID_ARGS');
    const noNsSearch = await call(['vantadb', 'search', '--project', f.dir,
      '--config', f.configRel, '--query', 'q']);
    assert.equal(noNsSearch.code, 1);
    assert.equal(noNsSearch.output.code, 'INVALID_ARGS');
    const noNsList = await call(['vantadb', 'list', '--project', f.dir,
      '--config', f.configRel]);
    assert.equal(noNsList.code, 1);
    assert.equal(noNsList.output.code, 'INVALID_ARGS');
  } finally {
    cleanup(f.dir);
  }
});
