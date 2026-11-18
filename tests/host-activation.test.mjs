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
import { renderNativeAdapters } from '../src/hosts/native.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import {
  DEFAULT_ANSWERS, cleanup, exists, makeTempDir, readJson, writeFile,
} from './helpers.mjs';

const CFG = '.tasksystem/config.json';

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
    const ide = prepareActivation(ctx, { host: 'antigravity', surface: 'ide' });
    const idePaths = ide.files.map((f) => f.rel);
    assert.ok(!idePaths.some((r) => r.includes('/agents/scopegrain-')),
      'ide surface must not emit custom agents');
    assert.ok(idePaths.some((r) => r.startsWith('.agents/skills/')));
    assert.ok(ide.warnings.some((w) => w.includes('.agents')),
      'shared .agents convention must be warned about');
    assert.throws(() => prepareActivation(ctx,
      { host: 'antigravity', surface: 'nope' }),
      (e) => e.code === 'INVALID_ARGS');
  } finally { cleanup(dir); }
});

test('colliding destinations are conflict on BOTH sides; apply fails closed', () => {
  // Antigravity variants share destinations: without a surface selection
  // every variant pair collides on the same rel.
  const { dir, ctx } = fixture(['antigravity']);
  try {
    const preview = prepareActivation(ctx, { host: 'antigravity' });
    const byRel = new Map();
    for (const f of preview.files) {
      byRel.set(f.rel, [...(byRel.get(f.rel) ?? []), f]);
    }
    const dups = [...byRel.values()].filter((g) => g.length > 1);
    assert.ok(dups.length > 0, 'variant destinations must collide');
    for (const group of dups) {
      for (const f of group) {
        assert.equal(f.action, 'conflict',
          `${f.rel} must be conflict on both sides of the collision`);
        assert.match(f.reason ?? '', /collides/);
      }
    }
    assert.throws(() => applyActivation(ctx, { host: 'antigravity' }),
      (e) => e.code === 'PLAN_CONFLICT');
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
    assert.ok(preview.skipped.every((s) =>
      String(s.destination).startsWith('.opencode/hacked')
      && /reserved prefix/.test(s.reason)));
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
      '.tasksystem/integrations/native/hermes/hermes-proposal.json'));
    const proposal = readJson(dir,
      '.tasksystem/integrations/native/hermes/hermes-proposal.json');
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
      const preview = prepareActivation(ctx, { host });
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
          '.tasksystem/integrations/native/hermes/hermes-proposal.json'),
          'utf8'));
        const instr = fs.readFileSync(path.join(dir,
          '.tasksystem/integrations/native/hermes/instructions.md'), 'utf8');
        assert.ok(instr.length > 40);
      } else {
        assert.ok(created.length > 0, `${host} must apply bridge files`);
      }
    } finally { cleanup(dir); }
  }
});
