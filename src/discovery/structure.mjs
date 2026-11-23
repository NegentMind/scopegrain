// SPDX-License-Identifier: Apache-2.0
// Structural index: deterministic, dependency-free static metrics over the
// project tree — file inventory, per-language LOC, function/import/complexity
// HEURISTICS (regex-based, labeled as such — never claimed as AST analysis),
// and an internal dependency graph resolved from relative specifiers only.
//
// The index is persisted under <state>/cache/structure-index.json and its
// fingerprint is a content-independent signature (path,size,mtime) so a
// cheap stat-only rescan can detect change without re-reading any file.
// Design constraints: synchronous, node builtins only, no network, never
// follows symlinks, never opens a file outside the project root, bounded
// depth/entries/file-bytes, and never reads secret-adjacent material.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { err } from '../core/errors.mjs';
import {
  decodeUtf8Strict, lstatOrNull, readFileLimited,
} from '../core/fsx.mjs';
import { resolveInside, resolveProjectRoot } from '../core/paths.mjs';

const MAX_DEPTH = 8;
const MAX_ENTRIES = 50000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_INDEX_FILES = 8192;
const MAX_SPECIFIERS_PER_FILE = 200;
const TOP_N = 20;
const MAX_EXTERNAL_PACKAGES = 400;

// Directories skipped entirely — dependency/build output, VCS internals,
// state of this harness, and every dot-directory.
const SKIP_DIRS = new Set([
  'node_modules', 'vendor', 'target', 'dist', 'build', 'coverage',
  'out', 'bin-debug', 'obj', '__pycache__', '.pytest_cache', 'venv',
  '.venv', 'env', 'Pods', 'DerivedData', '.next', '.nuxt', '.output',
  '.turbo', '.cache', '.parcel-cache', '.scopegrain',
  'legacy', 'tmp', 'temp', '.tmp',
]);

const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tiff', 'svgz',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'pdf', 'zip', 'gz', 'tgz', 'bz2',
  'xz', '7z', 'rar', 'tar', 'jar', 'war', 'class', 'dll', 'so', 'dylib',
  'exe', 'msi', 'wasm', 'pyc', 'pyo', 'o', 'a', 'lib', 'obj',
  'mp3', 'mp4', 'webm', 'wav', 'ogg', 'flac', 'mov', 'avi', 'mkv',
  'db', 'sqlite', 'sqlite3', 'bin', 'dat', 'snap', 'pack', 'idx',
  'lockb', 'pdb', 'map',
]);

// Extension → language bucket. Unknown extensions are still inventoried
// under 'other' but never read for metrics.
const LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  json: 'json', jsonc: 'json', json5: 'json',
  py: 'python', pyi: 'python',
  rs: 'rust', go: 'go',
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala',
  cs: 'csharp', fs: 'fsharp', vb: 'vbnet',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  rb: 'ruby', php: 'php', swift: 'swift', m: 'objc', mm: 'objc',
  dart: 'dart', lua: 'lua', pl: 'perl', pm: 'perl', r: 'r',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', psm1: 'powershell',
  sql: 'sql', graphql: 'graphql', gql: 'graphql', proto: 'protobuf',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  vue: 'vue', svelte: 'svelte', astro: 'astro',
  md: 'markdown', mdx: 'markdown', rst: 'rst', txt: 'text',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml', ini: 'ini',
  cfg: 'ini', env: 'ini', tf: 'terraform', hcl: 'terraform',
  dockerfile: 'docker', gradle: 'gradle', cmake: 'cmake',
  ex: 'elixir', exs: 'elixir', erl: 'erlang', hrl: 'erlang',
  hs: 'haskell', clj: 'clojure', cljs: 'clojure',
  zig: 'zig', nim: 'nim', d: 'd', sol: 'solidity',
};

const CODE_LANGS = new Set([
  'javascript', 'typescript', 'python', 'rust', 'go', 'java', 'kotlin',
  'scala', 'csharp', 'fsharp', 'vbnet', 'c', 'cpp', 'ruby', 'php', 'swift',
  'objc', 'dart', 'lua', 'perl', 'r', 'shell', 'powershell', 'sql',
  'graphql', 'vue', 'svelte', 'astro', 'elixir', 'erlang', 'haskell',
  'clojure', 'zig', 'nim', 'd', 'solidity', 'gradle', 'cmake', 'docker',
  'terraform',
]);

