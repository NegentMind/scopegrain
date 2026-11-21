// SPDX-License-Identifier: Apache-2.0
// Internal JSON readers must reject non-roundtrippable UTF-8. The lossy
// toString('utf8') decode rewrote invalid sequences to U+FFFD before
// JSON.parse, so in-string corruption was silently accepted. Source stays
// ASCII; Unicode is test data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonFile } from '../src/core/fsx.mjs';
import * as fsx from '../src/core/fsx.mjs';

const { decodeUtf8Strict } = fsx;
import { applyPlan, buildInitPlan, preflightPlan }
  from '../src/core/bootstrap.mjs';
import { getArtifact, prepareArtifact } from '../src/core/artifacts.mjs';
import {
  describeApprovalTarget, getApproval, prepareApproval,
} from '../src/core/approvals.mjs';
import { createCaptureStore } from '../src/core/captures.mjs';
import {
  INSTALL_ROOT, legacyList, loadCatalog, loadLegacyInventory,
  validateProfile,
} from '../src/core/catalog.mjs';
import { proposeFromJournal } from '../src/core/capture-proposals.mjs';
import { createConfig, loadConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { canonicalDigest } from '../src/core/digests.mjs';
import { runDoctor } from '../src/core/doctor.mjs';
import {
  applyJournaledCreation, getJournalEvent, listJournalPending,
} from '../src/core/journal.mjs';
import { prepareAdopt, prepareRestore } from '../src/core/lifecycle.mjs';
import { getPlan, preparePlan } from '../src/core/plans.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import {
  getSession, prepareSession, sessionFileAbs,
} from '../src/core/sessions.mjs';
import { createTask, getTask, taskFilePath } from '../src/core/tasks.mjs';
import {
  bindWorkspace, getWorkspace, prepareWorkspace,
} from '../src/core/workspaces.mjs';
import { buildWorkflowPacket } from '../src/core/workflows.mjs';
import { run } from '../src/cli.mjs';
import { inspectProject } from '../src/discovery/inspect.mjs';
import { investigateProject } from '../src/discovery/semantic.mjs';
import { loadNativePolicy, renderNativeAdapters } from '../src/hosts/native.mjs';
import { createVantaDBProjector } from '../src/integrations/vantadb.mjs';
import { VALID_ANSWERS, cleanup, fakeIO, makeTempDir, writeFile, writeJson }
  from './helpers.mjs';

const MAXB = loadLimits().maxDocumentBytes;
const TOKEN = 'UTF8_INTERNAL_TOKEN';
const INVALID = [
  ['ff byte', [0xff]],
  ['lone continuation', [0x80]],
  ['truncated multibyte', [0xe2, 0x82]],
  ['overlong encoding', [0xc0, 0xaf]],
  ['UTF8-encoded surrogate', [0xed, 0xa0, 0x80]],
];

// Splices bytes INSIDE a JSON string (replacing TOKEN) so the lossy decode
// still produces syntactically valid JSON: acceptance proves the hole.
function corruptJson(value, bytes) {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8');
  const token = Buffer.from(TOKEN);
  const start = encoded.indexOf(token);
  assert.notEqual(start, -1);
  assert.equal(encoded.indexOf(token, start + token.length), -1);
  const result = Buffer.concat([encoded.subarray(0, start), Buffer.from(bytes),
    encoded.subarray(start + token.length)]);
  assert.ok(result.length < MAXB);
  assert.doesNotThrow(() => JSON.parse(result.toString('utf8')));
  return result;
}

for (const [label, bytes] of INVALID) {
  test(`readJsonFile rejects ${label} inside a string`, () => {
    const dir = makeTempDir('ij8-unit');
    try {
      const file = path.join(dir, 'doc.json');
      fs.writeFileSync(file,
        corruptJson({ value: `pre${TOKEN}post` }, bytes));
      assert.throws(() => readJsonFile(file, 'doc'),
        (e) => e.code === 'MALFORMED_JSON');
    } finally { cleanup(dir); }
  });
}

test('readJsonFile: literal U+FFFD, combining marks and emoji still parse', () => {
  const dir = makeTempDir('ij8-valid');
  try {
    const file = path.join(dir, 'ok.json');
    // Raw EF BF BD (valid literal U+FFFD), combining accent and emoji bytes
    // must survive: only NON-roundtrippable sequences are rejected.
    const encoded = Buffer.concat([
      Buffer.from('{"v":"'),
      Buffer.from([0xef, 0xbf, 0xbd]), // U+FFFD
      Buffer.from('e'),
      Buffer.from([0xcc, 0x81]),      // combining acute
      Buffer.from([0xf0, 0x9f, 0x9a, 0x80]), // emoji
      Buffer.from('"}'),
    ]);
    fs.writeFileSync(file, encoded);
    const parsed = readJsonFile(file, 'doc');
    assert.equal(parsed.v, '\ufffd' + 'e\u0301\uD83D\uDE80');
  } finally { cleanup(dir); }
});

test('readJsonFile: oversized invalid bytes prefer DOCUMENT_TOO_LARGE', () => {
  const dir = makeTempDir('ij8-oversize');
  try {
    const file = path.join(dir, 'big.json');
    fs.writeFileSync(file, Buffer.alloc(MAXB + 1, 0xff));
    assert.throws(() => readJsonFile(file, 'doc'),
      (e) => e.code === 'DOCUMENT_TOO_LARGE');
  } finally { cleanup(dir); }
});

test('decodeUtf8Strict honors the caller domain code and passes valid text', () => {
  assert.throws(() => decodeUtf8Strict(
    Buffer.from([0x66, 0x80, 0x67]), 'DOMAIN_MALFORMED', 'the label'),
  (e) => e.code === 'DOMAIN_MALFORMED' && e.message.includes('the label'));
  const ok = Buffer.from('{"a":"text \ufffd"}', 'utf8');
  assert.equal(decodeUtf8Strict(ok, 'X', 'l'), ok.toString('utf8'));
});

