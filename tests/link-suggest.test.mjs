// SPDX-License-Identifier: Apache-2.0
// `task link-suggest` + suggestTaskLinks: read-only candidate edges —
// plan-DAG gaps, title similarity (supersedes vs ABANDON, see between
// open). Never writes, never re-suggests a declared edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { run } from '../src/cli.mjs';
import { suggestTaskLinks } from '../src/core/link-suggest.mjs';
import {
  VALID_ANSWERS, cleanup, fakeIO, makeTempDir,
} from './helpers.mjs';

const lastJson = (io) => JSON.parse(io.out.stdout[io.out.stdout.length - 1]);

const rec = (id, title, extra = {}) => ({ id, title, state: 'ACT', ...extra });

test('suggestTaskLinks: plan-dag gap, title-sim, declared dedup, cap', () => {
  const plan = {
    key: 'demo', tasks: [
      { key: 'a', id: 'ta', dependsOn: ['b'] },
      { key: 'b', id: 'tb', dependsOn: [] },
    ],
  };
  const tasks = [
    rec('ta', 'Build the parser'),
    rec('tb', 'Lexer groundwork'),
    rec('tc', 'Viewer polish pass'),
    rec('td', 'Viewer polish pass', { state: 'ABANDON' }),
    rec('te', 'Unrelated scope audit'),
    // declared edge must never be re-suggested
    rec('tf', 'Depends already', { dependsOn: ['te'] }),
  ];

  const s = suggestTaskLinks({ tasks, plans: [plan] });
  const gap = s.find((x) => x.reason === 'plan-dag');
  assert.ok(gap, 'plan-dag edge missing from record should be suggested');
  assert.equal(gap.sourceId, 'ta');
  assert.equal(gap.targetId, 'tb');
  assert.equal(gap.kind, 'dependsOn');

  const sup = s.find((x) => x.kind === 'supersedes');
  assert.ok(sup, 'open re-registration of an ABANDON title → supersedes');
  assert.equal(sup.sourceId, 'tc');
  assert.equal(sup.targetId, 'td');
  assert.ok(sup.evidence.similarity >= 0.8);

  assert.ok(!s.some((x) => x.sourceId === 'tf'),
    'declared dependsOn must not resurface as a suggestion');

  // Declared relations also block re-suggestion.
  const s2 = suggestTaskLinks({
    tasks: tasks.map((t) => t.id === 'tc'
      ? { ...t, relations: { supersedes: ['td'] } } : t),
    plans: [],
  });
  assert.ok(!s2.some((x) => x.sourceId === 'tc' && x.targetId === 'td'));
});

test('task link-suggest: empty, fires on twin titles, dedups declared', async () => {
  const dir = makeTempDir('link-suggest');
  const answersFile = `${dir}-answers.json`;
  fs.writeFileSync(answersFile, JSON.stringify(VALID_ANSWERS, null, 2));
  try {
    const ioI = fakeIO();
    assert.equal(await run(['init', '--project', dir, '--answers',
      answersFile, '--apply'], ioI), 0);

    let io = fakeIO();
    assert.equal(await run(['task', 'link-suggest', '--project', dir], io), 0);
    assert.deepEqual(lastJson(io).suggestions, []);

    const create = async (title) => {
      const ioC = fakeIO();
      assert.equal(await run(['task', 'create', '--project', dir,
        '--title', title, '--contract', 'C', '--author', 'ctx-a',
        '--scope', 'src/x', '--apply'], ioC), 0);
      return (lastJson(ioC).task ?? lastJson(ioC)).id;
    };
    const a = await create('Render pipeline cleanup pass');
    const b = await create('Render pipeline cleanup pass');

    io = fakeIO();
    assert.equal(await run(['task', 'link-suggest', '--project', dir], io), 0);
    const out = lastJson(io);
    const twin = out.suggestions.find(
      (x) => new Set([x.sourceId, x.targetId]).size === 2
        && [x.sourceId, x.targetId].every(
          (id) => id === a || id === b));
    assert.ok(twin, 'identical open titles should suggest a link');
    assert.equal(twin.kind, 'see');
    // Applying the hint removes it — the verb itself never wrote.
    const [src, tgt] = [twin.sourceId, twin.targetId];
    const ioL = fakeIO();
    assert.equal(await run(['task', 'link', '--project', dir, src, tgt,
      '--kind', 'see', '--revision', '0', '--apply'], ioL), 0);
    io = fakeIO();
    assert.equal(await run(['task', 'link-suggest', '--project', dir], io), 0);
    assert.ok(!lastJson(io).suggestions.some(
      (x) => x.sourceId === src && x.targetId === tgt));
  } finally {
    cleanup(dir, `${dir}-answers.json`);
  }
});
