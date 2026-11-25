// SPDX-License-Identifier: Apache-2.0
// Local rule store: owner-authored rules/local/*.md plus the journaled
// mutation verbs (propose/approve/archive). Propose stages a draft as
// Status:Proposed; approve/archive flip the lifecycle marker behind a
// declared --revision CAS plus, when a workspace is bound, the journal
// kernel's previousHash proof. Without a bound workspace the write falls
// back to temp+rename and the rules trail still records the mutation
// with journaled:false — the same convention as dist-registry. Only
// LOCAL overlay rules are mutable here: canonical and mounted rules are
// pinned resources whose bytes are sha256-verified at serve time.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { resolveInside, configRel, assertDestination } from './paths.mjs';
import { loadLimits } from './policy.mjs';
import { ID_RE, assertSafeId } from './identifiers.mjs';
import {
  lstatOrNull, readFileLimited, decodeUtf8Strict, mkdirpSync,
} from './fsx.mjs';
import { bindWorkspace, getWorkspace } from './workspaces.mjs';
import {
  applyJournaledCreation, applyJournaledRecordUpdate,
} from './journal.mjs';
import { loadWorkspaceCatalog, getResource } from './catalog.mjs';
import { parseRuleMeta, RULE_STATUSES } from './rule-meta.mjs';

const RULES_JOURNAL_REL = 'rules-journal.jsonl';
const RULES_JOURNAL_MAX = 4 * 1024 * 1024;
const LOCAL_DIR = 'rules/local';
const HEADER_LABELS = { active: 'Active', proposed: 'Proposed',
  archived: 'Archived' };

function sha256Buf(b) {
  return crypto.createHash('sha256').update(b).digest('hex');
}

function atomicWriteFile(abs, bytes) {
  mkdirpSync(path.dirname(abs));
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, bytes, { flag: 'wx' });
  try { fs.renameSync(tmp, abs); }
  catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
}

function localDirRel(ctx) {
  return configRel(ctx, LOCAL_DIR);
}

function localRuleRel(ctx, id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw err('INVALID_ID', `rule id must match ${ID_RE}: ${id}`);
  }
  // Reserved device names (con, nul, aux, com1...) pass ID_RE but
  // resolve to devices on Windows hosts.
  assertSafeId(id, 'rule id');
  return `${localDirRel(ctx)}/${id}.md`;
}

// ---- rules mutation trail -------------------------------------------------

// state/rules-journal.jsonl — bounded scan like the dist journal: the
// global last revision plus the per-rule count a --revision CAS asserts.
function rulesJournalPath(ctx) {
  const stateRel = assertDestination(ctx.config.paths.state,
    'paths.state');
  return resolveInside(ctx.projectRoot,
    `${stateRel}/${RULES_JOURNAL_REL}`, 'rules journal');
}

function rulesJournalState(ctx, id) {
  const abs = rulesJournalPath(ctx);
  const st = lstatOrNull(abs);
  const state = { last: 0, perRule: 0 };
  if (!st || !st.isFile() || st.isSymbolicLink()) return state;
  const l = readFileLimited(abs, RULES_JOURNAL_MAX * 2);
  if (l.exceeded) return state;
  for (const line of decodeUtf8Strict(l.content, 'MALFORMED',
    RULES_JOURNAL_REL).split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (Number.isSafeInteger(e?.revision) && e.revision > state.last) {
      state.last = e.revision;
    }
    if (e?.id === id && Number.isSafeInteger(e?.perRule)
        && e.perRule > state.perRule) {
      state.perRule = e.perRule;
    }
  }
  return state;
}

function rulesJournalAppend(ctx, entry, state) {
  const abs = rulesJournalPath(ctx);
  mkdirpSync(path.dirname(abs));
  const line = JSON.stringify(
    { revision: state.last + 1, ...entry }) + '\n';
  const st = lstatOrNull(abs);
  if (st && st.isFile() && !st.isSymbolicLink()
      && st.size + line.length > RULES_JOURNAL_MAX) {
    const l = readFileLimited(abs, RULES_JOURNAL_MAX * 2);
    if (!l.exceeded) {
      const lines = decodeUtf8Strict(l.content, 'MALFORMED',
        RULES_JOURNAL_REL).split('\n').filter((x) => x.trim());
      const keep = lines.slice(Math.floor(lines.length / 2));
      atomicWriteFile(abs, Buffer.from(keep.join('\n') + '\n', 'utf8'));
    }
  }
  fs.appendFileSync(abs, line);
}

