// SPDX-License-Identifier: Apache-2.0
// Opt-in CLI contracts only. Ownership proof remains core-authored;
// local all-area grants are not authenticated actor authorization.
import test from 'node:test';
import assert from 'node:assert/strict';
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

const UNKNOWN = '01234567-89ab-4cde-8fab-0123456789ab';
const UPPERCASE = 'ABCDEF12-3456-4789-8ABC-DEF012345678';
const SPEC = {
  originalRequest: 'Preserve the original owned CLI request verbatim.',
  title: 'Owned CLI specification',
  outcome: { statement: 'Explicit owned creation',
    evidencePlan: 'CLI contract assertions' },
  requirements: [{ id: 'R1', statement: 'Preserve opt-in behavior',
    scenarios: [{ id: 'S1', given: 'an enrolled workspace',
      when: 'owned creation is applied', then: 'current proof is readable' }] }],
  scope: ['src/settings'], constraints: [], nonGoals: [],
  openQuestions: [], references: [],
};

function fixture({ plans = '.scopegrain/plans', state = '.scopegrain/state',
  configRel = '.scopegrain/config.json', enrolled = true } = {}) {
  const dir = makeTempDir('cli-owned-specifications');
  const answers = { ...VALID_ANSWERS,
    paths: { ...VALID_ANSWERS.paths, plans, state,
      memory: '.scopegrain/memory' } };
  writeJson(dir, configRel, createConfig(dir, answers, {}));
  const ctx = resolveContext({ project: dir, config: configRel });
  let workspace = null;
  if (enrolled) {
    const prepared = prepareWorkspace(ctx, {
      areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
    });
    applyPlan(dir, [prepared.file]);
    workspace = prepared.workspace;
  }
  const [a, b] = workspace?.areas.map((area) => area.id) ?? [];
  return { dir, ctx, plans, state, configRel, workspace, a, b };
}

// Preserve every entry and exact byte, including locks; never follow links.
function tree(root) {
  const out = {};
  function visit(dir, prefix = '') {
    for (const name of fs.readdirSync(dir).sort()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const abs = path.join(dir, name);
      const st = fs.lstatSync(abs);
      out[rel] = st.isSymbolicLink() ? { link: fs.readlinkSync(abs) }
        : st.isDirectory() ? 'directory' : fs.readFileSync(abs);
      if (st.isDirectory() && !st.isSymbolicLink()) visit(abs, rel);
    }
  }
  visit(root);
  return out;
}

async function call(args, expected = 0) {
  const io = fakeIO();
  const code = await run(args, io);
  assert.equal(code, expected, JSON.stringify({ args, ...io.out }));
  assert.deepEqual(io.out.asked, []);
  if (expected === 0) {
    assert.deepEqual(io.out.stderr, []);
    assert.equal(io.out.stdout.length, 1);
    return JSON.parse(io.out.stdout[0]);
  }
  assert.deepEqual(io.out.stdout, []);
  assert.equal(io.out.stderr.length, 1);
  const payload = JSON.parse(io.out.stderr[0]);
  assert.deepEqual(Object.keys(payload), ['error']);
  assert.equal(typeof payload.error.message, 'string');
  return payload.error;
}

function args(f, rest, explicit = false) {
  return [...rest, '--project', f.dir,
    ...(explicit ? ['--config', f.configRel] : [])];
}

async function readonly(root, argv, expected = 0) {
  const before = tree(root);
  try { return await call(argv, expected); }
  finally { assert.deepEqual(tree(root), before); }
}

function envelope(f, overrides = {}) {
  return { areaIds: [f.a, f.b], specification: structuredClone(SPEC),
    ...overrides };
}

function input(f, value = envelope(f)) {
  return writeJson(f.dir, 'input.json', value);
}

