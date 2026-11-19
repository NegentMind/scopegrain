import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan, preflightPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import {
  authorizeScope, bindWorkspace, getWorkspace, prepareWorkspace,
  resolveWorkspaceRepository, validateWorkspace, workspaceFileRel,
} from '../src/core/workspaces.mjs';
import { run } from '../src/cli.mjs';
import {
  VALID_ANSWERS, cleanup, fakeIO, makeTempDir, trySymlink, writeFile, writeJson,
} from './helpers.mjs';

const TWO_AREAS = {
  areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fixture({ state = '.tasksystem/state', configRel = '.tasksystem/config.json' } = {}) {
  const dir = makeTempDir('workspace');
  const answers = { ...VALID_ANSWERS, paths: { ...VALID_ANSWERS.paths, state } };
  writeJson(dir, configRel, createConfig(dir, answers, {}));
  return { dir, ctx: resolveContext({ project: dir, config: configRel }), configRel };
}

function create(ctx, input = {}) {
  const prepared = prepareWorkspace(ctx, input);
  applyPlan(ctx.projectRoot, [prepared.file]);
  return prepared.workspace;
}

function scope(workspace, areaIds = workspace.areas.map((a) => a.id)) {
  return {
    workspaceId: workspace.workspaceId, projectId: workspace.projectId,
    repositoryId: workspace.repositoryId, areaIds,
  };
}

function snapshot(dir) {
  const result = {};
  function walk(abs, rel = '') {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        result[name] = 'directory';
        walk(path.join(abs, entry.name), name);
      } else {
        result[name] = fs.readFileSync(path.join(abs, entry.name));
      }
    }
  }
  walk(dir);
  return result;
}

async function cli(args) {
  const io = fakeIO();
  const code = await run(args, io);
  return { code, body: JSON.parse((code ? io.out.stderr : io.out.stdout).at(-1)) };
}

test('read and preview are read-only; default creation persists distinct stable IDs', () => {
  const { dir, ctx, configRel } = fixture();
  try {
    const before = snapshot(dir);
    assert.equal(workspaceFileRel(ctx), '.tasksystem/state/workspace.json');
    assert.throws(() => getWorkspace(ctx), (e) => e.code === 'WORKSPACE_NOT_FOUND');
    const preview = prepareWorkspace(ctx);
    assert.deepEqual(snapshot(dir), before);
    assert.equal(preview.workspace.areas[0].key, 'project');
    assert.equal(preview.workspace.areas[0].name, ctx.config.project.name);
    assert.equal(preview.workspace.revision, 0);
    const ids = [preview.workspace.workspaceId, preview.workspace.projectId,
      preview.workspace.repositoryId, preview.workspace.areas[0].id];
    assert.ok(ids.every((id) => UUID.test(id)));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(preview.workspace.createdAt, preview.workspace.updatedAt);
    assert.equal(new Date(preview.workspace.createdAt).toISOString(),
      preview.workspace.createdAt);
    assert.equal(preview.file.rel, workspaceFileRel(ctx));
    assert.equal(preview.file.abs, path.join(dir, '.tasksystem', 'state', 'workspace.json'));
    assert.equal(applyPlan(dir, [preview.file]).created, 1);
    assert.deepEqual(getWorkspace(ctx), preview.workspace);
    assert.deepEqual(fs.readFileSync(path.join(dir, configRel)), before[configRel]);
  } finally { cleanup(dir); }
});

test('legacy custom state, matching sets and default no-op preserve exact bytes from one read', () => {
  const { dir, ctx, configRel } = fixture({ state: 'custom-state' });
  try {
    const original = create(ctx, TWO_AREAS);
    const file = path.join(dir, 'custom-state', 'workspace.json');
    const bytes = Buffer.from(`  ${JSON.stringify(original)}  \n`);
    fs.writeFileSync(file, bytes);
    const before = snapshot(dir);
    const open = fs.openSync;
    let reads = 0;
    fs.openSync = function (filePath, ...args) {
      if (String(filePath) === file) reads += 1;
      return open.call(this, filePath, ...args);
    };
    let matching;
    try {
      matching = prepareWorkspace(ctx, { areas: [...TWO_AREAS.areas].reverse() });
    } finally {
      fs.openSync = open;
    }
    assert.equal(reads, 1);
    assert.deepEqual(Buffer.from(matching.file.content), bytes);
    assert.deepEqual(matching.workspace, original);
    assert.equal(preflightPlan(dir, [matching.file])[0].action, 'noop');
    assert.equal(applyPlan(dir, [matching.file]).created, 0);
    ctx.config.project.name = 'Renamed without re-enrollment';
    const defaultNoop = prepareWorkspace(ctx, {});
    assert.deepEqual(defaultNoop.workspace, original);
    assert.deepEqual(Buffer.from(defaultNoop.file.content), bytes);
    assert.deepEqual(snapshot(dir), before);
    assert.ok(fs.existsSync(path.join(dir, configRel)));
    assert.equal(fs.existsSync(path.join(dir, '.scopegrain')), false);
  } finally { cleanup(dir); }
});

