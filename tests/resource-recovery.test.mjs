// SPDX-License-Identifier: Apache-2.0
// Resource recovery: diagnose, restore-plan CAS, apply, conflicts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  applyResourceRestore, diagnoseResource, findResources,
  prepareResourceRestore,
} from '../src/core/resource-recovery.mjs';
import { trySymlink } from './helpers.mjs';
import { bootstrappedCtx, cleanup } from './helpers.mjs';

const target = '.tasksystem/commands/plan-work.md';

function hashOf(f) {
  return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
}

test('find + diagnose healthy/missing/drift', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const found = findResources(ctx, { kind: 'command', query: 'plan' });
    assert.ok(found.entries.some((e) => e.id === 'plan-work'));
    const abs = `${dir}/${target}`;
    const d0 = diagnoseResource(ctx, { kind: 'command', id: 'plan-work' });
    assert.equal(d0.status, 'healthy');
    const orig = fs.readFileSync(abs);
    fs.rmSync(abs);
    assert.equal(diagnoseResource(ctx,
      { kind: 'command', id: 'plan-work' }).status, 'missing');
    fs.writeFileSync(abs, orig);
    fs.appendFileSync(abs, 'x');
    assert.equal(diagnoseResource(ctx,
      { kind: 'command', id: 'plan-work' }).status, 'drift');
    fs.writeFileSync(abs, orig);
  } finally { cleanup(dir); }
});

test('restore-plan: missing -> create, identical -> noop, CAS conflicts', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const abs = `${dir}/${target}`;
    const orig = fs.readFileSync(abs);
    const snapshotHash = hashOf(abs);
    fs.rmSync(abs);
    const plan = prepareResourceRestore(ctx, {
      kind: 'command', id: 'plan-work', expectedCurrentHash: null,
    });
    assert.equal(plan.action, 'create');
    assert.equal(plan.files.length, 1);
    // Apply restores snapshot-pinned bytes.
    const applied = applyResourceRestore(ctx, {
      kind: 'command', id: 'plan-work', expectedCurrentHash: null,
    });
    assert.equal(applied.action, 'created');
    assert.equal(hashOf(abs), snapshotHash);
    // Identical target -> noop.
    const noop = prepareResourceRestore(ctx, {
      kind: 'command', id: 'plan-work', expectedCurrentHash: snapshotHash,
    });
    assert.equal(noop.action, 'noop');
    // Wrong expectedCurrentHash -> conflict, bytes untouched.
    fs.appendFileSync(abs, 'x');
    const before = fs.readFileSync(abs);
    assert.throws(() => prepareResourceRestore(ctx, {
      kind: 'command', id: 'plan-work', expectedCurrentHash: snapshotHash,
    }), (e) => e.code === 'RESOURCE_RESTORE_CONFLICT');
    assert.ok(fs.readFileSync(abs).equals(before));
    fs.writeFileSync(abs, orig);
  } finally { cleanup(dir); }
});

test('version-unavailable when install SHA differs; link/sentinel rejected', (t) => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const abs = `${dir}/${target}`;
    const orig = fs.readFileSync(abs);
    // Foreign file where the resource should be.
    fs.rmSync(abs);
    fs.mkdirSync(`${dir}/.tasksystem/foreign`, { recursive: true });
    fs.writeFileSync(`${dir}/.tasksystem/foreign/x`, 'x');
    if (trySymlink(`${dir}/.tasksystem/foreign`, abs)) {
      assert.throws(() => prepareResourceRestore(ctx, {
        kind: 'command', id: 'plan-work', expectedCurrentHash: null,
      }), (e) => e.code === 'RESOURCE_RESTORE_CONFLICT');
      fs.rmSync(abs);
    } else {
      t.skip('symlinks unsupported');
    }
    fs.writeFileSync(abs, orig);
  } finally { cleanup(dir); }
});

test('diagnose ranks probable alternatives and hints the action', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const abs = `${dir}/${target}`;
    const orig = fs.readFileSync(abs);
    fs.rmSync(abs);
    const d = diagnoseResource(ctx, { kind: 'command', id: 'plan-work' });
    assert.equal(d.status, 'missing');
    assert.equal(typeof d.hint, 'string');
    assert.ok(Array.isArray(d.suggestions) && d.suggestions.length > 0);
    const top = d.suggestions[0];
    assert.equal(top.id, 'plan-work'); // same-id/same-kind scores highest
    assert.ok(top.score > 0 && Array.isArray(top.reasons));
    assert.ok(top.reasons.includes('same-kind'));
    fs.writeFileSync(abs, orig);
    // Unknown id still fails closed, but the error names near matches.
    assert.throws(
      () => diagnoseResource(ctx, { kind: 'command', id: 'plan-wrok' }),
      (e) => e.code === 'CATALOG_UNKNOWN_ID'
        && e.message.includes('did you mean')
        && e.message.includes('plan-work'));
  } finally { cleanup(dir); }
});
