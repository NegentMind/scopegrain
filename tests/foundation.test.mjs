// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_CONFIG_PATH, DEFAULT_PATH_PROPOSALS,
  createConfig, loadConfig, resolveConfigPath,
} from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { applyPlan, buildInitPlan, prepareInit } from '../src/core/bootstrap.mjs';
import { inspectProject } from '../src/discovery/inspect.mjs';
import { run } from '../src/cli.mjs';
import {
  VALID_ANSWERS, cleanup, fakeIO, makeTempDir, trySymlink, writeFile, writeJson,
} from './helpers.mjs';

const currentAnswers = {
  ...VALID_ANSWERS,
  paths: Object.fromEntries(
    ['plans', 'tasks', 'reports', 'research', 'decisions', 'memory', 'state']
      .map((key) => [key, `.scopegrain/${key}`])),
};

function tree(root, prefix = '') {
  const out = {};
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const abs = path.join(root, rel);
    const stat = fs.lstatSync(abs);
    out[rel] = stat.isDirectory() ? 'directory' : fs.readFileSync(abs);
    if (stat.isDirectory()) Object.assign(out, tree(root, rel));
  }
  return out;
}

test('new defaults use .scopegrain for config and all artifact paths', () => {
  assert.equal(DEFAULT_CONFIG_PATH, '.scopegrain/config.json');
  assert.deepEqual(DEFAULT_PATH_PROPOSALS, currentAnswers.paths);
  const dir = makeTempDir('foundation-default');
  try {
    assert.equal(resolveConfigPath(dir), DEFAULT_CONFIG_PATH);
    assert.equal(resolveConfigPath(dir, null), DEFAULT_CONFIG_PATH);
    const before = tree(dir);
    const plan = prepareInit({ projectRoot: dir, answers: currentAnswers });
    assert.equal(plan.configRel, DEFAULT_CONFIG_PATH);
    assert.equal(buildInitPlan({ projectRoot: dir,
      config: createConfig(dir, currentAnswers, {}), discovery: {} }).configRel,
    DEFAULT_CONFIG_PATH);
    assert.throws(() => prepareInit({ projectRoot: dir, configRel: '',
      answers: currentAnswers }), (e) => e.code === 'INVALID_PATH');
    assert.deepEqual(tree(dir), before);
    applyPlan(dir, plan.files);
    assert.equal(loadConfig(dir).configPath, DEFAULT_CONFIG_PATH);
    assert.deepEqual(resolveContext({ project: dir }).config.paths,
      currentAnswers.paths);
  } finally { cleanup(dir); }
});

test('a config at a non-default path is never auto-selected', () => {
  const dir = makeTempDir('foundation-legacy');
  try {
    applyPlan(dir, prepareInit({
      projectRoot: dir, configRel: 'custom/config.json', answers: VALID_ANSWERS,
    }).files);
    const before = tree(dir);
    assert.equal(resolveConfigPath(dir), DEFAULT_CONFIG_PATH);
    assert.throws(() => loadConfig(dir), (e) => e.code === 'CONFIG_NOT_FOUND');
    assert.equal(loadConfig(dir, 'custom/config.json').configPath,
      'custom/config.json');
    assert.equal(buildInitPlan({ projectRoot: dir,
      configRel: 'custom/config.json',
      config: loadConfig(dir, 'custom/config.json').config,
      discovery: {} }).configRel, 'custom/config.json');
    const plan = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS,
      configRel: 'custom/config.json' });
    assert.equal(plan.configRel, 'custom/config.json');
    assert.ok(plan.files.every((file) => file.action === 'noop'));
    assert.equal(applyPlan(dir, plan.files).created, 0);
    assert.deepEqual(tree(dir), before);
    assert.equal(fs.existsSync(path.join(dir, '.scopegrain')), false);
  } finally { cleanup(dir); }
});

