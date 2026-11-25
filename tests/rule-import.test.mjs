// SPDX-License-Identifier: Apache-2.0
// Rule import: external instruction files segment by headings into
// local Status:Proposed drafts — unidirectional, hash-deduped, never
// executed, never overwriting.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  prepareImportRules, applyImportRules, showRule,
} from '../src/core/rules.mjs';
import { parseRuleMeta } from '../src/core/rule-meta.mjs';
import {
  bootstrappedCtx, cleanup, writeFile,
} from './helpers.mjs';

const SAMPLE = [
  '# Repo Guide',
  '',
  'General notes about the repo layout.',
  '',
  '## Code Style',
  '',
  '- always run lint before pushing',
  '- prefer small functions',
  '',
  '## Commits',
  '',
  '- conventional commit messages',
  '- never force-push to main',
  '',
].join('\n');

function srcPath(ctx, rel, content) {
  const dir = path.join(ctx.projectRoot, ctx.configDir);
  writeFile(dir, rel, content);
  return `${ctx.configDir}/${rel}`;
}

test('import segments a file by headings into proposed drafts', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const from = srcPath(ctx, 'AGENTS.md', SAMPLE);
    const dry = prepareImportRules(ctx, { from });
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.applied, false);
    assert.equal(dry.sections, 3);
    assert.deepEqual(
      dry.create.map((c) => c.id),
      ['repo-guide', 'code-style', 'commits']);
    // Dry-run writes nothing.
    assert.ok(!fs.existsSync(
      path.join(dir, ctx.configDir, 'rules/local')));

    const res = applyImportRules(ctx, { from });
    assert.equal(res.applied, true);
    assert.equal(res.created.length, 3);
    for (const c of res.created) {
      const body = fs.readFileSync(
        path.join(dir, c.rel), 'utf8');
      const meta = parseRuleMeta(body, c.id, { source: 'local' });
      assert.equal(meta.status, 'proposed');
      assert.equal(meta.origin.source, 'imported');
    }
    // Imported sections keep their heading text in the draft body.
    const shown = showRule(ctx, 'code-style');
    assert.ok(shown.content.includes('prefer small functions'));
    // Unidirectional: the source file is byte-identical afterwards.
    assert.equal(
      fs.readFileSync(path.join(dir, from), 'utf8'), SAMPLE);
  } finally { cleanup(dir); }
});

test('re-import is idempotent by content hash', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const from = srcPath(ctx, 'AGENTS.md', SAMPLE);
    applyImportRules(ctx, { from });
    const again = applyImportRules(ctx, { from });
    assert.equal(again.created.length, 0);
    assert.equal(again.skipped.length, 3);
    assert.ok(again.skipped.every((s) => s.reason === 'unchanged'));
  } finally { cleanup(dir); }
});

test('headingless file becomes a single draft named by the stem', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const from = srcPath(ctx, '.cursorrules',
      'use tabs not spaces\nkeep functions under 50 lines\n');
    const res = applyImportRules(ctx, { from });
    assert.equal(res.sections, 1);
    assert.equal(res.created[0].id, 'cursorrules');
  } finally { cleanup(dir); }
});

test('duplicate headings suffix; canonical ids and conflicts skip', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const from = srcPath(ctx, 'NOTES.md', [
      '## Safety',
      'first safety section (collides with canonical rule id)',
      '## Safety',
      'second safety section',
      '## Style',
      'style section one',
    ].join('\n'));
    const res = applyImportRules(ctx, { from });
    // 'safety' collides with the canonical rule id; its suffixed
    // sibling does too (safety-2 is free, so both map honestly).
    const collision = res.skipped.filter(
      (s) => s.reason === 'collides with catalog id');
    assert.equal(collision.length, 1);
    assert.equal(collision[0].id, 'safety');
    assert.ok(res.created.some((c) => c.id === 'safety-2'));
    assert.ok(res.created.some((c) => c.id === 'style'));

    // A local file with different bytes under a slug the source maps
    // to reports 'conflict', never overwrite.
    writeFile(path.join(ctx.projectRoot, ctx.configDir),
      'rules/local/style.md',
      '---\nstatus: proposed\n---\n# Style\nhand-edited variant\n');
    const second = applyImportRules(ctx, { from });
    assert.ok(second.skipped.some((s) =>
      s.id === 'style' && s.reason === 'conflict'));
    const body = fs.readFileSync(
      path.join(dir, ctx.configDir, 'rules/local/style.md'), 'utf8');
    assert.ok(body.includes('hand-edited variant'));
  } finally { cleanup(dir); }
});

test('fenced `#` lines are not headings; BOM does not hide the first', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const from = srcPath(ctx, 'FENCED.md', [
      '# Guide',
      '```',
      '# this is a shell comment, not a section',
      '```',
      '## Real Section',
      'body',
    ].join('\n'));
    const res = applyImportRules(ctx, { from });
    assert.deepEqual(res.created.map((c) => c.id),
      ['guide', 'real-section']);

    const bom = '\uFEFF' + '# Titled\nbody\n';
    const fromBom = srcPath(ctx, 'BOM.md', bom);
    const resBom = applyImportRules(ctx, { from: fromBom });
    assert.deepEqual(resBom.created.map((c) => c.id), ['titled']);
  } finally { cleanup(dir); }
});

test('hostile inputs: traversal, empty, section cap', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    assert.throws(
      () => prepareImportRules(ctx, { from: '../outside.md' }),
      (e) => e.code === 'INVALID_PATH');
    const empty = srcPath(ctx, 'EMPTY.md', '   \n\n');
    assert.throws(
      () => prepareImportRules(ctx, { from: empty }),
      (e) => e.code === 'INVALID_VALUE');
    const many = srcPath(ctx, 'MANY.md',
      Array.from({ length: 40 }, (_, i) => `## S${i}\nbody\n`)
        .join('\n'));
    assert.throws(
      () => prepareImportRules(ctx, { from: many }),
      (e) => e.code === 'INVALID_VALUE');
  } finally { cleanup(dir); }
});
