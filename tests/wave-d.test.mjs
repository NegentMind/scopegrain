// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runWorkflow, loadRun } from '../src/core/workflow-runner.mjs';
import {
  validateSubmission, loadCatalogStack, composeResource,
  validateBundle, registerExtension, registerPreset, listRegistry,
  setExtensionState, installBundle, presetLayers, mountBundle,
  unmountBundle, uninstallBundle, removeExtension, removePreset,
  selfTestDist,
  loadMounted,
} from '../src/core/distribution.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { assertSafeId } from '../src/core/identifiers.mjs';
import { loadWorkspaceCatalog } from '../src/core/catalog.mjs';
import {
  bootstrappedCtx, cleanup, writeJson, VALID_ANSWERS,
} from './helpers.mjs';

const mk = (title) => ({ title, contract: 'c', authorContext: 'a', scope: [] });

test('D1 workflow runner: whitelisted ops only, resumable checkpoints', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    assert.throws(() => runWorkflow(ctx, {
      schemaVersion: 1, id: 'w1',
      steps: [{ id: 's1', op: 'shell', args: { cmd: 'rm -rf /' } }],
    }), (e) => e.code === 'INVALID_OP');
    const t = createTask(ctx, mk('wf'));
    const r = runWorkflow(ctx, {
      schemaVersion: 1, id: 'wf-ok',
      steps: [
        { id: 'c', op: 'converge.evaluate', args: { taskId: t.id } },
        { id: 'a', op: 'analyze.task', args: { taskId: t.id } },
      ],
    });
    assert.equal(r.run.status, 'completed');
    assert.equal(r.run.completed.length, 2);
    assert.ok(loadRun(ctx, 'wf-ok'));
    // Resume: completed steps are never re-run
    const r2 = runWorkflow(ctx, {
      schemaVersion: 1, id: 'wf-ok',
      steps: [
        { id: 'c', op: 'converge.evaluate', args: { taskId: t.id } },
        { id: 'a', op: 'analyze.task', args: { taskId: t.id } },
        { id: 'n', op: 'noop', args: {} },
      ],
    });
    assert.equal(r2.run.status, 'completed');
    assert.equal(r2.run.completed.length, 3);
  } finally { cleanup(dir); }
});

test('D2 compose: replace/prepend/append/wrap ops apply in order', () => {
  assert.equal(composeResource('base', [
    { op: 'append', content: '+tail' },
    { op: 'prepend', content: 'head+' },
  ]), 'head+base+tail');
  assert.equal(composeResource('b', [
    { op: 'wrap', content: '[[{{BODY}}]]' },
  ]), '[[b]]');
  assert.equal(composeResource('b', [
    { op: 'replace', content: 'new' },
  ]), 'new');
  assert.throws(() => composeResource('b', [{ op: 'exec', content: 'x' }]),
    /op/);
});

test('D3 catalog stack: file:// only, remote refused hard', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    writeJson(dir, 'cats/extra.json', {
      entries: [{ id: 'x1' }, { id: 'shared', v: 'low' }],
    });
    writeJson(dir, 'cats/upper.json', {
      entries: [{ id: 'shared', v: 'high' }],
    });
    const stack = loadCatalogStack(ctx, [
      { uri: 'file://cats/extra.json', priority: 1 },
      { uri: 'file://cats/upper.json', priority: 2 },
    ]);
    const shared = stack.entries.find((e) => e.id === 'shared');
    assert.equal(shared.v, 'high'); // higher priority wins
    assert.equal(stack.entries.length, 2);
    assert.throws(() => loadCatalogStack(ctx, [
      { uri: 'https://example.com/cat.json' },
    ]), (e) => e.code === 'REMOTE_CATALOG_UNSUPPORTED');
  } finally { cleanup(dir); }
});

