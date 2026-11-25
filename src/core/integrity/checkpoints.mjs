// SPDX-License-Identifier: Apache-2.0
// Journal integrity checkpoints (docs/records-integrity-design.md):
// an append-only checkpoints.jsonl of Ed25519-signed head anchors living
// inside the journal tree, plus the chainHead event accumulator that
// journal.mjs folds into head.json on every sequence reservation.
//
// chainHead semantics: fold over EVERY persisted intent event ordered by
// journalSequence. Events of persisted-but-abandoned intents count (they
// remain journaled provenance); events reserved but never persisted (the
// missing-intent crash window) are dropped when the abandon recovery
// recomputes the head chain. A checkpoint is only ever emitted on a
// quiescent head (activeOperation null), so a signed anchor always
// matches a chain fully derivable from on-disk intents.
//
// Keys live at <paths.state>/integrity/journal-ed25519.{key,pub}: outside
// the journal tree, inside the owner-configured state root, inside the
// project. Signing is opt-in: createJournalCheckpoint generates the pair
// on first use; committed operations then seal automatically through
// maybeEmitCheckpoint (armed only when the key file already exists).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalJSON, canonicalDigest } from '../digests.mjs';
import { err } from '../errors.mjs';
import { decodeUtf8Strict, lstatOrNull, readFileLimited } from '../fsx.mjs';
import { acquireVerifiedLock, releaseVerifiedLock } from '../locks.mjs';
import { resolveInside } from '../paths.mjs';
import { loadLimits } from '../policy.mjs';
import { resolveWorkspaceState } from '../workspaces.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const KEY_ID = /^[0-9a-f]{16}$/;
const SIG_B64 = /^[A-Za-z0-9+/]{86}==$/; // Ed25519: 64 bytes -> 88 base64 chars
const CHAIN_SEED = 'scopegrain-journal-v1';
const KEY_NAME = 'journal-ed25519';
const KEY_PEM_LIMIT = 64 * 1024;
const TAIL_WINDOW = 64 * 1024;
const READ_CHUNK = 64 * 1024;
// Policy-free bound on verify scans: each line is ~400 bytes, so this is
// centuries of per-commit checkpoints — the cap only exists so a corrupt
// or hostile file cannot stream forever.
const MAX_CHECKPOINT_LINES = 1000000;

function closed(value, keys, required, code, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw err(code, `${label} must be a plain object`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw err(code, `${label} has invalid property '${key}'`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw err(code, `${label} is missing '${key}'`);
  }
}

function hash(value) {
  return typeof value === 'string' && HASH.test(value);
}

function isoTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function digestBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function syncDir(dirAbs) {
  let fd;
  try {
    fd = fs.openSync(dirAbs, 'r');
    fs.fsyncSync(fd);
  } catch { /* directory fsync unsupported or directory gone */ }
  finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* descriptor may be broken */ }
    }
  }
}

// Project paths derived from the bound workspace's state root. The
// integrity directory sits next to journal/ inside paths.state: outside
// the journaled tree, never outside the project.
function projectPaths(bound) {
  const { projectRoot, stateRel } = resolveWorkspaceState(bound);
  const journalAbs = resolveInside(projectRoot, `${stateRel}/journal`, 'journal path');
  const integrityAbs = resolveInside(projectRoot, `${stateRel}/integrity`, 'integrity path');
  return {
    projectRoot, stateRel, journalAbs, integrityAbs,
    checkpointsAbs: path.join(journalAbs, 'checkpoints.jsonl'),
    lockAbs: path.join(journalAbs, '.lock'),
    headAbs: path.join(journalAbs, 'head.json'),
    keyAbs: path.join(integrityAbs, `${KEY_NAME}.key`),
    pubAbs: path.join(integrityAbs, `${KEY_NAME}.pub`),
  };
}

export function journalChainSeed() {
  return crypto.createHash('sha256').update(CHAIN_SEED, 'utf8').digest('hex');
}

export function journalChainFold(previous, event) {
  return crypto.createHash('sha256')
    .update(`${previous}:${canonicalDigest(event)}`, 'utf8').digest('hex');
}

