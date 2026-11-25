// SPDX-License-Identifier: Apache-2.0
// Rule metadata: bounded flat frontmatter parsing, closed key set,
// enum/shape validation, defaults for unfenced rules, and meta
// hydration through getResource (post-integrity, fail closed).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  defaultRuleMeta, parseRuleMeta, RULE_META_KEYS,
} from '../src/core/rule-meta.mjs';
import { getResource, loadCatalog } from '../src/core/catalog.mjs';
import {
  cleanup, makeCatalogFixture, makeTempDir, writeFile, writeJson,
} from './helpers.mjs';

const FM = (body) => `---\n${body}\n---\n# Rule\n`;

function fixture(files) {
  const dir = makeTempDir('rule-meta');
  const entries = Object.keys(files).map((f) => ({
    kind: 'rule', id: f.replace(/\.md$/, ''),
    path: `rules/${f}`, description: 'd',
  }));
  entries.push({ kind: 'profile', id: 'core', path: 'profiles/core.json',
    description: 'd' });
  makeCatalogFixture(dir, {
    entries,
    files: {
      ...Object.fromEntries(Object.entries(files)
        .map(([f, c]) => [`rules/${f}`, c])),
      'profiles/core.json': JSON.stringify({
        schemaVersion: 1, id: 'core', description: 'd',
        skills: [], rules: [], references: [],
        activation: 'explicit', externalServices: [],
      }),
    },
  });
  return dir;
}

test('unfenced rule parses to declared defaults', () => {
  const meta = parseRuleMeta('# Evidence — Rules\n\nbody\n', 'r');
  assert.deepEqual(meta, {
    category: null,
    status: 'active',
    origin: { source: 'canonical', evidenceRefs: [] },
    activation: null,
    enforcement: { level: 'advisory', verificationRef: null },
    examples: null,
  });
  assert.deepEqual(parseRuleMeta(''), defaultRuleMeta());
});

test('full frontmatter normalizes into the meta object', () => {
  const meta = parseRuleMeta(FM([
    'category: code-style',
    'status: proposed',
    'origin.source: auto-learned',
    'origin.evidenceRefs: op-1, lesson-9, op-1',
    'activation.globs: src/**/*.ts, docs/**',
    'activation.stacks: Node, rust',
    'activation.languages: typescript',
    'enforcement.level: strict',
    'enforcement.verificationRef: npm-test',
    'examples.good: const x: number = 1',
    'examples.bad: const x = 1',
    '# a comment line',
    '',
  ].join('\n')), 'r');
  assert.equal(meta.category, 'code-style');
  assert.equal(meta.status, 'proposed');
  assert.equal(meta.origin.source, 'auto-learned');
  assert.deepEqual(meta.origin.evidenceRefs, ['op-1', 'lesson-9']);
  assert.deepEqual(meta.activation, {
    globs: ['src/**/*.ts', 'docs/**'],
    stacks: ['node', 'rust'],
    languages: ['typescript'],
  });
  assert.deepEqual(meta.enforcement,
    { level: 'strict', verificationRef: 'npm-test' });
  assert.deepEqual(meta.examples,
    { good: 'const x: number = 1', bad: 'const x = 1' });
});

test('CRLF fences and quoted scalars parse identically', () => {
  const meta = parseRuleMeta(
    '---\r\nstatus: "archived"\r\n---\r\n# R\n', 'r');
  assert.equal(meta.status, 'archived');
});

test('closed key set and malformed lines fail closed', () => {
  const cases = [
    ['validator_cmd: npx tsc', /unknown frontmatter key/],
    ['enforcement.validatorCmd: x', /unknown frontmatter key/],
    ['status: active\nstatus: proposed', /duplicate frontmatter key/],
    ['status:', /must not be empty/],
    ['status: maybe', /active\|proposed\|archived/],
    ['enforcement.level: auto_fix', /advisory\|strict/],
    ['origin.source: mars', /origin\.source/],
    ['category: invented', /category/],
    ['activation.stacks:', /must not be empty/],
    ['enforcement.verificationRef: BAD ID', /id slug/],
    ['not a key line', /malformed frontmatter line/],
  ];
  for (const [body, re] of cases) {
    assert.throws(() => parseRuleMeta(FM(body), 'r'),
      (e) => e.code === 'RULE_META_MALFORMED' && re.test(e.message),
      `expected RULE_META_MALFORMED for: ${body}`);
  }
});

