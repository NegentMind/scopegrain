// SPDX-License-Identifier: Apache-2.0
// Declarative command hooks (spec-kit before_/after_ parity): policy file
// policy/hooks.json declares advisory hooks projected to hosts inside the
// workflow packet. Hooks are data — descriptions of pre/post actions a
// host may honor; the harness never executes them, matching the
// non-executing posture of command bodies.
//
// The optional `preAction` list is the bounded EXECUTABLE layer: closed
// `when` conditions over task metadata evaluated by the runtime inside
// evaluateTaskActions, with effects limited to a declared enum —
//   block        action removed from permitted (enforced deny)
//   require-gate action stays permitted but is flagged on `gated`
//                (advisory: the host must obtain approval before using it)
//   record       audit annotation only — no restriction
// Never argv, never scripts: conditions and effects are data.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { err } from './errors.mjs';
import { DATA_CLASSIFICATIONS } from './tasks.mjs';
import { decodeUtf8Strict, lstatOrNull, mkdirpSync, readFileLimited,
  removeIfExists } from './fsx.mjs';
import { acquireVerifiedLock, releaseVerifiedLock } from './locks.mjs';

const INSTALL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../..');
const POLICY_REL = 'policy/hooks.json';
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PHASES = new Set(['before', 'after']);
const PRE_ACTION_EFFECTS = new Set(['block', 'require-gate', 'record']);
const PRE_ACTION_WHEN_KEYS = new Set(
  ['action', 'stateIn', 'scopeOver', 'skillsMissing', 'scopeOverlapIn',
    'dataClassificationIn']);
const STATE_RE = /^[A-Z]+$/;

let cached = null;

