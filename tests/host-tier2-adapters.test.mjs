// SPDX-License-Identifier: Apache-2.0
// Tier-2 host adapters (copilot, cursor): declarative policy projection,
// entrypoint/rules emission, MCP fragment shapes and merge targets,
// activation plan + apply semantics, host parity coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  prepareActivation, applyActivation,
} from '../src/hosts/activation.mjs';
import { hostManifest } from '../src/hosts/host-manifest.mjs';
import { hostParity } from '../src/hosts/parity.mjs';
import { renderNativeAdapters } from '../src/hosts/native.mjs';
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

function cfg(hosts) {
  return createConfig(makeTempDir('t2'), { ...DEFAULT_ANSWERS, hosts }, {});
}

function fixture(hosts) {
  const dir = makeTempDir('t2act');
  const config = createConfig(dir, { ...DEFAULT_ANSWERS, hosts }, {});
  return { dir, ctx: { projectRoot: dir, configPath: CFG, config } };
}

test('copilot and cursor are admitted KNOWN_HOSTS', () => {
  assert.ok(KNOWN_HOSTS.includes('copilot'));
  assert.ok(KNOWN_HOSTS.includes('cursor'));
  assert.ok(AGENTS_MD_HOSTS.has('cursor'));
  assert.ok(!AGENTS_MD_HOSTS.has('copilot'));
  assert.deepEqual(cfg(['copilot', 'cursor']).hosts, ['copilot', 'cursor']);
});

test('copilot projects .agents skills, .github agents and managed entrypoint', () => {
  const { files, activationPlan } = renderNativeAdapters(
    cfg(['copilot']), { configRel: CFG });
  assert.ok(files.every((f) =>
    f.rel.startsWith('.scopegrain/integrations/native/copilot/')));
  const skill = files.find((f) =>
    f.rel.includes('/copilot/.agents/skills/scopegrain-plan-work/SKILL.md'));
  assert.ok(skill, 'skill bridge under the shared .agents shadow');
  assert.ok(skill.content.toString('utf8').startsWith('---\n'));
  const agent = files.find((f) =>
    f.rel.includes('/copilot/.github/agents/scopegrain-reviewer.md'));
  assert.ok(agent, 'custom agent profile under .github/agents');
  assert.ok(agent.content.toString('utf8').split(/^---$/m)[1]
    .includes('scopegrain-reviewer'));
  const entry = files.find((f) =>
    f.rel.endsWith('/copilot/.github/copilot-instructions.md'));
  assert.ok(entry, 'copilot-instructions.md entrypoint proposal');
  const text = entry.content.toString('utf8');
  assert.ok(hasManagedSection(text));
  assert.ok(text.includes('`.scopegrain/instructions.md`'));
  assert.ok(!text.startsWith('---'),
    'copilot-instructions.md is plain markdown, not frontmatter');
  const eEntry = activationPlan.entries.find(
    (e) => e.destination === '.github/copilot-instructions.md');
  assert.equal(eEntry.kind, 'instructions');
  assert.equal(eEntry.activationMode, 'apply');
  const mcp = activationPlan.entries.find(
    (e) => e.host === 'copilot' && e.kind === 'mcp');
  assert.equal(mcp.destination, '.vscode/mcp.json');
  assert.equal(mcp.machineLocal, true);
  assert.ok(mcp.source.endsWith('/integrations/copilot-mcp.json'));
  assert.match(mcp.note, /servers\.scopegrain/);
});

