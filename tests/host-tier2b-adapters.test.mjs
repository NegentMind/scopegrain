// SPDX-License-Identifier: Apache-2.0
// Tier-2b host adapters (cline, roo, kilo, gemini-cli, windsurf):
// declarative policy projection, rules/entrypoint bridges, the toml
// command dialect, optional agentRoot, MCP fragment shapes and merge
// targets (project-level vs global-only), activation apply semantics.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  prepareActivation, applyActivation,
} from '../src/hosts/activation.mjs';
import { hostManifest } from '../src/hosts/host-manifest.mjs';
import { hostParity } from '../src/hosts/parity.mjs';
import {
  loadNativePolicy, renderNativeAdapters,
} from '../src/hosts/native.mjs';
import { renderAdapters } from '../src/hosts/render.mjs';
import {
  AGENTS_MD_HOSTS, KNOWN_HOSTS, createConfig,
} from '../src/core/config.mjs';
import { hasManagedSection } from '../src/core/managed-section.mjs';
import { prepareInit } from '../src/core/bootstrap.mjs';
import {
  DEFAULT_ANSWERS, bootstrappedCtx, cleanup, exists, makeTempDir,
} from './helpers.mjs';

const CFG = '.scopegrain/config.json';
const T2B = ['cline', 'roo', 'kilo', 'gemini-cli', 'windsurf'];
const AGENTLESS = ['cline', 'roo', 'gemini-cli', 'windsurf'];

function cfg(hosts) {
  return createConfig(makeTempDir('t2b'), { ...DEFAULT_ANSWERS, hosts }, {});
}

function fixture(hosts) {
  const dir = makeTempDir('t2bact');
  const config = createConfig(dir, { ...DEFAULT_ANSWERS, hosts }, {});
  return { dir, ctx: { projectRoot: dir, configPath: CFG, config } };
}

// Mirrors the structural TOML check in host-activation.test.mjs.
function assertToml(text, rel) {
  const lines = text.split('\n')
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  assert.ok(lines.length > 0, rel);
  for (const l of lines) {
    const m = l.match(/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.+)$/);
    if (m) {
      if (m[1].trim().startsWith('"')) JSON.parse(m[1].trim());
    } else {
      assert.ok(/^\[[^\]]+\]$/.test(l.trim()), `bad TOML line in ${rel}: ${l}`);
    }
  }
}

test('tier-2b hosts are admitted; AGENTS.md hosts exclude gemini-cli', () => {
  for (const h of T2B) assert.ok(KNOWN_HOSTS.includes(h), h);
  for (const h of ['cline', 'roo', 'kilo', 'windsurf']) {
    assert.ok(AGENTS_MD_HOSTS.has(h), `${h} reads AGENTS.md`);
  }
  assert.ok(!AGENTS_MD_HOSTS.has('gemini-cli'),
    'gemini-cli defaults to GEMINI.md; AGENTS.md is opt-in only');
  assert.deepEqual(cfg(T2B).hosts, T2B);
});

test('cline: skills/commands-as-skills, rules bridge, no agents', () => {
  const { files, activationPlan } = renderNativeAdapters(
    cfg(['cline']), { configRel: CFG });
  assert.ok(files.every((f) =>
    f.rel.startsWith('.scopegrain/integrations/native/cline/')));
  const skill = files.find((f) =>
    f.rel.includes('/cline/.cline/skills/scopegrain-plan-work/SKILL.md'));
  assert.ok(skill, 'command projected as SKILL.md under .cline/skills');
  assert.ok(skill.content.toString('utf8').startsWith('---\n'));
  assert.ok(!files.some((f) => f.rel.includes('/agents/')),
    'cline agents are .yaml — never fabricated as markdown');
  const rule = files.find((f) =>
    f.rel.endsWith('/cline/.cline/rules/scopegrain.md'));
  assert.ok(rule, 'managed rule bridge under .cline/rules');
  const rtext = rule.content.toString('utf8');
  assert.ok(hasManagedSection(rtext));
  assert.ok(!rtext.startsWith('---'),
    'cline rule files are plain markdown — no frontmatter');
  assert.ok(rtext.includes('`.scopegrain/instructions.md`'));
  const eRule = activationPlan.entries.find(
    (e) => e.destination === '.cline/rules/scopegrain.md');
  assert.equal(eRule.kind, 'rules');
  assert.equal(eRule.activationMode, 'apply');
  const mcp = activationPlan.entries.find(
    (e) => e.host === 'cline' && e.kind === 'mcp-global');
  assert.equal(mcp.destination,
    '~/.cline/data/settings/cline_mcp_settings.json');
  assert.equal(mcp.activationMode, 'merge');
  assert.equal(mcp.machineLocal, undefined,
    'global destinations cannot be versioned — no gitignore noise');
  assert.ok(mcp.source.endsWith('/integrations/cline-mcp.json'));
});