// Enumerate every persisted intent.json under operations/ and
// archive/operations/. Directories without an intent (an abandon receipt
// left by the missing-intent recovery path) contribute nothing — their
// reserved sequences were never backed by events.
function* intentPaths(journalAbs) {
  for (const base of ['operations', path.join('archive', 'operations')]) {
    const dirAbs = path.join(journalAbs, base);
    const stat = lstatOrNull(dirAbs);
    if (!stat) continue;
    if (!stat.isDirectory()) {
      throw err('JOURNAL_MALFORMED', `not a directory: ${base}`);
    }
    const dir = fs.opendirSync(dirAbs);
    try {
      for (;;) {
        const entry = dir.readSync();
        if (entry === null) break;
        if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
        yield path.join(dirAbs, entry.name, 'intent.json');
      }
    } finally {
      dir.closeSync();
    }
  }
}

// Every persisted event, sorted by journalSequence. Light validation
// only: the fold seals whatever bytes are on disk (canonicalDigest is
// content-faithful); deeper shape checks belong to the journal readers.
// A duplicate sequence across intents is cross-operation corruption and
// fails closed.
function persistedEvents(journalAbs) {
  const events = [];
  const sequences = new Set();
  for (const intentAbs of intentPaths(journalAbs)) {
    const stat = lstatOrNull(intentAbs);
    if (!stat) continue;
    if (!stat.isFile()) {
      throw err('JOURNAL_MALFORMED', 'journal intent is not a regular file');
    }
    const limited = readFileLimited(intentAbs, loadLimits().maxDocumentBytes);
    if (limited.exceeded) {
      throw err('DOCUMENT_TOO_LARGE', 'journal intent exceeds limit');
    }
    const text = decodeUtf8Strict(
      limited.content, 'JOURNAL_MALFORMED', 'journal intent');
    let intent;
    try {
      intent = JSON.parse(text);
    } catch {
      throw err('JOURNAL_MALFORMED', 'malformed journal intent');
    }
    if (intent === null || typeof intent !== 'object'
        || !Array.isArray(intent.events)) {
      throw err('JOURNAL_MALFORMED', 'journal intent has no event list');
    }
    for (const event of intent.events) {
      if (event === null || typeof event !== 'object'
          || !Number.isSafeInteger(event.journalSequence)
          || event.journalSequence < 1) {
        throw err('JOURNAL_MALFORMED', 'journal event has invalid sequence');
      }
      if (sequences.has(event.journalSequence)) {
        throw err('JOURNAL_MALFORMED', 'journal events share a sequence');
      }
      sequences.add(event.journalSequence);
      events.push(event);
    }
  }
  events.sort((a, b) => a.journalSequence - b.journalSequence);
  return events;
}

// Full-chain recompute over persisted intents. uptoSequence bounds the
// fold to the prefix a checkpoint sealed, so verify can re-derive a
// signed anchor without depending on the current head. O(history) —
// reserved for migration, recovery and offline verification, never a
// hot read path.
export function recomputeChainHead(journalAbs, { uptoSequence = Infinity } = {}) {
  let chain = journalChainSeed();
  for (const event of persistedEvents(journalAbs)) {
    if (event.journalSequence > uptoSequence) break;
    try {
      chain = journalChainFold(chain, event);
    } catch (e) {
      if (e.code === 'INVALID_JSON_VALUE') {
        throw err('JOURNAL_MALFORMED', 'journal event is not canonical JSON data');
      }
      throw e;
    }
  }
  return chain;
}

// ==== checkpoint line shape ====

const CHECKPOINT_KEYS = ['schemaVersion', 'checkpointSeq', 'createdAt',
  'headSequence', 'headSha256', 'chainHead', 'prevCheckpointDigest',
  'supersedesKeyId'];
const CHECKPOINT_REQUIRED = CHECKPOINT_KEYS.slice(0, 7);
const SIGNATURE_KEYS = ['alg', 'keyId', 'sig'];

