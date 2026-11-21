// SPDX-License-Identifier: Apache-2.0
// Exact CLI surface for typed captures: capture create/show are thin
// grouped commands over createCaptureStore; no shortcuts or writers.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../src/cli.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import { prepareWorkspace } from '../src/core/workspaces.mjs';
import { VALID_ANSWERS, cleanup, fakeIO, makeTempDir, writeJson }
  from './helpers.mjs';

function fixture({ memory = '.tasksystem/memory', state = '.tasksystem/state',
  configRel = '.tasksystem/config.json' } = {}) {
  const dir = makeTempDir('cli-captures');
  const answers = { ...VALID_ANSWERS,
    paths: { ...VALID_ANSWERS.paths, memory, state } };
  writeJson(dir, configRel, createConfig(dir, answers, {}));
  const ctx = resolveContext({ project: dir, config: configRel });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  return { dir, ctx, configRel, memory, state, a, b };
}

async function call(args) {
  const io = fakeIO();
  const code = await run(args, io);
  return { code, output: code === 0 ? JSON.parse(io.out.stdout.at(-1))
    : JSON.parse(io.out.stderr.at(-1)).error };
}

function tree(dir) {
  const result = {};
  function visit(abs, rel = '') {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        result[next] = 'directory';
        visit(path.join(abs, entry.name), next);
      } else result[next] = fs.readFileSync(path.join(abs, entry.name));
    }
  }
  if (fs.existsSync(dir)) visit(dir);
  return result;
}

function noteInput(f, overrides = {}) {
  const file = path.join(f.dir, 'capture-input.json');
  fs.writeFileSync(file, JSON.stringify({
    category: 'event', title: 'T', summary: 'S', areaIds: [f.a, f.b],
    ...overrides }));
  return file;
}

test('capture help lists exactly the authored grouped usages', async () => {
  const result = await call(['--help']);
  assert.equal(result.code, 0);
  const usages = result.output.commands.map((command) => command.command);
  assert.ok(usages.includes(
    'capture create --project PATH [--config REL] --input FILE [--apply]'));
  assert.ok(usages.includes(
    'capture show UUID --project PATH [--config REL]'));
});

test('capture commands require project, input, exact flags and positionals', async () => {
  const f = fixture();
  try {
    const file = noteInput(f);
    for (const args of [
      ['capture', 'create', '--input', file],
      ['capture', 'create', '--project', f.dir],
      ['capture', 'create', '--project', f.dir, '--input', file, 'extra'],
      ['capture', 'create', '--project', f.dir, '--input', file, '--bogus', 'x'],
      ['capture', 'create', '--project', f.dir,
        '--input', path.join(f.dir, 'never-created.json'), '--namespace', 'x'],
      ['capture', 'create', '--project', f.dir, '--input', file, '--yes'],
      ['capture', 'create', '--project', f.dir, '--input', file, '--force'],
      ['capture', 'show', '--project', f.dir],
      ['capture', 'show', 'id1', 'id2', '--project', f.dir],
      ['capture', 'show', 'id1', '--project', f.dir, '--input', file],
      ['capture', 'show', 'id1', '--project', f.dir, '--apply'],
      ['capture', 'frobnicate', '--project', f.dir],
    ]) {
      const result = await call(args);
      assert.equal(result.code, 1, JSON.stringify(args));
      assert.equal(result.output.code, 'INVALID_ARGS', JSON.stringify(args));
    }
  } finally { cleanup(f.dir); }
});

