// SPDX-License-Identifier: Apache-2.0
// docs-cli-drift: verb-table extraction, doc scanning and doctor wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDoctor } from '../src/core/doctor.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { applyPlan, prepareInit } from '../src/core/bootstrap.mjs';
import { loadCatalog } from '../src/core/catalog.mjs';
import {
  catalogCommandVerbs, checkDocsCliDrift, extractApiRoutes, extractCliVerbs,
  scanDocSurface, scanDocText,
} from '../src/core/docs-cli-drift.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeFile,
} from './helpers.mjs';

const INSTALL_ROOT = fileURLToPath(new URL('..', import.meta.url));

function bootstrapped() {
  const dir = makeTempDir('drift');
  applyPlan(dir, prepareInit({ projectRoot: dir,
    configRel: '.scopegrain/config.json', answers: VALID_ANSWERS }).files);
  return { dir, ctx: resolveContext({ project: dir }) };
}

const driftCheck = (report) =>
  report.checks.find((c) => c.name === 'docs-cli-drift');

const CAPABILITY_CLI_SRC = [
  "const VALUE_FLAGS = new Set(['--project']);",
  'const COMMANDS = {',
  "  init: { flags: ['--project'], pos: 0,",
  "    usage: 'init --project PATH' },",
  "  doctor: { flags: ['--project'], pos: 0,",
  "    usage: 'doctor --project PATH' },",
  "  'verify run': { flags: ['--project'], pos: 1,",
  "    usage: 'verify run ID --project PATH' },",
  '};',
].join('\n');

const CAPABILITY_MCP_SRC = [
  'const tools = [',
  "  { name: 'scopegrain_alpha' },",
  "  { name: 'scopegrain_beta' },",
  '];',
].join('\n');

const CAPABILITY_API_SRC = [
  'export const ROUTES = [',
  "  { pattern: ['api', 'health'], query: [],",
  '    handler: (q) => q.health() },',
  "  { pattern: ['api', 'tasks', ':id'], query: [],",
  '    handler: (q, _url, p) => q.task(p.id) },',
  '];',
].join('\n');

function capabilityInstall() {
  const root = makeTempDir('drift-capability-install');
  writeFile(root, 'src/cli.mjs', CAPABILITY_CLI_SRC);
  writeFile(root, 'src/mcp/server.mjs', CAPABILITY_MCP_SRC);
  writeFile(root, 'src/api/server.mjs', CAPABILITY_API_SRC);
  return root;
}

function capabilityCatalog() {
  return {
    entries: [
      { kind: 'command', id: 'run', path: 'resources/commands/run.md' },
      { kind: 'skill', id: 'x', path: 'resources/skills/x/SKILL.md' },
    ],
    byKey: new Map([
      ['command/run', { kind: 'command', id: 'run' }],
      ['skill/x', { kind: 'skill', id: 'x' }],
    ]),
    aliases: [{ kind: 'command', id: 'run-alias', target: 'run' }],
  };
}

function writeCapabilityDocs(root, n) {
  const aliasWord = n.aliases === 1 ? 'alias' : 'aliases';
  const invocations = [
    '`scopegrain init --project PATH`',
    '`scopegrain doctor --project PATH`',
    '`scopegrain verify run ID --project PATH`',
    '`scopegrain run`',
    '`scopegrain run-alias`',
  ].join('\n');
  writeFile(root, 'docs/capability-map.md', [
    '# Mapa de capacidades',
    invocations,
    `| CLI \`bin/scopegrain.mjs\` | ${n.cli} subcomandos registrados |`,
    `| MCP \`src/mcp/server.mjs\` | ${n.mcp} tools \`scopegrain_*\` |`,
    `| API local \`src/api/server.mjs\` | ${n.api} rutas GET \`/api/*\` |`,
    `| Catálogo \`resources/manifest.json\` | ${n.entries} entradas + ${n.aliases} ${aliasWord} |`,
    `\`resources/\` — ${n.commands} commands · ${n.skills} skills`,
  ].join('\n'));
  writeFile(root, 'docs/en/capability-map.md', [
    '# Capability map',
    invocations,
    `| CLI \`bin/scopegrain.mjs\` | ${n.cli} registered subcommands |`,
    `| MCP \`src/mcp/server.mjs\` | ${n.mcp} \`scopegrain_*\` tools |`,
    `| Local API \`src/api/server.mjs\` | ${n.api} GET routes |`,
    `| Catalog \`resources/manifest.json\` | ${n.entries} entries + ${n.aliases} ${aliasWord} |`,
    `\`resources/\` — ${n.commands} commands · ${n.skills} skills`,
  ].join('\n'));
}