// Closed-shape validation of one stored line: {checkpoint, signature}.
// supersedesKeyId is reserved for key rotation (design §3.6): accepted
// as null or a key id, never emitted by this version.
function validateCheckpointRecord(value) {
  const code = 'JOURNAL_MALFORMED';
  closed(value, ['checkpoint', 'signature'], ['checkpoint', 'signature'],
    code, 'checkpoint line');
  const c = value.checkpoint;
  closed(c, CHECKPOINT_KEYS, CHECKPOINT_REQUIRED, code, 'journal checkpoint');
  if (c.schemaVersion !== 1
      || !Number.isSafeInteger(c.checkpointSeq) || c.checkpointSeq < 0
      || !isoTime(c.createdAt)
      || !Number.isSafeInteger(c.headSequence) || c.headSequence < 0
      || !hash(c.headSha256)
      || (c.chainHead !== null && !hash(c.chainHead))
      || (c.prevCheckpointDigest !== null && !hash(c.prevCheckpointDigest))
      || (c.supersedesKeyId !== undefined && c.supersedesKeyId !== null
        && !KEY_ID.test(c.supersedesKeyId))) {
    throw err(code, 'journal checkpoint has invalid fields');
  }
  const s = value.signature;
  closed(s, SIGNATURE_KEYS, SIGNATURE_KEYS, code, 'checkpoint signature');
  if (s.alg !== 'ed25519' || !KEY_ID.test(s.keyId)
      || typeof s.sig !== 'string' || !SIG_B64.test(s.sig)) {
    throw err(code, 'checkpoint signature has invalid fields');
  }
  return value;
}

function parseCheckpointLine(text, label = 'checkpoint line') {
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    throw err('JOURNAL_MALFORMED', `malformed ${label}`);
  }
  return validateCheckpointRecord(record);
}

function flatRecord(record) {
  const c = record.checkpoint;
  const flat = {
    checkpointSeq: c.checkpointSeq,
    at: c.createdAt,
    headSequence: c.headSequence,
    headSha256: c.headSha256,
    chainHead: c.chainHead,
    prevCheckpointDigest: c.prevCheckpointDigest,
    signature: record.signature.sig,
    keyId: record.signature.keyId,
    digest: canonicalDigest(c),
  };
  if (c.supersedesKeyId !== undefined) flat.supersedesKeyId = c.supersedesKeyId;
  return flat;
}

// ==== checkpoints.jsonl IO ====

// Streaming line reader for verify: bounded memory per line, a total
// line cap, strict UTF-8 and a hard fail on an unterminated tail (a
// torn append or manual edit must be reported, never silently skipped).
function readCheckpointLines(abs) {
  const stat = lstatOrNull(abs);
  if (!stat) return { status: 'missing', lines: [] };
  if (!stat.isFile()) {
    return { status: 'malformed', reason: 'checkpoints path is not a regular file', lines: [] };
  }
  const maxLine = loadLimits().maxDocumentBytes;
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(READ_CHUNK);
    let carry = Buffer.alloc(0);
    const lines = [];
    for (;;) {
      const count = fs.readSync(fd, buf, 0, buf.length, null);
      if (count <= 0) break;
      carry = Buffer.concat([carry, buf.subarray(0, count)]);
      let idx;
      while ((idx = carry.indexOf(0x0a)) !== -1) {
        const line = carry.subarray(0, idx);
        carry = carry.subarray(idx + 1);
        if (line.length === 0) {
          return { status: 'malformed', reason: 'empty checkpoint line', lines };
        }
        lines.push(line);
        if (lines.length > MAX_CHECKPOINT_LINES) {
          return { status: 'malformed', reason: 'checkpoint file exceeds line bound', lines };
        }
      }
      if (carry.length > maxLine) {
        return { status: 'malformed', reason: 'checkpoint line exceeds document limit', lines };
      }
    }
    if (carry.length !== 0) {
      return { status: 'malformed', reason: 'checkpoints file has unterminated tail', lines };
    }
    return { status: 'ok', lines };
  } finally {
    fs.closeSync(fd);
  }
}