test('config resolution has no fallback beyond the default path', () => {
  const dir = makeTempDir('foundation-selection');
  try {
    const config = createConfig(dir, VALID_ANSWERS, {});
    fs.mkdirSync(path.join(dir, '.scopegrain'));
    assert.equal(resolveConfigPath(dir), DEFAULT_CONFIG_PATH);
    writeJson(dir, DEFAULT_CONFIG_PATH, config);
    assert.equal(resolveContext({ project: dir }).configPath, DEFAULT_CONFIG_PATH);
    writeFile(dir, 'other/config.json', '{invalid');
    assert.equal(loadConfig(dir).configPath, DEFAULT_CONFIG_PATH);
    assert.throws(() => loadConfig(dir, 'other/config.json'),
      (e) => e.code === 'MALFORMED_JSON');
    writeJson(dir, 'other/config.json', config);
    assert.equal(resolveContext({ project: dir, config: 'other/config.json' }).configPath,
      'other/config.json');
    writeFile(dir, DEFAULT_CONFIG_PATH, '{invalid');
    assert.throws(() => loadConfig(dir), (e) => e.code === 'MALFORMED_JSON');
    assert.equal(loadConfig(dir, 'other/config.json').configPath, 'other/config.json');
    assert.throws(() => loadConfig(dir, 'missing/config.json'),
      (e) => e.code === 'CONFIG_NOT_FOUND');
    for (const invalid of ['', 0, false, {}]) {
      assert.throws(() => resolveConfigPath(dir, invalid),
        (e) => e.code === 'INVALID_PATH');
    }
    writeJson(dir, 'custom/config.json', config);
    assert.equal(loadConfig(dir, 'custom\\config.json').configPath, 'custom/config.json');
    assert.deepEqual(loadConfig(dir, 'custom/config.json').config.paths, VALID_ANSWERS.paths);
  } finally { cleanup(dir); }
});

test('config directory entry is not silently skipped', () => {
  const dir = makeTempDir('foundation-nonfile');
  try {
    fs.mkdirSync(path.join(dir, '.scopegrain', 'config.json'), { recursive: true });
    assert.throws(() => loadConfig(dir), (e) => e.code === 'CONFIG_NOT_FILE');
  } finally { cleanup(dir); }
});

test('config file links are rejected', (t) => {
  const dir = makeTempDir('foundation-links');
  const target = makeTempDir('foundation-links-target');
  try {
    const file = writeJson(target, 'config.json', createConfig(dir, VALID_ANSWERS, {}));
    fs.mkdirSync(path.join(dir, '.scopegrain'));
    if (!trySymlink(file, path.join(dir, '.scopegrain', 'config.json'), 'file')) {
      t.skip('file symlinks unavailable');
      return;
    }
    assert.throws(() => loadConfig(dir), (e) => e.code === 'SYMLINK_REJECTED');
    assert.throws(() => loadConfig(dir, DEFAULT_CONFIG_PATH),
      (e) => e.code === 'SYMLINK_REJECTED');
  } finally { cleanup(dir); cleanup(target); }
});

test('linked config ancestor is rejected at load', (t) => {
  const dir = makeTempDir('foundation-ancestor');
  const target = makeTempDir('foundation-ancestor-target');
  try {
    const config = createConfig(dir, currentAnswers, {});
    writeJson(target, 'config.json', config);
    if (!trySymlink(target, path.join(dir, '.scopegrain'))) {
      t.skip('directory junctions unavailable');
      return;
    }
    assert.throws(() => loadConfig(dir), (e) => e.code === 'SYMLINK_REJECTED');
    assert.throws(() => loadConfig(dir, DEFAULT_CONFIG_PATH),
      (e) => e.code === 'SYMLINK_REJECTED');
  } finally { cleanup(dir); cleanup(target); }
});

test('non-directory ancestor is not silently skipped', () => {
  const dir = makeTempDir('foundation-ancestor-file');
  try {
    writeJson(dir, 'custom/config.json', createConfig(dir, { ...currentAnswers,
      paths: Object.fromEntries(Object.keys(currentAnswers.paths)
        .map((k) => [k, `custom/${k}`])) }, {}));
    writeFile(dir, '.scopegrain', 'not a directory');
    assert.throws(() => loadConfig(dir), (e) => e.code === 'FILE_ANCESTOR');
    assert.equal(loadConfig(dir, 'custom/config.json').configPath,
      'custom/config.json');
  } finally { cleanup(dir); }
});