test('roo: .roo skills/commands/rules, no agents, project mcp merge', () => {
  const { files, activationPlan } = renderNativeAdapters(
    cfg(['roo']), { configRel: CFG });
  const skill = files.find((f) =>
    f.rel.includes('/roo/.roo/skills/scopegrain-test-driven-development/SKILL.md'));
  assert.ok(skill, 'skill bridge under .roo/skills');
  const cmd = files.find((f) =>
    f.rel.includes('/roo/.roo/commands/scopegrain-plan-work.md'));
  assert.ok(cmd, 'markdown command bridge under .roo/commands');
  assert.ok(cmd.content.toString('utf8').startsWith('---\ndescription:'));
  assert.ok(!files.some((f) => f.rel.includes('/agents/')),
    'roo has no documented markdown agent root');
  const rule = files.find((f) =>
    f.rel.endsWith('/roo/.roo/rules/scopegrain.md'));
  assert.ok(rule, 'managed rule bridge under .roo/rules');
  assert.ok(hasManagedSection(rule.content.toString('utf8')));
  const mcp = activationPlan.entries.find(
    (e) => e.host === 'roo' && e.kind === 'mcp');
  assert.equal(mcp.destination, '.roo/mcp.json');
  assert.equal(mcp.machineLocal, true);
  assert.ok(mcp.source.endsWith('/integrations/roo-mcp.json'));
});

test('kilo: .kilo skills/commands/agents, legacy rules dir, mcp key', () => {
  const { files, activationPlan } = renderNativeAdapters(
    cfg(['kilo']), { configRel: CFG });
  const skill = files.find((f) =>
    f.rel.includes(
      '/kilo/.kilo/skills/scopegrain-test-driven-development/SKILL.md'));
  assert.ok(skill, 'skill bridge under .kilo/skills');
  const cmd = files.find((f) =>
    f.rel.includes('/kilo/.kilo/commands/scopegrain-plan-work.md'));
  assert.ok(cmd, 'markdown slash command under .kilo/commands');
  const agent = files.find((f) =>
    f.rel.includes('/kilo/.kilo/agents/scopegrain-reviewer.md'));
  assert.ok(agent, 'agent profile under .kilo/agents');
  assert.ok(agent.content.toString('utf8').split(/^---$/m)[1]
    .includes('scopegrain-reviewer'));
  const rule = files.find((f) =>
    f.rel.endsWith('/kilo/.kilocode/rules/scopegrain.md'));
  assert.ok(rule, 'backward-compat auto-loaded rules dir per kilo docs');
  assert.ok(hasManagedSection(rule.content.toString('utf8')));
  const mcp = activationPlan.entries.find(
    (e) => e.host === 'kilo' && e.kind === 'mcp');
  assert.equal(mcp.destination, 'kilo.jsonc');
  assert.equal(mcp.machineLocal, true);
  assert.match(mcp.note, /\.kilo\/kilo\.jsonc/,
    'the .kilo/kilo.jsonc precedence alternative is disclosed');
});

test('gemini-cli: toml commands, GEMINI.md entrypoint, no agents', () => {
  const { files, activationPlan } = renderNativeAdapters(
    cfg(['gemini-cli']), { configRel: CFG });
  const skill = files.find((f) =>
    f.rel.includes('/gemini-cli/.gemini/skills/'
      + 'scopegrain-test-driven-development/SKILL.md'));
  assert.ok(skill, 'skill bridge under .gemini/skills');
  const cmd = files.find((f) =>
    f.rel.includes('/gemini-cli/.gemini/commands/scopegrain-plan-work.toml'));
  assert.ok(cmd, 'toml custom command under .gemini/commands');
  const ctext = cmd.content.toString('utf8');
  assert.ok(ctext.startsWith('# generated-by: scopegrain v'));
  assert.ok(ctext.includes('# source: "command/plan-work"'));
  assertToml(ctext, cmd.rel);
  assert.ok(ctext.includes('description = "'));
  assert.ok(ctext.includes('prompt = "'));
  assert.ok(!files.some((f) => f.rel.includes('/agents/')),
    'gemini-cli has no documented markdown agent root');
  const entry = files.find((f) =>
    f.rel.endsWith('/gemini-cli/GEMINI.md'));
  assert.ok(entry, 'GEMINI.md managed entrypoint proposal');
  const etext = entry.content.toString('utf8');
  assert.ok(hasManagedSection(etext));
  assert.ok(!etext.startsWith('---'));
  const eEntry = activationPlan.entries.find(
    (e) => e.destination === 'GEMINI.md');
  assert.equal(eEntry.kind, 'instructions');
  assert.equal(eEntry.activationMode, 'apply');
  const mcp = activationPlan.entries.find(
    (e) => e.host === 'gemini-cli' && e.kind === 'mcp');
  assert.equal(mcp.destination, '.gemini/settings.json');
  assert.equal(mcp.machineLocal, true);
});

