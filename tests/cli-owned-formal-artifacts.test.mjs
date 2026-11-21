// SPDX-License-Identifier: Apache-2.0
// CLI contracts through real factories/journal. All REVIEW task states and
// verification results are SYNTHETIC fixture declarations, not execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../src/cli.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { prepareWorkspace } from '../src/core/workspaces.mjs';
import { prepareSpecification, prepareDesign } from '../src/core/specifications.mjs';
import { prepareTask } from '../src/core/tasks.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import { seedState, refs } from './methodology-fixtures.mjs';
import { VALID_ANSWERS, cleanup, fakeIO, makeTempDir, writeFile,
  writeJson } from './helpers.mjs';

const UNKNOWN = '01234567-89ab-4cde-8fab-0123456789ab';
const BODY = '  Dise\u{f1}o / resultado fiel: \u{f1} \u{6771}\u{4eac} \u{d83e}\u{ddea}\r\nSegunda l\u{ed}nea.\n';
const TYPES = [
  { family: 'design', kind: 'design', prefix: 'OWNED_DESIGN' },
  { family: 'outcome', kind: 'report', prefix: 'OWNED_OUTCOME' },
];
const SPEC = {
  originalRequest: 'Synthetic CLI owned formal request',
  title: 'Structured CLI parent',
  outcome: { statement: 'Owned creation', evidencePlan: 'Declared synthetic checks' },
  requirements: [{ id: 'R1', statement: 'Scoped proof',
    scenarios: [{ id: 'S1', given: 'a record', when: 'read', then: 'proof holds' }] }],
  scope: ['src/a'], openQuestions: [],
};

