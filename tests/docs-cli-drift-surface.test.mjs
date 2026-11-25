// SPDX-License-Identifier: Apache-2.0
// docs-cli-drift surface checks (audit G13): documented --flags that no
// CLI literal declares, numeric count claims that diverge from code, and
// ES/EN section parity — all warning-level on synthetic fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkDocsCliDrift, extractCliFlags, extractMcpToolNames,
  headingSignature, scanDocSurface,
} from '../src/core/docs-cli-drift.mjs';
import { cleanup, makeTempDir, writeFile } from './helpers.mjs';

const INSTALL_ROOT = fileURLToPath(new URL('..', import.meta.url));

const CLI_SRC = [
  "const VALUE_FLAGS = new Set(['--project', '--config', '--timeout']);",
  "const BOOL_FLAGS = new Set(['--apply', '--help']);",
  "const REJECTED_FLAGS = new Set(['--yes', '--force']);",
  '// a --commented flag in prose is not a literal',
  'const COMMANDS = {',
  "  init: { flags: ['--project', '--apply'], pos: 0,",
  "    usage: 'init --project PATH [--apply]' },",
  "  doctor: { flags: ['--project'], pos: 0,",
  "    usage: 'doctor --project PATH' },",
  "  'verify run': { flags: ['--project', '--timeout'], pos: 1,",
  "    usage: 'verify run ID --project PATH [--timeout MS]' },",
  '};',
].join('\n');

const MCP_SRC = [
  'const tools = [',
  "  { name: 'scopegrain_alpha' },",
  "  { name: 'scopegrain_beta' },",
  "  { name: 'scopegrain_gamma' },",
  "  { name: 'scopegrain_alpha' },",
  "  { name: 'other_tool' },",
  '];',
].join('\n');

function install() {
  const root = makeTempDir('drift-install');
  writeFile(root, 'src/cli.mjs', CLI_SRC);
  writeFile(root, 'src/mcp/server.mjs', MCP_SRC);
  return root;
}

function project(files) {
  const root = makeTempDir('drift-proj');
  for (const [rel, text] of Object.entries(files)) {
    writeFile(root, rel, text);
  }
  return root;
}

test('extractCliFlags reads literals from sets, flag lists and usages', () => {
  const flags = extractCliFlags(CLI_SRC);
  for (const f of ['--project', '--config', '--timeout', '--apply',
    '--help', '--yes', '--force']) {
    assert.ok(flags.has(f), `missing ${f}`);
  }
  assert.ok(!flags.has('--commented'), 'comments are not literals');
  assert.ok(!flags.has('init'));
  const real = extractCliFlags(fs.readFileSync(
    path.join(INSTALL_ROOT, 'src', 'cli.mjs'), 'utf8'));
  for (const f of ['--project', '--apply', '--timeout', '--fail-on-error',
    '--yes', '--force', '--token-limit']) {
    assert.ok(real.has(f), `real cli.mjs missing ${f}`);
  }
});

test('extractMcpToolNames counts unique scopegrain_ tool literals', () => {
  const names = extractMcpToolNames(MCP_SRC);
  assert.equal(names.size, 3);
  assert.ok(!names.has('other_tool'));
  const real = extractMcpToolNames(fs.readFileSync(
    path.join(INSTALL_ROOT, 'src', 'mcp', 'server.mjs'), 'utf8'));
  assert.equal(real.size, 39);
});

test('scanDocSurface collects flags from spans and invocation examples', () => {
  const s = scanDocSurface([
    '`scopegrain init --project PATH --bogus` runs setup.',
    'The `--phantom` flag is documented prose.',
    'npm installs need `--no-audit` on this line.',
    '```text',
    'scopegrain verify run ID --timeout MS --gone',
    '```',
  ].join('\n'));
  assert.ok(s.flags.get('--bogus')?.has('invoke'));
  assert.ok(s.flags.get('--phantom')?.has('span'));
  assert.ok(s.flags.get('--gone')?.has('invoke'));
  assert.ok(!s.flags.has('--no-audit'), 'foreign-tool lines are skipped');
  assert.ok(s.flags.get('--project')?.has('invoke'));
});

test('scanDocSurface captures numeric claims for later classification', () => {
  const s = scanDocSurface([
    'El servidor MCP ofrece 33 herramientas.',
    'La CLI expone 141 verbos.',
    'git necesita 2 comandos.',
    'Hay 3 pasos en la receta.',
  ].join('\n'));
  assert.equal(s.counts.length, 3);
  assert.deepEqual(
    s.counts.map((c) => c.unit),
    ['herramientas', 'verbos', 'comandos']);
});

test('headingSignature counts ATX levels and ignores fenced blocks', () => {
  assert.deepEqual(
    headingSignature('# A\n## B\n```\n# not a heading\n```\n### C\n'),
    [1, 2, 3]);
  assert.deepEqual(headingSignature('no headings\n'), []);
});