async function create(f, file, apply = false, owned = true, explicit = false) {
  const argv = args(f, ['specification', 'create', '--input', file,
    ...(owned ? ['--owned'] : []), ...(apply ? ['--apply'] : [])], explicit);
  return apply ? call(argv) : readonly(f.dir, argv);
}

function scope(f, areaIds = [f.a, f.b]) {
  return { workspaceId: f.workspace.workspaceId,
    projectId: f.workspace.projectId, repositoryId: f.workspace.repositoryId,
    areaIds: [...areaIds].sort() };
}

function read(f, rel) {
  return JSON.parse(fs.readFileSync(path.join(f.dir, rel), 'utf8'));
}

test('help has exactly the specification usages, exact note and unchanged capture usages', async () => {
  const help = await call(['--help']);
  assert.deepEqual(help.commands.filter((c) => c.command.startsWith('specification '))
    .map((c) => c.command), [
    'specification clarify --project PATH --input FILE [--apply]',
    'specification create --project PATH --input FILE [--owned] [--apply]',
    'specification show --project PATH UUID [--owned]',
  ]);
  assert.ok(help.notes.includes('--owned opts specification create/show into journal ownership; legacy behavior stays unchanged without it'));
  assert.ok(help.commands.some((c) => c.command ===
    'capture create --project PATH [--config REL] --input FILE [--apply]'));
  assert.ok(help.commands.some((c) => c.command ===
    'capture show UUID --project PATH [--config REL]'));
});

test('owned commands require project/input and exact boolean flag/positional surface before input access', async (t) => {
  const f = fixture();
  try {
    const absent = path.join(f.dir, 'never-read-for-invalid-flags.json');
    const original = fs.lstatSync;
    let inputReads = 0;
    const spy = t.mock.method(fs, 'lstatSync', function (file, ...rest) {
      if (path.resolve(String(file)) === absent) inputReads++;
      return original.call(this, file, ...rest);
    });
    try {
      for (const argv of [
        ['specification', 'create', '--owned', '--input', absent],
        args(f, ['specification', 'create', '--owned']),
        ['specification', 'show', UNKNOWN, '--owned'],
        args(f, ['specification', 'show', '--owned']),
        args(f, ['specification', 'show', UNKNOWN, UNKNOWN, '--owned']),
        args(f, ['specification', 'create', '--owned', '--input', absent, 'extra']),
        args(f, ['specification', 'create', '--owned', 'true', '--input', absent]),
        args(f, ['specification', 'show', UNKNOWN, '--owned', 'true']),
        args(f, ['specification', 'show', UNKNOWN, '--owned', '--apply']),
        args(f, ['specification', 'show', UNKNOWN, '--owned', '--input', absent]),
        ...['--yes', '--force', '--bogus', '--namespace', '--title', '--scope',
          '--id', '--path'].map((flag) => args(f,
          ['specification', 'create', '--owned', '--input', absent, flag, 'x'])),
        ...['--yes', '--force'].map((flag) => args(f,
          ['specification', 'show', UNKNOWN, '--owned', flag])),
      ]) {
        const e = await readonly(f.dir, argv, 1);
        assert.equal(e.code, 'INVALID_ARGS', JSON.stringify(argv));
      }
      assert.equal(inputReads, 0);
    } finally { spy.mock.restore(); }
  } finally { cleanup(f.dir); }
});

test('--owned is forbidden outside supported typed create/show before input access', async (t) => {
  const f = fixture();
  try {
    const absent = path.join(f.dir, 'never-read-for-owned-on-other-command.json');
    const original = fs.lstatSync;
    let inputReads = 0;
    const spy = t.mock.method(fs, 'lstatSync', function (file, ...rest) {
      if (path.resolve(String(file)) === absent) inputReads++;
      return original.call(this, file, ...rest);
    });
    try {
      for (const command of [
        ['capture', 'create', '--input', absent],
        ['capture', 'show', UNKNOWN],
        ['task', 'create', '--input', absent],
        ['task', 'show', UNKNOWN],
        ['workspace', 'init', '--input', absent],
        ['workspace', 'show'],
        ['journal', 'show', UNKNOWN],
        ['journal', 'recover', UNKNOWN, '--input', absent],
      ]) {
        const e = await readonly(f.dir, args(f, [...command, '--owned']), 1);
        assert.equal(e.code, 'INVALID_ARGS', JSON.stringify(command));
      }
      assert.equal(inputReads, 0);
    } finally { spy.mock.restore(); }
  } finally { cleanup(f.dir); }
});

