// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MANAGED_BEGIN, MANAGED_END, hasManagedSection, managedBody,
  managedEquals, upsertManaged, wrapManaged,
} from '../src/core/managed-section.mjs';
import {
  applyUpdate, prepareUpdate,
} from '../src/core/lifecycle.mjs';
import {
  bootstrappedCtx, cleanup, writeFile, VALID_ANSWERS,
} from './helpers.mjs';

test('wrapManaged produces a BEGIN/body/END block', () => {
  const out = wrapManaged('hello');
  assert.equal(out, `${MANAGED_BEGIN}\nhello\n${MANAGED_END}\n`);
});

test('managedBody extracts inner bytes; null without markers', () => {
  assert.equal(managedBody(wrapManaged('a\nb')), 'a\nb');
  assert.equal(managedBody('no markers'), null);
});

test('upsertManaged replaces only inside both markers', () => {
  const doc = `top\n${wrapManaged('old')}bottom\n`;
  const out = upsertManaged(doc, 'new');
  assert.equal(out, `top\n${MANAGED_BEGIN}\nnew\n${MANAGED_END}\nbottom\n`);
});

test('upsertManaged appends when no markers exist', () => {
  const out = upsertManaged('user text\n', 'gen');
  assert.ok(out.startsWith('user text\n'));
  assert.ok(out.includes(MANAGED_BEGIN));
  assert.ok(out.includes('gen'));
});

test('upsertManaged handles dangling BEGIN (owns to EOF)', () => {
  const doc = `pre\n${MANAGED_BEGIN}\nstale\n`;
  const out = upsertManaged(doc, 'fresh');
  assert.equal(out, `pre\n${MANAGED_BEGIN}\nfresh\n${MANAGED_END}\n`);
});

test('upsertManaged handles END-only (inserts before it)', () => {
  const doc = `pre\n${MANAGED_END}\npost\n`;
  const out = upsertManaged(doc, 'fresh');
  assert.equal(out, `pre\n${MANAGED_BEGIN}\nfresh\n${MANAGED_END}\npost\n`);
});

test('managedEquals strips trailing newlines on both sides', () => {
  assert.ok(managedEquals(wrapManaged('x\n\n'), 'x'));
  assert.ok(!managedEquals(wrapManaged('x'), 'y'));
});

test('bootstrapped AGENTS.md/CLAUDE.md carry managed markers', () => {
  const { dir } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    const claude = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.ok(hasManagedSection(agents));
    assert.ok(hasManagedSection(claude));
  } finally {
    cleanup(dir);
  }
});

test('update refreshes managed region and preserves user bytes', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const p = path.join(dir, 'AGENTS.md');
    const original = fs.readFileSync(p, 'utf8');
    // User content outside markers + stale content inside.
    const stale = `USER NOTES\n${original.replace(managedBody(original), 'STALE')}`;
    fs.writeFileSync(p, stale);
    const dry = prepareUpdate(ctx, {});
    const entry = dry.files.find((f) => f.rel === 'AGENTS.md');
    assert.equal(entry.action, 'managed');
    const res = applyUpdate(ctx, {});
    assert.ok(res.managed.includes('AGENTS.md'));
    const after = fs.readFileSync(p, 'utf8');
    assert.ok(after.startsWith('USER NOTES\n'));
    assert.ok(!after.includes('STALE'));
    assert.equal(managedBody(after), managedBody(original));
  } finally {
    cleanup(dir);
  }
});

test('update reports noop when managed region already matches', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const p = path.join(dir, 'AGENTS.md');
    const original = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, `user intro\n${original}`); // outside bytes differ
    const dry = prepareUpdate(ctx, {});
    const entry = dry.files.find((f) => f.rel === 'AGENTS.md');
    assert.equal(entry.action, 'noop');
  } finally {
    cleanup(dir);
  }
});

test('diverged root file without markers stays conflict with remediation', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    writeFile(dir, 'AGENTS.md', 'completely user owned\n');
    const dry = prepareUpdate(ctx, {});
    const c = dry.conflicts.find((x) => x.path === 'AGENTS.md');
    assert.ok(c, 'expected conflict entry');
    assert.ok(c.remediation.includes('SCOPEGRAIN'));
  } finally {
    cleanup(dir);
  }
});
