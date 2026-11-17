// Lifecycle: adopt preview, update preview/apply, doctor lifecycle checks.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyUpdate, prepareAdopt, prepareUpdate,
} from '../src/core/lifecycle.mjs';
import { runDoctor } from '../src/core/doctor.mjs';
import { createConfig } from '../src/core/config.mjs';
import {
  cleanup, makeTempDir, VALID_ANSWERS, writeFile, writeJson,
} from './helpers.mjs';
import {
  bootstrappedMiniCtx, configuredCtx, destroyLifecycleInstall, enroll,
  snapshot,
} from './helpers/lifecycle-fixture.mjs';

after(() => destroyLifecycleInstall());

const OP_ID = '11111111-2222-3333-4444-555555555555';
const DIGEST = 'a'.repeat(64);

// ---------- adopt ----------

test('adopt on initialized project reports bindings, writes nothing', () => {
  const { dir } = configuredCtx();
  try {
    const before = snapshot(dir);
    const report = prepareAdopt(dir);
    assert.deepEqual(snapshot(dir), before); // fully read-only
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.configRel, '.tasksystem/config.json');
    assert.equal(report.workspace, null);
    assert.equal(report.journalState, 'absent');
    assert.equal(report.status, 'adoptable');
    assert.equal(report.issues.length, 0);
    assert.equal(report.config.name, 'fixture-project');
    assert.equal(report.config.methodology, 'manual');
  } finally { cleanup(dir); }
});

test('adopt reports enrolled workspace and journal activity', () => {
  const { dir, ctx } = configuredCtx();
  try {
    const workspace = enroll(ctx);
    writeJson(dir, '.tasksystem/state/journal/head.json', {
      schemaVersion: 1, lastSequence: 3,
      activeOperation: { operationId: OP_ID, intentDigest: DIGEST },
    });
    const report = prepareAdopt(dir);
    assert.ok(report.workspace);
    assert.equal(report.workspace.workspaceId, workspace.workspaceId);
    assert.equal(report.workspace.areas, 1);
    assert.equal(report.journalState, 'active');
    assert.equal(report.status, 'attention'); // active op needs review
  } finally { cleanup(dir); }
});

test('adopt on uninitialized and ambiguous/malformed configs reports issues', () => {
  const empty = makeTempDir('adopt-empty');
  try {
    const report = prepareAdopt(empty);
    assert.equal(report.configRel, null);
    assert.equal(report.config, null);
    assert.equal(report.workspace, null);
    assert.equal(report.journalState, 'unknown');
    assert.equal(report.status, 'attention');
    assert.ok(report.issues.some((i) => i.code === 'CONFIG_NOT_FOUND'));
  } finally { cleanup(empty); }

  const ambiguous = makeTempDir('adopt-ambig');
  try {
    writeJson(ambiguous, '.scopegrain/config.json', {});
    writeJson(ambiguous, '.tasksystem/config.json', {});
    const report = prepareAdopt(ambiguous);
    assert.equal(report.configRel, null);
    assert.ok(report.issues.some((i) => i.code === 'CONFIG_AMBIGUOUS'));
  } finally { cleanup(ambiguous); }

  const malformed = makeTempDir('adopt-bad');
  try {
    writeFile(malformed, '.tasksystem/config.json', '{corrupt');
    const report = prepareAdopt(malformed);
    assert.equal(report.configRel, '.tasksystem/config.json');
    assert.equal(report.config, null);
    assert.ok(report.issues.some((i) => i.code === 'MALFORMED_JSON'));
  } finally { cleanup(malformed); }
});

test('adopt honors explicit config and rejects unknown options', () => {
  const dir = makeTempDir('adopt-cfg');
  try {
    writeJson(dir, 'custom/config.json', createConfig(dir, VALID_ANSWERS, {}));
    const report = prepareAdopt(dir, { config: 'custom/config.json' });
    assert.equal(report.configRel, 'custom/config.json');
    assert.equal(report.status, 'adoptable');
    assert.throws(() => prepareAdopt(dir, { bogus: 1 }),
      (e) => e.code === 'LIFECYCLE_INVALID_INPUT');
    assert.throws(() => prepareAdopt(dir, 'not-an-object'),
      (e) => e.code === 'LIFECYCLE_INVALID_INPUT');
  } finally { cleanup(dir); }
});

test('adopt journal states: malformed head and orphan history are attention', () => {
  const { dir, ctx } = configuredCtx();
  try {
    enroll(ctx);
    writeFile(dir, '.tasksystem/state/journal/head.json', '{corrupt');
    assert.equal(prepareAdopt(dir).journalState, 'attention');
    fs.rmSync(path.join(dir, '.tasksystem/state/journal/head.json'));
    writeJson(dir, '.tasksystem/state/journal/operations/x/intent.json', {});
    assert.equal(prepareAdopt(dir).journalState, 'attention');
  } finally { cleanup(dir); }
});