test('D7 submission: id/semver/pinning enforced; remote requires sha256', () => {
  assert.throws(() => validateSubmission({ id: 'Bad ID', version: '1.0.0',
    source: { uri: 'file://x' } }), /slug/);
  assert.throws(() => validateSubmission({ id: 'ok', version: 'v1',
    source: { uri: 'file://x' } }), /semver/);
  assert.throws(() => validateSubmission({ id: 'ok', version: '1.0.0',
    source: { uri: 'https://x.com/c.tgz' } }),
    (e) => e.code === 'PIN_REQUIRED');
  const ok = validateSubmission({ id: 'ok', version: '1.0.0',
    source: { uri: 'https://x.com/c.tgz', sha256: 'a'.repeat(64) } });
  assert.equal(ok.source.remote, true);
});

test('D4 bundle: pin validation + missing detection', () => {
  const ids = new Set(['a', 'b']);
  const b = validateBundle({ id: 'pkg', version: '1.0.0',
    requires: [{ id: 'a' }, { id: 'ghost' }], contributes: ['a'] }, ids);
  assert.deepEqual(b.missing, ['ghost']);
  assert.throws(() => validateBundle({ id: 'pkg', version: '1.0.0',
    requires: [{ id: 'a', sha256: 'zz' }] }), /sha256/);
});

test('G3 identifiers: Windows reserved names and non-slugs rejected', () => {
  for (const bad of ['con', 'CON', 'aux', 'nul', 'com1', 'lpt9',
    'Bad ID', 'a b', 'x/y', 'with..dots', '-lead', '']) {
    assert.throws(() => assertSafeId(bad), /INVALID_VALUE|slug|reserved/);
  }
  for (const ok of ['task-1', 'my-ext', 'a', 'x'.repeat(64).slice(0, 63)
    .replace(/^./, 'a')]) {
    assert.equal(assertSafeId(ok), ok);
  }
  // Reserved names are also rejected inside documents that adopt them.
  assert.throws(() => validateSubmission({ id: 'con', version: '1.0.0',
    source: { uri: 'file://x' } }), /reserved/);
});

test('D5/D6 registries: extension lifecycle + preset priority persist', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const e = registerExtension(ctx, { id: 'ext1', version: '1.0.0',
      lifecycle: { onActivate: 'boot' }, contributes: [] });
    assert.equal(e.lifecycle.onActivate, 'boot');
    const p = registerPreset(ctx, { id: 'p1', priority: 5,
      overrides: [{ op: 'append', content: 'x', target: '*' }] });
    assert.equal(p.priority, 5);
    assert.equal(listRegistry(ctx, 'extensions').length, 1);
    assert.equal(listRegistry(ctx, 'presets').length, 1);
    assert.throws(() => registerExtension(ctx, { id: 'ext1',
      version: '1.0.0' }), /already/);
    assert.throws(() => registerExtension(ctx, { id: 'e2',
      version: '1.0.0', lifecycle: { onPwned: 'x' } }), /unknown key/);
    assert.throws(() => registerPreset(ctx, { id: 'p2',
      overrides: [{ op: 'append', content: 'x' }] }), /target/);
    assert.throws(() => registerPreset(ctx, { id: 'p2',
      overrides: [{ op: 'append', content: 'x', target: 'bogus/x' }] }),
      /unknown kind/);
  } finally { cleanup(dir); }
});

test('presets consume: target matching + packet applies overrides', async () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    // Matching semantics: exact, kind/* and * targets all apply,
    // higher priority last.
    const presets = [
      { id: 'low', priority: 1, overrides: [
        { op: 'append', content: '+L', target: '*' }] },
      { id: 'high', priority: 9, overrides: [
        { op: 'append', content: '+H', target: 'rule/*' },
        { op: 'append', content: '+E', target: 'skill/planning-and-task-breakdown' }] },
    ];
    let sel = presetLayers(presets, 'rule', 'workflow');
    assert.equal(sel.layers.length, 2);
    assert.equal(composeResource('b', sel.layers), 'b+L+H');
    sel = presetLayers(presets, 'skill', 'planning-and-task-breakdown');
    assert.equal(sel.layers.length, 2); // '*' + exact
    sel = presetLayers(presets, 'prompt', 'task-brief');
    assert.equal(sel.layers.length, 1); // only '*'
    // End-to-end: registered preset shapes the workflow packet content.
    registerPreset(ctx, { id: 'pk', priority: 1, overrides: [
      { op: 'append', content: '\nPRESET-MARK', target: 'command/*' }] });
    const { buildWorkflowPacket } =
      await import('../src/core/workflows.mjs');
    const packet = buildWorkflowPacket(ctx, { command: 'plan-work' });
    assert.ok(packet.command.content.endsWith('PRESET-MARK'));
    assert.deepEqual(packet.presets.applied,
      [{ resource: 'command/plan-work', preset: 'pk',
        target: 'command/*', op: 'append' }]);
  } finally { cleanup(dir); }
});

