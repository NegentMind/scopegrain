// SPDX-License-Identifier: Apache-2.0
// Host activation: dry-run preview, create-only apply, noop re-apply,
// conflict blocking, surface filtering, global/manual-merge/reserved
// skips, the provisional hermes proposal and per-host structural parse
// of applied destinations. Structural checks only - no host binary
// certification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  prepareActivation, applyActivation,
} from '../src/hosts/activation.mjs';
import { KNOWN_HOSTS, createConfig } from '../src/core/config.mjs';
import { hostManifest } from '../src/hosts/host-manifest.mjs';
import { renderNativeAdapters } from '../src/hosts/native.mjs';
import { renderAdapters } from '../src/hosts/render.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import {
  DEFAULT_ANSWERS, cleanup, exists, makeTempDir, readJson, writeFile,
} from './helpers.mjs';

const CFG = '.scopegrain/config.json';

// Fixture: a temp project with a validated config. Proposal files only
// need to exist on disk when nothing is applied (provisional hosts review
// them in place); activation re-derives bytes from catalog and policy, so
// a hand-edited proposal file can never propagate into a destination.
function fixture(hosts) {
  const dir = makeTempDir('act');
  const config = createConfig(dir, { ...DEFAULT_ANSWERS, hosts }, {});
  if (hosts.includes('hermes')) {
    const native = renderNativeAdapters(
      config, { configRel: CFG, projectRoot: dir });
    applyPlan(dir,
      native.files.map((f) => ({ rel: f.rel, content: f.content })));
  }
  return { dir, ctx: { projectRoot: dir, configPath: CFG, config } };
}

// Fixture: a full copy of the install root (policy, resources, templates)
// so a policy edit stays isolated from the real installation.
function patchedInstall(patch) {
  const root = makeTempDir('install');
  for (const d of ['policy', 'resources', 'templates']) {
    fs.cpSync(d, path.join(root, d), { recursive: true });
  }
  const file = path.join(root, 'policy', 'native-adapters.json');
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  patch(policy);
  fs.writeFileSync(file, JSON.stringify(policy, null, 2));
  return root;
}

function assertToml(text, rel) {
  const lines = text.split('\n')
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  assert.ok(lines.length > 0, rel);
  for (const l of lines) {
    const m = l.match(/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.+)$/);
    if (m) {
      // JSON.stringify-quoted scalars are TOML basic strings; JSON.parse
      // proves the escaping round-trips.
      if (m[1].trim().startsWith('"')) JSON.parse(m[1].trim());
    } else {
      assert.ok(/^\[[^\]]+\]$/.test(l.trim()), `bad TOML line in ${rel}: ${l}`);
    }
  }
}

function assertMd(text, rel) {
  assert.ok(text.startsWith('---\n'), `${rel} must open a frontmatter fence`);
  const parts = text.split(/^---$/m);
  assert.ok(parts.length >= 3, `${rel} must close the frontmatter fence`);
  assert.ok(parts[2].trim().length > 0, `${rel} body must not be empty`);
}

test('hermes is admitted; non-empty and dedupe rules preserved', () => {
  assert.ok(KNOWN_HOSTS.includes('hermes'));
  const cfg = createConfig(makeTempDir('h'),
    { ...DEFAULT_ANSWERS, hosts: ['hermes'] }, {});
  assert.deepEqual(cfg.hosts, ['hermes']);
  assert.throws(() => createConfig(makeTempDir('h'),
    { ...DEFAULT_ANSWERS, hosts: ['hermes', 'hermes'] }, {}),
    (e) => e.code === 'INVALID_HOSTS');
  assert.throws(() => createConfig(makeTempDir('h'),
    { ...DEFAULT_ANSWERS, hosts: [] }, {}),
    (e) => e.code === 'INVALID_HOSTS');
});

test('dry-run lists actions and writes nothing', () => {
  const { dir, ctx } = fixture(['claude']);
  try {
    const preview = prepareActivation(ctx, { host: 'claude' });
    assert.equal(preview.mode, 'dry-run');
    assert.equal(preview.host, 'claude');
    assert.equal(preview.format, 'documented-only');
    assert.ok(preview.files.length > 0);
    assert.ok(preview.files.every((f) => f.action === 'create'));
    assert.ok(!exists(dir, '.claude'));
  } finally { cleanup(dir); }
});

