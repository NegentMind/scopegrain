// SPDX-License-Identifier: Apache-2.0
// Memory -> rules promotion proposals: a pure, deterministic mapping
// from recorded lesson entries (paths.memory/lessons.jsonl) to
// declarative PROPOSALS the owner reviews — `promote` (a new rule
// draft) or `merge` (into an existing rule). It NEVER writes rules,
// memory or anything else: acting on a proposal is an explicit
// `rule propose --input` the owner runs, exactly like task-suggest
// never mutates task.skills and capture-proposals emits proposals,
// never captures.
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { canonicalDigest } from './digests.mjs';
import { readWorklog } from './worklog.mjs';
import { listRules } from './rules.mjs';

const SEED_PREFIX = 'scopegrain:memory-rule-proposal:v1:';
const DEFAULT_MIN_COUNT = 2;
const MAX_EVIDENCE = 10;
const MAX_TAIL = 1000;
// A lesson is already promoted when its ref points at a catalog rule
// file; the basename is the rule id.
const RULE_REF = /^resources\/rules\/([a-z0-9][a-z0-9-]*)\.md$/;
const OPTION_KEYS = new Set(['minCount', 'tail']);

// Deterministic name-based UUID — same convention as capture-proposals:
// an identifier derived from the proposal content, never randomness.
function digestUUID(seed) {
  const h = crypto.createHash('sha256')
    .update(SEED_PREFIX + seed, 'utf8').digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}`
    + `-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const normText = (s) => String(s ?? '').toLowerCase()
  .replace(/\s+/g, ' ').trim();