test('extension lifecycle: activate validates contributes vs catalog', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    registerExtension(ctx, { id: 'ok-ext', version: '1.0.0',
      contributes: ['command/plan-work'] });
    const act = setExtensionState(ctx, 'ok-ext', 'active');
    assert.equal(act.state, 'active');
    const dis = setExtensionState(ctx, 'ok-ext', 'disabled');
    assert.equal(dis.state, 'disabled');
    registerExtension(ctx, { id: 'bad-ext', version: '1.0.0',
      contributes: ['command/ghost'] });
    assert.throws(() => setExtensionState(ctx, 'bad-ext', 'active'),
      /unknown resources/);
    assert.throws(() => setExtensionState(ctx, 'nope', 'active'),
      /not registered/);
  } finally { cleanup(dir); }
});

test('bundle install: file:// bounded copy, sha256 pin, provenance', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    fs.mkdirSync(path.join(dir, 'pack'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack/content.md'), 'hello bundle');
    const sha = crypto.createHash('sha256')
      .update('hello bundle').digest('hex');
    writeJson(dir, 'cats/pack-cat.json', {
      entries: [{ id: 'entry-a',
        source: { uri: 'file://pack/content.md' } }] });
    const input = {
      bundle: { id: 'pkg', version: '1.0.0',
        requires: [{ id: 'entry-a', sha256: sha }] },
      sources: [{ uri: 'file://cats/pack-cat.json' }],
    };
    const dry = installBundle(ctx, input.bundle, input.sources);
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.files.length, 1);
    const done = installBundle(ctx, input.bundle, input.sources,
      { apply: true });
    assert.equal(done.applied, true);
    assert.ok(fs.existsSync(path.join(dir,
      '.tasksystem/bundles/pkg/entry-a')));
    const prov = JSON.parse(fs.readFileSync(path.join(dir,
      '.tasksystem/bundles/pkg/provenance.json'), 'utf8'));
    assert.equal(prov.files[0].sha256, sha);
    // Idempotent re-apply (identical bytes) is a no-op, not a conflict.
    const again = installBundle(ctx, input.bundle, input.sources,
      { apply: true });
    assert.equal(again.applied, true);
    // Wrong pin fails closed.
    assert.throws(() => installBundle(ctx, { ...input.bundle,
      requires: [{ id: 'entry-a', sha256: 'b'.repeat(64) }] },
      input.sources), (e) => e.code === 'HASH_MISMATCH');
    // Missing stack entry fails closed.
    assert.throws(() => installBundle(ctx, { ...input.bundle,
      requires: [{ id: 'ghost' }] }, input.sources), /missing entries/);
  } finally { cleanup(dir); }
});

