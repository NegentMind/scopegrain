// SPDX-License-Identifier: Apache-2.0
// Declarative command hooks (spec-kit before_/after_ parity): policy file
// policy/hooks.json declares advisory hooks projected to hosts inside the
// workflow packet. Hooks are data — descriptions of pre/post actions a
// host may honor; the harness never executes them, matching the
// non-executing posture of command bodies.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { err } from './errors.mjs';
import { decodeUtf8Strict, readFileLimited } from './fsx.mjs';

const INSTALL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../..');
const POLICY_REL = 'policy/hooks.json';
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PHASES = new Set(['before', 'after']);

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
  if (installRoot === INSTALL_ROOT) cached = out;
  return out;
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