const CAPABILITY_GOOD = {
  cli: 3, mcp: 2, api: 2, entries: 2, aliases: 1, commands: 1, skills: 1,
};
const CAPABILITY_BAD = {
  cli: 4, mcp: 3, api: 3, entries: 3, aliases: 2, commands: 2, skills: 2,
};

test('extractCliVerbs reads the real COMMANDS table', () => {
  const src = fs.readFileSync(
    path.join(INSTALL_ROOT, 'src', 'cli.mjs'), 'utf8');
  const verbs = extractCliVerbs(src);
  assert.equal(verbs.length, 162);
  for (const v of ['doctor', 'init', 'task create', 'task check-action',
    'catalog legacy-show', 'verify run', 'view', 'mcp']) {
    assert.ok(verbs.includes(v), `missing verb ${v}`);
  }
  assert.equal(extractCliVerbs('const OTHER = { a: 1 };'), null);
  assert.equal(extractCliVerbs(''), null);
});

test('extractApiRoutes scans ROUTES patterns without importing the API server', () => {
  const src = [
    'export const ROUTES = [',
    "  // { pattern: ['api', 'commented'] },",
    "  { pattern: ['api', 'health'],",
    "    handler: () => ({ text: '{not-a-close' }) },",
    "  { pattern: ['api', 'tasks', ':id'],",
    '    handler: (q, _url, p) => q.task(p.id) },',
    '];',
  ].join('\n');
  assert.deepEqual(extractApiRoutes(src), [
    '/api/health', '/api/tasks/:id',
  ]);
  assert.deepEqual(extractApiRoutes([
    "// const ROUTES = [{ pattern: ['api', 'decoy'] }];",
    "function nested() { const ROUTES = [{ pattern: ['api', 'decoy'] }]; }",
    src,
  ].join('\n')), [
    '/api/health', '/api/tasks/:id',
  ]);
  const real = extractApiRoutes(fs.readFileSync(
    path.join(INSTALL_ROOT, 'src', 'api', 'server.mjs'), 'utf8'));
  assert.equal(real.length, 38);
  assert.ok(real.includes('/api/health'));
  assert.ok(real.includes('/api/tasks/:id'));
  assert.ok(real.includes('/api/catalog/:kind/:id'));
  assert.equal(extractApiRoutes('const OTHER = [];'), null);
  assert.equal(
    extractApiRoutes('export const ROUTES = [{ handler: () => 1 }];'), null);
});

test('capability count scanner reads markdown-wrapped bilingual counts', () => {
  const s = scanDocSurface([
    'catálogo `142` entradas',
    'MCP — 40 `scopegrain_*` tools',
    '**144 entries** + 32 aliases',
    'Local API — 38 GET routes',
    'CLI — 162 registered subcommands',
  ].join('\n'), { capabilityMap: true });
  assert.deepEqual(s.counts.map((c) => [c.n, c.unit]), [
    [142, 'entradas'],
    [40, 'tools'],
    [144, 'entries'],
    [32, 'aliases'],
    [38, 'routes'],
    [162, 'subcommands'],
  ]);
});

test('the real catalog exposes the manifest-derived counts', () => {
  const catalog = loadCatalog({});
  const kinds = {};
  for (const entry of catalog.entries) {
    kinds[entry.kind] = (kinds[entry.kind] || 0) + 1;
  }
  assert.equal(catalog.entries.length, 144);
  assert.equal(catalog.aliases.length, 32);
  assert.deepEqual(kinds, {
    command: 18, agent: 15, prompt: 11, rule: 23, skill: 44,
    mcp: 1, reference: 27, profile: 5,
  });
});