for (const [label, bytes] of INVALID) {
  test(`loadConfig rejects ${label} inside config.project.name`, () => {
    const dir = makeTempDir('ij8-config');
    try {
      const config = createConfig(dir,
        { ...VALID_ANSWERS, name: `p-${TOKEN}-q` }, {});
      writeFile(dir, '.scopegrain/config.json', corruptJson(config, bytes));
      assert.throws(() => loadConfig(dir),
        (e) => e.code === 'MALFORMED_JSON');
    } finally { cleanup(dir); }
  });
}

test('loadConfig still accepts a valid config with literal U+FFFD', () => {
  const dir = makeTempDir('ij8-config-ok');
  try {
    const config = createConfig(dir, VALID_ANSWERS, {});
    const encoded = Buffer.from(JSON.stringify(config, null, 2), 'utf8');
    const name = Buffer.from(VALID_ANSWERS.name);
    const start = encoded.indexOf(name);
    assert.notEqual(start, -1);
    const fffd = Buffer.concat([
      encoded.subarray(0, start + 2),
      Buffer.from([0xef, 0xbf, 0xbd]),
      encoded.subarray(start + 2),
    ]);
    fs.mkdirSync(path.join(dir, '.scopegrain'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.scopegrain', 'config.json'), fffd);
    const { config: loaded } = loadConfig(dir);
    assert.ok(loaded.project.name.includes('\ufffd'));
  } finally { cleanup(dir); }
});

// Bound workspace fixture: real config + enrolled workspace so journal and
// projector entry points reach their stored-file readers.
function boundFixture() {
  const dir = makeTempDir('ij8-bound');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  return { dir, ctx, a, b, bound: bindWorkspace(ctx, { areaIds: [a, b] }) };
}

// Splices bytes INSIDE a file at the TOKEN marker (the file was written
// with TOKEN embedded in a string field).
function corruptFile(abs, bytes) {
  const content = fs.readFileSync(abs);
  const token = Buffer.from(TOKEN);
  const start = content.indexOf(token);
  assert.notEqual(start, -1);
  assert.equal(content.indexOf(token, start + token.length), -1);
  const out = Buffer.concat([content.subarray(0, start), Buffer.from(bytes),
    content.subarray(start + token.length)]);
  fs.writeFileSync(abs, out);
  return out;
}

// --- journal.mjs: readJson (JOURNAL_MALFORMED) ---

// A committed operation plus a hand-written ack whose remoteNamespace (a
// free-form string) carries the corrupt byte: the lossy decode produced a
// fully valid ack, so acceptance was silent before the strict decode.
test('journal stored ack rejects non-roundtrippable UTF-8 (JOURNAL_MALFORMED)', () => {
  const f = boundFixture();
  try {
    const created = applyJournaledCreation(f.bound, [{
      sourceKind: 'task', recordId: 'rec-1', sourceRevision: 0,
      areaIds: [f.a], file: { rel: 'records/x', content: 'x' },
    }]);
    const eventId = created.eventIds[0];
    const { event } = getJournalEvent(f.bound, created.operationId, eventId);
    const ack = {
      schemaVersion: 1, operationId: created.operationId, eventId,
      evidence: {
        backendId: 'fixture-backend', remoteNamespace: `ns${TOKEN}ns`,
        remoteKey: eventId, eventDigest: canonicalDigest(event),
        sourceHash: event.sourceHash,
        confirmedAt: '2026-11-17T00:00:00.000Z',
      },
    };
    writeFile(f.dir,
      `.tasksystem/state/journal/operations/${created.operationId}/acks/${eventId}.json`,
      corruptJson(ack, [0xff]));
    assert.throws(() => listJournalPending(f.bound),
      (e) => e.code === 'JOURNAL_MALFORMED');
  } finally { cleanup(f.dir); }
});

test('journal stored ack accepts literal U+FFFD in free-form strings', () => {
  const f = boundFixture();
  try {
    const created = applyJournaledCreation(f.bound, [{
      sourceKind: 'task', recordId: 'rec-1', sourceRevision: 0,
      areaIds: [f.a], file: { rel: 'records/x', content: 'x' },
    }]);
    const eventId = created.eventIds[0];
    const { event } = getJournalEvent(f.bound, created.operationId, eventId);
    const ack = {
      schemaVersion: 1, operationId: created.operationId, eventId,
      evidence: {
        backendId: 'fixture-backend', remoteNamespace: 'ns\ufffdns',
        remoteKey: eventId, eventDigest: canonicalDigest(event),
        sourceHash: event.sourceHash,
        confirmedAt: '2026-11-17T00:00:00.000Z',
      },
    };
    writeFile(f.dir,
      `.tasksystem/state/journal/operations/${created.operationId}/acks/${eventId}.json`,
      JSON.stringify(ack));
    // The event is acknowledged, so it leaves the pending set without error.
    assert.deepEqual(listJournalPending(f.bound),
      { items: [], nextAfterSequence: null });
  } finally { cleanup(f.dir); }
});

// --- artifacts.mjs: getArtifact (ARTIFACT_MALFORMED) ---

test('getArtifact rejects non-roundtrippable UTF-8 (ARTIFACT_MALFORMED)', () => {
  const dir = makeTempDir('ij8-art');
  try {
    writeJson(dir, '.tasksystem/config.json',
      createConfig(dir, VALID_ANSWERS, {}));
    const ctx = resolveContext({ project: dir });
    const prepared = prepareArtifact(ctx, 'report',
      { title: `T${TOKEN}T`, body: 'B' });
    applyPlan(dir, [prepared.file]);
    corruptFile(path.join(dir, ...prepared.file.rel.split('/')), [0xff]);
    assert.throws(() => getArtifact(ctx, 'report', prepared.artifact.id),
      (e) => e.code === 'ARTIFACT_MALFORMED');
  } finally { cleanup(dir); }
});

test('getArtifact accepts literal U+FFFD in stored strings', () => {
  const dir = makeTempDir('ij8-artok');
  try {
    writeJson(dir, '.tasksystem/config.json',
      createConfig(dir, VALID_ANSWERS, {}));
    const ctx = resolveContext({ project: dir });
    const prepared = prepareArtifact(ctx, 'report',
      { title: 'T\ufffdT', body: 'B' });
    applyPlan(dir, [prepared.file]);
    const loaded = getArtifact(ctx, 'report', prepared.artifact.id);
    assert.equal(loaded.title, 'T\ufffdT');
  } finally { cleanup(dir); }
});

// --- catalog.mjs: validateProfile (PROFILE_MALFORMED) ---

test('validateProfile rejects non-roundtrippable UTF-8 (PROFILE_MALFORMED)', () => {
  const doc = {
    schemaVersion: 1, id: 'p1', description: `d${TOKEN}d`,
    skills: [], rules: [], references: [], activation: 'manual',
    externalServices: [],
  };
  assert.throws(() => validateProfile('p1', corruptJson(doc, [0xff])),
    (e) => e.code === 'PROFILE_MALFORMED');
  const ok = { ...doc, description: 'd\ufffdd' };
  assert.equal(
    validateProfile('p1', Buffer.from(JSON.stringify(ok))).id, 'p1');
  // The string input path (already decoded upstream) still works.
  assert.equal(validateProfile('p1', JSON.stringify(ok)).id, 'p1');
});

// --- catalog.mjs: loadCatalog manifest (CATALOG_MALFORMED) ---

test('loadCatalog manifest rejects non-roundtrippable UTF-8 (CATALOG_MALFORMED)', () => {
  const dir = makeTempDir('ij8-cat');
  try {
    const manifest = {
      schemaVersion: 1,
      entries: [{
        kind: 'command', id: 'c1', path: 'commands/c1.md',
        description: `d${TOKEN}d`, modes: ['default'],
      }],
    };
    writeFile(dir, 'catalog/manifest.json', corruptJson(manifest, [0x80]));
    writeFile(dir, 'commands/c1.md', 'body');
    assert.throws(() => loadCatalog({ installRoot: dir }),
      (e) => e.code === 'CATALOG_MALFORMED');
  } finally { cleanup(dir); }
});

test('loadCatalog accepts literal U+FFFD in manifest strings', () => {
  const dir = makeTempDir('ij8-catok');
  try {
    const manifest = {
      schemaVersion: 1,
      entries: [{
        kind: 'command', id: 'c1', path: 'commands/c1.md',
        description: 'd\ufffdd', modes: ['default'],
      }],
    };
    writeFile(dir, 'catalog/manifest.json', JSON.stringify(manifest));
    writeFile(dir, 'commands/c1.md', 'body');
    const catalog = loadCatalog({ installRoot: dir });
    assert.equal(catalog.entries[0].description, 'd\ufffdd');
  } finally { cleanup(dir); }
});

// --- catalog.mjs: provenance readers (LEGACY_MALFORMED) ---

test('loadLegacyInventory rejects non-roundtrippable UTF-8 (LEGACY_MALFORMED)', () => {
  const dir = makeTempDir('ij8-legacy');
  try {
    writeFile(dir, 'provenance/legacy-inventory.json', corruptJson({
      schemaVersion: 1, claim: `c${TOKEN}c`,
      entries: [{ kind: 'skill', id: 's1' }],
    }, [0xff]));
    assert.throws(() => loadLegacyInventory({ installRoot: dir }),
      (e) => e.code === 'LEGACY_MALFORMED');
  } finally { cleanup(dir); }
});

test('legacy classification rejects non-roundtrippable UTF-8 (LEGACY_MALFORMED)', () => {
  const dir = makeTempDir('ij8-cls');
  try {
    writeFile(dir, 'provenance/legacy-inventory.json',
      JSON.stringify({ schemaVersion: 1,
        entries: [{ kind: 'skill', id: 's1' }] }));
    writeFile(dir, 'provenance/legacy-classification.json', corruptJson({
      entries: [{ id: 's1', category: `c${TOKEN}c` }],
    }, [0xff]));
    assert.throws(() => legacyList({}, { installRoot: dir }),
      (e) => e.code === 'LEGACY_MALFORMED');
  } finally { cleanup(dir); }
});

// --- policy.mjs: loadPolicyFile (POLICY_MALFORMED) ---

// loadPolicyFile reads from a policy/ directory - the loadLimits({policyDir})
// seam redirects it to a temp copy so tests never mutate the real
// installation file (parallel test files race on the shared bytes).
const REAL_LIMITS = fileURLToPath(
  new URL('../policy/operation-limits.json', import.meta.url));

function limitsFixture() {
  const dir = makeTempDir('ij8-limits');
  const policyDir = path.join(dir, 'policy');
  fs.mkdirSync(policyDir, { recursive: true });
  const doc = JSON.parse(fs.readFileSync(REAL_LIMITS, 'utf8'));
  return { dir, policyDir, doc };
}

test('loadPolicyFile rejects non-roundtrippable UTF-8 (POLICY_MALFORMED)', () => {
  const { dir, policyDir, doc } = limitsFixture();
  doc.note = `x${TOKEN}x`;
  try {
    fs.writeFileSync(path.join(policyDir, 'operation-limits.json'),
      corruptJson(doc, [0xff]));
    assert.throws(() => loadLimits({ policyDir }),
      (e) => e.code === 'POLICY_MALFORMED');
  } finally { cleanup(dir); }
});

test('loadPolicyFile accepts literal U+FFFD in stored strings', () => {
  const { dir, policyDir, doc } = limitsFixture();
  doc.note = 'x�x';
  try {
    fs.writeFileSync(path.join(policyDir, 'operation-limits.json'),
      JSON.stringify(doc));
    assert.equal(loadLimits({ policyDir }).note, 'x�x');
  } finally { cleanup(dir); }
});

// --- doctor.mjs: stored-record readers (MALFORMED_JSON / JOURNAL_MALFORMED) ---

function doctorFixture() {
  const dir = makeTempDir('ij8-doctor');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  return { dir, ctx: resolveContext({ project: dir }) };
}

test('doctor flags non-roundtrippable UTF-8 in stored project records', () => {
  const { dir, ctx } = doctorFixture();
  try {
    // discovery.json: corrupt byte inside a field doctor does not validate,
    // so the lossy decode previously passed the fingerprint check.
    writeFile(dir, '.tasksystem/discovery.json', corruptJson({
      schemaVersion: 1, fingerprint: ctx.config.discovery.fingerprint,
      note: `n${TOKEN}n`,
    }, [0xff]));
    // workspace enrollment: real enrolled workspace, corrupt byte inside an
    // area name (free-form non-empty string).
    const prepared = prepareWorkspace(ctx, {
      areas: [{ key: 'alpha', name: `A${TOKEN}A` }],
    });
    applyPlan(dir, [prepared.file]);
    corruptFile(path.join(
      dir, '.tasksystem', 'state', 'workspace.json'), [0x80]);
    // journal head: corrupt byte inside an ignored field.
    writeFile(dir, '.tasksystem/state/journal/head.json', corruptJson({
      schemaVersion: 1, lastSequence: 0, activeOperation: null,
      note: `n${TOKEN}n`,
    }, [0xff]));
    const report = runDoctor(ctx);
    const check = (name) => report.checks.find((c) => c.name === name);
    assert.equal(check('discovery').ok, false);
    assert.match(check('discovery').detail, /malformed JSON/);
    assert.equal(check('workspace-enrollment').ok, false);
    assert.match(check('workspace-enrollment').detail, /MALFORMED_JSON/);
    assert.equal(check('journal').ok, false);
    assert.match(check('journal').detail, /UTF-8/);
  } finally { cleanup(dir); }
});

test('doctor accepts literal U+FFFD in stored project records', () => {
  const { dir, ctx } = doctorFixture();
  try {
    writeFile(dir, '.tasksystem/discovery.json', JSON.stringify({
      schemaVersion: 1, fingerprint: ctx.config.discovery.fingerprint,
      note: 'n\ufffdn',
    }));
    const prepared = prepareWorkspace(ctx, {
      areas: [{ key: 'alpha', name: 'A\ufffdA' }],
    });
    applyPlan(dir, [prepared.file]);
    writeFile(dir, '.tasksystem/state/journal/head.json', JSON.stringify({
      schemaVersion: 1, lastSequence: 0, activeOperation: null,
      note: 'n\ufffdn',
    }));
    const report = runDoctor(ctx);
    const check = (name) => report.checks.find((c) => c.name === name);
    assert.equal(check('discovery').ok, true);
    assert.equal(check('workspace-enrollment').ok, true);
    assert.equal(check('journal').ok, true);
  } finally { cleanup(dir); }
});

// --- native.mjs: adapter policy readers (POLICY_MALFORMED) and templates ---

const MIN_NATIVE_POLICY = {
  schemaVersion: 1, namespace: 'ts-', activation: 'manual-review-only',
  writeHostRoots: false, installHooks: false, installPlugins: false,
  readOnlyAgentIds: ['a1'],
  hosts: {
    claude: {
      skillRoot: '.claude/skills', commandFormat: 'skill',
      agentRoot: '.claude/agents', agentFormat: 'markdown',
      invocation: '/ts', permissionScope: 'scope',
      sources: ['https://example.com/docs'],
    },
  },
};

const MIN_VARIANT_ENTRY = {
  id: 'v1', surfaces: ['cli'], selectionRequired: false,
  emitAgents: true, agentFrontmatter: '', readOnlyAgentFrontmatter: '',
  compatibility: 'documented-only', modelSelection: 'host-policy',
  permissionScope: 'scope', sources: ['https://example.com/v'],
};

const MIN_VARIANTS = {
  schemaVersion: 1,
  hosts: {
    opencode: [{ ...MIN_VARIANT_ENTRY }],
    antigravity: [{ ...MIN_VARIANT_ENTRY, surfaces: ['app'] }],
  },
};

const NATIVE_STUB_CATALOG = {
  entries: [
    { kind: 'agent', id: 'a1', path: 'agents/a1.md', description: 'd' },
    { kind: 'skill', id: 's1', path: 'skills/s1/SKILL.md', description: 'd' },
  ],
  aliases: [],
};

function nativeAdapterFixture(dir) {
  writeFile(dir, 'policy/native-adapters.json',
    JSON.stringify(MIN_NATIVE_POLICY));
  writeFile(dir, 'templates/hosts/native-agent.md', 'agent {{kind}}');
  writeFile(dir, 'templates/hosts/native-resource.md', 'res {{kind}}');
}

test('loadNativePolicy rejects non-roundtrippable UTF-8 (POLICY_MALFORMED)', () => {
  const dir = makeTempDir('ij8-npol');
  try {
    const real = JSON.parse(fs.readFileSync(
      path.join(INSTALL_ROOT, 'policy', 'native-adapters.json')));
    const host = Object.keys(real.hosts)[0];
    real.hosts[host].permissionScope = `s${TOKEN}s`;
    writeFile(dir, 'policy/native-adapters.json', corruptJson(real, [0xff]));
    assert.throws(() => loadNativePolicy({ installRoot: dir }),
      (e) => e.code === 'POLICY_MALFORMED');
  } finally { cleanup(dir); }
});

test('loadNativePolicy accepts literal U+FFFD in policy strings', () => {
  const dir = makeTempDir('ij8-npolok');
  try {
    const real = JSON.parse(fs.readFileSync(
      path.join(INSTALL_ROOT, 'policy', 'native-adapters.json')));
    const host = Object.keys(real.hosts)[0];
    real.hosts[host].permissionScope = 's\ufffds';
    writeFile(dir, 'policy/native-adapters.json', JSON.stringify(real));
    assert.equal(loadNativePolicy({ installRoot: dir }).schemaVersion, 1);
  } finally { cleanup(dir); }
});

test('native variants file rejects non-roundtrippable UTF-8 (POLICY_MALFORMED)', () => {
  const dir = makeTempDir('ij8-nvar');
  try {
    nativeAdapterFixture(dir);
    const variants = JSON.parse(JSON.stringify(MIN_VARIANTS));
    variants.hosts.opencode[0].permissionScope = `s${TOKEN}s`;
    writeFile(dir, 'policy/native-variants.json',
      corruptJson(variants, [0xff]));
    assert.throws(() => renderNativeAdapters({ hosts: ['hermes'] },
      {
        configRel: '.tasksystem/config.json', installRoot: dir,
        catalog: NATIVE_STUB_CATALOG,
      }),
    (e) => e.code === 'POLICY_MALFORMED');
  } finally { cleanup(dir); }
});

test('native template decode rejects non-roundtrippable UTF-8 (TEMPLATE_MALFORMED)', () => {
  const dir = makeTempDir('ij8-tpl');
  try {
    nativeAdapterFixture(dir);
    writeFile(dir, 'policy/native-variants.json', JSON.stringify(MIN_VARIANTS));
    writeFile(dir, 'templates/hosts/native-resource.md',
      Buffer.concat([Buffer.from('res '), Buffer.from([0xff])]));
    assert.throws(() => renderNativeAdapters({ hosts: ['claude'] },
      {
        configRel: '.tasksystem/config.json', installRoot: dir,
        catalog: NATIVE_STUB_CATALOG,
      }),
    (e) => e.code === 'TEMPLATE_MALFORMED');
  } finally { cleanup(dir); }
});

test('native adapters still render with literal U+FFFD template bytes', () => {
  const dir = makeTempDir('ij8-tplok');
  try {
    nativeAdapterFixture(dir);
    writeFile(dir, 'policy/native-variants.json', JSON.stringify(MIN_VARIANTS));
    writeFile(dir, 'templates/hosts/native-resource.md',
      Buffer.concat([Buffer.from('res '), Buffer.from([0xef, 0xbf, 0xbd])]));
    const out = renderNativeAdapters({ hosts: ['claude'] },
      {
        configRel: '.tasksystem/config.json', installRoot: dir,
        catalog: NATIVE_STUB_CATALOG,
      });
    assert.ok(out.files.length > 0);
  } finally { cleanup(dir); }
});

// --- inspect.mjs: manifest readers (MANIFEST_MALFORMED / MALFORMED_JSON) ---

test('inspect flags non-roundtrippable UTF-8 in package.json', () => {
  const dir = makeTempDir('ij8-insp');
  try {
    writeFile(dir, 'package.json', corruptJson(
      { name: `p${TOKEN}p`, scripts: { test: 't' } }, [0xff]));
    const result = inspectProject(dir);
    assert.ok(result.warnings.some(
      (w) => w.code === 'MANIFEST_MALFORMED' && w.path === 'package.json'));
    assert.equal(
      result.evidence.find((e) => e.path === 'package.json').read, false);
    assert.equal(result.commands.length, 0);
  } finally { cleanup(dir); }
});

test('inspect flags non-roundtrippable UTF-8 in non-JSON manifests', () => {
  const dir = makeTempDir('ij8-insp2');
  try {
    writeFile(dir, 'Cargo.toml', Buffer.concat([
      Buffer.from('[package]\nname = "x'), Buffer.from([0xff]),
      Buffer.from('"\n')]));
    const result = inspectProject(dir);
    assert.ok(result.warnings.some(
      (w) => w.code === 'MANIFEST_MALFORMED' && w.path === 'Cargo.toml'));
    assert.equal(
      result.evidence.find((e) => e.path === 'Cargo.toml').read, false);
  } finally { cleanup(dir); }
});

test('inspect accepts literal U+FFFD in manifest text', () => {
  const dir = makeTempDir('ij8-inspok');
  try {
    writeFile(dir, 'Cargo.toml', Buffer.concat([
      Buffer.from('[package]\nname = "x'), Buffer.from([0xef, 0xbf, 0xbd]),
      Buffer.from('"\n')]));
    const result = inspectProject(dir);
    assert.ok(!result.warnings.some((w) => w.code === 'MANIFEST_MALFORMED'));
    assert.equal(
      result.evidence.find((e) => e.path === 'Cargo.toml').read, true);
  } finally { cleanup(dir); }
});

// --- vantadb.mjs: readPolicy (POLICY_MALFORMED) ---

// The projection policy path is fixed to the installation; byte-exact
// backup + restore is the only seam.
const PROJECTION_PATH = fileURLToPath(
  new URL('../policy/vantadb-projection.json', import.meta.url));

test('vantadb projection policy rejects non-roundtrippable UTF-8 (POLICY_MALFORMED)', () => {
  const f = boundFixture();
  const original = fs.readFileSync(PROJECTION_PATH);
  try {
    fs.writeFileSync(PROJECTION_PATH, Buffer.concat([
      original.subarray(0, 4), Buffer.from([0xff]), original.subarray(4)]));
    assert.throws(() => createVantaDBProjector(f.bound, {
      backendId: 'fixture-backend',
      invoke: async () => { throw new Error('unreachable'); },
    }), (e) => e.code === 'POLICY_MALFORMED');
  } finally {
    fs.writeFileSync(PROJECTION_PATH, original);
    cleanup(f.dir);
  }
});

// === Wave-3 readers =========================================================
// Stored-record readers (workspaces/tasks/plans/sessions/approvals),
// lifecycle probes, bootstrap templates, semantic manifest re-reads, the
// capture-note snapshot decode, and catalog-resource serve-time decodes
// (workflows/cli/mcp). Owned-store readers keep their own strict helpers
// and are covered by the owned-* suites.

function recordFixture() {
  const dir = makeTempDir('ij8-rec');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  return { dir, ctx: resolveContext({ project: dir }) };
}

// --- workspaces.mjs: readWorkspace (MALFORMED_JSON) ---

test('stored workspace rejects non-roundtrippable UTF-8 (MALFORMED_JSON)', () => {
  const { dir, ctx } = recordFixture();
  try {
    const prepared = prepareWorkspace(ctx, {
      areas: [{ key: 'alpha', name: `A${TOKEN}A` }],
    });
    applyPlan(dir, [prepared.file]);
    corruptFile(path.join(
      dir, '.tasksystem', 'state', 'workspace.json'), [0xff]);
    assert.throws(() => getWorkspace(ctx),
      (e) => e.code === 'MALFORMED_JSON');
  } finally { cleanup(dir); }
});

test('stored workspace accepts literal U+FFFD in area names', () => {
  const { dir, ctx } = recordFixture();
  try {
    const prepared = prepareWorkspace(ctx, {
      areas: [{ key: 'alpha', name: 'A\ufffdA' }],
    });
    applyPlan(dir, [prepared.file]);
    assert.equal(getWorkspace(ctx).areas[0].name, 'A\ufffdA');
  } finally { cleanup(dir); }
});

// --- tasks.mjs: readTaskFile (TASK_MALFORMED) ---

test('stored task rejects non-roundtrippable UTF-8 (TASK_MALFORMED)', () => {
  const { dir, ctx } = recordFixture();
  try {
    const task = createTask(ctx, {
      title: `T${TOKEN}T`, contract: 'C', authorContext: 'a', scope: [],
    });
    corruptFile(taskFilePath(ctx, task.id), [0x80]);
    assert.throws(() => getTask(ctx, task.id),
      (e) => e.code === 'TASK_MALFORMED');
  } finally { cleanup(dir); }
});

test('stored task accepts literal U+FFFD in title', () => {
  const { dir, ctx } = recordFixture();
  try {
    const task = createTask(ctx, {
      title: 'T\ufffdT', contract: 'C', authorContext: 'a', scope: [],
    });
    assert.equal(getTask(ctx, task.id).title, 'T\ufffdT');
  } finally { cleanup(dir); }
});

// --- plans.mjs: getPlan (PLAN_MALFORMED) ---

test('stored plan rejects non-roundtrippable UTF-8 (PLAN_MALFORMED)', () => {
  const { dir, ctx } = recordFixture();
  try {
    const prepared = preparePlan(ctx, {
      key: 'rel-1', title: `R${TOKEN}R`, authorContext: 'a',
      tasks: [{ key: 'base', title: 'Base', contract: 'c', scope: [],
        dependsOn: [] }],
    });
    applyPlan(dir, prepared.files);
    corruptFile(path.join(
      dir, 'docs', 'agent', 'plans', 'rel-1.json'), [0xff]);
    assert.throws(() => getPlan(ctx, 'rel-1'),
      (e) => e.code === 'PLAN_MALFORMED');
  } finally { cleanup(dir); }
});

test('stored plan accepts literal U+FFFD in title', () => {
  const { dir, ctx } = recordFixture();
  try {
    const prepared = preparePlan(ctx, {
      key: 'rel-1', title: 'R\ufffdR', authorContext: 'a',
      tasks: [{ key: 'base', title: 'Base', contract: 'c', scope: [],
        dependsOn: [] }],
    });
    applyPlan(dir, prepared.files);
    assert.equal(getPlan(ctx, 'rel-1').title, 'R\ufffdR');
  } finally { cleanup(dir); }
});

// --- sessions.mjs: readSessionFile (SESSION_MALFORMED) ---

test('stored session rejects non-roundtrippable UTF-8 (SESSION_MALFORMED)', () => {
  const { dir, ctx } = recordFixture();
  try {
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const prepared = prepareSession(ctx, { taskId: task.id, limit: 3 });
    applyPlan(dir, preflightPlan(dir, [prepared.file]));
    const abs = sessionFileAbs(ctx, prepared.session.id);
    // Sessions carry no free-form string field; splicing the token inside
    // the stored taskId keeps the lossy decode a valid JSON document, so
    // fail-closed is proven before shape validation ever runs.
    const stored = JSON.parse(fs.readFileSync(abs, 'utf8'));
    stored.taskId = `${stored.taskId}${TOKEN}`;
    fs.writeFileSync(abs, corruptJson(stored, [0xff]));
    assert.throws(() => getSession(ctx, prepared.session.id),
      (e) => e.code === 'SESSION_MALFORMED');
  } finally { cleanup(dir); }
});

// --- approvals.mjs: getApproval + prompts() loader (APPROVAL_MALFORMED) ---

function approvalFixture() {
  const { dir, ctx } = recordFixture();
  const task = createTask(ctx, {
    title: 'T', contract: 'C', authorContext: 'a', scope: [],
  });
  const { target } = describeApprovalTarget(
    ctx, { kind: 'task', id: task.id });
  const prepared = prepareApproval(ctx, { target });
  applyPlan(dir, [prepared.file]);
  return { dir, ctx, approval: prepared.approval };
}

test('stored approval rejects non-roundtrippable UTF-8 (APPROVAL_MALFORMED)', () => {
  const { dir, ctx, approval } = approvalFixture();
  try {
    const rel = `${ctx.config.paths.decisions}/approvals/${approval.id}.json`;
    const doc = JSON.parse(fs.readFileSync(
      path.join(dir, ...rel.split('/')), 'utf8'));
    doc.notice = `n${TOKEN}n`; // non-empty free-form stored string
    writeFile(dir, rel, corruptJson(doc, [0xff]));
    assert.throws(() => getApproval(ctx, approval.id),
      (e) => e.code === 'APPROVAL_MALFORMED');
  } finally { cleanup(dir); }
});

test('stored approval accepts literal U+FFFD in notice', () => {
  const { dir, ctx, approval } = approvalFixture();
  try {
    const rel = `${ctx.config.paths.decisions}/approvals/${approval.id}.json`;
    const doc = JSON.parse(fs.readFileSync(
      path.join(dir, ...rel.split('/')), 'utf8'));
    doc.notice = 'n\ufffdn';
    writeFile(dir, rel, JSON.stringify(doc));
    assert.equal(getApproval(ctx, approval.id).notice, 'n\ufffdn');
  } finally { cleanup(dir); }
});

// The prompts template path is fixed to the installation and the parsed
// document is cached at module level: a query-string import gives a fresh
// module (empty cache) while byte-exact backup/restore covers the file.
const PROMPTS_PATH = fileURLToPath(
  new URL('../templates/approval-prompts.json', import.meta.url));

test('approval prompts template rejects non-roundtrippable UTF-8 (APPROVAL_MALFORMED)', async () => {
  const mod = await import('../src/core/approvals.mjs?ij8-prompts-corrupt');
  const original = fs.readFileSync(PROMPTS_PATH);
  const doc = JSON.parse(original.toString('utf8'));
  doc.es.notice = `n${TOKEN}n`;
  try {
    fs.writeFileSync(PROMPTS_PATH, corruptJson(doc, [0xff]));
    const { dir, ctx } = recordFixture();
    try {
      const task = createTask(ctx, {
        title: 'T', contract: 'C', authorContext: 'a', scope: [],
      });
      const { target } = mod.describeApprovalTarget(
        ctx, { kind: 'task', id: task.id });
      assert.throws(() => mod.prepareApproval(ctx, { target }),
        (e) => e.code === 'APPROVAL_MALFORMED');
    } finally { cleanup(dir); }
  } finally {
    fs.writeFileSync(PROMPTS_PATH, original);
  }
});

test('approval prompts template accepts literal U+FFFD', async () => {
  const mod = await import('../src/core/approvals.mjs?ij8-prompts-ok');
  const original = fs.readFileSync(PROMPTS_PATH);
  const doc = JSON.parse(original.toString('utf8'));
  doc.es.notice = 'n\ufffdn';
  try {
    fs.writeFileSync(PROMPTS_PATH, JSON.stringify(doc));
    const { dir, ctx } = recordFixture();
    try {
      const task = createTask(ctx, {
        title: 'T', contract: 'C', authorContext: 'a', scope: [],
      });
      const { target } = mod.describeApprovalTarget(
        ctx, { kind: 'task', id: task.id });
      const prepared = mod.prepareApproval(ctx, { target });
      assert.equal(prepared.approval.notice, 'n\ufffdn');
    } finally { cleanup(dir); }
  } finally {
    fs.writeFileSync(PROMPTS_PATH, original);
  }
});

// --- lifecycle.mjs: adopt probes + restore manifest ---

test('adopt flags non-roundtrippable UTF-8 in workspace and journal head', () => {
  const { dir, ctx } = recordFixture();
  try {
    const prepared = prepareWorkspace(ctx, {
      areas: [{ key: 'alpha', name: `A${TOKEN}A` }],
    });
    applyPlan(dir, [prepared.file]);
    corruptFile(path.join(
      dir, '.tasksystem', 'state', 'workspace.json'), [0xff]);
    writeFile(dir, '.tasksystem/state/journal/head.json', corruptJson({
      schemaVersion: 1, lastSequence: 0, activeOperation: null,
      note: `n${TOKEN}n`,
    }, [0x80]));
    const report = prepareAdopt(dir);
    assert.equal(report.journalState, 'attention');
    assert.ok(report.issues.some((i) => i.code === 'MALFORMED_JSON'
      && /roundtrippable UTF-8/.test(i.message)));
    assert.ok(report.issues.some((i) => i.code === 'JOURNAL_MALFORMED'));
  } finally { cleanup(dir); }
});

test('backup bundle manifest rejects non-roundtrippable UTF-8 (RESTORE_MANIFEST_MALFORMED)', () => {
  const dir = makeTempDir('ij8-restore');
  try {
    writeFile(dir, 'backups/b1/manifest.json', corruptJson({
      schemaVersion: 1, kind: 'scopegrain-backup',
      createdAt: '2026-11-17T00:00:00.000Z', source: `s${TOKEN}s`,
      entries: [],
    }, [0xff]));
    assert.throws(() => prepareRestore(dir, 'backups/b1'),
      (e) => e.code === 'RESTORE_MANIFEST_MALFORMED');
  } finally { cleanup(dir); }
});

// --- bootstrap.mjs: readTemplate (TEMPLATE_MALFORMED) ---

test('init template rejects non-roundtrippable UTF-8 (TEMPLATE_MALFORMED)', () => {
  const dir = makeTempDir('ij8-tplinit');
  const templatesDir = makeTempDir('ij8-tpldir');
  try {
    writeFile(templatesDir, 'project-instructions.md', Buffer.concat([
      Buffer.from('instructions '), Buffer.from([0xff])]));
    assert.throws(() => buildInitPlan({
      projectRoot: dir, configRel: '.tasksystem/config.json',
      config: createConfig(dir, VALID_ANSWERS, {}), discovery: null,
      templatesDir,
    }), (e) => e.code === 'TEMPLATE_MALFORMED');
  } finally { cleanup(dir); cleanup(templatesDir); }
});

// --- discovery/semantic.mjs: rereadManifest (MANIFEST_MALFORMED warning) ---

test('investigate warns on non-roundtrippable UTF-8 in probed manifests', () => {
  const dir = makeTempDir('ij8-sem');
  try {
    // pubspec.yaml is a semantic-only probe (inspect never reads it), so
    // rereadManifest is the sole decoder of these bytes.
    writeFile(dir, 'pubspec.yaml', Buffer.concat([
      Buffer.from('name: x'), Buffer.from([0xff]), Buffer.from('\n')]));
    const inv = investigateProject(dir);
    assert.ok(inv.warnings.some((w) => w.code === 'MANIFEST_MALFORMED'
      && w.path === 'pubspec.yaml'));
  } finally { cleanup(dir); }
});

test('investigate accepts literal U+FFFD in probed manifests', () => {
  const dir = makeTempDir('ij8-semok');
  try {
    writeFile(dir, 'pubspec.yaml', Buffer.concat([
      Buffer.from('name: x'), Buffer.from([0xef, 0xbf, 0xbd]),
      Buffer.from('\n')]));
    const inv = investigateProject(dir);
    assert.ok(!inv.warnings.some((w) => w.code === 'MANIFEST_MALFORMED'));
  } finally { cleanup(dir); }
});

// --- capture-proposals.mjs: captureNote degrade path ---

test('corrupt capture note snapshot degrades to the generic event proposal', () => {
  const f = boundFixture();
  try {
    // Hash-verified snapshot bytes with non-roundtrippable UTF-8: the note
    // can never silently enrich the statement, so the documented generic
    // event text is the fail-closed outcome.
    applyJournaledCreation(f.bound, [{
      sourceKind: 'capture', recordId: 'cap-1', sourceRevision: 0,
      areaIds: [f.a],
      file: { rel: 'records/cap-1.json', content: Buffer.concat([
        Buffer.from('{"title":"n'), Buffer.from([0xff]),
        Buffer.from('"}')]) },
    }]);
    const proposals = proposeFromJournal(f.bound);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].statement.title, 'capture record created');
    assert.equal(proposals[0].provenance.sourceKind, 'capture');
  } finally { cleanup(f.dir); }
});