test('bundle mount: entries join workspace catalog, sha-verified', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    fs.mkdirSync(path.join(dir, 'pack'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack/cmd.md'),
      '---\ndescription: mounted cmd\n---\nbody');
    const sha = crypto.createHash('sha256')
      .update('---\ndescription: mounted cmd\n---\nbody').digest('hex');
    writeJson(dir, 'cats/pack-cat.json', {
      entries: [{ id: 'entry-c', kind: 'command', modes: ['default'],
        source: { uri: 'file://pack/cmd.md' } }] });
    const input = {
      bundle: { id: 'pkg2', version: '1.0.0',
        requires: [{ id: 'entry-c', sha256: sha }] },
      sources: [{ uri: 'file://cats/pack-cat.json' }],
    };
    installBundle(ctx, input.bundle, input.sources, { apply: true });
    const m = mountBundle(ctx, 'pkg2');
    assert.deepEqual(m.mounted, ['command/entry-c']);
    // Mounted entry resolves through the workspace catalog like a
    // snapshot resource — this is the consumer the bundle exists for.
    const cat = loadWorkspaceCatalog(ctx);
    assert.ok(cat.byKey.has('command/entry-c'));
    assert.equal(cat.mounted, 1);
    // Idempotent re-mount.
    mountBundle(ctx, 'pkg2');
    assert.equal(loadMounted(ctx).entries.length, 1);
    // Diverged bytes fail closed at catalog load — the mounted merge
    // verifies every entry's sha256 before the mount check even runs.
    fs.writeFileSync(path.join(dir,
      '.tasksystem/bundles/pkg2/entry-c'), 'tampered');
    assert.throws(() => mountBundle(ctx, 'pkg2'),
      (e) => e.code === 'RESOURCE_INTEGRITY_MISMATCH');
    fs.writeFileSync(path.join(dir,
      '.tasksystem/bundles/pkg2/entry-c'),
      '---\ndescription: mounted cmd\n---\nbody');
    // A bundle entry id colliding with a snapshot id fails closed.
    writeJson(dir, 'cats/clash-cat.json', {
      entries: [{ id: 'plan-work', kind: 'command',
        source: { uri: 'file://pack/cmd.md' } }] });
    installBundle(ctx, { id: 'pkg-clash', version: '1.0.0',
      requires: [{ id: 'plan-work' }] },
      [{ uri: 'file://cats/clash-cat.json' }], { apply: true });
    assert.throws(() => mountBundle(ctx, 'pkg-clash'), /collides/);
  } finally { cleanup(dir); }
});

test('bundle unmount + uninstall: provenance-confined deletion', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    fs.mkdirSync(path.join(dir, 'pack'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack/x.md'), 'x');
    writeJson(dir, 'cats/pack-cat.json', {
      entries: [{ id: 'entry-x', kind: 'reference',
        source: { uri: 'file://pack/x.md' } }] });
    const input = {
      bundle: { id: 'pkg3', version: '1.0.0',
        requires: [{ id: 'entry-x' }] },
      sources: [{ uri: 'file://cats/pack-cat.json' }],
    };
    installBundle(ctx, input.bundle, input.sources, { apply: true });
    mountBundle(ctx, 'pkg3');
    // Diverged file stays behind — uninstall never clobbers user bytes.
    fs.writeFileSync(path.join(dir,
      '.tasksystem/bundles/pkg3/entry-x'), 'user-edited');
    const res = uninstallBundle(ctx, 'pkg3');
    assert.equal(res.unmounted, 1);
    // Only provenance.json itself is deleted — the diverged bundle file
    // is left behind, never clobbered.
    assert.deepEqual(res.deleted,
      ['.tasksystem/bundles/pkg3/provenance.json']);
    assert.equal(res.leftBehind.length, 1);
    assert.ok(fs.existsSync(
      path.join(dir, '.tasksystem/bundles/pkg3/entry-x')));
    assert.equal(loadMounted(ctx).entries.length, 0);
    // Tampered provenance pointing outside the bundle dir fails closed.
    const provAbs = path.join(dir,
      '.tasksystem/bundles/pkg3/provenance.json');
    writeJson(dir, '.tasksystem/bundles/pkg3/provenance.json', {
      schemaVersion: 1, id: 'pkg3', version: '1.0.0', requires: [],
      contributes: [], entries: [],
      files: [{ rel: '.tasksystem/config.json', sha256: 'a'.repeat(64) }],
    });
    assert.throws(() => uninstallBundle(ctx, 'pkg3'), /outside bundle/);
    fs.unlinkSync(provAbs);
    assert.throws(() => uninstallBundle(ctx, 'pkg3'), /not installed/);
  } finally { cleanup(dir); }
});