// Last complete line for the append path: a fixed tail window keeps the
// read bounded no matter how large the file grows. The file must end in
// '\n' — anything else is a torn write or tamper and fails closed.
function readTailLine(abs) {
  const stat = lstatOrNull(abs);
  if (!stat) return null;
  if (!stat.isFile()) {
    throw err('JOURNAL_MALFORMED', 'checkpoints path is not a regular file');
  }
  const size = Number(stat.size);
  if (size === 0) return null;
  const window = Math.min(size, Math.max(TAIL_WINDOW, loadLimits().maxDocumentBytes));
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(window);
    let offset = 0;
    while (offset < window) {
      const count = fs.readSync(fd, buf, offset, window - offset, size - window + offset);
      if (count <= 0) {
        throw err('READ_FAILED', 'checkpoint tail read made no progress');
      }
      offset += count;
    }
    if (buf[window - 1] !== 0x0a) {
      throw err('JOURNAL_MALFORMED', 'checkpoints file has unterminated tail');
    }
    const previous = buf.lastIndexOf(0x0a, window - 2);
    if (previous === -1 && size > window) {
      throw err('JOURNAL_MALFORMED', 'checkpoint last line exceeds read window');
    }
    return decodeUtf8Strict(
      buf.subarray(previous + 1, window - 1), 'JOURNAL_MALFORMED', 'checkpoint line');
  } finally {
    fs.closeSync(fd);
  }
}

function appendCheckpointLine(abs, canonicalText) {
  const bytes = Buffer.from(`${canonicalText}\n`, 'utf8');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const fd = fs.openSync(abs, 'a');
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
      if (count <= 0) {
        throw err('WRITE_FAILED', 'checkpoint append made no progress');
      }
      offset += count;
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  syncDir(path.dirname(abs));
}

// Atomic replace for the forward-migration head rewrite only. Mirrors
// journal.mjs atomicHead: fsync'd temp in the same directory + rename on
// the same volume + directory fsync. Unique temp names mean a failed
// write can only ever remove our own temp.
function atomicReplace(abs, bytes) {
  const tmp = `${abs}.tmp-${crypto.randomUUID()}`;
  const fd = fs.openSync(tmp, 'wx');
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
      if (count <= 0) {
        throw err('WRITE_FAILED', 'integrity write made no progress');
      }
      offset += count;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, abs);
    syncDir(path.dirname(abs));
  } catch (e) {
    try { fs.closeSync(fd); } catch { /* descriptor may be closed */ }
    try { fs.unlinkSync(tmp); } catch { /* best effort: our own temp only */ }
    throw e;
  }
}

// ==== head access (light, checkpoint-facing) ====
// The kernel's validateHead stays authoritative for journaled reads;
// verify needs raw bytes and must REPORT malformation instead of
// throwing past the checks list, so this side uses a lighter parse.

function directoryHasEntries(dirAbs) {
  const stat = lstatOrNull(dirAbs);
  if (!stat) return false;
  if (!stat.isDirectory()) throw err('JOURNAL_MALFORMED', `not a directory: ${dirAbs}`);
  const dir = fs.opendirSync(dirAbs);
  try {
    return dir.readSync() !== null;
  } finally {
    dir.closeSync();
  }
}

function parseHeadBytes(bytes) {
  const text = decodeUtf8Strict(bytes, 'JOURNAL_MALFORMED', 'journal head');
  let head;
  try {
    head = JSON.parse(text);
  } catch {
    throw err('JOURNAL_MALFORMED', 'malformed journal head');
  }
  if (head === null || typeof head !== 'object' || head.schemaVersion !== 1
      || !Number.isSafeInteger(head.lastSequence) || head.lastSequence < 0
      || !Object.hasOwn(head, 'activeOperation')
      || (head.activeOperation !== null
        && (typeof head.activeOperation !== 'object'
          || !UUID.test(head.activeOperation.operationId)
          || !hash(head.activeOperation.intentDigest)))
      || (head.chainHead !== undefined && !hash(head.chainHead))) {
    throw err('JOURNAL_MALFORMED', 'journal head has invalid fields');
  }
  return head;
}

