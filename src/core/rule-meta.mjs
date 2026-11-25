// SPDX-License-Identifier: Apache-2.0
// Rule metadata: bounded frontmatter parser for catalog rule resources.
// A rule file may open with a `---` fenced block of flat `key: value`
// lines (dotted keys address nested fields, e.g. `activation.globs`) —
// the same line grammar as the queries frontmatter peek, never full
// YAML. Files without a fence parse to declared defaults; a malformed
// block fails closed with RULE_META_MALFORMED so bad metadata is never
// silently dropped or half-applied.
//
// The metadata is DATA for hosts and packet assembly: `enforcement`
// declares posture and an optional verification.commands reference by
// id. The harness never executes commands discovered in resources
// (safety.md), so no inline command field exists by design.
import { err } from './errors.mjs';
import { decodeUtf8Strict } from './fsx.mjs';

const CODE = 'RULE_META_MALFORMED';
// Only the head of the file is scanned: a fence that does not close
// inside the cap is malformed, never silently skipped. The cap is in
// UTF-16 code units — a strict under-bound of the byte size, which is
// the conservative direction for a scan limit.
const HEAD_MAX_CHARS = 8 * 1024;
const SCALAR_MAX = 300;
const EXAMPLE_MAX = 500;
const LIST_MAX = 32;
const ITEM_MAX = 160;
const REF_MAX = 120;
const STACK_RE = /^[a-z0-9][a-z0-9+#.\-]{0,39}$/i;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const KEY_LINE_RE = /^([A-Za-z][A-Za-z0-9_.]*)\s*:(.*)$/;
// The closing fence is anchored to end-of-line: a body line starting
// with `---x` must not be able to cut the block short mid-parse.
const FENCE_RE = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/;

export const RULE_STATUSES = new Set(['active', 'proposed', 'archived']);
export const ENFORCEMENT_LEVELS = new Set(['advisory', 'strict']);
// 'canonical'/'local' are placement defaults, not authored provenance;
// authored sources record how the rule came to exist.
export const RULE_ORIGIN_SOURCES = new Set(
  ['canonical', 'local', 'user-manual', 'imported', 'auto-learned']);
export const RULE_CATEGORIES = new Set([
  'code-style', 'architecture', 'testing', 'git-workflow',
  'communication', 'security', 'other',
]);
const LIST_KEYS = new Set([
  'origin.evidenceRefs', 'activation.globs', 'activation.stacks',
  'activation.languages',
]);
export const RULE_META_KEYS = new Set([
  'category', 'status', 'origin.source', 'origin.evidenceRefs',
  'activation.globs', 'activation.stacks', 'activation.languages',
  'enforcement.level', 'enforcement.verificationRef',
  'examples.good', 'examples.bad',
  ...LIST_KEYS,
]);

export function defaultRuleMeta(source = 'canonical') {
  return {
    category: null,
    status: 'active',
    origin: { source, evidenceRefs: [] },
    activation: null,
    enforcement: { level: 'advisory', verificationRef: null },
    examples: null,
  };
}

function bad(label, msg) {
  throw err(CODE, `${label}: ${msg}`);
}

// --- Minimal glob matcher (no dependencies) ---
// Deliberately small grammar: `*` = any chars within a segment,
// `?` = one char within a segment, `**` = zero or more segments
// (trailing `**` or `**/` collapse correctly). No character classes,
// negations or braces — anything else is literal. Matching is
// case-insensitive, consistent with the catalog's portable keys.

const GLOB_ESCAPE = /[.+^${}()|[\]\\]/g;

export function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          re += '(?:[^/]+/)*'; // '**/' → zero or more full segments
          i += 2;
        } else { re += '.*'; i += 1; } // trailing/mid '**' → anything
      } else { re += '[^/]*'; }
    } else if (c === '?') { re += '[^/]'; }
    else { re += c.replace(GLOB_ESCAPE, '\\$&'); }
  }
  return new RegExp(`^${re}$`, 'i');
}

export function matchGlob(pattern, relPath) {
  return globToRegExp(String(pattern)).test(String(relPath));
}

