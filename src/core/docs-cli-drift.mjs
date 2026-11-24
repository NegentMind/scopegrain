// SPDX-License-Identifier: Apache-2.0
// docs <-> CLI surface drift input for doctor (warning-level). Compares
// the verbs project documentation presents as runnable commands against
// the real dispatch surface: the COMMANDS table in src/cli.mjs plus the
// catalog command ids and command aliases the dispatcher resolves.
//
// The verb table is extracted from the cli.mjs SOURCE TEXT: core cannot
// import cli.mjs (cli.mjs already imports core), doctor never spawns a
// process, and COMMANDS is not exported. The extractor is a scanner, not
// a regexp on the module: it brace-matches the object literal, skipping
// strings and comments, then reads only the depth-1 keys.
//
// Stale findings require an INVOCATION position (a bin/*.mjs path, a
// fenced line starting with the binary name, or an inline-code span
// starting with it). Bare verb-shaped spans (e.g. `capture create`) only
// earn "referenced" credit: prose mentions like `journal idle` or the
// `create|show` alternation are not command claims.
import path from 'node:path';
import {
  decodeUtf8Strict, lstatOrNull, readDirBounded, readFileLimited,
} from './fsx.mjs';
import { resolveInside } from './paths.mjs';
import { loadLimits } from './policy.mjs';

const COMMANDS_MARKER = 'const COMMANDS';
const MAX_DOC_FILES = 64;
const MAX_DIR_ENTRIES = 256;

// String scanner shared by the literal matcher and template interpolation.
// Backticks inside ${} are handled recursively; unterminated input simply
// consumes the rest of the source.
function skipQuoted(src, i) {
  const q = src[i];
  i += 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === q) return i + 1;
    if (q === '`' && c === '$' && src[i + 1] === '{') {
      i = skipInterpolation(src, i + 2);
      continue;
    }
    i += 1;
  }
  return i;
}

function skipInterpolation(src, i) {
  let depth = 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { i = skipQuoted(src, i); continue; }
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    i += 1;
  }
  return i;
}

const WS = /\s/;

function skipWs(src, i) {
  while (i < src.length && WS.test(src[i])) i += 1;
  return i;
}

// Extracts the top-level keys of `const COMMANDS = { ... };` from the
// cli.mjs source. Returns null when the marker or a balanced object
// cannot be found — the caller treats that as "surface unavailable".
export function extractCliVerbs(source) {
  const marker = source.indexOf(COMMANDS_MARKER);
  if (marker < 0) return null;
  const open = source.indexOf('{', marker);
  if (open < 0) return null;
  const verbs = [];
  let i = open + 1;
  let depth = 1;
  let expectKey = true;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '`') {
      if (expectKey && depth === 1 && c !== '`') {
        const end = skipQuoted(source, i);
        const j = skipWs(source, end);
        if (source[j] === ':') {
          verbs.push(source.slice(i + 1, end - 1));
          i = j + 1;
          expectKey = false;
          continue;
        }
      }
      i = skipQuoted(source, i);
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      const e = source.indexOf('\n', i);
      i = e < 0 ? source.length : e;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const e = source.indexOf('*/', i + 2);
      i = e < 0 ? source.length : e + 2;
      continue;
    }
    if (c === '{') { depth += 1; expectKey = false; i += 1; continue; }
    if (c === '}') { depth -= 1; i += 1; continue; }
    if (depth === 1) {
      if (c === ',') { expectKey = true; i += 1; continue; }
      if (expectKey && /[A-Za-z_$]/.test(c)) {
        const m = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
        const j = skipWs(source, i + m[0].length);
        if (source[j] === ':') {
          verbs.push(m[0]);
          i = j + 1;
          expectKey = false;
          continue;
        }
      }
    }
    i += 1;
  }
  return depth === 0 && verbs.length > 0 ? verbs : null;
}

const FLAG_TOKEN_RE = /--[A-Za-z][\w-]*/g;

export function extractCliFlags(source) {
  const flags = new Set();
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '`') {
      const end = skipQuoted(source, i);
      const closed = end > i + 1 && source[end - 1] === c;
      const body = source.slice(i + 1, closed ? end - 1 : end);
      for (const m of body.matchAll(FLAG_TOKEN_RE)) flags.add(m[0]);
      i = end;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      const e = source.indexOf('\n', i);
      i = e < 0 ? source.length : e;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const e = source.indexOf('*/', i + 2);
      i = e < 0 ? source.length : e + 2;
      continue;
    }
    i += 1;
  }
  return flags;
}