const LINE_COMMENT = {
  javascript: '//', typescript: '//', rust: '//', go: '//', java: '//',
  kotlin: '//', scala: '//', csharp: '//', fsharp: '//', c: '//', cpp: '//',
  php: '//', swift: '//', objc: '//', dart: '//', zig: '//', solidity: '//',
  gradle: '//',
  python: '#', ruby: '#', shell: '#', powershell: '#', r: '#', yaml: '#',
  toml: '#', ini: '#', docker: '#', cmake: '#', elixir: '#', perl: '#',
  nim: '#', terraform: '#', env: '#', cfg: '#',
  sql: '--', lua: '--', haskell: '--', erlang: '%',
  html: '<!--', xml: '<!--', vue: '<!--', markdown: '<!--',
};

// Secret-adjacent basenames: never opened for metrics.
const SECRET_NAMES = /(^|\.)(pem|key|p12|pfx|jks|keystore|asc|gpg|pgp|crt|cer|der|secrets?|credentials?|id_rsa|id_ed25519|id_ecdsa|id_dsa|htpasswd|netrc|npmrc|pypirc|env)$/i;

// Import-specifier extractors per language family. Heuristic regexes —
// multiline/import-edge cases are documented misses, never parsed code.
const IMPORT_RES = {
  javascript: [
    /import\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /export\s+(?:type\s+)?[\w*{}\s,]+\s+from\s+['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ],
  typescript: 'javascript',
  vue: 'javascript',
  svelte: 'javascript',
  astro: 'javascript',
  python: [
    /^\s*import\s+([\w.]+)/gm,
    /^\s*from\s+([\w.]+)\s+import/gm,
  ],
  rust: [/^\s*use\s+([\w:]+)/gm],
  go: [
    /^\s*import\s+"([^"]+)"/gm,
    /import\s*\(\s*((?:\s*"[^"]+"\s*)+)\)/g,
  ],
  java: [/^\s*import\s+(?:static\s+)?([\w.]+)/gm],
  kotlin: 'java',
  scala: 'java',
  csharp: [/^\s*using\s+(?:static\s+)?([\w.]+)/gm],
  ruby: [/^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/gm],
  php: [/\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/gm],
  dart: [/^\s*import\s+['"]([^'"]+)['"]/gm],
};

// Function/method-count heuristics per family.
const FN_RES = {
  javascript: [
    /\bfunction\s+\w+/g,
    /\b(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(/g,
    /=>/g,
  ],
  typescript: 'javascript',
  vue: 'javascript', svelte: 'javascript', astro: 'javascript',
  python: [/^\s*(?:async\s+)?def\s+\w+/gm, /\blambda\b/g],
  rust: [/\bfn\s+\w+/g],
  go: [/\bfunc\s+(?:\([^)]*\)\s*)?\w+/g],
  java: [/^\s*(?:public|private|protected|static|final|synchronized|abstract|\s)+[\w<>\[\],.?]+\s+\w+\s*\([^)]*\)\s*(?:throws\s+[\w.,\s]+)?\{/gm],
  kotlin: 'java', scala: 'java', csharp: 'java',
  ruby: [/^\s*def\s+\w+/gm],
  php: [/\bfunction\s+\w+/g],
  swift: [/\bfunc\s+\w+/g],
  dart: [/^\s*(?:\w+\s+)+\w+\s*\([^)]*\)\s*(?:async\s*)?\{/gm],
  c: [/^\s*(?:static\s+)?[\w*]+\s+\w+\s*\([^;{}]*\)\s*\{/gm],
  cpp: 'c',
  shell: [/^\s*(?:function\s+)?\w+\s*\(\s*\)\s*\{/gm],
  powershell: [/\bfunction\s+\w+/gi],
  lua: [/\bfunction\s+[\w.:]+/g],
  sql: [/\b(?:create|CREATE)\s+(?:or\s+replace\s+)?(?:function|procedure)\b/gi],
};

// Control-flow keyword heuristic — a proxy for cyclomatic complexity,
// reported as `complexity` with heuristic:true, never as real cyclomatic.
const CX_RE =
  /\b(if|else\s+if|elif|for|while|case|when|switch|catch|except|guard|match|rescue|unless)\b|&&|\|\||\?(?!\s*\.)/g;

function langOf(rel) {
  const base = path.basename(rel).toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'docker';
  if (base === 'cmakelists.txt') return 'cmake';
  if (base === 'makefile' || base === 'justfile') return 'cmake';
  const dot = rel.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = rel.slice(dot + 1).toLowerCase();
  return LANG[ext] ?? null;
}

function isBinary(rel) {
  const dot = rel.lastIndexOf('.');
  if (dot < 0) return false;
  return BINARY_EXTS.has(rel.slice(dot + 1).toLowerCase());
}

function countMatches(text, re) {
  let n = 0;
  re.lastIndex = 0;
  while (re.exec(text) !== null) n += 1;
  return n;
}

// resolveImport: relative specifiers resolve to an internal file when the
// target exists inside the scanned set; anything else is an external name
// (first path segment / package). Returns {kind, ref}.
function classifySpecifier(spec, rel, fileSet, relDir) {
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const target = path.posix.normalize(path.posix.join(relDir, spec));
    const candidates = [target, `${target}.ts`, `${target}.tsx`,
      `${target}.js`, `${target}.mjs`, `${target}.jsx`, `${target}.py`,
      `${target}/index.ts`, `${target}/index.js`, `${target}/__init__.py`];
    for (const c of candidates) {
      if (fileSet.has(c)) return { kind: 'internal', ref: c };
    }
    return { kind: 'internal', ref: target };
  }
  const pkg = spec.startsWith('@')
    ? spec.split('/').slice(0, 2).join('/')
    : spec.split('/')[0];
  return { kind: 'external', ref: pkg };
}

// scanStructure(projectRoot): walks the tree and returns the complete
// in-memory index {fingerprint, files, ...}. Pure — writes nothing.
export function scanStructure(projectRoot, { statOnly = false } = {}) {
  const root = resolveProjectRoot(projectRoot);
  const queue = [{ rel: '', depth: 0 }];
  const warnings = [];
  const files = [];
  const relPaths = new Set();

  // Pass 1: inventory (lstat-only) — always needed for the fingerprint.
  while (queue.length > 0) {
    if (files.length + relPaths.size > MAX_ENTRIES * 2) {
      warnings.push({ code: 'SCAN_BUDGET', message: 'entry budget reached' });
      break;
    }
    const { rel, depth } = queue.shift();
    const abs = rel === '' ? root : resolveInside(root, rel, 'scan');
    let dirents;
    try {
      dirents = [];
      const dh = lstatOrNull(abs);
      if (!dh || !dh.isDirectory()) continue;
      for (const e of readdirSyncBound(abs)) dirents.push(e);
    } catch (e2) {
      warnings.push({ code: 'SCAN_DIR_UNREADABLE', message: `${rel}: ${e2.message}` });
      continue;
    }
    for (const e of dirents) {
      const childRel = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        if (depth + 1 <= MAX_DEPTH) queue.push({ rel: childRel, depth: depth + 1 });
        else warnings.push({ code: 'SCAN_DEPTH', message: `${childRel} beyond depth ${MAX_DEPTH}` });
        continue;
      }
      if (!e.isFile()) continue;
      if (e.name.startsWith('.')) continue;
      if (relPaths.size >= MAX_ENTRIES) {
        warnings.push({ code: 'SCAN_BUDGET', message: 'file budget reached' });
        break;
      }
      const st = lstatOrNull(resolveInside(root, childRel, 'scan'));
      if (!st || !st.isFile()) continue;
      relPaths.add(childRel);
      files.push({
        rel: childRel,
        lang: langOf(childRel),
        bytes: st.size,
        mtimeMs: Math.round(st.mtimeMs),
      });
    }
  }

  // Fingerprint over (path,size,mtime) — content-independent by design.
  const fpHash = crypto.createHash('sha256');
  for (const f of [...files].sort((a, b) => a.rel.localeCompare(b.rel))) {
    fpHash.update(`${f.rel}:${f.bytes}:${f.mtimeMs}\n`);
  }
  const fingerprint = fpHash.digest('hex');

  const index = {
    schemaVersion: 1,
    root: path.basename(root),
    generatedAt: new Date().toISOString(),
    fingerprint,
    statOnly,
    warnings,
    totals: { files: files.length, bytes: 0, lines: 0 },
    languages: {},
    edges: { internal: 0, external: [] },
    top: { byBytes: [], byComplexity: [], fanIn: [], fanOut: [] },
    files: null,
    filesTruncated: false,
  };

  for (const f of files) index.totals.bytes += f.bytes;

  if (statOnly) return index;

  // Pass 2: metrics — opens only text/code files below the byte cap and
  // never secret-adjacent names.
  const fileSet = new Set(files.map((f) => f.rel));
  const fanIn = new Map();
  const externalPkgs = new Set();
  let metricFiles = 0;

  for (const f of files) {
    if (f.lang === null || isBinary(f.rel) || f.bytes > MAX_FILE_BYTES
        || f.bytes === 0 || SECRET_NAMES.test(f.rel)) {
      continue;
    }
    let text;
    try {
      const abs = resolveInside(root, f.rel, 'scan');
      const limited = readFileLimited(abs, MAX_FILE_BYTES);
      if (limited.exceeded) continue;
      text = decodeUtf8Strict(limited.content, 'SCAN_DECODE', f.rel);
    } catch {
      warnings.push({ code: 'SCAN_READ', message: `${f.rel} unreadable` });
      continue;
    }
    metricFiles += 1;
    const lines = text.split('\n');
    const lc = LINE_COMMENT[f.lang];
    let blank = 0;
    let comment = 0;
    for (const ln of lines) {
      const t = ln.trim();
      if (t === '') blank += 1;
      else if (lc && t.startsWith(lc)) comment += 1;
      else if (lc === '//' && (t.startsWith('/*') || t.startsWith('*'))) comment += 1;
      else if ((lc === '<!--') && t.startsWith('<!--')) comment += 1;
      else if ((lc === '--') && t.startsWith('--')) comment += 1;
    }
    const m = {
      lines: lines.length,
      blank,
      comment,
      code: lines.length - blank - comment,
    };
    const fnRes = typeof FN_RES[f.lang] === 'string' ? FN_RES[FN_RES[f.lang]] : FN_RES[f.lang];
    m.functions = fnRes
      ? fnRes.reduce((acc, re) => acc + countMatches(text, re), 0)
      : null;
    m.complexity = CODE_LANGS.has(f.lang) ? countMatches(text, CX_RE) : null;

    const impRes = typeof IMPORT_RES[f.lang] === 'string'
      ? IMPORT_RES[IMPORT_RES[f.lang]] : IMPORT_RES[f.lang];
    m.imports = [];
    if (impRes) {
      const seen = new Set();
      for (const re of impRes) {
        re.lastIndex = 0;
        let mm;
        while ((mm = re.exec(text)) !== null) {
          if (seen.size >= MAX_SPECIFIERS_PER_FILE) break;
          const spec = mm[1];
          if (f.lang === 'go' && spec.includes('"')) {
            for (const g of spec.matchAll(/"([^"]+)"/g)) seen.add(g[1]);
            continue;
          }
          seen.add(spec);
        }
      }
      const relDir = path.posix.dirname(f.rel) === '.' ? '' : path.posix.dirname(f.rel);
      for (const spec of seen) {
        const c = classifySpecifier(spec, f.rel, fileSet, relDir);
        m.imports.push(c.kind === 'internal' ? `./${c.ref}` : c.ref);
        if (c.kind === 'internal') {
          index.edges.internal += 1;
          fanIn.set(c.ref, (fanIn.get(c.ref) ?? 0) + 1);
        } else if (externalPkgs.size < MAX_EXTERNAL_PACKAGES) {
          externalPkgs.add(c.ref);
        }
      }
    }
    Object.assign(f, m);
    index.totals.lines += m.lines;
  }

  // Language aggregation (files+bytes counted for ALL inventoried files;
  // line metrics only where the file was readable).
  for (const f of files) {
    const l = f.lang ?? 'other';
    const agg = index.languages[l] ??= {
      files: 0, bytes: 0, lines: 0, code: 0, functions: 0, complexity: 0,
    };
    agg.files += 1;
    agg.bytes += f.bytes;
    if (f.lines !== undefined) {
      agg.lines += f.lines;
      agg.code += f.code;
      agg.functions += f.functions ?? 0;
      agg.complexity += f.complexity ?? 0;
    }
  }

  index.edges.external = [...externalPkgs].sort();
  index.totals.metricFiles = metricFiles;

  const topBy = (arr, key) => arr
    .filter((f) => f[key] !== undefined && f[key] !== null)
    .sort((a, b) => b[key] - a[key])
    .slice(0, TOP_N)
    .map((f) => ({ rel: f.rel, [key]: f[key] }));

  index.top.byBytes = topBy(files, 'bytes');
  index.top.byComplexity = topBy(files, 'complexity');
  index.top.fanIn = [...fanIn.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, TOP_N)
    .map(([rel, n]) => ({ rel, importedBy: n }));
  const fanOut = files
    .filter((f) => f.imports && f.imports.length > 0)
    .sort((a, b) => b.imports.length - a.imports.length)
    .slice(0, TOP_N)
    .map((f) => ({ rel: f.rel, imports: f.imports.length }));
  index.top.fanOut = fanOut;

  // Per-file rows are compact tuples; the stored document must stay under
  // the document byte limit, so very large trees degrade to aggregates.
  const rows = files.map((f) => [
    f.rel, f.lang ?? '-', f.bytes,
    f.lines ?? -1, f.code ?? -1, f.functions ?? -1, f.complexity ?? -1,
    (f.imports ?? []).length,
  ]);
  index.filesTruncated = rows.length > MAX_INDEX_FILES;
  index.files = index.filesTruncated ? rows.slice(0, MAX_INDEX_FILES) : rows;
  return index;
}

// Minimal bounded readdir — the walk needs dirent types only.
function readdirSyncBound(abs) {
  return fs.readdirSync(abs, { withFileTypes: true });
}

export function structureIndexRel(ctx) {
  return `${ctx.config.paths.state}/cache/structure-index.json`;
}

// Persist via exclusive random tmp + rename — derived cache data, never
// journaled. Refuses to overwrite a symlink or non-file destination.
export function writeStructureIndex(ctx, index) {
  const rel = structureIndexRel(ctx);
  const abs = resolveInside(ctx.projectRoot, rel, 'structure index');
  const existing = lstatOrNull(abs);
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    throw err('STRUCTURE_MALFORMED',
      `${rel} exists and is not a regular file`);
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${crypto.randomBytes(8).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(index, null, 1) + '\n', { flag: 'wx' });
    fs.renameSync(tmp, abs);
  } finally {
    try { if (lstatOrNull(tmp)) fs.unlinkSync(tmp); } catch { /* noop */ }
  }
  return rel;
}

export function readStructureIndex(ctx) {
  const rel = structureIndexRel(ctx);
  const abs = resolveInside(ctx.projectRoot, rel, 'structure index');
  const st = lstatOrNull(abs);
  if (!st) return null;
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('STRUCTURE_MALFORMED', `${rel} is not a regular file`);
  }
  const l = readFileLimited(abs, 1048576);
  if (l.exceeded) {
    throw err('STRUCTURE_MALFORMED', `${rel} exceeds document limit`);
  }
  let doc;
  try {
    doc = JSON.parse(decodeUtf8Strict(
      l.content, 'STRUCTURE_MALFORMED', rel));
  } catch (e) {
    if (e.code === 'STRUCTURE_MALFORMED') throw e;
    throw err('STRUCTURE_MALFORMED', `${rel} is not valid JSON`);
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)
      || doc.schemaVersion !== 1) {
    throw err('STRUCTURE_MALFORMED', `${rel} has invalid fields`);
  }
  return doc;
}

