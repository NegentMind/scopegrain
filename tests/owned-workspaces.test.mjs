// Journal-backed owned workspace updates: opt-in store that mutates the
// workspace identity descriptor through applyJournaledRecordUpdate CAS.
// The descriptor is the authority behind every scope proof, so identity
// fields are frozen by construction, every committed update stale-ates
// all live bindings, and a durable pointer written in the same op lets
// get() prove the head state without a history index. Legacy
// enrollment/read/bind paths stay byte-identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import {
  applyJournaledRecordUpdate, getJournalOperation,
  prepareJournalRecovery, readJournalSnapshot, recoverJournalOperation,
} from '../src/core/journal.mjs';
import {
  resultingSourceRevision, validateRecordTransition,
} from '../src/core/record-history.mjs';
import {
  authorizeScope, bindWorkspace, createOwnedWorkspaceStore, getWorkspace,
  prepareWorkspace,
} from '../src/core/workspaces.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, writeJson } from './helpers.mjs';

const SHA = (content) =>
  crypto.createHash('sha256').update(content).digest('hex');
const AREAS = [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }];

function fixture({ state = '.tasksystem/state', configRel = '.tasksystem/config.json' } = {}) {
  const dir = makeTempDir('owned-workspace');
  const answers = { ...VALID_ANSWERS, paths: { ...VALID_ANSWERS.paths, state } };
  writeJson(dir, configRel, createConfig(dir, answers, {}));
  const ctx = resolveContext({ project: dir, config: configRel });
  const prepared = prepareWorkspace(ctx, { areas: AREAS.map((a) => ({ ...a })) });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  const stateAbs = path.join(dir, ...state.split('/'));
  return {
    dir, ctx, a, b, workspace: prepared.workspace,
    sourceFile: path.join(stateAbs, 'workspace.json'),
    pointerFile: path.join(stateAbs, 'workspace-ownership.json'),
    journalDir: path.join(stateAbs, 'journal'),
    operationsDir: path.join(stateAbs, 'journal', 'operations'),
  };
}

function store(f, areaIds = [f.a, f.b]) {
  return createOwnedWorkspaceStore(f.ctx, { areaIds });
}

function input(f, areas, areaIds = [f.a, f.b]) {
  return { areaIds, workspace: { areas } };
}

function scopeOf(workspace, areaIds) {
  return {
    workspaceId: workspace.workspaceId, projectId: workspace.projectId,
    repositoryId: workspace.repositoryId, areaIds,
  };
}

function descriptorBytes(workspace) {
  return Buffer.from(JSON.stringify(workspace, null, 2) + '\n');
}

function readDescriptor(f) {
  return JSON.parse(fs.readFileSync(f.sourceFile, 'utf8'));
}

function readPointer(f) {
  return JSON.parse(fs.readFileSync(f.pointerFile, 'utf8'));
}

function operationCount(f) {
  if (!fs.existsSync(f.operationsDir)) return 0;
  return fs.readdirSync(f.operationsDir).length;
}

function tree(dir) {
  const values = {};
  function visit(root, rel = '') {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(root, entry.name);
      if (entry.isDirectory()) {
        values[next] = 'directory';
        visit(abs, next);
      } else {
        values[next] = fs.readFileSync(abs);
      }
    }
  }
  if (fs.existsSync(dir)) visit(dir);
  return values;
}

function recoverOptions(f, operationId, action) {
  return {
    action,
    expectedIntentDigest: getJournalOperation(
      bindWorkspace(f.ctx, { areaIds: [f.a, f.b] }), operationId).intentDigest,
    reason: 'operator decision',
  };
}

