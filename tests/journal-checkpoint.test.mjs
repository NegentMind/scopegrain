// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { canonicalJSON, canonicalDigest } from '../src/core/digests.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import { applyJournaledCreation } from '../src/core/journal.mjs';
import {
  createJournalCheckpoint, verifyJournalIntegrity,
  journalSigningPublicKey, journalChainSeed,
} from '../src/core/integrity/checkpoints.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, writeJson } from './helpers.mjs';

function fixture({ state = '.scopegrain/state' } = {}) {
  const dir = makeTempDir('journal-checkpoint');
  const answers = { ...VALID_ANSWERS, paths: { ...VALID_ANSWERS.paths, state } };
  writeJson(dir, '.scopegrain/config.json', createConfig(dir, answers, {}));
  const ctx = resolveContext({ project: dir, config: '.scopegrain/config.json' });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  return {
    dir, ctx, a, b,
    bound: bindWorkspace(ctx, { areaIds: [a, b] }),
    journal: path.join(dir, ...state.split('/'), 'journal'),
    integrity: path.join(dir, ...state.split('/'), 'integrity'),
  };
}

function change(areaIds, rel, content = 'content', recordId = 'record-1') {
  return { sourceKind: 'task', recordId, sourceRevision: 0, areaIds,
    file: { rel, content } };
}

function head(f) {
  return JSON.parse(fs.readFileSync(path.join(f.journal, 'head.json'), 'utf8'));
}

function writeHead(f, value) {
  fs.writeFileSync(path.join(f.journal, 'head.json'), JSON.stringify(value));
}

function checkpointLines(f) {
  const file = path.join(f.journal, 'checkpoints.jsonl');
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((line) => JSON.parse(line));
}

function checkByName(result, name) {
  const check = result.checks.find((item) => item.name === name);
  assert.ok(check, `missing check ${name}`);
  return check;
}

test('create -> verify end-to-end: signed chain, sealed head, armed auto-emit', () => {
  const f = fixture();
  try {
    const r1 = applyJournaledCreation(f.bound, [change([f.a], 'records/one')]);
    assert.equal(r1.status, 'committed');
    // Not yet armed: commits before the first explicit checkpoint emit
    // nothing and create no key material.
    assert.equal(fs.existsSync(path.join(f.journal, 'checkpoints.jsonl')), false);
    assert.equal(fs.existsSync(f.integrity), false);

    const first = createJournalCheckpoint(f.bound);
    assert.equal(first.checkpointSeq, 0);
    assert.equal(first.headSequence, head(f).lastSequence);
    assert.equal(first.headSha256,
      crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(f.journal, 'head.json')))
        .digest('hex'));
    assert.equal(first.chainHead, head(f).chainHead);
    assert.equal(first.prevCheckpointDigest, null);
    assert.match(first.keyId, /^[0-9a-f]{16}$/);
    assert.match(first.signature, /^[A-Za-z0-9+/]{86}==$/);
    assert.equal(first.digest, canonicalDigest(checkpointLines(f)[0].checkpoint));

    // Keys live under the state root, outside the journal tree.
    const key = journalSigningPublicKey(f.bound);
    assert.equal(key.keyId, first.keyId);
    assert.equal(fs.existsSync(path.join(f.integrity, 'journal-ed25519.key')), true);
    assert.equal(fs.existsSync(path.join(f.integrity, 'journal-ed25519.pub')), true);
    assert.equal(fs.existsSync(path.join(f.journal, 'journal-ed25519.key')), false);

    // The stored signature verifies against the exported public key over
    // the canonical bytes of the inner checkpoint object.
    const stored = checkpointLines(f)[0];
    assert.equal(stored.signature.keyId, first.keyId);
    assert.equal(crypto.verify(null,
      Buffer.from(canonicalJSON(stored.checkpoint), 'utf8'),
      crypto.createPublicKey(key.pem),
      Buffer.from(stored.signature.sig, 'base64')), true);

    let result = verifyJournalIntegrity(f.bound);
    assert.equal(result.ok, true);
    assert.equal(result.signed, true);
    assert.equal(result.lastCheckpoint.digest, first.digest);
    assert.ok(result.checks.every((check) => check.ok));
    assert.equal(checkByName(result, 'head-anchor').detail.sealed, true);

    // Armed now: the next commit auto-seals a chained second checkpoint.
    const r2 = applyJournaledCreation(f.bound, [change([f.b], 'records/two')]);
    assert.equal(r2.status, 'committed');
    const lines = checkpointLines(f);
    assert.equal(lines.length, 2);
    assert.equal(lines[1].checkpoint.checkpointSeq, 1);
    assert.equal(lines[1].checkpoint.prevCheckpointDigest,
      canonicalDigest(lines[0].checkpoint));
    assert.equal(lines[1].checkpoint.headSequence, head(f).lastSequence);

    result = verifyJournalIntegrity(f.bound);
    assert.equal(result.ok, true);
    assert.equal(result.signed, true);
    assert.equal(result.lastCheckpoint.checkpointSeq, 1);
    // The head advanced after the explicit seal: sealed is informational,
    // not a failure.
    assert.equal(checkByName(result, 'head-anchor').detail.sealed, true);
  } finally {
    cleanup(f.dir);
  }
});