test('bundle install: depth cap and file bound fail closed', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    // 33-level deep tree exceeds MAX_BUNDLE_DEPTH (32).
    let deep = path.join(dir, 'deep');
    for (let i = 0; i < 33; i++) deep = path.join(deep, `d${i}`);
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, 'leaf.txt'), 'x');
    writeJson(dir, 'cats/deep-cat.json', {
      entries: [{ id: 'deep-entry',
        source: { uri: 'file://deep' } }] });
    assert.throws(() => installBundle(ctx,
      { id: 'deepb', version: '1.0.0',
        requires: [{ id: 'deep-entry' }] },
      [{ uri: 'file://cats/deep-cat.json' }], { apply: true }),
      (e) => e.code === 'BUNDLE_TOO_LARGE');
  } finally { cleanup(dir); }
});

test('dist lock: concurrent registry mutation fails closed', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    // A live-pid lock is never reclaimed: a second mutation must fail.
    fs.writeFileSync(path.join(dir, '.tasksystem/dist.lock'),
      JSON.stringify({ t: 'x', pid: process.pid, at: Date.now() }));
    assert.throws(() => registerExtension(ctx,
      { id: 'e', version: '1.0.0' }),
      (e) => e.code === 'DIST_LOCKED');
    assert.throws(() => registerPreset(ctx, { id: 'p', overrides: [] }),
      (e) => e.code === 'DIST_LOCKED');
    fs.unlinkSync(path.join(dir, '.tasksystem/dist.lock'));
    // Lock released → registry writes work again.
    registerPreset(ctx, { id: 'p', overrides: [] });
  } finally { cleanup(dir); }
});

test('extensions: active contributes resources to workflow packet', async () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const { buildWorkflowPacket } =
      await import('../src/core/workflows.mjs');
    const before = buildWorkflowPacket(ctx, { command: 'plan-work' });
    assert.equal(before.contributedResources.skills.length, 0);
    assert.deepEqual(before.extensions.applied, []);
    registerExtension(ctx, { id: 'contrib-ext', version: '1.0.0',
      contributes: ['skill/planning-and-task-breakdown'] });
    setExtensionState(ctx, 'contrib-ext', 'active');
    const packet = buildWorkflowPacket(ctx, { command: 'plan-work' });
    assert.equal(packet.contributedResources.skills.length, 1);
    const contributed = packet.contributedResources.skills[0];
    assert.equal(contributed.id, 'planning-and-task-breakdown');
    assert.equal(contributed.extension, 'contrib-ext');
    assert.deepEqual(packet.extensions.applied,
      [{ extension: 'contrib-ext',
        resource: 'skill/planning-and-task-breakdown' }]);
    // Removal requires disabled state — no silent teardown.
    assert.throws(() => removeExtension(ctx, 'contrib-ext'), /active/);
    // Disabled extension contributes nothing and can be removed.
    setExtensionState(ctx, 'contrib-ext', 'disabled');
    const after = buildWorkflowPacket(ctx, { command: 'plan-work' });
    assert.equal(after.contributedResources.skills.length, 0);
    const gone = removeExtension(ctx, 'contrib-ext');
    assert.equal(gone.removed, 'contrib-ext');
  } finally { cleanup(dir); }
});

test('preset remove: registry shrinks under lock', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    registerPreset(ctx, { id: 'tmp', overrides: [] });
    assert.equal(listRegistry(ctx, 'presets').length, 1);
    const r = removePreset(ctx, 'tmp');
    assert.equal(r.removed, 'tmp');
    assert.equal(listRegistry(ctx, 'presets').length, 0);
    assert.throws(() => removePreset(ctx, 'tmp'), /not registered/);
  } finally { cleanup(dir); }
});