test('apply is create-only inside the project; re-apply is noop', () => {
  const { dir, ctx } = fixture(['claude']);
  try {
    const first = applyActivation(ctx, { host: 'claude' });
    assert.equal(first.mode, 'applied');
    assert.ok(first.applied > 0);
    assert.ok(exists(dir, '.claude/skills'));
    assert.ok(exists(dir, '.claude/agents'));
    const second = applyActivation(ctx, { host: 'claude' });
    assert.equal(second.applied, 0);
    assert.ok(second.files.length > 0
      && second.files.every((f) => f.action === 'noop'));
  } finally { cleanup(dir); }
});

test('a divergent existing destination conflicts and blocks everything', () => {
  const { dir, ctx } = fixture(['claude']);
  try {
    const target = prepareActivation(ctx, { host: 'claude' }).files[0].rel;
    writeFile(dir, target, 'user content\n');
    const preview = prepareActivation(ctx, { host: 'claude' });
    assert.equal(preview.files.find((f) => f.rel === target).action, 'conflict');
    assert.throws(() => applyActivation(ctx, { host: 'claude' }),
      (e) => e.code === 'PLAN_CONFLICT');
    assert.equal(fs.readFileSync(path.join(dir, ...target.split('/')), 'utf8'),
      'user content\n');
  } finally { cleanup(dir); }
});

test('unknown host and unselected host are rejected', () => {
  const { dir, ctx } = fixture(['claude']);
  try {
    assert.throws(() => prepareActivation(ctx, { host: 'gpt' }),
      (e) => e.code === 'UNKNOWN_HOST');
    assert.throws(() => prepareActivation(ctx, { host: 'codex' }),
      (e) => e.code === 'HOST_NOT_SELECTED');
  } finally { cleanup(dir); }
});

test('surface filters variant entries; bogus surface is an error', () => {
  const { dir, ctx } = fixture(['antigravity']);
  try {
    const app = prepareActivation(ctx, { host: 'antigravity', surface: 'app-cli' });
    const appPaths = app.files.map((f) => f.rel);
    assert.ok(appPaths.some((r) => r.includes('/agents/scopegrain-')));
    assert.ok(app.files.some((f) =>
      f.rel === '.agents/mcp_config.json'
      && f.kind === 'mcp-config'
      && f.action === 'create'));
    const ide = prepareActivation(ctx, { host: 'antigravity', surface: 'ide' });
    const idePaths = ide.files.map((f) => f.rel);
    assert.ok(!idePaths.some((r) => r.includes('/agents/scopegrain-')),
      'ide surface must not emit custom agents');
    assert.ok(idePaths.some((r) => r.startsWith('.agents/skills/')));
    assert.ok(ide.files.some((f) =>
      f.rel === '.agents/mcp_config.json'
      && f.kind === 'mcp-config'
      && f.action === 'create'));
    assert.ok(ide.warnings.some((w) => w.includes('.agents')),
      'shared .agents convention must be warned about');
    assert.throws(() => prepareActivation(ctx,
      { host: 'antigravity', surface: 'nope' }),
      (e) => e.code === 'INVALID_ARGS');
  } finally { cleanup(dir); }
});

test('multi-variant host without surface fails with a named surface list', () => {
  // Antigravity variants share destinations and policy marks them
  // selectionRequired: activating without --surface must refuse up front
  // with the valid selectors, not collide inside the plan (UAT-1 R3).
  const { dir, ctx } = fixture(['antigravity']);
  try {
    assert.throws(() => prepareActivation(ctx, { host: 'antigravity' }),
      (e) => e.code === 'INVALID_ARGS'
        && /requires --surface/.test(e.message)
        && e.message.includes('app-cli'));
    assert.throws(() => applyActivation(ctx, { host: 'antigravity' }),
      (e) => e.code === 'INVALID_ARGS');
    // Explicit surfaces still plan cleanly.
    for (const surface of ['app-cli', 'ide']) {
      const plan = prepareActivation(ctx, { host: 'antigravity', surface });
      assert.equal(plan.files.filter((f) => f.action === 'conflict')
        .length, 0, `${surface} must plan without conflicts`);
    }
  } finally { cleanup(dir); }
});

