// SPDX-License-Identifier: Apache-2.0
// Supervised verification commands (debt B6): literal-argv command
// records stored per project under <paths.state>/verify-commands.json.
// Every record — declared or inferred — is born UNAPPROVED; nothing
// auto-approves and nothing auto-executes. Approval is always an
// explicit operator action: `applyApproveCommand` flips one record,
// `applyApproveDiscoveredCommands` is the bulk convenience for the
// discover -> approved flow. `runVerifyCommand` is the sole executor:
// it requires an explicitly approved record, spawns the stored argv
// verbatim (spawn with an args array, never a shell string, never
// shell:true), and bounds both runtime and captured output.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { err } from './errors.mjs';
import {
  decodeUtf8Strict, lstatOrNull, mkdirpSync, readFileLimited,
  removeIfExists, writeFileExclusive,
} from './fsx.mjs';
import { resolveInside, toCanonicalRelative } from './paths.mjs';
import {
  acquireVerifiedLock, releaseVerifiedLock,
} from './locks.mjs';
import { loadLimits } from './policy.mjs';

export const VERIFY_STORE_NAME = 'verify-commands.json';

const STORE_KEYS = new Set(['schemaVersion', 'commands']);
const RECORD_KEYS = new Set([
  'id', 'command', 'argv', 'cwd', 'source', 'approved',
  'fingerprint', 'evidence', 'createdAt', 'approvedAt',
]);
const SOURCES = new Set(['declared', 'inferred']);
const ID_RE = /^vc[0-9a-f]{12}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const MAX_COMMAND_CHARS = 4096;
const MAX_ARGV = 64;
const MAX_COMMANDS = 128;
const MAX_EVIDENCE_CHARS = 512;
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TIMEOUT_MS = 600000;
const DEFAULT_MAX_OUTPUT = 256 * 1024;
const MAX_OUTPUT_CAP = 1024 * 1024;
const KILL_GRACE_MS = 2000;
// Shell/control syntax is never meaningful here — argv is spawned
// literally — so these characters only mislead a human reader into
// believing pipes, redirects or substitutions would happen. '%' is
// cmd.exe expansion syntax: '%PATH%' in a stored record would suggest
// an expansion that never occurs (spawn uses no shell).
const FORBIDDEN_CHARS = /[`$(){}\[\]|&;<>'"*?!~%]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const BATCH_WRAPPER = /\.(bat|cmd|ps1)$/i;

// Child-process env allowlist, shared with integrations/vantadb-runtime:
// spawned helpers inherit only the variables they need to resolve
// executables, temp dirs and the platform shell — never the parent's
// credential-bearing variables (tokens, keys, *_SECRET, cloud
// credentials). Callers pass the exact extra vars their child contract
// requires through `overrides`.
const CHILD_ENV_ALLOWLIST = [
  'PATH', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'USERPROFILE',
  'USER', 'LOGNAME', 'SystemRoot', 'SystemDrive', 'OS', 'ComSpec',
  'windir',
  'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR',
  'SHELL', 'TERM', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR',
];

export function controlledSpawnEnv(overrides = {}) {
  const env = {};
  for (const name of CHILD_ENV_ALLOWLIST) {
    const value = process.env[name];
    if (typeof value === 'string') env[name] = value;
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null || value === undefined) delete env[name];
    else env[name] = String(value);
  }
  return env;
}

const isCanon = (v) => {
  const t = Date.parse(v);
  return !Number.isNaN(t) && new Date(t).toISOString() === v;
};

function invalidCommand(message) {
  return err('INVALID_VERIFY_COMMAND', message);
}

// Validates a single non-executable argument: project-contained by
// construction — no POSIX/Windows absolutes, no drive prefixes, no '..'
// segments. Flags ('-x', '--opt=v') and relative paths pass through.
function validateArg(arg) {
  const norm = arg.replace(/\\/g, '/');
  if (norm.startsWith('/')) {
    throw invalidCommand(`argument must not be absolute: ${arg}`);
  }
  if (/^[A-Za-z]:/.test(norm)) {
    throw invalidCommand(`argument must not carry a drive prefix: ${arg}`);
  }
  for (const seg of norm.split('/')) {
    if (seg === '..') {
      throw invalidCommand(
        `argument must not escape the project: ${arg}`);
    }
  }
  return arg;
}

// The stored command is literal argv, whitespace-separated. argv[0] is a
// bare executable name resolved via PATH — never a path, never a batch
// or script wrapper that would require a shell to interpret.
export function parseCommandArgv(command) {
  if (typeof command !== 'string' || command.trim() === '') {
    throw invalidCommand('command must be a non-empty string');
  }
  const trimmed = command.trim();
  if (trimmed.length > MAX_COMMAND_CHARS) {
    throw invalidCommand(`command exceeds ${MAX_COMMAND_CHARS} characters`);
  }
  if (CONTROL_CHARS.test(trimmed)) {
    throw invalidCommand('command contains a control character');
  }
  if (FORBIDDEN_CHARS.test(trimmed)) {
    throw invalidCommand(
      'command contains shell syntax; only literal argv is stored');
  }
  const argv = trimmed.split(/\s+/);
  if (argv.length > MAX_ARGV) {
    throw invalidCommand(`command exceeds ${MAX_ARGV} arguments`);
  }
  const exe = argv[0];
  if (exe === '.' || exe === '..' || /[\\/:]/.test(exe)) {
    throw invalidCommand(
      `executable must be a bare PATH-resolved name: ${exe}`);
  }
  if (BATCH_WRAPPER.test(exe)) {
    throw invalidCommand(
      `batch/script wrappers need a shell and are never stored: ${exe}`);
  }
  for (let i = 1; i < argv.length; i++) validateArg(argv[i]);
  return argv;
}

function normalizeCwd(cwd) {
  if (cwd === undefined) return '.';
  if (cwd === '.') return '.';
  return toCanonicalRelative(cwd, 'command cwd');
}

function fingerprintOf(argv, cwd) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([argv, cwd])).digest('hex');
}

function idOf(argv, cwd) {
  return `vc${fingerprintOf(argv, cwd).slice(0, 12)}`;
}

function buildRecord({ command, cwd, source, evidence, at }) {
  const trimmed = command.trim();
  const argv = parseCommandArgv(trimmed);
  const cwdC = normalizeCwd(cwd);
  if (!SOURCES.has(source)) {
    throw invalidCommand(
      `unknown command source '${source}'; valid: ${[...SOURCES].join(', ')}`);
  }
  if (evidence !== null && (typeof evidence !== 'string'
      || evidence.length === 0 || evidence.length > MAX_EVIDENCE_CHARS)) {
    throw invalidCommand('evidence must be null or a short string');
  }
  return {
    id: idOf(argv, cwdC),
    command: trimmed,
    argv,
    cwd: cwdC,
    source,
    approved: false,
    fingerprint: fingerprintOf(argv, cwdC),
    evidence,
    createdAt: at,
    approvedAt: null,
  };
}

// Closed record: exact key set, argv must re-derive from the stored
// command, id/fingerprint must re-derive from argv+cwd, and approval is
// coherent — approved:true requires approvedAt, approved:false requires
// it null. Hand-edited bytes therefore fail validation instead of being
// honored.
export function validateCommandRecord(rec, label = 'verify command') {
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
    throw err('VERIFY_STORE_MALFORMED', `${label} is not an object`);
  }
  for (const k of Object.keys(rec)) {
    if (!RECORD_KEYS.has(k)) {
      throw err('VERIFY_STORE_MALFORMED',
        `${label} has unknown key '${k}'`);
    }
  }
  let argv;
  try {
    argv = parseCommandArgv(rec.command);
  } catch (e) {
    throw err('VERIFY_STORE_MALFORMED',
      `${label} command is invalid: ${e.message}`);
  }
  const ok = ID_RE.test(rec.id || '')
    && Array.isArray(rec.argv)
    && rec.argv.length === argv.length
    && rec.argv.every((a, i) => a === argv[i])
    && typeof rec.cwd === 'string'
    && SOURCES.has(rec.source)
    && typeof rec.approved === 'boolean'
    && HASH_RE.test(rec.fingerprint || '')
    && (rec.evidence === null
      || (typeof rec.evidence === 'string'
        && rec.evidence.length > 0
        && rec.evidence.length <= MAX_EVIDENCE_CHARS))
    && typeof rec.createdAt === 'string' && isCanon(rec.createdAt)
    && (rec.approved
      ? (typeof rec.approvedAt === 'string' && isCanon(rec.approvedAt))
      : rec.approvedAt === null);
  if (!ok) {
    throw err('VERIFY_STORE_MALFORMED', `${label} has invalid fields`);
  }
  let cwdC;
  try {
    cwdC = normalizeCwd(rec.cwd);
  } catch (e) {
    throw err('VERIFY_STORE_MALFORMED',
      `${label} cwd is invalid: ${e.message}`);
  }
  if (cwdC !== rec.cwd || rec.id !== idOf(argv, rec.cwd)
      || rec.fingerprint !== fingerprintOf(argv, rec.cwd)) {
    throw err('VERIFY_STORE_MALFORMED',
      `${label} identity does not match its command`);
  }
  return rec;
}

export function validateVerifyStore(doc) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw err('VERIFY_STORE_MALFORMED', 'verify store is not an object');
  }
  for (const k of Object.keys(doc)) {
    if (!STORE_KEYS.has(k)) {
      throw err('VERIFY_STORE_MALFORMED',
        `verify store has unknown key '${k}'`);
    }
  }
  if (doc.schemaVersion !== 1 || !Array.isArray(doc.commands)
      || doc.commands.length > MAX_COMMANDS) {
    throw err('VERIFY_STORE_MALFORMED', 'verify store has invalid fields');
  }
  const seen = new Set();
  for (const rec of doc.commands) {
    validateCommandRecord(rec);
    if (seen.has(rec.id)) {
      throw err('VERIFY_STORE_MALFORMED',
        `duplicate command id '${rec.id}'`);
    }
    seen.add(rec.id);
  }
  return doc;
}

export function verifyStoreRel(ctx) {
  return `${ctx.config.paths.state}/${VERIFY_STORE_NAME}`;
}

function verifyStoreAbs(ctx) {
  return resolveInside(ctx.projectRoot, verifyStoreRel(ctx), 'verify store');
}

function readStoreDoc(abs) {
  const st = lstatOrNull(abs);
  if (!st) return { schemaVersion: 1, commands: [] };
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('SYMLINK_REJECTED',
      'verify store must be a regular file, never a link');
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('DOCUMENT_TOO_LARGE', 'verify store exceeds document limit');
  }
  const text = decodeUtf8Strict(
    limited.content, 'VERIFY_STORE_MALFORMED', 'verify store');
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw err('VERIFY_STORE_MALFORMED', 'verify store is not valid JSON');
  }
  return validateVerifyStore(doc);
}

function findCommand(doc, id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw err('INVALID_ID', `verify command id must match ${ID_RE}: ${id}`);
  }
  const rec = doc.commands.find((c) => c.id === id);
  if (!rec) {
    throw err('VERIFY_COMMAND_NOT_FOUND',
      `verify command not found: ${id}`);
  }
  return rec;
}

// Read-only listing; an absent store is an empty list, never an error.
export function listVerifyCommands(ctx) {
  const doc = readStoreDoc(verifyStoreAbs(ctx));
  return {
    store: verifyStoreRel(ctx),
    commands: doc.commands.map((c) => ({ ...c, argv: [...c.argv] })),
  };
}

// Mutations go through an exclusive lock plus atomic temp+rename, the
// same discipline as session records. A dry-run preview is never
// trusted: every apply re-reads and re-validates the current store.
function withStoreLock(ctx, fn) {
  const abs = verifyStoreAbs(ctx);
  mkdirpSync(path.dirname(abs));
  const lock = acquireVerifiedLock(`${abs}.lock`, 'VERIFY_LOCKED',
    'verify store is locked by another operation; no stale-lock recovery');
  let tmpPath = null;
  let tmpOwned = false;
  let result;
  let failure;
  try {
    const current = readStoreDoc(abs);
    const out = fn(current);
    if (out.doc !== null) {
      const serialized = Buffer.from(JSON.stringify(out.doc, null, 2) + '\n');
      if (serialized.length > loadLimits().maxDocumentBytes) {
        throw err('DOCUMENT_TOO_LARGE',
          'mutated verify store would exceed document limit');
      }
      validateVerifyStore(JSON.parse(serialized.toString('utf8')));
      tmpPath = `${abs}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      writeFileExclusive(tmpPath, serialized);
      tmpOwned = true;
      fs.renameSync(tmpPath, abs);
      tmpOwned = false;
    }
    result = out.result;
  } catch (e) {
    failure = e;
  } finally {
    if (tmpOwned) removeIfExists(tmpPath);
    try {
      releaseVerifiedLock(lock); // unlinks only the lock proven ours
    } catch (e) {
      if (!failure) failure = e; // a domain failure is never masked
    }
  }
  if (failure) throw failure;
  return result;
}