export function extractMcpToolNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/\bname:\s*'scopegrain_[\w]+'/g)) {
    names.add(m[0].slice(m[0].indexOf("'") + 1, -1));
  }
  return names;
}

// Catalog command entries and command aliases are dispatchable single-
// token verbs (e.g. 'pipeline', 'audit', 'plan-work') even though they do
// not appear in COMMANDS. Anything else is ignored.
export function catalogCommandVerbs(catalog) {
  const verbs = [];
  if (!catalog || !(catalog.byKey instanceof Map)) return verbs;
  for (const key of catalog.byKey.keys()) {
    if (typeof key === 'string' && key.startsWith('command/')) {
      verbs.push(key.slice('command/'.length));
    }
  }
  for (const a of catalog.aliases ?? []) {
    if (a && a.kind === 'command' && typeof a.id === 'string') {
      verbs.push(a.id);
    }
  }
  return verbs;
}

// README*.md at the root plus docs/*.md and docs/en/*.md, regular files
// only. Missing/unreadable directories contribute nothing (the check
// degrades to a graceful skip), and the total is bounded.
export function docFilesFor(projectRoot) {
  const files = [];
  const collect = (dirAbs, filter) => {
    const st = lstatOrNull(dirAbs);
    if (!st || !st.isDirectory() || st.isSymbolicLink()) return;
    let listing;
    try {
      listing = readDirBounded(dirAbs, MAX_DIR_ENTRIES);
    } catch {
      return;
    }
    for (const d of listing.entries) {
      if (d.isFile() && !d.isSymbolicLink() && filter(d.name)) {
        files.push(path.join(dirAbs, d.name));
      }
    }
  };
  collect(projectRoot, (n) => /^readme.*\.md$/i.test(n));
  for (const sub of ['docs', 'docs/en']) {
    try {
      collect(resolveInside(projectRoot, sub, 'docs directory'),
        (n) => n.toLowerCase().endsWith('.md'));
    } catch {
      // A linked or invalid docs directory is skipped, never fatal.
    }
  }
  return files.slice(0, MAX_DOC_FILES);
}

// --- scanning ------------------------------------------------------------