test('literal U+FFFD capture note still enriches the event proposal', () => {
  const f = boundFixture();
  try {
    // A real store write puts valid literal U+FFFD bytes in the verified
    // snapshot: the note decodes and enriches the statement.
    const store = createCaptureStore(
      f.ctx, { areaIds: [f.a, f.b], origin: 'local-cli' });
    store.create({ category: 'decision', title: 'T\ufffdT',
      summary: 'S', areaIds: [f.a, f.b] });
    const proposals = proposeFromJournal(f.bound);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].statement.title, 'capture note recorded');
    assert.ok(proposals[0].statement.text.includes('T\ufffdT'));
  } finally { cleanup(f.dir); }
});

// --- catalog-resource serve-time decodes: workflows/cli/server ---
// V1 snapshots are legacy-unpinned (no sha256), so corrupt resource bytes
// survive load-time verification and reach the serve-time decoders.

function v1SnapshotFixture() {
  const { dir, ctx } = recordFixture();
  writeJson(dir, '.tasksystem/catalog.json', {
    schemaVersion: 1,
    entries: [
      { kind: 'command', id: 'c1', path: 'commands/c1.md',
        description: 'd', modes: ['default'], skills: ['s1'] },
      { kind: 'skill', id: 's1', path: 'skills/s1/SKILL.md',
        description: 'd' },
      { kind: 'profile', id: 'core', path: 'profiles/core.json',
        description: 'd' },
    ],
    aliases: [],
  });
  writeJson(dir, '.tasksystem/profiles/core.json', {
    schemaVersion: 1, id: 'core', description: 'd',
    skills: [], rules: [], references: [],
    activation: 'manual', externalServices: [],
  });
  writeFile(dir, '.tasksystem/commands/c1.md', 'command body');
  writeFile(dir, '.tasksystem/skills/s1/SKILL.md', 'skill body');
  return { dir, ctx };
}