function closedOptions(input, keys, label) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_VERIFY_INPUT', `${label} must be an object`);
  }
  for (const k of Object.keys(input)) {
    if (!keys.includes(k)) {
      throw err('INVALID_VERIFY_INPUT',
        `${label} has unknown key '${k}'`);
    }
  }
  return input;
}

function filePreview(ctx, current, changed) {
  const exists = lstatOrNull(verifyStoreAbs(ctx)) !== null;
  return {
    rel: verifyStoreRel(ctx),
    action: !changed ? 'noop' : (exists ? 'update' : 'create'),
  };
}

// --- add (declared) --------------------------------------------------------

export function prepareAddCommand(ctx, options) {
  const opts = closedOptions(options, ['command', 'cwd'], 'add options');
  if (typeof opts.command !== 'string') {
    throw invalidCommand('add options.command must be a string');
  }
  const record = buildRecord({
    command: opts.command, cwd: opts.cwd, source: 'declared',
    evidence: 'declared-via-cli', at: new Date().toISOString(),
  });
  const current = readStoreDoc(verifyStoreAbs(ctx));
  const existing = current.commands.find((c) => c.id === record.id);
  if (existing) {
    return { record: existing, duplicate: true,
      file: filePreview(ctx, current, false) };
  }
  if (current.commands.length >= MAX_COMMANDS) {
    throw err('VERIFY_COMMAND_LIMIT',
      `verify store holds ${MAX_COMMANDS} commands`);
  }
  return { record, duplicate: false, file: filePreview(ctx, current, true) };
}