// `node ...bin/x.mjs` and `./bin/x.mjs` are invocations; a bare
// `bin/x.mjs` mention is a FILE reference (architecture tree listings),
// not a command claim.
const NODE_BIN_RE = /\bnode[ \t]+\S*bin[\\/]scopegrain\.mjs\b[ \t]+([^\n`]*)/g;
const DOT_BIN_RE = /^\.[\\/]bin[\\/]scopegrain\.mjs\b[ \t]+(.*)$/;
const SPAN_RE = /`([^`\n]+)`/g;
const SPAN_INVOKE_RE = /^scopegrain\s+(\S.*)$/;
// Pure-uppercase tokens (UUID, OPERATION, PATH) are doc placeholders, not
// command candidates; lowercase aliases like 'pipeline' keep matching.
const PLACEHOLDER_RE = /^[A-Z0-9_]+$/;
// Verbs start lowercase (incl. aliases like 'codeGraph'): a Capitalized
// first token is prose following a file reference, never a verb.
const VERB_START_RE = /^[a-z0-9]/;

function tokens(s) {
  return s.trim().split(/\s+/).filter(Boolean);
}

// Credits a real verb when a code span's longest verb prefix matches.
// Alternation notation expands here too (`task create|list` credits
// both) so an inline span cannot sink verbs into `undocumented`.
function creditSpan(span, verbs, referenced) {
  const tok = tokens(span);
  if (tok.length === 0) return;
  const second = tok.length >= 2 ? expandAlternates(tok[1]) : [null];
  for (const a of expandAlternates(tok[0])) {
    let paired = false;
    for (const b of second) {
      if (b !== null && verbs.has(`${a} ${b}`)) {
        referenced.add(`${a} ${b}`);
        paired = true;
      }
    }
    if (!paired && verbs.has(a)) referenced.add(a);
  }
}

// Alternation notation (`constitution show|set`, `x-activate|deactivate`)
// documents sibling verbs in one invocation: the left side is complete
// and each right part shares the left prefix up to the last separator
// ('-', '/', '.', '_') — 'show|set' -> ['show','set'],
// 'extension-activate|deactivate' -> ['extension-activate',
// 'extension-deactivate'].
function expandAlternates(word) {
  if (!word.includes('|')) return [word];
  const parts = word.split('|');
  const left = parts[0];
  const sep = Math.max(left.lastIndexOf('-'), left.lastIndexOf('/'),
    left.lastIndexOf('.'), left.lastIndexOf('_'));
  const prefix = sep >= 0 ? left.slice(0, sep + 1) : '';
  return [left, ...parts.slice(1)
    .map((p) => (prefix !== '' && p.startsWith(prefix) ? p : prefix + p))]
    .filter((s) => s !== '');
}

function creditInvocation(args, verbs, firstWords, referenced, stale) {
  const tok = tokens(args);
  if (tok.length === 0) return;
  const t1 = tok[0];
  if (!VERB_START_RE.test(t1) || t1.startsWith('-')
      || PLACEHOLDER_RE.test(t1)) return;
  const t1Alts = expandAlternates(t1);
  const t2Alts = (tok.length >= 2 && tok[1].includes('|'))
    ? expandAlternates(tok[1]) : [tok[1]];
  const candidates = [];
  for (const a of t1Alts) {
    for (const b of t2Alts) {
      candidates.push(
        firstWords.has(a) && b && !b.startsWith('-') ? `${a} ${b}` : a);
    }
  }
  for (const candidate of candidates) {
    if (verbs.has(candidate)) referenced.add(candidate);
    else stale.add(candidate);
  }
}

// Scans one markdown document. Returns the real verbs it references and
// the invoked-but-nonexistent verbs it documents.
export function scanDocText(text, verbs) {
  const referenced = new Set();
  const stale = new Set();
  const firstWords = new Set([...verbs]
    .filter((v) => v.includes(' ')).map((v) => v.split(' ')[0]));
  const invocations = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) { inFence = !inFence; continue; }
    for (const m of line.matchAll(NODE_BIN_RE)) invocations.push(m[1]);
    const dotBin = DOT_BIN_RE.exec(trimmed);
    if (dotBin) invocations.push(dotBin[1]);
    for (const m of line.matchAll(SPAN_RE)) {
      const span = m[1].trim();
      const invoke = SPAN_INVOKE_RE.exec(span);
      if (invoke) { invocations.push(invoke[1]); continue; }
      creditSpan(span, verbs, referenced);
    }
    if (inFence) {
      const bare = SPAN_INVOKE_RE.exec(trimmed);
      if (bare) invocations.push(bare[1]);
    }
  }
  for (const args of invocations) {
    creditInvocation(args, verbs, firstWords, referenced, stale);
  }
  return { referenced, stale };
}

const COUNT_RE = /\b(\d{1,3})[ \t]+(tools?|herramientas?|verbos?|verbs?|comandos?|commands?|skills?|reglas?|rules?|agentes?|agents?|referencias?|references?)\b/gi;
const FOREIGN_CLI_RE = /\b(npm|npx|pnpm|yarn|bun|git|node|deno|docker|kubectl|cargo|pipx?|python3?|vantadb|ollama)\b/i;
const CATALOG_LINE_RE = /resources|cat[aá]log/i;
const CLI_LINE_RE = /\bcli\b|scopegrain|superficie|surface/i;
const MCP_LINE_RE = /\bmcp\b|scopegrain_/i;
const RESOURCE_UNIT = {
  skill: 'skill', skills: 'skill',
  regla: 'rule', reglas: 'rule', rule: 'rule', rules: 'rule',
  agente: 'agent', agentes: 'agent', agent: 'agent', agents: 'agent',
  referencia: 'reference', referencias: 'reference',
  reference: 'reference', references: 'reference',
};
const TOOL_UNIT = new Set(['tool', 'tools', 'herramienta', 'herramientas']);
const VERB_UNIT = new Set(['verbo', 'verbos', 'verb', 'verbs']);
const COMMAND_UNIT = new Set(['comando', 'comandos', 'command', 'commands']);

function flagNameOf(token) {
  const m = /^--[\w-]+/.exec(token);
  return m ? m[0] : null;
}

export function scanDocSurface(text) {
  const flags = new Map();
  const counts = [];
  const invocations = [];
  const noteFlag = (flag, via) => {
    if (flag === null) return;
    if (!flags.has(flag)) flags.set(flag, new Set());
    flags.get(flag).add(via);
  };
  let inFence = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) { inFence = !inFence; continue; }
    for (const m of line.matchAll(NODE_BIN_RE)) invocations.push(m[1]);
    const dotBin = DOT_BIN_RE.exec(trimmed);
    if (dotBin) invocations.push(dotBin[1]);
    for (const m of line.matchAll(SPAN_RE)) {
      const span = m[1].trim();
      const invoke = SPAN_INVOKE_RE.exec(span);
      if (invoke) { invocations.push(invoke[1]); continue; }
      const first = span.split(/\s+/)[0] || '';
      if (first.startsWith('--') && !FOREIGN_CLI_RE.test(trimmed)) {
        noteFlag(flagNameOf(first), 'span');
      }
    }
    if (inFence) {
      const bare = SPAN_INVOKE_RE.exec(trimmed);
      if (bare) invocations.push(bare[1]);
    }
    for (const m of line.matchAll(COUNT_RE)) {
      counts.push({
        n: Number(m[1]), unit: m[2].toLowerCase(), line: trimmed,
      });
    }
  }
  for (const args of invocations) {
    for (const t of tokens(args)) {
      if (t.startsWith('--')) noteFlag(flagNameOf(t), 'invoke');
    }
  }
  return { flags, counts };
}