test('construction and inputs are closed, scoped and enrollment-bound', () => {
  const f = fixture();
  try {
    const before = tree(f.dir);
    for (const ctx of [null, {}, { projectRoot: 5, config: {} },
      { projectRoot: f.dir }]) {
      assert.throws(() => createOwnedWorkspaceStore(ctx, { areaIds: [f.a] }),
        (e) => e.code === 'INVALID_OWNED_WORKSPACE_INPUT');
    }
    for (const options of [null, {}, { areaIds: null }, { areaIds: [] },
      { areaIds: [f.a, f.a] }, { areaIds: ['X'] },
      { areaIds: [f.a.toUpperCase()] }, { areaIds: [f.a], extra: true }]) {
      assert.throws(() => createOwnedWorkspaceStore(f.ctx, options),
        (e) => e.code === 'INVALID_OWNED_WORKSPACE_INPUT', JSON.stringify(options));
    }
    assert.throws(() => createOwnedWorkspaceStore(f.ctx,
      { areaIds: ['00000000-0000-0000-0000-000000000000'] }),
    (e) => e.code === 'SCOPE_DENIED');
    const owned = store(f);
    assert.ok(Object.isFrozen(owned));
    const valid = input(f, AREAS.map((a) => ({ ...a })));
    const bad = [
      null, [], 'x', {}, { areaIds: [f.a] }, { workspace: valid.workspace },
      { ...valid, extra: 1 },
      { ...valid, workspace: null },
      { ...valid, workspace: { areas: [], extra: 1 } },
      { ...valid, workspace: {} },
      { ...valid, workspace: { areas: [] } },
      { ...valid, workspace: { areas: 'x' } },
      { ...valid, workspace: { areas: [{ key: 'alpha' }] } },
      { ...valid, workspace: { areas: [{ key: 'alpha', name: 'A', id: f.a }] } },
      { ...valid, workspace: { areas: [{ key: 'Alpha', name: 'A' },
        { key: 'beta', name: 'B' }] } },
      { ...valid, workspace: { areas: [{ key: 'alpha', name: ' ' },
        { key: 'beta', name: 'B' }] } },
      { ...valid, areaIds: [] },
      { ...valid, areaIds: [f.a, f.a] },
      { ...valid, areaIds: [f.a.toUpperCase()] },
      { ...valid, areaIds: ['not-a-uuid'] },
      // Area removal is unexpressible: missing existing key 'beta'.
      input(f, [{ key: 'alpha', name: 'Alpha' }]),
      // Same for a key rename (remove+add) - 'beta' must be retained.
      input(f, [{ key: 'alpha', name: 'Alpha' }, { key: 'beta2', name: 'B' }]),
    ];
    for (const value of bad) {
      assert.throws(() => owned.update(value),
        (e) => e.code === 'INVALID_OWNED_WORKSPACE_INPUT', JSON.stringify(value));
      assert.throws(() => owned.prepare(value),
        (e) => e.code === 'INVALID_OWNED_WORKSPACE_INPUT', JSON.stringify(value));
    }
    // All-of scope: a grant the store does not hold is denied; a grant
    // outside the descriptor is denied.
    assert.throws(() => store(f, [f.a]).update(input(f, valid.workspace.areas)),
      (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => owned.update(input(f, valid.workspace.areas,
      [f.a, '00000000-0000-0000-0000-000000000000'])),
    (e) => e.code === 'SCOPE_DENIED');
    assert.deepEqual(tree(f.dir), before);
    assert.equal(fs.existsSync(f.journalDir), false);
    assert.equal(fs.existsSync(f.pointerFile), false);
  } finally { cleanup(f.dir); }
});

test('a store requires existing enrollment and never creates the descriptor', () => {
  const dir = makeTempDir('owned-workspace-bare');
  try {
    writeJson(dir, '.tasksystem/config.json', createConfig(dir, VALID_ANSWERS, {}));
    const ctx = resolveContext({ project: dir, config: '.tasksystem/config.json' });
    assert.throws(() => createOwnedWorkspaceStore(ctx,
      { areaIds: ['00000000-0000-0000-0000-000000000000'] }),
    (e) => e.code === 'WORKSPACE_NOT_FOUND');
    const before = tree(dir);
    assert.equal(fs.existsSync(path.join(dir, '.tasksystem', 'state')), false);
    assert.deepEqual(tree(dir), before);
  } finally { cleanup(dir); }
});

test('prepare is a read-only preview with provisional identity', () => {
  const f = fixture();
  try {
    const before = tree(f.dir);
    const owned = store(f);
    const preview = owned.prepare(input(f, [
      { key: 'alpha', name: 'Alpha Renamed' },
      { key: 'beta', name: 'Beta' },
      { key: 'gamma', name: 'Gamma' },
    ]));
    assert.equal(preview.mode, 'dry-run');
    assert.equal(preview.reservesIds, false);
    assert.equal(preview.enrolled, false);
    assert.equal(preview.changed, true);
    assert.equal(preview.sourceRel, '.tasksystem/state/workspace.json');
    assert.equal(preview.pointerRel, '.tasksystem/state/workspace-ownership.json');
    const next = preview.record;
    assert.equal(next.revision, f.workspace.revision + 1);
    assert.equal(next.workspaceId, f.workspace.workspaceId);
    assert.equal(next.projectId, f.workspace.projectId);
    assert.equal(next.repositoryId, f.workspace.repositoryId);
    assert.equal(next.createdAt, f.workspace.createdAt);
    assert.ok(Number.isFinite(Date.parse(next.updatedAt)));
    assert.equal(next.areas[0].id, f.a);
    assert.equal(next.areas[0].name, 'Alpha Renamed');
    assert.equal(next.areas[1].id, f.b);
    const [gamma] = next.areas.filter((area) => area.key === 'gamma');
    assert.match(gamma.id, /^[0-9a-f-]{36}$/);
    assert.ok(![f.a, f.b].includes(gamma.id));
    const same = owned.prepare(input(f, AREAS.map((a) => ({ ...a }))));
    assert.equal(same.changed, false);
    assert.deepEqual(tree(f.dir), before);
  } finally { cleanup(f.dir); }
});

test('first update lazily enrolls the pointer and commits a two-event update op', () => {
  const f = fixture();
  try {
    const owned = store(f);
    const result = owned.update(input(f, [
      { key: 'alpha', name: 'Alpha Renamed' },
      { key: 'beta', name: 'Beta' },
      { key: 'gamma', name: 'Gamma' },
    ]));
    assert.equal(result.mode, 'applied');
    assert.equal(result.updateApplied, true);
    assert.equal(result.updateConfirmed, true);
    assert.equal(result.journal.status, 'committed');
    assert.equal(result.journal.journalState, 'confirmed');
    const next = result.record;
    assert.equal(next.revision, 1);
    assert.equal(next.workspaceId, f.workspace.workspaceId);
    assert.equal(next.areas[0].id, f.a);
    assert.equal(next.areas[0].name, 'Alpha Renamed');
    assert.equal(next.areas[1].id, f.b);
    const gamma = next.areas.find((area) => area.key === 'gamma');
    assert.ok(gamma && ![f.a, f.b].includes(gamma.id));
    // Byte-level contract: the descriptor on disk is exactly the
    // serialized derived document.
    const currentBytes = fs.readFileSync(f.sourceFile);
    assert.deepEqual(currentBytes, descriptorBytes(next));
    assert.deepEqual(readDescriptor(f), next);
    // The pointer proves the update op, revision and post-image hash and
    // links back to the single-event genesis enrollment.
    const bound = bindWorkspace(f.ctx, { areaIds: [f.a, f.b] });
    const pointer = readPointer(f);
    assert.equal(pointer.schemaVersion, 2);
    assert.equal(pointer.workspaceId, f.workspace.workspaceId);
    assert.equal(pointer.revision, 1);
    assert.equal(pointer.sourceHash, SHA(currentBytes));
    assert.equal(pointer.operationId, result.journal.operationId);
    const genesisOp = fs.readdirSync(f.operationsDir)
      .map((id) => getJournalOperation(bound, id))
      .find((loaded) => loaded.intent.events.length === 1);
    assert.equal(pointer.previousOperationId, genesisOp.intent.operationId);
    assert.equal(pointer.createOperationId, genesisOp.intent.operationId);
    const op = getJournalOperation(bound, pointer.operationId);
    assert.equal(op.state, 'committed');
    assert.equal(op.intent.createdAt, pointer.updatedAt);
    assert.equal(op.intent.events.length, 2);
    const [sourceEvent, pointerEvent] = op.intent.events;
    assert.equal(sourceEvent.operation, 'update');
    assert.equal(sourceEvent.sourceKind, 'workspace');
    assert.equal(sourceEvent.recordId, f.workspace.workspaceId);
    assert.equal(sourceEvent.sourceRevision, 0);
    assert.equal(sourceEvent.previousHash, SHA(descriptorBytes(f.workspace)));
    assert.equal(sourceEvent.sourceHash, SHA(currentBytes));
    assert.equal(resultingSourceRevision(sourceEvent), 1);
    assert.equal(pointerEvent.operation, 'update');
    assert.equal(pointerEvent.sourceKind, 'workspace-ownership');
    assert.equal(pointerEvent.sourceRevision, 0);
    assert.equal(resultingSourceRevision(pointerEvent), 1);
    assert.deepEqual(readJournalSnapshot(
      bindWorkspace(f.ctx, { areaIds: [f.a, f.b] }),
      pointer.operationId, sourceEvent.eventId), currentBytes);
    // Genesis enrollment op: a single create event for the pointer.
    assert.equal(operationCount(f), 2);
    // get() proves the head state through the pointer.
    const got = owned.get();
    assert.equal(got.journaled, true);
    assert.equal(got.isCurrentSource, true);
    assert.equal(got.memoryConsulted, false);
    assert.deepEqual(got.record, next);
    assert.equal(got.locator.operationId, result.journal.operationId);
    assert.equal(got.locator.eventId, sourceEvent.eventId);
  } finally { cleanup(f.dir); }
});

test('a second update chains revisions and pre-image hashes', () => {
  const f = fixture();
  try {
    const owned = store(f);
    const first = owned.update(input(f, [
      { key: 'alpha', name: 'A1' }, { key: 'beta', name: 'Beta' },
    ]));
    const second = owned.update(input(f, [
      { key: 'alpha', name: 'A1' }, { key: 'beta', name: 'Beta' },
      { key: 'delta', name: 'Delta' },
    ], [f.a]));
    assert.equal(second.updateConfirmed, true);
    assert.equal(second.record.revision, 2);
    const bound = bindWorkspace(f.ctx, { areaIds: [f.a, f.b] });
    const ops = fs.readdirSync(f.operationsDir).map((operationId) =>
      getJournalOperation(bound, operationId));
    const updates = [];
    for (const op of ops) {
      for (const event of op.intent.events) {
        if (event.operation === 'update') updates.push(event);
      }
    }
    updates.sort((x, y) => x.journalSequence - y.journalSequence);
    assert.equal(updates.length, 4);
    const workspaceEvents = updates.filter((e) => e.sourceKind === 'workspace');
    const pointerEvents = updates.filter((e) => e.sourceKind === 'workspace-ownership');
    assert.equal(workspaceEvents.length, 2);
    assert.equal(pointerEvents.length, 2);
    assert.equal(validateRecordTransition(workspaceEvents[0], workspaceEvents[1]), undefined);
    assert.equal(workspaceEvents[1].sourceRevision, 1);
    assert.equal(workspaceEvents[1].previousHash, workspaceEvents[0].sourceHash);
    assert.equal(resultingSourceRevision(workspaceEvents[1]), 2);
    assert.equal(validateRecordTransition(pointerEvents[0], pointerEvents[1]), undefined);
    // The enrollment create event chains into the first pointer update.
    const genesis = ops
      .flatMap((op) => op.intent.events)
      .find((e) => e.operation === 'create' && e.sourceKind === 'workspace-ownership');
    assert.ok(genesis);
    assert.equal(validateRecordTransition(genesis, pointerEvents[0]), undefined);
    const pointer = readPointer(f);
    assert.equal(pointer.revision, 2);
    assert.equal(pointer.operationId, second.journal.operationId);
    // The tip links to the first update op, which links to genesis:
    // previousOperationId forms the committed chain get() replays.
    assert.equal(pointer.previousOperationId, first.journal.operationId);
    assert.equal(pointer.createOperationId,
      ops.find((loaded) => loaded.intent.events.length === 1)
        .intent.operationId);
    const got = owned.get();
    assert.equal(got.journaled, true);
    assert.equal(got.locator.operationId, second.journal.operationId);
    assert.equal(getWorkspace(f.ctx).revision, 2);
  } finally { cleanup(f.dir); }
});

test('get replays every committed op: a tampered intermediate fails closed', () => {
  const f = fixture();
  try {
    const owned = store(f);
    const first = owned.update(input(f, [
      { key: 'alpha', name: 'A1' }, { key: 'beta', name: 'Beta' },
    ]));
    const second = owned.update(input(f, [
      { key: 'alpha', name: 'A1' }, { key: 'beta', name: 'Beta' },
      { key: 'delta', name: 'Delta' },
    ]));
    // Three committed ops: genesis enrollment + two two-event updates.
    assert.equal(operationCount(f), 3);
    const bound = bindWorkspace(f.ctx, { areaIds: [f.a, f.b] });
    // The pointer links tip -> first update -> genesis; each link's doc
    // is the snapshot its own op committed.
    const pointer = readPointer(f);
    assert.equal(pointer.previousOperationId, first.journal.operationId);
    const middle = getJournalOperation(bound, pointer.previousOperationId);
    const middlePointer = middle.intent.events
      .find((e) => e.sourceKind === 'workspace-ownership');
    const middleDoc = JSON.parse(readJournalSnapshot(bound,
      middle.intent.operationId, middlePointer.eventId).toString('utf8'));
    assert.equal(middleDoc.operationId, middle.intent.operationId);
    assert.equal(middleDoc.previousOperationId, pointer.createOperationId);
    const genesis = getJournalOperation(bound, middleDoc.previousOperationId);
    assert.equal(genesis.intent.events.length, 1);
    assert.equal(genesis.intent.events[0].operation, 'create');
    assert.equal(owned.get().record.revision, 2);
    assert.equal(owned.get().locator.operationId, second.journal.operationId);
    // Corrupting the intermediate op's pointer snapshot is caught by the
    // content-addressed read mid-chain, never skipped or adopted.
    const blob = path.join(f.journalDir, 'snapshots',
      `${middlePointer.sourceHash}.blob`);
    const originalBlob = fs.readFileSync(blob);
    fs.writeFileSync(blob, Buffer.from('tampered intermediate snapshot'));
    assert.throws(() => owned.get(),
      (e) => e.code === 'JOURNAL_SNAPSHOT_MISMATCH');
    fs.writeFileSync(blob, originalBlob);
    // A tampered intermediate intent breaks its commit digest.
    const intentRel = path.join(f.operationsDir, first.journal.operationId,
      'intent.json');
    const originalIntent = fs.readFileSync(intentRel);
    const forged = JSON.parse(originalIntent.toString('utf8'));
    forged.createdAt = '2030-01-01T00:00:00.000Z';
    fs.writeFileSync(intentRel, JSON.stringify(forged, null, 2) + '\n');
    assert.throws(() => owned.get(), (e) => e.code === 'JOURNAL_MALFORMED');
    fs.writeFileSync(intentRel, originalIntent);
    // Deleting the intermediate op outright fails closed the same way.
    fs.rmSync(path.join(f.operationsDir, first.journal.operationId),
      { recursive: true, force: true });
    assert.throws(() => owned.get(), (e) => e.code === 'JOURNAL_NOT_FOUND');
  } finally { cleanup(f.dir); }
});

test('an unchanged resolved area set is a noop and never journals', () => {
  const f = fixture();
  try {
    const owned = store(f);
    const before = tree(f.dir);
    const result = owned.update(input(f, AREAS.map((a) => ({ ...a }))));
    assert.equal(result.mode, 'unchanged');
    assert.equal(result.journal, null);
    assert.deepEqual(result.record, f.workspace);
    assert.deepEqual(tree(f.dir), before);
    assert.equal(fs.existsSync(f.journalDir), false);
    // A rename is a change even when the set of keys is identical.
    const renamed = owned.update(input(f, [
      { key: 'alpha', name: 'Alpha 2' }, { key: 'beta', name: 'Beta' },
    ]));
    assert.equal(renamed.mode, 'applied');
    // After it, the exact same input is again a noop.
    const noop = owned.update(input(f, [
      { key: 'alpha', name: 'Alpha 2' }, { key: 'beta', name: 'Beta' },
    ]));
    assert.equal(noop.mode, 'unchanged');
  } finally { cleanup(f.dir); }
});

test('descriptor drift breaks the pointer proof and blocks update without journal state', () => {
  const f = fixture();
  try {
    const owned = store(f);
    const applied = owned.update(input(f, [
      { key: 'alpha', name: 'A1' }, { key: 'beta', name: 'Beta' },
    ]));
    const v1 = fs.readFileSync(f.sourceFile);
    const opsBefore = operationCount(f);
    // Foreign drift: plausible, structurally valid, revision-bumped.
    const foreign = { ...readDescriptor(f), revision: 2, updatedAt: new Date().toISOString() };
    fs.writeFileSync(f.sourceFile, JSON.stringify(foreign, null, 2) + '\n');
    assert.throws(() => owned.get(), (e) => e.code === 'OWNED_WORKSPACE_SOURCE_CHANGED');
    assert.throws(() => owned.update(input(f, [
      { key: 'alpha', name: 'A2' }, { key: 'beta', name: 'Beta' },
    ])), (e) => e.code === 'OWNED_WORKSPACE_SOURCE_CHANGED');
    assert.equal(operationCount(f), opsBefore);
    // Pointer drift is equally fatal.
    fs.writeFileSync(f.sourceFile, v1);
    const forged = { ...readPointer(f), revision: 99 };
    fs.writeFileSync(f.pointerFile, JSON.stringify(forged, null, 2) + '\n');
    assert.throws(() => owned.get(), (e) => e.code === 'OWNED_WORKSPACE_MALFORMED');
    // Restoring the proven pair re-validates cleanly through a fresh bind.
    const restored = { ...forged, revision: applied.record.revision };
    fs.writeFileSync(f.pointerFile, JSON.stringify(restored, null, 2) + '\n');
    assert.equal(owned.get().record.revision, applied.record.revision);
  } finally { cleanup(f.dir); }
});

test('a racing non-journal write fails CAS under the lock with zero state consumed', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    const owned = store(f);
    const v1 = fs.readFileSync(f.sourceFile);
    let locks = 0;
    const lockFile = `${path.join(f.journalDir, '.lock')}`;
    fs.openSync = function (file, flags, ...args) {
      const fd = open.call(this, file, flags, ...args);
      if (String(file) === lockFile && flags === 'wx') {
        locks += 1;
        if (locks === 2) {
          // Between the store's read and the update op's under-lock CAS:
          // enrollment already committed the genesis pointer; now race the
          // descriptor itself. Canonically-equal but byte-divergent JSON
          // passes the binding's digest revalidation and dies on the CAS.
          fs.writeFileSync(f.sourceFile, `  ${v1.toString('utf8')}  `);
        }
      }
      return fd;
    };
    assert.throws(() => owned.update(input(f, [
      { key: 'alpha', name: 'A1' }, { key: 'beta', name: 'Beta' },
    ])), (e) => e.code === 'JOURNAL_SOURCE_CONFLICT');
    fs.openSync = open;
    // A byte-level divergent write leaves different bytes on disk even
    // though the canonical descriptor content is unchanged.
    assert.notDeepEqual(fs.readFileSync(f.sourceFile), v1);
    // The genesis enrollment committed; the descriptor is back at rev0
    // bytes but NOT matching the pointer's recorded hash - get proves the
    // genesis base instead of adopting drift.
    fs.writeFileSync(f.sourceFile, v1);
    const got = owned.get();
    assert.equal(got.journaled, false);
    assert.equal(got.record.revision, 0);
    assert.equal(operationCount(f), 1);
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('a stale binding stays latched after descriptor bytes are restored', () => {
  const f = fixture();
  try {
    const owned = store(f);
    owned.update(input(f, [
      { key: 'alpha', name: 'A1' }, { key: 'beta', name: 'Beta' },
    ]));
    const bound = bindWorkspace(f.ctx, { areaIds: [f.a] });
    const v1 = fs.readFileSync(f.sourceFile);
    const diverged = { ...readDescriptor(f), updatedAt: '2030-01-01T00:00:00.000Z' };
    fs.writeFileSync(f.sourceFile, JSON.stringify(diverged, null, 2) + '\n');
    const scope = scopeOf(readDescriptor(f), [f.a]);
    assert.throws(() => authorizeScope(bound, scope),
      (e) => e.code === 'WORKSPACE_STALE');
    // Restoring the exact proven bytes does NOT reactivate the binding.
    fs.writeFileSync(f.sourceFile, v1);
    assert.throws(() => authorizeScope(bound, scope),
      (e) => e.code === 'WORKSPACE_STALE');
    // A fresh bind re-validates the restored consistent state.
    const fresh = bindWorkspace(f.ctx, { areaIds: [f.a] });
    assert.deepEqual(authorizeScope(fresh, scope).areaIds, [f.a]);
    assert.equal(owned.get().journaled, true);
  } finally { cleanup(f.dir); }
});

test('unowned and forged descriptors are never adopted by get', () => {
  const f = fixture();
  try {
    const owned = store(f);
    // Legacy enrollment only: no pointer, no journal - never adopted.
    assert.throws(() => owned.get(), (e) => e.code === 'OWNED_WORKSPACE_NOT_FOUND');
    // A foreign rev>0 descriptor is equally unowned, but update can
    // journal-enroll it as the transparent CAS-verified base.
    const foreign = { ...readDescriptor(f), revision: 5,
      updatedAt: '2030-01-01T00:00:00.000Z' };
    fs.writeFileSync(f.sourceFile, JSON.stringify(foreign, null, 2) + '\n');
    assert.throws(() => owned.get(), (e) => e.code === 'OWNED_WORKSPACE_NOT_FOUND');
    const applied = owned.update(input(f, [
      { key: 'alpha', name: 'A1' }, { key: 'beta', name: 'Beta' },
    ]));
    assert.equal(applied.record.revision, 6);
    assert.equal(owned.get().journaled, true);
    // Forged pointer with an unknown operation id: never adopted.
    fs.writeFileSync(f.pointerFile, JSON.stringify({
      ...readPointer(f), operationId: '11111111-1111-4111-8111-111111111111',
    }, null, 2) + '\n');
    assert.throws(() => owned.get(),
      (e) => ['JOURNAL_NOT_FOUND', 'OWNED_WORKSPACE_MALFORMED'].includes(e.code));
    // Deleting the pointer removes provable continuity: fail closed.
    fs.rmSync(f.pointerFile);
    assert.throws(() => owned.get(), (e) => e.code === 'OWNED_WORKSPACE_NOT_FOUND');
    // Deleting the descriptor keeps the domain code.
    fs.rmSync(f.sourceFile);
    assert.throws(() => owned.get(), (e) => e.code === 'WORKSPACE_NOT_FOUND');
  } finally { cleanup(f.dir); }
});

test('apply-phase failure keeps the unconfirmed receipt and leaves both sources untouched', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    const owned = store(f);
    owned.update(input(f, [
      { key: 'alpha', name: 'A1' }, { key: 'beta', name: 'Beta' },
    ]));
    const v1Source = fs.readFileSync(f.sourceFile);
    const v1Pointer = fs.readFileSync(f.pointerFile);
    fs.openSync = function (file, flags, ...args) {
      if (String(file).includes('.upd-') && flags === 'wx') {
        const error = new Error('fixture temp failure');
        error.code = 'EIO';
        throw error;
      }
      return open.call(this, file, flags, ...args);
    };
    const result = owned.update(input(f, [
      { key: 'alpha', name: 'A2' }, { key: 'beta', name: 'Beta' },
    ]));
    fs.openSync = open;
    assert.equal(result.mode, 'applied');
    assert.equal(result.updateApplied, true);
    assert.equal(result.updateConfirmed, false);
    assert.equal(result.journal.status, 'unconfirmed');
    assert.equal(result.journal.journalState, 'prepared');
    assert.deepEqual(fs.readFileSync(f.sourceFile), v1Source);
    assert.deepEqual(fs.readFileSync(f.pointerFile), v1Pointer);
    // The pending op blocks the next journal write.
    assert.throws(() => owned.update(input(f, [
      { key: 'alpha', name: 'A2' }, { key: 'beta', name: 'Beta' },
    ])), (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    // The proven head is still get()-able: it points at the committed v1 op.
    assert.equal(owned.get().record.revision, 1);
    // Explicit recovery: abandon preserves applied state, never restores.
    const bound = bindWorkspace(f.ctx, { areaIds: [f.a, f.b] });
    const pendingOp = result.journal.operationId;
    const preview = prepareJournalRecovery(bound, pendingOp,
      recoverOptions(f, pendingOp, 'abandon-prepared'));
    assert.equal(preview.mode, 'dry-run');
    const done = recoverJournalOperation(bound, pendingOp,
      recoverOptions(f, pendingOp, 'abandon-prepared'));
    assert.equal(done.state, 'abandoned');
    assert.deepEqual(fs.readFileSync(f.sourceFile), v1Source);
    // Retry after recovery commits normally.
    const retried = owned.update(input(f, [
      { key: 'alpha', name: 'A2' }, { key: 'beta', name: 'Beta' },
    ]));
    assert.equal(retried.updateConfirmed, true);
    assert.equal(retried.record.revision, 2);
    assert.equal(owned.get().record.revision, 2);
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('an unconfirmed enrollment returns the create receipt and blocks the update', () => {
  const f = fixture();
  const open = fs.openSync;
  try {
    const owned = store(f);
    fs.openSync = function (file, flags, ...args) {
      if (String(file) === f.pointerFile && flags === 'wx') {
        const error = new Error('fixture enrollment failure');
        error.code = 'EIO';
        throw error;
      }
      return open.call(this, file, flags, ...args);
    };
    const result = owned.update(input(f, [
      { key: 'alpha', name: 'A1' }, { key: 'beta', name: 'Beta' },
    ]));
    fs.openSync = open;
    assert.equal(result.mode, 'applied');
    assert.equal(result.updateApplied, false);
    assert.equal(result.updateConfirmed, false);
    assert.equal(result.journal.status, 'unconfirmed');
    assert.equal(result.journal.journalState, 'prepared');
    assert.equal(result.record.revision, 0);
    assert.equal(fs.existsSync(f.pointerFile), false);
    assert.deepEqual(fs.readFileSync(f.sourceFile), descriptorBytes(f.workspace));
    // The pending enrollment blocks any further journal write.
    assert.throws(() => owned.update(input(f, [
      { key: 'alpha', name: 'A1' }, { key: 'beta', name: 'Beta' },
    ])), (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    const bound = bindWorkspace(f.ctx, { areaIds: [f.a, f.b] });
    recoverJournalOperation(bound, result.journal.operationId,
      recoverOptions(f, result.journal.operationId, 'abandon-prepared'));
    const retried = owned.update(input(f, [
      { key: 'alpha', name: 'A1' }, { key: 'beta', name: 'Beta' },
    ]));
    assert.equal(retried.updateConfirmed, true);
    assert.equal(owned.get().journaled, true);
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('grants re-bind per call: added areas become grantable, removed grants deny', () => {
  const f = fixture();
  try {
    const owned = store(f, [f.a]);
    const applied = owned.update(input(f, [
      { key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' },
      { key: 'gamma', name: 'Gamma' },
    ], [f.a]));
    const gamma = applied.record.areas.find((area) => area.key === 'gamma');
    // A store granted only the new area can now operate scoped to it.
    const ownedGamma = store(f, [gamma.id]);
    const second = ownedGamma.update(input(f, [
      { key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' },
      { key: 'gamma', name: 'Gamma 2' },
    ], [gamma.id]));
    assert.equal(second.updateConfirmed, true);
    // Writes only need the request scope, but get() now replays the FULL
    // committed chain: every op is scope-reauthorized, so a grant that
    // does not cover every historical event scope cannot prove history.
    assert.throws(() => ownedGamma.get(), (e) => e.code === 'SCOPE_DENIED');
    assert.throws(() => owned.get(), (e) => e.code === 'SCOPE_DENIED');
    // A store holding the union of every area the chain was scoped to
    // proves the whole history end to end.
    const ownedAll = store(f, [f.a, f.b, gamma.id]);
    assert.equal(ownedAll.get().record.revision, 2);
    // Scope still requires all-of inside the event: alpha+gamma mixed
    // under a gamma-only grant is denied.
    assert.throws(() => ownedGamma.update(input(f, [
      { key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' },
      { key: 'gamma', name: 'Gamma 3' },
    ], [f.a, gamma.id])), (e) => e.code === 'SCOPE_DENIED');
  } finally { cleanup(f.dir); }
});

test('raw update seams cannot forge the pointer proof', () => {
  const f = fixture();
  try {
    const owned = store(f);
    owned.update(input(f, [
      { key: 'alpha', name: 'A1' }, { key: 'beta', name: 'Beta' },
    ]));
    const bound = bindWorkspace(f.ctx, { areaIds: [f.a, f.b] });
    // A raw journaled update of the pointer alone diverges from the op
    // the pointer names - the proof fails closed.
    const pointerBytes = fs.readFileSync(f.pointerFile);
    const forged = { ...readPointer(f),
      sourceHash: 'f'.repeat(64), revision: 77 };
    applyJournaledRecordUpdate(bound, () => [{
      sourceKind: 'workspace-ownership', recordId: f.workspace.workspaceId,
      sourceRevision: 1, previousHash: SHA(pointerBytes),
      areaIds: [f.a],
      file: { rel: '.tasksystem/state/workspace-ownership.json',
        content: Buffer.from(JSON.stringify(forged, null, 2) + '\n') },
    }]);
    // The forged pointer claims a provenance hash the descriptor does
    // not have: the byte-hash check fails closed as source-changed.
    assert.throws(() => owned.get(), (e) => e.code === 'OWNED_WORKSPACE_SOURCE_CHANGED');
  } finally { cleanup(f.dir); }
});