export function applyAddCommand(ctx, options) {
  const opts = closedOptions(options, ['command', 'cwd'], 'add options');
  if (typeof opts.command !== 'string') {
    throw invalidCommand('add options.command must be a string');
  }
  return withStoreLock(ctx, (current) => {
    const record = buildRecord({
      command: opts.command, cwd: opts.cwd, source: 'declared',
      evidence: 'declared-via-cli', at: new Date().toISOString(),
    });
    const existing = current.commands.find((c) => c.id === record.id);
    if (existing) {
      return { doc: null, result: { record: existing, added: false } };
    }
    if (current.commands.length >= MAX_COMMANDS) {
      throw err('VERIFY_COMMAND_LIMIT',
        `verify store holds ${MAX_COMMANDS} commands`);
    }
    return {
      doc: { schemaVersion: 1, commands: [...current.commands, record] },
      result: { record, added: true },
    };
  });
}

// --- approve ---------------------------------------------------------------

export function prepareApproveCommand(ctx, id) {
  const current = readStoreDoc(verifyStoreAbs(ctx));
  const rec = findCommand(current, id);
  if (rec.approved) {
    return { record: rec, alreadyApproved: true,
      file: filePreview(ctx, current, false) };
  }
  return {
    record: { ...rec, approved: true, approvedAt: new Date().toISOString() },
    alreadyApproved: false,
    file: filePreview(ctx, current, true),
  };
}

