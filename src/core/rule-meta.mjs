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

export function defaultRuleMeta() {
  return {
    category: null,
    status: 'active',
    origin: { source: 'canonical', evidenceRefs: [] },
    activation: null,
    enforcement: { level: 'advisory', verificationRef: null },
    examples: null,
  };
}

function bad(label, msg) {
  throw err(CODE, `${label}: ${msg}`);
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

// parseRuleMeta(text|buffer, label) -> normalized meta object.
// Always returns every key (defaults applied); `activation` and
// `examples` stay null unless at least one of their keys is declared.
export function parseRuleMeta(input, label = 'rule') {
  const raw = Buffer.isBuffer(input)
    ? decodeUtf8Strict(input, CODE, label) : String(input ?? '');
  // A BOM before the fence must not silently downgrade the file to
  // defaults — strip it so `\uFEFF---` still parses (or fails closed).
  const text = raw.replace(/^\uFEFF/, '');
  const head = text.length > HEAD_MAX_CHARS
    ? text.slice(0, HEAD_MAX_CHARS) : text;
  if (!head.startsWith('---')) return defaultRuleMeta();
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
  const meta = defaultRuleMeta();
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
  return meta;
}