// {before: {commandId|'*': [{id, description}]}, after: {...}} — missing
// file means no hooks (empty policy, not an error).
export function loadHooksPolicy({ installRoot = INSTALL_ROOT } = {}) {
  if (cached && installRoot === INSTALL_ROOT) return cached;
  const abs = path.join(installRoot, POLICY_REL);
  let doc = { schemaVersion: 1, hooks: {} };
  if (fs.existsSync(abs)) {
    const l = readFileLimited(abs, 65536);
    if (l.exceeded) throw err('POLICY_MALFORMED', `${POLICY_REL} too large`);
    doc = JSON.parse(decodeUtf8Strict(l.content, 'POLICY_MALFORMED', POLICY_REL));
  }
  if (doc === null || typeof doc !== 'object' || doc.schemaVersion !== 1
      || doc.hooks === null || typeof doc.hooks !== 'object'
      || Array.isArray(doc.hooks)) {
    throw err('POLICY_MALFORMED', `${POLICY_REL} has invalid shape`);
  }
  for (const k of Object.keys(doc)) {
    if (!['schemaVersion', 'hooks', 'preAction'].includes(k)) {
      throw err('POLICY_MALFORMED', `${POLICY_REL} has unknown key '${k}'`);
    }
  }
  const out = { before: {}, after: {} };
  for (const phase of Object.keys(doc.hooks)) {
    if (!PHASES.has(phase)) {
      throw err('POLICY_MALFORMED',
        `${POLICY_REL} has unknown hook phase '${phase}'`);
    }
    const byCmd = doc.hooks[phase];
    if (byCmd === null || typeof byCmd !== 'object' || Array.isArray(byCmd)) {
      throw err('POLICY_MALFORMED', `${POLICY_REL}.${phase} must be an object`);
    }
    for (const [cmd, list] of Object.entries(byCmd)) {
      if (cmd !== '*' && !ID_RE.test(cmd)) {
        throw err('POLICY_MALFORMED',
          `${POLICY_REL}.${phase} has invalid command key '${cmd}'`);
      }
      if (!Array.isArray(list)) {
        throw err('POLICY_MALFORMED',
          `${POLICY_REL}.${phase}.${cmd} must be an array`);
      }
      out[phase][cmd] = list.map((h, i) => {
        if (h === null || typeof h !== 'object' || Array.isArray(h)
            || typeof h.id !== 'string' || !ID_RE.test(h.id)
            || typeof h.description !== 'string') {
          throw err('POLICY_MALFORMED',
            `${POLICY_REL}.${phase}.${cmd}[${i}] requires {id, description}`);
        }
        for (const k of Object.keys(h)) {
          if (!['id', 'description', 'command'].includes(k)) {
            throw err('POLICY_MALFORMED',
              `${POLICY_REL}.${phase}.${cmd}[${i}] unknown key '${k}'`);
          }
        }
        return { id: h.id, description: h.description,
          ...(h.command !== undefined ? { command: h.command } : {}) };
      });
    }
  }
  // Optional bounded executable layer: declarative pre-action hooks.
  const preAction = [];
  if (doc.preAction !== undefined) {
    if (!Array.isArray(doc.preAction)) {
      throw err('POLICY_MALFORMED', `${POLICY_REL}.preAction must be an array`);
    }
    for (const [i, h] of doc.preAction.entries()) {
      const at = `${POLICY_REL}.preAction[${i}]`;
      if (h === null || typeof h !== 'object' || Array.isArray(h)) {
        throw err('POLICY_MALFORMED', `${at} must be an object`);
      }
      for (const k of Object.keys(h)) {
        if (!['id', 'when', 'then', 'reason'].includes(k)) {
          throw err('POLICY_MALFORMED', `${at} has unknown key '${k}'`);
        }
      }
      if (typeof h.id !== 'string' || !ID_RE.test(h.id)) {
        throw err('POLICY_MALFORMED', `${at} has invalid id`);
      }
      if (!PRE_ACTION_EFFECTS.has(h.then)) {
        throw err('POLICY_MALFORMED',
          `${at}.then must be one of ${[...PRE_ACTION_EFFECTS].join('|')}`);
      }
      if (h.reason !== undefined && typeof h.reason !== 'string') {
        throw err('POLICY_MALFORMED', `${at}.reason must be a string`);
      }
      const w = h.when;
      if (w === null || typeof w !== 'object' || Array.isArray(w)) {
        throw err('POLICY_MALFORMED', `${at}.when must be an object`);
      }
      for (const k of Object.keys(w)) {
        if (!PRE_ACTION_WHEN_KEYS.has(k)) {
          throw err('POLICY_MALFORMED',
            `${at}.when has unknown key '${k}'`);
        }
      }
      // Action names are policy-declared slugs (all current ones match
      // ID_RE); `*` is the wildcard. Reject anything else so a typo can
      // never silently widen or narrow a rule.
      if (typeof w.action !== 'string'
          || (w.action !== '*' && !ID_RE.test(w.action))) {
        throw err('POLICY_MALFORMED',
          `${at}.when.action must be '*' or an action-name slug`);
      }
      if (w.stateIn !== undefined
          && (!Array.isArray(w.stateIn) || w.stateIn.length === 0
            || !w.stateIn.every((s) => typeof s === 'string'
              && STATE_RE.test(s)))) {
        throw err('POLICY_MALFORMED',
          `${at}.when.stateIn must be a non-empty task-state array`);
      }
      if (w.scopeOver !== undefined
          && (!Number.isInteger(w.scopeOver) || w.scopeOver < 0)) {
        throw err('POLICY_MALFORMED',
          `${at}.when.scopeOver must be a non-negative integer`);
      }
      if (w.skillsMissing !== undefined
          && (!Array.isArray(w.skillsMissing)
            || !w.skillsMissing.every((s) => typeof s === 'string'
              && s.trim() !== ''))) {
        throw err('POLICY_MALFORMED',
          `${at}.when.skillsMissing must be a string array`);
      }
      if (w.scopeOverlapIn !== undefined
          && (!Array.isArray(w.scopeOverlapIn) || w.scopeOverlapIn.length === 0
            || !w.scopeOverlapIn.every((s) => typeof s === 'string'
              && STATE_RE.test(s)))) {
        throw err('POLICY_MALFORMED',
          `${at}.when.scopeOverlapIn must be a non-empty task-state array`);
      }
      if (w.dataClassificationIn !== undefined
          && (!Array.isArray(w.dataClassificationIn)
            || w.dataClassificationIn.length === 0
            || !w.dataClassificationIn.every(
              (s) => DATA_CLASSIFICATIONS.has(s)))) {
        throw err('POLICY_MALFORMED',
          `${at}.when.dataClassificationIn must be a non-empty array of public|internal|confidential|pii`);
      }
      preAction.push({ id: h.id, when: w, then: h.then,
        reason: h.reason ?? null });
    }
  }
  const result = { ...out, preAction };
  if (installRoot === INSTALL_ROOT) cached = result;
  return result;
}