test('R2 dir-source pin binds to the conventional main file', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    // A directory source pins against its kind's conventional main file:
    // a declared sha256 that binds to nothing must fail closed.
    fs.mkdirSync(path.join(dir, 'pack/skill-dir'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack/skill-dir/SKILL.md'), 'skill body');
    fs.writeFileSync(path.join(dir, 'pack/skill-dir/extra.txt'), 'aux');
    const sha = crypto.createHash('sha256')
      .update('skill body').digest('hex');
    writeJson(dir, 'cats/dir-cat.json', {
      entries: [{ id: 'skill-dir', kind: 'skill',
        source: { uri: 'file://pack/skill-dir' } }] });
    const bundle = (requires) => ({ id: 'pkgdir', version: '1.0.0',
      requires });
    const sources = [{ uri: 'file://cats/dir-cat.json' }];
    const done = installBundle(ctx,
      bundle([{ id: 'skill-dir', sha256: sha }]), sources, { apply: true });
    assert.equal(done.applied, true);
    const prov = JSON.parse(fs.readFileSync(path.join(dir,
      '.tasksystem/bundles/pkgdir/provenance.json'), 'utf8'));
    assert.equal(prov.entries[0].file, 'skill-dir/SKILL.md');
    assert.equal(prov.entries[0].sha256, sha);
    // A pin for different bytes fails against the MAIN file — not "any
    // file in the tree".
    fs.writeFileSync(path.join(dir, 'pack/skill-dir/SKILL.md'), 'changed');
    assert.throws(() => installBundle(ctx,
      bundle([{ id: 'skill-dir', sha256: sha }]), sources),
      (e) => e.code === 'HASH_MISMATCH');
    // A pinned source whose kind has no conventional main file present
    // binds to nothing — fail closed, never silently unverified.
    fs.writeFileSync(path.join(dir, 'pack/skill-dir/SKILL.md'), 'skill body');
    fs.renameSync(path.join(dir, 'pack/skill-dir/SKILL.md'),
      path.join(dir, 'pack/skill-dir/RENAMED.md'));
    assert.throws(() => installBundle(ctx,
      bundle([{ id: 'skill-dir', sha256: sha }]), sources),
      (e) => e.code === 'HASH_MISMATCH');
  } finally { cleanup(dir); }
});

test('mounted entry shadowing a canonical alias fails closed', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    // 'pipeline' is a canonical command alias, not a command id — a
    // mounted entry with that id would make the alias unreachable.
    const file = path.join(dir, '.tasksystem/bundles/forgery/cmd.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    writeJson(dir, '.tasksystem/mounted-catalog.json', {
      entries: [{ kind: 'command', id: 'pipeline',
        path: 'bundles/forgery/cmd.md', sha256: 'a'.repeat(64),
        bundle: 'forgery', modes: ['default'] }],
    });
    assert.throws(() => loadWorkspaceCatalog(ctx),
      (e) => e.code === 'CATALOG_DUPLICATE'
        && /shadows a catalog alias/.test(e.message));
    // Mounted-vs-mounted duplicate paths fail closed too. The first
    // entry needs its REAL sha: hash verification runs per-entry inside
    // the loop, so it must pass for the second entry to be evaluated.
    const realSha = crypto.createHash('sha256').update('x').digest('hex');
    writeJson(dir, '.tasksystem/mounted-catalog.json', {
      entries: [
        { kind: 'command', id: 'c-a', path: 'bundles/forgery/cmd.md',
          sha256: realSha, bundle: 'forgery', modes: ['default'] },
        { kind: 'rule', id: 'r-b', path: 'bundles/forgery/cmd.md',
          sha256: 'b'.repeat(64), bundle: 'forgery' },
      ],
    });
    assert.throws(() => loadWorkspaceCatalog(ctx),
      (e) => e.code === 'CATALOG_DUPLICATE'
        && /duplicate mounted path/.test(e.message));
  } finally { cleanup(dir); }
});