// Head for sealing: mirrors readHead's missing-head rule (history
// without a head is malformed; no history materializes a fresh head),
// and forward-migrates a chainHead-less head in the same write the
// design allows every head write to perform. The checkpoint then seals
// bytes that already carry the accumulator.
function headForCheckpoint(p) {
  const stat = lstatOrNull(p.headAbs);
  if (!stat) {
    if (directoryHasEntries(path.join(p.journalAbs, 'operations'))
        || directoryHasEntries(path.join(p.journalAbs, 'outbox'))
        || directoryHasEntries(path.join(p.journalAbs, 'archive', 'operations'))) {
      throw err('JOURNAL_MALFORMED', 'journal head is missing while history exists');
    }
    const head = {
      schemaVersion: 1, lastSequence: 0, activeOperation: null,
      pendingOperations: 0, chainHead: journalChainSeed(),
    };
    const bytes = Buffer.from(`${JSON.stringify(head, null, 2)}\n`);
    atomicReplace(p.headAbs, bytes);
    return { head, bytes };
  }
  if (!stat.isFile()) throw err('JOURNAL_MALFORMED', 'journal head is not a regular file');
  const limited = readFileLimited(p.headAbs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) throw err('DOCUMENT_TOO_LARGE', 'journal head exceeds limit');
  const head = parseHeadBytes(limited.content);
  if (head.chainHead === undefined) {
    const migrated = { ...head, chainHead: recomputeChainHead(p.journalAbs) };
    const bytes = Buffer.from(`${JSON.stringify(migrated, null, 2)}\n`);
    atomicReplace(p.headAbs, bytes);
    return { head: migrated, bytes };
  }
  return { head, bytes: limited.content };
}

function headForVerify(p) {
  const stat = lstatOrNull(p.headAbs);
  if (!stat) return null;
  if (!stat.isFile()) throw err('JOURNAL_MALFORMED', 'journal head is not a regular file');
  const limited = readFileLimited(p.headAbs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) throw err('DOCUMENT_TOO_LARGE', 'journal head exceeds limit');
  return { head: parseHeadBytes(limited.content), bytes: limited.content };
}

// ==== Ed25519 keys ====

function keyIdOf(publicKey) {
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
}

function readPem(abs, label) {
  const limited = readFileLimited(abs, KEY_PEM_LIMIT);
  if (limited.exceeded) {
    throw err('INTEGRITY_KEY_MALFORMED', `${label} exceeds limit`);
  }
  return decodeUtf8Strict(limited.content, 'INTEGRITY_KEY_MALFORMED', label);
}

function writeExclusive(abs, bytes, mode) {
  const fd = fs.openSync(abs, 'wx', mode);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
      if (count <= 0) {
        throw err('WRITE_FAILED', `integrity write made no progress: ${abs}`);
      }
      offset += count;
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  syncDir(path.dirname(abs));
}

function samePublicKey(a, b) {
  const derA = a.export({ format: 'der', type: 'spki' });
  const derB = b.export({ format: 'der', type: 'spki' });
  return derA.equals(derB);
}

// Key loading under the journal lock. generate:true (the explicit
// checkpoint command) creates the pair on first use; the auto-emit path
// passes generate:false and stays disarmed until then. A stored public
// key that does not match the private key fails closed — signing with a
// split pair would emit checkpoints no verifier can check.
function loadKeys(p, { generate }) {
  const keyStat = lstatOrNull(p.keyAbs);
  const pubStat = lstatOrNull(p.pubAbs);
  let privateKey;
  let publicKey;
  if (!keyStat) {
    if (!generate) return null;
    fs.mkdirSync(p.integrityAbs, { recursive: true });
    const pair = crypto.generateKeyPairSync('ed25519');
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    writeExclusive(p.keyAbs,
      Buffer.from(privateKey.export({ format: 'pem', type: 'pkcs8' })), 0o600);
    writeExclusive(p.pubAbs,
      Buffer.from(publicKey.export({ format: 'pem', type: 'spki' })), 0o644);
    return { privateKey, publicKey };
  }
  if (!keyStat.isFile()) {
    throw err('INTEGRITY_KEY_MALFORMED', 'signing key is not a regular file');
  }
  try {
    privateKey = crypto.createPrivateKey(readPem(p.keyAbs, 'journal signing key'));
  } catch (e) {
    if (e.code === 'INTEGRITY_KEY_MALFORMED') throw e;
    throw err('INTEGRITY_KEY_MALFORMED', 'journal signing key is not a valid private key');
  }
  publicKey = crypto.createPublicKey(privateKey);
  if (pubStat) {
    let stored;
    try {
      stored = crypto.createPublicKey(readPem(p.pubAbs, 'journal public key'));
    } catch (e) {
      if (e.code === 'INTEGRITY_KEY_MALFORMED') throw e;
      throw err('INTEGRITY_KEY_MALFORMED', 'journal public key is not valid');
    }
    if (!samePublicKey(stored, publicKey)) {
      throw err('INTEGRITY_KEY_MISMATCH',
        'journal public key does not match the signing key');
    }
  } else {
    writeExclusive(p.pubAbs,
      Buffer.from(publicKey.export({ format: 'pem', type: 'spki' })), 0o644);
  }
  return { privateKey, publicKey };
}