// ruleMatchesScope(meta, scopePaths): a rule is in scope when it has no
// activation.globs (transversal) or at least one glob matches at least
// one scope path. An empty scope list excludes every glob-scoped rule —
// fail closed: file-scoped rules never fire on unknown file scope.
export function ruleMatchesScope(meta, scopePaths) {
  const globs = meta?.activation?.globs;
  if (!Array.isArray(globs) || globs.length === 0) return true;
  if (!Array.isArray(scopePaths) || scopePaths.length === 0) return false;
  const res = globs.map((g) => globToRegExp(g));
  return scopePaths.some((p) => res.some((re) => re.test(p)));
}

function list(raw, label, key, itemRe, itemMax) {
  const items = raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (items.length === 0) {
    bad(label, `'${key}' must name at least one item`);
  }
  if (items.length > LIST_MAX) {
    bad(label, `'${key}' exceeds ${LIST_MAX} items`);
  }
  const out = [];
  for (const it of items) {
    if (it.length > (itemMax ?? ITEM_MAX)) {
      bad(label, `'${key}' item exceeds length cap`);
    }
    if (itemRe && !itemRe.test(it)) {
      bad(label, `'${key}' item '${it.slice(0, 40)}' has invalid shape`);
    }
    const norm = itemRe === STACK_RE ? it.toLowerCase() : it;
    if (!out.includes(norm)) out.push(norm);
  }
  return out;
}

// Human-authored status header (`> **Status:** Active`) — the
// canonical rules convention. A frontmatter `status` key always wins;
// the header is the fallback for files without a fence. Vocabulary
// differs from the enum: 'in review' and 'draft' count as proposed,
// 'deprecated' as archived; unrecognized values keep the default.
const STATUS_HEADER_RE = /\*\*Status:\*\*\s*([A-Za-z][A-Za-z -]{0,29})/;
const STATUS_HEADER_MAP = new Map([
  ['active', 'active'], ['proposed', 'proposed'], ['in review', 'proposed'],
  ['draft', 'proposed'], ['archived', 'archived'],
  ['deprecated', 'archived'],
]);

