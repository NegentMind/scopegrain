// SPDX-License-Identifier: Apache-2.0
// CI guard (G5b): any diff under resources/ requires a strict semver
// bump of resources/manifest.json "version". PRs that touch resource
// content without bumping fail the verify lane.
//   node scripts/check-manifest-version.mjs --base origin/develop [--head HEAD]
// The decision core is pure and exported for tests; git is the only IO
// and stays at the edge (execFileSync, literal args, no shell).
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SEMVER_RE = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/;
const MANIFEST = 'resources/manifest.json';

export function semverCompare(a, b) {
  const pa = SEMVER_RE.exec(a ?? '');
  const pb = SEMVER_RE.exec(b ?? '');
  if (!pa || !pb) {
    throw new Error(`non-semver version: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Does the changed-path list touch the resource set at all?
export function resourcesChanged(changedPaths) {
  return changedPaths.some(
    (p) => p === 'resources' || p.startsWith('resources/'));
}

// The bump decision: resources/ changed => head version must be a
// semver strictly greater than base (a missing base version counts as
// '0.0.0', a missing head version fails outright).
export function evaluateBump({ changedPaths, baseVersion, headVersion }) {
  if (!resourcesChanged(changedPaths)) {
    return { ok: true, reason: 'no resources/ changes' };
  }
  if (headVersion === null || headVersion === undefined) {
    return { ok: false, reason:
      `${MANIFEST} lacks "version" — add a semver bump (resources/ changed)` };
  }
  if (semverCompare(headVersion, baseVersion ?? '0.0.0') <= 0) {
    return { ok: false, reason:
      `${MANIFEST} version ${headVersion} is not greater than base `
      + `${baseVersion ?? '(none)'} — bump required (resources/ changed)` };
  }
  return { ok: true,
    reason: `version ${baseVersion ?? '(none)'} -> ${headVersion}` };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function manifestVersionAt(ref) {
  try {
    const doc = JSON.parse(git(['show', `${ref}:${MANIFEST}`]));
    return typeof doc.version === 'string' ? doc.version : null;
  } catch {
    return null; // absent file or unreadable -> no version
  }
}

function main(argv) {
  const base = argv[argv.indexOf('--base') + 1] ?? null;
  if (base === null || base.startsWith('--')) {
    console.error('usage: check-manifest-version --base REF [--head REF]');
    return 2;
  }
  const headIdx = argv.indexOf('--head');
  const head = headIdx >= 0 ? argv[headIdx + 1] : 'HEAD';
  const changed = git(['diff', '--name-only', `${base}...${head}`,
    '--', 'resources']).split('\n').filter((p) => p !== '');
  const result = evaluateBump({
    changedPaths: changed,
    baseVersion: manifestVersionAt(base),
    headVersion: manifestVersionAt(head),
  });
  console.log(`manifest-version-guard: ${result.reason}`);
  return result.ok ? 0 : 1;
}

// Library import (tests) must not run main.
if (process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