// Approval is always explicit and per record; inferred commands are
// approvable only through this path, never automatically.
export function applyApproveCommand(ctx, id) {
  return withStoreLock(ctx, (current) => {
    const rec = findCommand(current, id);
    if (rec.approved) {
      return { doc: null,
        result: { record: rec, changed: false } };
    }
    const next = { ...rec, approved: true,
      approvedAt: new Date().toISOString() };
    return {
      doc: {
        schemaVersion: 1,
        commands: current.commands.map((c) => (c.id === id ? next : c)),
      },
      result: { record: next, changed: true },
    };
  });
}

// --- discover (inferred) ---------------------------------------------------

// candidates come from the semantic discovery layer as
// {command, script?, cwd?, source?, unresolved?} — command may be null
// when the detector could not resolve a concrete command (ambiguous
// package manager). Nulls are reported as skipped, never stored; each
// skipped entry carries the discovery-layer cause code (`unresolved`)
// and a `hint` telling the operator exactly how to fix the signals or
// how to declare the command manually.
const CANDIDATE_KEYS = new Set(
  ['command', 'script', 'cwd', 'source', 'approved', 'unresolved']);

// Remediation text per discovery-layer cause code (emitted by
// resolvePackageManager in discovery/inspect.mjs). Every hint names the
// manual escape hatch verbatim: `verify add --command CMD`.
const UNRESOLVED_HINTS = {
  UNKNOWN_PACKAGE_MANAGER:
    'the declared packageManager is not one of npm, pnpm, yarn or bun; '
    + 'fix the packageManager field in the package.json at this cwd, '
    + 'or declare the command literally via verify add --command CMD',
  CONTRADICTORY_PM:
    'multiple lockfiles conflict and no packageManager field is set; '
    + 'declare packageManager in the package.json at this cwd or keep a '
    + 'single lockfile, or declare the command literally via verify add '
    + '--command CMD',
  PACKAGE_MANAGER_UNCONFIRMED:
    'no packageManager field and no lockfile at this cwd; add a '
    + 'packageManager field to its package.json or commit a lockfile '
    + '(npm, pnpm, yarn or bun), or declare the command literally via '
    + 'verify add --command CMD',
};
const UNRESOLVED_HINT_GENERIC =
  'the package manager could not be resolved; declare the command '
  + 'literally via verify add --command CMD, or fix the packageManager/'
  + 'lockfile signals and re-run verify discover';