test('windsurf: .windsurf skills/workflows/rules, global mcp only', () => {
  const { files, activationPlan } = renderNativeAdapters(
    cfg(['windsurf']), { configRel: CFG });
  const skill = files.find((f) =>
    f.rel.includes('/windsurf/.windsurf/skills/'
      + 'scopegrain-test-driven-development/SKILL.md'));
  assert.ok(skill, 'skill bridge under legacy .windsurf/skills');
  const wf = files.find((f) =>
    f.rel.includes('/windsurf/.windsurf/workflows/scopegrain-plan-work.md'));
  assert.ok(wf, 'markdown workflow command under .windsurf/workflows');
  assert.ok(!files.some((f) => f.rel.includes('/agents/')),
    'no .windsurf/agents root is documented');
  const rule = files.find((f) =>
    f.rel.endsWith('/windsurf/.windsurf/rules/scopegrain.md'));
  assert.ok(rule, 'managed rule bridge under .windsurf/rules');
  const mcp = activationPlan.entries.find(
    (e) => e.host === 'windsurf' && e.kind === 'mcp-global');
  assert.equal(mcp.destination, '~/.codeium/windsurf/mcp_config.json');
});

test('fragments: mcpServers vs kilo mcp key, disabled/enabled flags', () => {
  const dir = makeTempDir('t2bfrag');
  try {
    const rendered = renderAdapters(cfg(T2B), {
      projectRoot: dir,
      configPath: path.join(dir, CFG),
      instructionsPath: path.join(dir, '.scopegrain/instructions.md'),
      serverPath: path.join(dir, 'server.mjs'),
    });
    const doc = (name) => JSON.parse(rendered.files.find(
      (f) => f.relativePath === `integrations/${name}-mcp.json`).content);
    const cline = doc('cline');
    assert.equal(cline.mcpServers.scopegrain.command, 'node');
    assert.equal(cline.mcpServers.scopegrain.disabled, true);
    const roo = doc('roo');
    assert.equal(roo.mcpServers.scopegrain.command, 'node');
    assert.equal(roo.mcpServers.scopegrain.disabled, true);
    const kilo = doc('kilo');
    assert.equal(kilo.mcp.scopegrain.type, 'local');
    assert.equal(kilo.mcp.scopegrain.enabled, false);
    assert.deepEqual(kilo.mcp.scopegrain.command,
      ['node', path.join(dir, 'server.mjs'),
        '--project', dir, '--config', CFG]);
    assert.ok(!('mcpServers' in kilo), 'kilo.jsonc uses the mcp key');
    const gem = doc('gemini-cli');
    assert.equal(gem.mcpServers.scopegrain.command, 'node');
    assert.ok(!('type' in gem.mcpServers.scopegrain)
        && !('disabled' in gem.mcpServers.scopegrain)
        && !('trust' in gem.mcpServers.scopegrain),
      'gemini stdio is implied by command; trust stays unset');
    const ws = doc('windsurf');
    assert.equal(ws.mcpServers.scopegrain.disabled, true);
    for (const f of [cline, roo, gem, ws]) {
      assert.deepEqual(f.mcpServers.scopegrain.args.slice(1),
        ['--project', dir, '--config', CFG]);
    }
  } finally { cleanup(dir); }
});

test('init reserves fragments; AGENTS.md for four, not gemini-cli', () => {
  for (const host of T2B) {
    const dir = makeTempDir('t2binit');
    try {
      const plan = prepareInit({ projectRoot: dir, configRel: CFG,
        answers: { ...DEFAULT_ANSWERS, hosts: [host] } });
      const rels = plan.files.map((f) => f.rel);
      assert.ok(rels.includes(`.scopegrain/integrations/${host}-mcp.json`),
        `${host} fragment`);
      if (host === 'gemini-cli') {
        assert.ok(!rels.includes('AGENTS.md'),
          'gemini-cli uses GEMINI.md, not AGENTS.md');
        assert.ok(rels.some((r) =>
          r === '.scopegrain/integrations/native/gemini-cli/GEMINI.md'));
      } else {
        assert.ok(rels.includes('AGENTS.md'),
          `${host} reads the AGENTS.md entrypoint`);
      }
      assert.ok(!rels.includes('CLAUDE.md'));
    } finally { cleanup(dir); }
  }
});