// ---- journal plumbing -----------------------------------------------------

function tryBindRules(ctx) {
  try {
    const ws = getWorkspace(ctx);
    const areaIds = (ws.areas ?? []).map((a) => a.id);
    if (areaIds.length === 0) return null;
    return bindWorkspace(ctx, { areaIds });
  } catch {
    return null;
  }
}

// Commit rules/local/<id>.md. Bound workspace: the kernel enforces CAS
// (previousHash == current bytes) and emits events. Unbound: exclusive
// create or hash-checked temp+rename — the same fail-closed semantics.
function commitRuleFile(ctx, { id, rel, bytes, prevSha, perRule }) {
  const abs = resolveInside(ctx.projectRoot, rel, 'local rule');
  const bound = tryBindRules(ctx);
  let journaled = false;
  if (bound) {
    const change = {
      sourceKind: 'rule-local', recordId: id,
      areaIds: [...bound.areaIds],
      file: { rel, content: bytes },
    };
    if (prevSha === null) {
      applyJournaledCreation(bound,
        [{ ...change, sourceRevision: null }]);
    } else {
      applyJournaledRecordUpdate(bound, () => [{
        ...change, sourceRevision: perRule,
        previousHash: prevSha,
      }]);
    }
    journaled = true;
  } else if (prevSha === null) {
    if (lstatOrNull(abs)) {
      throw err('JOURNAL_SOURCE_CONFLICT',
        `local rule already exists: ${rel}`);
    }
    mkdirpSync(path.dirname(abs));
    fs.writeFileSync(abs, bytes, { flag: 'wx' });
  } else {
    const st = lstatOrNull(abs);
    if (!st || !st.isFile() || st.isSymbolicLink()
        || sha256Buf(fs.readFileSync(abs)) !== prevSha) {
      throw err('JOURNAL_SOURCE_CONFLICT',
        `local rule differs from its declared hash: ${rel}`);
    }
    atomicWriteFile(abs, bytes);
  }
  return { journaled };
}

// ---- status flips ---------------------------------------------------------

// Same first-match semantics as the parser's STATUS_HEADER_RE
// (unanchored, first occurrence): the marker the parser reads is the
// marker this rewrite flips — never a later blockquote.
const STATUS_MARKER_RE = /\*\*Status:\*\*\s*[A-Za-z][A-Za-z -]{0,29}/;

// Rewrite the lifecycle marker: frontmatter status: wins; else the first
// '**Status:**' occurrence (same scan as parseRuleMeta); else insert a
// '> **Status:**' header right after the first '# ' heading. The caller
// re-parses the product — any rewrite that would not flip the parsed
// status fails closed instead of reporting a lie.
export function setRuleStatus(bytes, status) {
  if (!RULE_STATUSES.has(status)) {
    throw err('RULE_META_MALFORMED', `unknown rule status: ${status}`);
  }
  const text = decodeUtf8Strict(bytes, 'RULE_META_MALFORMED', 'rule');
  // A BOM hides the fence from naive line scans just like it would from
  // the parser — strip for processing, preserve on output.
  const bom = text.startsWith('\uFEFF');
  const lines = (bom ? text.slice(1) : text).split('\n');
  let fenceEnd = -1;
  if (lines[0] === '---' || lines[0] === '---\r') {
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i] === '---' || lines[i] === '---\r') {
        fenceEnd = i; break;
      }
    }
  }
  if (fenceEnd > 0) {
    for (let i = 1; i < fenceEnd; i += 1) {
      if (/^status\s*:/.test(lines[i])) {
        lines[i] = `status: ${status}`
          + (lines[i].endsWith('\r') ? '\r' : '');
        return Buffer.from(
          (bom ? '\uFEFF' : '') + lines.join('\n'), 'utf8');
      }
    }
    // Frontmatter present but no status key: declare it inside the
    // block, preserving the file's line ending.
    lines.splice(fenceEnd, 0, `status: ${status}`
      + (lines[fenceEnd - 1]?.endsWith('\r') ? '\r' : ''));
    return Buffer.from((bom ? '\uFEFF' : '') + lines.join('\n'), 'utf8');
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (STATUS_MARKER_RE.test(lines[i])) {
      lines[i] = lines[i].replace(STATUS_MARKER_RE,
        `**Status:** ${HEADER_LABELS[status]}`);
      return Buffer.from(
        (bom ? '\uFEFF' : '') + lines.join('\n'), 'utf8');
    }
  }
  const heading = lines.findIndex((l) => /^#\s/.test(l));
  lines.splice(heading === -1 ? 0 : heading + 1, 0,
    '', `> **Status:** ${HEADER_LABELS[status]}`);
  return Buffer.from((bom ? '\uFEFF' : '') + lines.join('\n'), 'utf8');
}