test('interactive init selects existing config and never asks twice', async () => {
  const dir = makeTempDir('foundation-tty');
  try {
    applyPlan(dir, prepareInit({
      projectRoot: dir, configRel: DEFAULT_CONFIG_PATH, answers: VALID_ANSWERS,
    }).files);
    // Interactive init persists a resumable wizard session under the default
    // state dir; exclude it from no-write assertions.
    const noSession = (t) => Object.fromEntries(Object.entries(t)
      .filter(([k]) => k !== '.scopegrain' && !k.startsWith('.scopegrain/')));
    const before = noSession(tree(dir));
    const io = fakeIO({ tty: true });
    assert.equal(await run(['init', '--project', dir], io), 0);
    assert.equal(io.out.asked.find((a) => a.label === 'Ruta de configuracion').def,
      DEFAULT_CONFIG_PATH);
    assert.equal(io.out.asked.find((a) => a.label === 'Nombre del proyecto').def,
      VALID_ANSWERS.name);
    assert.deepEqual(noSession(tree(dir)), before);
    // An explicit --config selects the config at that path; init on a
    // project already initialized there is a true no-op.
    const dir2 = makeTempDir('foundation-tty-custom');
    try {
      applyPlan(dir2, prepareInit({ projectRoot: dir2,
        configRel: 'custom/config.json', answers: VALID_ANSWERS }).files);
      const explicit = fakeIO({ tty: true });
      assert.equal(await run(['init', '--project', dir2, '--config',
        'custom/config.json'], explicit), 0);
      assert.equal(explicit.out.asked.find((a) => a.label === 'Ruta de configuracion').def,
        'custom/config.json');
    } finally { cleanup(dir2); }
    const input = writeJson(dir, 'answers.json',
      { ...VALID_ANSWERS, name: 'divergent-name' });
    const beforeJson = noSession(tree(dir));
    const io3 = fakeIO();
    assert.equal(await run(['init', '--project', dir, '--answers', input], io3), 1);
    assert.equal(JSON.parse(io3.out.stderr[0]).error.code, 'INIT_CONFLICT');
    assert.deepEqual(noSession(tree(dir)), beforeJson);
  } finally { cleanup(dir); }
});

test('JSON init preview and empty explicit config do not write', async () => {
  const dir = makeTempDir('foundation-preview');
  try {
    const answers = writeJson(dir, 'answers.json', currentAnswers);
    const before = tree(dir);
    const io = fakeIO();
    assert.equal(await run(['init', '--project', dir, '--answers', answers], io), 0);
    assert.deepEqual(tree(dir), before);
    const custom = fakeIO();
    assert.equal(await run(['init', '--project', dir, '--answers', answers,
      '--config', 'custom/config.json'], custom), 0);
    assert.ok(JSON.parse(custom.out.stdout.at(-1)).files
      .some((file) => file.path === 'custom/config.json'));
    assert.deepEqual(tree(dir), before);
    const empty = fakeIO();
    assert.equal(await run(['init', '--project', dir, '--config', '',
      '--answers', answers], empty), 1);
    assert.equal(JSON.parse(empty.out.stderr[0]).error.code, 'INVALID_PATH');
    assert.deepEqual(tree(dir), before);
  } finally { cleanup(dir); }
});