function mapCandidates(rawCommands) {
  if (!Array.isArray(rawCommands)) {
    throw err('INVALID_VERIFY_INPUT', 'commands must be an array');
  }
  const candidates = [];
  const skipped = [];
  const seen = new Set();
  for (const raw of rawCommands) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)
        || Object.keys(raw).some((k) => !CANDIDATE_KEYS.has(k))) {
      skipped.push({ reason: 'invalid-candidate-shape' });
      continue;
    }
    if (raw.command === null) {
      const cause = typeof raw.unresolved === 'string'
          && raw.unresolved in UNRESOLVED_HINTS
        ? raw.unresolved : null;
      skipped.push({
        script: raw.script ?? null, cwd: raw.cwd ?? '.',
        source: raw.source ?? null, reason: 'unresolved-command',
        unresolved: cause,
        hint: cause !== null
          ? UNRESOLVED_HINTS[cause] : UNRESOLVED_HINT_GENERIC,
      });
      continue;
    }
    if (typeof raw.command !== 'string' || raw.command.trim() === '') {
      skipped.push({ reason: 'invalid-command' });
      continue;
    }
    let record;
    try {
      record = buildRecord({
        command: raw.command, cwd: raw.cwd, source: 'inferred',
        evidence: typeof raw.source === 'string' && raw.source !== ''
          ? raw.source : null,
        at: new Date().toISOString(),
      });
    } catch {
      skipped.push({
        command: raw.command, reason: 'rejected-command',
      });
      continue;
    }
    if (seen.has(record.id)) {
      skipped.push({ command: record.command, reason: 'duplicate' });
      continue;
    }
    seen.add(record.id);
    candidates.push(record);
  }
  return { candidates, skipped };
}

export function prepareImportCommands(ctx, options) {
  const opts = closedOptions(options, ['commands'], 'import options');
  const current = readStoreDoc(verifyStoreAbs(ctx));
  const { candidates, skipped } = mapCandidates(opts.commands);
  const fresh = [];
  const existing = [];
  for (const c of candidates) {
    if (current.commands.some((r) => r.id === c.id)) existing.push(c.id);
    else fresh.push(c);
  }
  if (current.commands.length + fresh.length > MAX_COMMANDS) {
    throw err('VERIFY_COMMAND_LIMIT',
      `verify store holds ${MAX_COMMANDS} commands`);
  }
  return {
    candidates: fresh, existing, skipped,
    file: filePreview(ctx, current, fresh.length > 0),
  };
}

export function applyImportCommands(ctx, options) {
  const opts = closedOptions(options, ['commands'], 'import options');
  return withStoreLock(ctx, (current) => {
    const { candidates, skipped } = mapCandidates(opts.commands);
    const fresh = [];
    const existing = [];
    for (const c of candidates) {
      if (current.commands.some((r) => r.id === c.id)) existing.push(c.id);
      else fresh.push(c);
    }
    if (current.commands.length + fresh.length > MAX_COMMANDS) {
      throw err('VERIFY_COMMAND_LIMIT',
        `verify store holds ${MAX_COMMANDS} commands`);
    }
    if (fresh.length === 0) {
      return { doc: null, result: { added: [], existing, skipped } };
    }
    return {
      doc: { schemaVersion: 1,
        commands: [...current.commands, ...fresh] },
      result: { added: fresh, existing, skipped },
    };
  });
}

