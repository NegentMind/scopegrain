// SPDX-License-Identifier: Apache-2.0
// CLI wave-2 surface: lifecycle verbs (adopt/update/backup/restore/
// uninstall), investigate + --save, host activate, capture proposals/
// review, view server and the readInputFile ENOENT taxonomy fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../src/cli.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { prepareWorkspace } from '../src/core/workspaces.mjs';
import { renderNativeAdapters } from '../src/hosts/native.mjs';
import {
  DEFAULT_ANSWERS, cleanup, exists, fakeIO, makeTempDir, readJson,
  writeJson,
} from './helpers.mjs';

const CONFIG_REL = '.tasksystem/config.json';
const MISSING_DIR = path.join('definitely', 'not', 'a-project-xyz');

async function call(args) {
  const io = fakeIO();
  const code = await run(args, io);
  return { code, io,
    output: code === 0 ? JSON.parse(io.out.stdout.at(-1))
      : JSON.parse(io.out.stderr.at(-1)).error };
}

// Lightweight fixture: a validated config only (no bootstrap plan).
function configFixture({ hosts } = {}) {
  const dir = makeTempDir('cli-w2');
  const answers = hosts ? { ...DEFAULT_ANSWERS, hosts } : DEFAULT_ANSWERS;
  writeJson(dir, CONFIG_REL, createConfig(dir, answers, {}));
  const ctx = resolveContext({ project: dir, config: CONFIG_REL });
  return { dir, ctx };
}

// Config + enrolled two-area workspace (still no generated plan).
function enrolledFixture() {
  const { dir, ctx } = configFixture();
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  return { dir, ctx, a, b };
}

function tree(dir) {
  const result = {};
  function visit(abs, rel = '') {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        result[next] = 'directory';
        visit(path.join(abs, entry.name), next);
      } else {
        result[next] = fs.readFileSync(path.join(abs, entry.name));
      }
    }
  }
  if (fs.existsSync(dir)) visit(dir);
  return result;
}

// ---------- help surface ----------

test('help lists the new wave-2 commands with exact usages', async () => {
  const result = await call(['--help']);
  assert.equal(result.code, 0);
  const usages = result.output.commands.map((command) => command.command);
  for (const usage of [
    'adopt --project PATH [--config REL] [--apply]',
    'update --project PATH [--config REL] [--reconcile] [--apply]',
    'backup --project PATH --to REL [--config REL] [--apply]',
    'restore --project PATH --from REL [--apply]',
    'uninstall --project PATH [--config REL] [--apply]',
    'investigate --project PATH [--config REL] [--save]',
    'host activate --project PATH --host NAME [--surface X] [--apply]',
    'capture proposals --project PATH [--config REL] [--since-sequence N]',
    'capture review --project PATH --input FILE [--apply]',
    'view --project PATH [--config REL] [--port N] [--host ADDR]',
  ]) {
    assert.ok(usages.includes(usage), `missing usage: ${usage}`);
  }
  const notes = result.output.notes.join('\n');
  assert.match(notes, /adopt/);
  assert.match(notes, /investigate/);
  assert.match(notes, /host activate/);
  assert.match(notes, /capture proposals/);
  assert.match(notes, /Ctrl\+C/);
});

// ---------- flag validation pre-IO ----------

