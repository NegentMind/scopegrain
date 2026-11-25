// SPDX-License-Identifier: Apache-2.0
// memory proposals: lessons -> rule promote/merge proposals. Suggestive
// only — nothing under rules/, memory/ or anywhere else may be written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { proposeMemoryRules } from '../src/core/memory-rules.mjs';
import {
  applyFlipRule, applyProposeRule,
} from '../src/core/rules.mjs';
import { appendWorklog } from '../src/core/worklog.mjs';
import {
  bootstrappedCtx, cleanup, fakeIO, writeFile,
} from './helpers.mjs';

const lesson = (ctx, fields) => appendWorklog(ctx, 'lessons', fields);
// Local overlay is the only rule-write surface `rule propose` uses.
const localRulesAbs = (ctx) => path.join(
  ctx.projectRoot, '.scopegrain/rules/local');

test('memory proposals: recurrent topic promotes a rule draft', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    lesson(ctx, { topic: 'verify-gates',
      text: 'Gates must run the real command, never a stub.' });
    lesson(ctx, { topic: 'verify-gates',
      text: 'A green suite against a drifted double is not evidence.' });
    const out = proposeMemoryRules(ctx);
    assert.equal(out.mode, 'suggestions');
    const p = out.proposals.find((x) => x.kind === 'promote');
    assert.equal(p.topic, 'verify-gates');
    assert.equal(p.count, 2);
    assert.equal(p.suggestedRule.id, 'verify-gates');
    assert.match(p.suggestedRule.content, /> \*\*Status:\*\* Proposed/);
    assert.match(p.suggestedRule.content, /real command/);
    assert.equal(p.rule, null);
    // Nothing was written — no local rule, no memory changes.
    assert.equal(fs.existsSync(localRulesAbs(ctx)), false);
  } finally { cleanup(dir); }
});

test('memory proposals: identical texts dedupe into one evidence row', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const text = 'CAS conflicts must name the stored revision.';
    lesson(ctx, { topic: 'dedup-x', text });
    lesson(ctx, { topic: 'dedup-x', text });
    lesson(ctx, { topic: 'dedup-x', text });
    lesson(ctx, { topic: 'dedup-x', text: 'Second distinct lesson.' });
    const out = proposeMemoryRules(ctx);
    const p = out.proposals.find((x) => x.topic === 'dedup-x');
    assert.equal(p.count, 4);
    assert.equal(p.distinctTexts, 2);
    const dup = p.lessons.find((l) => l.text === text);
    assert.equal(dup.occurrences, 3);
  } finally { cleanup(dir); }
});

test('memory proposals: matching canonical rule turns into merge', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    // 'evidence' is a canonical rule — recurrent lessons on the topic
    // propose merging, not a colliding new id.
    lesson(ctx, { topic: 'evidence',
      text: 'New lesson the rule does not cover yet.' });
    lesson(ctx, { topic: 'evidence',
      text: 'Another uncovered evidence lesson.' });
    const out = proposeMemoryRules(ctx);
    const p = out.proposals.find((x) => x.topic === 'evidence');
    assert.equal(p.kind, 'merge');
    assert.equal(p.rule.id, 'evidence');
    assert.equal(p.rule.origin, 'canonical');
    assert.equal(p.suggestedRule, null);
    assert.equal(p.lessons.length, 2);
  } finally { cleanup(dir); }
});

test('memory proposals: fully ref\'d groups suppress as promoted', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const ref = 'resources/rules/evidence.md';
    lesson(ctx, { topic: 'evidence', text: 'Already in.', ref });
    lesson(ctx, { topic: 'evidence', text: 'Also already in.', ref });
    const out = proposeMemoryRules(ctx);
    assert.equal(out.proposals.length, 0);
    const s = out.suppressed.find((x) => x.group === 'evidence');
    assert.match(s.reason, /already promoted/);
  } finally { cleanup(dir); }
});

test('memory proposals: below minCount is suppressed, deterministic', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    lesson(ctx, { topic: 'solo', text: 'Only once.' });
    lesson(ctx, { topic: 'trio', text: 'A' });
    lesson(ctx, { topic: 'trio', text: 'B' });
    lesson(ctx, { topic: 'trio', text: 'C' });
    const a = proposeMemoryRules(ctx, { minCount: 3 });
    assert.equal(a.proposals.length, 1);
    assert.equal(a.proposals[0].topic, 'trio');
    const s = a.suppressed.find((x) => x.group === 'solo');
    assert.match(s.reason, /below minCount 3/);
    const b = proposeMemoryRules(ctx, { minCount: 3 });
    assert.deepEqual(a, b);
  } finally { cleanup(dir); }
});