// parseRuleMeta(text|buffer, label, {source}) -> normalized meta object.
// Always returns every key (defaults applied); `activation` and
// `examples` stay null unless at least one of their keys is declared.
// `source` sets the default origin.source (placement: 'local' overlay
// files vs 'canonical' snapshot entries).
export function parseRuleMeta(input, label = 'rule', opts = {}) {
  const raw = Buffer.isBuffer(input)
    ? decodeUtf8Strict(input, CODE, label) : String(input ?? '');
  // A BOM before the fence must not silently downgrade the file to
  // defaults — strip it so `\uFEFF---` still parses (or fails closed).
  const text = raw.replace(/^\uFEFF/, '');
  const head = text.length > HEAD_MAX_CHARS
    ? text.slice(0, HEAD_MAX_CHARS) : text;
  const source = opts.source ?? 'canonical';
  if (!head.startsWith('---')) {
    const meta = defaultRuleMeta(source);
    applyStatusHeader(meta, head);
    return meta;
  }
  const m = FENCE_RE.exec(head);
  if (!m) {
    bad(label, 'frontmatter fence does not close within the head cap');
  }
  const flat = {};
  for (const line of m[1].split(/\r?\n/)) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    const kv = KEY_LINE_RE.exec(line);
    if (!kv) {
      bad(label, `malformed frontmatter line '${t.slice(0, 60)}'`);
    }
    const key = kv[1];
    if (!RULE_META_KEYS.has(key)) {
      bad(label, `unknown frontmatter key '${key}'`);
    }
    if (flat[key] !== undefined) {
      bad(label, `duplicate frontmatter key '${key}'`);
    }
    flat[key] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  const meta = defaultRuleMeta(source);
  for (const [key, raw] of Object.entries(flat)) {
    if (raw === '') bad(label, `'${key}' must not be empty`);
    switch (key) {
      case 'category':
        if (!RULE_CATEGORIES.has(raw)) {
          bad(label, `'category' must be one of: `
            + [...RULE_CATEGORIES].join(', '));
        }
        meta.category = raw;
        break;
      case 'status':
        if (!RULE_STATUSES.has(raw)) {
          bad(label, `'status' must be active|proposed|archived`);
        }
        meta.status = raw;
        break;
      case 'origin.source':
        if (!RULE_ORIGIN_SOURCES.has(raw)) {
          bad(label, `'origin.source' must be one of: `
            + [...RULE_ORIGIN_SOURCES].join(', '));
        }
        meta.origin.source = raw;
        break;
      case 'origin.evidenceRefs':
        meta.origin.evidenceRefs = list(
          raw, label, key, null, REF_MAX);
        break;
      case 'activation.globs':
      case 'activation.stacks':
      case 'activation.languages': {
        meta.activation ??= { globs: [], stacks: [], languages: [] };
        const field = key.split('.')[1];
        meta.activation[field] = list(
          raw, label, key, field === 'globs' ? null : STACK_RE);
        break;
      }
      case 'enforcement.level':
        if (!ENFORCEMENT_LEVELS.has(raw)) {
          bad(label, `'enforcement.level' must be advisory|strict`);
        }
        meta.enforcement.level = raw;
        break;
      case 'enforcement.verificationRef':
        if (!ID_RE.test(raw)) {
          bad(label, `'enforcement.verificationRef' must be an id slug`);
        }
        meta.enforcement.verificationRef = raw.toLowerCase();
        break;
      case 'examples.good':
      case 'examples.bad': {
        if (raw.length > EXAMPLE_MAX) {
          bad(label, `'${key}' exceeds ${EXAMPLE_MAX} chars`);
        }
        meta.examples ??= { good: null, bad: null };
        meta.examples[key.split('.')[1]] = raw;
        break;
      }
      default:
        bad(label, `unhandled frontmatter key '${key}'`);
    }
    // List keys are exempt from the scalar cap: they carry their own
    // item/count bounds, and the block as a whole is bounded by the
    // head cap. Scalar fields and examples keep per-value ceilings.
    if (!LIST_KEYS.has(key) && key !== 'examples.good'
        && key !== 'examples.bad' && raw.length > SCALAR_MAX) {
      bad(label, `'${key}' exceeds ${SCALAR_MAX} chars`);
    }
  }
  if (flat.status === undefined) applyStatusHeader(meta, head);
  return meta;
}

function applyStatusHeader(meta, head) {
  const m = STATUS_HEADER_RE.exec(head);
  if (!m) return;
  const v = m[1].trim().toLowerCase();
  // Longest-prefix match: 'Deprecated - replaced by X' still resolves
  // to archived; unrecognized values keep the declared default.
  for (const key of [...STATUS_HEADER_MAP.keys()]
    .sort((a, b) => b.length - a.length)) {
    if (v === key || v.startsWith(`${key} `) || v.startsWith(`${key}-`)) {
      meta.status = STATUS_HEADER_MAP.get(key);
      return;
    }
  }
}

