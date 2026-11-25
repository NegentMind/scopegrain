// SPDX-License-Identifier: Apache-2.0
// Local rules overlay: rules/local/*.md merge into the workspace
// catalog as un-pinned entries (overlay:'local'), Status header or
// frontmatter governs lifecycle, collisions fail loudly, doctor
// reports the count.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { getResource, loadWorkspaceCatalog } from '../src/core/catalog.mjs';
import { runDoctor } from '../src/core/doctor.mjs';
import {
  bootstrappedCtx, cleanup, makeTempDir, VALID_ANSWERS, writeFile,
  writeJson,
} from './helpers.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Minimal snapshot workspace: catalog.json + one canonical rule + one
// command, everything sha-pinned like a real projection.
function fixture({ local = {} } = {}) {
  const dir = makeTempDir('catalog-overlay');
  const conf = path.join(dir, '.scopegrain');
  const canonBody = '# Canonical rule\n> **Status:** Active\n';
  const cmdBody = '---\nname: cmd\n---\n# cmd\n';
  writeFile(conf, 'rules/canon.md', canonBody);
  writeFile(conf, 'commands/cmd.md', cmdBody);
  for (const [name, body] of Object.entries(local)) {
    writeFile(conf, `rules/local/${name}`, body);
  }
  writeJson(conf, 'catalog.json', {
    schemaVersion: 2,
    entries: [
      { kind: 'rule', id: 'canon', path: 'rules/canon.md',
        description: 'canonical', sha256: sha(canonBody) },
      { kind: 'command', id: 'cmd', path: 'commands/cmd.md',
        description: 'cmd', modes: ['default'], rules: ['canon'],
        sha256: sha(cmdBody) },
    ],
    aliases: [],
  });
  return { dir, ctx: { projectRoot: dir, configDir: '.scopegrain' } };
}

test('local rule merges as overlay entry with local origin defaults', () => {
  const { dir, ctx } = fixture({
    local: { 'mine.md': '# My local rule\n> **Status:** Active\n' },
  });
  try {
    const cat = loadWorkspaceCatalog(ctx);
    assert.equal(cat.localRules, 1);
    const r = getResource('rule', 'mine', { catalog: cat });
    assert.equal(r.overlay, 'local');
    assert.equal(r.meta.origin.source, 'local');
    assert.equal(r.meta.status, 'active');
    assert.equal(r.description, 'My local rule');
  } finally { cleanup(dir); }
});

test('no rules/local dir: catalog loads, localRules is 0', () => {
  const { dir, ctx } = fixture();
  try {
    const cat = loadWorkspaceCatalog(ctx);
    assert.equal(cat.localRules, 0);
  } finally { cleanup(dir); }
});

test('Status header governs lifecycle when no frontmatter declares', () => {
  const { dir, ctx } = fixture({ local: {
    'in-review.md': '# WIP\n> **Status:** In review\n',
    'deprecated.md': '# Old\n> **Status:** Deprecated\n',
    'draft.md': '# Idea\n> **Status:** Draft\n',
  } });
  try {
    const cat = loadWorkspaceCatalog(ctx);
    assert.equal(cat.localRules, 3);
    for (const [id, want] of [['in-review', 'proposed'],
      ['deprecated', 'archived'], ['draft', 'proposed']]) {
      const r = getResource('rule', id, { catalog: cat });
      assert.equal(r.meta.status, want, id);
    }
  } finally { cleanup(dir); }
});

test('frontmatter status wins over the Status header', () => {
  const { dir, ctx } = fixture({ local: {
    'fm.md': '---\nstatus: archived\n---\n# R\n> **Status:** Active\n',
  } });
  try {
    const cat = loadWorkspaceCatalog(ctx);
    const r = getResource('rule', 'fm', { catalog: cat });
    assert.equal(r.meta.status, 'archived');
    assert.equal(r.meta.origin.source, 'local'); // placement default
  } finally { cleanup(dir); }
});

test('explicit origin.source survives the local placement default', () => {
  const { dir, ctx } = fixture({ local: {
    'imported.md': '---\norigin.source: imported\n---\n# Imported\n',
  } });
  try {
    const cat = loadWorkspaceCatalog(ctx);
    const r = getResource('rule', 'imported', { catalog: cat });
    assert.equal(r.meta.origin.source, 'imported');
  } finally { cleanup(dir); }
});

test('local id colliding with canonical fails loudly, no shadowing', () => {
  const { dir, ctx } = fixture({
    local: { 'canon.md': '# shadow attempt\n' },
  });
  try {
    assert.throws(() => loadWorkspaceCatalog(ctx),
      (e) => e.code === 'CATALOG_DUPLICATE'
        && /local rule/.test(e.message));
  } finally { cleanup(dir); }
});

test('invalid local filenames warn and skip, never crash the load', () => {
  const { dir, ctx } = fixture({ local: {
    'Not Slug!.md': '# bad name\n',
    'ok.md': '# fine\n',
  } });
  try {
    const cat = loadWorkspaceCatalog(ctx);
    assert.equal(cat.localRules, 1);
    assert.ok(cat.warnings.some((w) => w.includes('Not Slug!.md')));
  } finally { cleanup(dir); }
});

test('local id colliding with a mounted entry fails loudly too', () => {
  const mountedBody = '# mounted rule\n';
  const { dir, ctx } = fixture({ local: { 'x.md': '# local x\n' } });
  try {
    const conf = path.join(dir, '.scopegrain');
    writeFile(conf, 'bundles/b/rules/x.md', mountedBody);
    writeJson(conf, 'mounted-catalog.json', {
      entries: [{ kind: 'rule', id: 'x',
        path: 'bundles/b/rules/x.md', sha256: sha(mountedBody),
        bundle: 'b' }],
    });
    assert.throws(() => loadWorkspaceCatalog(ctx),
      (e) => e.code === 'CATALOG_DUPLICATE');
  } finally { cleanup(dir); }
});

test('doctor reports overlay count; local rules are no upgrade signal', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const before = runDoctor(ctx);
    writeFile(path.join(dir, '.scopegrain'),
      'rules/local/mine.md', '# Mine\n');
    const after = runDoctor(ctx);
    const check = after.checks.find((c) => c.name === 'rule-overlay');
    assert.ok(check, 'rule-overlay check is present');
    assert.equal(check.ok, true);
    assert.ok(check.detail.includes('1 local overlay rule'));
    // The overlay layer must not flip the snapshot-upgrade comparison.
    assert.equal(after.upgradeAvailable, before.upgradeAvailable);
  } finally { cleanup(dir); }
});

test('editing a local rule after load fails closed at serve', () => {
  const { dir, ctx } = fixture({ local: { 'hot.md': '# v1\n' } });
  try {
    const cat = loadWorkspaceCatalog(ctx);
    assert.ok(getResource('rule', 'hot', { catalog: cat }));
    // Drift between merge-time hash and serve-time bytes.
    fs.writeFileSync(path.join(
      dir, '.scopegrain', 'rules/local/hot.md'), '# v2 tampered\n');
    assert.throws(() => getResource('rule', 'hot', { catalog: cat }),
      (e) => e.code === 'RESOURCE_INTEGRITY_MISMATCH');
  } finally { cleanup(dir); }
});