test('cursor projects .cursor bridges plus the alwaysApply rule', () => {
  const { files, activationPlan } = renderNativeAdapters(
    cfg(['cursor']), { configRel: CFG });
  const skill = files.find((f) =>
    f.rel.includes('/cursor/.cursor/skills/scopegrain-plan-work/SKILL.md'));
  assert.ok(skill);
  const roAgent = files.find((f) =>
    f.rel.includes('/cursor/.cursor/agents/scopegrain-reviewer.md'));
  assert.ok(roAgent);
  assert.ok(roAgent.content.toString('utf8').split(/^---$/m)[1]
    .includes('readonly: true'));
  const lead = files.find((f) =>
    f.rel.includes('/cursor/.cursor/agents/scopegrain-lead.md'));
  assert.ok(!lead.content.toString('utf8').split(/^---$/m)[1]
    .includes('readonly: true'));
  const rule = files.find((f) =>
    f.rel.endsWith('/cursor/.cursor/rules/scopegrain.mdc'));
  assert.ok(rule, 'alwaysApply project rule bridge');
  const rtext = rule.content.toString('utf8');
  const header = rtext.split(/^---$/m)[1];
  assert.ok(header.includes('alwaysApply: true'));
  assert.ok(header.includes('description:'));
  assert.ok(rtext.includes('`.scopegrain/instructions.md`'));
  const eRule = activationPlan.entries.find(
    (e) => e.destination === '.cursor/rules/scopegrain.mdc');
  assert.equal(eRule.activationMode, 'apply');
  const mcp = activationPlan.entries.find(
    (e) => e.host === 'cursor' && e.kind === 'mcp');
  assert.equal(mcp.destination, '.cursor/mcp.json');
  assert.equal(mcp.machineLocal, true);
  assert.ok(mcp.source.endsWith('/integrations/cursor-mcp.json'));
});

test('fragments: copilot uses servers, cursor uses mcpServers', () => {
  const dir = makeTempDir('t2frag');
  try {
    const rendered = renderAdapters(cfg(['copilot', 'cursor']), {
      projectRoot: dir,
      configPath: path.join(dir, CFG),
      instructionsPath: path.join(dir, '.scopegrain/instructions.md'),
      serverPath: path.join(dir, 'server.mjs'),
    });
    const copilot = rendered.files.find(
      (f) => f.relativePath === 'integrations/copilot-mcp.json');
    assert.ok(copilot);
    const cdoc = JSON.parse(copilot.content);
    assert.equal(cdoc.servers.scopegrain.type, 'stdio');
    assert.equal(cdoc.servers.scopegrain.command, 'node');
    assert.ok(!('mcpServers' in cdoc),
      '.vscode/mcp.json uses the servers key, not mcpServers');
    const cursor = rendered.files.find(
      (f) => f.relativePath === 'integrations/cursor-mcp.json');
    const cudoc = JSON.parse(cursor.content);
    assert.equal(cudoc.mcpServers.scopegrain.type, 'stdio');
    assert.equal(cudoc.mcpServers.scopegrain.command, 'node');
    assert.ok(!('servers' in cudoc),
      '.cursor/mcp.json uses the mcpServers key');
    for (const f of [cdoc.servers.scopegrain, cudoc.mcpServers.scopegrain]) {
      assert.deepEqual(f.args.slice(1),
        ['--project', dir, '--config', CFG]);
    }
  } finally { cleanup(dir); }
});

test('init reserves the new fragment files; cursor gets AGENTS.md', () => {
  for (const host of ['copilot', 'cursor']) {
    const dir = makeTempDir('t2init');
    try {
      const plan = prepareInit({ projectRoot: dir, configRel: CFG,
        answers: { ...DEFAULT_ANSWERS, hosts: [host] } });
      const rels = plan.files.map((f) => f.rel);
      assert.ok(rels.includes(`.scopegrain/integrations/${host}-mcp.json`));
      if (host === 'cursor') {
        assert.ok(rels.includes('AGENTS.md'),
          'cursor reads the AGENTS.md entrypoint');
      } else {
        assert.ok(!rels.includes('AGENTS.md'),
          'copilot entrypoint lives under .github/, not AGENTS.md');
      }
      assert.ok(!rels.includes('CLAUDE.md'));
      assert.ok(rels.some((r) =>
        r === '.scopegrain/integrations/native/'
          + `${host}/${host === 'copilot'
            ? '.github/copilot-instructions.md'
            : '.cursor/rules/scopegrain.mdc'}`));
    } finally { cleanup(dir); }
  }
});

