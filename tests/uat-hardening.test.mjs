// SPDX-License-Identifier: Apache-2.0
// UAT regression coverage — defects found by real-user acceptance
// testing (UAT-hardening task): dead global flags (R1), unvalidated
// hunk counts (R2), doc alternations (R4), dry-run bypass (R5).
// R3 (variant surface selection) lives in host-activation.test.mjs;
// R6 (EPIPE) was verified live — an in-process run() cannot reproduce
// a closed downstream consumer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../src/cli.mjs';
import { parseUnifiedDiff, classifyRisk }
  from '../src/discovery/risk-assess.mjs';
import { scanDocText, extractCliVerbs }
  from '../src/core/docs-cli-drift.mjs';
import {
  DEFAULT_ANSWERS, bootstrappedCtx, cleanup, exists, fakeIO, writeJson,
} from './helpers.mjs';

const CLI_SRC = fs.readFileSync(
  new URL('../src/cli.mjs', import.meta.url), 'utf8');

function setLiteral(name) {
  const m = new RegExp(
    `const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(CLI_SRC);
  assert.ok(m, `${name} must exist in cli.mjs`);
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
}

// R1: parseArgs validates against the global flag sets BEFORE the
// per-command whitelist, so a spec-declared flag absent from the
// globals is dead on arrival. UAT found seven (--source, --out,
// --registry, --op, --id, --keep-files, --no-resume). The scan below
// makes the whole class impossible to reintroduce.
test('every command-spec flag exists in the global parser sets', () => {
  const globals = new Set([...setLiteral('VALUE_FLAGS'),
    ...setLiteral('BOOL_FLAGS'), ...setLiteral('REJECTED_FLAGS')]);
  const missing = [];
  // Spec literals (`flags: [...]`) plus the workflow-alias flag set —
  // both are validated by parseArgs before dispatch.
  const alias = /const WORKFLOW_ALIAS_FLAGS = \[([\s\S]*?)\]/.exec(CLI_SRC);
  assert.ok(alias, 'WORKFLOW_ALIAS_FLAGS must exist in cli.mjs');
  const sources = [...CLI_SRC.matchAll(/flags:\s*\[([^\]]*)\]/g),
    alias];
  for (const m of sources) {
    for (const f of m[1].matchAll(/'(--[a-z][a-z-]*)'/g)) {
      if (!globals.has(f[1])) missing.push(f[1]);
    }
  }
  assert.deepEqual([...new Set(missing)], [],
    'command flags missing from the global parser sets');
});

// R2: declared hunk counts are validated against consumed lines —
// a truncated or overstated hunk is malformed => undecidable, never
// passive (UAT: `@@ -1,5 +1,9 @@` with 2 lines classified 'passive').
const rel = (p, hunks) => [
  `diff --git a/${p} b/${p}`, `--- a/${p}`, `+++ b/${p}`, ...hunks,
].join('\n');

test('truncated hunk marks the file malformed => not passive', () => {
  const r = classifyRisk(parseUnifiedDiff(rel('docs/x.md', [
    '@@ -1,5 +1,9 @@', ' ctx', '+one',
  ])));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'undecidable'));
});

test('well-formed multi-hunk diff parses without malformed flag', () => {
  const parsed = parseUnifiedDiff(rel('docs/x.md', [
    '@@ -1,1 +1,2 @@', ' ctx', '+one',
    '@@ -10,2 +10,2 @@', '-gone', '+two', ' more',
  ]));
  assert.equal(parsed.files[0].malformed, false);
  assert.equal(parsed.files[0].added, 2);
  assert.equal(parsed.files[0].removed, 1);
});

test('single-count and default-count hunk headers are honoured', () => {
  // `@@ -1 +1,2 @@` means 1 old line, 2 new lines.
  const parsed = parseUnifiedDiff(rel('docs/x.md', [
    '@@ -1 +1,2 @@', '-old', '+new', '+extra',
  ]));
  assert.equal(parsed.files[0].malformed, false);
});

test('unparseable hunk header fails closed, not tolerated', () => {
  const r = classifyRisk(parseUnifiedDiff(rel('docs/x.md', [
    '@@ garbage @@', '+one',
  ])));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'undecidable'));
});

// R4: doc invocations may use `|` alternation between verb parts —
// each alternative is credited independently, and an alternative that
// names no real verb is still stale (UAT false positive:
// `constitution show|set` reported as a single nonexistent verb).
const VERBS = new Set(extractCliVerbs(CLI_SRC));
const fenced = (body) => `\`\`\`bash\nscopegrain ${body}\n\`\`\`\n`;

test('pipe alternations credit each real verb, none stale', () => {
  const r = scanDocText(fenced('constitution show|set --input f.json'), VERBS);
  assert.deepEqual([...r.stale], []);
  assert.ok(r.referenced.has('constitution show'));
  assert.ok(r.referenced.has('constitution set'));
});

test('invocations naming no real verb remain stale', () => {
  const r = scanDocText(fenced('frobnicate --now'), VERBS);
  assert.ok([...r.stale].length > 0);
});

test('mixed alternation credits the real half and flags the bogus half', () => {
  const r = scanDocText(
    fenced('constitution show') + fenced('constitution bogus'), VERBS);
  assert.ok(r.referenced.has('constitution show'));
  assert.ok([...r.stale].some((s) => s.includes('bogus')));
});

test('alternation edge forms: full-prefix right side and empty parts', () => {
  // 'activate|extension-deactivate': the right side already carries the
  // shared prefix and is used verbatim — not 'extension-extension-*'.
  const r = scanDocText(
    fenced('dist extension-activate|extension-deactivate'), VERBS);
  assert.deepEqual([...r.stale], []);
  // Trailing 'a|' produces no empty stale candidate.
  const t = scanDocText(fenced('constitution show|'), VERBS);
  assert.ok(![...t.stale].includes(''));
});

test('extra file headers inside or after a hunk mark malformed', () => {
  // A second '--- '/'+++ ' pair at file level, or one after a hunk,
  // means the diff is crafted or truncated — never silently skipped.
  const crafted = [
    'diff --git a/docs/x.md b/docs/x.md',
    '--- a/docs/x.md', '+++ b/docs/x.md',
    '@@ -1 +1,2 @@', '-old', '+new', '+extra',
    '+++spawn(hostile)',
  ].join('\n');
  const r = classifyRisk(parseUnifiedDiff(crafted));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'undecidable'));
});

