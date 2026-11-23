// SPDX-License-Identifier: Apache-2.0
// Per-kind file-format contract for the canonical resource bundle
// (documented in resources/README.md). Rules and references are
// deliberately flat Markdown bundled as body text; commands, skills,
// agents and prompts carry a YAML frontmatter fence with flat 'name'
// and 'description' scalars because hosts project them as individually
// selectable units.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RESOURCES = path.join(ROOT, 'resources');

const FLAT_DIRS = ['rules', 'references'];
const FENCED_DIRS = ['commands', 'agents', 'prompts'];
const FENCE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

function mdFiles(dir) {
  const abs = path.join(RESOURCES, dir);
  return fs.readdirSync(abs)
    .filter((f) => f.endsWith('.md') && fs.lstatSync(path.join(abs, f)).isFile())
    .map((f) => path.join(abs, f));
}

function skillFiles() {
  const abs = path.join(RESOURCES, 'skills');
  const out = [];
  for (const d of fs.readdirSync(abs)) {
    const p = path.join(abs, d, 'SKILL.md');
    if (fs.lstatSync(p, { throwIfNoEntry: false })?.isFile()) out.push(p);
  }
  return out;
}

test('rules and references stay flat Markdown without frontmatter', () => {
  for (const dir of FLAT_DIRS) {
    const files = mdFiles(dir);
    assert.ok(files.length > 0, `no .md files under resources/${dir}`);
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      assert.ok(!FENCE.test(text),
        `${path.relative(ROOT, f)} carries a frontmatter fence — flat ` +
        `format is deliberate (resources/README.md); descriptions live ` +
        `in manifest.json only`);
    }
  }
});

test('commands, agents, prompts and skills carry name/description frontmatter', () => {
  const files = [
    ...FENCED_DIRS.flatMap(mdFiles),
    ...skillFiles(),
  ];
  assert.ok(files.length > 0);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const m = FENCE.exec(text);
    assert.ok(m, `${path.relative(ROOT, f)} lacks a frontmatter fence`);
    const head = m[0];
    assert.match(head, /^name:[ \t]*\S/m,
      `${path.relative(ROOT, f)} frontmatter lacks 'name'`);
    assert.match(head, /^description:[ \t]*\S/m,
      `${path.relative(ROOT, f)} frontmatter lacks 'description'`);
  }
});
