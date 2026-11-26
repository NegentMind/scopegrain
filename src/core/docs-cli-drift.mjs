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

// Bounded source-scanning helpers. They are deliberately not a JavaScript
// parser: unsupported or malformed syntax makes the caller surface unavailable
// instead of producing a confident but wrong count.
function skipWsAndComments(src, i) {
  for (;;) {
    const before = i;
    i = skipWs(src, i);
    if (src[i] === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      i = e < 0 ? src.length : e;
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? src.length : e + 2;
      continue;
    }
    if (i === before) return i;
  }
}

// Returns the index just after the balanced close for openChar at `open`,
// skipping quoted strings, template interpolations and comments. -1 means the
// literal could not be balanced within the bounded source.
function balancedEnd(src, open, openChar, closeChar) {
  if (src[open] !== openChar) return -1;
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipQuoted(src, i);
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      i = e < 0 ? src.length : e;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? src.length : e + 2;
      continue;
    }
    if (c === openChar) depth += 1;
    else if (c === closeChar) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}

// Skips one JavaScript value until its top-level comma (or the containing
// object's closing brace). Nested arrays/objects/call parentheses are balanced;
// strings and comments never count as delimiters.
function skipValue(src, i) {
  let curly = 0;
  let square = 0;
  let paren = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipQuoted(src, i);
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      i = e < 0 ? src.length : e;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? src.length : e + 2;
      continue;
    }
    if (c === ',' && curly === 0 && square === 0 && paren === 0) return i;
    if ((c === '}' || c === ')' || c === ']')
        && curly === 0 && square === 0 && paren === 0) return i;
    if (c === '{') curly += 1;
    else if (c === '[') square += 1;
    else if (c === '(') paren += 1;
    else if (c === '}') curly -= 1;
    else if (c === ']') square -= 1;
    else if (c === ')') paren -= 1;
    i += 1;
  }
  return i;
}

function readPropertyKey(src, i) {
  i = skipWsAndComments(src, i);
  const c = src[i];
  if (c === "'" || c === '"') {
    const end = skipQuoted(src, i);
    if (end > src.length || src[end - 1] !== c) return null;
    return { name: src.slice(i + 1, end - 1), end };
  }
  const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
  if (!m) return null;
  return { name: m[0], end: i + m[0].length };
}

// Finds a top-level `const NAME` outside comments and strings. A textual
// indexOf would accept decoys in examples or nested test fixtures before the
// real declaration.
function findConstDeclaration(src, name) {
  let i = 0;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipQuoted(src, i);
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      i = e < 0 ? src.length : e;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? src.length : e + 2;
      continue;
    }
    if (c === '{') { depth += 1; i += 1; continue; }
    if (c === '}') { depth = Math.max(0, depth - 1); i += 1; continue; }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      if (depth === 0 && m[0] === 'const') {
        const declarator = skipWsAndComments(src, i + m[0].length);
        const after = src[declarator + name.length];
        if (src.startsWith(name, declarator)
            && (after === undefined || !/[\w$]/.test(after))) {
          return i;
        }
      }
      i += m[0].length;
      continue;
    }
    i += 1;
  }
  return -1;
}

// Returns the first character of the initializer for `const NAME = ...`.
function constInitializerStart(src, name) {
  const marker = findConstDeclaration(src, name);
  if (marker < 0) return -1;
  const declarator = skipWsAndComments(src, marker + 'const'.length);
  if (!src.startsWith(name, declarator)) return -1;
  const cursor = skipWsAndComments(src, declarator + name.length);
  if (src[cursor] !== '=') return -1;
  return skipWsAndComments(src, cursor + 1);
}

// Reads the top-level properties of one balanced object literal. Spread,
// shorthand, methods or malformed properties return null: callers report the
// surface as unavailable rather than guessing a count.
function objectPropertyEntries(objectSrc) {
  const entries = [];
  let i = 1;
  while (i < objectSrc.length) {
    i = skipWsAndComments(objectSrc, i);
    if (i >= objectSrc.length) return null;
    if (objectSrc[i] === '}') return entries;
    if (objectSrc[i] === ',') { i += 1; continue; }
    const key = readPropertyKey(objectSrc, i);
    if (key === null) return null;
    const colon = skipWsAndComments(objectSrc, key.end);
    if (objectSrc[colon] !== ':') return null;
    const valueStart = skipWsAndComments(objectSrc, colon + 1);
    const valueEnd = skipValue(objectSrc, valueStart);
    if (valueEnd <= valueStart) return null;
    entries.push({ name: key.name, start: valueStart, end: valueEnd });
    i = valueEnd;
    if (objectSrc[i] === ',') i += 1;
  }
  return null;
}

