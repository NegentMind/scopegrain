// SPDX-License-Identifier: Apache-2.0
// Audit-driven regressions: widened security/delivery path tables, the
// dangerous-API signal on added lines, quoted diff --git headers, and
// the concurrency signal made effective.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnifiedDiff, classifyRisk }
  from '../src/discovery/risk-assess.mjs';

const diff = (path, { added = [], removed = 0 } = {}) => {
  const lines = [`diff --git a/${path} b/${path}`];
  lines.push('--- a/' + path, '+++ b/' + path,
    `@@ -1,${removed + 1} +1,${added.length + 1} @@`);
  // Declared counts include one context line — it must be emitted or the
  // hunk is overstated and the file turns malformed.
  lines.push(' ctx');
  for (let i = 0; i < removed; i++) lines.push('-old line ' + i);
  for (const a of added) lines.push('+' + a);
  return lines.join('\n');
};

// --- widened SECURITY_PATH (P0 false negatives) -----------------------

for (const p of [
  'src/session/store.js', 'src/oauth/flow.js', 'src/jwt/verify.js',
  'src/middleware/authz.js', 'src/rbac/roles.js', 'src/login/form.tsx',
  'src/saml/sso.py', 'src/acl/check.go', 'src/policy/rules.mjs',
  'src/tls/config.js', 'src/certs/ca.pem.txt', 'src/authn/idp.js',
]) {
  test(`security path ${p} classifies high`, () => {
    const r = classifyRisk(parseUnifiedDiff(
      diff(p, { added: ['const x = 1;'] })));
    assert.equal(r.risk, 'high');
    assert.ok(r.reasons.some((x) => x.signal === 'security'
      && x.path === p));
  });
}

for (const p of ['.env', '.env.local', 'config/.env', 'app.env', '.envrc']) {
  test(`env-adjacent path ${p} classifies high`, () => {
    const r = classifyRisk(parseUnifiedDiff(
      diff(p, { added: ['KEY=1'] })));
    assert.equal(r.risk, 'high');
    assert.ok(r.reasons.some((x) => x.signal === 'security'));
  });
}

// --- widened DELIVERY_PATH --------------------------------------------

for (const p of [
  'Makefile', 'src/GNUmakefile', 'packaging/pkg.spec', 'systemd/app.service',
  '.github/actions/build/action.yml', '.github/dependabot.yml',
  'renovate.json', '.renovaterc', 'tools/renovate/presets.json',
]) {
  test(`delivery path ${p} classifies high`, () => {
    const r = classifyRisk(parseUnifiedDiff(
      diff(p, { added: ['x'] })));
    assert.equal(r.risk, 'high');
    assert.ok(r.reasons.some((x) => x.signal === 'delivery'));
  });
}

// --- dangerous-api table: added lines only ----------------------------

for (const line of [
  'eval(userInput)', 'const f = new Function("x", "return x")',
  'data = pickle.loads(blob)', 'doc = yaml.load(raw)',
  '$x = unserialize($s);', 'https.request({ rejectUnauthorized: false })',
  'requests.get(u, verify=False)', 'chmod 777 /tmp/out',
]) {
  test(`added "${line.slice(0, 40)}" yields dangerous-api at high`, () => {
    const r = classifyRisk(parseUnifiedDiff(
      diff('src/x.js', { added: [line] })));
    assert.equal(r.risk, 'high');
    const d = r.reasons.find((x) => x.signal === 'dangerous-api');
    assert.ok(d && d.path === 'src/x.js');
    assert.equal(r.review_due.value, true);
  });
}

test('removed-only dangerous call does not flag dangerous-api', () => {
  const d = 'diff --git a/src/x.js b/src/x.js\n--- a/src/x.js\n'
    + '+++ b/src/x.js\n@@ -1,2 +1,1 @@\n ctx\n-eval(userInput)\n';
  const r = classifyRisk(parseUnifiedDiff(d));
  assert.ok(!r.reasons.some((x) => x.signal === 'dangerous-api'));
  assert.equal(r.risk, 'medium');
});

test('retrieval( is not an eval( false positive', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('src/x.js', { added: ['retrieval(query)'] })));
  assert.ok(!r.reasons.some((x) => x.signal === 'dangerous-api'));
});

// --- quoted / non-standard headers (fail-open -> undecidable) ----------

test('quoted non-ASCII path is undecidable, never dropped', () => {
  const d = 'diff --git "a/docs/caf\\303\\251.md" "b/docs/caf\\303\\251.md"\n'
    + '--- "a/docs/caf\\303\\251.md"\n+++ "b/docs/caf\\303\\251.md"\n'
    + '@@ -1,1 +1,2 @@\n ctx\n+texto\n';
  const r = classifyRisk(parseUnifiedDiff(d));
  assert.equal(r.risk, 'high');
  assert.ok(r.changed_paths.includes('docs/café.md'));
  assert.ok(r.reasons.some((x) => x.signal === 'undecidable'
    && x.path === 'docs/café.md'));
});

test('mixed quoted/unquoted header is undecidable', () => {
  const d = 'diff --git "a/old caf\\303\\251" b/plain.js\n'
    + 'rename from old caf\\303\\251\nrename to plain.js\n';
  const r = classifyRisk(parseUnifiedDiff(d));
  assert.equal(r.risk, 'high');
  assert.equal(r.changed_paths.length, 1);
  assert.ok(r.reasons.some((x) => x.signal === 'undecidable'));
});

test('unparseable diff --git header reports a file, not silence', () => {
  const d = 'diff --git bogus\n@@ -1,1 +1,1 @@\n ctx\n';
  const r = classifyRisk(parseUnifiedDiff(d));
  assert.equal(r.risk, 'high');
  assert.equal(r.changed_paths.length, 1);
  assert.ok(r.reasons.some((x) => x.signal === 'undecidable'));
});

test('combined-diff header (diff --cc) is undecidable', () => {
  const d = 'diff --cc merge.c\n--- a/merge.c\n+++ b/merge.c\n';
  const r = classifyRisk(parseUnifiedDiff(d));
  assert.equal(r.risk, 'high');
  assert.ok(r.changed_paths.includes('merge.c'));
  assert.ok(r.reasons.some((x) => x.signal === 'undecidable'));
});

// --- concurrency signal made effective ---------------------------------

// Choice: 'concurrency' joins the HIGH set rather than a weaker
// review_due-only bump — policy/methodology.json lists concurrency as a
// first-class risk category, and every other recognised risk surface in
// this classifier already maps to high. A weaker mapping would keep the
// signal half-inert.
test('concurrency hint now classifies high with review_due', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('src/pool.js', { added: ['const m = new Mutex();'] })));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'concurrency'));
  assert.equal(r.review_due.value, true);
  assert.equal(r.review_due.reason, 'high_risk');
});

test('concurrency hint lifts even docs-passive files out of passive', () => {
  const r = classifyRisk(parseUnifiedDiff(
    diff('docs/design.md', { added: ['the mutex guards the queue'] })));
  assert.equal(r.risk, 'high');
  assert.ok(r.reasons.some((x) => x.signal === 'concurrency'));
});