test('explicit default area and multiple areas create once; differing enrollment conflicts', () => {
  for (const input of [
    { areas: [{ key: 'project', name: 'fixture-project' }] }, TWO_AREAS,
  ]) {
    const { dir, ctx } = fixture();
    try {
      const doc = create(ctx, input);
      assert.deepEqual(doc.areas.map(({ key, name }) => ({ key, name })), input.areas);
      const before = snapshot(dir);
      assert.throws(() => prepareWorkspace(ctx,
        { areas: [{ key: 'other', name: 'Other' }] }),
      (e) => e.code === 'WORKSPACE_CONFLICT');
      assert.throws(() => prepareWorkspace(ctx,
        { areas: input.areas.map((a) => ({ ...a, name: `${a.name}!` })) }),
      (e) => e.code === 'WORKSPACE_CONFLICT');
      assert.deepEqual(snapshot(dir), before);
    } finally { cleanup(dir); }
  }
});

test('input shape is closed, plain and requires valid unique areas', () => {
  const { dir, ctx } = fixture();
  try {
    const invalid = [
      null, [], 'input', 1, { areas: null }, { areas: [] },
      { areas: [{}] }, { areas: [{ key: 'A', name: 'A' }] },
      { areas: [{ key: '', name: 'A' }] }, { areas: [{ key: 'a', name: ' ' }] },
      { areas: [{ key: 'a'.repeat(65), name: 'A' }] },
      { areas: [{ key: 'a', name: 'A' }, { key: 'a', name: 'B' }] },
      Object.create({ areas: [{ key: 'x', name: 'X' }] }),
      { areas: [Object.assign(Object.create({ key: 'x' }), { name: 'X' })] },
      { areas: new Array(1) },
    ];
    for (const input of invalid) {
      assert.throws(() => prepareWorkspace(ctx, input),
        (e) => e.code === 'INVALID_WORKSPACE', JSON.stringify(input));
    }
    for (const input of [
      { workspaceId: 'caller' }, { areas: [{ key: 'a', name: 'A', id: 'caller' }] },
      { areas: [{ key: 'a', name: 'A' }], revision: 0 },
    ]) {
      assert.throws(() => prepareWorkspace(ctx, input), (e) => e.code === 'UNKNOWN_KEY');
    }
    const area = Object.assign(Object.create(null), { key: 'a', name: 'A' });
    const input = Object.assign(Object.create(null), { areas: [area] });
    assert.equal(prepareWorkspace(ctx, input).workspace.areas[0].key, 'a');
    assert.equal(fs.existsSync(path.join(dir, '.tasksystem', 'state')), false);
  } finally { cleanup(dir); }
});

test('stored workspace validation rejects malformed fields, duplicates and inherited values', () => {
  const { dir, ctx } = fixture();
  try {
    const valid = prepareWorkspace(ctx, TWO_AREAS).workspace;
    assert.equal(validateWorkspace(valid), valid);
    const copy = () => structuredClone(valid);
    const bad = [
      null, [], { ...valid, schemaVersion: 2 }, { ...valid, extra: true },
      { ...valid, workspaceId: valid.workspaceId.toUpperCase() },
      { ...valid, projectId: valid.workspaceId }, { ...valid, revision: -1 },
      { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, revision: 1.5 }, { ...valid, createdAt: '2026-01-01' },
      { ...valid, updatedAt: '2020-01-01T00:00:00.000Z' },
      { ...valid, areas: [] }, { ...valid, areas: null },
      { ...valid, areas: [{ ...valid.areas[0], id: valid.repositoryId }] },
      { ...valid, areas: [valid.areas[0], { ...valid.areas[1], key: 'alpha' }] },
      { ...valid, areas: [{ ...valid.areas[0], name: ' ' }] },
      { ...valid, areas: [{ ...valid.areas[0], key: 'Alpha' }] },
      { ...valid, areas: [{ ...valid.areas[0], extra: true }] },
      Object.assign(Object.create({ workspaceId: valid.workspaceId }),
        Object.fromEntries(Object.entries(valid).filter(([k]) => k !== 'workspaceId'))),
    ];
    const missing = copy();
    delete missing.createdAt;
    bad.push(missing);
    const missingArea = copy();
    delete missingArea.areas[0].id;
    bad.push(missingArea);
    for (const value of bad) {
      assert.throws(() => validateWorkspace(value),
        (e) => e.code === 'WORKSPACE_MALFORMED');
    }
    const nullProto = Object.assign(Object.create(null), copy());
    nullProto.areas = nullProto.areas.map((a) => Object.assign(Object.create(null), a));
    assert.equal(validateWorkspace(nullProto), nullProto);
  } finally { cleanup(dir); }
});

