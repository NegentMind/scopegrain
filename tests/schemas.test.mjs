// SPDX-License-Identifier: Apache-2.0
// Published contract surface: the JSON Schemas under schemas/ describe the
// persisted/derived shapes below, and real code output must satisfy them.
// No ajv dependency — a bounded draft-2020-12 subset checker covers exactly
// the keywords these schemas use and throws on anything else, so a schema
// edit that outgrows the subset fails loudly instead of passing vacuously.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { bindWorkspace, getWorkspace, prepareWorkspace }
  from '../src/core/workspaces.mjs';
import {
  applyJournaledCreation, applyJournaledRecordUpdate, getJournalOperation,
  recoverJournalOperation,
} from '../src/core/journal.mjs';
import { createTask } from '../src/core/tasks.mjs';
import {
  answerApproval, describeApprovalTarget, prepareApproval,
} from '../src/core/approvals.mjs';
import { validateMethodologyData } from '../src/core/methodology-data.mjs';
import { assessment } from './methodology-fixtures.mjs';
import { VALID_ANSWERS, bootstrappedCtx, cleanup, makeTempDir, readJson,
  writeJson } from './helpers.mjs';

const IGNORED_KEYWORDS = new Set([
  '$schema', '$id', '$defs', 'title', 'description',
]);
const SUPPORTED_KEYWORDS = new Set([
  'type', 'const', 'enum', 'required', 'properties', 'additionalProperties',
  'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems',
  'maxItems', 'uniqueItems', 'items', 'prefixItems', 'oneOf', 'anyOf', 'allOf',
  'if', 'then', 'else', '$ref', 'format',
  ...IGNORED_KEYWORDS,
]);

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null
      || typeof b !== 'object' || b === null
      || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

function isCanonicalTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function typeOk(type, value) {
  switch (type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number';
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: throw new Error(`unsupported type '${type}'`);
  }
}

