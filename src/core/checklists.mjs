// SPDX-License-Identifier: Apache-2.0
// Reviewer-owned requirement checklists (spec-kit CHK### parity): a named
// list of verification items bound to a task. Items are CHK001-indexed,
// carry pass/fail/na verdicts, and their open/failed items surface as
// convergence findings. Records live under <configDir>/checklists/ and are
// updated through read-validate-CAS-rewrite, like task meta updates.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { resolveInside } from './paths.mjs';
import { lstatOrNull, readFileLimited, decodeUtf8Strict } from './fsx.mjs';
import { loadLimits } from './policy.mjs';
import { getTask } from './tasks.mjs';

const ITEM_STATUSES = new Set(['pending', 'pass', 'fail', 'na']);
const CHK_RE = /^CHK[0-9]{3}$/;

const dirRel = (ctx) =>
  (ctx.configDir === '.' ? 'checklists' : `${ctx.configDir}/checklists`);
const fileRel = (ctx, id) => `${dirRel(ctx)}/${id.toLowerCase()}.json`;

function closed(obj, keys, label) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw err('INVALID_VALUE', `${label} must be an object`);
  }
  for (const k of Object.keys(obj)) {
    if (!keys.has(k)) {
      throw err('UNKNOWN_KEY', `${label} has unknown key '${k}'`);
    }
  }
}

function validateChecklist(c, label) {
  closed(c, new Set(['schemaVersion', 'id', 'taskId', 'title', 'items',
    'revision', 'createdAt', 'updatedAt']), label);
  if (c.schemaVersion !== 1) throw err('MALFORMED', `${label} schemaVersion`);
  if (!Array.isArray(c.items)) {
    throw err('MALFORMED', `${label}.items must be an array`);
  }
  const seen = new Set();
  c.items.forEach((it, i) => {
    closed(it, new Set(['id', 'text', 'status', 'note']),
      `${label}.items[${i}]`);
    if (!CHK_RE.test(it.id)) {
      throw err('MALFORMED', `${label}.items[${i}].id must be CHK###`);
    }
    if (seen.has(it.id)) throw err('MALFORMED', `duplicate ${it.id}`);
    seen.add(it.id);
    if (!ITEM_STATUSES.has(it.status)) {
      throw err('MALFORMED', `${label}.items[${i}].status '${it.status}'`);
    }
  });
  return c;
}

export function getChecklist(ctx, id) {
  const rel = fileRel(ctx, id);
  const abs = resolveInside(ctx.projectRoot, rel, 'checklist');
  const st = lstatOrNull(abs);
  if (!st) throw err('NOT_FOUND', `checklist ${id} not found`);
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('INVALID_PATH', `${rel} is not a regular file`);
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) throw err('DOCUMENT_TOO_LARGE', rel);
  let doc;
  try { doc = JSON.parse(decodeUtf8Strict(limited.content, 'MALFORMED', rel)); }
  catch (e) { throw e.code ? e : err('MALFORMED', `${rel}: ${e.message}`); }
  return validateChecklist(doc, `checklist ${id}`);
}

export function listChecklists(ctx, taskId = null) {
  const abs = resolveInside(ctx.projectRoot, dirRel(ctx), 'checklists');
  const st = lstatOrNull(abs);
  if (!st || !st.isDirectory() || st.isSymbolicLink()) return [];
  return fs.readdirSync(abs).filter((n) => n.endsWith('.json'))
    .map((n) => {
      try { return getChecklist(ctx, n.slice(0, -5)); } catch { return null; }
    })
    .filter(Boolean)
    .filter((c) => taskId === null || c.taskId === taskId);
}

// input: {taskId, title, items:[{text} | {id,text,status,note}]}
// Validates the input and builds the checklist record plus its target
// file — the CLI previews this without writing (create convention).
export function prepareChecklist(ctx, input) {
  closed(input, new Set(['taskId', 'title', 'items']), 'checklist input');
  if (typeof input.title !== 'string' || input.title.trim() === '') {
    throw err('INVALID_VALUE', 'checklist title must be non-empty');
  }
  getTask(ctx, input.taskId); // binding must name a real task
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw err('INVALID_VALUE', 'checklist requires at least one item');
  }
  const at = new Date().toISOString();
  const record = validateChecklist({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    taskId: input.taskId,
    title: input.title,
    items: input.items.map((it, i) => ({
      id: `CHK${String(i + 1).padStart(3, '0')}`,
      text: requireText(it.text, `items[${i}].text`),
      status: it.status ?? 'pending',
      note: it.note ?? null,
    })),
    revision: 0,
    createdAt: at,
    updatedAt: at,
  }, 'prepared checklist');
  const rel = fileRel(ctx, record.id);
  return {
    record,
    file: {
      rel,
      abs: resolveInside(ctx.projectRoot, rel, 'checklist'),
      content: JSON.stringify(record, null, 2) + '\n',
    },
  };
}

export function createChecklist(ctx, input) {
  const { record, file } = prepareChecklist(ctx, input);
  fs.mkdirSync(resolveInside(
    ctx.projectRoot, dirRel(ctx), 'checklists'), { recursive: true });
  const fd = fs.openSync(file.abs, 'wx');
  try {
    fs.writeSync(fd, file.content);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  return record;
}

function requireText(v, label) {
  if (typeof v !== 'string' || v.trim() === '') {
    throw err('INVALID_VALUE', `${label} must be non-empty`);
  }
  return v;
}

// CAS update: expectedRevision guards the rewrite; reviewer-owned means a
// human marks items, the harness only enforces shape and atomicity.
export function markChecklistItem(ctx, id, chkId,
    { status, note, expectedRevision }) {
  const c = getChecklist(ctx, id);
  if (expectedRevision !== undefined && expectedRevision !== c.revision) {
    throw err('REVISION_MISMATCH',
      `checklist revision ${c.revision}, expected ${expectedRevision}`);
  }
  const item = c.items.find((i) => i.id === chkId);
  if (!item) throw err('NOT_FOUND', `no item ${chkId} in checklist ${id}`);
  if (!ITEM_STATUSES.has(status)) {
    throw err('INVALID_VALUE', `status must be one of ${[...ITEM_STATUSES]}`);
  }
  item.status = status;
  if (note !== undefined) item.note = note;
  c.revision += 1;
  c.updatedAt = new Date().toISOString();
  const abs = resolveInside(ctx.projectRoot, fileRel(ctx, id), 'checklist');
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2) + '\n', { flag: 'wx' });
  try { fs.renameSync(tmp, abs); }
  catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
  return c;
}

// Gate surface for converge/methodology: open and failed items on any
// checklist bound to the task. Read-only, never throws on absent dir.
export function checklistFindings(ctx, taskId) {
  const findings = [];
  for (const c of listChecklists(ctx, taskId)) {
    for (const it of c.items) {
      if (it.status === 'fail') {
        findings.push({ code: 'CHECKLIST_FAIL', severity: 'blocking',
          detail: `${c.title} ${it.id} failed: ${it.text}` });
      } else if (it.status === 'pending') {
        findings.push({ code: 'CHECKLIST_OPEN', severity: 'major',
          detail: `${c.title} ${it.id} pending: ${it.text}` });
      }
    }
  }
  return findings;
}