// ==== emission ====

// Append one checkpoint under the already-held journal lock. Fails when
// the head is mid-operation: a checkpoint seals a quiescent journal so
// its chainHead is always re-derivable from persisted intents.
function appendCheckpointLocked(p, { generate, at }) {
  const { head, bytes } = headForCheckpoint(p);
  if (head.activeOperation !== null) {
    throw err('JOURNAL_RECOVERY_REQUIRED', 'journal has an active operation');
  }
  const keys = loadKeys(p, { generate });
  if (!keys) return null;
  const tail = readTailLine(p.checkpointsAbs);
  let checkpointSeq = 0;
  let prevCheckpointDigest = null;
  if (tail !== null) {
    const previous = parseCheckpointLine(tail, 'checkpoint tail');
    checkpointSeq = previous.checkpoint.checkpointSeq + 1;
    prevCheckpointDigest = canonicalDigest(previous.checkpoint);
  }
  const checkpoint = {
    schemaVersion: 1,
    checkpointSeq,
    createdAt: at ?? new Date().toISOString(),
    headSequence: head.lastSequence,
    headSha256: digestBytes(bytes),
    chainHead: head.chainHead ?? null,
    prevCheckpointDigest,
  };
  const signature = {
    alg: 'ed25519',
    keyId: keyIdOf(keys.publicKey),
    sig: crypto.sign(null, Buffer.from(canonicalJSON(checkpoint), 'utf8'),
      keys.privateKey).toString('base64'),
  };
  appendCheckpointLine(p.checkpointsAbs, canonicalJSON({ checkpoint, signature }));
  return flatRecord({ checkpoint, signature });
}

// Auto-seal hook called from journal.mjs finalizeOperation while the
// journal lock is held. Opt-in posture: nothing is emitted and no keys
// are generated until an explicit createJournalCheckpoint (or a
// provisioned keypair) arms the journal.
export function maybeEmitCheckpoint(bound) {
  const p = projectPaths(bound);
  if (!lstatOrNull(p.keyAbs)) return null;
  return appendCheckpointLocked(p, { generate: false });
}

// Emit a signed checkpoint for the current head. Generates the signing
// pair on first use, migrates a chainHead-less head in the same write,
// and appends under the journal lock so the seal always follows the
// latest committed state. opts.at injects a deterministic createdAt
// (validation is the same strict ISO the journal requires).
export function createJournalCheckpoint(bound, opts = {}) {
  closed(opts, ['at'], [], 'INVALID_JOURNAL_INPUT', 'checkpoint options');
  if (opts.at !== undefined && !isoTime(opts.at)) {
    throw err('INVALID_JOURNAL_INPUT', 'checkpoint timestamp must be canonical ISO');
  }
  const p = projectPaths(bound);
  fs.mkdirSync(p.journalAbs, { recursive: true });
  const lock = acquireVerifiedLock(
    p.lockAbs, 'JOURNAL_LOCKED', 'journal lock already exists');
  try {
    resolveWorkspaceState(bound);
    return appendCheckpointLocked(p, { generate: true, at: opts.at });
  } finally {
    releaseVerifiedLock(lock);
  }
}