// --- approve discovered (bulk) ----------------------------------------------

// ONE explicit operator action covering the discover -> approved flow.
// With options.commands (the same candidate shape `verify discover`
// consumes) the literal candidates are imported first — null/unresolved
// ones stay skipped, never stored — and every record they map to is
// approved in the same locked write. Without `commands` it approves
// every stored unapproved record with source 'inferred'; declared
// records are out of scope and still need `verify approve ID`.
function approveDiscoveredOptions(options) {
  const opts = closedOptions(
    options ?? {}, ['commands', 'all'], 'approve-discovered options');
  return { commands: opts.commands ?? null, all: opts.all === true };
}

// Shared planner for prepare/apply: returns {doc|null, result}. The
// result mirrors the import shape — {added, existing, skipped} — plus
// `approved` (records flipped by this call, `added` included) and
// `alreadyApproved` (in-scope ids that needed no change).
function planApproveDiscovered(current, commands, at) {
  const skipped = [];
  const existing = [];
  const fresh = [];
  let touched = null; // null means "every stored inferred record"
  if (commands !== null) {
    const mapped = mapCandidates(commands);
    skipped.push(...mapped.skipped);
    touched = new Set(mapped.candidates.map((c) => c.id));
    for (const c of mapped.candidates) {
      if (current.commands.some((r) => r.id === c.id)) existing.push(c.id);
      else fresh.push(c);
    }
    if (current.commands.length + fresh.length > MAX_COMMANDS) {
      throw err('VERIFY_COMMAND_LIMIT',
        `verify store holds ${MAX_COMMANDS} commands`);
    }
  }
  const freshIds = new Set(fresh.map((c) => c.id));
  const added = [];
  const approved = [];
  const alreadyApproved = [];
  const doc = {
    schemaVersion: 1,
    commands: [...current.commands, ...fresh].map((rec) => {
      const inScope = touched !== null
        ? touched.has(rec.id) : rec.source === 'inferred';
      if (!inScope) return rec;
      if (rec.approved) {
        alreadyApproved.push(rec.id);
        return rec;
      }
      const next = { ...rec, approved: true, approvedAt: at };
      approved.push(next);
      if (freshIds.has(rec.id)) added.push(next);
      return next;
    }),
  };
  return {
    doc: approved.length > 0 ? doc : null,
    result: { added, existing, skipped, approved, alreadyApproved,
      ...(approved.length > 0 ? {
        warning: `bulk approval: ${approved.length} inferred command(s) `
          + 'approved in one action; use `verify approve ID` for '
          + 'per-command review',
      } : {}) },
  };
}

export function prepareApproveDiscoveredCommands(ctx, options) {
  const { commands } = approveDiscoveredOptions(options);
  const current = readStoreDoc(verifyStoreAbs(ctx));
  const { doc, result } = planApproveDiscovered(
    current, commands, new Date().toISOString());
  return { ...result, file: filePreview(ctx, current, doc !== null) };
}

export function applyApproveDiscoveredCommands(ctx, options) {
  const { commands, all } = approveDiscoveredOptions(options);
  // The no-candidates form approves every stored inferred record blindly.
  // That blind bulk path requires an explicit `all` opt-in; reviewing
  // literal candidates first (`verify discover --approve`) needs none.
  if (commands === null && all !== true) {
    throw err('VERIFY_BULK_REQUIRES_ALL',
      'approve-discovered without candidates approves every stored '
      + 'inferred command; pass all:true (--all) to confirm, or review '
      + 'literal candidates via `verify discover --approve`');
  }
  return withStoreLock(ctx, (current) =>
    planApproveDiscovered(current, commands, new Date().toISOString()));
}

// --- bounded executor ------------------------------------------------------

function resolveCwd(ctx, cwd) {
  const abs = cwd === '.'
    ? ctx.projectRoot
    : resolveInside(ctx.projectRoot, cwd, 'command cwd');
  const st = lstatOrNull(abs);
  if (!st || !st.isDirectory() || st.isSymbolicLink()) {
    throw err('VERIFY_CWD_REJECTED',
      `command cwd is absent, a link or not a directory: ${cwd}`);
  }
  return abs;
}