test('drift flags documented flags with no CLI literal (span + example)', () => {
  const inst = install();
  const proj = project({
    'README.md': [
      '# fixture',
      '`scopegrain init --project PATH` works.',
      '`scopegrain doctor --project PATH` too.',
      'Use `--ghost` for nothing.',
      '```text',
      'scopegrain verify run ID --project PATH --timeout MS --spectral',
      '```',
    ].join('\n'),
  });
  try {
    const r = checkDocsCliDrift({ projectRoot: proj, installRoot: inst });
    assert.equal(r.ok, false);
    assert.ok(r.flags.includes('--ghost(span)'));
    assert.ok(r.flags.includes('--spectral(invoke)'));
    assert.deepEqual(r.stale, []);
    assert.deepEqual(r.undocumented, []);
    assert.match(r.detail, /--ghost/);
  } finally {
    cleanup(inst);
    cleanup(proj);
  }
});

test('drift flags count claims that diverge from code, ignores unguarded', () => {
  const inst = install();
  const proj = project({
    'README.md': [
      '# fixture',
      'El servidor MCP ofrece 33 herramientas.',
      'La CLI expone 3 verbos.',
      '`resources/` — 5 skills · 2 commands',
      'Una nota suelta: 9 tools sin contexto.',
      '`scopegrain init --project PATH`',
      '`scopegrain doctor --project PATH`',
      '`scopegrain verify run ID --project PATH`',
    ].join('\n'),
  });
  try {
    const r = checkDocsCliDrift(
      { projectRoot: proj, installRoot: inst, catalog: null });
    assert.deepEqual(r.counts, [
      'README.md: claimed 33 herramientas, code has 3',
    ]);
    assert.match(r.detail, /count drift/);
  } finally {
    cleanup(inst);
    cleanup(proj);
  }
});

test('drift skips count claims inside dated paragraphs', () => {
  const inst = install();
  const proj = project({
    'README.md': [
      '# fixture',
      'Pilot session 2026-11-23: the MCP had 33 tools and the CLI 3 verbos.',
      '',
      'El servidor MCP ofrece 33 herramientas.',
      '`scopegrain init --project PATH`',
      '`scopegrain doctor --project PATH`',
      '`scopegrain verify run ID --project PATH`',
    ].join('\n'),
  });
  try {
    const r = checkDocsCliDrift(
      { projectRoot: proj, installRoot: inst, catalog: null });
    // The dated pilot line is a point-in-time record (skipped); the
    // undated current-state claim still diverges and is reported.
    assert.deepEqual(r.counts, [
      'README.md: claimed 33 herramientas, code has 3',
    ]);
  } finally {
    cleanup(inst);
    cleanup(proj);
  }
});

test('drift compares catalog-anchored counts against the catalog', () => {
  const inst = install();
  const proj = project({
    'README.md': [
      '# fixture',
      'resources/ — 7 commands · 2 skills',
      '`scopegrain init --project PATH`',
      '`scopegrain doctor --project PATH`',
      '`scopegrain verify run ID --project PATH`',
    ].join('\n'),
  });
  const catalog = {
    byKey: new Map([
      ['command/a', {}], ['command/b', {}], ['skill/x', {}], ['skill/y', {}],
    ]),
    aliases: [],
  };
  try {
    const r = checkDocsCliDrift(
      { projectRoot: proj, installRoot: inst, catalog });
    assert.equal(r.counts.length, 1);
    assert.match(r.counts[0], /claimed 7 commands, code has 2/);
  } finally {
    cleanup(inst);
    cleanup(proj);
  }
});

test('drift reports ES/EN section parity gaps both directions', () => {
  const inst = install();
  const proj = project({
    'README.md': [
      '`scopegrain init --project PATH`',
      '`scopegrain doctor --project PATH`',
      '`scopegrain verify run ID --project PATH`',
    ].join('\n'),
    'docs/guide.md': '# Guia\n\n## Uso\n\n### Detalle\n',
    'docs/en/guide.md': '# Guide\n\n## Usage\n',
    'docs/solo-es.md': '# Solo\n',
    'docs/en/solo-en.md': '# Only\n',
  });
  try {
    const r = checkDocsCliDrift({ projectRoot: proj, installRoot: inst });
    assert.ok(r.parity.includes(
      'docs/guide.md vs docs/en/guide.md: h3: 1 vs 0'));
    assert.ok(r.parity.includes(
      'docs/solo-es.md: no docs/en/solo-es.md pair'));
    assert.ok(r.parity.includes(
      'docs/en/solo-en.md: no docs/solo-en.md pair'));
    assert.match(r.detail, /es\/en gaps/);
  } finally {
    cleanup(inst);
    cleanup(proj);
  }
});

test('a clean doc set reports no drift at all', () => {
  const inst = install();
  const proj = project({
    'README.md': [
      '# fixture',
      '`scopegrain init --project PATH`',
      '`scopegrain doctor --project PATH`',
      '`scopegrain verify run ID --project PATH --timeout MS`',
      'El MCP expone 3 tools.',
    ].join('\n'),
    'docs/guide.md': '# Guia\n\n## Uso\n',
    'docs/en/guide.md': '# Guide\n\n## Usage\n',
  });
  try {
    const r = checkDocsCliDrift({ projectRoot: proj, installRoot: inst });
    assert.equal(r.ok, true);
    assert.match(r.detail, /no drift/);
    assert.deepEqual(r.flags, []);
    assert.deepEqual(r.counts, []);
    assert.deepEqual(r.parity, []);
  } finally {
    cleanup(inst);
    cleanup(proj);
  }
});