// The distributed public key material, or null when the journal has
// never been armed. The key id is a convenience label — authentication
// is the signature verified against this exact PEM.
export function journalSigningPublicKey(bound) {
  const p = projectPaths(bound);
  const stat = lstatOrNull(p.pubAbs);
  if (!stat || !stat.isFile()) return null;
  let publicKey;
  try {
    publicKey = crypto.createPublicKey(readPem(p.pubAbs, 'journal public key'));
  } catch (e) {
    if (e.code === 'INTEGRITY_KEY_MALFORMED') throw e;
    throw err('INTEGRITY_KEY_MALFORMED', 'journal public key is not valid');
  }
  return {
    keyId: keyIdOf(publicKey),
    pem: publicKey.export({ format: 'pem', type: 'spki' }),
    rel: `${p.stateRel}/integrity/${KEY_NAME}.pub`,
  };
}

// ==== verification ====

function verifySignatures(p, records, push) {
  if (records.length === 0) {
    push('checkpoint-signatures', false, { reason: 'no verifiable checkpoints' });
    return false;
  }
  const stat = lstatOrNull(p.pubAbs);
  if (!stat || !stat.isFile()) {
    push('checkpoint-signatures', false, { reason: 'public key missing' });
    return false;
  }
  let publicKey;
  try {
    publicKey = crypto.createPublicKey(readPem(p.pubAbs, 'journal public key'));
  } catch (e) {
    push('checkpoint-signatures', false,
      { reason: 'public key unreadable', code: e.code });
    return false;
  }
  const localKeyId = keyIdOf(publicKey);
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record.signature.keyId !== localKeyId) {
      push('checkpoint-signatures', false, {
        line: i, reason: 'keyId differs from the local public key',
        keyId: record.signature.keyId,
      });
      return false;
    }
    let valid = false;
    try {
      valid = crypto.verify(null,
        Buffer.from(canonicalJSON(record.checkpoint), 'utf8'),
        publicKey, Buffer.from(record.signature.sig, 'base64'));
    } catch {
      valid = false;
    }
    if (!valid) {
      push('checkpoint-signatures', false, { line: i, reason: 'invalid signature' });
      return false;
    }
  }
  push('checkpoint-signatures', true, { keyId: localKeyId });
  return true;
}