test('unclosed fence and oversized metadata are malformed', () => {
  assert.throws(() => parseRuleMeta('---\nstatus: active\n# no close\n',
    'r'), (e) => e.code === 'RULE_META_MALFORMED');
  assert.throws(() => parseRuleMeta(
    FM(`origin.evidenceRefs: ${'x'.repeat(400)}`), 'r'),
    (e) => e.code === 'RULE_META_MALFORMED');
  const many = Array.from({ length: 40 }, (_, i) => `f${i}.ts`).join(', ');
  assert.throws(() => parseRuleMeta(FM(`activation.globs: ${many}`), 'r'),
    (e) => e.code === 'RULE_META_MALFORMED');
});

test('getResource hydrates meta for rules only, after integrity', () => {
  const dir = fixture({
    'styled.md': FM('status: proposed\nactivation.globs: src/**'),
    'plain.md': '# plain\n',
  });
  try {
    const catalog = loadCatalog({ installRoot: dir });
    const styled = getResource('rule', 'styled', { catalog });
    assert.equal(styled.meta.status, 'proposed');
    assert.deepEqual(styled.meta.activation.globs, ['src/**']);
    const plain = getResource('rule', 'plain', { catalog });
    assert.equal(plain.meta.status, 'active');
    assert.equal(plain.meta.origin.source, 'canonical');
    const profile = getResource('profile', 'core', { catalog });
    assert.equal(profile.meta, undefined);
  } finally { cleanup(dir); }
});

test('malformed frontmatter on a served rule fails closed', () => {
  const dir = fixture({ 'bad.md': FM('status: bogus') });
  try {
    const catalog = loadCatalog({ installRoot: dir });
    assert.throws(() => getResource('rule', 'bad', { catalog }),
      (e) => e.code === 'RULE_META_MALFORMED');
  } finally { cleanup(dir); }
});

test('key surface stays closed and documented', () => {
  for (const k of ['enforcement.validatorCmd', 'enforcement.command',
    'autoFix', 'confidenceScore']) {
    assert.equal(RULE_META_KEYS.has(k), false,
      `${k} must stay outside the rule-meta contract`);
  }
});

test('a BOM before the fence still parses instead of degrading', () => {
  const meta = parseRuleMeta('\uFEFF' + FM('status: proposed'), 'r');
  assert.equal(meta.status, 'proposed');
});

test('closing fence must sit at end of line (---x cannot truncate)', () => {
  // `---note` is not a valid close: the block stays unclosed -> malformed.
  assert.throws(() => parseRuleMeta(
    '---\nstatus: active\n---note\n# R\n', 'r'),
    (e) => e.code === 'RULE_META_MALFORMED');
  // A fence closing at end-of-file is valid.
  assert.equal(parseRuleMeta('---\nstatus: archived\n---', 'r').status,
    'archived');
});

test('verificationRef normalizes to lowercase id slug', () => {
  const meta = parseRuleMeta(FM('enforcement.verificationRef: NPM-Test'),
    'r');
  assert.equal(meta.enforcement.verificationRef, 'npm-test');
});

test('list keys carry their own bounds, exempt from the scalar cap', () => {
  const refs = Array.from({ length: 5 },
    (_, i) => `run-${'x'.repeat(90)}-${i}`).join(', ');
  assert.ok(refs.length > 300);
  const meta = parseRuleMeta(FM(`origin.evidenceRefs: ${refs}`), 'r');
  assert.equal(meta.origin.evidenceRefs.length, 5);
});

test('snapshot path: integrity failure precedes meta parse', () => {
  const dir = makeTempDir('rule-meta-snap');
  try {
    const good = FM('status: proposed');
    writeFile(dir, 'rules/pinned.md', good);
    writeJson(dir, 'catalog.json', {
      schemaVersion: 2,
      entries: [{
        kind: 'rule', id: 'pinned', path: 'rules/pinned.md',
        description: 'd',
        sha256: crypto.createHash('sha256').update(good).digest('hex'),
      }],
      aliases: [],
    });
    // Hot path: metadata-only load; every serve re-hashes the bytes.
    const catalog = loadCatalog({
      installRoot: dir, manifestRel: 'catalog.json',
      verifyResources: false, snapshot: true,
    });
    // Tamper with malformed frontmatter: the integrity mismatch must
    // fire before the meta parser ever sees the bytes.
    writeFile(dir, 'rules/pinned.md', FM('status: bogus'));
    assert.throws(() => getResource('rule', 'pinned', { catalog }),
      (e) => e.code === 'RESOURCE_INTEGRITY_MISMATCH');
  } finally { cleanup(dir); }
});
