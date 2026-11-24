// SPDX-License-Identifier: Apache-2.0
// Property-based / metamorphic tests for the pure parsers:
//   * canonicalJSON (src/core/digests.mjs): output is a fixed point
//     (encode(parse(encode(v))) === encode(v)), insensitive to object
//     key insertion order at every depth, and round-trips the value.
//   * risk-assess (src/discovery/risk-assess.mjs): provably-neutral
//     diff content (passive .md files with plain text) never changes
//     the tier when added, and never LOWERS it when removed —
//     fail-closed monotonicity. File/line order is irrelevant.
// Fixed seeds + bounded numRuns keep CI deterministic (fast-check).
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { canonicalJSON, canonicalDigest } from '../src/core/digests.mjs';
import { classifyRisk, parseUnifiedDiff }
  from '../src/discovery/risk-assess.mjs';

// --- canonicalJSON --------------------------------------------------------

// Recursively rebuilds a JSON value with every object key order
// shuffled by the supplied PRNG — the strongest key-order perturbation.
function shuffleKeys(value, rand) {
  if (Array.isArray(value)) {
    return value.map((item) => shuffleKeys(item, rand));
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    for (let i = entries.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    return Object.fromEntries(entries.map(
      ([k, v]) => [k, shuffleKeys(v, rand)]));
  }
  return value;
}

// JSON deep equality modulo object key order.
function jsonEqual(a, b) {
  if (typeof a !== 'object' || a === null || typeof b !== 'object'
      || b === null) {
    return Object.is(a, b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((item, i) => jsonEqual(item, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length
    && ka.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]));
}

const jsonArb = fc.jsonValue({ maxDepth: 5 });

test('PBT: canonicalJSON is deterministic, idempotent and key-order invariant', () => {
  fc.assert(fc.property(jsonArb, fc.integer(), (value, seed) => {
    const first = canonicalJSON(value);
    // Idempotency: encoding the decoded output is a fixed point.
    const decoded = JSON.parse(first);
    assert.equal(canonicalJSON(decoded), first);
    // Round-trip: the canonical text decodes back to the same value.
    assert.ok(jsonEqual(decoded, JSON.parse(JSON.stringify(value))),
      'canonicalJSON must preserve the JSON value');
    // Key-order invariance at every depth (seeded shuffle).
    let s = seed >>> 0;
    const rand = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const shuffled = shuffleKeys(value, rand);
    assert.equal(canonicalJSON(shuffled), first,
      'key insertion order must not affect canonical output');
    assert.equal(canonicalDigest(shuffled), canonicalDigest(value));
  }), { numRuns: 80, seed: 0xfeed });
});

test('PBT: canonicalJSON rejects non-JSON values with INVALID_JSON_VALUE', () => {
  const bad = fc.oneof(
    fc.constantFrom(undefined, Symbol('s'), () => {}, 10n, new Date(),
      new Map(), new Set(), { get x() { return 1; } }, Math),
    fc.integer().map((n) => {
      const cyclic = { n };
      cyclic.self = cyclic;
      return cyclic;
    }),
  );
  fc.assert(fc.property(bad, (value) => {
    assert.throws(() => canonicalJSON(value),
      (e) => e.code === 'INVALID_JSON_VALUE');
  }), { numRuns: 40, seed: 0xfeed });
});

// --- risk-assess metamorphic ---------------------------------------------
//
// A "neutral" file is provably passive: a .md path under docs/ whose
// added lines are plain prose. classifyRisk can only keep the tier or
// fail closed higher — adding such a file to a NON-EMPTY diff never
// changes the tier; removing one never lowers it (an emptied diff is
// undecidable -> high, which still satisfies non-decreasing).

const TIER_RANK = { passive: 0, medium: 1, high: 2 };

const diff = (file) => {
  const lines = [`diff --git a/${file.path} b/${file.path}`];
  if (file.mode) lines.push(`new mode ${file.mode}`);
  if (file.binary) lines.push('Binary files a/x and b/x differ');
  lines.push(`--- a/${file.path}`, `+++ b/${file.path}`,
    `@@ -1,${file.removed + 1} +1,${file.added.length + 1} @@`);
  lines.push(' ctx');
  for (let i = 0; i < file.removed; i += 1) lines.push(`-old ${i}`);
  for (const a of file.added) lines.push(`+${a}`);
  return lines.join('\n');
};

const neutralFile = (i) => ({
  path: `docs/neutral/notes-${i}.md`,
  added: ['a line of plain prose', 'more documentation'],
  removed: 0,
});

const fileArb = fc.record({
  path: fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom(
      'docs/guide.md', 'README.md', 'docs/wiki/page.txt',
      'CHANGELOG.md', 'LICENSE') },
    { weight: 4, arbitrary: fc.constantFrom(
      'src/app.js', 'src/util/helper.ts', 'lib/core.py',
      'pkg/main.go', 'index.js') },
    { weight: 2, arbitrary: fc.constantFrom(
      'src/auth/token.js', 'policy/rules.json', 'secrets/keys.pem',
      'deploy/Dockerfile', 'migrations/001.sql',
      'resources/manifest.json', '.github/workflows/ci.yml',
      'scripts/setup.sh') },
  ),
  added: fc.array(fc.oneof(
    { weight: 5, arbitrary: fc.constantFrom(
      'const x = 1;', 'let y = add(a, b);', 'return value;',
      'plain comment line', 'const z = arr.map(f);') },
    { weight: 1, arbitrary: fc.constantFrom(
      "const p = child_process.spawn('git');", 'eval(input);',
      'new Function("x", "return x")', 'Promise.all(tasks);',
      'yaml.load(raw);', 'chmod 777 /tmp/x') },
  ), { minLength: 0, maxLength: 4 }),
  removed: fc.integer({ min: 0, max: 3 }),
  mode: fc.constantFrom(null, '100644', '100755'),
  binary: fc.constantFrom(false, true),
});