function objectPropertyValueStart(objectSrc, wanted) {
  const entries = objectPropertyEntries(objectSrc);
  if (entries === null) return -1;
  return entries.find((entry) => entry.name === wanted)?.start ?? -1;
}

// Parses a simple string-literal array (`['api', 'tasks', ':id']`). The raw
// literal contents are sufficient for route display/counting; escapes are not
// evaluated because the extractor never executes the scanned source.
function parseStringArray(src, open) {
  const end = balancedEnd(src, open, '[', ']');
  if (end < 0) return null;
  const parts = [];
  let i = open + 1;
  while (i < end - 1) {
    i = skipWsAndComments(src, i);
    if (i >= end - 1) break;
    if (src[i] === ',') { i += 1; continue; }
    const q = src[i];
    if (q !== "'" && q !== '"') return null;
    const qEnd = skipQuoted(src, i);
    if (qEnd > end || src[qEnd - 1] !== q) return null;
    parts.push(src.slice(i + 1, qEnd - 1));
    i = skipWsAndComments(src, qEnd);
    if (src[i] === ',') { i += 1; continue; }
    if (i >= end - 1) break;
    return null;
  }
  return { parts, end };
}

function routePatternFromObject(objectSrc) {
  const start = objectPropertyValueStart(objectSrc, 'pattern');
  if (start < 0 || objectSrc[start] !== '[') return null;
  const parsed = parseStringArray(objectSrc, start);
  if (parsed === null || parsed.parts.length === 0) return null;
  return `/${parsed.parts.join('/')}`;
}

// Extracts the literal route patterns from `export const ROUTES = [ ... ]`
// in src/api/server.mjs. Core scans the source text instead of importing the
// API module: importing would reverse the core/API dependency direction and
// could eventually pull a server-side effect into doctor.
export function extractApiRoutes(source) {
  const open = constInitializerStart(source, 'ROUTES');
  if (open < 0) return null;
  if (source[open] !== '[') return null;
  const end = balancedEnd(source, open, '[', ']');
  if (end < 0) return null;
  const routes = [];
  let i = open + 1;
  while (i < end - 1) {
    i = skipWsAndComments(source, i);
    if (i >= end - 1) break;
    if (source[i] === ',') { i += 1; continue; }
    if (source[i] !== '{') return null;
    const objectEnd = balancedEnd(source, i, '{', '}');
    if (objectEnd < 0 || objectEnd > end) return null;
    const pattern = routePatternFromObject(source.slice(i, objectEnd));
    if (pattern === null) return null;
    routes.push(pattern);
    i = objectEnd;
  }
  return routes.length > 0 ? routes : null;
}