// Same charset as slugifyTitle but no 'task' sentinel — 'task' is a
// legitimate topic here. Non-sluggable input falls back to a stable
// content-derived id so two distinct groups never share a suggestion.
const slugChars = (v) => String(v ?? '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  .replace(/-+$/g, '');
function ruleSlug(topic, seedText) {
  const s = slugChars(topic) || slugChars(seedText);
  if (s !== '') return s;
  const h = crypto.createHash('sha256')
    .update(String(topic ?? seedText ?? ''), 'utf8')
    .digest('hex').slice(0, 8);
  return `lesson-${h}`;
}

const titleCase = (slug) => slug.split('-')
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// A valid rule draft the owner can save verbatim and feed to
// `rule propose --input` — the status marker is present so setRuleStatus
// can re-normalize it; the body lists each distinct lesson as a rule.
// Whitespace is collapsed before interpolation: a topic carrying '\n'
// must not inject arbitrary lines into the draft.
function ruleDraft(title, topic, texts) {
  const clean = String(topic ?? 'lesson').replace(/\s+/g, ' ').trim();
  const items = texts.map((t, i) => `### ${i + 1} — ${clean}\n\n${t}\n`)
    .join('\n');
  return `# ${title} — promoted from lessons\n\n`
    + `> **Status:** Proposed\n\n`
    + `## Rules\n\n${items}`;
}

function groupKey(entry) {
  return typeof entry.topic === 'string' && entry.topic.trim() !== ''
    ? `topic:${entry.topic.trim().toLowerCase()}`
    : `text:${normText(entry.text)}`;
}

// Pure read path over the lessons log plus the resolved rule catalog.
// Groups entries by normalized topic (untopic'd entries group by exact
// text — recurrence is the only thing they can signal), then per group:
// a matching active/proposed rule makes a `merge` proposal against the
// uncovered lessons; no match makes a `promote` proposal carrying a
// ready-to-save draft. Groups where every entry already refs the rule
// are suppressed as already-promoted.
export function proposeMemoryRules(ctx, options = {}) {
  for (const k of Object.keys(options)) {
    if (!OPTION_KEYS.has(k)) {
      throw err('UNKNOWN_KEY', `memory rule proposals received unknown key '${k}'`);
    }
  }
  const minCount = options.minCount ?? DEFAULT_MIN_COUNT;
  if (!Number.isSafeInteger(minCount) || minCount < 1) {
    throw err('INVALID_VALUE', 'minCount must be a positive safe integer');
  }
  const tail = options.tail ?? MAX_TAIL;
  if (!Number.isSafeInteger(tail) || tail < 0 || tail > MAX_TAIL) {
    throw err('INVALID_VALUE', `tail must be 0..${MAX_TAIL}`);
  }
  const { entries, malformed, truncated } =
    readWorklog(ctx, 'lessons', { tail });
  // A workspace without a projected catalog has no canonical rules to
  // suppress already-promoted lessons — degrade to an empty rule set
  // instead of failing the whole surface (the rest is lessons-only).
  let rules = [];
  try {
    ({ rules } = listRules(ctx));
  } catch (e) {
    if (e.code !== 'WORKSPACE_CATALOG_MISSING') throw e;
  }
  const rulesById = new Map(rules.map((r) => [r.id, r]));
  const promotable = (r) => r.status === 'active' || r.status === 'proposed';

  const groups = new Map();
  let skipped = 0;
  for (const e of entries) {
    // JSON-valid but structurally invalid entries are counted, not
    // silently dropped — the source report carries them.
    if (e === null || typeof e !== 'object'
        || typeof e.text !== 'string' || e.text.trim() === '') {
      skipped += 1;
      continue;
    }
    const k = groupKey(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  const proposals = [];
  const suppressed = [];
  const seenTexts = new Map(); // normText -> Map(groupKey -> count)
  for (const [key, list] of [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))) {
    const topic = key.startsWith('topic:') ? key.slice(6) : null;
    // Deduplicate identical statements: one evidence row per distinct
    // text carrying its occurrence count — three copies of the same
    // lesson are one signal seen three times, not three signals.
    const distinct = new Map();
    for (const e of list) {
      const n = normText(e.text);
      if (!seenTexts.has(n)) seenTexts.set(n, new Map());
      const byGroup = seenTexts.get(n);
      byGroup.set(key, (byGroup.get(key) ?? 0) + 1);
      if (!distinct.has(n)) distinct.set(n, { entry: e, occurrences: 0 });
      distinct.get(n).occurrences += 1;
    }
    const count = list.length;
    const label = topic ?? distinct.keys().next().value.slice(0, 60);
    if (count < minCount) {
      suppressed.push({ group: label, count,
        reason: `below minCount ${minCount}` });
      continue;
    }

    // Merge target: a promotable catalog rule id matching the group
    // slug (computed for topic AND text groups alike), or the rule a
    // lesson ref already points at.
    const slug = ruleSlug(topic, topic ?? distinct.keys().next().value);
    let target = null;
    if (rulesById.has(slug) && promotable(rulesById.get(slug))) {
      target = rulesById.get(slug);
    } else {
      for (const { entry } of distinct.values()) {
        const m = typeof entry.ref === 'string'
          ? entry.ref.match(RULE_REF) : null;
        if (m && rulesById.has(m[1]) && promotable(rulesById.get(m[1]))) {
          target = rulesById.get(m[1]);
          break;
        }
      }
    }

    // Lessons already ref'd to the merge target are promoted material,
    // not new content — evidence is only what the rule lacks.
    const uncovered = [...distinct.values()]
      .filter(({ entry }) => target === null
        || !(typeof entry.ref === 'string'
          && entry.ref.match(RULE_REF)?.[1] === target.id));
    if (target !== null && uncovered.length === 0) {
      suppressed.push({ group: label, count,
        reason: `already promoted — every entry refs rule '${target.id}'` });
      continue;
    }
    const kind = target !== null ? 'merge' : 'promote';
    // distinctTexts and the draft cover EVERY uncovered text — the cap
    // truncates the evidence list only and is flagged, never silent.
    const texts = uncovered.map(({ entry }) => entry.text);
    const evidence = uncovered.slice(0, MAX_EVIDENCE)
      .map(({ entry, occurrences }) => ({
        at: entry.at ?? null, topic: entry.topic ?? null,
        ref: entry.ref ?? null, taskId: entry.taskId ?? null,
        text: entry.text, occurrences,
      }));
    // An id colliding with a non-promotable rule (e.g. archived) would
    // brick the later `rule propose` — suggest a hash id instead and
    // report the conflict rather than emitting a known-broken id.
    // Merge suggests no id, so it never carries a conflict.
    const hit = rulesById.get(slug);
    const conflict = kind === 'promote'
      && hit !== undefined && !promotable(hit)
      ? { ruleId: hit.id, status: hit.status,
        note: `suggested id taken by ${hit.status} rule — `
          + 'pick another id or revive it' }
      : null;
    const suggestedId = conflict !== null
      ? `lesson-${crypto.createHash('sha256')
          .update(texts.join('\n'), 'utf8').digest('hex').slice(0, 8)}`
      : slug;
    const seed = `${kind}:${target?.id ?? suggestedId}:`
      + canonicalDigest(texts);
    proposals.push({
      proposalId: digestUUID(seed),
      kind,
      topic,
      count,
      distinctTexts: texts.length,
      rule: target === null ? null
        : { id: target.id, origin: target.origin,
          status: target.status, path: target.path },
      suggestedRule: kind === 'promote' ? {
        id: suggestedId,
        content: ruleDraft(titleCase(suggestedId),
          topic ?? 'lesson', texts),
      } : null,
      conflict,
      lessons: evidence,
      evidenceTruncated: uncovered.length > MAX_EVIDENCE,
      note: kind === 'promote'
        ? `recurrent topic '${label}' has no covering rule — `
          + 'save suggestedRule.content and run rule propose --input'
        : `recurrent topic '${label}' overlaps rule '${target.id}' — `
          + 'merge the uncovered lessons into it',
    });
  }

  // Identical statements recorded under different groups are merge
  // evidence too — reported apart so they never inflate a count.
  const duplicates = [...seenTexts.entries()]
    .filter(([, byGroup]) => byGroup.size > 1)
    .map(([text, byGroup]) => ({
      text,
      groups: [...byGroup.keys()].sort(),
      occurrences: [...byGroup.values()].reduce((a, n) => a + n, 0),
    }))
    .sort((a, b) => a.text.localeCompare(b.text));

  proposals.sort((a, b) => b.count - a.count
    || String(a.topic ?? '').localeCompare(String(b.topic ?? '')));
  suppressed.sort((a, b) => a.group.localeCompare(b.group));
  return {
    schemaVersion: 1,
    mode: 'suggestions',
    source: { log: 'lessons', entries: entries.length, skipped,
      malformed: malformed.length, truncated },
    minCount,
    proposals,
    suppressed,
    duplicates,
  };
}