// R5: `task checklist --input` and `specification clarify --input`
// follow the preview convention — nothing is written without --apply
// (UAT: both mutated immediately on a bare invocation).
const checklistInput = (taskId) => ({
  taskId, title: 'UAT checklist', items: [{ text: 'verify thing' }],
});

async function invoke(dir, args, expected = 0) {
  const io = fakeIO();
  const code = await run([...args, '--project', dir], io);
  assert.equal(code, expected, io.out.stderr.join('\n'));
  return io;
}

test('task checklist previews without --apply; --apply writes', async () => {
  // 'manual' mode: a plain task needs no assessment or formal pair.
  const f = bootstrappedCtx({
    ...DEFAULT_ANSWERS, hosts: ['claude'], methodology: 'manual',
  });
  try {
    const taskFile = writeJson(f.dir, '.inputs/task.json', {
      title: 'T', contract: 'C', authorContext: 'u', scope: ['src/a'],
    });
    const created = JSON.parse((await invoke(f.dir,
      ['task', 'create', '--input', taskFile, '--apply'],
    )).out.stdout.at(-1));
    const chkFile = writeJson(f.dir, '.inputs/chk.json',
      checklistInput(created.task.id));

    const dry = JSON.parse((await invoke(f.dir,
      ['task', 'checklist', '--input', chkFile],
    )).out.stdout.at(-1));
    assert.equal(dry.applied, false);
    assert.equal(exists(f.dir, '.scopegrain/checklists'), false);

    const applied = JSON.parse((await invoke(f.dir,
      ['task', 'checklist', '--input', chkFile, '--apply'],
    )).out.stdout.at(-1));
    assert.equal(applied.applied, true);
    assert.equal(exists(f.dir, '.scopegrain/checklists'), true);
  } finally { cleanup(f.dir); }
});

test('specification clarify previews without --apply; --apply writes', async () => {
  const f = bootstrappedCtx({
    ...DEFAULT_ANSWERS, hosts: ['claude'], methodology: 'organic-sdd',
  });
  try {
    const specFile = writeJson(f.dir, '.inputs/spec.json', {
      originalRequest: 'r', title: 'S',
      outcome: { statement: 'o', evidencePlan: 'e' },
      requirements: [{ id: 'R1', statement: 's',
        scenarios: [{ id: 'S1', given: 'g', when: 'w', then: 't' }] }],
      scope: ['src/a'], openQuestions: [],
    });
    const created = JSON.parse((await invoke(f.dir,
      ['specification', 'create', '--input', specFile, '--apply'],
    )).out.stdout.at(-1));
    const clrFile = writeJson(f.dir, '.inputs/clr.json', {
      specId: created.artifact.id,
      entries: [{ question: 'q?', answer: 'a.' }],
    });

    const dry = JSON.parse((await invoke(f.dir,
      ['specification', 'clarify', '--input', clrFile],
    )).out.stdout.at(-1));
    assert.equal(dry.applied, false);
    const clrDir = path.join(f.dir, '.scopegrain', 'clarifications');
    assert.equal(fs.existsSync(clrDir), false);

    const applied = JSON.parse((await invoke(f.dir,
      ['specification', 'clarify', '--input', clrFile, '--apply'],
    )).out.stdout.at(-1));
    assert.equal(applied.applied, true);
    assert.equal(fs.existsSync(clrDir), true);
  } finally { cleanup(f.dir); }
});
