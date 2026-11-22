// SPDX-License-Identifier: Apache-2.0
// Dated clarification sessions (spec-kit /speckit.clarify parity):
// append-only Q&A sessions bound to a specification artifact. Each
// session is a create-only record under <configDir>/clarifications/
// <specId>/NNN.json with an ISO date — spec artifacts stay immutable,
// clarification history accumulates as auditable state.

import fs from 'node:fs';
import { err } from './errors.mjs';
import { configRel, resolveInside } from './paths.mjs';
import { lstatOrNull, readFileLimited, decodeUtf8Strict } from './fsx.mjs';
import { loadLimits } from './policy.mjs';
import { getSpecification } from './specifications.mjs';

const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const dirRel = (ctx, specId) =>
  `${configRel(ctx, 'clarifications')}/${specId.toLowerCase()}`;

// input: {specId, date?, entries:[{question, answer}]}
// Validates the input and builds the session record plus its target
// file — the CLI previews this without writing (create convention).
export function prepareClarification(ctx, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_VALUE', 'clarification input must be an object');
  }
  for (const k of Object.keys(input)) {
    if (!['specId', 'date', 'entries'].includes(k)) {
      throw err('UNKNOWN_KEY', `clarification input has unknown key '${k}'`);
    }
  }
  const spec = getSpecification(ctx, input.specId); // must bind a real spec
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(date)) {
    throw err('INVALID_VALUE', 'date must be YYYY-MM-DD');
  }
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    throw err('INVALID_VALUE', 'entries must be a non-empty array');
  }
  const entries = input.entries.map((e, i) => {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) {
      throw err('INVALID_VALUE', `entries[${i}] must be an object`);
    }
    for (const k of Object.keys(e)) {
      if (!['question', 'answer'].includes(k)) {
        throw err('UNKNOWN_KEY', `entries[${i}] has unknown key '${k}'`);
      }
    }
    if (typeof e.question !== 'string' || e.question.trim() === ''
        || typeof e.answer !== 'string' || e.answer.trim() === '') {
      throw err('INVALID_VALUE',
        `entries[${i}] requires non-empty question and answer`);
    }
    return { question: e.question, answer: e.answer };
  });
  const dir = dirRel(ctx, input.specId);
  const dirAbs = resolveInside(ctx.projectRoot, dir, 'clarifications dir');
  const st = lstatOrNull(dirAbs);
  if (st && (st.isSymbolicLink() || !st.isDirectory())) {
    throw err('INVALID_STATE', `${dir} is not a real directory`);
  }
  let max = 0;
  if (st) {
    for (const name of fs.readdirSync(dirAbs)) {
      const m = name.match(/^([0-9]{3})-/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  const seq = max + 1;
  const record = {
    schemaVersion: 1,
    specId: spec.id,
    session: seq,
    date,
    entries,
    createdAt: new Date().toISOString(),
  };
  const rel = `${dir}/${String(seq).padStart(3, '0')}-${date}.json`;
  return {
    record: Object.freeze({ ...record, record: rel }),
    file: {
      rel,
      abs: resolveInside(ctx.projectRoot, rel, 'clarification session'),
      content: JSON.stringify(record, null, 2) + '\n',
    },
  };
}

export function recordClarification(ctx, input) {
  const { record, file } = prepareClarification(ctx, input);
  const dirAbs = resolveInside(ctx.projectRoot,
    dirRel(ctx, input.specId), 'clarifications dir');
  fs.mkdirSync(dirAbs, { recursive: true });
  const fd = fs.openSync(file.abs, 'wx');
  try {
    fs.writeSync(fd, file.content);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  return record;
}

export function listClarifications(ctx, specId) {
  const dir = dirRel(ctx, specId);
  const dirAbs = resolveInside(ctx.projectRoot, dir, 'clarifications dir');
  const st = lstatOrNull(dirAbs);
  if (!st || !st.isDirectory() || st.isSymbolicLink()) return [];
  return fs.readdirSync(dirAbs).filter((n) => n.endsWith('.json')).sort()
    .map((n) => {
      const l = readFileLimited(
        `${dirAbs}/${n}`, loadLimits().maxDocumentBytes);
      if (l.exceeded) return null;
      try {
        return JSON.parse(decodeUtf8Strict(l.content, 'MALFORMED', n));
      } catch { return null; }
    }).filter(Boolean);
}