function wrapSpawnError(e, exe) {
  if (e && e.code === 'ENOENT') {
    return err('VERIFY_EXEC_FAILED',
      `executable not found on PATH: ${exe}`);
  }
  if (e && e.code === 'EINVAL') {
    return err('VERIFY_EXEC_REJECTED',
      `executable was rejected; batch/shell shims are never run: ${exe}`);
  }
  return err('VERIFY_EXEC_FAILED',
    `cannot start '${exe}': ${e && e.message ? e.message : e}`);
}

function runOptions(input) {
  const opts = closedOptions(
    input, ['timeoutMs', 'maxOutputBytes'], 'run options');
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let maxOutputBytes = DEFAULT_MAX_OUTPUT;
  if (opts.timeoutMs !== undefined) {
    if (!Number.isInteger(opts.timeoutMs)
        || opts.timeoutMs < 1 || opts.timeoutMs > MAX_TIMEOUT_MS) {
      throw err('INVALID_VALUE',
        `timeoutMs must be an integer in 1..${MAX_TIMEOUT_MS}`);
    }
    timeoutMs = opts.timeoutMs;
  }
  if (opts.maxOutputBytes !== undefined) {
    if (!Number.isInteger(opts.maxOutputBytes)
        || opts.maxOutputBytes < 1 || opts.maxOutputBytes > MAX_OUTPUT_CAP) {
      throw err('INVALID_VALUE',
        `maxOutputBytes must be an integer in 1..${MAX_OUTPUT_CAP}`);
    }
    maxOutputBytes = opts.maxOutputBytes;
  }
  return { timeoutMs, maxOutputBytes };
}

// Executes ONE explicitly approved record. Refuses unapproved commands —
// declared and inferred alike — with a structured error. argv is passed
// to spawn verbatim: no shell string, no shell:true, no interpolation.
// Output capture is bounded; excess output is dropped, never buffered.
// Async contract: validation failures reject, they never throw sync.
export async function runVerifyCommand(ctx, id, options = {}) {
  const { timeoutMs, maxOutputBytes } = runOptions(options);
  const doc = readStoreDoc(verifyStoreAbs(ctx));
  const rec = findCommand(doc, id);
  if (rec.approved !== true) {
    throw err('VERIFY_COMMAND_NOT_APPROVED',
      `verify command '${id}' is not approved; ` +
      'approve it explicitly before running');
  }
  const cwdAbs = resolveCwd(ctx, rec.cwd);
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(rec.argv[0], rec.argv.slice(1), {
        cwd: cwdAbs,
        // Allowlisted env only: approved argv may exfiltrate whatever it
        // can read, so credential-bearing parent vars never reach it.
        env: controlledSpawnEnv(),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      reject(wrapSpawnError(e, rec.argv[0]));
      return;
    }
    let settled = false;
    let timedOut = false;
    let truncated = false;
    let outLen = 0;
    let errLen = 0;
    const outChunks = [];
    const errChunks = [];
    let killTimer = null;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      killTimer.unref?.();
    }, timeoutMs);
    timeout.unref?.();
    const push = (chunks, len, chunk) => {
      const room = maxOutputBytes - len;
      if (room <= 0) {
        truncated = true;
        return 0;
      }
      if (chunk.length > room) {
        truncated = true;
        chunks.push(chunk.subarray(0, room));
        return room;
      }
      chunks.push(chunk);
      return chunk.length;
    };
    child.stdout.on('data', (c) => { outLen += push(outChunks, outLen, c); });
    child.stderr.on('data', (c) => { errLen += push(errChunks, errLen, c); });
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      fn(value);
    };
    child.on('error', (e) => {
      finish(reject, wrapSpawnError(e, rec.argv[0]));
    });
    child.on('close', (code, signal) => {
      finish(resolve, {
        id: rec.id,
        command: rec.command,
        argv: [...rec.argv],
        cwd: rec.cwd,
        status: timedOut ? 'timeout' : (signal ? 'signal' : 'exit'),
        code,
        signal: signal ?? null,
        durationMs: Date.now() - started,
        truncated,
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
      });
    });
  });
}
