// SPDX-License-Identifier: Apache-2.0
// Local rule store: propose/approve/archive over rules/local/, status
// flips across marker styles, revision CAS, and the mutation trail.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  listRules, showRule, setRuleStatus, prepareProposeRule,
  applyProposeRule, prepareFlipRule, applyFlipRule,
} from '../src/core/rules.mjs';
import {
  bootstrappedCtx, cleanup, writeFile, writeJson,
} from './helpers.mjs';

function localPath(ctx, id) {
  return path.join(ctx.projectRoot, '.scopegrain/rules/local', `${id}.md`);
}

test('setRuleStatus rewrites every marker style', () => {
  // Frontmatter status key wins.
  const fm = setRuleStatus(Buffer.from(
    '---\nstatus: proposed\nactivation.globs: src/**\n---\n# R\n'), 'active');
  assert.match(fm.toString(), /status: active\nactivation\.globs/);
  // Frontmatter without status gets the key inside the block.
  const fm2 = setRuleStatus(Buffer.from(
    '---\ncategory: testing\n---\n# R\n'), 'archived');
  assert.match(fm2.toString(), /category: testing\nstatus: archived\n---/);
  // Human header rewrites.
  const hd = setRuleStatus(Buffer.from(
    '# R\n\n> **Status:** Draft\n'), 'active');
  assert.match(hd.toString(), /> \*\*Status:\*\* Active/);
  // No marker inserts one right after the first heading.
  const ins = setRuleStatus(Buffer.from('# Rule\n\nbody\n'), 'proposed');
  assert.match(ins.toString(), /# Rule\n\n> \*\*Status:\*\* Proposed/);
});

test('propose stages a draft as local + proposed, dry-run first', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    writeFile(dir, 'drafts/my-rule.md', '# My Rule\n\ndo the thing\n');
    const dry = prepareProposeRule(ctx, { input: 'drafts/my-rule.md' });
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.id, 'my-rule');
    assert.equal(dry.status, 'proposed');
    assert.ok(!fs.existsSync(localPath(ctx, 'my-rule')));
    const out = applyProposeRule(ctx, { input: 'drafts/my-rule.md' });
    assert.equal(out.applied, true);
    assert.equal(out.revision, 1);
    const body = fs.readFileSync(localPath(ctx, 'my-rule'), 'utf8');
    assert.match(body, /> \*\*Status:\*\* Proposed/);
    // The trail records the mutation.
    const trail = fs.readFileSync(path.join(ctx.projectRoot,
      '.scopegrain/state/rules-journal.jsonl'), 'utf8');
    assert.match(trail, /"op":"propose".*"id":"my-rule"/);
    // A second propose of the same id fails closed.
    assert.throws(() => applyProposeRule(ctx,
      { input: 'drafts/my-rule.md' }),
      (e) => e.code === 'RULE_ALREADY_EXISTS'
        || e.code === 'JOURNAL_SOURCE_CONFLICT');
    // --id overrides the filename stem.
    writeFile(dir, 'drafts/other.md', '# Other\n');
    const named = applyProposeRule(ctx,
      { input: 'drafts/other.md', id: 'named-rule' });
    assert.equal(named.id, 'named-rule');
    assert.ok(fs.existsSync(localPath(ctx, 'named-rule')));
  } finally { cleanup(dir); }
});

test('approve flips proposed -> active behind revision CAS', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    writeFile(dir, 'd/r.md', '---\nstatus: proposed\n---\n# R\n');
    applyProposeRule(ctx, { input: 'd/r.md', id: 'flip-me' });
    // Wrong revision fails before any write.
    assert.throws(() => applyFlipRule(ctx, 'flip-me',
      { revision: 7 }, 'active'),
      (e) => e.code === 'RULE_REVISION_CONFLICT');
    // Dry-run previews the flip.
    const dry = prepareFlipRule(ctx, 'flip-me', { revision: 1 }, 'active');
    assert.deepEqual({ from: dry.from, to: dry.to, revision: dry.revision },
      { from: 'proposed', to: 'active', revision: 1 });
    const out = applyFlipRule(ctx, 'flip-me', { revision: 1 }, 'active');
    assert.equal(out.to, 'active');
    assert.equal(out.revision, 2);
    const body = fs.readFileSync(localPath(ctx, 'flip-me'), 'utf8');
    assert.match(body, /status: active/);
    // Re-approving an active rule is a conflict, not a noop.
    assert.throws(() => applyFlipRule(ctx, 'flip-me',
      { revision: 2 }, 'active'),
      (e) => e.code === 'RULE_STATUS_CONFLICT');
    // Archive works from active too.
    const arch = applyFlipRule(ctx, 'flip-me', { revision: 2 }, 'archived');
    assert.equal(arch.to, 'archived');
    assert.match(fs.readFileSync(localPath(ctx, 'flip-me'), 'utf8'),
      /status: archived/);
  } finally { cleanup(dir); }
});

