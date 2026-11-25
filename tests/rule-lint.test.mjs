// SPDX-License-Identifier: Apache-2.0
// Advisory rule lint: glob overlap detection, status/enforcement pair
// warnings, stale manifest deps — warnings only, never blocking.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  globsMayOverlap, lintRules,
} from '../src/core/rule-meta.mjs';
import { buildWorkflowPacket } from '../src/core/workflows.mjs';
import { runDoctor } from '../src/core/doctor.mjs';
import {
  bootstrappedCtx, cleanup, writeFile,
} from './helpers.mjs';

test('globsMayOverlap is conservative and correct on provable misses', () => {
  // Provable overlaps.
  assert.equal(globsMayOverlap(['src/**/*.ts'], ['src/feature/*.ts']), true);
  assert.equal(globsMayOverlap(['src/**'], ['src/a/b.txt']), true);
  assert.equal(globsMayOverlap(['*.md'], ['readme.md']), true);
  assert.equal(globsMayOverlap(['src/**'], []), true); // transversal
  assert.equal(globsMayOverlap([], ['docs/**']), true);
  // Provable misses: disjoint literal dirs and length-mismatched paths.
  assert.equal(globsMayOverlap(['src/**'], ['docs/**']), false);
  assert.equal(globsMayOverlap(['src/*.ts'], ['src/deep/*.ts']), false);
  assert.equal(globsMayOverlap(['*.ts'], ['src/*.ts']), false);
  assert.equal(globsMayOverlap(['a/b/c'], ['a/x/c']), false);
  // An embedded '**' (segment like 'a**') compiles to '.*' in matchGlob
  // — it crosses '/', so segmentwise reasoning is unsound. Report
  // overlap unless the other side is a fully literal path that
  // provably fails to match. ('**/' compiles to full segments, so
  // 'a/b/c/x' vs 'a**/x' is provably disjoint under this grammar.)
  assert.equal(globsMayOverlap(['a/x'], ['a**']), true);
  assert.equal(globsMayOverlap(['a/x/y'], ['a**']), true);
  assert.equal(globsMayOverlap(['a/b/c/x'], ['a**/x']), false);
  assert.equal(globsMayOverlap(['readme.md'], ['a**']), false);
  assert.equal(globsMayOverlap(['a*'], ['b**']), true); // undecidable
  assert.equal(globsMayOverlap(['a**'], ['b**']), true); // both embedded
});

function meta(status, globs, level = 'advisory') {
  return { status, activation: globs ? { globs } : null,
    enforcement: { level } };
}

test('lintRules emits advisory warnings for the declared cases', () => {
  const warnings = lintRules({
    rules: [
      { id: 'strict-ts', meta: meta('active', ['src/**/*.ts'], 'strict') },
      { id: 'advice-ts', meta: meta('active', ['src/feature/*.ts'], 'advisory') },
      { id: 'stale-css', meta: meta('archived', ['src/**/*.ts']) },
      { id: 'far-away', meta: meta('active', ['docs/**'], 'strict') },
    ],
    commands: [{ id: 'cmd-x',
      rules: ['strict-ts', 'stale-css', 'ghost-rule'] }],
  });
  // Overlap + enforcement conflict.
  assert.ok(warnings.some((w) => w.includes('strict-ts')
    && w.includes('advice-ts') && w.includes('strict vs advisory')));
  // Archived sibling overlapping an active rule.
  assert.ok(warnings.some((w) => w.includes('stale-css')
    && w.includes('archived')));
  // Dep on a filtered rule and on a missing rule.
  assert.ok(warnings.some((w) => w.includes("status 'archived'")));
  assert.ok(warnings.some((w) => w.includes("unknown rule 'ghost-rule'")));
  // Dep attribution names the declaring layer, not just the command.
  const pw = lintRules({
    rules: [{ id: 'old', meta: meta('archived') }],
    commands: [
      { id: 'command/cmd-x', rules: [] },
      { id: 'profile/research', rules: ['old'] },
    ],
  });
  assert.ok(pw.some((w) => w.includes('profile/research')
    && w.includes('declares rule old')));
  // Literal-vs-glob decidible: '*.ts' can never produce 'readme.md'.
  assert.equal(globsMayOverlap(['*.ts'], ['readme.md']), false);
  assert.equal(globsMayOverlap(['*.ts'], ['x.ts']), true);
  // Disjoint scopes produce nothing.
  assert.ok(!warnings.some((w) => w.includes('far-away')
    && w.includes('overlap')));
});