// Segment-wise "may overlap" between two glob patterns — deliberately
// conservative for an advisory lint: it reports pairs that CAN share a
// path, and only returns false when the patterns provably share none.
// A rule without globs is transversal and overlaps everything.
export function globsMayOverlap(a, b) {
  if (!a?.length || !b?.length) return true;
  const literal = (s) => !s.includes('*') && !s.includes('?');
  const embeddedDD = (p) => p.split('/')
    .some((s) => s.includes('**') && s !== '**');
  const allLiteral = (p) => p.split('/').every(literal);
  for (const pa of a) {
    for (const pb of b) {
      // An embedded '**' compiles to '.*' in matchGlob — it crosses
      // '/', so segmentwise proof is unsound. Decidable only when the
      // other side is a fully literal path (it either matches or not);
      // every other combination stays conservative.
      if (embeddedDD(pa) || embeddedDD(pb)) {
        if (allLiteral(pa)) {
          if (matchGlob(pb, pa)) return true;
        } else if (allLiteral(pb)) {
          if (matchGlob(pa, pb)) return true;
        } else {
          return true;
        }
        continue;
      }
      const A = pa.split('/'), B = pb.split('/');
      let i = 0;
      while (i < A.length && i < B.length) {
        const sa = A[i], sb = B[i];
        if (sa === '**' || sb === '**') { i = -1; break; }
        if (literal(sa) && literal(sb)) {
          if (sa.toLowerCase() !== sb.toLowerCase()) break;
        // A literal segment the other side's glob can never produce
        // makes this position disjoint — decide it instead of
        // conservatively reporting a pair that shares nothing.
        } else if (literal(sa) && !matchGlob(sb, sa)) {
          break;
        } else if (literal(sb) && !matchGlob(sa, sb)) {
          break;
        }
        i += 1;
      }
      // i === -1: a '**' absorbed the rest — possible shared path.
      // One side exhausted with a shared prefix only overlaps when the
      // longer side's remainder is reachable, which requires the
      // shorter pattern's last compared segment to have been '**' —
      // impossible here (the loop would have flagged it), so plain
      // exhaustion means lengths provably differ.
      if (i === -1 || (i === A.length && i === B.length)) return true;
    }
  }
  return false;
}

// Pure advisory lint over hydrated rule metadata — emits warnings,
// never throws, never blocks. Input is assembled by callers (doctor,
// packet): rules carry {id, meta, origin}; commands carry {id, rules}
// dependency ids as declared in the manifest.
//  - 'overlap': two ACTIVE rules whose activation.globs may share a
//    path while their enforcement.level differs (strict vs advisory)
//  - 'status-pair': a non-active rule whose globs may overlap an active
//    rule's (stale or draft sibling covering the same files)
//  - 'dep': a command declares a rule id that resolves to non-active or
//    to nothing — the packet will ship without it
//  - 'duplicate': same id on two entries (defensive; merge already
//    fails closed on true collisions)
export function lintRules({ rules, commands } = {}) {
  rules = rules ?? [];
  commands = commands ?? [];
  const warnings = [];
  const byId = new Map();
  for (const r of rules) {
    const key = String(r.id).toLowerCase();
    if (byId.has(key)) {
      warnings.push(`rule/${r.id} appears on more than one entry`);
    }
    byId.set(key, r);
  }
  const list = [...byId.values()];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i], b = list[j];
      const sa = a.meta?.status ?? 'active';
      const sb = b.meta?.status ?? 'active';
      if (!globsMayOverlap(
        a.meta?.activation?.globs, b.meta?.activation?.globs)) {
        continue;
      }
      if (sa === 'active' && sb === 'active') {
        const la = a.meta?.enforcement?.level ?? 'advisory';
        const lb = b.meta?.enforcement?.level ?? 'advisory';
        if (la !== lb) {
          warnings.push(
            `rules ${a.id} and ${b.id} overlap (activation.globs)`
            + ` but enforce differently (${la} vs ${lb})`);
        }
      } else if (sa === 'active' || sb === 'active') {
        const stale = sa === 'active' ? b : a;
        const live = sa === 'active' ? a : b;
        warnings.push(
          `rule ${stale.id} ('${stale.meta?.status}') overlaps`
          + ` active rule ${live.id} on the same files`);
      }
    }
  }
  for (const c of commands) {
    for (const rid of c.rules ?? []) {
      const target = byId.get(String(rid).toLowerCase());
      if (!target) {
        warnings.push(
          `command ${c.id} declares unknown rule '${rid}'`);
        continue;
      }
      const st = target.meta?.status ?? 'active';
      if (st !== 'active') {
        warnings.push(
          `command ${c.id} declares rule ${target.id}`
          + ` with status '${st}' — filtered from packets`);
      }
    }
  }
  return warnings;
}

// Body text with any leading frontmatter block removed — for consumers
// that need the rule's prose, not its metadata (e.g. descriptions).
export function stripRuleFrontmatter(text) {
  const t = String(text ?? '').replace(/^﻿/, '');
  const m = FENCE_RE.exec(t);
  return m ? t.slice(m[0].length) : t;
}