export function headingSignature(text) {
  const levels = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,6})\s/.exec(line);
    if (m) levels.push(m[1].length);
  }
  return levels;
}

function listDocNames(projectRoot, sub) {
  const names = new Set();
  try {
    const dirAbs = resolveInside(projectRoot, sub, 'docs directory');
    const st = lstatOrNull(dirAbs);
    if (!st || !st.isDirectory() || st.isSymbolicLink()) return names;
    for (const d of readDirBounded(dirAbs, MAX_DIR_ENTRIES).entries) {
      if (d.isFile() && !d.isSymbolicLink()
          && d.name.toLowerCase().endsWith('.md')) {
        names.add(d.name);
      }
    }
  } catch {
    return names;
  }
  return names;
}

function levelDiff(esLevels, enLevels) {
  const tally = (arr) => {
    const m = new Map();
    for (const l of arr) m.set(l, (m.get(l) || 0) + 1);
    return m;
  };
  const es = tally(esLevels);
  const en = tally(enLevels);
  const diffs = [];
  for (const l of new Set([...es.keys(), ...en.keys()])) {
    const a = es.get(l) || 0;
    const b = en.get(l) || 0;
    if (a !== b) diffs.push(`h${l}: ${a} vs ${b}`);
  }
  return diffs.length > 0 ? diffs.join(', ') : null;
}

