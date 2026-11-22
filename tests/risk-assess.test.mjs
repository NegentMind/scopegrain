// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnifiedDiff, classifyRisk }
  from '../src/discovery/risk-assess.mjs';

const diff = (path, { mode, added = [], removed = 0, binary = false } = {}) => {
  const lines = [`diff --git a/${path} b/${path}`];
  if (mode) lines.push(`new mode ${mode}`);
  if (binary) lines.push('Binary files a/x and b/x differ');
  lines.push('--- a/' + path, '+++ b/' + path,
    `@@ -1,${removed + 1} +1,${added.length + 1} @@`);
  for (let i = 0; i < removed; i++) lines.push('-old line ' + i);
  for (const a of added) lines.push('+' + a);
  return lines.join('\n');
};

// R1/S1: security path signal.
test('security path emits security reason', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('src/auth/token.js', { added: ['const t = 1;'] })));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'security'
    && x.path === 'src/auth/token.js'));
});

// R1/S2: CI workflow -> delivery, never passive.
test('workflow file yields delivery reason', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('.github/workflows/ci.yml', { added: ['on: push'] })));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'delivery'));
});

// R1/S3: public contract manifest.
test('resources/manifest.json yields public-contract reason', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('resources/manifest.json', { added: ['{}'] })));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'public-contract'));
});

// R2/S1: process-boundary call -> high with detail.
test('spawn call yields process-boundary at high', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('src/x.js', { added: ["const p = child_process.spawn('git');"] })));
  assert.equal(r.risk, 'high');
  const pb = r.reasons.find((x) => x.signal === 'process-boundary');
  assert.ok(pb && pb.detail.includes('spawn'));
});

// R2/S2: documented exclusion does not trip the signal.
test('re.exec exclusion stays quiet', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('notes/util.py', { added: ['m = re.exec(p, s)'] })));
  assert.ok(!r.reasons.some((x) => x.signal === 'process-boundary'));
});

// R3/S1: mode change to executable.
test('new mode 100755 emits executable-mode', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('deploy/run.sh', { mode: '100755', added: ['echo hi'] })));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'executable-mode'
    && x.path === 'deploy/run.sh'));
});

// R4/S1: provably passive docs -> passive tier.
test('plain markdown docs classify passive', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('docs/usage.md', { added: ['# Title', 'text'] })));
  assert.equal(r.risk, 'passive');
  assert.equal(r.review_due.value, false);
  assert.equal(r.review_due.reason, 'passive');
});

// R4/S2: shebang inside .md is not passive.
test('shebang in markdown is never passive', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('docs/run.md', { added: ['#!/bin/bash', 'echo hi'] })));
  assert.notEqual(r.risk, 'passive');
});

// R5/S1: high tier -> review_due true/high_risk.
test('high tier maps review_due high_risk', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('src/auth/a.js', { added: ['x'] })));
  assert.equal(r.review_due.value, true);
  assert.equal(r.review_due.reason, 'high_risk');
});

// R5/S2: medium tier -> review_due under_budget.
test('medium tier maps review_due under_budget', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('src/plain.js', { added: ['const x = 1;'] })));
  assert.equal(r.risk, 'medium');
  assert.equal(r.review_due.value, false);
  assert.equal(r.review_due.reason, 'under_budget');
});

// R5/S3: determinism — same diff, same envelope.
test('classification is deterministic', () => {
  const d = diff('src/auth/a.js', { added: ['x', 'y'] });
  const a = classifyRisk(parseUnifiedDiff(d));
  const b = classifyRisk(parseUnifiedDiff(d));
  assert.deepEqual(a, b);
});

// R7/S1: empty/garbage input is never passive.
test('empty diff fails closed to high', () => {
  const r = classifyRisk(parseUnifiedDiff('not a diff at all'));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'undecidable'));
});

// R7/S2: binary content is undecidable -> not passive.
test('binary file is not passive', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('assets/logo.png', { binary: true })));
  assert.notEqual(r.risk, 'passive');
});

// R8/S1: classifyRisk runs on structured input only — no git, no fs.
test('classifyRisk consumes a structured file list directly', () => {
  const r = classifyRisk({ files: [
    { path: 'src/a.js', oldMode: null, newMode: null, added: 1,
      removed: 0, addedLines: ['x'], binary: false },
  ] });
  assert.equal(r.risk, 'medium');
});