// Extracts the top-level keys of `const COMMANDS = { ... };` from the
// cli.mjs source. Returns null when the declaration or a balanced object
// cannot be found — the caller treats that as "surface unavailable".
export function extractCliVerbs(source) {
  const open = constInitializerStart(source, 'COMMANDS');
  if (open < 0 || source[open] !== '{') return null;
  const end = balancedEnd(source, open, '{', '}');
  if (end < 0) return null;
  const entries = objectPropertyEntries(source.slice(open, end));
  return entries !== null && entries.length > 0
    ? entries.map((entry) => entry.name) : null;
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
// capability-map.md is the project's surface inventory: unlike dated audits
// or migration notes, its counts claim the current CLI/MCP/API/catalog shape.
// This extended unit set is therefore scanned only for that document pair.
const CAPABILITY_COUNT_RE = new RegExp(
  '\\b(\\d{1,3})[ \\t]+(?:[A-Za-z-]+[ \\t]+)?('
  + 'tools?|herramientas?|verbos?|verbs?|comandos?|commands?|'
  + 'subcomandos?|subcommands?|skills?|reglas?|rules?|agentes?|agents?|'
  + 'referencias?|references?|prompts?|perfil(?:es)?|profiles?|mcp|'
  + 'rutas?|routes?|entradas?|entries|entry|alias(?:es)?'
  + ')\\b', 'gi');
const FOREIGN_CLI_RE = /\b(npm|npx|pnpm|yarn|bun|git|node|deno|docker|kubectl|cargo|pipx?|python3?|vantadb|ollama)\b/i;
const CATALOG_LINE_RE = /resources|cat[aá]log/i;
// capability-map wraps its resource inventory across two lines; the second
// line is anchored by `manifest.json` rather than repeating `resources/`.
const CAPABILITY_CATALOG_LINE_RE = /resources|cat[aá]log|manifest\.json/i;
const CLI_LINE_RE = /\bcli\b|scopegrain|superficie|surface/i;
const MCP_LINE_RE = /\bmcp\b|scopegrain_/i;
const API_LINE_RE = /\bapi\b|\/api\//i;
const RESOURCE_UNIT = {
  skill: 'skill', skills: 'skill',
  regla: 'rule', reglas: 'rule', rule: 'rule', rules: 'rule',
  agente: 'agent', agentes: 'agent', agent: 'agent', agents: 'agent',
  referencia: 'reference', referencias: 'reference',
  reference: 'reference', references: 'reference',
  prompt: 'prompt', prompts: 'prompt',
  perfil: 'profile', perfiles: 'profile',
  profile: 'profile', profiles: 'profile',
  mcp: 'mcp',
};
const TOOL_UNIT = new Set(['tool', 'tools', 'herramienta', 'herramientas']);
const VERB_UNIT = new Set(['verbo', 'verbos', 'verb', 'verbs']);
const COMMAND_UNIT = new Set(['comando', 'comandos', 'command', 'commands']);
const SUBCOMMAND_UNIT = new Set([
  'subcomando', 'subcomandos', 'subcommand', 'subcommands',
]);
const ROUTE_UNIT = new Set(['ruta', 'rutas', 'route', 'routes']);
const ENTRY_UNIT = new Set(['entrada', 'entradas', 'entry', 'entries']);
const ALIAS_UNIT = new Set(['alias', 'aliases']);

// Numeric surface claims in capability-map use markdown both around numbers
// (`142` entries, **142 entries**) and between a number and its unit
// (40 `scopegrain_*` tools). For counting only, preserve numeric inline-code
// contents and drop non-numeric inline-code spans/emphasis markers. Context
// classification still uses the original line.
function countNormalizedLine(line) {
  return line
    .replace(/`([^`\n]*)`/g, (_m, inner) => {
      const trimmed = inner.trim();
      return /^\d{1,3}$/.test(trimmed) ? ` ${trimmed} ` : ' ';
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1');
}

function flagNameOf(token) {
  const m = /^--[\w-]+/.exec(token);
  return m ? m[0] : null;
}

const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;

export function scanDocSurface(text, { capabilityMap = false } = {}) {
  const flags = new Map();
  const counts = [];
  const invocations = [];
  const seenCounts = new Set();
  const noteCount = (n, unit, line, dated, lineIndex) => {
    const key = `${lineIndex}|${n}|${unit}|${line}`;
    if (seenCounts.has(key)) return;
    seenCounts.add(key);
    counts.push({ n, unit, line, dated });
  };
  const noteFlag = (flag, via) => {
    if (flag === null) return;
    if (!flags.has(flag)) flags.set(flag, new Set());
    flags.get(flag).add(via);
  };
  // A paragraph (maximal run of non-blank lines) containing an ISO date is
  // a point-in-time record — pilot logs, session evidence, dated audit
  // findings. Its numeric claims describe what was true on that date, not
  // the current surface, so they are exempt from code-count comparison.
  // Flags and verb claims stay checked: stale names mislead readers even
  // inside dated prose.
  const lines = text.split('\n');
  const datedLines = new Array(lines.length).fill(false);
  let paraStart = -1;
  const closeParagraph = (end) => {
    if (paraStart < 0) return;
    for (let i = paraStart; i < end; i += 1) {
      if (DATE_RE.test(lines[i])) {
        for (let j = paraStart; j < end; j += 1) datedLines[j] = true;
        break;
      }
    }
    paraStart = -1;
  };
  lines.forEach((line, i) => {
    if (line.trim() === '') { closeParagraph(i); return; }
    if (paraStart < 0) paraStart = i;
  });
  closeParagraph(lines.length);
  let inFence = false;
  let lineIndex = -1;
  for (const line of lines) {
    lineIndex += 1;
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
      noteCount(Number(m[1]), m[2].toLowerCase(), trimmed,
        datedLines[lineIndex], lineIndex);
    }
    if (capabilityMap) {
      const normalized = countNormalizedLine(trimmed);
      for (const m of normalized.matchAll(CAPABILITY_COUNT_RE)) {
        noteCount(Number(m[1]), m[2].toLowerCase(), trimmed,
          datedLines[lineIndex], lineIndex);
      }
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

// Derives every catalog count from the loaded manifest projection, never
// from prose memory. A partial hand-built catalog degrades individual
// surfaces to null (claim ignored) instead of inventing zeroes.
function catalogCountSurface(catalog) {
  const kinds = catalogKindCounts(catalog);
  if (kinds === null) return null;
  return {
    entries: Array.isArray(catalog.entries)
      ? catalog.entries.length : catalog.byKey.size,
    aliases: Array.isArray(catalog.aliases) ? catalog.aliases.length : null,
    kinds,
  };
}

function expectedFor(claim, surfaces) {
  const { unit, line } = claim;
  if (TOOL_UNIT.has(unit)) {
    return MCP_LINE_RE.test(line) ? surfaces.mcpTools : null;
  }
  if (VERB_UNIT.has(unit) || SUBCOMMAND_UNIT.has(unit)) {
    return CLI_LINE_RE.test(line) ? surfaces.cliVerbs : null;
  }
  if (ROUTE_UNIT.has(unit)) {
    return API_LINE_RE.test(line) ? surfaces.apiRoutes : null;
  }
  if (ENTRY_UNIT.has(unit)) {
    return CAPABILITY_CATALOG_LINE_RE.test(line) ? surfaces.catalogEntries : null;
  }
  if (ALIAS_UNIT.has(unit)) {
    return CAPABILITY_CATALOG_LINE_RE.test(line) ? surfaces.catalogAliases : null;
  }
  if (COMMAND_UNIT.has(unit)) {
    if (CATALOG_LINE_RE.test(line)) return surfaces.catalogCommands;
    return CLI_LINE_RE.test(line) ? surfaces.cliVerbs : null;
  }
  const kind = RESOURCE_UNIT[unit];
  const kindLineRe = kind === 'prompt' || kind === 'profile' || kind === 'mcp'
    ? CAPABILITY_CATALOG_LINE_RE : CATALOG_LINE_RE;
  if (kind && kindLineRe.test(line)) {
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
  let apiRoutes = null;
  try {
    const apiAbs = path.join(installRoot, 'src', 'api', 'server.mjs');
    const apiSt = lstatOrNull(apiAbs);
    if (apiSt && apiSt.isFile() && !apiSt.isSymbolicLink()) {
      const limited = readFileLimited(apiAbs, loadLimits().maxDocumentBytes);
      if (!limited.exceeded) {
        const routes = extractApiRoutes(decodeUtf8Strict(
          limited.content, 'MALFORMED_JSON', 'src/api/server.mjs'));
        apiRoutes = routes === null ? null : routes.length;
      }
    }
  } catch {
    apiRoutes = null;
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
  const catalogCounts = catalogCountSurface(catalog);
  const surfaces = {
    cliVerbs: verbs.length,
    mcpTools,
    apiRoutes,
    catalogCommands: catalogCounts?.kinds
      ? catalogCounts.kinds.command ?? 0 : null,
    catalogEntries: catalogCounts ? catalogCounts.entries : null,
    catalogAliases: catalogCounts ? catalogCounts.aliases : null,
    resourceKinds: catalogCounts ? catalogCounts.kinds : null,
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
    const s = scanDocSurface(text, {
      capabilityMap: /^docs\/(?:en\/)?capability-map\.md$/.test(rel),
    });
    for (const [flag, via] of s.flags) {
      if (cliFlags.has(flag)) continue;
      if (!badFlags.has(flag)) badFlags.set(flag, new Set());
      for (const v of via) badFlags.get(flag).add(v);
    }
    for (const claim of s.counts) {
      if (claim.dated) continue;
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
