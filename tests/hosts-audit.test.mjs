// SPDX-License-Identifier: Apache-2.0
// Audit 2026-11-24 host-bridge fixes:
//   P0  claude gate fragment remaps non-zero exits to 2 (fail-closed);
//   P1  parity sees codex TOML agents via a `# source:` marker;
//       generic registers its MCP merge target in the activation plan;
//       claude-only configs emit the universal AGENTS.md entrypoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { gateProposal } from '../src/hosts/gate-proposal.mjs';
import { hostParity } from '../src/hosts/parity.mjs';
import { buildActivation, prepareActivation }
  from '../src/hosts/activation.mjs';
import { hostManifest } from '../src/hosts/host-manifest.mjs';
import { renderNativeAdapters } from '../src/hosts/native.mjs';
import { prepareInit } from '../src/core/bootstrap.mjs';
import { createConfig, generatedFilePaths } from '../src/core/config.mjs';
import {
  bootstrappedCtx, cleanup, DEFAULT_ANSWERS, makeTempDir, VALID_ANSWERS,
} from './helpers.mjs';

const CFG = '.scopegrain/config.json';

function fixture(hosts) {
  const dir = makeTempDir('audit');
  const config = createConfig(dir, { ...DEFAULT_ANSWERS, hosts }, {});
  return { dir, ctx: { projectRoot: dir, configPath: CFG, config } };
}

test('claude gate command remaps every non-zero gate exit to 2', (t) => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const p = gateProposal(ctx, { host: 'claude' });
    const command = p.fragment.hooks.PreToolUse[0].hooks[0].command;
    // Claude Code only treats exit 2 as blocking; 1 and 3 would be
    // non-blocking errors — the wrapper must enforce the fail-closed
    // policy the fragment documents.
    assert.match(command, /s=\$\?; \[ "\$s" -eq 0 \] \|\| exit 2$/);
    const probe = spawnSync('sh', ['-c', 'true']);
    if (probe.error) {
      t.skip('sh unavailable; functional remap check skipped');
      return;
    }
    for (const code of [0, 1, 2, 3]) {
      const r = spawnSync('sh', ['-c',
        `scopegrain() { return ${code}; }; ${command}`]);
      const want = code === 0 ? 0 : 2;
      assert.equal(r.status, want,
        `task gate exit ${code} must map to hook exit ${want}`);
    }
  } finally { cleanup(dir); }
});

test('codex TOML agents carry a source marker; parity counts them', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const plan = buildActivation(ctx, { host: 'codex' });
    const tomls = plan.applyable.filter((f) => f.rel.endsWith('.toml'));
    assert.ok(tomls.length > 0);
    for (const f of tomls) {
      assert.match(String(f.content),
        /^# source: "agent\/[^"]+"$/m, `${f.rel} must mark its source`);
    }
    const r = hostParity(ctx, { hosts: ['codex'] });
    // Before the fix every codex agent file was source-less: parity
    // counted them non-catalog and reported the resources as absent.
    assert.equal(r.coverage.codex.nonCatalogFiles, 0);
    assert.ok(r.coverage.codex.resources > 0);
    for (const item of [...r.drift, ...r.structural]) {
      assert.ok(!item.source.startsWith('agent/')
          || !item.missingFrom.includes('codex'),
        `codex agent '${item.source}' must not be reported absent`);
    }
  } finally { cleanup(dir); }
});

test('generic MCP merge target is registered, skipped and shared', () => {
  const { dir, ctx } = fixture(['generic']);
  try {
    const { activationPlan } = renderNativeAdapters(
      ctx.config, { configRel: CFG, projectRoot: dir });
    const entry = activationPlan.entries.find(
      (e) => e.host === 'generic' && e.kind === 'mcp');
    assert.ok(entry, 'generic must declare an mcp merge entry');
    assert.ok(entry.source.endsWith('generic-mcp.json'));
    assert.equal(entry.activationMode, 'merge');
    // No canonical destination file exists for an unspecified host;
    // null keeps doctor's merge-target check honest.
    assert.equal(entry.destination, null);

    const preview = prepareActivation(ctx, { host: 'generic' });
    assert.ok(preview.skipped.some((s) =>
      String(s.source).endsWith('generic-mcp.json')
      && /manual merge/.test(s.reason)));

    const manifest = hostManifest(ctx, { host: 'generic' });
    assert.ok(manifest.shared.some((s) =>
      String(s.source).endsWith('generic-mcp.json')
      && s.ownership === 'shared'));
  } finally { cleanup(dir); }
});

test('claude-only configs emit AGENTS.md next to CLAUDE.md', () => {
  assert.ok(generatedFilePaths('.scopegrain/config.json', ['claude'])
    .files.includes('AGENTS.md'));
  const dir = makeTempDir('audit-claude');
  try {
    const prepared = prepareInit({ projectRoot: dir,
      answers: { ...VALID_ANSWERS, hosts: ['claude'] } });
    const agents = prepared.files.find((f) => f.rel === 'AGENTS.md');
    const claude = prepared.files.find((f) => f.rel === 'CLAUDE.md');
    assert.ok(agents && claude, 'both entrypoints must be planned');
    // Same managed-section block: identical bytes, no divergence drift.
    assert.ok(agents.content.equals
      ? agents.content.equals(claude.content)
      : agents.content === claude.content);
    assert.match(String(agents.content), /SCOPEGRAIN:BEGIN/);
  } finally { cleanup(dir); }
});