test('lintRules never throws on empty or degraded input', () => {
  assert.deepEqual(lintRules({}), []);
  assert.deepEqual(lintRules({ rules: [{ id: 'x' }] }), []);
});

function seedRule(ctx, { id, fm, depOf = 'implement-task',
  depAs = null, aliasId = null }) {
  const dir = path.join(ctx.projectRoot, ctx.configDir);
  const body = `${fm}# ${id}\n`;
  writeFile(dir, `rules/${id}.md`, body);
  const catPath = path.join(dir, 'catalog.json');
  const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'));
  cat.entries.push({ kind: 'rule', id, path: `rules/${id}.md`,
    description: 'seeded', sha256: crypto.createHash('sha256')
      .update(body).digest('hex') });
  if (aliasId) {
    cat.aliases.push({ kind: 'rule', id: aliasId, target: id });
  }
  cat.entries.find((e) => e.kind === 'command' && e.id === depOf)
    .rules.push(depAs ?? id);
  fs.writeFileSync(catPath, JSON.stringify(cat, null, 2));
}

test('packet warnings expose lint findings; doctor reports rule-lint', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    seedRule(ctx, { id: 'lint-strict',
      fm: '---\nenforcement.level: strict\nactivation.globs: rules/**\n---\n' });
    seedRule(ctx, { id: 'lint-archived',
      fm: '---\nstatus: archived\nactivation.globs: rules/**\n---\n' });
    // A dep declared through an alias is judged by its target's
    // status — never misreported as an unknown rule.
    seedRule(ctx, { id: 'lint-alias-target',
      fm: '---\nstatus: proposed\n---\n',
      aliasId: 'lint-alias', depAs: 'lint-alias' });
    const p = buildWorkflowPacket(ctx, { command: 'implement-task' });
    // Dep on an archived rule warns (it is filtered from the packet).
    // Anchor on the dep-warning phrasing — the status-pair warning
    // also names the rule but is a different finding.
    const depWarning = p.warnings.find((w) =>
      w.includes('declares rule lint-archived'));
    assert.ok(depWarning);
    // Dep attribution: the warning names the declaring layer exactly —
    // the archived rule was declared by the command itself.
    assert.ok(depWarning.includes('command/implement-task'));
    assert.ok(!p.warnings.some((w) =>
      w.includes("unknown rule 'lint-alias'")));
    assert.ok(p.warnings.some((w) => w.includes('lint-alias-target')
      && w.includes("'proposed'")));
    // An active strict rule overlapping a canonical transversal
    // advisory rule emits the pair warning.
    assert.ok(p.warnings.some((w) => w.includes('lint-strict')
      && w.includes('strict vs advisory')));
    const doc = runDoctor(ctx);
    const check = doc.checks.find((c) => c.name === 'rule-lint');
    assert.ok(check);
    assert.equal(check.severity, 'warning');
    assert.ok(check.detail.includes('advisory'));
    // A warning-level finding counts under warnings, never failures.
    assert.ok(doc.summary.warnings >= 1);
  } finally { cleanup(dir); }
});

test('malformed local rule meta degrades to a lint warning', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const dirPath = path.join(ctx.projectRoot, ctx.configDir);
    writeFile(dirPath, 'rules/local/bad-meta.md',
      '---\nstatus: bogus\n---\n# bad-meta\n');
    const doc = runDoctor(ctx);
    const ws = doc.checks.find((c) => c.name === 'workspace-catalog');
    // The malformed local rule is a lint finding, not a catalog failure:
    // workspace-catalog stays green and the check still ran the lint.
    assert.equal(ws.ok, true, ws.detail);
    const check = doc.checks.find((c) => c.name === 'rule-lint');
    assert.ok(check.detail.includes('bad-meta')
      && check.detail.includes('meta unreadable'));
    assert.equal(check.severity, 'warning');
  } finally { cleanup(dir); }
});