const specArb = fc.array(fileArb, { minLength: 1, maxLength: 4 });
const buildDiff = (files) => files.map(diff).join('\n');
const tierOf = (files) => classifyRisk(parseUnifiedDiff(buildDiff(files))).risk;

test('PBT: adding a neutral passive file never changes the tier', () => {
  fc.assert(fc.property(specArb, fc.integer({ min: 0, max: 3 }),
    (files, insertAt) => {
      const before = tierOf(files);
      const idx = Math.min(insertAt, files.length);
      const extended = [...files.slice(0, idx), neutralFile(0),
        ...files.slice(idx)];
      const after = tierOf(extended);
      assert.equal(after, before,
        `tier changed ${before} -> ${after} by adding a passive .md file`);
    }), { numRuns: 80, seed: 0xdeed });
});

test('PBT: removing a neutral file never lowers the tier', () => {
  const withNeutral = specArb.map((files) => [...files, neutralFile(0)]);
  fc.assert(fc.property(withNeutral, fc.integer({ min: 0, max: 8 }),
    (files, dropIdx) => {
      const neutralIdx = files.findIndex(
        (f) => f.path.startsWith('docs/neutral/'));
      const before = tierOf(files);
      const rest = files.filter((_, i) => i !== neutralIdx);
      const after = tierOf(rest);
      assert.ok(TIER_RANK[after] >= TIER_RANK[before],
        `tier dropped ${before} -> ${after} after removing neutral file`);
      // Re-adding it back anywhere restores the original tier.
      const idx = Math.min(dropIdx, rest.length);
      const restored = [...rest.slice(0, idx), files[neutralIdx],
        ...rest.slice(idx)];
      assert.equal(tierOf(restored), before);
    }), { numRuns: 80, seed: 0xdeed });
});

test('PBT: file order and added-line order do not affect the tier', () => {
  const seededShuffle = (arr, seed) => {
    const out = [...arr];
    let s = seed >>> 0;
    const rand = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  fc.assert(fc.property(specArb, fc.integer(), (files, seed) => {
    const base = classifyRisk(parseUnifiedDiff(buildDiff(files)));
    const reorderedFiles = seededShuffle(files, seed);
    const reordered = reorderedFiles.map(
      (f) => ({ ...f, added: seededShuffle(f.added, seed + 1) }));
    const other = classifyRisk(parseUnifiedDiff(buildDiff(reordered)));
    assert.equal(other.risk, base.risk);
    assert.equal(other.changed_lines, base.changed_lines);
    assert.deepEqual(
      other.reasons.map((r) => r.signal).sort(),
      base.reasons.map((r) => r.signal).sort());
    assert.deepEqual(
      [...other.changed_paths].sort(), [...base.changed_paths].sort());
  }), { numRuns: 60, seed: 0xbead });
});