test('old V1/V2 manifest and attributes conflict without changing bytes', () => {
  const dir = makeTempDir('foundation-old-snapshot');
  try {
    const answers = { ...VALID_ANSWERS, hosts: ['opencode'] };
    applyPlan(dir, prepareInit({
      projectRoot: dir, configRel: DEFAULT_CONFIG_PATH, answers,
    }).files);
    const manifest = path.join(dir, '.scopegrain/integrations/native/activation-plan.json');
    const old = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const v2 = old.entries.find((entry) => entry.host === 'opencode');
    old.entries.push({ ...v2, variant: 'v1', selectionRequired: true });
    for (const entry of old.entries) {
      if (entry.host === 'opencode') entry.selectionRequired = true;
    }
    fs.writeFileSync(manifest, JSON.stringify(old, null, 2) + '\n');
    fs.appendFileSync(path.join(dir, '.scopegrain/.gitattributes'),
      '"/integrations/opencode-v1-mcp.json" -text\n');
    writeFile(dir, '.scopegrain/integrations/opencode-v1-mcp.json', '{"legacy":true}\n');
    const before = tree(dir);
    assert.throws(() => prepareInit({ projectRoot: dir, answers }),
      (e) => e.code === 'PLAN_CONFLICT'
        && e.conflicts.some((c) => c.path.endsWith('activation-plan.json'))
        && e.conflicts.some((c) => c.path.endsWith('.gitattributes')));
    assert.deepEqual(tree(dir), before);
  } finally { cleanup(dir); }
});

test('discovery excludes both operational directories', () => {
  const dir = makeTempDir('foundation-discovery');
  try {
    writeJson(dir, '.scopegrain/package.json', { name: 'legacy' });
    writeJson(dir, '.scopegrain/package.json', { name: 'current' });
    writeJson(dir, 'package.json', { name: 'project' });
    const result = inspectProject(dir);
    assert.deepEqual(result.evidence.filter((e) => e.type === 'manifest')
      .map((e) => e.path), ['package.json']);
  } finally { cleanup(dir); }
});

test('both entrypoints delegate to the shared CLI and preserve package metadata', async () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  // bin points at both committed entrypoints (v0.1.0 packaging); files
  // stays out of the manifest until the release direction is decided.
  assert.deepEqual(pkg.bin, {
    scopegrain: 'bin/scopegrain.mjs',
    scopegrain: 'bin/scopegrain.mjs',
  });
  // provenance is deliberately excluded from the package (FIND-026): the
  // archive is local-only pending provenance/license review, so it must
  // not ship in the npm tarball.
  assert.deepEqual(pkg.files, [
    'bin', 'src', 'resources', 'policy', 'templates', 'schemas',
    'docs/*.md', 'docs/en/*.md', 'viewer/dist', 'examples',
    'CHANGELOG.md', 'AUTHORS', 'NOTICE',
  ]);
  assert.equal(pkg.license, 'Apache-2.0');
  for (const entry of ['./bin/scopegrain.mjs', './bin/scopegrain.mjs']) {
    const content = fs.readFileSync(new URL(`../${entry}`, import.meta.url), 'utf8');
    assert.match(content, /import \{ run, defaultIO \} from '\.\.\/src\/cli\.mjs'/);
    assert.match(content, /process\.exitCode = await run\(process\.argv\.slice\(2\), defaultIO\(\)\)/);
  }
  const io = fakeIO();
  assert.equal(await run(['--help'], io), 0);
  const help = JSON.parse(io.out.stdout[0]);
  assert.ok(help.usage.startsWith('scopegrain '));
  assert.ok(help.notes.some((note) => note.includes('scopegrain')));
});

test('MCP context uses the same selector without connecting a transport', async (t) => {
  try {
    await import('@modelcontextprotocol/sdk/server/mcp.js');
    await import('zod');
  } catch {
    t.skip('optional MCP dependencies are not installed');
    return;
  }
  const { createMCPServer } = await import('../src/mcp/server.mjs');
  const dir = makeTempDir('foundation-mcp');
  try {
    const config = createConfig(dir, VALID_ANSWERS, {});
    writeJson(dir, 'custom/config.json', config);
    const custom = await createMCPServer(
      { project: dir, config: 'custom/config.json' });
    assert.equal(custom.ctx.configPath, 'custom/config.json');
    writeJson(dir, DEFAULT_CONFIG_PATH, config);
    const explicit = await createMCPServer({ project: dir, config: DEFAULT_CONFIG_PATH });
    assert.equal(explicit.ctx.configPath, DEFAULT_CONFIG_PATH);
  } finally { cleanup(dir); }
});

test('test script bounds file-level concurrency without skipping tests', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test --test-concurrency=1 tests/*.test.mjs');
});