test('preview is read-only with distinct provisional ids; apply proves and show returns current record', async () => {
  const f = fixture({ memory: '.scopegrain/memory', state: '.scopegrain/state',
    configRel: '.scopegrain/config.json' });
  try {
    const file = noteInput(f, { category: 'decision', basis: 'declared' });
    const before = tree(f.dir);
    const preview = await call(['capture', 'create', '--project', f.dir,
      '--config', f.configRel, '--input', file]);
    assert.equal(preview.code, 0);
    assert.equal(preview.output.mode, 'dry-run');
    assert.equal(preview.output.reservesIds, false);
    assert.match(preview.output.record.id,
      /^[0-9a-f-]{36}$/);
    assert.equal(preview.output.sourceRel,
      `.scopegrain/memory/captures/${preview.output.record.id}.json`);
    const again = await call(['capture', 'create', '--project', f.dir,
      '--input', file]);
    assert.equal(again.code, 0);
    assert.notEqual(again.output.record.id, preview.output.record.id);
    assert.deepEqual(tree(f.dir), before);
    const applied = await call(['capture', 'create', '--project', f.dir,
      '--config', f.configRel, '--input', file, '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.output.mode, 'applied');
    assert.equal(applied.output.ownershipConfirmed, true);
    assert.equal(applied.output.journal.status, 'committed');
    assert.equal(applied.output.journal.journalState, 'confirmed');
    assert.equal(applied.output.journal.eventIds.length, 2);
    const record = applied.output.record;
    assert.equal(record.provenance.basis, 'declared');
    assert.equal(record.provenance.origin, 'local-cli');
    assert.equal(record.subjectId, null);
    assert.equal(record.authenticated, undefined);
    const shown = await call(['capture', 'show', record.id, '--project', f.dir,
      '--config', f.configRel]);
    assert.equal(shown.code, 0);
    assert.equal(shown.output.isCurrentSource, true);
    assert.equal(shown.output.memoryConsulted, false);
    assert.deepEqual(shown.output.record, record);
    assert.equal(shown.output.locator.operationId,
      applied.output.journal.operationId);
    const preference = noteInput(f, { category: 'preference', subjectId: 'me',
      basis: 'declared' });
    const pref = await call(['capture', 'create', '--project', f.dir,
      '--config', f.configRel, '--input', preference, '--apply']);
    assert.equal(pref.code, 0);
    assert.equal(pref.output.record.provenance.basis, 'declared');
    assert.equal(pref.output.record.subjectId, 'me');
    assert.equal(pref.output.record.provenance.authenticated, undefined);
  } finally { cleanup(f.dir); }
});

test('custom config and paths are honored without writing default directories', async () => {
  const f = fixture({ memory: 'x/mem', state: 'y/state',
    configRel: 'cfg/config.json' });
  try {
    const file = noteInput(f);
    const applied = await call(['capture', 'create', '--project', f.dir,
      '--config', f.configRel, '--input', file, '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.output.sourceRel.startsWith('x/mem/captures/'), true);
    assert.equal(applied.output.ownershipRel.startsWith(
      'y/state/record-ownership/capture/'), true);
    assert.equal(fs.existsSync(path.join(f.dir, '.tasksystem/memory')), false);
    assert.equal(fs.existsSync(path.join(f.dir, '.scopegrain')), false);
    const shown = await call(['capture', 'show', applied.output.record.id,
      '--project', f.dir, '--config', f.configRel]);
    assert.equal(shown.code, 0);
  } finally { cleanup(f.dir); }
});

test('bounded input and closed DTO are validated before workspace trust', async () => {
  const empty = makeTempDir('cli-captures-empty');
  try {
    const bad = path.join(empty, 'bad.json');
    fs.writeFileSync(bad, '{not json');
    const malformed = await call(['capture', 'create', '--project', empty,
      '--input', bad]);
    assert.equal(malformed.code, 1);
    assert.equal(malformed.output.code, 'MALFORMED_JSON');
  } finally { cleanup(empty); }
  const f = fixture();
  try {
    const huge = path.join(f.dir, 'huge.json');
    fs.writeFileSync(huge, JSON.stringify({ category: 'event', title: 'x',
      summary: 's', areaIds: [f.a],
      pad: 'x'.repeat(loadLimits().maxDocumentBytes) }));
    const tooLarge = await call(['capture', 'create', '--project', f.dir,
      '--config', f.configRel, '--input', huge]);
    assert.equal(tooLarge.code, 1);
    assert.equal(tooLarge.output.code, 'INPUT_TOO_LARGE');
    const before = tree(f.dir);
    const withoutInput = (t) => {
      const copy = { ...t };
      delete copy['capture-input.json'];
      return copy;
    };
    for (const overrides of [
      { origin: 'evil' }, { id: crypto.randomUUID() }, { workspaceId: 'x' },
      { sourceRel: 'a/b.json' }, { namespace: 'n' }, { sourceHash: 'h' },
      { messages: [] }, { transcript: 'x' }, { category: 'preference' },
      { areaIds: ['x'] }, { areaIds: [] },
    ]) {
      const file = noteInput(f, overrides);
      const result = await call(['capture', 'create', '--project', f.dir,
        '--config', f.configRel, '--input', file, '--apply']);
      assert.equal(result.code, 1, JSON.stringify(overrides));
      assert.equal(result.output.code, 'INVALID_CAPTURE_INPUT',
        JSON.stringify(overrides));
      assert.deepEqual(withoutInput(tree(f.dir)), withoutInput(before),
        JSON.stringify(overrides));
    }
    assert.equal(fs.existsSync(path.join(f.dir, f.memory, 'captures')), false);
  } finally { cleanup(f.dir); }
});

test('show fails closed on drift or missing files without returning history', async () => {
  const f = fixture();
  try {
    const file = noteInput(f);
    const applied = await call(['capture', 'create', '--project', f.dir,
      '--config', f.configRel, '--input', file, '--apply']);
    const srcAbs = path.join(f.dir, ...applied.output.sourceRel.split('/'));
    const ownAbs = path.join(f.dir, ...applied.output.ownershipRel.split('/'));
    fs.writeFileSync(srcAbs, '{}');
    let shown = await call(['capture', 'show', applied.output.record.id,
      '--project', f.dir, '--config', f.configRel]);
    assert.equal(shown.code, 1);
    assert.equal(shown.output.code, 'CAPTURE_SOURCE_CHANGED');
    fs.unlinkSync(srcAbs);
    shown = await call(['capture', 'show', applied.output.record.id,
      '--project', f.dir, '--config', f.configRel]);
    assert.equal(shown.output.code, 'CAPTURE_NOT_FOUND');
    fs.unlinkSync(ownAbs);
    shown = await call(['capture', 'show', applied.output.record.id,
      '--project', f.dir, '--config', f.configRel]);
    assert.equal(shown.output.code, 'CAPTURE_NOT_FOUND');
  } finally { cleanup(f.dir); }
});

test('capture review --apply approves a generated preference proposal '
    + 'verbatim (regression)', async () => {
  const f = fixture();
  try {
    const listed = await call(['capture', 'proposals', '--project', f.dir,
      '--config', f.configRel]);
    assert.equal(listed.code, 0);
    const prefs = listed.output.proposals.filter(
      (p) => p.provenance.producer === 'init-answers');
    assert.ok(prefs.length >= 4);
    for (const p of prefs) assert.notEqual(p.suggestedSubjectId, null);
    // Verbatim approve: no edit, no changes. Previously this failed with
    // INVALID_CAPTURE_INPUT because suggestedSubjectId was null.
    const reviewFile = path.join(f.dir, 'review.json');
    fs.writeFileSync(reviewFile,
      JSON.stringify({ proposal: prefs[0], action: 'approve' }));
    const applied = await call(['capture', 'review', '--project', f.dir,
      '--config', f.configRel, '--input', reviewFile, '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.output.mode, 'applied');
    assert.equal(applied.output.review.status, 'approved');
    assert.equal(applied.output.record.category, 'preference');
    assert.equal(applied.output.record.subjectId, 'locale');
    const shown = await call(['capture', 'show', applied.output.record.id,
      '--project', f.dir, '--config', f.configRel]);
    assert.equal(shown.code, 0);
    assert.equal(shown.output.isCurrentSource, true);
  } finally { cleanup(f.dir); }
});

test('a commit-marker failure preserves the full uncertain receipt at exit 0', async () => {
  const f = fixture();
  try {
    const file = noteInput(f);
    const open = fs.openSync;
    fs.openSync = function (file_, flags, ...args) {
      if (String(file_).endsWith(`${path.sep}commit.json`)) {
        throw Object.assign(new Error('marker write failed'), { code: 'EIO' });
      }
      return open.call(this, file_, flags, ...args);
    };
    let applied;
    try {
      applied = await call(['capture', 'create', '--project', f.dir,
        '--config', f.configRel, '--input', file, '--apply']);
    } finally { fs.openSync = open; }
    assert.equal(applied.code, 0);
    assert.equal(applied.output.mode, 'applied');
    assert.equal(applied.output.ownershipConfirmed, false);
    assert.equal(applied.output.journal.status, 'committed');
    assert.equal(applied.output.journal.journalState, 'pending-finalization');
    assert.equal(applied.output.journal.eventIds.length, 2);
    assert.notEqual(applied.output.journal.cause, null);
    const shown = await call(['capture', 'show', applied.output.record.id,
      '--project', f.dir, '--config', f.configRel]);
    assert.equal(shown.code, 1);
    assert.equal(shown.output.code, 'CAPTURE_NOT_COMMITTED');
  } finally { cleanup(f.dir); }
});