// concurrency hint raises tier out of passive.
test('concurrency primitive is not passive', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('src/pool.js', { added: ['const m = new Mutex();'] })));
  assert.notEqual(r.risk, 'passive');
});

// --- review-driven regressions (fresh review E5, 2026-11-21) -----------

// GIT binary patch payloads are undecidable, not silently medium.
test('GIT binary patch is undecidable -> high', () => {
  const d = 'diff --git a/assets/logo.png b/assets/logo.png\n'
    + 'new file mode 100644\nGIT binary patch\nliteral 4\nabc\n';
  const r = classifyRisk(parseUnifiedDiff(d));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'undecidable'));
});

// A new executable file without .sh extension still trips exec-mode.
test('new file mode 100755 emits executable-mode', () => {
  const d = 'diff --git a/install b/install\nnew file mode 100755\n'
    + '--- /dev/null\n+++ b/install\n@@ -0,0 +1,1 @@\n+echo hi\n';
  const r = classifyRisk(parseUnifiedDiff(d));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'executable-mode'));
});

// Added lines starting with ++ inside a hunk are content, not headers.
test('added ++i; line is counted and scanned', () => {
  const d = 'diff --git a/x.c b/x.c\n--- a/x.c\n+++ b/x.c\n'
    + '@@ -1,2 +1,3 @@\n ctx\n+++i;\n+exec(cmd);\n';
  const p = parseUnifiedDiff(d);
  assert.equal(p.files[0].added, 2);
  const r = classifyRisk(p);
  assert.ok(r.reasons.some((x) => x.signal === 'process-boundary'
    && x.detail.includes('exec(cmd)')));
});

// CRLF diffs must not neutralise anchored path/mode signals.
test('CRLF diff still detects shell source', () => {
  const d = diff('tools/run.sh', { added: ['echo hi'] })
    .replace(/\n/g, '\r\n');
  const r = classifyRisk(parseUnifiedDiff(d));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'delivery'));
});

// Bare exec( / system( calls are process boundaries too.
test('bare exec( is a process boundary', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('src/x.py', { added: ['exec(user_input)'] })));
  assert.ok(r.reasons.some((x) => x.signal === 'process-boundary'));
});
test('bare system( is a process boundary', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('src/x.c', { added: ['system("ls");'] })));
  assert.ok(r.reasons.some((x) => x.signal === 'process-boundary'));
});

// azure-pipelines and other CI file shapes are delivery signals.
test('azure-pipelines.yml yields delivery reason', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('azure-pipelines.yml', { added: ['trigger: main'] })));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'delivery'));
});

// Exclusion applies per token, not per line: a real boundary on the same
// line as an excluded call still flags.
test('db.exec + spawn on one line still flags', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('src/x.js', { added: ["db.exec(q); spawn(c);"] })));
  assert.ok(r.reasons.some((x) => x.signal === 'process-boundary'));
});

// Rename keeps the security signal of the old path.
test('rename auth->docs keeps security signal', () => {
  const d = 'diff --git a/src/auth/x.js b/docs/x.md\n'
    + 'rename from src/auth/x.js\nrename to docs/x.md\n';
  const r = classifyRisk(parseUnifiedDiff(d));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'security'
    && x.path === 'src/auth/x.js'));
});

// Extension-less files inside docs dirs are passive-eligible.
test('docs/INSTALL without extension is passive', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('docs/INSTALL', { added: ['step one'] })));
  assert.equal(r.risk, 'passive');
});

// Content-shaped lines outside any hunk mark the file malformed —
// undecidable, never passive.
test('lines outside hunk are undecidable', () => {
  const d = 'diff --git a/docs/x.md b/docs/x.md\n--- a/docs/x.md\n'
    + '+++ b/docs/x.md\n@@ -1,1 +1,2 @@\n ctx\n\n+#!/bin/sh\n';
  const r = classifyRisk(parseUnifiedDiff(d));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'undecidable'));
});

// Module purity: no fs/child_process imports anywhere in the source.
test('classifier module imports no fs or child_process', async () => {
  const src = (await import('node:fs'))
    .readFileSync(new URL('../src/discovery/risk-assess.mjs',
      import.meta.url), 'utf8');
  assert.ok(!/from\s+['"]node:(fs|child_process)['"]/.test(src)
    && !/require\s*\(\s*['"](node:)?(fs|child_process)['"]/.test(src),
    'module must stay pure/read-only by construction');
});