test('two owned previews reserve nothing; apply commits two events and show returns core proof unchanged', async () => {
  const f = fixture();
  try {
    const file = input(f);
    const before = tree(f.dir);
    const first = await create(f, file);
    const second = await create(f, file);
    for (const preview of [first, second]) {
      assert.deepEqual(Object.keys(preview).sort(),
        ['mode', 'ownershipRel', 'record', 'reservesIds', 'sourceRel']);
      assert.equal(preview.mode, 'dry-run');
      assert.equal(preview.reservesIds, false);
      assert.match(preview.record.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
      assert.equal(preview.record.schemaVersion, 2);
      assert.equal(preview.sourceRel, `${f.plans}/specs/${preview.record.id}.json`);
      assert.equal(preview.ownershipRel,
        `${f.state}/record-ownership/spec/${preview.record.id}.json`);
    }
    assert.notEqual(first.record.id, second.record.id);
    assert.deepEqual(tree(f.dir), before);
    const applied = await create(f, file, true);
    assert.deepEqual(Object.keys(applied).sort(),
      ['journal', 'mode', 'ownershipConfirmed', 'ownershipRel', 'record', 'sourceRel']);
    assert.equal(applied.mode, 'applied');
    assert.notEqual(applied.record.id, first.record.id);
    assert.notEqual(applied.record.id, second.record.id);
    assert.equal(applied.ownershipConfirmed, true);
    assert.equal(applied.journal.status, 'committed');
    assert.equal(applied.journal.journalState, 'confirmed');
    assert.equal(applied.journal.eventIds.length, 2);
    assert.equal(applied.record.kind, 'spec');
    assert.equal(applied.record.data.originalRequest, SPEC.originalRequest);
    assert.deepEqual(read(f, applied.sourceRel), applied.record);
    const ownership = read(f, applied.ownershipRel);
    assert.deepEqual(ownership.scope, scope(f));
    const op = await readonly(f.dir, args(f,
      ['journal', 'show', applied.journal.operationId]));
    assert.equal(op.state, 'committed');
    assert.equal(op.intent.events.length, 2);
    assert.deepEqual(op.intent.events.map((e) => e.sourceKind).sort(),
      ['record-ownership', 'spec']);
    for (const event of op.intent.events) {
      assert.equal(event.recordId, applied.record.id);
      assert.equal(event.operation, 'create');
      assert.equal(event.sourceRevision, 0);
      assert.deepEqual(event.areaIds, scope(f).areaIds);
    }
    const shown = await readonly(f.dir, args(f,
      ['specification', 'show', applied.record.id, '--owned']));
    assert.deepEqual(shown, {
      record: applied.record, ownership,
      locator: { operationId: applied.journal.operationId,
        eventId: op.intent.events.find((e) => e.sourceKind === 'spec').eventId },
      isCurrentSource: true, memoryConsulted: false,
    });
    // The legacy getter may read the V2 structure, but makes no proof claim.
    assert.deepEqual(await readonly(f.dir, args(f,
      ['specification', 'show', applied.record.id])), applied.record);
  } finally { cleanup(f.dir); }
});

for (const apply of [false, true]) {
  test(`unknown record area is SCOPE_DENIED without writes (apply=${apply})`, async () => {
    const f = fixture();
    try {
      const file = input(f, envelope(f, { areaIds: [f.a, UNKNOWN] }));
      const e = await readonly(f.dir, args(f,
        ['specification', 'create', '--owned', '--input', file,
          ...(apply ? ['--apply'] : [])]), 1);
      assert.equal(e.code, 'SCOPE_DENIED');
    } finally { cleanup(f.dir); }
  });
}

test('local CLI grants both areas but alpha-only records keep alpha-only sidecar/event scope', async () => {
  const f = fixture();
  try {
    const applied = await create(f, input(f, envelope(f, { areaIds: [f.a] })), true);
    assert.equal(applied.ownershipConfirmed, true);
    const ownership = read(f, applied.ownershipRel);
    assert.deepEqual(ownership.scope, scope(f, [f.a]));
    const op = await readonly(f.dir, args(f,
      ['journal', 'show', applied.journal.operationId]));
    for (const event of op.intent.events) assert.deepEqual(event.areaIds, [f.a]);
    const shown = await readonly(f.dir, args(f,
      ['specification', 'show', applied.record.id, '--owned']));
    assert.deepEqual(shown.ownership.scope, scope(f, [f.a]));
    assert.deepEqual(shown.record.data.scope, SPEC.scope);
  } finally { cleanup(f.dir); }
});

for (const operation of ['preview', 'apply', 'show']) {
  test(`owned ${operation} requires explicit enrollment without adopting a workspace`, async () => {
    const f = fixture({ enrolled: false });
    try {
      const file = input(f, { areaIds: [UNKNOWN], specification: SPEC });
      const command = operation === 'show'
        ? ['specification', 'show', UNKNOWN, '--owned']
        : ['specification', 'create', '--owned', '--input', file,
          ...(operation === 'apply' ? ['--apply'] : [])];
      const e = await readonly(f.dir, args(f, command), 1);
      assert.equal(e.code, 'WORKSPACE_NOT_FOUND');
    } finally { cleanup(f.dir); }
  });
}

for (const enrolled of [false, true]) {
  test(`raw legacy preview/apply/show stay legacy (workspace=${enrolled})`, async () => {
    const f = fixture({ enrolled });
    try {
      const file = input(f, SPEC);
      const preview = await create(f, file, false, false);
      assert.deepEqual(Object.keys(preview).sort(), ['applied', 'artifact', 'files', 'mode']);
      assert.equal(preview.mode, 'dry-run');
      assert.equal(preview.applied, false);
      assert.deepEqual(preview.files, [{
        path: `${f.plans}/specs/${preview.artifact.id}.json`, action: 'create',
      }]);
      const applied = await create(f, file, true, false);
      assert.equal(applied.mode, 'applied');
      assert.equal(applied.applied, true);
      assert.equal(applied.created, 1);
      assert.notEqual(applied.artifact.id, preview.artifact.id);
      assert.equal(applied.artifact.schemaVersion, 2);
      assert.equal(applied.artifact.data.originalRequest, SPEC.originalRequest);
      assert.deepEqual(applied.files,
        [`${f.plans}/specs/${applied.artifact.id}.json`]);
      assert.equal(Object.hasOwn(applied, 'ownershipConfirmed'), false);
      assert.equal(Object.hasOwn(applied, 'journal'), false);
      assert.equal(fs.existsSync(path.join(f.dir, f.state, 'journal')), false);
      assert.equal(fs.existsSync(path.join(f.dir, f.state, 'record-ownership')), false);
      assert.equal(fs.existsSync(path.join(f.dir, f.state, 'workspace.json')), enrolled);
      assert.deepEqual(await readonly(f.dir, args(f,
        ['specification', 'show', applied.artifact.id])), applied.artifact);
    } finally { cleanup(f.dir); }
  });
}

test('owned envelopes without --owned are UNKNOWN_KEY, never auto-detected', async () => {
  const f = fixture();
  try {
    const file = input(f);
    for (const apply of [false, true]) {
      const e = await readonly(f.dir, args(f,
        ['specification', 'create', '--input', file,
          ...(apply ? ['--apply'] : [])]), 1);
      assert.equal(e.code, 'UNKNOWN_KEY');
    }
  } finally { cleanup(f.dir); }
});

test('unowned legacy V2 cannot be adopted by owned show; legacy show still succeeds', async () => {
  const f = fixture();
  try {
    const legacy = await create(f, input(f, SPEC), true, false);
    const e = await readonly(f.dir, args(f,
      ['specification', 'show', legacy.artifact.id, '--owned']), 1);
    assert.equal(e.code, 'OWNED_SPEC_NOT_FOUND');
    assert.deepEqual(await readonly(f.dir, args(f,
      ['specification', 'show', legacy.artifact.id])), legacy.artifact);
    assert.equal(fs.existsSync(path.join(f.dir, f.state, 'record-ownership')), false);
    assert.equal(fs.existsSync(path.join(f.dir, f.state, 'journal')), false);
  } finally { cleanup(f.dir); }
});

for (const [kind, expected] of [
  ['source-drift', 'OWNED_SPEC_SOURCE_CHANGED'],
  ['missing-commit', 'OWNED_SPEC_NOT_COMMITTED'],
  ['unknown-id', 'OWNED_SPEC_NOT_FOUND'],
  ['uppercase-id', 'INVALID_OWNED_SPEC_INPUT'],
]) {
  test(`owned show ${kind} returns ${expected}, stderr only and no writes`, async () => {
    const f = fixture();
    try {
      let id = kind === 'uppercase-id' ? UPPERCASE : UNKNOWN;
      if (kind === 'source-drift' || kind === 'missing-commit') {
        const created = await create(f, input(f), true);
        id = created.record.id;
        if (kind === 'source-drift') {
          fs.appendFileSync(path.join(f.dir, created.sourceRel), ' ');
        } else {
          fs.unlinkSync(path.join(f.dir, f.state, 'journal', 'operations',
            created.journal.operationId, 'commit.json'));
        }
      }
      const e = await readonly(f.dir, args(f,
        ['specification', 'show', id, '--owned']), 1);
      assert.equal(e.code, expected);
    } finally { cleanup(f.dir); }
  });
}

for (const [name, value] of [
  ['null', () => null],
  ['array', () => []],
  ['raw specification frame', () => SPEC],
  ['missing areas', () => ({ specification: SPEC })],
  ['missing specification', (f) => ({ areaIds: [f.a] })],
  ['empty areas', (f) => envelope(f, { areaIds: [] })],
  ['invalid area id', (f) => envelope(f, { areaIds: ['not-a-uuid'] })],
  ['duplicate area ids', (f) => envelope(f, { areaIds: [f.a, f.a] })],
  ...['id', 'recordId', 'sourceRevision', 'revision', 'sourceHash', 'hash',
    'sourceRel', 'path', 'ownershipRel', 'origin', 'operationId', 'extra']
    .map((key) => [key, (f) => envelope(f, { [key]: 'injected' })]),
]) {
  test(`closed owned DTO rejects ${name} without writes`, async () => {
    const f = fixture();
    try {
      const file = input(f, value(f));
      for (const apply of [false, true]) {
        const e = await readonly(f.dir, args(f,
          ['specification', 'create', '--owned', '--input', file,
            ...(apply ? ['--apply'] : [])]), 1);
        assert.equal(e.code, 'INVALID_OWNED_SPEC_INPUT');
      }
    } finally { cleanup(f.dir); }
  });
}

test('nested specification id preserves UNKNOWN_KEY instead of becoming a stored-artifact input', async () => {
  const f = fixture();
  try {
    const file = input(f, envelope(f, { specification: { ...SPEC, id: UNKNOWN } }));
    for (const apply of [false, true]) {
      const e = await readonly(f.dir, args(f,
        ['specification', 'create', '--owned', '--input', file,
          ...(apply ? ['--apply'] : [])]), 1);
      assert.equal(e.code, 'UNKNOWN_KEY');
    }
  } finally { cleanup(f.dir); }
});

for (const [label, content, expected] of [
  ['malformed', () => '{not-json', 'MALFORMED_JSON'],
  ['oversized', () => Buffer.alloc(loadLimits().maxDocumentBytes + 1, 0xff),
    'INPUT_TOO_LARGE'],
]) {
  for (const apply of [false, true]) {
    test(`owned ${label} JSON precedes context/enrollment errors (apply=${apply})`, async () => {
      const dir = makeTempDir('cli-owned-input-before-context');
      try {
        const file = path.join(dir, 'input.json');
        fs.writeFileSync(file, content());
        const e = await readonly(dir, ['specification', 'create', '--project', dir,
          '--owned', '--input', file, ...(apply ? ['--apply'] : [])], 1);
        assert.equal(e.code, expected);
      } finally { cleanup(dir); }
    });
  }
}

test('custom config/plans/state are honored without creating default directories', async () => {
  const f = fixture({ plans: 'custom/plans', state: 'meta/state',
    configRel: 'custom/config.json' });
  try {
    const file = input(f);
    const preview = await create(f, file, false, true, true);
    assert.equal(preview.sourceRel, `custom/plans/specs/${preview.record.id}.json`);
    const applied = await create(f, file, true, true, true);
    assert.equal(applied.sourceRel, `custom/plans/specs/${applied.record.id}.json`);
    assert.equal(applied.ownershipRel,
      `meta/state/record-ownership/spec/${applied.record.id}.json`);
    assert.equal(applied.ownershipConfirmed, true);
    const shown = await readonly(f.dir, args(f,
      ['specification', 'show', applied.record.id, '--owned'], true));
    assert.deepEqual(shown.record, applied.record);
    assert.deepEqual(shown.ownership.scope, scope(f));
    assert.equal(fs.existsSync(path.join(f.dir, '.scopegrain')), false);
    assert.equal(fs.existsSync(path.join(f.dir, '.tasksystem')), false);
  } finally { cleanup(f.dir); }
});

test('legacy config discovery supports explicit owned creation without creating current config', async () => {
  const f = fixture({ plans: '.tasksystem/plans', state: '.tasksystem/state',
    configRel: '.tasksystem/config.json' });
  try {
    const created = await create(f, input(f), true);
    assert.equal(created.ownershipConfirmed, true);
    assert.equal(created.sourceRel, `.tasksystem/plans/specs/${created.record.id}.json`);
    const shown = await readonly(f.dir, args(f,
      ['specification', 'show', created.record.id, '--owned']));
    assert.deepEqual(shown.record, created.record);
    assert.equal(fs.existsSync(path.join(f.dir, '.scopegrain')), false);
  } finally { cleanup(f.dir); }
});

test('ambiguous configs require explicit --config and missing explicit config never falls back', async () => {
  const f = fixture();
  try {
    writeJson(f.dir, '.tasksystem/config.json', f.ctx.config);
    const file = input(f);
    for (const command of [
      ['specification', 'create', '--owned', '--input', file],
      ['specification', 'create', '--owned', '--input', file, '--apply'],
      ['specification', 'show', UNKNOWN, '--owned'],
    ]) {
      assert.equal((await readonly(f.dir, args(f, command), 1)).code,
        'CONFIG_AMBIGUOUS');
      assert.equal((await readonly(f.dir,
        [...args(f, command), '--config', 'missing/config.json'], 1)).code,
      'CONFIG_NOT_FOUND');
    }
    const created = await create(f, file, true, true, true);
    assert.equal(created.ownershipConfirmed, true);
    const shown = await readonly(f.dir, args(f,
      ['specification', 'show', created.record.id, '--owned'], true));
    assert.deepEqual(shown.record, created.record);
    assert.deepEqual(shown.ownership.scope, scope(f));
  } finally { cleanup(f.dir); }
});