test('capability-map count gate accepts counts matching code and catalog', () => {
  const inst = capabilityInstall();
  const proj = makeTempDir('drift-capability-good');
  try {
    writeCapabilityDocs(proj, CAPABILITY_GOOD);
    const r = checkDocsCliDrift({
      projectRoot: proj, installRoot: inst, catalog: capabilityCatalog(),
    });
    assert.deepEqual(r.counts, []);
    assert.equal(r.ok, true, JSON.stringify(r));
  } finally {
    cleanup(inst);
    cleanup(proj);
  }
});

test('capability-map count gate covers every catalog resource kind', () => {
  const inst = capabilityInstall();
  const proj = makeTempDir('drift-capability-kinds');
  const writeKindDocs = (references) => {
    for (const rel of ['docs/capability-map.md', 'docs/en/capability-map.md']) {
      writeFile(proj, rel, [
        '`resources/` — 1 commands · 1 skills · 1 agents · 1 rules · '
          + `${references} references`,
        '`manifest.json` — 1 prompts · 1 profiles · 1 mcp',
      ].join('\n'));
    }
  };
  try {
    const kinds = [
      'command', 'skill', 'agent', 'rule', 'reference', 'prompt', 'profile', 'mcp',
    ];
    const entries = kinds.map((kind) => ({
      kind, id: `${kind}-one`, path: `resources/${kind}s/${kind}-one.md`,
    }));
    const catalog = {
      entries,
      byKey: new Map(entries.map((entry) => [`${entry.kind}/${entry.id}`, entry])),
      aliases: [],
    };
    writeKindDocs(1);
    const good = checkDocsCliDrift({
      projectRoot: proj, installRoot: inst, catalog,
    });
    assert.deepEqual(good.counts, []);
    writeKindDocs(2);
    const bad = checkDocsCliDrift({
      projectRoot: proj, installRoot: inst, catalog,
    });
    assert.deepEqual(bad.counts, [
      'docs/capability-map.md: claimed 2 references, code has 1',
      'docs/en/capability-map.md: claimed 2 references, code has 1',
    ]);
  } finally {
    cleanup(inst);
    cleanup(proj);
  }
});

test('capability-map count gate rejects falsified surface counts', () => {
  const inst = capabilityInstall();
  const proj = makeTempDir('drift-capability-bad');
  try {
    writeCapabilityDocs(proj, CAPABILITY_BAD);
    const r = checkDocsCliDrift({
      projectRoot: proj, installRoot: inst, catalog: capabilityCatalog(),
    });
    assert.equal(r.ok, false);
    assert.equal(r.counts.length, 14);
    for (const fragment of [
      'docs/capability-map.md: claimed 4 subcomandos, code has 3',
      'docs/capability-map.md: claimed 3 tools, code has 2',
      'docs/capability-map.md: claimed 3 rutas, code has 2',
      'docs/capability-map.md: claimed 3 entradas, code has 2',
      'docs/capability-map.md: claimed 2 aliases, code has 1',
      'docs/capability-map.md: claimed 2 commands, code has 1',
      'docs/capability-map.md: claimed 2 skills, code has 1',
      'docs/en/capability-map.md: claimed 4 subcommands, code has 3',
      'docs/en/capability-map.md: claimed 3 tools, code has 2',
      'docs/en/capability-map.md: claimed 3 routes, code has 2',
      'docs/en/capability-map.md: claimed 3 entries, code has 2',
      'docs/en/capability-map.md: claimed 2 aliases, code has 1',
      'docs/en/capability-map.md: claimed 2 commands, code has 1',
      'docs/en/capability-map.md: claimed 2 skills, code has 1',
    ]) {
      assert.ok(r.counts.includes(fragment), `missing count drift: ${fragment}`);
    }
  } finally {
    cleanup(inst);
    cleanup(proj);
  }
});

test('catalogCommandVerbs collects command ids and command aliases', () => {
  const catalog = loadCatalog({});
  const verbs = catalogCommandVerbs(catalog);
  assert.ok(verbs.includes('plan-work'));
  assert.ok(verbs.includes('pipeline'));
  assert.ok(!verbs.includes('progreso')); // skill alias, not a command
  assert.deepEqual(catalogCommandVerbs(null), []);
});