function catalogKindCounts(catalog) {
  const counts = {};
  if (!catalog || !(catalog.byKey instanceof Map)) return null;
  for (const key of catalog.byKey.keys()) {
    if (typeof key !== 'string') continue;
    const slash = key.indexOf('/');
    if (slash < 0) continue;
    const kind = key.slice(0, slash);
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}

function expectedFor(claim, surfaces) {
  const { unit, line } = claim;
  if (TOOL_UNIT.has(unit)) {
    return MCP_LINE_RE.test(line) ? surfaces.mcpTools : null;
  }
  if (VERB_UNIT.has(unit)) {
    return CLI_LINE_RE.test(line) ? surfaces.cliVerbs : null;
  }
  if (COMMAND_UNIT.has(unit)) {
    if (CATALOG_LINE_RE.test(line)) return surfaces.catalogCommands;
    return CLI_LINE_RE.test(line) ? surfaces.cliVerbs : null;
  }
  const kind = RESOURCE_UNIT[unit];
  if (kind && CATALOG_LINE_RE.test(line)) {
    return surfaces.resourceKinds ? surfaces.resourceKinds[kind] ?? null : null;
  }
  return null;
}

// --- doctor input --------------------------------------------------------

// Compares doc-referenced verbs with the real surface. `catalog` may be
// null; without it only canonical COMMANDS verbs are compared and alias
// usage in docs would be flagged stale, so callers pass the best catalog
// they have. A missing CLI source or an empty doc set skips the check.
export function checkDocsCliDrift({ projectRoot, installRoot, catalog = null }) {
  const cliAbs = path.join(installRoot, 'src', 'cli.mjs');
  const cliSt = lstatOrNull(cliAbs);
  let verbs = null;
  let cliFlags = new Set();
  if (cliSt && cliSt.isFile() && !cliSt.isSymbolicLink()) {
    try {
      const limited = readFileLimited(cliAbs, loadLimits().maxDocumentBytes);
      if (!limited.exceeded) {
        const source = decodeUtf8Strict(
          limited.content, 'MALFORMED_JSON', 'src/cli.mjs');
        verbs = extractCliVerbs(source);
        cliFlags = extractCliFlags(source);
      }
    } catch {
      verbs = null;
    }
  }
  let mcpTools = null;
  try {
    const mcpAbs = path.join(installRoot, 'src', 'mcp', 'server.mjs');
    const mcpSt = lstatOrNull(mcpAbs);
    if (mcpSt && mcpSt.isFile() && !mcpSt.isSymbolicLink()) {
      const limited = readFileLimited(mcpAbs, loadLimits().maxDocumentBytes);
      if (!limited.exceeded) {
        mcpTools = extractMcpToolNames(decodeUtf8Strict(
          limited.content, 'MALFORMED_JSON', 'src/mcp/server.mjs')).size;
      }
    }
  } catch {
    mcpTools = null;
  }
  const skipped = (detail) => ({
    ok: true, skipped: true, detail, stale: [], undocumented: [],
    scannedDocs: 0, flags: [], counts: [], parity: [],
  });
  if (verbs === null || verbs.length === 0) {
    return skipped('skipped: CLI verb table unavailable');
  }
  const verbSet = new Set(verbs);
  for (const v of catalogCommandVerbs(catalog)) verbSet.add(v);
  const docs = docFilesFor(projectRoot);
  if (docs.length === 0) {
    return skipped('skipped: no README/docs markdown found');
  }
  const kindCounts = catalogKindCounts(catalog);
  const surfaces = {
    cliVerbs: verbs.length,
    mcpTools,
    catalogCommands: kindCounts ? kindCounts.command ?? 0 : null,
    resourceKinds: kindCounts,
  };
  const referenced = new Set();
  const stale = new Set();
  const badFlags = new Map();
  const countFindings = [];
  const parity = [];
  const texts = new Map();
  for (const abs of docs) {
    let text;
    try {
      const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
      if (limited.exceeded) continue;
      text = decodeUtf8Strict(limited.content, 'MALFORMED_JSON', abs);
    } catch {
      continue; // unreadable docs degrade the scan, never the doctor
    }
    const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
    if (rel.startsWith('docs/')) texts.set(rel, text);
    const r = scanDocText(text, verbSet);
    for (const v of r.referenced) referenced.add(v);
    for (const v of r.stale) stale.add(v);
    const s = scanDocSurface(text);
    for (const [flag, via] of s.flags) {
      if (cliFlags.has(flag)) continue;
      if (!badFlags.has(flag)) badFlags.set(flag, new Set());
      for (const v of via) badFlags.get(flag).add(v);
    }
    for (const claim of s.counts) {
      const expected = expectedFor(claim, surfaces);
      if (expected !== null && expected !== claim.n) {
        countFindings.push(
          `${rel}: claimed ${claim.n} ${claim.unit}, code has ${expected}`);
      }
    }
  }
  const esNames = listDocNames(projectRoot, 'docs');
  const enNames = listDocNames(projectRoot, 'docs/en');
  const textFor = (rel) => {
    if (texts.has(rel)) return texts.get(rel);
    try {
      const abs = resolveInside(projectRoot, rel, 'docs file');
      const st = lstatOrNull(abs);
      if (!st || !st.isFile() || st.isSymbolicLink()) return null;
      const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
      if (limited.exceeded) return null;
      return decodeUtf8Strict(limited.content, 'MALFORMED_JSON', rel);
    } catch {
      return null;
    }
  };
  for (const base of esNames) {
    if (!enNames.has(base)) {
      parity.push(`docs/${base}: no docs/en/${base} pair`);
      continue;
    }
    const esText = textFor(`docs/${base}`);
    const enText = textFor(`docs/en/${base}`);
    if (esText === null || enText === null) continue;
    const diff = levelDiff(headingSignature(esText), headingSignature(enText));
    if (diff !== null) {
      parity.push(`docs/${base} vs docs/en/${base}: ${diff}`);
    }
  }
  for (const base of enNames) {
    if (!esNames.has(base)) {
      parity.push(`docs/en/${base}: no docs/${base} pair`);
    }
  }
  const staleList = [...stale].sort();
  const undocumented = [...verbSet].filter((v) => !referenced.has(v)).sort();
  const flagList = [...badFlags.keys()].sort().map((f) => {
    const via = [...badFlags.get(f)].sort().join('+');
    return `${f}(${via})`;
  });
  const ok = staleList.length === 0 && undocumented.length === 0
    && flagList.length === 0 && countFindings.length === 0
    && parity.length === 0;
  const detail = ok ? `${docs.length} docs scanned; no drift` : [
    staleList.length > 0
      ? `documented-but-nonexistent: ${staleList.join(', ')}` : null,
    undocumented.length > 0
      ? `${undocumented.length} real verbs never referenced` : null,
    flagList.length > 0
      ? `flags without CLI literal: ${flagList.join(', ')}` : null,
    countFindings.length > 0
      ? `count drift: ${countFindings.join('; ')}` : null,
    parity.length > 0
      ? `es/en gaps: ${parity.join('; ')}` : null,
  ].filter(Boolean).join('; ');
  return {
    ok, detail, stale: staleList, undocumented, scannedDocs: docs.length,
    flags: flagList, counts: countFindings.sort(), parity: parity.sort(),
  };
}