function statusOf(bytes) {
  return parseRuleMeta(decodeUtf8Strict(bytes,
    'RULE_META_MALFORMED', 'rule')).status;
}

function readBounded(abs, label) {
  const l = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (l.exceeded) {
    throw err('DOCUMENT_TOO_LARGE', `${label} exceeds document limit`);
  }
  return l.content;
}

function originOf(e) {
  return e.overlay === 'local' ? 'local'
    : e.bundle !== undefined ? 'mounted' : 'canonical';
}

// A proposed id must not collide with anything the catalog would merge:
// canonical/mounted entries live in byKey, rule aliases shadow too —
// persisting a collision would brick every catalog-loading command.
function assertNoCatalogCollision(cat, id) {
  const key = `rule/${id}`.toLowerCase();
  if (cat.byKey.has(key) || cat.aliases?.some(
    (a) => a.kind === 'rule' && a.id.toLowerCase() === key.slice(5))) {
    throw err('RULE_ALREADY_EXISTS',
      `rule ${key} already exists in the catalog`);
  }
}

// ---- reads ----------------------------------------------------------------

// Rule index across layers, resolved from the workspace catalog: each
// row carries id, lifecycle status (frontmatter/header/default), origin
// (canonical | mounted | local) and the served rel. Local overlay
// entries arrive via loadWorkspaceCatalog's merge.
export function listRules(ctx) {
  const cat = loadWorkspaceCatalog(ctx);
  const rows = [];
  for (const e of cat.entries.filter((x) => x.kind === 'rule')) {
    // getResource re-hashes pinned bytes at serve: drift fails closed
    // here exactly like everywhere else the catalog serves content.
    const r = getResource('rule', e.id, { catalog: cat });
    rows.push({ id: e.id, status: r.meta.status,
      origin: originOf(e), path: e.path });
  }
  return Object.freeze({ rules: Object.freeze(rows),
    localRules: cat.localRules ?? 0 });
}

export function showRule(ctx, id) {
  const cat = loadWorkspaceCatalog(ctx);
  let r;
  try {
    r = getResource('rule', id, { catalog: cat });
  } catch (e) {
    if (e.code === 'CATALOG_UNKNOWN_ID') {
      throw err('RULE_NOT_FOUND', `rule not found: ${id}`);
    }
    throw e;
  }
  const trail = rulesJournalState(ctx, r.canonicalId);
  return { id: r.canonicalId, path: r.path,
    content: r.content.toString('utf8'), status: r.meta.status,
    meta: r.meta, revision: trail.perRule,
    origin: originOf(r), resolvedVia: r.resolvedVia };
}

// ---- mutations ------------------------------------------------------------

function readInputFile(ctx, rel) {
  const abs = resolveInside(ctx.projectRoot, rel, 'rule input');
  const st = lstatOrNull(abs);
  if (!st || st.isSymbolicLink() || !st.isFile()) {
    throw err('INVALID_PATH', `rule input is not a regular file: ${rel}`);
  }
  const l = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (l.exceeded) {
    throw err('DOCUMENT_TOO_LARGE', `rule input exceeds limit: ${rel}`);
  }
  return l.content;
}