test('list/show resolve status and origin across layers', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    writeFile(dir, 'd/prop.md', '# Prop\n');
    applyProposeRule(ctx, { input: 'd/prop.md', id: 'prop-rule' });
    const { rules } = listRules(ctx);
    const local = rules.find((r) => r.id === 'prop-rule');
    assert.equal(local.origin, 'local');
    assert.equal(local.status, 'proposed');
    // Canonical rules list with their declared status.
    const canon = rules.find((r) => r.origin === 'canonical');
    assert.ok(canon);
    assert.ok(['active', 'proposed', 'archived'].includes(canon.status));
    const shown = showRule(ctx, 'prop-rule');
    assert.equal(shown.origin, 'local');
    assert.equal(shown.revision, 1);
    assert.equal(shown.status, 'proposed');
    // Mutations target local only: a canonical id has no overlay file.
    const canonId = canon.id;
    assert.throws(() => prepareFlipRule(ctx, canonId,
      { revision: 0 }, 'archived'),
      (e) => e.code === 'RULE_NOT_FOUND');
    assert.throws(() => showRule(ctx, 'nope-not-here'),
      (e) => e.code === 'RULE_NOT_FOUND');
  } finally { cleanup(dir); }
});

test('propose rejects catalog collisions, malformed and hostile inputs', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    // A canonical id can never be shadowed by an overlay file.
    writeFile(dir, 'd/evidence.md', '# Collision\n');
    assert.throws(() => prepareProposeRule(ctx,
      { input: 'd/evidence.md' }),
      (e) => e.code === 'RULE_ALREADY_EXISTS');
    // Reserved device names never reach the filesystem.
    writeFile(dir, 'd/con.md', '# Con\n');
    assert.throws(() => prepareProposeRule(ctx,
      { input: 'd/con.md', id: 'con' }),
      (e) => e.code === 'INVALID_VALUE');
    // An unclosed fence would persist a rule that never parses —
    // the product is validated before any write.
    writeFile(dir, 'd/broken.md', '---\nstatus: proposed\n# no close\n');
    assert.throws(() => prepareProposeRule(ctx,
      { input: 'd/broken.md' }),
      (e) => e.code === 'RULE_META_MALFORMED');
    // BOM + frontmatter: the flip must land on the fence, not a
    // phantom header — the rewrite is re-parsed to prove it.
    fs.writeFileSync(path.join(dir, 'd', 'bom.md'),
      '\uFEFF---\nstatus: proposed\n---\n# Bom\n');
    const made = applyProposeRule(ctx,
      { input: 'd/bom.md', id: 'bom-rule' });
    assert.equal(made.applied, true);
    const out = applyFlipRule(ctx, 'bom-rule',
      { revision: made.revision }, 'active');
    assert.equal(out.to, 'active');
    assert.equal(showRule(ctx, 'bom-rule').status, 'active');
  } finally { cleanup(dir); }
});

test('list/show fail closed on pinned-content drift', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    // Tamper a canonical rule's bytes after the catalog's sha256 was
    // pinned — list/show must refuse, exactly like getResource.
    const rel = '.scopegrain/rules/evidence.md';
    const abs = path.join(dir, rel);
    fs.appendFileSync(abs, '\ntampered\n');
    assert.throws(() => showRule(ctx, 'evidence'),
      (e) => e.code === 'RESOURCE_INTEGRITY_MISMATCH');
    assert.throws(() => listRules(ctx),
      (e) => e.code === 'RESOURCE_INTEGRITY_MISMATCH');
  } finally { cleanup(dir); }
});