function fixture(type, { enrolled = true, plans = '.scopegrain/plans',
  reports = '.scopegrain/reports', state = '.scopegrain/state',
  configRel = '.scopegrain/config.json' } = {}) {
  const dir = makeTempDir(`cli-owned-${type.family}`);
  writeJson(dir, configRel, createConfig(dir, { ...VALID_ANSWERS,
    methodology: 'sdd', paths: { ...VALID_ANSWERS.paths, plans, reports,
      state, memory: '.scopegrain/memory' } }, {}));
  const ctx = resolveContext({ project: dir, config: configRel });
  const workspace = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  if (enrolled) applyPlan(dir, [workspace.file]);
  const [a, b] = workspace.workspace.areas.map((area) => area.id);
  const spec = prepareSpecification(ctx, structuredClone(SPEC));
  applyPlan(dir, [spec.file]);
  const f = { dir, ctx, type, plans, reports, state, configRel, a, b,
    workspace: workspace.workspace };
  if (type.family === 'outcome') {
    const d = prepareDesign(ctx, { specId: spec.artifact.id, title: 'Real design', body: BODY });
    applyPlan(dir, [d.file]);
    const t = prepareTask(ctx, { title: 'Synthetic formal task', contract: 'Declared result only',
      authorContext: 'synthetic-author', scope: ['src/a'],
      specId: spec.artifact.id, designId: d.artifact.id, scenarioRefs: refs('S1') });
    applyPlan(dir, [t.file]);
    f.task = seedState(f, t.task); // SYNTHETIC REVIEW, not actual transitions.
  }
  f.dto = type.family === 'design'
    ? { specId: spec.artifact.id, title: 'CLI owned design', body: BODY }
    : { taskId: f.task.id, title: 'CLI owned outcome', body: BODY };
  f.envelope = (overrides = {}) => ({ areaIds: [a, b],
    [type.family]: structuredClone(f.dto), ...overrides });
  f.sourceDir = type.kind === 'design' ? `${plans}/designs` : reports;
  return f;
}
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
async function call(argv, expected = 0) {
  const io = fakeIO();
  assert.equal(await run(argv, io), expected, JSON.stringify({ argv, ...io.out }));
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
function args(f, tail, explicit = false) {
  return [...tail, '--project', f.dir,
    ...(explicit ? ['--config', f.configRel] : [])];
}
async function readonly(f, argv, expected = 0) {
  const before = tree(f.dir);
  try { return await call(argv, expected); }
  finally { assert.deepEqual(tree(f.dir), before); }
}
function input(f, value = f.envelope()) {
  return writeJson(f.dir, '.inputs/input.json', value);
}
function createArgs(f, file, { owned = true, apply = false, explicit = false } = {}) {
  return args(f, [f.type.family, 'create', '--input', file,
    ...(owned ? ['--owned'] : []), ...(apply ? ['--apply'] : [])], explicit);
}
function showArgs(f, id, explicit = false) {
  return args(f, [f.type.family, 'show', id, '--owned'], explicit);
}
function read(f, rel) {
  return JSON.parse(fs.readFileSync(path.join(f.dir, rel), 'utf8'));
}
function scope(f, areaIds = [f.a, f.b]) {
  return { workspaceId: f.workspace.workspaceId, projectId: f.workspace.projectId,
    repositoryId: f.workspace.repositoryId, areaIds: [...areaIds].sort() };
}

test('help exposes exactly four owned formal usages and separate opt-in notes', async () => {
  const help = await call(['--help']);
  assert.deepEqual(help.commands.filter((c) => /^(design|outcome) /.test(c.command))
    .map((c) => c.command), [
    'design create --project PATH --input FILE [--owned] [--apply]',
    'design show --project PATH UUID --owned',
    'outcome create --project PATH --input FILE [--owned] [--apply]',
    'outcome show --project PATH UUID --owned',
  ]);
  assert.ok(help.notes.includes('--owned opts design/outcome create/show into journal ownership; new show commands require it'));
  assert.ok(help.notes.includes('--owned opts specification create/show into journal ownership; legacy behavior stays unchanged without it'));
});

for (const type of TYPES) {
  test(`${type.family}: exact flag/positional surface and owned-only show reject before input IO`, async (t) => {
    const f = fixture(type);
    try {
      const absent = path.join(f.dir, 'never-read.json');
      const lstat = fs.lstatSync;
      let reads = 0;
      const spy = t.mock.method(fs, 'lstatSync', function (file, ...rest) {
        if (path.resolve(String(file)) === absent) reads++;
        return lstat.call(this, file, ...rest);
      });
      try {
        for (const argv of [
          [type.family, 'create', '--owned', '--input', absent],
          args(f, [type.family, 'create', '--owned']),
          [type.family, 'show', UNKNOWN, '--owned'],
          args(f, [type.family, 'show', '--owned']),
          args(f, [type.family, 'show', UNKNOWN, UNKNOWN, '--owned']),
          args(f, [type.family, 'create', '--owned', '--input', absent, 'extra']),
          args(f, [type.family, 'create', '--owned', 'true', '--input', absent]),
          args(f, [type.family, 'show', UNKNOWN, '--owned', 'true']),
          args(f, [type.family, 'show', UNKNOWN, '--owned', '--apply']),
          args(f, [type.family, 'show', UNKNOWN, '--owned', '--input', absent]),
          ...['--yes', '--force', '--id', '--path', '--title', '--scope',
            '--namespace', '--bogus'].map((flag) =>
            args(f, [type.family, 'create', '--owned', '--input', absent, flag, 'x'])),
        ]) {
          assert.equal((await readonly(f, argv, 1)).code, 'INVALID_ARGS', JSON.stringify(argv));
        }
        assert.equal(reads, 0);
      } finally { spy.mock.restore(); }
    } finally { cleanup(f.dir); }
  });

  test(`${type.family}: show without --owned is INVALID_ARGS before context access`, async () => {
    const dir = makeTempDir(`cli-${type.family}-missing-context`);
    try {
      const f = { dir };
      for (const argv of [[type.family, 'show', UNKNOWN],
        [type.family, 'show', UNKNOWN, '--project', dir],
        [type.family, 'show', UNKNOWN, '--project', dir, '--config', 'missing.json']]) {
        const error = await readonly(f, argv, 1);
        assert.equal(error.code, 'INVALID_ARGS');
        assert.match(error.message, /requires --owned; use artifact show/);
      }
    } finally { cleanup(dir); }
  });

  test(`${type.family}: preview/apply/show preserve shapes, Unicode, exact requested scopes with all-area grants`, async () => {
    const f = fixture(type);
    try {
      const file = input(f, f.envelope({ areaIds: [f.a] }));
      const p = await readonly(f, createArgs(f, file));
      const p2 = await readonly(f, createArgs(f, file));
      for (const preview of [p, p2]) {
        assert.deepEqual(Object.keys(preview).sort(),
          ['mode', 'record', 'sourceRel', 'ownershipRel', 'reservesIds'].sort());
        assert.equal(preview.mode, 'dry-run');
        assert.equal(preview.reservesIds, false);
        assert.equal(preview.record.schemaVersion, 2);
        assert.equal(preview.record.body, BODY);
        assert.equal(preview.sourceRel, `${f.sourceDir}/${preview.record.id}.json`);
      }
      assert.notEqual(p.record.id, p2.record.id);
      const applied = await call(createArgs(f, file, { apply: true }));
      assert.deepEqual(Object.keys(applied).sort(), [
        'journal', 'mode', 'ownershipConfirmed', 'ownershipRel', 'record', 'sourceRel',
      ]);
      assert.equal(applied.mode, 'applied');
      assert.equal(applied.ownershipConfirmed, true);
      assert.equal(applied.journal.status, 'committed');
      assert.equal(applied.journal.journalState, 'confirmed');
      assert.equal(applied.journal.eventIds.length, 2);
      assert.notEqual(applied.record.id, p.record.id);
      assert.notEqual(applied.record.id, p2.record.id);
      assert.equal(applied.record.kind, type.kind);
      assert.equal(applied.record.body, BODY);
      assert.deepEqual(read(f, applied.sourceRel), applied.record);
      assert.equal(applied.ownershipRel,
        `${f.state}/record-ownership/${type.kind}/${applied.record.id}.json`);
      const ownership = read(f, applied.ownershipRel);
      assert.deepEqual(ownership.scope, scope(f, [f.a]));
      const operation = await readonly(f, args(f,
        ['journal', 'show', applied.journal.operationId]));
      assert.equal(operation.intent.events.length, 2);
      assert.deepEqual(operation.intent.events.map((e) => e.sourceKind).sort(),
        [type.kind, 'record-ownership'].sort());
      for (const event of operation.intent.events) {
        assert.equal(event.operation, 'create');
        assert.equal(event.sourceRevision, 0);
        assert.deepEqual(event.areaIds, [f.a]);
      }
      const shown = await readonly(f, showArgs(f, applied.record.id));
      assert.deepEqual(shown, {
        record: applied.record, ownership, isCurrentSource: true, memoryConsulted: false,
        locator: { operationId: applied.journal.operationId,
          eventId: operation.intent.events.find((e) => e.sourceKind === type.kind).eventId },
      });
      assert.deepEqual(await readonly(f, args(f,
        ['artifact', 'show', type.kind, applied.record.id])), applied.record);
    } finally { cleanup(f.dir); }
  });

  test(`${type.family}: no envelope auto-selection; explicit owned DTO is closed and unknown scopes denied`, async () => {
    const f = fixture(type);
    try {
      const wrapped = input(f);
      for (const apply of [false, true]) {
        assert.equal((await readonly(f, createArgs(f, wrapped, { owned: false, apply }), 1)).code,
          'UNKNOWN_KEY');
      }
      for (const [value, expected] of [
        [f.dto, `INVALID_${type.prefix}_INPUT`],
        [null, `INVALID_${type.prefix}_INPUT`],
        [f.envelope({ areaIds: [] }), `INVALID_${type.prefix}_INPUT`],
        [f.envelope({ areaIds: [f.a, f.a] }), `INVALID_${type.prefix}_INPUT`],
        [f.envelope({ areaIds: [UNKNOWN] }), 'SCOPE_DENIED'],
        [f.envelope({ sourceHash: 'caller-hash' }), `INVALID_${type.prefix}_INPUT`],
        [f.envelope({ [type.family]: { ...f.dto, id: UNKNOWN } }), 'UNKNOWN_KEY'],
        [f.envelope({ [type.family]: { ...f.dto, taskDigest: 'a'.repeat(64) } }), 'UNKNOWN_KEY'],
      ]) {
        const file = input(f, value);
        for (const apply of [false, true]) {
          assert.equal((await readonly(f, createArgs(f, file, { apply }), 1)).code, expected);
        }
      }
    } finally { cleanup(f.dir); }
  });

  for (const enrolled of [false, true]) {
    test(`${type.family}: ordinary create stays unchanged without ownership (enrolled=${enrolled})`, async () => {
      const f = fixture(type, { enrolled });
      try {
        const file = input(f, f.dto);
        const preview = await readonly(f, createArgs(f, file, { owned: false }));
        assert.deepEqual(Object.keys(preview).sort(), ['applied', 'artifact', 'files', 'mode']);
        assert.equal(preview.mode, 'dry-run');
        assert.equal(preview.applied, false);
        assert.deepEqual(preview.files, [{
          path: `${f.sourceDir}/${preview.artifact.id}.json`, action: 'create',
        }]);
        const applied = await call(createArgs(f, file, { owned: false, apply: true }));
        assert.equal(applied.applied, true);
        assert.equal(applied.mode, 'applied');
        assert.equal(applied.created, 1);
        assert.deepEqual(applied.files, [`${f.sourceDir}/${applied.artifact.id}.json`]);
        assert.equal(applied.artifact.schemaVersion, 2);
        assert.equal(applied.artifact.body, BODY);
        assert.equal(Object.hasOwn(applied, 'ownershipConfirmed'), false);
        assert.equal(Object.hasOwn(applied, 'journal'), false);
        assert.equal(fs.existsSync(path.join(f.dir, f.state, 'journal')), false);
        assert.equal(fs.existsSync(path.join(f.dir, f.state, 'record-ownership')), false);
        assert.deepEqual(await readonly(f, args(f,
          ['artifact', 'show', type.kind, applied.artifact.id])), applied.artifact);
        if (enrolled) {
          assert.equal((await readonly(f, showArgs(f, applied.artifact.id), 1)).code,
            `${type.prefix}_NOT_FOUND`);
        }
      } finally { cleanup(f.dir); }
    });
  }

  test(`${type.family}: owned preview/apply/show require enrollment and never create it`, async () => {
    const f = fixture(type, { enrolled: false });
    try {
      const file = input(f);
      for (const argv of [createArgs(f, file), createArgs(f, file, { apply: true }),
        showArgs(f, UNKNOWN)]) {
        assert.equal((await readonly(f, argv, 1)).code, 'WORKSPACE_NOT_FOUND');
      }
    } finally { cleanup(f.dir); }
  });

  test(`${type.family}: owned show never falls back for missing, changed or uncertain proof`, async () => {
    const f = fixture(type);
    try {
      const applied = await call(createArgs(f, input(f), { apply: true }));
      assert.equal((await readonly(f, showArgs(f, UNKNOWN), 1)).code, `${type.prefix}_NOT_FOUND`);
      const ownAbs = path.join(f.dir, applied.ownershipRel);
      const companion = fs.readFileSync(ownAbs);
      fs.unlinkSync(ownAbs);
      assert.equal((await readonly(f, showArgs(f, applied.record.id), 1)).code,
        `${type.prefix}_NOT_FOUND`);
      // Generic structural reading explicitly remains available.
      assert.deepEqual(await readonly(f, args(f,
        ['artifact', 'show', type.kind, applied.record.id])), applied.record);
      fs.writeFileSync(ownAbs, companion);
      const sourceAbs = path.join(f.dir, applied.sourceRel);
      const source = fs.readFileSync(sourceAbs);
      fs.writeFileSync(sourceAbs, JSON.stringify({ ...applied.record, body: 'changed' }));
      assert.equal((await readonly(f, showArgs(f, applied.record.id), 1)).code,
        `${type.prefix}_SOURCE_CHANGED`);
      fs.writeFileSync(sourceAbs, source);
      fs.unlinkSync(path.join(f.dir, f.state, 'journal', 'operations',
        applied.journal.operationId, 'commit.json'));
      assert.equal((await readonly(f, showArgs(f, applied.record.id), 1)).code,
        `${type.prefix}_NOT_COMMITTED`);
    } finally { cleanup(f.dir); }
  });

  test(`${type.family}: bounded strict UTF8 input errors precede missing configuration`, async () => {
    const dir = makeTempDir(`cli-${type.family}-input`);
    const f = { dir, type };
    try {
      for (const [name, bytes, expected] of [
        ['malformed.json', '{not-json', 'MALFORMED_JSON'],
        ['utf8.json', Buffer.concat([Buffer.from('{"title":"'), Buffer.from([0xff]),
          Buffer.from('"}')]), 'MALFORMED_JSON'],
        ['oversized.json', Buffer.alloc(loadLimits().maxDocumentBytes + 1, 0xff),
          'INPUT_TOO_LARGE'],
      ]) {
        const file = writeFile(dir, name, bytes);
        for (const apply of [false, true]) {
          assert.equal((await readonly(f, createArgs(f, file, { apply }), 1)).code, expected);
        }
      }
    } finally { cleanup(dir); }
  });

  test(`${type.family}: genuine uncertain apply preserves receipt and owned show never adopts partial source`, async (t) => {
    const f = fixture(type);
    try {
      const file = input(f);
      const open = fs.openSync;
      const spy = t.mock.method(fs, 'openSync', function (filename, flags, ...rest) {
        if (flags === 'wx' && String(filename).includes('record-ownership')) {
          throw Object.assign(new Error('synthetic CLI companion failure'), { code: 'EIO' });
        }
        return open.call(this, filename, flags, ...rest);
      });
      let applied;
      try { applied = await call(createArgs(f, file, { apply: true })); }
      finally { spy.mock.restore(); }
      assert.equal(applied.mode, 'applied');
      assert.equal(applied.ownershipConfirmed, false);
      assert.equal(applied.journal.status, 'unconfirmed');
      assert.equal(applied.journal.journalState, 'prepared');
      assert.equal(applied.journal.eventIds.length, 2);
      assert.equal(typeof applied.journal.operationId, 'string');
      assert.notEqual(applied.journal.cause, null);
      assert.equal(applied.journal.pendingMemory, true);
      // Rollback succeeds in this fixture and removes the created source.
      // Cleanup is best-effort; proof never relies on its success.
      assert.equal(fs.existsSync(path.join(f.dir, applied.sourceRel)), false);
      assert.equal(fs.existsSync(path.join(f.dir, applied.ownershipRel)), false);
      assert.equal((await readonly(f, showArgs(f, applied.record.id), 1)).code,
        `${type.prefix}_NOT_FOUND`);
      // The rolled-back source is not structurally readable either.
      assert.equal((await readonly(f, args(f,
        ['artifact', 'show', type.kind, applied.record.id]), 1)).code,
        'ARTIFACT_NOT_FOUND');
    } finally { cleanup(f.dir); }
  });

  test(`${type.family}: custom config/plans/reports/state honored; ambiguity and missing explicit config have no fallback`, async () => {
    const f = fixture(type, { plans: 'custom/plans', reports: 'custom/reports',
      state: 'private/state', configRel: 'settings/config.json' });
    try {
      const file = input(f);
      const preview = await readonly(f, createArgs(f, file, { explicit: true }));
      assert.equal(preview.sourceRel, `${f.sourceDir}/${preview.record.id}.json`);
      const applied = await call(createArgs(f, file, { apply: true, explicit: true }));
      assert.equal(applied.sourceRel, `${f.sourceDir}/${applied.record.id}.json`);
      assert.equal(applied.ownershipRel,
        `private/state/record-ownership/${type.kind}/${applied.record.id}.json`);
      assert.deepEqual((await readonly(f, showArgs(f, applied.record.id, true))).record,
        applied.record);
      assert.equal(fs.existsSync(path.join(f.dir, '.scopegrain')), false);
      assert.equal(fs.existsSync(path.join(f.dir, '.tasksystem')), false);
      writeJson(f.dir, '.scopegrain/config.json', f.ctx.config);
      writeJson(f.dir, '.tasksystem/config.json', f.ctx.config);
      for (const argv of [createArgs(f, file), createArgs(f, file, { apply: true }),
        showArgs(f, applied.record.id)]) {
        assert.equal((await readonly(f, argv, 1)).code, 'CONFIG_AMBIGUOUS');
        assert.equal((await readonly(f, [...argv, '--config', 'missing/config.json'], 1)).code,
          'CONFIG_NOT_FOUND');
      }
    } finally { cleanup(f.dir); }
  });
}