// Stored-index-only view for callers that opt out of the live rescan
// (context --no-structure). Reports what the persisted index recorded,
// never what the tree currently holds: stale stays null because nothing
// was checked — `checked:false` declares that honestly.
export function storedStructureStatus(ctx) {
  const stored = readStructureIndex(ctx);
  return {
    indexed: stored !== null,
    stale: null,
    checked: false,
    refreshPolicy: 'explicit',
    recommendedCommand: null,
    fingerprint: {
      stored: stored?.fingerprint ?? null,
      actual: null,
    },
    summary: stored === null ? null : {
      generatedAt: stored.generatedAt,
      files: stored.totals.files,
      bytes: stored.totals.bytes,
      lines: stored.totals.lines,
      languages: Object.keys(stored.languages).length,
      filesTruncated: stored.filesTruncated,
    },
    liveFiles: null,
  };
}

// Debounced status cache: <state>/cache/structure-status.json. Derived
// cache data like the index itself — written only when a caller opts in
// via debounceMs (the default path stays strictly read-only). The record
// is valid only while storedFingerprint still matches the on-disk index,
// so a `structure scan --apply` between checks is never masked by it.
const STATUS_CACHE_SCHEMA = 1;
function statusCacheRel(ctx) {
  return `${ctx.config.paths.state}/cache/structure-status.json`;
}