// ---------- update ----------

test('update preview classifies create/noop/conflict, writes nothing', () => {
  const { dir, ctx, installRoot } = bootstrappedMiniCtx();
  try {
    const before = snapshot(dir);
    const preview = prepareUpdate(ctx, { installRoot });
    assert.deepEqual(snapshot(dir), before); // read-only preview
    assert.equal(preview.mode, 'dry-run');
    assert.ok(preview.counts.noop > 0);
    assert.equal(preview.counts.create, 0);
    assert.equal(preview.counts.conflict, 0);

    fs.rmSync(path.join(dir, '.tasksystem/task-contract.md'));
    let p = prepareUpdate(ctx, { installRoot });
    assert.equal(p.files.find((f) => f.rel === '.tasksystem/task-contract.md')
      .action, 'create');
    assert.equal(p.counts.create, 1);

    writeFile(dir, '.tasksystem/task-contract.md', 'user edited');
    p = prepareUpdate(ctx, { installRoot });
    assert.equal(p.files.find((f) => f.rel === '.tasksystem/task-contract.md')
      .action, 'conflict');
    assert.ok(p.conflicts.some((c) => c.path === '.tasksystem/task-contract.md'));
  } finally { cleanup(dir); }
});

test('applyUpdate creates missing only, never overwrites foreign bytes', () => {
  const a = bootstrappedMiniCtx();
  const b = bootstrappedMiniCtx();
  try {
    fs.rmSync(path.join(a.dir, '.tasksystem/task-contract.md'));
    writeFile(a.dir, '.tasksystem/instructions.md', 'user edited');
    writeFile(a.dir, '.tasksystem/config.json', '{"tampered":true}');
    const res = applyUpdate(a.ctx, { installRoot: a.installRoot });
    assert.equal(res.mode, 'applied');
    assert.ok(res.files.includes('.tasksystem/task-contract.md'));
    // recreated bytes are exactly what a fresh init produced
    assert.ok(fs.readFileSync(path.join(a.dir, '.tasksystem/task-contract.md'))
      .equals(fs.readFileSync(path.join(b.dir, '.tasksystem/task-contract.md'))));
    // conflicting file untouched
    assert.ok(res.conflicts.some((c) => c.path === '.tasksystem/instructions.md'));
    assert.equal(fs.readFileSync(
      path.join(a.dir, '.tasksystem/instructions.md'), 'utf8'), 'user edited');
    // config never in the write set and its bytes are untouched
    assert.ok(!res.files.includes('.tasksystem/config.json'));
    assert.equal(fs.readFileSync(
      path.join(a.dir, '.tasksystem/config.json'), 'utf8'), '{"tampered":true}');
    // second apply is a clean noop (nothing left to create)
    const res2 = applyUpdate(a.ctx, { installRoot: a.installRoot });
    assert.equal(res2.created, 0);
  } finally { cleanup(a.dir); cleanup(b.dir); }
});

test('update rejects unknown options', () => {
  const { dir, ctx } = configuredCtx();
  try {
    assert.throws(() => prepareUpdate(ctx, { wat: 1 }),
      (e) => e.code === 'LIFECYCLE_INVALID_INPUT');
  } finally { cleanup(dir); }
});

// ---------- doctor lifecycle diagnostics ----------

test('doctor reports workspace enrollment and journal state read-only', () => {
  const { dir, ctx, installRoot } = bootstrappedMiniCtx();
  try {
    let report = runDoctor(ctx, { installRoot });
    let wsChecks = report.checks.filter((c) => c.name === 'workspace-enrollment');
    assert.ok(wsChecks.length > 0 && wsChecks.every((c) => c.ok));
    assert.ok(report.checks.some((c) => c.name === 'journal' && c.ok));

    enroll(ctx);
    report = runDoctor(ctx, { installRoot });
    assert.ok(report.checks.some((c) => c.name === 'workspace-enrollment'
      && c.ok && c.detail.includes('enrolled')));

    writeFile(dir, '.tasksystem/state/workspace.json', '{corrupt');
    report = runDoctor(ctx, { installRoot });
    assert.equal(report.status, 'needs-attention');
    assert.ok(report.warnings.some((w) => w.startsWith('workspace-enrollment')));

    writeJson(dir, '.tasksystem/state/journal/head.json', {
      schemaVersion: 1, lastSequence: 2,
      activeOperation: { operationId: OP_ID, intentDigest: DIGEST },
    });
    report = runDoctor(ctx, { installRoot });
    assert.equal(report.status, 'needs-attention');
    assert.ok(report.warnings.some((w) => w.startsWith('journal')));
  } finally { cleanup(dir); }
});