test('workflow packet rejects non-roundtrippable command bytes (CATALOG_MALFORMED)', () => {
  const { dir, ctx } = v1SnapshotFixture();
  try {
    writeFile(dir, '.tasksystem/commands/c1.md',
      Buffer.concat([Buffer.from('body '), Buffer.from([0xff])]));
    assert.throws(() => buildWorkflowPacket(ctx, { command: 'c1' }),
      (e) => e.code === 'CATALOG_MALFORMED');
  } finally { cleanup(dir); }
});

test('workflow packet rejects non-roundtrippable dependency bytes (CATALOG_MALFORMED)', () => {
  const { dir, ctx } = v1SnapshotFixture();
  try {
    writeFile(dir, '.tasksystem/skills/s1/SKILL.md',
      Buffer.concat([Buffer.from('body '), Buffer.from([0xff])]));
    assert.throws(() => buildWorkflowPacket(ctx, { command: 'c1' }),
      (e) => e.code === 'CATALOG_MALFORMED');
  } finally { cleanup(dir); }
});

test('workflow packet accepts literal U+FFFD resource bytes', () => {
  const { dir, ctx } = v1SnapshotFixture();
  try {
    writeFile(dir, '.tasksystem/commands/c1.md',
      Buffer.concat([Buffer.from('body '), Buffer.from([0xef, 0xbf, 0xbd])]));
    const packet = buildWorkflowPacket(ctx, { command: 'c1' });
    assert.ok(packet.command.content.includes('\ufffd'));
  } finally { cleanup(dir); }
});