function readStatusCache(ctx, debounceMs) {
  try {
    const rel = statusCacheRel(ctx);
    const abs = resolveInside(ctx.projectRoot, rel, 'structure status cache');
    const st = lstatOrNull(abs);
    if (!st || st.isSymbolicLink() || !st.isFile()) return null;
    const l = readFileLimited(abs, 64 * 1024);
    if (l.exceeded) return null;
    const doc = JSON.parse(decodeUtf8Strict(
      l.content, 'STRUCTURE_MALFORMED', rel));
    if (doc === null || typeof doc !== 'object'
        || doc.schemaVersion !== STATUS_CACHE_SCHEMA
        || typeof doc.checkedAt !== 'string'
        || doc.status === null || typeof doc.status !== 'object') {
      return null;
    }
    const age = Date.now() - Date.parse(doc.checkedAt);
    if (!(age >= 0 && age < debounceMs)) return null;
    return doc;
  } catch { return null; }
}

function writeStatusCache(ctx, doc) {
  // Best-effort derived cache — an unwritable state dir degrades to a
  // full rescan next time, never a failure.
  try {
    const rel = statusCacheRel(ctx);
    const abs = resolveInside(ctx.projectRoot, rel, 'structure status cache');
    const existing = lstatOrNull(abs);
    if (existing && (existing.isSymbolicLink() || !existing.isFile())) return;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${crypto.randomBytes(8).toString('hex')}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(doc, null, 1) + '\n', { flag: 'wx' });
      fs.renameSync(tmp, abs);
    } finally {
      try { if (lstatOrNull(tmp)) fs.unlinkSync(tmp); } catch { /* noop */ }
    }
  } catch { /* opportunistic cache write — ignore */ }
}

