// SPDX-License-Identifier: Apache-2.0
// Host CLI discovery for `doctor`: reports whether each configured host's
// command-line binary is reachable. Detection is pure filesystem probing —
// PATH entries and well-known install locations — so the core stays free
// of child_process and network (same posture as every other doctor check).
// A missing CLI is informational, never a harness fault.

import fs from 'node:fs';
import path from 'node:path';
import { lstatOrNull } from './fsx.mjs';

// Known binary names per host; unknown hosts fall back to their own name.
const BINARIES = {
  claude: ['claude'],
  codex: ['codex'],
  opencode: ['opencode'],
  devin: ['devin'],
  antigravity: ['antigravity'],
  hermes: ['hermes'],
};

const WINDOWS_EXTS = ['.exe', '.cmd', '.bat', '.ps1'];
const MAX_PATH_DIRS = 64;
const MAX_DIR_ENTRIES = 2048;

function dirHas(dir, names, exts, stats) {
  try {
    const d = lstatOrNull(dir);
    if (!d || !d.isDirectory() || d.isSymbolicLink()) return false;
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch { return false; }
    if (entries.length > MAX_DIR_ENTRIES) {
      entries = entries.slice(0, MAX_DIR_ENTRIES);
    }
    const lowered = new Set(entries.map((e) => e.toLowerCase()));
    for (const n of names) {
      for (const cand of exts.map((x) => n + x).concat(n)) {
        if (lowered.has(cand.toLowerCase())) {
          const full = path.join(dir, cand);
          const st = stats ? lstatOrNull(full) : null;
          if (stats && (!st || st.isSymbolicLink() || !st.isFile())) {
            continue;
          }
          return true;
        }
      }
    }
  } catch { /* unreadable dir: EPERM/EACCES is "not found" */ }
  return false;
}

// Well-known install roots outside PATH (user-scoped, never written).
function knownDirs(home, platform) {
  const dirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
  ];
  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA
      || path.join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA
      || path.join(home, 'AppData', 'Roaming');
    dirs.push(path.join(roaming, 'npm'));
    dirs.push(path.join(local, 'Programs'));
  } else {
    dirs.push('/usr/local/bin', '/opt/homebrew/bin');
  }
  return dirs;
}

// env is injectable for tests: {PATH, HOME|USERPROFILE, platform}.
export function detectHostClis(hosts, env = {}) {
  const isWin = (env.platform ?? process.platform) === 'win32';
  const home = env.home ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
  const pathEnv = env.path ?? process.env.PATH ?? '';
  const exts = isWin ? WINDOWS_EXTS : [];
  const pathDirs = pathEnv.split(path.delimiter)
    .filter(Boolean).slice(0, MAX_PATH_DIRS);
  const extra = home ? knownDirs(home, env.platform ?? process.platform) : [];

  const out = {};
  for (const host of hosts) {
    const names = (BINARIES[host] ?? [host]).map((s) => s.toLowerCase());
    let where = null;
    for (const dir of [...pathDirs, ...extra]) {
      // Windows probes extension variants; POSIX only the bare name.
      if (dirHas(dir, names, exts, true)) { where = dir; break; }
    }
    out[host] = { found: where !== null, location: where };
  }
  return out;
}