// Draft-2020-12 subset evaluator: returns a list of human-readable
// violations; an empty list means conformance. Unsupported keywords throw.
function errorsFor(schema, value, defs, at = '$') {
  const errors = [];
  const fail = (message) => errors.push(`${at}: ${message}`);
  const nested = (sub, subValue, subAt) =>
    errors.push(...errorsFor(sub, subValue, defs, subAt));
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      throw new Error(`unsupported schema keyword '${key}' at ${at}`);
    }
  }
  if (schema.$ref !== undefined) {
    const name = schema.$ref.startsWith('#/$defs/')
      ? schema.$ref.slice('#/$defs/'.length) : null;
    if (name === null || !Object.hasOwn(defs, name)) {
      throw new Error(`unsupported $ref '${schema.$ref}' at ${at}`);
    }
    nested(defs[name], value, at);
  }
  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    fail(`must equal constant ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum !== undefined
      && !schema.enum.some((option) => deepEqual(option, value))) {
    fail(`must be one of ${JSON.stringify(schema.enum)}`);
  }
  if (schema.type !== undefined && !typeOk(schema.type, value)) {
    fail(`must be of type '${schema.type}'`);
    return errors; // keyword families below assume the type held
  }
  if (schema.format === 'date-time' && !isCanonicalTime(value)) {
    fail('must be a canonical ISO date-time');
  }
  if (typeof value === 'string') {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      fail(`must match pattern ${schema.pattern}`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      fail(`must have length >= ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      fail(`must have length <= ${schema.maxLength}`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      fail(`must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      fail(`must be <= ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail(`must have >= ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      fail(`must have <= ${schema.maxItems} items`);
    }
    if (schema.uniqueItems === true
        && new Set(value.map((item) => JSON.stringify(item))).size
          !== value.length) {
      fail('must have unique items');
    }
    const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
    prefix.forEach((sub, i) => {
      if (i < value.length) nested(sub, value[i], `${at}[${i}]`);
    });
    if (schema.items === false && value.length > prefix.length) {
      fail(`must have <= ${prefix.length} items`);
    } else if (schema.items !== undefined && schema.items !== false) {
      for (let i = prefix.length; i < value.length; i += 1) {
        nested(schema.items, value[i], `${at}[${i}]`);
      }
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) fail(`is missing required '${key}'`);
    }
    const properties = schema.properties ?? {};
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        nested(properties[key], item, `${at}.${key}`);
      } else if (schema.additionalProperties === false) {
        fail(`has unexpected property '${key}'`);
      }
    }
  }
  if (schema.allOf !== undefined) {
    schema.allOf.forEach((sub) => nested(sub, value, at));
  }
  if (schema.anyOf !== undefined
      && !schema.anyOf.some((sub) => errorsFor(sub, value, defs, at).length === 0)) {
    fail('must match at least one anyOf option');
  }
  if (schema.oneOf !== undefined
      && schema.oneOf.filter((sub) =>
        errorsFor(sub, value, defs, at).length === 0).length !== 1) {
    fail('must match exactly one oneOf option');
  }
  if (schema.if !== undefined) {
    const branch = errorsFor(schema.if, value, defs, at).length === 0
      ? schema.then : schema.else;
    if (branch !== undefined) nested(branch, value, at);
  }
  return errors;
}

function schema(name) {
  return JSON.parse(fs.readFileSync(
    new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8'));
}

function conform(name, value, label) {
  const doc = schema(name);
  const errors = errorsFor(doc, value, doc.$defs ?? {});
  assert.deepEqual(errors, [],
    `${label} must conform to schemas/${name}.schema.json:\n${errors.join('\n')}`);
}

function workspaceFixture() {
  const dir = makeTempDir('schemas');
  writeJson(dir, '.scopegrain/config.json', createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir, config: '.scopegrain/config.json' });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  return {
    dir, ctx, a, b,
    bound: bindWorkspace(ctx, { areaIds: [a, b] }),
    stateRel: ctx.config.paths.state,
  };
}

const sha256Hex = (bytes) =>
  crypto.createHash('sha256').update(bytes).digest('hex');

function journalRead(f, rel) {
  return JSON.parse(fs.readFileSync(
    path.join(f.dir, f.stateRel, 'journal', ...rel.split('/')), 'utf8'));
}

test('workspace descriptor conforms to workspace schema', () => {
  const f = workspaceFixture();
  try {
    const stored = readJson(f.dir, `${f.stateRel}/workspace.json`);
    conform('workspace', stored, 'persisted workspace.json');
    // The validated read path returns the same conforming record.
    conform('workspace', getWorkspace(f.ctx), 'getWorkspace() record');
  } finally { cleanup(f.dir); }
});

test('committed create operation conforms to intent and commit schemas', () => {
  const f = workspaceFixture();
  try {
    const result = applyJournaledCreation(f.bound, [
      { sourceKind: 'task', recordId: 'r-one', sourceRevision: 0,
        areaIds: [f.a], file: { rel: 'records/one', content: 'one' } },
      { sourceKind: 'task', recordId: 'r-two', sourceRevision: 0,
        areaIds: [f.b], file: { rel: 'records/two', content: 'two' } },
    ]);
    assert.equal(result.status, 'committed');
    const op = `operations/${result.operationId}`;
    conform('journal-intent', journalRead(f, `${op}/intent.json`),
      'persisted create intent.json');
    conform('journal-commit', journalRead(f, `${op}/commit.json`),
      'persisted commit.json');
  } finally { cleanup(f.dir); }
});

test('committed update operation conforms to intent schema', () => {
  const f = workspaceFixture();
  try {
    applyJournaledCreation(f.bound, [
      { sourceKind: 'task', recordId: 'r-one', sourceRevision: 0,
        areaIds: [f.a], file: { rel: 'records/one', content: 'one' } },
    ]);
    const result = applyJournaledRecordUpdate(f.bound, () => [{
      sourceKind: 'task', recordId: 'r-one', sourceRevision: 0,
      previousHash: sha256Hex('one'), areaIds: [f.a],
      file: { rel: 'records/one', content: 'one-v2' },
    }]);
    assert.equal(result.status, 'committed');
    const loaded = getJournalOperation(f.bound, result.operationId);
    assert.equal(loaded.intent.events[0].operation, 'update');
    conform('journal-intent', loaded.intent, 'update intent events');
    conform('journal-intent',
      journalRead(f, `operations/${result.operationId}/intent.json`),
      'persisted update intent.json');
  } finally { cleanup(f.dir); }
});

test('recovery receipts conform to recovery schema on both actions', () => {
  const f = workspaceFixture();
  try {
    // finalize-committed: receipt written against a clean committed op.
    const committed = applyJournaledCreation(f.bound, [
      { sourceKind: 'task', recordId: 'r-one', sourceRevision: 0,
        areaIds: [f.a], file: { rel: 'records/one', content: 'one' } },
    ]);
    const loaded = getJournalOperation(f.bound, committed.operationId);
    const finalized = recoverJournalOperation(f.bound, committed.operationId, {
      action: 'finalize-committed',
      expectedIntentDigest: loaded.intentDigest,
      reason: 'schema fixture reconciliation',
    });
    assert.equal(finalized.action, 'finalize-committed');
    conform('journal-recovery',
      journalRead(f, `operations/${committed.operationId}/recovery.json`),
      'finalize-committed recovery.json');
    // abandon-prepared: receipt written against a wedged unconfirmed op.
    const open = fs.openSync;
    let unconfirmed;
    try {
      fs.openSync = function (file, flags, ...args) {
        if (String(file).endsWith(`${path.sep}wedged`) && flags === 'wx') {
          const failure = new Error('schema fixture source failure');
          failure.code = 'EIO';
          throw failure;
        }
        return open.call(this, file, flags, ...args);
      };
      unconfirmed = applyJournaledCreation(f.bound, [
        { sourceKind: 'task', recordId: 'r-wedged', sourceRevision: 0,
          areaIds: [f.a], file: { rel: 'records/wedged', content: 'x' } },
      ]);
    } finally { fs.openSync = open; }
    assert.equal(unconfirmed.status, 'unconfirmed');
    const wedged = getJournalOperation(f.bound, unconfirmed.operationId);
    const abandoned = recoverJournalOperation(f.bound, unconfirmed.operationId, {
      action: 'abandon-prepared',
      expectedIntentDigest: wedged.intentDigest,
      reason: 'schema fixture abandonment',
    });
    assert.equal(abandoned.action, 'abandon-prepared');
    conform('journal-recovery',
      journalRead(f, `operations/${unconfirmed.operationId}/recovery.json`),
      'abandon-prepared recovery.json');
  } finally { cleanup(f.dir); }
});

test('pending, answered and revoked approvals conform to approval schema', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, { title: 'Schema task', contract: 'C',
      authorContext: 'fixture-author', scope: ['src/a'] });
    const { target } = describeApprovalTarget(ctx,
      { kind: 'task', id: task.id });
    const prepared = prepareApproval(ctx, { target });
    applyPlan(dir, [prepared.file]);
    const rel = prepared.file.rel;
    conform('approval', readJson(dir, rel), 'pending approval record');
    // approve (comment may be null on a first answer) then revoke (re-answer
    // requires a non-empty comment) exercises every history event branch.
    answerApproval(ctx, { id: prepared.approval.id, answer: 'approve',
      expectedRevision: 0, expectedTargetDigest: target.digest,
      actor: 'fixture-owner', comment: null });
    conform('approval', readJson(dir, rel), 'approved approval record');
    answerApproval(ctx, { id: prepared.approval.id, answer: 'revoke',
      expectedRevision: 1, expectedTargetDigest: target.digest,
      actor: 'fixture-owner', comment: 'fixture revocation reason' });
    conform('approval', readJson(dir, rel), 'revoked approval record');
    // A custom answer maps to needs-clarification with a comment. The
    // approval file is keyed by target digest, so this needs a second task.
    const task2 = createTask(ctx, { title: 'Second schema task', contract: 'C',
      authorContext: 'fixture-author', scope: ['src/b'] });
    const { target: target2 } = describeApprovalTarget(ctx,
      { kind: 'task', id: task2.id });
    const second = prepareApproval(ctx, { target: target2 });
    applyPlan(dir, [second.file]);
    answerApproval(ctx, { id: second.approval.id, answer: 'custom',
      expectedRevision: 0, expectedTargetDigest: target2.digest,
      actor: 'fixture-owner', comment: 'fixture clarification request' });
    conform('approval', readJson(dir, second.file.rel),
      'needs-clarification approval record');
  } finally { cleanup(dir); }
});

test('normalized organic assessments conform to assessment schema', () => {
  for (const [label, input] of [
    ['contained/authorized change', assessment()],
    ['named risk', assessment({ risk: 'named',
      riskCategories: ['security', 'delivery'] })],
    ['read-only intent', assessment({ intent: 'read-only' })],
    ['missing authorization', assessment({
      authorization: { status: 'missing', actor: null, reference: null } })],
    ['omitted preferredRoute normalizes to auto', (() => {
      const { preferredRoute, ...rest } = assessment();
      return rest;
    })()],
  ]) {
    const normalized = validateMethodologyData(input, 'schema fixture');
    conform('organic-assessment', normalized, `assessment (${label})`);
  }
  // The same shape is what a V2 task persists verbatim under methodology.
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, { title: 'Assessed task', contract: 'C',
      authorContext: 'fixture-author', scope: ['src/a'],
      methodology: assessment() });
    const stored = readJson(dir, `${ctx.config.paths.tasks}/${task.id.toLowerCase()}.json`);
    conform('organic-assessment', stored.methodology,
      'task.methodology persisted record');
  } finally { cleanup(dir); }
});

test('the checker and schemas reject records the runtime rejects', () => {
  // Negative probes pin the checker itself plus the drift fixes: each
  // record is valid against the OLD schema shape but invalid in reality.
  const intent = schema('journal-intent');
  const approval = schema('approval');
  const workspace = schema('workspace');
  const defs = (doc) => doc.$defs ?? {};
  const event = {
    schemaVersion: 1, eventId: crypto.randomUUID(),
    operationId: crypto.randomUUID(), journalSequence: 1,
    workspaceId: crypto.randomUUID(), projectId: crypto.randomUUID(),
    repositoryId: crypto.randomUUID(), areaIds: [crypto.randomUUID()],
    sourceKind: 'task', recordId: 'r-1', sourceRevision: 0,
    sourceRel: 'records/one', previousHash: null, sourceHash: sha256Hex('x'),
    snapshotRef: `s/journal/snapshots/${sha256Hex('x')}.blob`,
    operation: 'create', createdAt: new Date().toISOString(),
  };
  // A create event may not carry a previousHash; an update must carry one.
  assert.notEqual(errorsFor(intent.properties.events.items,
    { ...event, previousHash: sha256Hex('y') }, defs(intent)).length, 0);
  assert.notEqual(errorsFor(intent.properties.events.items,
    { ...event, operation: 'update' }, defs(intent)).length, 0);
  // Approval options are positional: approve first, reject second.
  const record = {
    schemaVersion: 1, id: sha256Hex('id'), revision: 0,
    target: { kind: 'task', id: crypto.randomUUID(), digest: sha256Hex('d') },
    status: 'pending', question: 'q', notice: 'n',
    scope: { paths: ['src/a'],
      effects: ['permit-next-harness-gate-for-bound-content'] },
    options: [
      { id: 'reject', label: 'R', description: 'd' },
      { id: 'approve', label: 'A', description: 'd' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    history: [{ at: '2026-01-01T00:00:00.000Z', event: 'created',
      revision: 0, status: 'pending', actor: null, answer: null,
      comment: null }],
  };
  assert.notEqual(errorsFor(approval, record, defs(approval)).length, 0);
  // history[0] is always the created/pending event.
  assert.notEqual(errorsFor(approval, {
    ...record, options: [...record.options].reverse(),
    history: [{ at: '2026-01-01T00:00:00.000Z', event: 'answered',
      revision: 0, status: 'approved', actor: 'a', answer: 'approve',
      comment: null }],
  }, defs(approval)).length, 0);
  // Workspace ids are lowercase UUIDs and the object is closed.
  const area = { id: crypto.randomUUID(), key: 'a', name: 'A' };
  const now = new Date().toISOString();
  assert.notEqual(errorsFor(workspace, {
    schemaVersion: 1, workspaceId: crypto.randomUUID().toUpperCase(),
    projectId: crypto.randomUUID(), repositoryId: crypto.randomUUID(),
    revision: 0, createdAt: now, updatedAt: now, areas: [area],
  }, defs(workspace)).length, 0);
});