// Hooks applying to a command id: global '*' first, then command-specific.
export function hooksFor(commandId, { installRoot = INSTALL_ROOT } = {}) {
  const policy = loadHooksPolicy({ installRoot });
  const pick = (phase) => [
    ...(policy[phase]['*'] ?? []),
    ...(policy[phase][commandId] ?? []),
  ];
  return { before: pick('before'), after: pick('after') };
}

// Scope entries are canonical project-relative paths: they overlap when
// equal or one prefixes the other (directory containment).
function scopesOverlap(a, b) {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

// Returns null on no-match, or an object with the matched peer ids when
// the hook is scopeOverlapIn (empty for other conditions). `peers` is the
// caller-supplied cross-task view — [{id, state, scope}] — resolved where
// ctx exists (evaluateTaskActions); hooks-policy itself stays pure. A
// task or peer with an empty scope declares no write region and never
// overlaps; the task itself is excluded by id.
function preActionMatches(w, task, action, peers, classification) {
  if (w.action !== '*' && w.action !== action) return null;
  if (w.stateIn !== undefined && !w.stateIn.includes(task.state)) {
    return null;
  }
  if (w.scopeOver !== undefined
      && !(Array.isArray(task.scope) && task.scope.length > w.scopeOver)) {
    return null;
  }
  if (w.skillsMissing !== undefined) {
    const have = new Set(Array.isArray(task.skills) ? task.skills : []);
    if (!w.skillsMissing.some((s) => !have.has(s))) return null;
  }
  let conflicts;
  if (w.scopeOverlapIn !== undefined) {
    if (!Array.isArray(peers) || !Array.isArray(task.scope)
        || task.scope.length === 0) return null;
    conflicts = peers.filter((p) => p.id !== task.id
      && w.scopeOverlapIn.includes(p.state)
      && Array.isArray(p.scope) && p.scope.length > 0
      && task.scope.some((s) => p.scope.some((q) => scopesOverlap(s, q))))
      .map((p) => p.id);
    if (conflicts.length === 0) return null;
  }
  if (w.dataClassificationIn !== undefined
      && !w.dataClassificationIn.includes(classification)) {
    return null;
  }
  return { conflicts };
}

// Evaluates declarative pre-action hooks over the already-permitted
// action set. `block` prunes (real enforcement); `require-gate` flags;
// `record` annotates. Everything lands on the trace — never silent.
// `peers` feeds the cross-task `when.scopeOverlapIn` condition; callers
// without a peer view (no ctx) may omit it — those conditions then never
// match. Matched peer ids land on the applied entry as `with`.
export function applyPreActionHooks(task, permitted,
    { installRoot, peers, classification } = {}) {
  const hooks = loadHooksPolicy({ installRoot }).preAction;
  if (hooks.length === 0) {
    return { permitted: [...permitted], applied: [], gated: [] };
  }
  const kept = [];
  const applied = [];
  const gated = [];
  for (const action of permitted) {
    let drop = false;
    for (const h of hooks) {
      const match = preActionMatches(
        h.when, task, action, peers, classification);
      if (!match) continue;
      applied.push({ id: h.id, action, effect: h.then, reason: h.reason,
        ...(match.conflicts ? { with: match.conflicts } : {}) });
      if (h.then === 'block') drop = true;
      if (h.then === 'require-gate') {
        gated.push({ action, hook: h.id, reason: h.reason });
      }
    }
    if (!drop) kept.push(action);
  }
  return { permitted: kept, applied, gated };
}

// ---------------------------------------------------------------------------
// Declarative kill switch: `hooks halt` inserts a marked preAction rule
// (`id: scopegrain-halt`, `when:{action:'*'}`) that blocks or gates every
// action for every task; `hooks resume` removes it. Atomic write under a
// verified lock, idempotent, and it invalidates the policy cache so the
// next evaluation sees the change immediately.
const HALT_ID = 'scopegrain-halt';

// Raw read for the write path — tolerant by design (a kill switch must
// work even over a shape-invalid policy file; only unparseable JSON or a
// non-object document blocks it).
function readPolicyDoc(installRoot) {
  const abs = path.join(installRoot, POLICY_REL);
  const st = lstatOrNull(abs);
  if (!st) return { abs, doc: null };
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('POLICY_MALFORMED', `${POLICY_REL} is not a regular file`);
  }
  const l = readFileLimited(abs, 65536);
  if (l.exceeded) throw err('POLICY_MALFORMED', `${POLICY_REL} too large`);
  const doc = JSON.parse(
    decodeUtf8Strict(l.content, 'POLICY_MALFORMED', POLICY_REL));
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw err('POLICY_MALFORMED', `${POLICY_REL} must be an object`);
  }
  return { abs, doc };
}