test('new commands reject bad flags and missing required flags pre-IO', async () => {
  const missing = MISSING_DIR;
  for (const args of [
    ['adopt', '--project', missing, '--bogus', 'x'],
    ['adopt', '--project', missing, 'extra'],
    ['adopt', '--project', missing, '--yes'],
    ['update', '--project', missing, '--to', 'x'],
    ['update', '--project', missing, '--force'],
    ['backup', '--project', missing], // missing --to
    ['backup', '--project', missing, '--from', 'x'],
    ['restore', '--project', missing], // missing --from
    ['restore', '--project', missing, '--to', 'x'],
    ['uninstall', '--project', missing, '--input', 'f'],
    ['investigate', '--project', missing, '--apply'],
    ['investigate', '--project', missing, '--port', '1'],
    ['host', 'activate', '--project', missing], // missing --host
    ['host', 'activate', '--project', missing, '--host', 'claude', '--input', 'f'],
    ['host', 'bogus', '--project', missing],
    ['capture', 'proposals', '--project', missing, '--apply'],
    ['capture', 'proposals', '--project', missing, '--input', 'f'],
    ['capture', 'proposals', '--project', missing, '--since-sequence', 'abc'],
    ['capture', 'review', '--project', missing], // missing --input
    ['capture', 'review', '--project', missing, '--input', 'x', 'extra'],
    ['view', '--project', missing, '--apply'],
    ['view', '--project', missing, '--port', 'abc'],
    ['view', '--project', missing, '--save'],
  ]) {
    const result = await call(args);
    assert.equal(result.code, 1, JSON.stringify(args));
    assert.equal(result.output.code, 'INVALID_ARGS', JSON.stringify(args));
  }
});

// ---------- ENOENT taxonomy regression ----------

test('a missing --input file reports INPUT_NOT_FOUND, never INTERNAL', async () => {
  const f = enrolledFixture();
  try {
    const missing = path.join(f.dir, 'absent-input.json');
    for (const args of [
      ['capture', 'create', '--project', f.dir, '--input', missing],
      ['capture', 'review', '--project', f.dir, '--input', missing],
      ['task', 'create', '--project', f.dir, '--input', missing],
    ]) {
      const result = await call(args);
      assert.equal(result.code, 1, JSON.stringify(args));
      assert.equal(result.output.code, 'INPUT_NOT_FOUND', JSON.stringify(args));
    }
  } finally { cleanup(f.dir); }
});

// ---------- adopt ----------