test('activation applies copilot bridges and discloses the MCP merge', () => {
  const { dir, ctx } = fixture(['copilot']);
  try {
    const preview = prepareActivation(ctx, { host: 'copilot' });
    assert.ok(preview.files.some((f) =>
      f.rel === '.github/copilot-instructions.md'
        && f.kind === 'instructions' && f.action === 'create'));
    assert.ok(preview.files.some((f) =>
      f.rel.startsWith('.agents/skills/')));
    assert.ok(preview.files.some((f) =>
      f.rel.startsWith('.github/agents/')));
    assert.ok(preview.warnings.some((w) => w.includes('.agents')),
      'shared .agents convention is disclosed');
    assert.ok(preview.skipped.some((s) =>
      s.destination === '.vscode/mcp.json'
        && /manual merge/.test(s.reason)));
    const res = applyActivation(ctx, { host: 'copilot' });
    assert.ok(res.applied > 0);
    assert.ok(exists(dir, '.github/copilot-instructions.md'));
    assert.ok(exists(dir, '.agents/skills'));
    assert.ok(exists(dir, '.github/agents/scopegrain-reviewer.md'));
    assert.ok(!exists(dir, '.vscode/mcp.json'));
    assert.equal(applyActivation(ctx, { host: 'copilot' }).applied, 0);
    const manifest = hostManifest(ctx, { host: 'copilot' });
    const own = manifest.generated.find(
      (g) => g.rel === '.github/copilot-instructions.md');
    assert.equal(own.ownership, 'partial');
    assert.ok(manifest.shared.some((s) =>
      s.destination === '.vscode/mcp.json'));
  } finally { cleanup(dir); }
});

test('activation applies cursor bridges and discloses the MCP merge', () => {
  const { dir, ctx } = fixture(['cursor']);
  try {
    const preview = prepareActivation(ctx, { host: 'cursor' });
    assert.ok(preview.files.some((f) =>
      f.rel === '.cursor/rules/scopegrain.mdc' && f.action === 'create'));
    assert.ok(preview.skipped.some((s) =>
      s.destination === '.cursor/mcp.json'
        && /manual merge/.test(s.reason)));
    const res = applyActivation(ctx, { host: 'cursor' });
    assert.ok(res.applied > 0);
    assert.ok(exists(dir, '.cursor/skills'));
    assert.ok(exists(dir, '.cursor/agents/scopegrain-reviewer.md'));
    assert.ok(exists(dir, '.cursor/rules/scopegrain.mdc'));
    assert.ok(!exists(dir, '.cursor/mcp.json'));
    const rule = fs.readFileSync(
      path.join(dir, '.cursor', 'rules', 'scopegrain.mdc'), 'utf8');
    assert.ok(rule.split(/^---$/m)[1].includes('alwaysApply: true'));
    assert.equal(applyActivation(ctx, { host: 'cursor' }).applied, 0);
  } finally { cleanup(dir); }
});

test('host parity covers copilot and cursor without drift', () => {
  const { dir, ctx } = bootstrappedCtx(
    { ...DEFAULT_ANSWERS, hosts: ['copilot', 'cursor'] });
  try {
    const r = hostParity(ctx, { hosts: ['copilot', 'cursor'] });
    assert.equal(r.ok, true, JSON.stringify(r.drift));
    assert.deepEqual(Object.keys(r.coverage).sort(),
      ['copilot', 'cursor']);
    assert.ok(r.coverage.copilot.resources > 0);
    assert.ok(r.coverage.cursor.resources > 0);
    // The cursor rules bridge is the only extra source: it must classify
    // structural (no other host emits that kind), never unexpected drift.
    const rule = r.structural.find((s) => s.source === 'rules/scopegrain');
    assert.ok(rule, 'rules bridge absence is structural elsewhere');
    assert.deepEqual(rule.missingFrom, ['copilot']);
    // Both hosts read the full catalog kind set otherwise.
    for (const kind of ['skill', 'command', 'agent']) {
      assert.ok(!r.drift.some((d) => d.source.startsWith(`${kind}/`)),
        `${kind} must not drift`);
    }
  } finally { cleanup(dir); }
});