function proposeStem(options) {
  return options.id ?? path.basename(options.input)
    .replace(/\.md$/i, '');
}

// propose: stage a draft as rules/local/<id>.md with Status:Proposed.
// The id comes from --id or the input filename stem; lifecycle markers
// are normalized to proposed so the draft never enters packets.
function planPropose(ctx, options) {
  const stem = proposeStem(options);
  const rel = localRuleRel(ctx, stem);
  const input = readInputFile(ctx, options.input);
  const bytes = setRuleStatus(input, 'proposed');
  // The product must parse as a rule AND land proposed: a malformed
  // input (unclosed fence, bad keys) or a rewrite that would not flip
  // the effective status fails here, never on disk.
  if (statusOf(bytes) !== 'proposed') {
    throw err('RULE_META_MALFORMED',
      `input cannot be normalized to Status:Proposed: ${options.input}`);
  }
  if (lstatOrNull(resolveInside(ctx.projectRoot, rel, 'local rule'))) {
    throw err('RULE_ALREADY_EXISTS', `local rule exists: ${rel}`);
  }
  assertNoCatalogCollision(loadWorkspaceCatalog(ctx), stem);
  return { stem, rel, bytes };
}

export function prepareProposeRule(ctx, options) {
  const { stem, rel, bytes } = planPropose(ctx, options);
  return { mode: 'dry-run', applied: false, id: stem, rel,
    status: 'proposed', bytes: bytes.length };
}

export function applyProposeRule(ctx, options) {
  const { stem, rel, bytes } = planPropose(ctx, options);
  const state = rulesJournalState(ctx, stem);
  const abs = resolveInside(ctx.projectRoot, rel, 'local rule');
  // Propose is creation semantics: an existing overlay file is a
  // conflict, never an adoption or overwrite.
  if (lstatOrNull(abs)) {
    throw err('RULE_ALREADY_EXISTS', `local rule exists: ${rel}`);
  }
  const { journaled } = commitRuleFile(ctx,
    { id: stem, rel, bytes, prevSha: null, perRule: state.perRule });
  rulesJournalAppend(ctx, { at: new Date().toISOString(),
    op: 'propose', id: stem, rel, previousSha256: null,
    newSha256: sha256Buf(bytes), perRule: state.perRule + 1, journaled },
    state);
  return { mode: 'applied', applied: true, id: stem, rel,
    status: 'proposed', revision: state.perRule + 1, journaled };
}

// approve/archive: flip the lifecycle marker on a LOCAL rule only.
// --revision is the declared CAS on the per-rule mutation count; the
// kernel additionally proves previousHash when a workspace is bound.
function planFlip(ctx, id, options, target) {
  const rel = localRuleRel(ctx, id);
  const abs = resolveInside(ctx.projectRoot, rel, 'local rule');
  const st = lstatOrNull(abs);
  if (!st || st.isSymbolicLink() || !st.isFile()) {
    throw err('RULE_NOT_FOUND', `local rule not found: ${rel}`);
  }
  const bytes = readBounded(abs, `rule ${id}`);
  const current = statusOf(bytes);
  if (current === target
      || (target === 'active' && current !== 'proposed')) {
    throw err('RULE_STATUS_CONFLICT',
      target === 'active'
        ? `approve requires 'proposed', rule ${id} is '${current}'`
        : `rule ${id} is already '${target}'`);
  }
  const next = setRuleStatus(bytes, target);
  // Isomorphism guard: the rewrite must actually move the parsed
  // status — a marker the parser never reads (e.g. hidden behind a
  // BOM or an earlier prose mention) fails here instead of reporting
  // a flip that did not happen.
  if (statusOf(next) !== target) {
    throw err('RULE_META_MALFORMED',
      `cannot flip rule ${id} to '${target}': marker unwritable`);
  }
  const state = rulesJournalState(ctx, id);
  if (!Number.isSafeInteger(options.revision)
      || options.revision !== state.perRule) {
    throw err('RULE_REVISION_CONFLICT',
      `rule ${id} revision is ${state.perRule},`
      + ` declared ${options.revision}`);
  }
  return { id, rel, bytes: next, current, target,
    prevSha: sha256Buf(bytes), state };
}