test('scanDocText flags stale invocations and credits real verbs', () => {
  const verbs = new Set(['init', 'doctor', 'capture create', 'capture show',
    'journal show', 'journal recover', 'pipeline']);
  const doc = [
    'node ./bin/scopegrain.mjs init --project "C:\\x"',
    'node ./bin/scopegrain.mjs capture list --project "C:\\x"',
    '```text',
    'scopegrain journal show OPERATION --project PATH',
    '```',
    'See `capture create` and `journal idle` for details.',
    'bin/scopegrain.mjs        Binary entry point; delegates to src/cli.mjs',
    '`scopegrain doctor --project PATH` is also an invocation.',
    'node ./bin/scopegrain.mjs pipeline --project "C:\\x" --mode plan',
  ].join('\n');
  const { referenced, stale } = scanDocText(doc, verbs);
  assert.ok(stale.has('capture list'));
  assert.equal(stale.size, 1); // 'journal idle' and file refs are not claims
  for (const v of ['init', 'capture create', 'journal show', 'doctor',
    'pipeline']) {
    assert.ok(referenced.has(v), `expected referenced ${v}`);
  }
  assert.ok(!referenced.has('journal idle'));
});

test('scanDocText ignores placeholders and flag-only invocations', () => {
  const verbs = new Set(['task list']);
  const { stale } = scanDocText([
    'scopegrain --help',
    'scopegrain TASK LIST',
    'scopegrain <verb> --project PATH',
  ].join('\n'), verbs);
  assert.equal(stale.size, 0);
});

test('doctor skips the drift check when a project has no docs', () => {
  const { dir, ctx } = bootstrapped();
  try {
    const report = runDoctor(ctx);
    const check = driftCheck(report);
    assert.equal(check.ok, true);
    assert.ok(check.detail.startsWith('skipped:'));
    assert.equal(report.status, 'ready');
  } finally { cleanup(dir); }
});

test('doctor reports documented-but-nonexistent verbs as warning-level', () => {
  const { dir, ctx } = bootstrapped();
  try {
    writeFile(dir, 'README.md', [
      '# fixture',
      'node ./bin/scopegrain.mjs capture list --project "C:\\x"',
      'node ./bin/scopegrain.mjs capture get 6666 --project "C:\\x"',
      'node ./bin/scopegrain.mjs init --project "C:\\x"',
    ].join('\n'));
    const report = runDoctor(ctx);
    const check = driftCheck(report);
    assert.equal(check.ok, false);
    assert.equal(check.severity, 'warning');
    assert.deepEqual(check.stale, ['capture get', 'capture list']);
    assert.ok(check.undocumented.length > 0);
    // Warning-level: attention without a failure count.
    assert.equal(report.status, 'needs-attention');
    assert.equal(report.summary.failures, 0);
    assert.ok(report.summary.warnings >= 1);
    assert.ok(report.warnings.some((w) => w.startsWith('docs-cli-drift')));
  } finally { cleanup(dir); }
});

test('doctor skips the drift check when the CLI source is unavailable', () => {
  const { dir, ctx } = bootstrapped();
  const fakeRoot = makeTempDir('drift-noroot');
  try {
    writeFile(dir, 'README.md',
      'node ./bin/scopegrain.mjs capture list --project "C:\\x"\n');
    const report = runDoctor(ctx, { installRoot: fakeRoot });
    assert.equal(driftCheck(report).ok, true);
    assert.ok(driftCheck(report).detail.startsWith('skipped:'));
  } finally { cleanup(dir); cleanup(fakeRoot); }
});

test('summary partitions checks into ok/warnings/failures', () => {
  const { dir, ctx } = bootstrapped();
  try {
    const ready = runDoctor(ctx);
    assert.equal(ready.summary.warnings, 0);
    assert.equal(ready.summary.failures, 0);
    assert.equal(ready.summary.ok,
      ready.checks.filter((c) => c.ok).length);
    writeFile(dir, '.scopegrain/discovery.json', '{corrupt');
    const bad = runDoctor(ctx);
    assert.equal(bad.status, 'needs-attention');
    assert.equal(bad.summary.failures,
      bad.checks.filter((c) => !c.ok && c.severity !== 'warning').length);
    assert.ok(bad.summary.failures >= 1);
    assert.equal(bad.summary.ok + bad.summary.failures
      + bad.checks.filter((c) => !c.ok && c.severity === 'warning').length,
    bad.checks.length);
  } finally { cleanup(dir); }
});
