// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  findPlaceholders, renderPlaceholders, scriptFromFrontmatter,
} from '../src/core/placeholders.mjs';
import { parseJsonc, deepMerge, stripJsonComments } from '../src/core/jsonc.mjs';
import { installHelper, listHelpers } from '../src/core/helpers.mjs';
import { loadHooksPolicy, hooksFor } from '../src/core/hooks-policy.mjs';
import { hostManifest } from '../src/hosts/host-manifest.mjs';
import { KNOWN_HOSTS } from '../src/core/config.mjs';
import {
  bootstrappedCtx, cleanup, writeFile, VALID_ANSWERS,
} from './helpers.mjs';

test('C1 placeholders: args, script and handoff tokens render', () => {
  const body = 'Run $ARGUMENTS via {SCRIPT} then __X_COMMAND_NEXT_STEP__.';
  const out = renderPlaceholders(body,
    { arguments: 'foo', script: 'scripts/x.sh' });
  assert.equal(out,
    'Run foo via scripts/x.sh then workflow next-step.');
  const inv = findPlaceholders(body);
  assert.ok(inv.arguments && inv.script);
  assert.deepEqual(inv.handoffs, ['NEXT_STEP']);
  assert.throws(() => renderPlaceholders('use {SCRIPT}'),
    (e) => e.code === 'UNRESOLVED_PLACEHOLDER');
});

test('C1 script token resolves from frontmatter when not supplied', () => {
  const body = '---\nname: c\nscript: "scripts/h.sh"\n---\nrun {SCRIPT}\n';
  assert.equal(scriptFromFrontmatter(body), 'scripts/h.sh');
  assert.ok(renderPlaceholders(body).includes('scripts/h.sh'));
});

test('C6 jsonc: comments stripped outside strings; deepMerge recurses', () => {
  const src = '{\n // c\n "a": {"b": 1, "c": 2}, /* x */ "s": "http://x" }';
  const doc = parseJsonc(src);
  assert.equal(doc.s, 'http://x');
  const merged = deepMerge({ a: { b: 1, c: 2 }, l: [1] },
    { a: { c: 9 }, l: [2] });
  assert.deepEqual(merged, { a: { b: 1, c: 9 }, l: [2] });
  // comment-like text inside strings survives
  assert.equal(stripJsonComments('"a//b"').trim(), '"a//b"');
});

test('C5 helpers: install copies + manifest; tamper detected', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    writeFile(dir, 'tools/helper.sh', '#!/bin/sh\necho hi\n');
    const h = installHelper(ctx, {
      id: 'my-helper', source: 'tools/helper.sh', runtime: 'sh',
    });
    assert.equal(h.runtime, 'sh');
    assert.ok(h.sha256.length === 64);
    const listed = listHelpers(ctx);
    assert.equal(listed[0].status, 'ok');
    // Tamper with the installed copy
    const dest = path.join(dir, h.file);
    fs.writeFileSync(dest, 'corrupted\n');
    assert.equal(listHelpers(ctx)[0].status, 'tampered');
    // Duplicate id rejected
    assert.throws(() => installHelper(ctx, {
      id: 'my-helper', source: 'tools/helper.sh', runtime: 'sh',
    }), /CONFLICT|already/);
  } finally { cleanup(dir); }
});

test('C2 hooks policy: empty policy valid; hooksFor merges * then cmd', () => {
  const { dir } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const p = loadHooksPolicy();
    assert.deepEqual(p, { before: {}, after: {} });
    // Inject a fixture policy through a temp install root
    const ir = path.join(dir, 'ir');
    fs.mkdirSync(path.join(ir, 'policy'), { recursive: true });
    fs.writeFileSync(path.join(ir, 'policy/hooks.json'), JSON.stringify({
      schemaVersion: 1, hooks: {
        before: { '*': [{ id: 'g1', description: 'global' }] },
        after: { 'implement-task': [{ id: 'a1', description: 'specific' }] },
      },
    }));
    const h = hooksFor('implement-task', { installRoot: ir });
    assert.equal(h.before.length, 1);
    assert.equal(h.after.length, 1);
    assert.equal(h.after[0].id, 'a1');
  } finally { cleanup(dir); }
});

test('C3/C4 host manifest: generic host registered + ownership labels', () => {
  assert.ok(KNOWN_HOSTS.includes('generic'));
  const { dir, ctx } = bootstrappedCtx(
    { ...VALID_ANSWERS, hosts: ['claude'] });
  try {
    const m = hostManifest(ctx, { host: 'claude' });
    assert.equal(m.host, 'claude');
    assert.ok(Array.isArray(m.generated));
    for (const g of m.generated) {
      assert.match(g.sha256, /^[0-9a-f]{64}$/);
      assert.ok(['whole', 'partial'].includes(g.ownership));
    }
    for (const s of m.shared) assert.equal(s.ownership, 'shared');
  } finally { cleanup(dir); }
});