export function prepareFlipRule(ctx, id, options, target) {
  const plan = planFlip(ctx, id, options, target);
  return { mode: 'dry-run', applied: false, id: plan.id,
    rel: plan.rel, from: plan.current, to: plan.target,
    revision: plan.state.perRule };
}

export function applyFlipRule(ctx, id, options, target) {
  const op = target === 'active' ? 'approve' : 'archive';
  const plan = planFlip(ctx, id, options, target);
  const { journaled } = commitRuleFile(ctx,
    { id: plan.id, rel: plan.rel, bytes: plan.bytes,
      prevSha: plan.prevSha, perRule: plan.state.perRule });
  rulesJournalAppend(ctx, { at: new Date().toISOString(), op,
    id: plan.id, rel: plan.rel, previousSha256: plan.prevSha,
    newSha256: sha256Buf(plan.bytes),
    perRule: plan.state.perRule + 1, journaled }, plan.state);
  return { mode: 'applied', applied: true, id: plan.id,
    rel: plan.rel, from: plan.current, to: plan.target,
    revision: plan.state.perRule + 1, journaled };
}

// --- import: external instruction files -> local Proposed drafts ----
// Unidirectional by contract: reads a source file inside the project
// (AGENTS.md, .cursorrules, ...), segments it on markdown headings and
// stages each section as a Status:Proposed draft under rules/local/.
// Imported text is data — never executed, never written back to the
// source. Re-import is idempotent: identical bytes are deduped by
// sha256 against existing local rules.

