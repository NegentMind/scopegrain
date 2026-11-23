// SPDX-License-Identifier: Apache-2.0
// Native adapter proposals: projection shape, no host writes, policy-exact
// frontmatter, codex TOML, V2 opencode fragment, activation plan.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderNativeAdapters, loadNativePolicy } from '../src/adapters/native.mjs';
import { createConfig } from '../src/core/config.mjs';
import { loadCatalog } from '../src/core/catalog.mjs';
import { applyPlan, prepareInit } from '../src/core/bootstrap.mjs';
import {
  DEFAULT_ANSWERS, VALID_ANSWERS, cleanup, exists, makeTempDir, writeJson,
} from './helpers.mjs';
import {
  destroyLifecycleInstall, lifecycleInstallRoot,
} from './helpers/lifecycle-fixture.mjs';

const CFG_REL = '.scopegrain/config.json';

after(() => destroyLifecycleInstall());

function cfg(hosts = ['claude', 'codex', 'opencode', 'devin']) {
  return createConfig(makeTempDir('x'), { ...DEFAULT_ANSWERS, hosts }, {});
}

test('selected hosts project native files; absent hosts generate none', () => {
  const all = renderNativeAdapters(cfg(),
    { configRel: CFG_REL, projectRoot: makeTempDir('x') });
  const claudeOnly = renderNativeAdapters(
    cfg(['claude']), { configRel: CFG_REL });
  assert.ok(claudeOnly.files.every((f) =>
    f.rel.startsWith('.scopegrain/integrations/native/claude/')));
  assert.ok(!claudeOnly.files.some((f) => f.rel.includes('/codex/')));
  // Every catalog skill+command+agent produces a bridge for each host.
  const claudeSkills = all.files.filter((f) =>
    f.rel.includes('/claude/.claude/skills/'));
  assert.ok(claudeSkills.length >= 24 + 13, 'skills + command-as-skill');
  for (const f of all.files) {
    assert.ok(f.rel.startsWith('.scopegrain/integrations/native/'));
    assert.ok(!f.content.includes('{{'), `unexpanded var in ${f.rel}`);
    assert.ok(!f.content.toString('utf8').includes('!`'));
  }
});

test('frontmatter: permission lines land INSIDE the YAML fence', () => {
  const { files } = renderNativeAdapters(cfg(),
    { configRel: CFG_REL, projectRoot: makeTempDir('x') });
  const pipeline = files.find((f) =>
    f.rel.endsWith('/claude/.claude/skills/scopegrain-pipeline/SKILL.md'));
  const text = pipeline.content.toString('utf8');
  const header = text.split(/^---$/m)[1];
  assert.ok(header.includes('disable-model-invocation: true'),
    'command frontmatter must be inside the header');
  const body = text.split(/^---$/m)[2];
  assert.ok(!body.includes('disable-model-invocation: true'),
    'must not leak into body');
  const reviewer = files.find((f) =>
    f.rel.endsWith('/claude/.claude/agents/scopegrain-reviewer.md'));
  const rh = reviewer.content.toString('utf8').split(/^---$/m)[1];
  assert.ok(rh.includes('- Read'), 'readonly tools inside header');
  // Scalars are JSON-quoted so colons/newlines cannot break the fence.
  assert.ok(header.includes('name: "scopegrain-pipeline"'));
  const rtext = reviewer.content.toString('utf8');
  const rhdr = rtext.split(/^---$/m)[1];
  assert.ok(rhdr.includes('tools:\n  - Read\n  - Grep\n  - Glob'));
  const lead = files.find((f) =>
    f.rel.endsWith('/claude/.claude/agents/scopegrain-lead.md'));
  assert.ok(!lead.content.toString('utf8').split(/^---$/m)[1]
    .includes('tools:\n  - Read'));
  // Devin trigger frontmatter lands inside the fence too.
  const devinCmd = files.find((f) =>
    f.rel.endsWith('/devin/.devin/skills/scopegrain-ship/SKILL.md'));
  const dh = devinCmd.content.toString('utf8').split(/^---$/m)[1];
  assert.ok(dh.includes('triggers:\n  - user'));
  // OpenCode commands land in command root, not skill root.
  // OpenCode emits the V2 variant with its permission frontmatter.
  const ocCmd = files.find((f) =>
    f.rel.endsWith('/opencode/v2/.opencode/commands/scopegrain-assess-release.md'));
  assert.ok(ocCmd);
  assert.ok(ocCmd.content.toString('utf8').startsWith('---\ndescription:'));
  const ocAgentV2 = files.find((f) =>
    f.rel.endsWith('/opencode/v2/.opencode/agents/scopegrain-reviewer.md'));
  assert.ok(ocAgentV2);
  assert.ok(!files.some((f) => f.rel.includes('/opencode/v1/')));
  assert.ok(ocAgentV2.content.toString('utf8')
    .split(/^---$/m)[1].includes('effect: deny'));
});