test('reserved-prefix destinations are skipped; .opencode is opencode-only', () => {
  // '.opencode' is a documented destination for the opencode host only:
  // a claude policy pointing into it is classified skipped, never written.
  const { dir, ctx } = fixture(['claude']);
  const installRoot = patchedInstall((p) => {
    p.hosts.claude.skillRoot = '.opencode/hacked';
  });
  try {
    const preview = prepareActivation(ctx, { host: 'claude', installRoot });
    assert.ok(preview.skipped.length > 0);
    // Every patched .opencode/hacked destination is classified skipped
    // with the reserved-prefix reason; remaining skipped entries are
    // disclosed manual merges (e.g. the claude .mcp.json merge target),
    // never writes.
    const reserved = preview.skipped.filter((s) =>
      String(s.destination).startsWith('.opencode/hacked'));
    assert.ok(reserved.length > 0);
    assert.ok(reserved.every((s) => /reserved prefix/.test(s.reason)));
    assert.ok(preview.skipped.every((s) =>
      /reserved prefix|manual merge/.test(s.reason)));
    assert.ok(preview.files.every((f) => !f.rel.startsWith('.opencode/')));
    const res = applyActivation(ctx, { host: 'claude', installRoot });
    assert.ok(res.applied > 0, 'non-reserved destinations still apply');
    assert.ok(!exists(dir, '.opencode'));
    assert.ok(exists(dir, '.claude/agents'));
    // The opencode host itself keeps '.opencode' applyable by contract.
    const { dir: ocDir, ctx: ocCtx } = fixture(['opencode']);
    try {
      const oc = prepareActivation(ocCtx, { host: 'opencode' });
      assert.ok(oc.files.some((f) => f.rel.startsWith('.opencode/')
        && f.action === 'create'),
        '.opencode destinations must stay applyable for opencode');
    } finally { cleanup(ocDir); }
  } finally { cleanup(dir); cleanup(installRoot); }
});

test('policy roots under .git/node_modules/legacy are rejected at load', () => {
  // Policy validation is the outer wall: these roots never reach the
  // activation classifier. The skipped-path guard in buildActivation is
  // defense in depth behind it.
  for (const root of ['.git/x', 'node_modules/x', 'legacy/x']) {
    const { dir, ctx } = fixture(['claude']);
    const installRoot = patchedInstall((p) => {
      p.hosts.claude.skillRoot = root;
    });
    try {
      assert.throws(() => prepareActivation(ctx,
        { host: 'claude', installRoot }),
        (e) => e.code === 'POLICY_MALFORMED');
      assert.ok(!exists(dir, root.split('/')[0]));
    } finally { cleanup(dir); cleanup(installRoot); }
  }
});

test('merge-required entries are skipped, never applied', () => {
  const { dir, ctx } = fixture(['codex']);
  try {
    const res = applyActivation(ctx, { host: 'codex' });
    assert.ok(res.skipped.some((s) => s.destination === '.codex/config.toml'));
    assert.ok(res.warnings.length > 0);
    assert.ok(!exists(dir, '.codex/config.toml'));
    assert.ok(exists(dir, '.codex/agents/scopegrain-reviewer.toml'));
  } finally { cleanup(dir); }
});