test('empty journal checkpoints materialize a genesis head and still verify', () => {
  const f = fixture();
  try {
    const record = createJournalCheckpoint(f.bound,
      { at: '2026-11-24T00:00:00.000Z' });
    assert.equal(record.checkpointSeq, 0);
    assert.equal(record.headSequence, 0);
    assert.equal(record.chainHead, journalChainSeed());
    assert.equal(record.at, '2026-11-24T00:00:00.000Z');
    assert.equal(head(f).chainHead, journalChainSeed());
    const result = verifyJournalIntegrity(f.bound);
    assert.equal(result.ok, true);
    assert.equal(result.signed, true);
  } finally {
    cleanup(f.dir);
  }
});

test('tampered head is detected: rollback and chainHead forgery both fail', () => {
  for (const variant of ['rollback', 'chainHead']) {
    const f = fixture();
    try {
      applyJournaledCreation(f.bound, [change([f.a], 'records/one')]);
      createJournalCheckpoint(f.bound);
      const tampered = head(f);
      if (variant === 'rollback') {
        tampered.lastSequence = 0; // rewound below the sealed headSequence
      } else {
        tampered.chainHead = '0'.repeat(64);
      }
      writeHead(f, tampered);
      const result = verifyJournalIntegrity(f.bound);
      assert.equal(result.ok, false, variant);
      if (variant === 'rollback') {
        // A rewound lastSequence contradicts the sealed headSequence.
        assert.equal(checkByName(result, 'head-sequence').ok, false);
      } else {
        // A forged accumulator diverges from the on-disk event fold.
        assert.equal(checkByName(result, 'event-chain').ok, false);
      }
    } finally {
      cleanup(f.dir);
    }
  }
});

test('tampered checkpoints.jsonl is detected at signature and chain level', () => {
  const f = fixture();
  try {
    applyJournaledCreation(f.bound, [change([f.a], 'records/one')]);
    createJournalCheckpoint(f.bound);
    applyJournaledCreation(f.bound, [change([f.a], 'records/two', 'other', 'record-2')]);
    const file = path.join(f.journal, 'checkpoints.jsonl');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    // Flip a sealed value inside the first line: still canonical JSON,
    // so only the signature/link checks can catch it.
    lines[0] = lines[0].replace('"headSequence":1', '"headSequence":9');
    assert.notEqual(lines[0].includes('"headSequence":9'), false);
    fs.writeFileSync(file, lines.join('\n'));
    const result = verifyJournalIntegrity(f.bound);
    assert.equal(result.ok, false);
    assert.equal(checkByName(result, 'checkpoint-chain').ok, false);
    assert.equal(result.signed, false);
    assert.equal(checkByName(result, 'checkpoint-signatures').ok, false);
  } finally {
    cleanup(f.dir);
  }
});

test('sequence rollback of the checkpoint file fails closed', () => {
  const f = fixture();
  try {
    applyJournaledCreation(f.bound, [change([f.a], 'records/one')]);
    createJournalCheckpoint(f.bound);
    applyJournaledCreation(f.bound, [change([f.a], 'records/two', 'other', 'record-2')]);
    const sealed = verifyJournalIntegrity(f.bound).lastCheckpoint;
    assert.equal(sealed.checkpointSeq, 1);
    const file = path.join(f.journal, 'checkpoints.jsonl');
    // Truncate to the first line: with no external anchor this only
    // reports an older lastCheckpoint; with --expect-digest it fails.
    const first = `${fs.readFileSync(file, 'utf8').split('\n')[0]}\n`;
    fs.writeFileSync(file, first);
    const plain = verifyJournalIntegrity(f.bound);
    assert.equal(plain.ok, true);
    assert.equal(plain.lastCheckpoint.checkpointSeq, 0);
    const anchored = verifyJournalIntegrity(f.bound, { expectDigest: sealed.digest });
    assert.equal(anchored.ok, false);
    assert.equal(checkByName(anchored, 'expect-digest').ok, false);
    // A forged continuation line (seq skipped) breaks the chain too.
    fs.writeFileSync(file,
      `${first}${first.replace('"checkpointSeq":0', '"checkpointSeq":5')}`);
    const forged = verifyJournalIntegrity(f.bound);
    assert.equal(forged.ok, false);
    assert.equal(checkByName(forged, 'checkpoint-chain').ok, false);
  } finally {
    cleanup(f.dir);
  }
});