test('cli catalog show rejects non-roundtrippable resource bytes (CATALOG_MALFORMED)', async () => {
  const { dir } = v1SnapshotFixture();
  try {
    writeFile(dir, '.tasksystem/commands/c1.md',
      Buffer.concat([Buffer.from('body '), Buffer.from([0xff])]));
    const io = fakeIO();
    const code = await run(
      ['catalog', 'show', 'command', 'c1', '--project', dir], io);
    assert.equal(code, 1);
    const payload = JSON.parse(io.out.stderr[0]);
    assert.equal(payload.error.code, 'CATALOG_MALFORMED');
  } finally { cleanup(dir); }
});

test('mcp catalog_get rejects non-roundtrippable resource bytes (CATALOG_MALFORMED)', async (t) => {
  let z;
  try {
    ({ z } = await import('zod'));
  } catch {
    t.skip('optional MCP dependencies are not installed');
    return;
  }
  const { createMCPTools } = await import('../src/mcp/server.mjs');
  const { dir, ctx } = v1SnapshotFixture();
  try {
    writeFile(dir, '.tasksystem/commands/c1.md',
      Buffer.concat([Buffer.from('body '), Buffer.from([0xff])]));
    const tools = createMCPTools(ctx, z);
    const get = tools.find((x) => x.name === 'scopegrain_catalog_get');
    const res = await get.handler({ kind: 'command', id: 'c1' });
    assert.equal(res.isError, true);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.code, 'CATALOG_MALFORMED');
  } finally { cleanup(dir); }
});