test('devin applies the dedicated mcp_config file and skips the legacy merge', () => {
  const { dir, ctx } = fixture(['devin']);
  try {
    const preview = prepareActivation(ctx, { host: 'devin' });
    assert.equal(preview.mode, 'dry-run');
    assert.ok(preview.files.some((f) => f.rel === '.devin/mcp_config.json'
      && f.action === 'create' && f.kind === 'mcp-config'));
    // The legacy shared config never auto-applies: manual merge only.
    assert.ok(preview.skipped.some((s) =>
      s.destination === '.devin/config.json'));
    const res = applyActivation(ctx, { host: 'devin' });
    assert.ok(exists(dir, '.devin/mcp_config.json'));
    assert.ok(!exists(dir, '.devin/config.json'));
    const applied = readJson(dir, '.devin/mcp_config.json');
    const srv = applied.mcpServers.scopegrain;
    assert.equal(srv.command, 'node');
    assert.deepEqual(srv.args.slice(1),
      ['--project', dir, '--config', CFG]);
    // Re-apply is noop; a divergent file conflicts and never rewrites.
    const second = applyActivation(ctx, { host: 'devin' });
    assert.equal(second.applied, 0);
    writeFile(dir, '.devin/mcp_config.json', '{"other":true}\n');
    assert.equal(prepareActivation(ctx, { host: 'devin' })
      .files.find((f) => f.rel === '.devin/mcp_config.json').action,
      'conflict');
    assert.throws(() => applyActivation(ctx, { host: 'devin' }),
      (e) => e.code === 'PLAN_CONFLICT');
    assert.equal(fs.readFileSync(
      path.join(dir, '.devin', 'mcp_config.json'), 'utf8'),
      '{"other":true}\n');
  } finally { cleanup(dir); }
});

test('opencode MCP fragment is disclosed as a manual merge, never written', () => {
  // OpenCode pilot D1. The fragment embeds absolute machine-local paths and
  // is merged by hand into the project OpenCode config, so it has no
  // whole-file destination. Silence was the defect: activation must
  // disclose it, the manifest must label it `shared`, and nothing may ever
  // create the destination (doctor therefore never sees it as a fragment
  // conflict — it is not in the applyable set at all).
  const { dir, ctx } = fixture(['opencode']);
  try {
    const preview = prepareActivation(ctx, { host: 'opencode' });
    assert.equal(preview.format, 'documented-only');
    const entry = preview.skipped.find((s) => s.destination === 'opencode.jsonc');
    assert.ok(entry, 'the MCP merge target must be disclosed, not silent');
    assert.match(entry.reason, /manual merge/);
    assert.ok(entry.source.endsWith('/integrations/opencode-mcp.json'));
    assert.ok(preview.warnings.some((w) => /manual merge/.test(w)));
    assert.ok(!preview.files.some((f) => f.rel === 'opencode.jsonc'),
      'the merge target is never an applyable destination');

    const res = applyActivation(ctx, { host: 'opencode' });
    assert.ok(res.applied > 0);
    assert.ok(exists(dir, '.opencode/skills'));
    assert.ok(exists(dir, '.opencode/agents/scopegrain-reviewer.md'));
    assert.ok(!exists(dir, 'opencode.jsonc'));

    const manifest = hostManifest(ctx, { host: 'opencode' });
    assert.equal(manifest.shared.length, 1);
    assert.equal(manifest.shared[0].destination, 'opencode.jsonc');
    assert.equal(manifest.shared[0].ownership, 'shared');
    assert.ok(!manifest.generated.some((g) => g.rel === 'opencode.jsonc'));
  } finally { cleanup(dir); }
});

test('hermes proposal is provisional and never auto-applies global paths', () => {
  const { dir, ctx } = fixture(['hermes']);
  try {
    const preview = prepareActivation(ctx, { host: 'hermes' });
    assert.equal(preview.format, 'provisional');
    assert.ok(preview.skipped.some((s) => String(s.destination).startsWith('~')),
      'global ~/.hermes target must be classified manual-only');
    assert.ok(preview.warnings.length > 0);
    const res = applyActivation(ctx, { host: 'hermes' });
    assert.equal(res.applied, 0);
    assert.ok(!exists(dir, '.hermes'));
    assert.ok(!exists(dir, '~'));
    assert.ok(exists(dir,
      '.scopegrain/integrations/native/hermes/hermes-proposal.json'));
    const proposal = readJson(dir,
      '.scopegrain/integrations/native/hermes/hermes-proposal.json');
    assert.equal(proposal.format, 'provisional');
    assert.equal(proposal.verified, false);
    // instructions.md reviews in place: its destination is its source.
    assert.ok(res.files.every((f) => f.action === 'noop'));
  } finally { cleanup(dir); }
});