test('malformed, oversized and non-file stored metadata fail without repair', () => {
  const { dir, ctx } = fixture();
  try {
    const rel = workspaceFileRel(ctx);
    writeFile(dir, rel, '{broken');
    const broken = snapshot(dir);
    assert.throws(() => getWorkspace(ctx), (e) => e.code === 'MALFORMED_JSON');
    assert.throws(() => prepareWorkspace(ctx), (e) => e.code === 'MALFORMED_JSON');
    assert.deepEqual(snapshot(dir), broken);
    writeJson(dir, rel, { schemaVersion: 1 });
    assert.throws(() => getWorkspace(ctx), (e) => e.code === 'WORKSPACE_MALFORMED');
    writeFile(dir, rel, ' '.repeat(loadLimits().maxDocumentBytes + 1));
    assert.throws(() => getWorkspace(ctx), (e) => e.code === 'DOCUMENT_TOO_LARGE');
    const absolute = path.join(dir, ...rel.split('/'));
    fs.unlinkSync(absolute);
    fs.mkdirSync(absolute);
    assert.throws(() => getWorkspace(ctx), (e) => e.code === 'WORKSPACE_NOT_FILE');
    assert.throws(() => prepareWorkspace(ctx), (e) => e.code === 'WORKSPACE_NOT_FILE');
  } finally { cleanup(dir); }
});

test('planned creation detects another writer and never overwrites differing bytes', () => {
  const { dir, ctx } = fixture();
  try {
    const prepared = prepareWorkspace(ctx);
    const other = Buffer.from('other writer\n');
    writeFile(dir, prepared.file.rel, other);
    assert.throws(() => applyPlan(dir, [prepared.file]), (e) => e.code === 'PLAN_CONFLICT');
    assert.deepEqual(fs.readFileSync(prepared.file.abs), other);
  } finally { cleanup(dir); }
});

