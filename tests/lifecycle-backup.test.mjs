// SPDX-License-Identifier: Apache-2.0
// Lifecycle: backup manifest/apply and restore preview/apply.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  applyBackup, applyRestore, prepareBackup, prepareRestore,
} from '../src/core/lifecycle.mjs';
import {
  cleanup, exists, makeTempDir, readJson,
  trySymlink, writeFile, writeJson,
} from './helpers.mjs';
import {
  configuredCtx, enroll, snapshot,
} from './helpers/lifecycle-fixture.mjs';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Backup walks only the config file, its discovery.json sibling and the
// seven declared artifact paths -- the generated catalog/resources live
// outside them even in a full init, so a config-only fixture exports the
// identical entry set (config.json, discovery.json, state/workspace.json,
// plans/p1.json).
const DISCOVERY = { schemaVersion: 1, stacks: [], evidence: [] };
function seeded({ discovery = true } = {}) {
  const { dir, ctx } = configuredCtx();
  enroll(ctx);
  if (discovery) writeJson(dir, '.tasksystem/discovery.json', DISCOVERY);
  writeFile(dir, '.tasksystem/plans/p1.json', '{}');
  writeFile(dir, 'notes.txt', 'not backed up');
  return { dir, ctx };
}

// ---------- backup ----------

test('backup preview hashes every exported entry, writes nothing', () => {
  const { dir, ctx } = seeded();
  try {
    const before = snapshot(dir);
    const preview = prepareBackup(ctx, { destination: 'backups/b1' });
    assert.deepEqual(snapshot(dir), before); // read-only
    assert.equal(preview.mode, 'dry-run');
    assert.equal(preview.destination, 'backups/b1');
    const rels = preview.entries.map((e) => e.rel);
    assert.ok(rels.includes('.tasksystem/config.json'));
    assert.ok(rels.includes('.tasksystem/discovery.json')); // config sibling
    assert.ok(rels.includes('.tasksystem/state/workspace.json'));
    assert.ok(rels.includes('.tasksystem/plans/p1.json'));
    assert.ok(!rels.includes('notes.txt')); // outside declared paths
    for (const e of preview.entries) {
      assert.match(e.sha256, /^[0-9a-f]{64}$/);
      assert.ok(Number.isSafeInteger(e.bytes) && e.bytes >= 0);
    }
    // sha is the real file hash
    const cfg = preview.entries.find((e) => e.rel === '.tasksystem/config.json');
    assert.equal(cfg.sha256, sha(
      fs.readFileSync(path.join(dir, '.tasksystem/config.json'))));
  } finally { cleanup(dir); }
});

test('backup destination validation rejects unsafe and overlapping paths', () => {
  const { dir, ctx } = seeded();
  try {
    assert.throws(() => prepareBackup(ctx, {}),
      (e) => e.code === 'LIFECYCLE_INVALID_INPUT');
    assert.throws(() => prepareBackup(ctx, { destination: 'x', extra: 1 }),
      (e) => e.code === 'LIFECYCLE_INVALID_INPUT');
    assert.throws(() => prepareBackup(ctx, { destination: '.git/b' }),
      (e) => e.code === 'RESERVED_PATH');
    assert.throws(() => prepareBackup(ctx, { destination: 'node_modules/b' }),
      (e) => e.code === 'RESERVED_PATH');
    assert.throws(() => prepareBackup(ctx, { destination: 'legacy/b' }),
      (e) => e.code === 'RESERVED_PATH');
    assert.throws(() => prepareBackup(ctx, { destination: '.opencode/b' }),
      (e) => e.code === 'RESERVED_PATH');
    assert.throws(() => prepareBackup(ctx, { destination: '../out' }),
      (e) => e.code === 'INVALID_PATH');
    assert.throws(() => prepareBackup(ctx, { destination: 'C:/abs' }),
      (e) => e.code === 'INVALID_PATH');
    // inside a scanned source dir -> self-inclusion rejected
    assert.throws(
      () => prepareBackup(ctx, { destination: '.tasksystem/state/inside' }),
      (e) => e.code === 'BACKUP_DESTINATION_OVERLAP');
    // ancestor of sources rejected too
    assert.throws(() => prepareBackup(ctx, { destination: '.tasksystem' }),
      (e) => e.code === 'BACKUP_DESTINATION_OVERLAP');
    // sibling of sources inside the harness dir is legal
    const ok = prepareBackup(ctx, { destination: '.tasksystem/backups/b1' });
    assert.equal(ok.destination, '.tasksystem/backups/b1');
    assert.equal(ok.mode, 'dry-run');
    assert.ok(!exists(dir, '.tasksystem/backups/b1')); // still nothing written
  } finally { cleanup(dir); }
});