// Offline integrity audit. Every check is reported; the aggregate `ok`
// is the conjunction of all of them. `signed` is true only when every
// checkpoint signature verified against the local public key. An
// unsigned journal is reported explicitly (ok:false, signed:false),
// never silently accepted — the opt-in posture is fail-visible.
export function verifyJournalIntegrity(bound, opts = {}) {
  closed(opts, ['expectDigest', 'skipChainScan'], [],
    'INVALID_JOURNAL_INPUT', 'verify options');
  if (opts.expectDigest !== undefined && !hash(opts.expectDigest)) {
    throw err('INVALID_JOURNAL_INPUT', 'expectDigest must be a sha256 hex digest');
  }
  const p = projectPaths(bound);
  const checks = [];
  const push = (name, ok, detail) => {
    const entry = { name, ok };
    if (detail !== undefined) entry.detail = detail;
    checks.push(entry);
    return ok;
  };

  const listing = readCheckpointLines(p.checkpointsAbs);
  if (listing.status !== 'ok' || listing.lines.length === 0) {
    push('checkpoints-file', false, {
      status: listing.status === 'ok' ? 'empty' : listing.status,
      reason: listing.reason ?? null,
    });
    return { ok: false, signed: false, checks, lastCheckpoint: null };
  }
  push('checkpoints-file', true, { count: listing.lines.length });

  const records = [];
  let formatOk = true;
  for (let i = 0; i < listing.lines.length; i += 1) {
    let record;
    let text;
    try {
      text = decodeUtf8Strict(
        listing.lines[i], 'JOURNAL_MALFORMED', 'checkpoint line');
      record = parseCheckpointLine(text);
      if (text !== canonicalJSON(record)) {
        throw err('JOURNAL_MALFORMED', 'checkpoint line is not canonical JSON');
      }
    } catch (e) {
      push('checkpoint-format', false,
        { line: i, code: e.code, message: e.message });
      formatOk = false;
      break;
    }
    records.push(record);
  }
  if (formatOk) push('checkpoint-format', true);

  // A broken prefix does not stop the audit: signature and head checks
  // still run over the parsed records so the report shows every layer
  // that holds and the first one that does not.
  let chainOk = true;
  for (let i = 0; i < records.length; i += 1) {
    const c = records[i].checkpoint;
    if (c.checkpointSeq !== i) {
      chainOk = push('checkpoint-chain', false, {
        line: i, field: 'checkpointSeq', expected: i, actual: c.checkpointSeq,
      });
      break;
    }
    const expectedPrev = i === 0 ? null : canonicalDigest(records[i - 1].checkpoint);
    if (c.prevCheckpointDigest !== expectedPrev) {
      chainOk = push('checkpoint-chain', false,
        { line: i, field: 'prevCheckpointDigest' });
      break;
    }
    if (i > 0 && c.headSequence < records[i - 1].checkpoint.headSequence) {
      chainOk = push('checkpoint-chain', false,
        { line: i, field: 'headSequence', reason: 'head sequence regression' });
      break;
    }
  }
  if (chainOk) push('checkpoint-chain', true);

  const lastCheckpoint = records.length ? flatRecord(records.at(-1)) : null;
  // `signed` asserts the whole file: every line parsed, chained and
  // signature-verified. A valid prefix under a broken tail is reported
  // per-check, but never summarized as signed.
  const signed = verifySignatures(p, records, push) && formatOk && chainOk;

  let headInfo = null;
  try {
    headInfo = headForVerify(p);
    if (headInfo === null) {
      push('journal-head', false, { reason: 'head.json missing' });
    } else {
      push('journal-head', true);
    }
  } catch (e) {
    push('journal-head', false, { code: e.code, message: e.message });
  }

  if (headInfo !== null && lastCheckpoint !== null) {
    const { head, bytes } = headInfo;
    push('head-sequence', head.lastSequence >= lastCheckpoint.headSequence, {
      headSequence: head.lastSequence,
      checkpointSequence: lastCheckpoint.headSequence,
    });
    // Informational: exact-byte equality with the sealed head means no
    // journal write happened since the checkpoint. Divergence afterwards
    // is expected (commits, ack-driven pending counts) and is arbitrated
    // by head-sequence and the chain checks, not by this byte compare.
    push('head-anchor', true, {
      sealed: digestBytes(bytes) === lastCheckpoint.headSha256,
      headSha256: digestBytes(bytes),
      checkpointSha256: lastCheckpoint.headSha256,
    });
    if (head.activeOperation !== null) {
      push('journal-quiescent', false,
        { activeOperation: head.activeOperation.operationId });
    }
    if (!opts.skipChainScan) {
      if (head.chainHead !== undefined) {
        try {
          const recomputed = recomputeChainHead(p.journalAbs);
          push('event-chain', recomputed === head.chainHead, {
            expected: head.chainHead, actual: recomputed,
          });
        } catch (e) {
          push('event-chain', false, { code: e.code, message: e.message });
        }
      } else {
        push('event-chain', true, { status: 'head predates chainHead' });
      }
      if (lastCheckpoint.chainHead !== null) {
        try {
          const prefix = recomputeChainHead(
            p.journalAbs, { uptoSequence: lastCheckpoint.headSequence });
          push('checkpoint-anchor', prefix === lastCheckpoint.chainHead, {
            expected: lastCheckpoint.chainHead, actual: prefix,
          });
        } catch (e) {
          push('checkpoint-anchor', false, { code: e.code, message: e.message });
        }
      } else {
        push('checkpoint-anchor', true, { status: 'checkpoint predates chainHead' });
      }
    }
  }

  if (opts.expectDigest !== undefined) {
    push('expect-digest',
      lastCheckpoint !== null && opts.expectDigest === lastCheckpoint.digest, {
        expected: opts.expectDigest,
        actual: lastCheckpoint === null ? null : lastCheckpoint.digest,
      });
  }

  return { ok: checks.every((check) => check.ok), signed, checks, lastCheckpoint };
}