test('memory proposals: merge via ref to a promotable rule', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    // Topic does not slug-match a rule, but a lesson ref points at the
    // canonical 'evidence' rule — the group merges into it.
    const ref = 'resources/rules/evidence.md';
    lesson(ctx, { topic: 'off-topic', text: 'Covered.', ref });
    lesson(ctx, { topic: 'off-topic',
      text: 'Not covered by the rule yet.' });
    const out = proposeMemoryRules(ctx);
    const p = out.proposals.find((x) => x.topic === 'off-topic');
    assert.equal(p.kind, 'merge');
    assert.equal(p.rule.id, 'evidence');
    // The already-ref'd lesson is not merge evidence.
    assert.deepEqual(p.lessons.map((l) => l.text),
      ['Not covered by the rule yet.']);
  } finally { cleanup(dir); }
});

test('memory proposals: identical text across groups lands in duplicates', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const shared = 'Shared statement under two topics.';
    lesson(ctx, { topic: 'alpha', text: shared });
    lesson(ctx, { topic: 'alpha', text: 'Alpha second.' });
    lesson(ctx, { topic: 'beta', text: shared });
    lesson(ctx, { topic: 'beta', text: 'Beta second.' });
    const out = proposeMemoryRules(ctx);
    const d = out.duplicates.find((x) => x.text === shared.toLowerCase());
    assert.deepEqual(d.groups, ['topic:alpha', 'topic:beta']);
    assert.equal(d.occurrences, 2);
  } finally { cleanup(dir); }
});

test('memory proposals: untopic\'d recurrence groups by exact text', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const text = 'No topic, recorded twice verbatim.';
    lesson(ctx, { text });
    lesson(ctx, { text });
    const out = proposeMemoryRules(ctx);
    const p = out.proposals.find((x) => x.kind === 'promote');
    assert.equal(p.topic, null);
    assert.equal(p.count, 2);
    assert.equal(p.distinctTexts, 1);
    // Suggested id derives from the text words, deterministically.
    assert.match(p.suggestedRule.id, /^[a-z0-9-]+$/);
  } finally { cleanup(dir); }
});

test('memory proposals: archived id collision reports conflict', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    writeFile(dir, 'd/r.md', '# Dead Rule\n\nbody\n');
    applyProposeRule(ctx, { input: 'd/r.md', id: 'dead-rule' });
    applyFlipRule(ctx, 'dead-rule', { revision: 1 }, 'active');
    applyFlipRule(ctx, 'dead-rule', { revision: 2 }, 'archived');
    lesson(ctx, { topic: 'dead-rule', text: 'New lesson one.' });
    lesson(ctx, { topic: 'dead-rule', text: 'New lesson two.' });
    const out = proposeMemoryRules(ctx);
    const p = out.proposals.find((x) => x.topic === 'dead-rule');
    // Not merge (archived is not promotable), and the suggested id
    // does NOT recycle the colliding name.
    assert.equal(p.kind, 'promote');
    assert.equal(p.conflict.ruleId, 'dead-rule');
    assert.equal(p.conflict.status, 'archived');
    assert.match(p.suggestedRule.id, /^lesson-[0-9a-f]{8}$/);
  } finally { cleanup(dir); }
});

test('memory proposals: skipped entries counted, cap flagged', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    // Structurally invalid JSON entry — counted, never silent. One
    // valid append creates the log first.
    lesson(ctx, { topic: 'hot', text: 'Distinct lesson seed.' });
    const logAbs = path.join(ctx.projectRoot,
      ctx.config.paths.memory, 'lessons.jsonl');
    fs.appendFileSync(logAbs, '{"text":5}\n', 'utf8');
    for (let i = 0; i < 12; i += 1) {
      lesson(ctx, { topic: 'hot', text: `Distinct lesson ${i}.` });
    }
    const out = proposeMemoryRules(ctx);
    assert.equal(out.source.skipped, 1);
    const p = out.proposals.find((x) => x.topic === 'hot');
    assert.equal(p.count, 13);
    assert.equal(p.distinctTexts, 13);
    assert.equal(p.lessons.length, 10); // MAX_EVIDENCE cap
    assert.equal(p.evidenceTruncated, true);
    // The draft still carries all 12 uncovered texts.
    assert.match(p.suggestedRule.content, /Distinct lesson 11/);
  } finally { cleanup(dir); }
});

test('memory proposals CLI: suggestive end to end, no writes', async () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    lesson(ctx, { topic: 'cli-topic', text: 'First.' });
    lesson(ctx, { topic: 'cli-topic', text: 'Second.' });
    const { run } = await import('../src/cli.mjs');
    const io = fakeIO();
    const code = await run(
      ['memory', 'proposals', '--project', dir], io);
    assert.equal(code, 0, io.out.stderr.join(''));
    const out = JSON.parse(io.out.stdout.join(''));
    assert.equal(out.mode, 'suggestions');
    assert.equal(out.proposals[0].kind, 'promote');
    assert.equal(fs.existsSync(localRulesAbs(ctx)), false);
  } finally { cleanup(dir); }
});
