// SPDX-License-Identifier: Apache-2.0
// Source-tree stamp: a cheap fingerprint over the install's src/**/*.mjs
// files (relpath + mtime + size, hashed). Two consumers:
// - the `view` supervisor polls it to decide when to respawn the worker
//   thread holding the module graph;
// - `GET /api/health` compares the live stamp against the one captured at
//   process start to report `stale` — a manual (non-supervised) server
//   whose code changed under it.
// Stat-only, no file contents read: a stamp change means "the tree the
// running code was loaded from differs now" — edits, adds and deletes
// all move it. Deterministic: same tree -> same stamp.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { lstatOrNull } from '../core/fsx.mjs';

export const INSTALL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_REL = 'src';
const MAX_FILES = 4096;
const SKIP_DIRS = new Set(['node_modules', '.git']);

function walk(dirAbs, rel, out) {
  if (out.length >= MAX_FILES) return;
  let names;
  try {
    names = fs.readdirSync(dirAbs);
  } catch {
    return; // unreadable dir contributes nothing — never throws
  }
  for (const name of names) {
    if (out.length >= MAX_FILES) return;
    const childRel = rel === '' ? name : `${rel}/${name}`;
    const st = lstatOrNull(path.join(dirAbs, name));
    if (st === null || st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(path.join(dirAbs, name), childRel, out);
    } else if (st.isFile() && name.endsWith('.mjs')) {
      out.push(`${childRel}:${st.mtimeMs}:${st.size}`);
    }
  }
}

// Returns a sha256 over the sorted file tuples, plus the file count —
// a missing or empty src tree yields a stable empty-tree stamp rather
// than an error (packaged installs may ship no src).
export function srcStamp(installRoot = INSTALL_ROOT) {
  const out = [];
  walk(path.join(installRoot, SRC_REL), '', out);
  out.sort();
  const hash = crypto.createHash('sha256');
  for (const line of out) hash.update(`${line}\n`);
  return { stamp: hash.digest('hex'), files: out.length,
    truncated: out.length >= MAX_FILES };
}