test('skill/command bridges prefer the canonical file description', () => {
  const { files } = renderNativeAdapters(
    cfg(['devin']), { configRel: CFG_REL, projectRoot: makeTempDir('x') });
  const catalog = loadCatalog();
  const canonicalOf = (rel) => fs.readFileSync(rel, 'utf8')
    .match(/^description:[ \t]*(.+)$/m)[1].trim();
  // Precondition: the manifest text and the canonical file text actually
  // differ for these entries, otherwise the assertions prove nothing.
  const skillDesc = canonicalOf(
    'resources/skills/test-driven-development/SKILL.md');
  assert.notEqual(skillDesc, catalog.entries.find(
    (e) => e.kind === 'skill' && e.id === 'test-driven-development')
    .description);
  const skill = files.find((f) => f.rel.endsWith(
    '/devin/.devin/skills/scopegrain-test-driven-development/SKILL.md'));
  assert.ok(skill.content.toString('utf8')
    .includes(`description: ${JSON.stringify(skillDesc)}`));
  const cmdDesc = canonicalOf('resources/commands/plan-work.md');
  assert.notEqual(cmdDesc, catalog.entries.find(
    (e) => e.kind === 'command' && e.id === 'plan-work').description);
  const cmd = files.find((f) => f.rel.endsWith(
    '/devin/.devin/skills/scopegrain-plan-work/SKILL.md'));
  assert.ok(cmd.content.toString('utf8')
    .includes(`description: ${JSON.stringify(cmdDesc)}`));
  // Kinds without a frontmatter contract keep the manifest text.
  const agentEntry = catalog.entries.find(
    (e) => e.kind === 'agent' && e.id === 'reviewer');
  const agent = files.find((f) => f.rel.endsWith(
    '/devin/.devin/agents/scopegrain-reviewer.md'));
  assert.ok(agent.content.toString('utf8')
    .includes(`description: ${JSON.stringify(agentEntry.description)}`));
});

test('a resource without frontmatter falls back to the manifest text', () => {
  const installRoot = lifecycleInstallRoot(); // fixture files carry none
  const { files } = renderNativeAdapters(
    cfg(['claude']), { configRel: CFG_REL, installRoot });
  const skill = files.find((f) => f.rel.includes('scopegrain-mini-skill'));
  assert.ok(skill.content.toString('utf8')
    .includes('description: "Mini skill (lifecycle fixture)"'));
  const cmd = files.find((f) =>
    f.rel.includes('/skills/scopegrain-plan-work/'));
  assert.ok(cmd.content.toString('utf8')
    .includes('description: "Plan work (lifecycle fixture)"'));
});