const IMPORT_MAX_SECTIONS = 32;
const IMPORT_HEADING_RE = /^(#{1,4})\s+(.+?)\s*$/;
const IMPORT_FENCE_RE = /^```/;

function importSlug(title, fallbackStem) {
  // NFKD strips accents to ascii so 'Estándares' -> 'estandares'.
  let s = (title ?? fallbackStem).normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 58)
    .replace(/-+$/g, '');
  if (!ID_RE.test(s)) s = `rule-${s}`.replace(/-+$/, '');
  if (!ID_RE.test(s)) s = 'rule-imported';
  try {
    assertSafeId(s, 'rule id');
  } catch {
    // A device-name stem (con, aux, ...) gets a safe prefix instead of
    // aborting the whole import.
    s = `rule-${s}`;
  }
  return s;
}

function segmentImportSource(text) {
  const sections = [];
  let cur = null;
  const flush = () => {
    if (cur === null) return;
    const body = cur.lines.join('\n').trim();
    if (body !== '') sections.push({ title: cur.title, body });
    cur = null;
  };
  let inFence = false;
  for (const raw of text.split('\n')) {
    const ln = raw.replace(/\r$/, '');
    // A '# comment' inside a fenced block is code, not a heading.
    if (IMPORT_FENCE_RE.test(ln)) inFence = !inFence;
    const m = inFence ? null : IMPORT_HEADING_RE.exec(ln);
    if (m) {
      flush();
      cur = { title: m[2].replace(/#+\s*$/, '').trim() || null,
        lines: [ln] };
    } else if (cur !== null) {
      cur.lines.push(ln);
    } else if (ln.trim() !== '') {
      cur = { title: null, lines: [ln] };
    }
  }
  flush();
  if (sections.length === 0) {
    throw err('INVALID_VALUE', 'import source has no content');
  }
  if (sections.length > IMPORT_MAX_SECTIONS) {
    throw err('INVALID_VALUE',
      `import segments into ${sections.length} sections`
      + ` — the cap is ${IMPORT_MAX_SECTIONS}`);
  }
  return sections;
}

function localRuleHashes(ctx) {
  const dir = resolveInside(ctx.projectRoot, localDirRel(ctx),
    'local rules');
  const st = lstatOrNull(dir);
  const hashes = new Map(); // sha256 -> rule id (for skip reporting)
  if (!st || !st.isDirectory()) return hashes;
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    const f = lstatOrNull(path.join(dir, name));
    if (!f || !f.isFile() || f.isSymbolicLink()) continue;
    try {
      hashes.set(sha256Buf(readBounded(path.join(dir, name), name)),
        name.replace(/\.md$/i, ''));
    } catch { /* unreadable overlay files never dedupe imports */ }
  }
  return hashes;
}

// planImport resolves sections -> {create, skipped} without writing.
// 'unchanged' means byte-identical content already lives in the
// overlay; 'conflict' means the id is taken by different content or
// collides with a catalog id — imports never overwrite.
function planImport(ctx, options) {
  const text = decodeUtf8Strict(readInputFile(ctx, options.from))
    .replace(/^\uFEFF/, ''); // BOM would hide a first-line heading
  // path.parse keeps dotfile stems: '.cursorrules' -> '.cursorrules'
  // (basename+regex would strip the whole name as an 'extension').
  const fallbackStem = path.parse(options.from).name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'imported';
  const sections = segmentImportSource(text);
  const cat = loadWorkspaceCatalog(ctx);
  const hashes = localRuleHashes(ctx);
  const taken = new Set();
  const create = [];
  const skipped = [];
  for (const sec of sections) {
    const bytes = Buffer.concat([
      Buffer.from('---\nstatus: proposed\norigin.source: imported\n'
        + '---\n\n', 'utf8'),
      Buffer.from(`${sec.body}\n`, 'utf8'),
    ]);
    const hash = sha256Buf(bytes);
    if (hashes.has(hash)) {
      skipped.push({ id: hashes.get(hash), reason: 'unchanged' });
      continue;
    }
    // Suffix on the captured base — 'x-2-3' compounds and can overflow
    // the id cap; 'x-2', 'x-3' stays bounded and readable.
    const base = importSlug(sec.title, fallbackStem);
    let id = base;
    for (let n = 2; taken.has(id); n += 1) {
      id = `${base.slice(0, 58)}-${n}`;
    }
    taken.add(id);
    let rel;
    try {
      rel = localRuleRel(ctx, id);
    } catch {
      skipped.push({ id, reason: 'id not writable' });
      continue;
    }
    const exists =
      lstatOrNull(resolveInside(ctx.projectRoot, rel, 'local rule'))
        !== null;
    if (exists) {
      skipped.push({ id, reason: 'conflict' });
      continue;
    }
    try {
      assertNoCatalogCollision(cat, id);
    } catch {
      skipped.push({ id, reason: 'collides with catalog id' });
      continue;
    }
    if (statusOf(bytes) !== 'proposed') {
      skipped.push({ id, reason: 'cannot normalize to proposed' });
      continue;
    }
    create.push({ id, rel, bytes, hash, title: sec.title });
    hashes.set(hash, id);
  }
  return { from: options.from, sections: sections.length,
    create, skipped };
}

export function prepareImportRules(ctx, options) {
  const plan = planImport(ctx, options);
  return { mode: 'dry-run', applied: false, from: plan.from,
    sections: plan.sections,
    create: plan.create.map((c) => ({ id: c.id, rel: c.rel })),
    skipped: plan.skipped };
}

export function applyImportRules(ctx, options) {
  const plan = planImport(ctx, options);
  const created = [];
  for (const c of plan.create) {
    // The slot may have filled between plan and apply — skip it
    // rather than overwrite.
    if (lstatOrNull(
      resolveInside(ctx.projectRoot, c.rel, 'local rule')) !== null) {
      plan.skipped.push({ id: c.id, reason: 'conflict' });
      continue;
    }
    const state = rulesJournalState(ctx, c.id);
    const { journaled } = commitRuleFile(ctx,
      { id: c.id, rel: c.rel, bytes: c.bytes,
        prevSha: null, perRule: state.perRule });
    rulesJournalAppend(ctx, { at: new Date().toISOString(), op: 'import',
      id: c.id, rel: c.rel, previousSha256: null,
      newSha256: c.hash, perRule: state.perRule + 1, journaled }, state);
    created.push({ id: c.id, rel: c.rel,
      revision: state.perRule + 1, journaled });
  }
  return { mode: 'applied', applied: true, from: plan.from,
    sections: plan.sections, created, skipped: plan.skipped };
}