test('adopt previews bindings, then --apply enrolls the workspace only', async () => {
  const f = configFixture();
  try {
    const before = tree(f.dir);
    const dry = await call(['adopt', '--project', f.dir]);
    assert.equal(dry.code, 0);
    assert.equal(dry.output.mode, 'dry-run');
    assert.equal(dry.output.status, 'adoptable');
    assert.equal(dry.output.configRel, CONFIG_REL);
    assert.equal(dry.output.workspace, null);
    assert.equal(dry.output.journalState, 'absent');
    assert.deepEqual(tree(f.dir), before); // preview writes nothing

    const applied = await call(['adopt', '--project', f.dir, '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.output.mode, 'applied');
    assert.equal(applied.output.applied, true);
    assert.deepEqual(applied.output.actions.map((a) => a.action),
      ['workspace-enrollment']);
    assert.ok(exists(f.dir, '.tasksystem/state/workspace.json'));

    // Already enrolled: nothing left to bind.
    const again = await call(['adopt', '--project', f.dir, '--apply']);
    assert.equal(again.code, 0);
    assert.equal(again.output.applied, false);
    assert.deepEqual(again.output.actions, []);
    assert.equal(again.output.workspace.areas, 1); // default single area
  } finally { cleanup(f.dir); }
});

test('adopt on an uninitialized project reports attention and never writes', async () => {
  const dir = makeTempDir('cli-w2-empty');
  try {
    const dry = await call(['adopt', '--project', dir]);
    assert.equal(dry.code, 0);
    assert.equal(dry.output.status, 'attention');
    assert.equal(dry.output.configRel, null);
    assert.ok(dry.output.issues.some((i) => i.code === 'CONFIG_NOT_FOUND'));
    const applied = await call(['adopt', '--project', dir, '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.output.applied, false);
    assert.deepEqual(applied.output.actions, []);
    assert.deepEqual(tree(dir), {}); // nothing created, no reinit
  } finally { cleanup(dir); }
});

test('adopt honors an explicit --config path', async () => {
  const dir = makeTempDir('cli-w2-adoptcfg');
  try {
    writeJson(dir, 'custom/cfg.json', createConfig(dir, DEFAULT_ANSWERS, {}));
    const result = await call(
      ['adopt', '--project', dir, '--config', 'custom/cfg.json']);
    assert.equal(result.code, 0);
    assert.equal(result.output.configRel, 'custom/cfg.json');
    assert.equal(result.output.status, 'adoptable');
  } finally { cleanup(dir); }
});

// ---------- update ----------

test('update previews then creates harness files only, never config', async () => {
  const f = configFixture();
  try {
    const before = tree(f.dir);
    const dry = await call(['update', '--project', f.dir]);
    assert.equal(dry.code, 0);
    assert.equal(dry.output.mode, 'dry-run');
    assert.ok(dry.output.counts.create > 0);
    assert.equal(dry.output.counts.conflict, 0);
    assert.deepEqual(tree(f.dir), before);

    const applied = await call(['update', '--project', f.dir, '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.output.mode, 'applied');
    assert.ok(applied.output.created > 0);
    assert.ok(exists(f.dir, '.tasksystem/instructions.md'));
    assert.ok(!applied.output.files.includes(CONFIG_REL));

    const after = await call(['update', '--project', f.dir]);
    assert.equal(after.output.counts.create, 0);
    assert.equal(after.output.counts.conflict, 0);
  } finally { cleanup(f.dir); }
});

test('update --reconcile rewrites a diverged generated file via CLI', async () => {
  const f = configFixture({ hosts: ['claude'] });
  try {
    await call(['update', '--project', f.dir, '--apply']);
    const before = fs.readFileSync(
      path.join(f.dir, '.tasksystem/instructions.md'), 'utf8');
    fs.writeFileSync(path.join(f.dir, '.tasksystem/instructions.md'),
      'user edited');
    fs.writeFileSync(path.join(f.dir, 'CLAUDE.md'), 'foreign edit');

    const dry = await call(
      ['update', '--project', f.dir, '--reconcile']);
    assert.equal(dry.code, 0);
    const marks = Object.fromEntries(
      dry.output.conflicts.map((c) => [c.path, c.reconcile]));
    assert.equal(marks['.tasksystem/instructions.md'], true);
    assert.equal(marks['CLAUDE.md'], false);

    const applied = await call(
      ['update', '--project', f.dir, '--reconcile', '--apply']);
    assert.equal(applied.code, 0);
    assert.ok(applied.output.reconciled.some(
      (r) => r.path === '.tasksystem/instructions.md'));
    assert.ok(applied.output.conflicts.some((c) => c.path === 'CLAUDE.md'));
    assert.equal(fs.readFileSync(
      path.join(f.dir, '.tasksystem/instructions.md'), 'utf8'), before);
    assert.equal(fs.readFileSync(path.join(f.dir, 'CLAUDE.md'), 'utf8'),
      'foreign edit');
  } finally { cleanup(f.dir); }
});

// ---------- backup -> restore ----------

test('backup --apply exports a manifest bundle; restore recreates only missing files', async () => {
  const f = configFixture();
  try {
    writeJson(f.dir, '.tasksystem/plans/p1.json', { key: 'p1' });
    writeJson(f.dir, '.tasksystem/state/note.json', { n: 1 });
    const overlap = await call(
      ['backup', '--project', f.dir, '--to', '.tasksystem/state/inside']);
    assert.equal(overlap.code, 1);
    assert.equal(overlap.output.code, 'BACKUP_DESTINATION_OVERLAP');

    const dry = await call(['backup', '--project', f.dir, '--to', 'backups/b1']);
    assert.equal(dry.code, 0);
    assert.equal(dry.output.mode, 'dry-run');
    assert.equal(dry.output.status, 'absent');
    const rels = dry.output.entries.map((e) => e.rel);
    assert.ok(rels.includes(CONFIG_REL));
    assert.ok(rels.includes('.tasksystem/plans/p1.json'));
    assert.ok(!exists(f.dir, 'backups/b1')); // preview writes nothing

    const applied = await call(
      ['backup', '--project', f.dir, '--to', 'backups/b1', '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.output.mode, 'applied');
    assert.ok(exists(f.dir, 'backups/b1/manifest.json'));
    assert.ok(exists(f.dir, 'backups/b1/files/.tasksystem/plans/p1.json'));

    // Remove one source; restore must classify it create and rebuild it.
    fs.unlinkSync(path.join(f.dir, '.tasksystem/plans/p1.json'));
    const rdry = await call(
      ['restore', '--project', f.dir, '--from', 'backups/b1']);
    assert.equal(rdry.code, 0);
    assert.equal(rdry.output.mode, 'dry-run');
    const entry = rdry.output.entries
      .find((e) => e.rel === '.tasksystem/plans/p1.json');
    assert.equal(entry.action, 'create');
    assert.ok(rdry.output.entries.some((e) => e.action === 'skip'
      && e.reason === 'identical'));
    assert.ok(!exists(f.dir, '.tasksystem/plans/p1.json'));

    const rapplied = await call(
      ['restore', '--project', f.dir, '--from', 'backups/b1', '--apply']);
    assert.equal(rapplied.code, 0);
    assert.ok(rapplied.output.restored.includes('.tasksystem/plans/p1.json'));
    assert.deepEqual(readJson(f.dir, '.tasksystem/plans/p1.json'), { key: 'p1' });
  } finally { cleanup(f.dir); }
});

// ---------- uninstall ----------

test('uninstall deletes harness bytes and leaves tampered files behind', async () => {
  const f = configFixture();
  try {
    // Materialize the generated tree via update --apply first.
    const up = await call(['update', '--project', f.dir, '--apply']);
    assert.equal(up.code, 0);
    writeJson(f.dir, '.tasksystem/plans/user-plan.json', { key: 'mine' });
    fs.writeFileSync(path.join(f.dir, '.tasksystem/instructions.md'),
      'user edited');

    const dry = await call(['uninstall', '--project', f.dir]);
    assert.equal(dry.code, 0);
    assert.equal(dry.output.mode, 'dry-run');
    const candRels = dry.output.candidates.map((c) => c.rel);
    assert.ok(candRels.includes(CONFIG_REL));
    assert.ok(!candRels.includes('.tasksystem/plans/user-plan.json'));
    assert.ok(dry.output.leftBehind
      .some((l) => l.rel === '.tasksystem/instructions.md'));

    const applied = await call(['uninstall', '--project', f.dir, '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.output.mode, 'applied');
    assert.ok(applied.output.deleted.includes(CONFIG_REL));
    assert.ok(applied.output.leftBehind
      .some((l) => l.rel === '.tasksystem/instructions.md'));
    // Tampered and user files survive untouched.
    assert.equal(fs.readFileSync(
      path.join(f.dir, '.tasksystem/instructions.md'), 'utf8'), 'user edited');
    assert.ok(exists(f.dir, '.tasksystem/plans/user-plan.json'));
    assert.ok(!exists(f.dir, CONFIG_REL));
  } finally { cleanup(f.dir); }
});

// ---------- investigate ----------

test('investigate reports suggestions; --save writes the record create-only', async () => {
  const f = configFixture();
  try {
    writeJson(f.dir, 'package.json', { name: 'probe-project' });
    const dry = await call(['investigate', '--project', f.dir]);
    assert.equal(dry.code, 0);
    assert.equal(dry.output.investigation.schemaVersion, 1);
    assert.equal(dry.output.investigation.harness.configured, true);
    assert.equal(
      Object.keys(dry.output.investigation.harness.artifactDirs).length, 7);
    assert.equal(dry.output.suggestions.name.value, 'probe-project');

    const saved = await call(
      ['investigate', '--project', f.dir, '--save']);
    assert.equal(saved.code, 0);
    assert.equal(saved.output.research.saved, true);
    assert.match(saved.output.research.path,
      /^\.tasksystem\/research\/semantic-[0-9a-f]{16}\.json$/);
    const record = readJson(f.dir, saved.output.research.path);
    assert.equal(record.schemaVersion, 1);
    assert.equal(record.suggestions.name.value, 'probe-project');

    // Deterministic record: a second save is a noop, never a conflict.
    const again = await call(['investigate', '--project', f.dir, '--save']);
    assert.equal(again.code, 0);
    assert.equal(again.output.research.created, 0);
  } finally { cleanup(f.dir); }
});

test('investigate --save without a config emits the record and writes nothing', async () => {
  const dir = makeTempDir('cli-w2-inv');
  try {
    writeJson(dir, 'package.json', { name: 'bare' });
    const result = await call(['investigate', '--project', dir, '--save']);
    assert.equal(result.code, 0);
    assert.equal(result.output.investigation.harness.configured, false);
    assert.equal(result.output.research.saved, false);
    assert.match(result.output.research.suggestedPath,
      /^semantic-[0-9a-f]{16}\.json$/);
    assert.equal(result.output.research.record.schemaVersion, 1);
    assert.deepEqual(Object.keys(tree(dir)), ['package.json']);
  } finally { cleanup(dir); }
});

// ---------- host activate ----------

test('host activate previews and applies a documented host', async () => {
  const f = configFixture({ hosts: ['claude'] });
  try {
    const dry = await call(
      ['host', 'activate', '--project', f.dir, '--host', 'claude']);
    assert.equal(dry.code, 0);
    assert.equal(dry.output.mode, 'dry-run');
    assert.equal(dry.output.host, 'claude');
    assert.ok(dry.output.files.every((x) => x.action === 'create'));
    assert.ok(!exists(f.dir, '.claude'));

    const applied = await call(
      ['host', 'activate', '--project', f.dir, '--host', 'claude', '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.output.mode, 'applied');
    assert.ok(applied.output.applied > 0);
    assert.ok(exists(f.dir, '.claude/skills'));

    const bad = await call(
      ['host', 'activate', '--project', f.dir, '--host', 'gpt']);
    assert.equal(bad.code, 1);
    assert.equal(bad.output.code, 'UNKNOWN_HOST');
    const unselected = await call(
      ['host', 'activate', '--project', f.dir, '--host', 'codex']);
    assert.equal(unselected.code, 1);
    assert.equal(unselected.output.code, 'HOST_NOT_SELECTED');
  } finally { cleanup(f.dir); }
});

test('host activate hermes is provisional and never writes global paths', async () => {
  const f = configFixture({ hosts: ['hermes'] });
  try {
    // Put the generated hermes proposals on disk so destinations classify
    // as noop, exactly like the module-level fixture.
    const native = renderNativeAdapters(f.ctx.config,
      { configRel: CONFIG_REL, projectRoot: f.dir });
    applyPlan(f.dir, native.files.map((x) => ({ rel: x.rel, content: x.content })));

    const dry = await call(
      ['host', 'activate', '--project', f.dir, '--host', 'hermes']);
    assert.equal(dry.code, 0);
    assert.equal(dry.output.format, 'provisional');
    assert.ok(dry.output.skipped
      .some((s) => String(s.destination).startsWith('~')));

    const applied = await call(
      ['host', 'activate', '--project', f.dir, '--host', 'hermes', '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.output.applied, 0);
    assert.ok(!exists(f.dir, '.hermes'));
    assert.ok(!exists(f.dir, '~'));
  } finally { cleanup(f.dir); }
});

// ---------- capture proposals / review ----------

test('capture proposals lists journal events and init-answer preferences', async () => {
  const f = enrolledFixture();
  try {
    const input = path.join(f.dir, 'cap.json');
    fs.writeFileSync(input, JSON.stringify({
      category: 'decision', title: 'Chose X', summary: 'Because Y',
      areaIds: [f.a, f.b], basis: 'declared' }));
    const created = await call(['capture', 'create', '--project', f.dir,
      '--input', input, '--apply']);
    assert.equal(created.code, 0);

    const listed = await call(['capture', 'proposals', '--project', f.dir]);
    assert.equal(listed.code, 0);
    const proposals = listed.output.proposals;
    const event = proposals.find((p) => p.provenance.producer === 'journal');
    assert.ok(event);
    assert.equal(event.provenance.recordId, created.output.record.id);
    assert.equal(event.category, 'event');
    assert.equal(event.statement.kind, 'declared');
    const prefs = proposals
      .filter((p) => p.provenance.producer === 'init-answers');
    assert.ok(prefs.length > 0);
    assert.ok(prefs.every((p) => p.category === 'preference'));
    assert.deepEqual(prefs[0].suggestedAreaIds, [f.a, f.b].sort());

    // --since-sequence filters journal proposals only.
    const filtered = await call(['capture', 'proposals', '--project', f.dir,
      '--since-sequence', '999999']);
    assert.equal(filtered.code, 0);
    assert.ok(!filtered.output.proposals
      .some((p) => p.provenance.producer === 'journal'));
    assert.ok(filtered.output.proposals
      .some((p) => p.provenance.producer === 'init-answers'));
  } finally { cleanup(f.dir); }
});

test('capture review resolves decisions and --apply creates an owned capture', async () => {
  const f = enrolledFixture();
  try {
    const input = path.join(f.dir, 'cap.json');
    fs.writeFileSync(input, JSON.stringify({
      category: 'decision', title: 'Chose X', summary: 'Because Y',
      areaIds: [f.a, f.b], basis: 'declared' }));
    const created = await call(['capture', 'create', '--project', f.dir,
      '--input', input, '--apply']);
    assert.equal(created.code, 0);
    const listed = await call(['capture', 'proposals', '--project', f.dir]);
    const proposal = listed.output.proposals
      .find((p) => p.provenance.producer === 'journal');

    const reviewFile = path.join(f.dir, 'review.json');
    fs.writeFileSync(reviewFile, JSON.stringify(
      { proposal, action: 'approve' }));
    const dry = await call(['capture', 'review', '--project', f.dir,
      '--input', reviewFile]);
    assert.equal(dry.code, 0);
    assert.equal(dry.output.mode, 'dry-run');
    assert.equal(dry.output.review.status, 'approved');
    assert.deepEqual(dry.output.review.input.areaIds, [f.a, f.b].sort());

    const applied = await call(['capture', 'review', '--project', f.dir,
      '--input', reviewFile, '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.output.mode, 'applied');
    assert.equal(applied.output.journal.status, 'committed');
    assert.ok(exists(f.dir, applied.output.sourceRel));
    // The approved proposal became a new capture record (distinct id).
    assert.notEqual(applied.output.record.id, created.output.record.id);
    assert.equal(applied.output.record.category, 'event');

    const rejectFile = path.join(f.dir, 'reject.json');
    fs.writeFileSync(rejectFile, JSON.stringify(
      { proposal, action: 'reject', reason: 'not worth it' }));
    const rejected = await call(['capture', 'review', '--project', f.dir,
      '--input', rejectFile, '--apply']);
    assert.equal(rejected.code, 0);
    assert.equal(rejected.output.applied, false);
    assert.equal(rejected.output.review.status, 'rejected');

    const badFile = path.join(f.dir, 'badreview.json');
    fs.writeFileSync(badFile, JSON.stringify(
      { proposal, action: 'maybe' }));
    const bad = await call(['capture', 'review', '--project', f.dir,
      '--input', badFile]);
    assert.equal(bad.code, 1);
    assert.equal(bad.output.code, 'INVALID_PROPOSAL');
  } finally { cleanup(f.dir); }
});

// ---------- view ----------

test('view binds loopback, serves health and stays up until closed', async () => {
  const f = configFixture();
  try {
    const result = await call(
      ['view', '--project', f.dir, '--port', '0']);
    assert.equal(result.code, 0);
    assert.equal(result.output.host, '127.0.0.1');
    assert.ok(Number.isInteger(result.output.port) && result.output.port > 0);
    assert.match(result.output.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.ok(result.io.viewServer, 'io.viewServer must expose the handle');
    const res = await fetch(`${result.output.url}api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.api, 'scopegrain-viewer');
    await result.io.viewServer.close();
  } finally { cleanup(f.dir); }
});

test('view rejects non-loopback hosts and bad ports', async () => {
  const f = configFixture();
  try {
    const bad = await call(
      ['view', '--project', f.dir, '--host', '0.0.0.0']);
    assert.equal(bad.code, 1);
    assert.equal(bad.output.code, 'INVALID_HOST');
    assert.equal(bad.io.viewServer, undefined);
  } finally { cleanup(f.dir); }
});