function writePolicyDoc(abs, doc) {
  mkdirpSync(path.dirname(abs));
  const lock = acquireVerifiedLock(`${abs}.lock`, 'POLICY_LOCKED',
    `${POLICY_REL} is locked by another writer`);
  const tmpAbs = `${abs}.tmp.${crypto.randomBytes(8).toString('hex')}`;
  try {
    const payload = JSON.stringify(doc, null, 2) + '\n';
    if (Buffer.byteLength(payload, 'utf8') > 65536) {
      throw err('POLICY_MALFORMED', `${POLICY_REL} exceeds 64KiB`);
    }
    fs.writeFileSync(tmpAbs, payload, { flag: 'wx' });
    fs.renameSync(tmpAbs, abs);
    cached = null;
  } catch (e) {
    removeIfExists(tmpAbs);
    throw e;
  } finally {
    releaseVerifiedLock(lock);
  }
}

// effect: 'block' prunes every action (hard kill); 'require-gate' keeps
// them but flags every one (soft halt). Missing file -> canonical doc
// created. Idempotent: an identical halt rule is a noop.
export function setPolicyHalt({ installRoot = INSTALL_ROOT,
    effect = 'block', reason, apply = false } = {}) {
  if (!PRE_ACTION_EFFECTS.has(effect) || effect === 'record') {
    throw err('INVALID_VALUE', "halt effect must be 'block' or 'require-gate'");
  }
  const { abs, doc } = readPolicyDoc(installRoot);
  const preAction = Array.isArray(doc?.preAction) ? doc.preAction : [];
  const existing = preAction.find((h) => h && h.id === HALT_ID);
  const entry = {
    id: HALT_ID,
    when: { action: '*' },
    then: effect,
    reason: reason ?? 'declarative kill switch (hooks halt)',
  };
  const identical = existing !== undefined
    && existing.then === entry.then && existing.reason === entry.reason
    && existing.when?.action === '*';
  const halted = existing !== undefined;
  if (!apply) {
    return {
      mode: 'preview', halted, changed: !identical,
      entry, path: POLICY_REL,
    };
  }
  if (identical) {
    return {
      mode: 'applied', halted: true, changed: false,
      entry: existing, path: POLICY_REL,
    };
  }
  const next = {
    schemaVersion: 1, hooks: {}, ...doc,
    preAction: [...preAction.filter((h) => !h || h.id !== HALT_ID), entry],
  };
  writePolicyDoc(abs, next);
  return {
    mode: 'applied', halted: true, changed: true, entry, path: POLICY_REL,
  };
}

export function clearPolicyHalt({ installRoot = INSTALL_ROOT,
    apply = false } = {}) {
  const { abs, doc } = readPolicyDoc(installRoot);
  const preAction = Array.isArray(doc?.preAction) ? doc.preAction : [];
  const kept = preAction.filter((h) => !h || h.id !== HALT_ID);
  const changed = kept.length !== preAction.length;
  if (!apply) {
    return {
      mode: 'preview', halted: changed,
      changed, path: POLICY_REL,
    };
  }
  if (!changed) {
    return { mode: 'applied', halted: false, changed: false,
      path: POLICY_REL };
  }
  writePolicyDoc(abs, { schemaVersion: 1, hooks: {}, ...doc,
    preAction: kept });
  return { mode: 'applied', halted: false, changed: true,
    path: POLICY_REL };
}