test('codex TOML roles use JSON-quoted strings + declaration fragments', () => {
  const { files } = renderNativeAdapters(cfg(),
    { configRel: CFG_REL, projectRoot: makeTempDir('x') });
  const role = files.find((f) =>
    f.rel.endsWith('/codex/.codex/agents/scopegrain-reviewer.toml'));
  assert.ok(role);
  const text = role.content.toString('utf8');
  // Provenance stamp leads the file; `name` is the first declared key.
  assert.ok(text.startsWith('# generated-by: scopegrain v'));
  assert.ok(text.includes('name = "scopegrain-reviewer"'));
  assert.ok(text.includes('description = "'));
  assert.ok(text.includes('developer_instructions = "'));
  assert.ok(text.includes('sandbox_mode = "read-only"'));
  // ONE fragment outside .codex/agents with all 11 declarations.
  const frag = files.find((f) =>
    f.rel.endsWith('/codex/agents-fragment.toml'));
  assert.ok(frag);
  const ftext = frag.content.toString('utf8');
  assert.ok(ftext.includes('[agents."scopegrain-reviewer"]'));
  assert.ok(ftext.includes('config_file = "agents/scopegrain-reviewer.toml"'));
  const nAgents = files.filter((f) =>
    f.rel.includes('/codex/.codex/agents/')).length;
  assert.equal((ftext.match(/\[agents\./g) || []).length, nAgents);
  assert.ok(!files.some((f) => f.rel.includes('.decl.toml')));
  assert.ok(!files.some((f) =>
    f.rel.includes('/codex/.codex/agents/')
      && f.rel.includes('fragment')));
});

test('activation metadata: codex fragment targets .codex/config.toml', () => {
  const { activationPlan } = renderNativeAdapters(cfg(),
    { configRel: CFG_REL, projectRoot: makeTempDir('x') });
  const decl = activationPlan.entries.find(
    (e) => e.kind === 'agent-declaration');
  assert.equal(decl.destination, '.codex/config.toml');
  assert.equal(decl.manualMerge, true);
  assert.ok(decl.source.endsWith('agents-fragment.toml'));
});

test('devin emits the v3000.3 mcp_config file plus the legacy merge fragment', () => {
  const projectRoot = makeTempDir('x');
  const { files, activationPlan } = renderNativeAdapters(
    cfg(['devin']), { configRel: CFG_REL, projectRoot });
  // Dedicated whole file: create-only applyable, real absolute paths.
  const mcp = files.find((f) =>
    f.rel.endsWith('/devin/.devin/mcp_config.json'));
  assert.ok(mcp, 'dedicated .devin/mcp_config.json proposal must exist');
  const mcpJson = JSON.parse(mcp.content.toString('utf8'));
  const srv = mcpJson.mcpServers.scopegrain;
  assert.equal(srv.command, 'node');
  assert.ok(srv.args[0].endsWith('server.mjs'));
  assert.ok(!('disabled' in srv), 'certified file carries no disabled flag');
  assert.deepEqual(srv.args.slice(1),
    ['--project', projectRoot, '--config', CFG_REL]);
  // Legacy fragment: same mcpServers block, manual merge only.
  const legacy = files.find((f) =>
    f.rel.endsWith('/devin/.devin/config.json'));
  assert.ok(legacy, 'legacy .devin/config.json fragment must exist');
  assert.deepEqual(JSON.parse(legacy.content.toString('utf8')), mcpJson);
  const applyable = activationPlan.entries.find(
    (e) => e.destination === '.devin/mcp_config.json');
  assert.equal(applyable.kind, 'mcp-config');
  assert.equal(applyable.machineLocal, true);
  assert.match(applyable.note, /regenerate per machine/);
  const merge = activationPlan.entries.find(
    (e) => e.destination === '.devin/config.json');
  assert.equal(merge.kind, 'mcp');
  assert.equal(merge.manualMerge, true);
  // Real paths are mandatory for devin — never placeholders.
  assert.throws(() => renderNativeAdapters(
    cfg(['devin']), { configRel: CFG_REL }),
    (e) => e.code === 'INVALID_ADAPTER_INPUT');
  assert.throws(() => renderNativeAdapters(
    cfg(['devin']), { configRel: CFG_REL, projectRoot,
      serverPath: 'rel/server.mjs' }),
    (e) => e.code === 'INVALID_ADAPTER_INPUT');
  cleanup(projectRoot);
});

test('activation plan is metadata only: manual merge, no hooks/apply', () => {
  const { files, activationPlan } = renderNativeAdapters(
    cfg(), { configRel: CFG_REL, projectRoot: makeTempDir('x') });
  assert.equal(activationPlan.activation, 'manual-review-only');
  assert.equal(activationPlan.hooksInstalled, false);
  assert.equal(activationPlan.nativeHostTested, false);
  assert.equal(activationPlan.writeHostRoots, false);
  // Every projected file carries exactly one manual-merge entry. Entries
  // whose source is the bootstrap-emitted MCP fragment (opencode) are
  // extra, so the mapping is asserted per projected file instead of by
  // count.
  const bySource = new Map(activationPlan.entries.map((e) => [e.source, e]));
  assert.equal(bySource.size, activationPlan.entries.length,
    'entry sources are unique');
  for (const f of files) {
    const e = bySource.get(f.rel);
    assert.ok(e, `projected file ${f.rel} needs an activation entry`);
    assert.equal(e.manualMerge, true);
  }
  for (const h of ['claude', 'codex', 'opencode', 'devin']) {
    assert.ok(Array.isArray(activationPlan.hosts[h].sources));
    assert.equal(typeof activationPlan.hosts[h].permissionScope, 'string');
  }
});

test('opencode MCP fragment is a declared manual-merge target', () => {
  // OpenCode pilot D1: the fragment is emitted by render.mjs, so it has no
  // whole-file destination. Its merge target must still be declared, or the
  // manual review stays invisible: `host manifest` would report shared: 0,
  // `host activate` would not disclose it in `skipped`, and the absolute
  // machine-local paths embedded in the fragment would never reach the
  // gitignore proposal.
  const { files, activationPlan } = renderNativeAdapters(
    cfg(['opencode']), { configRel: CFG_REL, projectRoot: makeTempDir('x') });
  const entry = activationPlan.entries.find(
    (e) => e.host === 'opencode' && e.kind === 'mcp');
  assert.ok(entry, 'opencode declares an mcp merge entry');
  assert.equal(entry.id, 'scopegrain');
  assert.equal(entry.destination, 'opencode.jsonc');
  assert.equal(entry.manualMerge, true);
  assert.equal(entry.machineLocal, true);
  assert.ok(entry.source.endsWith('/integrations/opencode-mcp.json'));
  assert.match(entry.note, /regenerate per machine/);
  assert.match(entry.note, /opencode\.json\b/,
    'the alternative project config name is disclosed');
  // The fragment is a bootstrap artifact: no projected native file claims it.
  assert.ok(!files.some((f) => f.rel === entry.source));
  // Claude/codex share the same asymmetry and now declare it too: each
  // carries exactly its own disclosed mcp merge target, nothing more.
  const { activationPlan: others } = renderNativeAdapters(
    cfg(['claude', 'codex']),
    { configRel: CFG_REL, projectRoot: makeTempDir('x') });
  assert.deepEqual(
    others.entries.filter((e) => e.kind === 'mcp')
      .map((e) => `${e.host}:${e.destination}`).sort(),
    ['claude:.mcp.json', 'codex:.codex/config.toml']);
});

test('opencode emits only the V2 proposal in bootstrap', () => {
  const dir = makeTempDir('native-boot');
  try {
    const plan = prepareInit({ projectRoot: dir, configRel: CFG_REL,
      answers: DEFAULT_ANSWERS });
    const rels = plan.files.map((f) => f.rel);
    assert.ok(rels.includes('.scopegrain/integrations/opencode-mcp.json'));
    assert.ok(!rels.includes('.scopegrain/integrations/opencode-v1-mcp.json'));
    assert.ok(rels.includes(
      '.scopegrain/integrations/native/activation-plan.json'));
    applyPlan(dir, plan.files);
    const v2 = JSON.parse(fs.readFileSync(
      `${dir}/.scopegrain/integrations/opencode-mcp.json`, 'utf8'));
    assert.equal(v2.mcp.servers.scopegrain.type, 'local');
    assert.equal(v2.mcp.servers.scopegrain.disabled, true);
    assert.ok(!exists(dir, '.scopegrain/integrations/opencode-v1-mcp.json'));
    const ap = JSON.parse(fs.readFileSync(
      `${dir}/.scopegrain/integrations/native/activation-plan.json`, 'utf8'));
    assert.equal(ap.activation, 'manual-review-only');
    // No host roots written anywhere outside .scopegrain.
    assert.ok(!exists(dir, '.claude'));
    assert.ok(!exists(dir, '.codex'));
    assert.ok(!exists(dir, '.opencode'));
    assert.ok(!exists(dir, '.devin'));
  } finally { cleanup(dir); }
});

test('custom config dir and namespaced ids survive', () => {
  const { files } = renderNativeAdapters(cfg(['claude']),
    { configRel: 'cfg space/config.json' });
  assert.ok(files.every((f) =>
    f.rel.startsWith('cfg space/integrations/native/claude/')));
  const skill = files.find((f) => f.rel.includes('/skills/scopegrain-'));
  assert.ok(skill.content.toString('utf8')
    .includes('`cfg space/instructions.md`'));
  assert.equal(loadNativePolicy({}).namespace, 'scopegrain-');
});

test('host-interpolated literals abort before any write', () => {
  for (const marker of ['cfg !`whoami`', 'cfg $ARGUMENTS', 'cfg $1 dir']) {
    assert.throws(() => renderNativeAdapters(cfg(['claude']),
      { configRel: `${marker}/config.json` }),
      (e) => e.code === 'NATIVE_UNSAFE_LITERAL', marker);
  }
  // prepareInit also rejects before any file is planned.
  const dir = makeTempDir('unsafe-cfg');
  try {
    assert.throws(() => renderNativeAdapters(cfg(['claude']),
      { configRel: 'x !`rm -rf /`/config.json' }),
      (e) => e.code === 'NATIVE_UNSAFE_LITERAL');
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { cleanup(dir); }
  // Safe spaces and quotes still generate.
  const ok = renderNativeAdapters(cfg(['claude']),
    { configRel: "cfg 'quoted' dir/config.json" });
  assert.ok(ok.files.length > 0);
});

test('policy files project verbatim under cfgDir/policy', () => {
  const dir = makeTempDir('pol-proj');
  try {
    const plan = prepareInit({ projectRoot: dir, configRel: CFG_REL,
      answers: DEFAULT_ANSWERS });
    const wf = plan.files.find(
      (f) => f.rel === '.scopegrain/policy/workflow.json');
    const lim = plan.files.find(
      (f) => f.rel === '.scopegrain/policy/operation-limits.json');
    assert.ok(wf && lim);
    assert.equal(wf.content.toString('utf8'),
      fs.readFileSync('policy/workflow.json', 'utf8'));
    assert.equal(lim.content.toString('utf8'),
      fs.readFileSync('policy/operation-limits.json', 'utf8'));
  } finally { cleanup(dir); }
});