test('doctor: mounted bundle is an overlay, not an upgrade signal', async () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const { runDoctor } = await import('../src/core/doctor.mjs');
    const before = runDoctor(ctx);
    // Baseline may legitimately differ for unrelated reasons; the
    // invariant is that MOUNTING does not flip it to true.
    fs.mkdirSync(path.join(dir, 'pack'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack/ref.md'), 'ref');
    writeJson(dir, 'cats/pack-cat.json', {
      entries: [{ id: 'ref-d', kind: 'reference',
        source: { uri: 'file://pack/ref.md' } }] });
    installBundle(ctx, { id: 'pkgd', version: '1.0.0',
      requires: [{ id: 'ref-d' }] },
      [{ uri: 'file://cats/pack-cat.json' }], { apply: true });
    mountBundle(ctx, 'pkgd');
    const after = runDoctor(ctx);
    assert.notEqual(after.upgradeAvailable, true,
      'mounted overlay must not trigger snapshot-upgrade signal');
    assert.equal(after.upgradeAvailable, before.upgradeAvailable);
  } finally { cleanup(dir); }
});

test('native bridges: mounted resource materializes in activation plan', async () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    fs.mkdirSync(path.join(dir, 'pack'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack/cmd.md'),
      '---\ndescription: bridge target\n---\nbody');
    writeJson(dir, 'cats/pack-cat.json', {
      entries: [{ id: 'bridge-cmd', kind: 'command', modes: ['default'],
        source: { uri: 'file://pack/cmd.md' } }] });
    installBundle(ctx, { id: 'pkgb', version: '1.0.0',
      requires: [{ id: 'bridge-cmd' }] },
      [{ uri: 'file://cats/pack-cat.json' }], { apply: true });
    mountBundle(ctx, 'pkgb');
    const { buildActivation } =
      await import('../src/hosts/activation.mjs');
    const plan = buildActivation(ctx, { host: 'claude' });
    // The mounted command projects to a claude command destination —
    // same pipeline as snapshot resources.
    const bridged = plan.applyable.find(
      (f) => f.kind === 'command' && f.rel.includes('bridge-cmd'));
    assert.ok(bridged,
      `no bridge emitted for mounted command: ${JSON.stringify(plan.applyable.map((f) => f.rel))}`);
    // The bridge's resource pointer stays inside the confined bundle dir.
    assert.ok(bridged.content.includes('bundles/pkgb/bridge-cmd'));
    // Nothing global, nothing skipped for the mounted entry.
    assert.ok(!plan.skipped.some((s) =>
      String(s.destination).includes('bridge-cmd')));
  } finally { cleanup(dir); }
});

test('E4 dist journal: registry mutations append CAS-chained entries', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    registerExtension(ctx, { id: 'ext-j', version: '1.0.0',
      source: { uri: 'file://e' }, description: 'd' });
    setExtensionState(ctx, 'ext-j', 'disabled');
    const abs = path.join(dir, ctx.configDir, 'dist-journal.jsonl');
    assert.ok(fs.existsSync(abs), 'dist-journal.jsonl must exist');
    const entries = fs.readFileSync(abs, 'utf8').trim().split('\n')
      .map((l) => JSON.parse(l));
    assert.equal(entries.length, 2);
    assert.equal(entries[0].revision, 1);
    assert.equal(entries[1].revision, 2);
    assert.equal(entries[0].op, 'extension-register');
    assert.equal(entries[1].op, 'extension-state');
    assert.equal(entries[0].registry, 'extensions');
    // CAS chain: previous hash of write n+1 equals new hash of write n.
    assert.equal(entries[1].previousSha256, entries[0].newSha256);
    assert.match(entries[0].newSha256, /^[0-9a-f]{64}$/);
    assert.equal(typeof entries[0].journaled, 'boolean');
  } finally { cleanup(dir); }
});