// Cheap staleness check: stat-only rescan + fingerprint compare. Never
// reads file contents and — unless the caller opts into debounceMs —
// never writes, so `context` stays strictly read-only. With debounceMs
// a recent cached status is served instead of rescanning the tree; the
// cached answer is keyed on the stored index fingerprint, so an index
// refresh always invalidates it.
export function structureStatus(ctx, { debounceMs = 0 } = {}) {
  const stored = readStructureIndex(ctx);
  if (debounceMs > 0) {
    const cached = readStatusCache(ctx, debounceMs);
    if (cached !== null
        && cached.storedFingerprint === (stored?.fingerprint ?? null)) {
      return { ...cached.status, cached: true };
    }
  }
  const live = scanStructure(ctx.projectRoot, { statOnly: true });
  const stale = stored === null || stored.fingerprint !== live.fingerprint;
  const status = {
    indexed: stored !== null,
    stale,
    refreshPolicy: 'explicit',
    recommendedCommand: stale
      ? 'scopegrain structure refresh --project . --apply' : null,
    fingerprint: {
      stored: stored?.fingerprint ?? null,
      actual: live.fingerprint,
    },
    summary: stored === null ? null : {
      generatedAt: stored.generatedAt,
      files: stored.totals.files,
      bytes: stored.totals.bytes,
      lines: stored.totals.lines,
      languages: Object.keys(stored.languages).length,
      filesTruncated: stored.filesTruncated,
    },
    liveFiles: live.totals.files,
  };
  if (debounceMs > 0) {
    writeStatusCache(ctx, {
      schemaVersion: STATUS_CACHE_SCHEMA,
      checkedAt: new Date().toISOString(),
      storedFingerprint: stored?.fingerprint ?? null,
      status,
    });
  }
  return status;
}

// Bounded refresh: performs a stat-only staleness check first and returns
// a no-op without re-reading project contents when the index is already
// fresh. Writes only when stale AND apply=true.
export function refreshStructureIndex(ctx, { apply = false } = {}) {
  const status = structureStatus(ctx);
  if (!status.stale) {
    return {
      mode: 'noop',
      refreshed: false,
      reason: 'fresh',
      status,
    };
  }
  if (!apply) {
    return {
      mode: 'preview',
      refreshed: false,
      reason: status.indexed ? 'stale' : 'missing',
      status,
    };
  }
  const index = scanStructure(ctx.projectRoot);
  const rel = writeStructureIndex(ctx, index);
  const { files: _files, ...summary } = index;
  return {
    mode: 'applied',
    refreshed: true,
    written: rel,
    index: summary,
    status: structureStatus(ctx),
  };
}