test('forward migration: chainHead-less heads initialize on the next write', () => {
  const f = fixture();
  try {
    applyJournaledCreation(f.bound, [change([f.a], 'records/one')]);
    createJournalCheckpoint(f.bound);
    // Simulate a pre-chainHead head: the field disappears but events stay.
    const legacy = head(f);
    delete legacy.chainHead;
    writeHead(f, legacy);
    // Verify still passes: the legacy head is a valid read, the sealed
    // prefix is re-derivable, and event-chain reports 'predates'.
    const legacyResult = verifyJournalIntegrity(f.bound);
    assert.equal(legacyResult.ok, true);
    assert.equal(checkByName(legacyResult, 'event-chain').detail.status,
      'head predates chainHead');
    // Next head write migrates the accumulator over the full history.
    applyJournaledCreation(f.bound, [change([f.b], 'records/two', 'other', 'record-2')]);
    assert.match(head(f).chainHead, /^[0-9a-f]{64}$/);
    const result = verifyJournalIntegrity(f.bound);
    assert.equal(result.ok, true);
    assert.equal(checkByName(result, 'event-chain').ok, true);
  } finally {
    cleanup(f.dir);
  }
});

test('createJournalCheckpoint migrates a legacy head and seals the computed chain', () => {
  const f = fixture();
  try {
    applyJournaledCreation(f.bound, [change([f.a], 'records/one')]);
    const legacy = head(f);
    delete legacy.chainHead;
    writeHead(f, legacy);
    const record = createJournalCheckpoint(f.bound);
    assert.match(record.chainHead, /^[0-9a-f]{64}$/);
    assert.equal(head(f).chainHead, record.chainHead);
    const result = verifyJournalIntegrity(f.bound);
    assert.equal(result.ok, true);
    assert.equal(checkByName(result, 'checkpoint-anchor').ok, true);
  } finally {
    cleanup(f.dir);
  }
});

test('idempotence: repeated seals chain monotonically; verify is read-only', () => {
  const f = fixture();
  try {
    applyJournaledCreation(f.bound, [change([f.a], 'records/one')]);
    const one = createJournalCheckpoint(f.bound);
    const two = createJournalCheckpoint(f.bound);
    assert.equal(two.checkpointSeq, 1);
    assert.equal(two.prevCheckpointDigest, one.digest);
    assert.equal(two.headSequence, one.headSequence);
    const file = path.join(f.journal, 'checkpoints.jsonl');
    const before = fs.readFileSync(file);
    const first = verifyJournalIntegrity(f.bound);
    const second = verifyJournalIntegrity(f.bound);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.deepEqual(second.lastCheckpoint, first.lastCheckpoint);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(checkpointLines(f).length, 2);
  } finally {
    cleanup(f.dir);
  }
});

test('unsigned journal reports the missing seal explicitly', () => {
  const f = fixture();
  try {
    applyJournaledCreation(f.bound, [change([f.a], 'records/one')]);
    const result = verifyJournalIntegrity(f.bound);
    assert.equal(result.ok, false);
    assert.equal(result.signed, false);
    assert.equal(result.lastCheckpoint, null);
    assert.equal(checkByName(result, 'checkpoints-file').ok, false);
  } finally {
    cleanup(f.dir);
  }
});

test('checkpoint refuses a non-quiescent head; a tampered signature key fails', () => {
  const f = fixture();
  try {
    applyJournaledCreation(f.bound, [change([f.a], 'records/one')]);
    // Forge an active operation pointer: sealing must refuse until the
    // journal is recovered, so no checkpoint ever anchors phantom events.
    const wedged = head(f);
    wedged.activeOperation = {
      operationId: crypto.randomUUID(), intentDigest: 'a'.repeat(64),
    };
    writeHead(f, wedged);
    assert.throws(() => createJournalCheckpoint(f.bound),
      (e) => e.code === 'JOURNAL_RECOVERY_REQUIRED');
    const restored = head(f);
    restored.activeOperation = null;
    writeHead(f, restored);
    createJournalCheckpoint(f.bound);
    // Swap the public key for a different pair: every stored signature
    // now fails verification instead of being silently accepted.
    const other = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(path.join(f.integrity, 'journal-ed25519.pub'),
      other.publicKey.export({ format: 'pem', type: 'spki' }));
    const result = verifyJournalIntegrity(f.bound);
    assert.equal(result.ok, false);
    assert.equal(result.signed, false);
    assert.equal(checkByName(result, 'checkpoint-signatures').ok, false);
  } finally {
    cleanup(f.dir);
  }
});
