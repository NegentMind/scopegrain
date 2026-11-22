// SPDX-License-Identifier: Apache-2.0
// Versioned constitution (spec-kit constitution parity): the project's
// governing principles with semver versioning and change history.
// MAJOR = a principle removed or redefined incompatibly, MINOR = a new
// principle or material expansion, PATCH = clarification only. The bump
// must be declared and is checked against the stored history. Complexity
// tracking counts principles and gates so growth stays visible.

import fs from 'node:fs';
import { err } from './errors.mjs';
import { configRel, resolveInside } from './paths.mjs';
import { lstatOrNull, readFileLimited, decodeUtf8Strict } from './fsx.mjs';
import { loadLimits } from './policy.mjs';

const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const BUMPS = new Set(['major', 'minor', 'patch']);
const FILE_KEYS = new Set([
  'schemaVersion', 'version', 'principles', 'complexity', 'history',
  'createdAt', 'updatedAt',
]);

const rel = (ctx) => configRel(ctx, 'constitution.json');

function parseSemver(v) {
  const m = String(v).match(SEMVER_RE);
  if (!m) throw err('INVALID_VALUE', `version '${v}' is not semver x.y.z`);
  return v.split('.').map((n) => parseInt(n, 10));
}

function bumpOf(prev, next) {
  if (next[0] > prev[0]) return 'major';
  if (next[0] === prev[0] && next[1] > prev[1]) return 'minor';
  if (next.join('.') === prev.join('.')) return 'none';
  if (next[0] === prev[0] && next[1] === prev[1] && next[2] > prev[2]) {
    return 'patch';
  }
  return 'invalid';
}

const BUMP_RANK = { none: 0, patch: 1, minor: 2, major: 3 };

function validatePrinciples(ps) {
  if (!Array.isArray(ps) || ps.length === 0) {
    throw err('INVALID_VALUE', 'principles must be a non-empty array');
  }
  return ps.map((p, i) => {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) {
      throw err('INVALID_VALUE', `principles[${i}] must be an object`);
    }
    for (const k of Object.keys(p)) {
      if (!['id', 'title', 'statement'].includes(k)) {
        throw err('UNKNOWN_KEY', `principles[${i}] has unknown key '${k}'`);
      }
    }
    if (typeof p.id !== 'string' || !/^[A-Z][A-Z0-9-]{0,15}$/.test(p.id)
        || typeof p.title !== 'string' || p.title.trim() === ''
        || typeof p.statement !== 'string' || p.statement.trim() === '') {
      throw err('INVALID_VALUE',
        `principles[${i}] requires id (A-Z0-9-), title, statement`);
    }
    return { id: p.id, title: p.title, statement: p.statement };
  });
}

export function getConstitution(ctx) {
  const r = rel(ctx);
  const abs = resolveInside(ctx.projectRoot, r, 'constitution');
  const st = lstatOrNull(abs);
  if (!st) return null;
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('INVALID_PATH', `${r} is not a regular file`);
  }
  const l = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (l.exceeded) throw err('DOCUMENT_TOO_LARGE', r);
  const doc = JSON.parse(decodeUtf8Strict(l.content, 'MALFORMED', r));
  for (const k of Object.keys(doc)) {
    if (!FILE_KEYS.has(k)) {
      throw err('MALFORMED', `${r} has unknown key '${k}'`);
    }
  }
  return doc;
}

// input: {version, principles, bump, summary}
export function setConstitution(ctx, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_VALUE', 'constitution input must be an object');
  }
  for (const k of Object.keys(input)) {
    if (!['version', 'principles', 'bump', 'summary'].includes(k)) {
      throw err('UNKNOWN_KEY', `constitution input has unknown key '${k}'`);
    }
  }
  const next = parseSemver(input.version);
  if (!BUMPS.has(input.bump)) {
    throw err('INVALID_VALUE',
      `bump must be one of ${[...BUMPS].join(', ')}`);
  }
  const principles = validatePrinciples(input.principles);
  const prior = getConstitution(ctx);
  const history = prior ? [...prior.history] : [];
  if (prior) {
    const actual = bumpOf(parseSemver(prior.version), next);
    if (actual === 'invalid') {
      throw err('VERSION_INVALID',
        `version ${input.version} must exceed ${prior.version}`);
    }
    if (BUMP_RANK[actual] > BUMP_RANK[input.bump]) {
      throw err('VERSION_INVALID',
        `${input.version} implies a '${actual}' bump; declared '${input.bump}'`);
    }
    // Declared-bump coherence: removing or redefining a principle id is a
    // MAJOR change; a new id is at least MINOR.
    const removed = prior.principles.filter(
      (p) => !principles.some((n) => n.id === p.id));
    const added = principles.filter(
      (n) => !prior.principles.some((p) => p.id === n.id));
    if (removed.length > 0 && input.bump !== 'major') {
      throw err('VERSION_INVALID',
        `removing principle(s) ${removed.map((p) => p.id)} requires a major bump`);
    }
    if (added.length > 0 && input.bump === 'patch') {
      throw err('VERSION_INVALID',
        `adding principle(s) ${added.map((p) => p.id)} requires at least a minor bump`);
    }
  } else if (input.bump !== 'major' || input.version !== '1.0.0') {
    // Genesis is always 1.0.0 major — anything else implies prior history.
    throw err('VERSION_INVALID',
      'first constitution must declare version 1.0.0 with bump major');
  }
  const at = new Date().toISOString();
  history.push({
    version: input.version, bump: input.bump, at,
    summary: typeof input.summary === 'string' ? input.summary : '',
  });
  const doc = {
    schemaVersion: 1,
    version: input.version,
    principles,
    // Complexity tracking: visible growth metrics for review.
    complexity: {
      principles: principles.length,
      historyEntries: history.length,
      statementChars: principles
        .reduce((n, p) => n + p.statement.length, 0),
    },
    history,
    createdAt: prior ? prior.createdAt : at,
    updatedAt: at,
  };
  const abs = resolveInside(ctx.projectRoot, rel(ctx), 'constitution');
  const tmp = `${abs}.tmp-${process.pid}`;
  const dirAbs = ctx.configDir === '.' ? ctx.projectRoot
    : resolveInside(ctx.projectRoot, ctx.configDir, 'config dir');
  fs.mkdirSync(dirAbs, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', { flag: 'wx' });
  try { fs.renameSync(tmp, abs); }
  catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
  return doc;
}