test('no applyable destination is absolute, global or traversing', () => {
  for (const host of KNOWN_HOSTS) {
    const { dir, ctx } = fixture([host]);
    try {
      // Antigravity is multi-variant: an explicit surface is required.
      const surface = host === 'antigravity' ? 'app-cli' : undefined;
      const preview = prepareActivation(ctx, { host, surface });
      for (const f of preview.files) {
        assert.ok(!path.isAbsolute(f.rel), f.rel);
        assert.ok(!f.rel.startsWith('~'), f.rel);
        assert.ok(!f.rel.includes('..'), f.rel);
      }
    } finally { cleanup(dir); }
  }
});

test('applied destinations parse per host format (all admitted hosts)', () => {
  for (const host of KNOWN_HOSTS) {
    const { dir, ctx } = fixture([host]);
    try {
      // Antigravity variants share destinations; selection is required or
      // duplicated destinations collide into conflict by design.
      const surface = host === 'antigravity' ? 'app-cli' : undefined;
      const res = applyActivation(ctx, { host, surface });
      const created = res.files.filter((f) => f.action === 'create');
      for (const f of created) {
        const text = fs.readFileSync(
          path.join(dir, ...f.rel.split('/')), 'utf8');
        if (f.rel.endsWith('.json')) JSON.parse(text);
        else if (f.rel.endsWith('.toml')) assertToml(text, f.rel);
        else if (f.rel.endsWith('.md')) assertMd(text, f.rel);
        else assert.fail(`unexpected extension in ${f.rel}`);
      }
      if (host === 'hermes') {
        // Nothing applies to unverified global roots; the generated
        // proposal documents still parse structurally in place.
        JSON.parse(fs.readFileSync(path.join(dir,
          '.scopegrain/integrations/native/hermes/hermes-proposal.json'),
          'utf8'));
        const instr = fs.readFileSync(path.join(dir,
          '.scopegrain/integrations/native/hermes/instructions.md'), 'utf8');
        assert.ok(instr.length > 40);
      } else {
        assert.ok(created.length > 0, `${host} must apply bridge files`);
      }
    } finally { cleanup(dir); }
  }
});

test('generic adapter contract: .agent/ roots only, create-only, noop re-apply', () => {
  const { dir, ctx } = fixture(['generic']);
  try {
    const preview = prepareActivation(ctx, { host: 'generic' });
    assert.equal(preview.host, 'generic');
    assert.ok(preview.files.length > 0);
    // Contract: every destination lives under the .agent/ convention
    // roots — nothing outside, nothing global.
    assert.ok(preview.files.every((f) => f.rel.startsWith('.agent/')),
      'generic destinations must stay under .agent/');
    assert.ok(preview.files.some(
      (f) => /^\.agent\/skills\/[^/]+\/SKILL\.md$/.test(f.rel)));
    assert.ok(preview.files.some(
      (f) => /^\.agent\/agents\/[^/]+\.md$/.test(f.rel)));
    const first = applyActivation(ctx, { host: 'generic' });
    assert.ok(first.applied > 0);
    assert.ok(exists(dir, '.agent/skills'));
    assert.ok(exists(dir, '.agent/agents'));
    const second = applyActivation(ctx, { host: 'generic' });
    assert.equal(second.applied, 0);
  } finally { cleanup(dir); }
});

test('generic MCP fragment is a disabled stdio scaffold', () => {
  const dir = makeTempDir('gmcp');
  try {
    const config = createConfig(dir,
      { ...DEFAULT_ANSWERS, hosts: ['generic'] }, {});
    const cfgAbs = path.join(dir, CFG);
    const rendered = renderAdapters(config, {
      projectRoot: dir, configPath: cfgAbs,
      instructionsPath: path.join(dir, 'instructions.md'),
      serverPath: path.join(dir, 'server.mjs'),
    });
    const mcp = rendered.files.find(
      (f) => /generic-mcp\.json$/.test(f.relativePath));
    assert.ok(mcp, 'generic-mcp.json must be emitted');
    const doc = JSON.parse(mcp.content);
    // Contract: stdio shape, disabled:true forces manual opt-in merge,
    // note discloses the scaffold status.
    assert.equal(doc.mcpServers.scopegrain.type, 'stdio');
    assert.equal(doc.mcpServers.scopegrain.command, 'node');
    assert.equal(doc.mcpServers.scopegrain.disabled, true);
    assert.match(doc.note, /scaffold|manual/i);
  } finally { cleanup(dir); }
});