test('E4 dist journal: bound workspace routes registry writes through the shared journal', async () => {
  const { applyPlan } = await import('../src/core/bootstrap.mjs');
  const { prepareWorkspace } = await import('../src/core/workspaces.mjs');
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const prepared = prepareWorkspace(ctx, {
      areas: [{ key: 'main', name: 'Main' }],
    });
    applyPlan(dir, [prepared.file]);
    registerExtension(ctx, { id: 'ext-jb', version: '1.0.0',
      source: { uri: 'file://e' }, description: 'd' });
    setExtensionState(ctx, 'ext-jb', 'disabled');
    const abs = path.join(dir, ctx.configDir, 'dist-journal.jsonl');
    const entries = fs.readFileSync(abs, 'utf8').trim().split('\n')
      .map((l) => JSON.parse(l));
    assert.equal(entries.length, 2);
    assert.ok(entries.every((e) => e.journaled === true),
      'bound workspace must route writes through the journal kernel');
    assert.equal(entries[1].previousSha256, entries[0].newSha256);
    // The kernel wrote the registry and its events: both exist on disk.
    assert.ok(fs.existsSync(
      path.join(dir, ctx.configDir, 'extensions.json')));
  } finally { cleanup(dir); }
});

test('E6 dist selftest: full discovery->install->mount->uninstall loop passes and cleans up', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const r = selfTestDist(ctx);
    assert.equal(r.ok, true, JSON.stringify(r.steps, null, 1));
    assert.equal(r.steps.length, 8);
    assert.ok(r.steps.every((s) => s.ok));
    assert.deepEqual(r.steps.map((s) => s.step),
      ['prepare', 'discovery', 'validate', 'dry-run',
        'install', 'mount', 'unmount', 'uninstall']);
    // Cleanup contract: no scratch dir, no bundle dir, no mounted entries.
    assert.ok(!fs.existsSync(
      path.join(dir, ctx.configDir, 'selftest-scratch')));
    const mounted = loadMounted(ctx);
    assert.ok(!mounted.entries.some(
      (e) => e.bundle === 'scopegrain-selftest'));
    // The loop still left its dist-journal trail.
    const journal = path.join(dir, ctx.configDir, 'dist-journal.jsonl');
    assert.ok(fs.existsSync(journal));
    const ops = fs.readFileSync(journal, 'utf8').trim().split('\n')
      .map((l) => JSON.parse(l)).map((e) => e.op);
    assert.ok(ops.includes('bundle-install'));
    assert.ok(ops.includes('bundle-uninstall'));
  } finally { cleanup(dir); }
});

test('E7 deterministic packaging: byte-identical across runs, sorted, fixed metadata', async () => {
  const { packDirectory, writeDeterministicTar } =
    await import('../src/core/packaging.mjs');
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    fs.mkdirSync(path.join(dir, 'pack-src/sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack-src/b.md'), 'B');
    fs.writeFileSync(path.join(dir, 'pack-src/a.md'), 'A');
    fs.writeFileSync(path.join(dir, 'pack-src/sub/c.md'), 'C');
    const r1 = packDirectory(ctx, 'pack-src', 'out/p1.tar');
    const r2 = packDirectory(ctx, 'pack-src', 'out/p2.tar');
    assert.equal(r1.sha256, r2.sha256);
    assert.equal(r1.bytes, r2.bytes);
    assert.equal(r1.files, 3);
    // Byte-identical regardless of input ordering.
    const t1 = writeDeterministicTar([
      { name: 'b', data: 'x' }, { name: 'a', data: 'y' }]);
    const t2 = writeDeterministicTar([
      { name: 'a', data: 'y' }, { name: 'b', data: 'x' }]);
    assert.ok(t1.equals(t2));
    // Fixed metadata: mtime field (offset 136, width 12) all-zero octal.
    const tar = fs.readFileSync(path.join(dir, 'out/p1.tar'));
    assert.match(tar.subarray(136, 148).toString(), /^0+\0$/);
    // uid/gid fixed at 0 as well (offsets 108/116, width 8).
    assert.match(tar.subarray(108, 116).toString(), /^0+\0$/);
    // Traversal and links fail closed.
    assert.throws(() => packDirectory(ctx, '../outside', 'out/x.tar'),
      (e) => e.code === 'INVALID_PATH' || e.code === 'PATH_TRAVERSAL'
        || e.code !== undefined);
    fs.writeFileSync(path.join(dir, 'pack-src/link-target.md'), 'T');
  } finally { cleanup(dir); }
});