test('backup apply writes a self-describing bundle, create-only', () => {
  const { dir, ctx } = seeded();
  try {
    const res = applyBackup(ctx, { destination: 'backups/b1' });
    assert.equal(res.mode, 'applied');
    assert.ok(exists(dir, 'backups/b1/manifest.json'));
    assert.ok(exists(dir, 'backups/b1/files/.tasksystem/config.json'));
    assert.ok(exists(dir, 'backups/b1/files/.tasksystem/discovery.json'));
    assert.ok(exists(dir, 'backups/b1/files/.tasksystem/state/workspace.json'));
    assert.ok(exists(dir, 'backups/b1/files/.tasksystem/plans/p1.json'));
    const manifest = readJson(dir, 'backups/b1/manifest.json');
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.kind, 'scopegrain-backup');
    assert.equal(manifest.source.configRel, '.tasksystem/config.json');
    assert.ok(manifest.entries.some(
      (e) => e.rel === '.tasksystem/discovery.json'));
    // payload bytes identical to sources
    assert.ok(fs.readFileSync(
      path.join(dir, 'backups/b1/files/.tasksystem/config.json'))
      .equals(fs.readFileSync(path.join(dir, '.tasksystem/config.json'))));
    // every manifest entry matches the payload hash
    for (const e of manifest.entries) {
      const payload = fs.readFileSync(
        path.join(dir, 'backups/b1/files', ...e.rel.split('/')));
      assert.equal(sha(payload), e.sha256);
      assert.equal(payload.length, e.bytes);
    }
    // create-only: second apply refuses, nothing overwritten
    assert.throws(() => applyBackup(ctx, { destination: 'backups/b1' }),
      (e) => e.code === 'PLAN_CONFLICT');
    // pre-existing bundle content blocks before any write
    writeFile(dir, 'backups/b2/manifest.json', 'occupied');
    assert.throws(() => applyBackup(ctx, { destination: 'backups/b2' }),
      (e) => e.code === 'PLAN_CONFLICT');
    assert.equal(fs.readFileSync(
      path.join(dir, 'backups/b2/manifest.json'), 'utf8'), 'occupied');
  } finally { cleanup(dir); }
});

test('an absent discovery.json is a skipped source, never a bundle gap', () => {
  const { dir, ctx } = seeded({ discovery: false });
  try {
    const preview = prepareBackup(ctx, { destination: 'backups/b1' });
    assert.ok(!preview.entries.some(
      (e) => e.rel === '.tasksystem/discovery.json'));
    assert.ok(preview.issues.some((i) =>
      i.code === 'BACKUP_SOURCE_SKIPPED'
      && i.rel === '.tasksystem/discovery.json'));
    // Bundle still exports and restores the rest.
    const res = applyBackup(ctx, { destination: 'backups/b1' });
    assert.equal(res.mode, 'applied');
    assert.ok(exists(dir, 'backups/b1/files/.tasksystem/config.json'));
  } finally { cleanup(dir); }
});

test('backup records symlinked entries as issues, never follows links', () => {
  const { dir, ctx } = seeded();
  try {
    writeFile(dir, '.tasksystem/plans/real.json', '{}');
    const linked = trySymlink(
      path.join(dir, 'notes.txt'),
      path.join(dir, '.tasksystem/plans/link.txt'), 'file');
    if (!linked) return; // platform denied symlink creation
    const preview = prepareBackup(ctx, { destination: 'backups/b1' });
    assert.ok(!preview.entries.some((e) => e.rel === '.tasksystem/plans/link.txt'));
    assert.ok(preview.issues.some((i) => i.rel === '.tasksystem/plans/link.txt'));
  } finally { cleanup(dir); }
});

// ---------- restore ----------

test('restore preview classifies create/skip/conflict, apply restores only creates', () => {
  const { dir, ctx } = seeded();
  try {
    applyBackup(ctx, { destination: 'backups/b1' });
    const before = snapshot(dir);
    const preview = prepareRestore(dir, 'backups/b1');
    assert.deepEqual(snapshot(dir), before); // read-only
    assert.equal(preview.mode, 'dry-run');
    // everything identical at first
    assert.ok(preview.entries.every((e) => e.action === 'skip'
      && e.reason === 'identical'));

    fs.rmSync(path.join(dir, '.tasksystem/plans/p1.json'));
    fs.rmSync(path.join(dir, '.tasksystem/discovery.json'));
    writeFile(dir, '.tasksystem/config.json', '{"tampered":true}');
    const p2 = prepareRestore(dir, 'backups/b1');
    assert.equal(p2.entries.find((e) => e.rel === '.tasksystem/plans/p1.json')
      .action, 'create');
    assert.equal(p2.entries.find(
      (e) => e.rel === '.tasksystem/discovery.json').action, 'create');
    assert.equal(p2.entries.find((e) => e.rel === '.tasksystem/config.json')
      .action, 'conflict');

    const res = applyRestore(dir, 'backups/b1');
    assert.equal(res.mode, 'applied');
    assert.ok(res.restored.includes('.tasksystem/plans/p1.json'));
    assert.ok(res.restored.includes('.tasksystem/discovery.json'));
    assert.ok(res.conflicts.some((c) => c.rel === '.tasksystem/config.json'));
    // conflict never merged/overwritten
    assert.equal(fs.readFileSync(
      path.join(dir, '.tasksystem/config.json'), 'utf8'), '{"tampered":true}');
    assert.equal(fs.readFileSync(
      path.join(dir, '.tasksystem/plans/p1.json'), 'utf8'), '{}');
    assert.deepEqual(
      readJson(dir, '.tasksystem/discovery.json'), DISCOVERY);
  } finally { cleanup(dir); }
});

