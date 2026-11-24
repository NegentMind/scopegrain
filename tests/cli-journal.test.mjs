// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../src/cli.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { applyJournaledCreation, getJournalOperation } from '../src/core/journal.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import { VALID_ANSWERS, cleanup, fakeIO, makeTempDir, writeJson } from './helpers.mjs';

function fixture() {
  const dir = makeTempDir('cli-journal');
  const configRel = 'custom/config.json';
  const answers = { ...VALID_ANSWERS,
    paths: { ...VALID_ANSWERS.paths, state: 'custom/state' } };
  writeJson(dir, configRel, createConfig(dir, answers, {}));
  const ctx = resolveContext({ project: dir, config: configRel });
  const workspace = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [workspace.file]);
  const areaIds = workspace.workspace.areas.map((area) => area.id);
  return { dir, ctx, configRel, bound: bindWorkspace(ctx, { areaIds }),
    a: areaIds[0], journal: path.join(dir, 'custom/state/journal') };
}

function change(f, name) {
  return { sourceKind: 'task', recordId: name, sourceRevision: 0,
    areaIds: [f.a], file: { rel: `records/${name}`, content: name } };
}

function makeOperation(f, prepared) {
  const rename = fs.renameSync;
  const open = fs.openSync;
  try {
    if (prepared) {
      fs.openSync = function (file, flags, ...args) {
        if (file === path.join(f.dir, 'records/item') && flags === 'wx') {
          throw new Error('fixture source failure');
        }
        return open.call(this, file, flags, ...args);
      };
    } else {
      fs.renameSync = function (from, to, ...args) {
        if (to === path.join(f.journal, 'head.json')
            && JSON.parse(fs.readFileSync(from)).activeOperation === null) {
          throw new Error('fixture head cleanup failure');
        }
        return rename.call(this, from, to, ...args);
      };
    }
    return applyJournaledCreation(f.bound, [change(f, 'item')]);
  } finally { fs.renameSync = rename; fs.openSync = open; }
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
      if (entry.isDirectory()) { result[next] = 'directory'; visit(path.join(abs, entry.name), next); }
      else result[next] = fs.readFileSync(path.join(abs, entry.name));
    }
  }
  visit(dir);
  return result;
}

test('journal help lists exactly the authored grouped usages', async () => {
  const result = await call(['--help']);
  assert.equal(result.code, 0);
  const usages = result.output.commands.map((command) => command.command);
  assert.ok(usages.includes('journal list --project PATH [--config REL] [--since-sequence N] [--limit N]'));
  assert.ok(usages.includes('journal show OPERATION --project PATH [--config REL]'));
  assert.ok(usages.includes('journal recover OPERATION --project PATH [--config REL] --input FILE [--apply]'));
});

test('journal list pages unacknowledged events within the bound', async () => {
  const f = fixture();
  try {
    const ops = [applyJournaledCreation(f.bound, [change(f, 'item-a')]),
      applyJournaledCreation(f.bound, [change(f, 'item-b')])];
    const eventIds = ops.flatMap((op) => op.eventIds);
    const listed = await call(['journal', 'list', '--project', f.dir,
      '--config', f.configRel]);
    assert.equal(listed.code, 0);
    assert.equal(listed.output.items.length, eventIds.length);
    assert.deepEqual(listed.output.items.map((i) => i.event.eventId).sort(),
      eventIds.sort());
    assert.equal(listed.output.nextAfterSequence, null);
    // --limit truncates the page and exposes the continuation cursor.
    const paged = await call(['journal', 'list', '--project', f.dir,
      '--config', f.configRel, '--limit', '1']);
    assert.equal(paged.code, 0);
    assert.equal(paged.output.items.length, 1);
    const cursor = paged.output.nextAfterSequence;
    assert.ok(Number.isSafeInteger(cursor));
    const rest = await call(['journal', 'list', '--project', f.dir,
      '--config', f.configRel, '--since-sequence', String(cursor)]);
    assert.equal(rest.code, 0);
    assert.equal(rest.output.items.length, eventIds.length - 1);
    assert.equal(rest.output.nextAfterSequence, null);
    // Non-decimal cursors and limits fail at the CLI boundary
    // (INVALID_ARGS); a well-formed value rejected by the journal domain
    // still reports INVALID_JOURNAL_INPUT.
    for (const bad of [['--since-sequence', 'x'], ['--since-sequence', '-1'],
        ['--limit', 'NaN']]) {
      const rejected = await call(['journal', 'list', '--project', f.dir,
        '--config', f.configRel, ...bad]);
      assert.equal(rejected.code, 1);
      assert.equal(rejected.output.code, 'INVALID_ARGS');
    }
    const rejected = await call(['journal', 'list', '--project', f.dir,
      '--config', f.configRel, '--limit', '0']);
    assert.equal(rejected.code, 1);
    assert.equal(rejected.output.code, 'INVALID_JOURNAL_INPUT');
  } finally { cleanup(f.dir); }
});