test('opaque binding freezes grants and enforces all-of scope and exact identities', () => {
  const { dir, ctx } = fixture();
  try {
    const doc = create(ctx, TWO_AREAS);
    const [alpha, beta] = doc.areas.map((a) => a.id);
    const grant = [beta, alpha];
    const bound = bindWorkspace(ctx, { areaIds: grant });
    grant.length = 0;
    assert.ok(Object.isFrozen(bound));
    assert.ok(Object.isFrozen(bound.areaIds));
    assert.deepEqual(bound.areaIds, [alpha, beta].sort());
    const authorized = authorizeScope(bound, scope(doc, [beta, alpha]));
    assert.ok(Object.isFrozen(authorized));
    assert.ok(Object.isFrozen(authorized.areaIds));
    assert.deepEqual(authorized.areaIds, [alpha, beta].sort());
    assert.equal(resolveWorkspaceRepository(bound, doc.repositoryId), ctx.projectRoot);
    const alphaOnly = bindWorkspace(ctx, { areaIds: [alpha] });
    assert.throws(() => authorizeScope(alphaOnly, scope(doc, [alpha, beta])),
      (e) => e.code === 'SCOPE_DENIED');
    for (const forgery of [{ ...bound }, Object.create(bound), null, {}]) {
      assert.throws(() => authorizeScope(forgery, scope(doc)), (e) => e.code === 'SCOPE_DENIED');
      assert.throws(() => resolveWorkspaceRepository(forgery, doc.repositoryId),
        (e) => e.code === 'SCOPE_DENIED');
    }
    for (const input of [
      {}, null, [], { areaIds: [] }, { areaIds: [alpha, alpha] },
      { areaIds: [alpha.toUpperCase()] },
      { areaIds: ['00000000-0000-0000-0000-000000000000'] },
      { areaIds: [alpha], extra: true },
      Object.assign(Object.create({ areaIds: [alpha] }), {}),
    ]) {
      assert.throws(() => bindWorkspace(ctx, input), (e) => e.code === 'SCOPE_DENIED');
    }
    for (const request of [
      {}, null, [], { ...scope(doc), extra: true },
      { ...scope(doc), workspaceId: doc.projectId },
      { ...scope(doc), projectId: doc.workspaceId },
      { ...scope(doc), repositoryId: doc.projectId },
      { ...scope(doc), areaIds: [] }, { ...scope(doc), areaIds: [alpha, alpha] },
      { ...scope(doc), areaIds: [alpha.toUpperCase()] },
      { ...scope(doc), areaIds: ['00000000-0000-0000-0000-000000000000'] },
      Object.assign(Object.create({ workspaceId: doc.workspaceId }),
        { projectId: doc.projectId, repositoryId: doc.repositoryId, areaIds: [alpha] }),
    ]) {
      assert.throws(() => authorizeScope(bound, request), (e) => e.code === 'SCOPE_DENIED');
    }
    assert.throws(() => resolveWorkspaceRepository(bound, doc.projectId),
      (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => resolveWorkspaceRepository(bound, doc.repositoryId.toUpperCase()),
      (e) => e.code === 'SCOPE_DENIED');
    ctx.projectRoot = path.join(dir, 'foreign');
    ctx.config.paths.state = 'changed/state';
    assert.equal(resolveWorkspaceRepository(bound, doc.repositoryId), dir);
    assert.deepEqual(authorizeScope(bound, scope(doc)).areaIds, [alpha, beta].sort());
  } finally { cleanup(dir); }
});

test('independent repository contexts cannot authorize each other', () => {
  const one = fixture();
  const two = fixture();
  try {
    const first = create(one.ctx);
    const second = create(two.ctx);
    const bound1 = bindWorkspace(one.ctx, { areaIds: [first.areas[0].id] });
    const bound2 = bindWorkspace(two.ctx, { areaIds: [second.areas[0].id] });
    assert.throws(() => authorizeScope(bound1, scope(second)), (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => authorizeScope(bound2, scope(first)), (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => resolveWorkspaceRepository(bound1, second.repositoryId),
      (e) => e.code === 'SCOPE_DENIED');
    assert.equal(resolveWorkspaceRepository(bound2, second.repositoryId), two.ctx.projectRoot);
  } finally { cleanup(one.dir); cleanup(two.dir); }
});

test('changed or removed metadata makes a binding stale; malformed data stays explicit', () => {
  const { dir, ctx } = fixture();
  try {
    const doc = create(ctx);
    const bound = bindWorkspace(ctx, { areaIds: [doc.areas[0].id] });
    const file = path.join(dir, ...workspaceFileRel(ctx).split('/'));
    fs.writeFileSync(file, ` ${JSON.stringify(doc)} \n`);
    assert.deepEqual(authorizeScope(bound, scope(doc)).areaIds, [doc.areas[0].id]);
    fs.writeFileSync(file, '{"schemaVersion":1}\n');
    assert.throws(() => authorizeScope(bound, scope(doc)),
      (e) => e.code === 'WORKSPACE_MALFORMED');
    fs.writeFileSync(file, '{broken');
    assert.throws(() => authorizeScope(bound, scope(doc)), (e) => e.code === 'MALFORMED_JSON');
    fs.writeFileSync(file, JSON.stringify(doc));
    assert.deepEqual(authorizeScope(bound, scope(doc)).areaIds, [doc.areas[0].id]);
    fs.writeFileSync(file, JSON.stringify({ ...doc, revision: 1 }) + '\n');
    assert.throws(() => authorizeScope(bound, scope(doc)), (e) => e.code === 'WORKSPACE_STALE');
    assert.throws(() => resolveWorkspaceRepository(bound, doc.repositoryId),
      (e) => e.code === 'WORKSPACE_STALE');
    fs.unlinkSync(file);
    assert.throws(() => authorizeScope(bound, scope(doc)), (e) => e.code === 'WORKSPACE_STALE');
    assert.throws(() => resolveWorkspaceRepository(bound, doc.repositoryId),
      (e) => e.code === 'WORKSPACE_STALE');
  } finally { cleanup(dir); }
});

test('observed metadata divergence remains stale after original bytes are restored', () => {
  const { dir, ctx } = fixture();
  try {
    const doc = create(ctx);
    const bound = bindWorkspace(ctx, { areaIds: [doc.areas[0].id] });
    const file = path.join(dir, ...workspaceFileRel(ctx).split('/'));
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, JSON.stringify({ ...doc, revision: 1 }));
    assert.throws(() => authorizeScope(bound, scope(doc)), (e) => e.code === 'WORKSPACE_STALE');
    fs.writeFileSync(file, original);
    assert.throws(() => authorizeScope(bound, scope(doc)), (e) => e.code === 'WORKSPACE_STALE');
    assert.throws(() => resolveWorkspaceRepository(bound, doc.repositoryId),
      (e) => e.code === 'WORKSPACE_STALE');
    const fresh = bindWorkspace(ctx, { areaIds: [doc.areas[0].id] });
    assert.deepEqual(authorizeScope(fresh, scope(doc)).areaIds, [doc.areas[0].id]);
  } finally { cleanup(dir); }
});

test('observed metadata removal remains stale after the original file is recreated', () => {
  const { dir, ctx } = fixture();
  try {
    const doc = create(ctx);
    const bound = bindWorkspace(ctx, { areaIds: [doc.areas[0].id] });
    const file = path.join(dir, ...workspaceFileRel(ctx).split('/'));
    const original = fs.readFileSync(file);
    fs.unlinkSync(file);
    assert.throws(() => authorizeScope(bound, scope(doc)), (e) => e.code === 'WORKSPACE_STALE');
    fs.writeFileSync(file, original);
    assert.throws(() => authorizeScope(bound, scope(doc)), (e) => e.code === 'WORKSPACE_STALE');
    assert.throws(() => resolveWorkspaceRepository(bound, doc.repositoryId),
      (e) => e.code === 'WORKSPACE_STALE');
    const fresh = bindWorkspace(ctx, { areaIds: [doc.areas[0].id] });
    assert.deepEqual(authorizeScope(fresh, scope(doc)).areaIds, [doc.areas[0].id]);
  } finally { cleanup(dir); }
});

test('root identities retain precision beyond Number.MAX_SAFE_INTEGER', () => {
  const { dir, ctx } = fixture();
  const stat = fs.statSync;
  let generation = 0n;
  try {
    const doc = create(ctx);
    fs.statSync = function (file, options) {
      const result = stat.call(this, file, options);
      if (file === ctx.projectRoot) {
        result.dev = options?.bigint ? 1n : 1;
        result.ino = options?.bigint
          ? 9007199254740992n + generation
          : Number(9007199254740992n + generation);
      }
      return result;
    };
    const bound = bindWorkspace(ctx, { areaIds: [doc.areas[0].id] });
    const second = bindWorkspace(ctx, { areaIds: [doc.areas[0].id] });
    generation = 1n;
    assert.throws(() => authorizeScope(bound, scope(doc)), (e) => e.code === 'WORKSPACE_STALE');
    assert.throws(() => resolveWorkspaceRepository(second, doc.repositoryId),
      (e) => e.code === 'WORKSPACE_STALE');
    generation = 0n;
    assert.throws(() => authorizeScope(bound, scope(doc)), (e) => e.code === 'WORKSPACE_STALE');
    assert.throws(() => resolveWorkspaceRepository(bound, doc.repositoryId),
      (e) => e.code === 'WORKSPACE_STALE');
    assert.throws(() => authorizeScope(second, scope(doc)), (e) => e.code === 'WORKSPACE_STALE');
    const fresh = bindWorkspace(ctx, { areaIds: [doc.areas[0].id] });
    assert.deepEqual(authorizeScope(fresh, scope(doc)).areaIds, [doc.areas[0].id]);
  } finally { fs.statSync = stat; cleanup(dir); }
});

test('a root realpath mismatch remains stale after the path is restored', () => {
  const { dir, ctx } = fixture();
  const realpath = fs.realpathSync;
  let changed = false;
  try {
    const doc = create(ctx);
    const bound = bindWorkspace(ctx, { areaIds: [doc.areas[0].id] });
    fs.realpathSync = function (file, ...args) {
      const result = realpath.call(this, file, ...args);
      return changed && file === ctx.projectRoot ? `${result}-moved` : result;
    };
    changed = true;
    assert.throws(() => authorizeScope(bound, scope(doc)), (e) => e.code === 'WORKSPACE_STALE');
    changed = false;
    assert.throws(() => resolveWorkspaceRepository(bound, doc.repositoryId),
      (e) => e.code === 'WORKSPACE_STALE');
    const fresh = bindWorkspace(ctx, { areaIds: [doc.areas[0].id] });
    assert.deepEqual(authorizeScope(fresh, scope(doc)).areaIds, [doc.areas[0].id]);
  } finally { fs.realpathSync = realpath; cleanup(dir); }
});

test('a differently-cased root spelling keeps a live binding on Windows', {
  skip: process.platform !== 'win32',
}, () => {
  const { dir, ctx } = fixture();
  try {
    const doc = create(ctx);
    // Same root, different spelling: lowercase drive letter plus a
    // flipped segment case. The realpath is unchanged, so binding and
    // revalidation must not go stale.
    const recased = ctx.projectRoot
      .replace(/^([a-zA-Z]):/, (match) => `${match[0].toLowerCase()}:`)
      .replace(/([\\/])([a-zA-Z])/,
        (match, sep, c) => `${sep}${c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()}`);
    assert.notEqual(recased, ctx.projectRoot);
    const bound = bindWorkspace({ projectRoot: recased, config: ctx.config },
      { areaIds: [doc.areas[0].id] });
    assert.deepEqual(authorizeScope(bound, scope(doc)).areaIds, [doc.areas[0].id]);
    assert.equal(resolveWorkspaceRepository(bound, doc.repositoryId), recased);
  } finally { cleanup(dir); }
});

test('root identity comparison follows platform case semantics', () => {
  const { dir, ctx } = fixture();
  const realpath = fs.realpathSync;
  const stat = fs.statSync;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  // Flip the first letter's case (the drive letter on Windows, the first
  // segment elsewhere): a realpath for the same root under a different
  // spelling, exercisable on any host via injected platform semantics.
  const recased = ctx.projectRoot.replace(/[a-zA-Z]/,
    (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
  assert.notEqual(recased, ctx.projectRoot);
  try {
    const doc = create(ctx);
    fs.realpathSync = function (file, ...args) {
      const result = realpath.call(this, file, ...args);
      return file === ctx.projectRoot && result === ctx.projectRoot
        ? recased : result;
    };
    fs.statSync = function (file, ...args) {
      return stat.call(this, file === recased ? ctx.projectRoot : file, ...args);
    };
    // Byte-exact platforms: a case-only realpath divergence still stales.
    Object.defineProperty(process, 'platform', { value: 'linux' });
    assert.throws(() => bindWorkspace(ctx, { areaIds: [doc.areas[0].id] }),
      (e) => e.code === 'WORKSPACE_STALE');
    // Case-insensitive platforms: the same divergence stays bound.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const bound = bindWorkspace(ctx, { areaIds: [doc.areas[0].id] });
    assert.deepEqual(authorizeScope(bound, scope(doc)).areaIds, [doc.areas[0].id]);
  } finally {
    fs.realpathSync = realpath;
    fs.statSync = stat;
    Object.defineProperty(process, 'platform', platform);
    cleanup(dir);
  }
});

test('temporary workspace read errors do not invalidate a binding', () => {
  const { dir, ctx } = fixture();
  const open = fs.openSync;
  try {
    const doc = create(ctx);
    const bound = bindWorkspace(ctx, { areaIds: [doc.areas[0].id] });
    const file = path.join(dir, ...workspaceFileRel(ctx).split('/'));
    fs.openSync = function (filePath, ...args) {
      if (filePath === file) {
        const error = new Error('fixture read error');
        error.code = 'EACCES';
        throw error;
      }
      return open.call(this, filePath, ...args);
    };
    assert.throws(() => authorizeScope(bound, scope(doc)), (e) => e.code === 'READ_FAILED');
    fs.openSync = open;
    assert.deepEqual(authorizeScope(bound, scope(doc)).areaIds, [doc.areas[0].id]);
  } finally { fs.openSync = open; cleanup(dir); }
});

test('metadata leaf and state ancestor links are rejected', (t) => {
  const { dir, ctx } = fixture();
  const target = makeTempDir('workspace-link-target');
  try {
    const targetFile = writeFile(target, 'workspace.json', '{}');
    const state = path.join(dir, '.tasksystem', 'state');
    fs.mkdirSync(state);
    const file = path.join(state, 'workspace.json');
    if (!trySymlink(targetFile, file, 'file')) {
      t.skip('file symlinks unavailable');
      return;
    }
    assert.throws(() => getWorkspace(ctx), (e) => e.code === 'SYMLINK_REJECTED');
    assert.throws(() => prepareWorkspace(ctx), (e) => e.code === 'SYMLINK_REJECTED');
    fs.unlinkSync(file);
    fs.rmdirSync(state);
    if (!trySymlink(target, state)) {
      t.skip('directory junctions unavailable');
      return;
    }
    assert.throws(() => getWorkspace(ctx), (e) => e.code === 'SYMLINK_REJECTED');
    assert.throws(() => prepareWorkspace(ctx), (e) => e.code === 'SYMLINK_REJECTED');
  } finally { cleanup(dir); cleanup(target); }
});

test('bound root removal or link replacement fails, relocation retains IDs', (t) => {
  const { dir, ctx, configRel } = fixture();
  const moved = `${dir}-moved`;
  try {
    const doc = create(ctx);
    const bound = bindWorkspace(ctx, { areaIds: [doc.areas[0].id] });
    fs.renameSync(dir, moved);
    assert.throws(() => resolveWorkspaceRepository(bound, doc.repositoryId),
      (e) => e.code === 'PROJECT_NOT_FOUND');
    assert.deepEqual(getWorkspace(resolveContext({ project: moved, config: configRel })), doc);
    if (!trySymlink(moved, dir)) {
      t.skip('directory junctions unavailable');
      return;
    }
    assert.throws(() => authorizeScope(bound, scope(doc)),
      (e) => e.code === 'SYMLINK_REJECTED');
    assert.throws(() => resolveWorkspaceRepository(bound, doc.repositoryId),
      (e) => e.code === 'SYMLINK_REJECTED');
  } finally { cleanup(dir); cleanup(moved); }
});

test('replacing the bound root directory with a copy is rejected', () => {
  const { dir, ctx } = fixture();
  const moved = `${dir}-original`;
  try {
    const doc = create(ctx);
    const bound = bindWorkspace(ctx, { areaIds: [doc.areas[0].id] });
    fs.renameSync(dir, moved);
    fs.cpSync(moved, dir, { recursive: true });
    assert.throws(() => resolveWorkspaceRepository(bound, doc.repositoryId));
    assert.throws(() => authorizeScope(bound, scope(doc)));
  } finally { cleanup(dir); cleanup(moved); }
});

test('a swapped metadata link is rejected even after a context is bound', (t) => {
  const { dir, ctx } = fixture();
  const target = makeTempDir('workspace-swap-target');
  try {
    const doc = create(ctx);
    const bound = bindWorkspace(ctx, { areaIds: [doc.areas[0].id] });
    const rel = workspaceFileRel(ctx);
    const targetFile = writeJson(target, 'workspace.json', doc);
    const file = path.join(dir, ...rel.split('/'));
    fs.unlinkSync(file);
    if (!trySymlink(targetFile, file, 'file')) {
      t.skip('file symlinks unavailable');
      return;
    }
    assert.throws(() => authorizeScope(bound, scope(doc)),
      (e) => e.code === 'SYMLINK_REJECTED');
    assert.throws(() => resolveWorkspaceRepository(bound, doc.repositoryId),
      (e) => e.code === 'SYMLINK_REJECTED');
    fs.unlinkSync(file);
    fs.writeFileSync(file, JSON.stringify(doc));
    assert.deepEqual(authorizeScope(bound, scope(doc)).areaIds, [doc.areas[0].id]);
  } finally { cleanup(dir); cleanup(target); }
});

test('workspace path follows state and rejects traversal and links', () => {
  const { dir, ctx } = fixture({ state: 'custom-state' });
  try {
    assert.equal(workspaceFileRel(ctx), 'custom-state/workspace.json');
    const invalidCtx = { ...ctx, config: { ...ctx.config,
      paths: { ...ctx.config.paths, state: '../escape' } } };
    assert.throws(() => workspaceFileRel(invalidCtx), (e) => e.code === 'INVALID_PATH');
    assert.throws(() => getWorkspace(invalidCtx), (e) => e.code === 'INVALID_PATH');
  } finally { cleanup(dir); }
});

test('CLI preview, apply, show, noop and mismatch preserve legacy config', async () => {
  const { dir, ctx, configRel } = fixture();
  const inputDir = makeTempDir('workspace-input');
  try {
    const configBytes = fs.readFileSync(path.join(dir, configRel));
    const input = writeJson(inputDir, 'workspace-input.json', TWO_AREAS);
    const before = snapshot(dir);
    const missing = await cli(['workspace', 'show', '--project', dir]);
    assert.equal(missing.code, 1);
    assert.equal(missing.body.error.code, 'WORKSPACE_NOT_FOUND');
    const preview = await cli(['workspace', 'init', '--project', dir, '--input', input]);
    assert.equal(preview.code, 0);
    assert.equal(preview.body.mode, 'dry-run');
    assert.equal(preview.body.applied, false);
    assert.equal(preview.body.files[0].action, 'create');
    assert.deepEqual(snapshot(dir), before);
    const applied = await cli(['workspace', 'init', '--project', dir, '--input', input, '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.body.mode, 'applied');
    assert.equal(applied.body.created, 1);
    assert.notEqual(preview.body.workspace.workspaceId, applied.body.workspace.workspaceId);
    assert.deepEqual(getWorkspace(ctx), applied.body.workspace);
    const after = snapshot(dir);
    const show = await cli(['workspace', 'show', '--project', dir]);
    assert.equal(show.code, 0);
    assert.deepEqual(show.body, applied.body.workspace);
    const again = await cli(['workspace', 'init', '--project', dir, '--input', input, '--apply']);
    assert.equal(again.code, 0);
    assert.equal(again.body.created, 0);
    assert.deepEqual(again.body.workspace, applied.body.workspace);
    const mismatchInput = writeJson(inputDir, 'different.json',
      { areas: [{ key: 'other', name: 'Other' }] });
    const mismatch = await cli(['workspace', 'init', '--project', dir,
      '--input', mismatchInput, '--apply']);
    assert.equal(mismatch.code, 1);
    assert.equal(mismatch.body.error.code, 'WORKSPACE_CONFLICT');
    assert.deepEqual(snapshot(dir), after);
    assert.deepEqual(fs.readFileSync(path.join(dir, configRel)), configBytes);
    assert.equal(fs.existsSync(path.join(dir, '.scopegrain')), false);
  } finally { cleanup(dir); cleanup(inputDir); }
});

test('CLI and binding use the .scopegrain state without creating legacy paths', async () => {
  const { dir, ctx } = fixture({
    state: '.scopegrain/state', configRel: '.scopegrain/config.json',
  });
  try {
    const before = snapshot(dir);
    const preview = await cli(['workspace', 'init', '--project', dir]);
    assert.equal(preview.code, 0);
    assert.equal(preview.body.mode, 'dry-run');
    assert.equal(preview.body.files[0].path, '.scopegrain/state/workspace.json');
    assert.deepEqual(snapshot(dir), before);
    const applied = await cli(['workspace', 'init', '--project', dir, '--apply']);
    assert.equal(applied.code, 0);
    assert.equal(applied.body.created, 1);
    const shown = await cli(['workspace', 'show', '--project', dir]);
    assert.equal(shown.code, 0);
    assert.deepEqual(shown.body, applied.body.workspace);
    const bound = bindWorkspace(ctx, { areaIds: [shown.body.areas[0].id] });
    assert.deepEqual(authorizeScope(bound, scope(shown.body)).areaIds,
      [shown.body.areas[0].id]);
    assert.equal(resolveWorkspaceRepository(bound, shown.body.repositoryId), ctx.projectRoot);
    assert.equal(workspaceFileRel(ctx), '.scopegrain/state/workspace.json');
    assert.equal(fs.existsSync(path.join(dir, '.tasksystem')), false);
  } finally { cleanup(dir); }
});

test('CLI explicit --config selects the legacy project despite ambiguous defaults', async () => {
  const { dir, ctx, configRel } = fixture();
  try {
    const current = writeJson(dir, '.scopegrain/config.json',
      createConfig(dir, VALID_ANSWERS, {}));
    const currentBytes = fs.readFileSync(current);
    const legacyBytes = fs.readFileSync(path.join(dir, configRel));
    const before = snapshot(dir);
    const ambiguous = await cli(['workspace', 'init', '--project', dir, '--apply']);
    assert.equal(ambiguous.code, 1);
    assert.equal(ambiguous.body.error.code, 'CONFIG_AMBIGUOUS');
    assert.deepEqual(snapshot(dir), before);
    const created = await cli(['workspace', 'init', '--project', dir,
      '--config', configRel, '--apply']);
    assert.equal(created.code, 0);
    assert.equal(created.body.created, 1);
    const shown = await cli(['workspace', 'show', '--project', dir, '--config', configRel]);
    assert.equal(shown.code, 0);
    assert.deepEqual(shown.body, getWorkspace(ctx));
    assert.deepEqual(fs.readFileSync(current), currentBytes);
    assert.deepEqual(fs.readFileSync(path.join(dir, configRel)), legacyBytes);
    assert.equal(fs.existsSync(path.join(dir, '.scopegrain/state')), false);
  } finally { cleanup(dir); }
});

test('CLI accepts external cwd-relative input and rejects parser/input errors before writes', async () => {
  const { dir } = fixture();
  const inputDir = makeTempDir('workspace-cli-input');
  try {
    const input = writeJson(inputDir, 'input.json', TWO_AREAS);
    const relative = path.relative(process.cwd(), input);
    const before = snapshot(dir);
    const preview = await cli(['workspace', 'init', '--project', dir, '--input', relative]);
    assert.equal(preview.code, 0);
    assert.deepEqual(preview.body.workspace.areas.map(({ key, name }) => ({ key, name })),
      TWO_AREAS.areas);
    const bad = [
      ['workspace', 'show', 'extra', '--project', 'nonexistent'],
      ['workspace', 'init', '--project', 'nonexistent', '--title', 'x'],
      ['workspace', 'show', '--project', 'nonexistent', '--input', input],
      ['workspace', 'init', '--project', 'nonexistent', '--force'],
      ['workspace', 'init', '--project', 'nonexistent', '--yes'],
      ['workspace', 'invalid', '--project', 'nonexistent'],
    ];
    for (const args of bad) {
      const out = await cli(args);
      assert.equal(out.code, 1);
      assert.equal(out.body.error.code, 'INVALID_ARGS');
    }
    const oversized = writeFile(inputDir, 'large.json',
      ' '.repeat(loadLimits().maxDocumentBytes + 1));
    const large = await cli(['workspace', 'init', '--project', dir, '--input', oversized]);
    assert.equal(large.code, 1);
    assert.equal(large.body.error.code, 'INPUT_TOO_LARGE');
    const malformed = writeFile(inputDir, 'bad.json', '{');
    const invalid = await cli(['workspace', 'init', '--project', dir, '--input', malformed]);
    assert.equal(invalid.code, 1);
    assert.equal(invalid.body.error.code, 'MALFORMED_JSON');
    const linked = path.join(inputDir, 'link.json');
    if (trySymlink(input, linked, 'file')) {
      const linkResult = await cli(['workspace', 'init', '--project', dir, '--input', linked]);
      assert.equal(linkResult.code, 1);
      assert.equal(linkResult.body.error.code, 'READ_FAILED');
    }
    assert.deepEqual(snapshot(dir), before);
  } finally { cleanup(dir); cleanup(inputDir); }
});

test('workspace enrollment leaves the MCP tool inventory unchanged', async (t) => {
  let z;
  try {
    ({ z } = await import('zod'));
  } catch {
    t.skip('optional MCP dependencies are not installed');
    return;
  }
  const { createMCPTools } = await import('../src/mcp/server.mjs');
  const { dir, ctx } = fixture();
  try {
    const names = [
      'scopegrain_inspect', 'scopegrain_status', 'scopegrain_list_tasks',
      'scopegrain_get_task', 'scopegrain_check_action', 'scopegrain_catalog_list',
      'scopegrain_catalog_get', 'scopegrain_workflow_packet', 'scopegrain_plan_get',
      'scopegrain_plan_next', 'scopegrain_artifact_get', 'scopegrain_session_get',
      'scopegrain_session_resume', 'scopegrain_resource_search',
      'scopegrain_resource_diagnose', 'scopegrain_specification_get',
      'scopegrain_approval_get', 'scopegrain_methodology_check',
    ].sort();
    const before = createMCPTools(ctx, z).map((tool) => tool.name).sort();
    assert.deepEqual(before, names);
    create(ctx);
    assert.deepEqual(createMCPTools(ctx, z).map((tool) => tool.name).sort(), names);
  } finally { cleanup(dir); }
});