test('activation applies bridges; merges and globals stay skipped', () => {
  for (const host of T2B) {
    const { dir, ctx } = fixture([host]);
    try {
      const preview = prepareActivation(ctx, { host });
      assert.equal(preview.mode, 'dry-run');
      assert.ok(preview.files.every((f) =>
        !path.isAbsolute(f.rel) && !f.rel.startsWith('~')
        && !f.rel.includes('..')));
      if (host === 'cline' || host === 'windsurf') {
        assert.ok(preview.skipped.some((s) =>
          String(s.destination).startsWith('~')
          && /global host path/.test(s.reason)),
          `${host} global MCP file disclosed as manual-only`);
        assert.ok(preview.warnings.some((w) =>
          w.includes('global host paths')));
      } else {
        const dest = { roo: '.roo/mcp.json', kilo: 'kilo.jsonc',
          'gemini-cli': '.gemini/settings.json' }[host];
        assert.ok(preview.skipped.some((s) =>
          s.destination === dest && /manual merge/.test(s.reason)),
          `${host} merge target disclosed`);
      }
      const res = applyActivation(ctx, { host });
      assert.ok(res.applied > 0, `${host} applies bridge files`);
      const roots = {
        cline: '.cline/skills', roo: '.roo/skills', kilo: '.kilo/skills',
        'gemini-cli': '.gemini/skills', windsurf: '.windsurf/skills',
      };
      assert.ok(exists(dir, roots[host]), `${host} skill root applied`);
      if (host === 'gemini-cli') {
        assert.ok(exists(dir, 'GEMINI.md'));
      } else {
        assert.ok(!exists(dir, 'GEMINI.md'));
      }
      const sharedDest = {
        cline: null, windsurf: null, roo: '.roo/mcp.json',
        kilo: 'kilo.jsonc', 'gemini-cli': '.gemini/settings.json',
      };
      if (sharedDest[host]) assert.ok(!exists(dir, sharedDest[host]));
      assert.equal(applyActivation(ctx, { host }).applied, 0,
        're-apply is noop');
      const manifest = hostManifest(ctx, { host });
      assert.ok(manifest.shared.length > 0,
        `${host} discloses the never-applied MCP proposal`);
    } finally { cleanup(dir); }
  }
});

test('policy: agentFormat requires agentRoot; toml needs commandRoot', () => {
  // Validation mirrors the production loader against a patched install:
  // an agent surface is optional, but its format is not free-floating.
  const installRoot = makeTempDir('t2bpol');
  try {
    fs.cpSync('policy', path.join(installRoot, 'policy'),
      { recursive: true });
    fs.cpSync('templates', path.join(installRoot, 'templates'),
      { recursive: true });
    const file = path.join(installRoot, 'policy', 'native-adapters.json');
    const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
    policy.hosts.roo.agentFormat = 'markdown';
    fs.writeFileSync(file, JSON.stringify(policy, null, 2));
    assert.throws(() => loadNativePolicy({ installRoot }),
      (e) => e.code === 'POLICY_MALFORMED'
        && /agentFormat requires agentRoot/.test(e.message));
    policy.hosts.roo = {
      skillRoot: '.roo/skills', commandFormat: 'toml',
      commandFrontmatter: '', agentFrontmatter: '',
      readOnlyAgentFrontmatter: '', invocation: '/x',
      permissionScope: 's', sources: ['https://example.com/a'],
    };
    fs.writeFileSync(file, JSON.stringify(policy, null, 2));
    assert.throws(() => loadNativePolicy({ installRoot }),
      (e) => e.code === 'POLICY_MALFORMED'
        && /commandRoot required for toml/.test(e.message));
  } finally { cleanup(installRoot); }
});

test('host parity: agentless hosts classify agent absence structural', () => {
  const { dir, ctx } = bootstrappedCtx(
    { ...DEFAULT_ANSWERS, hosts: T2B });
  try {
    const r = hostParity(ctx, { hosts: T2B });
    assert.equal(r.ok, true, JSON.stringify(r.drift));
    assert.deepEqual(Object.keys(r.coverage).sort(), [...T2B].sort());
    for (const h of T2B) assert.ok(r.coverage[h].resources > 0, h);
    // kilo is the only tier-2b host emitting agents; every agent source
    // missing from the agentless four must be structural, never drift.
    const agentItems = [...r.drift, ...r.structural].filter((i) =>
      i.source.startsWith('agent/'));
    assert.ok(agentItems.length > 0);
    for (const item of agentItems) {
      assert.ok(r.structural.includes(item),
        `${item.source} is structural, not drift`);
      assert.ok(item.missingFrom.includes('cline'));
      assert.ok(!item.missingFrom.includes('kilo'));
    }
    // Rules/entrypoint bridges are per-host non-catalog extras: they must
    // never surface as drift on canonical sources.
    for (const kind of ['skill', 'command']) {
      assert.ok(!r.drift.some((d) => d.source.startsWith(`${kind}/`)),
        `${kind} must not drift`);
    }
  } finally { cleanup(dir); }
});