test('restore skips tampered payloads and self-referential entries', () => {
  const { dir, ctx } = seeded();
  try {
    applyBackup(ctx, { destination: 'backups/b1' });
    // tamper one payload in the bundle
    writeFile(dir, 'backups/b1/files/.tasksystem/plans/p1.json', 'corrupted');
    fs.rmSync(path.join(dir, '.tasksystem/plans/p1.json'));
    const preview = prepareRestore(dir, 'backups/b1');
    const entry = preview.entries.find(
      (e) => e.rel === '.tasksystem/plans/p1.json');
    assert.equal(entry.action, 'skip');
    assert.equal(entry.reason, 'payload-hash-mismatch');
    const res = applyRestore(dir, 'backups/b1');
    assert.ok(!res.restored.includes('.tasksystem/plans/p1.json'));
    assert.ok(!exists(dir, '.tasksystem/plans/p1.json'));

    // crafted manifest entry targeting inside the bundle -> self-referential
    const payload = Buffer.from('payload');
    writeFile(dir, 'backups/b2/files/backups/b2/files/evil', payload);
    writeJson(dir, 'backups/b2/manifest.json', {
      schemaVersion: 1, kind: 'scopegrain-backup',
      createdAt: '2026-11-17T00:00:00.000Z',
      source: { configRel: '.tasksystem/config.json' },
      entries: [{
        rel: 'backups/b2/files/evil',
        sha256: sha(payload), bytes: payload.length,
      }],
    });
    const p3 = prepareRestore(dir, 'backups/b2');
    assert.equal(p3.entries[0].action, 'skip');
    assert.equal(p3.entries[0].reason, 'self-referential');
  } finally { cleanup(dir); }
});

test('restore validates bundle presence and manifest shape', () => {
  const dir = makeTempDir('restore-missing');
  try {
    assert.throws(() => prepareRestore(dir, 'nope/bundle'),
      (e) => e.code === 'RESTORE_BUNDLE_MISSING');
    writeFile(dir, 'bundles/notdir', 'x');
    assert.throws(() => prepareRestore(dir, 'bundles/notdir'),
      (e) => e.code === 'RESTORE_BUNDLE_NOT_DIR');
    fs.mkdirSync(path.join(dir, 'bundles/empty'), { recursive: true });
    assert.throws(() => prepareRestore(dir, 'bundles/empty'),
      (e) => e.code === 'RESTORE_MANIFEST_MISSING');
    writeFile(dir, 'bundles/empty/manifest.json', '{corrupt');
    assert.throws(() => prepareRestore(dir, 'bundles/empty'),
      (e) => e.code === 'RESTORE_MANIFEST_MALFORMED');
    writeJson(dir, 'bundles/empty/manifest.json', {
      schemaVersion: 1, kind: 'wrong-kind', entries: [],
    });
    assert.throws(() => prepareRestore(dir, 'bundles/empty'),
      (e) => e.code === 'RESTORE_MANIFEST_MALFORMED');
    writeJson(dir, 'bundles/empty/manifest.json', {
      schemaVersion: 1, kind: 'scopegrain-backup',
      createdAt: '2026-11-17T00:00:00.000Z', source: {},
      entries: [
        { rel: '../escape', sha256: 'a'.repeat(64), bytes: 1 },
      ],
    });
    assert.throws(() => prepareRestore(dir, 'bundles/empty'),
      (e) => e.code === 'RESTORE_ENTRY_INVALID');
    writeJson(dir, 'bundles/empty/manifest.json', {
      schemaVersion: 1, kind: 'scopegrain-backup', entries: [],
    });
    assert.throws(() => prepareRestore(dir, 'bundles/empty'),
      (e) => e.code === 'RESTORE_MANIFEST_MALFORMED');
  } finally { cleanup(dir); }
});