test('journal show and both recovery previews are read-only with custom state/config', async () => {
  for (const isPrepared of [true, false]) {
    const f = fixture();
    try {
      const r = makeOperation(f, isPrepared);
      const input = path.join(f.dir, 'input.json');
      const action = isPrepared ? 'abandon-prepared' : 'finalize-committed';
      fs.writeFileSync(input, JSON.stringify({ action, reason: 'local operator',
        expectedIntentDigest: getJournalOperation(f.bound, r.operationId).intentDigest }));
      const before = tree(f.dir);
      const show = await call(['journal', 'show', r.operationId, '--project', f.dir,
        '--config', f.configRel]);
      assert.equal(show.code, 0);
      assert.equal(show.output.intent.operationId, r.operationId);
      assert.equal(show.output.recovery, null);
      const preview = await call(['journal', 'recover', r.operationId, '--project', f.dir,
        '--config', f.configRel, '--input', input]);
      assert.equal(preview.code, 0);
      assert.equal(preview.output.mode, 'dry-run');
      assert.equal(preview.output.action, action);
      assert.equal(preview.output.recovery, null);
      assert.deepEqual(tree(f.dir), before);
    } finally { cleanup(f.dir); }
  }
});

test('journal recover apply creates receipt and unlocks later writes', async () => {
  for (const isPrepared of [true, false]) {
    const f = fixture();
    try {
      const r = makeOperation(f, isPrepared);
      const input = path.join(f.dir, 'input.json');
      const action = isPrepared ? 'abandon-prepared' : 'finalize-committed';
      fs.writeFileSync(input, JSON.stringify({ action, reason: 'local operator',
        expectedIntentDigest: getJournalOperation(f.bound, r.operationId).intentDigest }));
      const result = await call(['journal', 'recover', r.operationId, '--project', f.dir,
        '--config', f.configRel, '--input', input, '--apply']);
      assert.equal(result.code, 0);
      assert.equal(result.output.mode, 'applied');
      assert.equal(result.output.state, isPrepared ? 'abandoned' : 'committed');
      const receipt = path.join(f.journal, 'operations', r.operationId, 'recovery.json');
      assert.equal(JSON.parse(fs.readFileSync(receipt)).action, action);
      assert.equal(applyJournaledCreation(f.bound, [change(f, 'next')]).status, 'committed');
      assert.equal(fs.existsSync(path.join(f.dir, '.scopegrain')), false);
    } finally { cleanup(f.dir); }
  }
});

test('journal commands reject missing flags, extra args and invalid bounded JSON safely', async () => {
  const f = fixture();
  try {
    const r = makeOperation(f, false);
    const input = path.join(f.dir, 'input.json');
    const expectedIntentDigest = getJournalOperation(f.bound, r.operationId).intentDigest;
    fs.writeFileSync(input, JSON.stringify({ action: 'finalize-committed',
      expectedIntentDigest, reason: 'ok', extra: true }));
    const before = tree(f.dir);
    for (const args of [
      ['journal', 'show', r.operationId],
      ['journal', 'recover', r.operationId, '--project', f.dir, '--config', f.configRel],
      ['journal', 'show', r.operationId, 'extra', '--project', f.dir, '--config', f.configRel],
      ['journal', 'show', r.operationId, '--project', f.dir, '--config', f.configRel, '--apply'],
      ['journal', 'recover', r.operationId, '--project', f.dir, '--config', f.configRel,
        '--input', input, '--force'],
      ['journal', 'recover', r.operationId, '--project', f.dir, '--config', f.configRel,
        '--input', input, '--apply'],
    ]) {
      assert.equal((await call(args)).code, 1);
    }
    assert.deepEqual(tree(f.dir), before);
    fs.writeFileSync(input, '{bad');
    const malformed = await call(['journal', 'recover', r.operationId, '--project', f.dir,
      '--config', f.configRel, '--input', input, '--apply']);
    assert.equal(malformed.output.code, 'MALFORMED_JSON');
    fs.writeFileSync(input, 'x'.repeat(loadLimits().maxDocumentBytes + 1));
    const oversized = await call(['journal', 'recover', r.operationId, '--project', f.dir,
      '--config', f.configRel, '--input', input, '--apply']);
    assert.equal(oversized.output.code, 'INPUT_TOO_LARGE');
    assert.equal(fs.existsSync(path.join(f.journal, 'operations', r.operationId, 'recovery.json')), false);
  } finally { cleanup(f.dir); }
});
