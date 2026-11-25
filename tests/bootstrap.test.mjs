// SPDX-License-Identifier: Apache-2.0
// Init plan cases (implementation contract cases 8-9 plus reworked gates).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan, prepareInit as prepareLegacyInit } from '../src/core/bootstrap.mjs';
import {
  VALID_ANSWERS, cleanup, exists, makeTempDir, readJson, trySymlink,
  writeFile, writeJson,
} from './helpers.mjs';

function prepareInit(options) {
  return prepareLegacyInit({ configRel: '.scopegrain/config.json', ...options });
}

const GEN = [
  '.scopegrain/config.json',
  '.scopegrain/instructions.md',
  '.scopegrain/discovery.json',
  '.scopegrain/task-contract.md',
  '.scopegrain/integrations/claude-mcp.json',
  '.scopegrain/integrations/codex-mcp.toml',
  '.scopegrain/integrations/opencode-mcp.json',
  '.scopegrain/integrations/devin-mcp.json',
  '.scopegrain/skills/project-onboarding/SKILL.md',
  '.scopegrain/skills/contract-execution/SKILL.md',
  '.scopegrain/skills/independent-review/SKILL.md',
  'AGENTS.md',
  'CLAUDE.md',
];

test('prepareInit is a pure dry-run: nothing is written', () => {
  const dir = makeTempDir('init-dry');
  try {
    const prepared = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    const rels = prepared.files.map((f) => f.rel);
    for (const rel of GEN) assert.ok(rels.includes(rel), `${rel} planned`);
    assert.ok(rels.includes('.scopegrain/catalog.json'));
    assert.ok(rels.includes('.scopegrain/.gitignore'));
    assert.ok(rels.includes('.scopegrain/integrations/gitignore-proposal.txt'));
    assert.ok(rels.some((r) => r.startsWith('.scopegrain/commands/')));
    assert.ok(rels.some((r) => r.startsWith('.scopegrain/skills/')));
    for (const rel of rels) assert.ok(!exists(dir, rel), `${rel} must not exist`);
  } finally { cleanup(dir); }
});

test('apply creates all files; re-run on empty project is a true no-op', () => {
  const dir = makeTempDir('init-apply');
  try {
    const first = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    const result = applyPlan(dir, first.files);
    assert.equal(result.created, first.files.length);
    for (const rel of GEN) assert.ok(exists(dir, rel), `${rel} must exist`);
    const config = readJson(dir, '.scopegrain/config.json');
    assert.equal(config.project.name, 'fixture-project');
    const before = fs.readFileSync(`${dir}/.scopegrain/discovery.json`);
    const cfgBefore = fs.readFileSync(`${dir}/.scopegrain/config.json`);
    const second = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    assert.ok(second.files.every((f) => f.action === 'noop'));
    const r2 = applyPlan(dir, second.files);
    assert.equal(r2.created, 0);
    assert.ok(fs.readFileSync(`${dir}/.scopegrain/discovery.json`).equals(before));
    assert.ok(fs.readFileSync(`${dir}/.scopegrain/config.json`).equals(cfgBefore));
  } finally { cleanup(dir); }
});

test('generated entrypoint and instructions carry the intake pointer', () => {
  const dir = makeTempDir('init-intake');
  try {
    applyPlan(dir, prepareInit({ projectRoot: dir, answers: VALID_ANSWERS }).files);
    const agents = fs.readFileSync(`${dir}/AGENTS.md`, 'utf8');
    assert.match(agents, /Request intake/);
    assert.match(agents, /intake\.mode/);
    const instructions =
      fs.readFileSync(`${dir}/.scopegrain/instructions.md`, 'utf8');
    assert.match(instructions, /Request intake/);
    assert.match(instructions, /bookkeeping, not implementation authority/);
  } finally { cleanup(dir); }
});

test('generated entrypoint carries the self-repair section', () => {
  const dir = makeTempDir('init-selfrepair');
  try {
    applyPlan(dir, prepareInit({ projectRoot: dir, answers: VALID_ANSWERS }).files);
    const agents = fs.readFileSync(`${dir}/AGENTS.md`, 'utf8');
    assert.match(agents, /Self-repair/);
    assert.match(agents, /doctor --project \./);
    assert.match(agents, /node <checkout>\/bin\/scopegrain\.mjs/);
  } finally { cleanup(dir); }
});

test('re-init preserves custom formatting and approved commands', () => {
  const dir = makeTempDir('init-preserve');
  try {
    applyPlan(dir, prepareInit({ projectRoot: dir, answers: VALID_ANSWERS }).files);
    // User edits config: custom whitespace AND approved verification entry.
    const custom = '{\n"schemaVersion":1,"project":{"name":"fixture-project","root":"."},\n"locale":"es","hosts":["claude","codex","opencode","devin"],\n"paths":{"plans":"docs/agent/plans","tasks":"docs/agent/tasks","reports":"docs/agent/reports","research":"docs/agent/research","decisions":"docs/agent/decisions","memory":".scopegrain/memory","state":".scopegrain/state"},\n"verification":{"mode":"manual","commands":[{"command":"npm test","cwd":".","approved":true}]},\n"discovery":{"fingerprint":"%F%","stacks":[],"evidence":[]}\n}\n';
    const stored = readJson(dir, '.scopegrain/config.json');
    const withFp = custom.replace('%F%', stored.discovery.fingerprint);
    writeFile(dir, '.scopegrain/config.json', withFp);
    const second = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    const cfgFile = second.files.find((f) => f.rel === '.scopegrain/config.json');
    assert.equal(cfgFile.action, 'noop');
    const kept = readJson(dir, '.scopegrain/config.json');
    assert.equal(kept.verification.commands[0].approved, true);
  } finally { cleanup(dir); }
});

test('pre-existing README does not block; pre-existing AGENTS.md does', () => {
  const dir = makeTempDir('init-readme');
  try {
    writeFile(dir, 'README.md', '# user readme\n');
    const prepared = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    assert.ok(prepared.files.length > 0); // README is evidence, not a conflict
    writeFile(dir, 'AGENTS.md', '# pre-existing rules\n');
    assert.throws(
      () => prepareInit({ projectRoot: dir, answers: VALID_ANSWERS }),
      (e) => e.code === 'PLAN_CONFLICT'
        && e.conflicts.some((c) => c.path === 'AGENTS.md'));
    for (const rel of GEN.filter((p) => p !== 'AGENTS.md')) {
      assert.ok(!exists(dir, rel), `${rel} must not have been created`);
    }
  } finally { cleanup(dir); }
});

test('existing config with different answers is an explicit error', () => {
  const dir = makeTempDir('init-diff');
  try {
    applyPlan(dir, prepareInit({ projectRoot: dir, answers: VALID_ANSWERS }).files);
    const changed = { ...VALID_ANSWERS, name: 'renamed-project' };
    assert.throws(
      () => prepareInit({ projectRoot: dir, answers: changed }),
      (e) => e.code === 'INIT_CONFLICT');
  } finally { cleanup(dir); }
});

test('claude-only project gets CLAUDE.md AND the universal AGENTS.md', () => {
  const dir = makeTempDir('init-claude');
  try {
    const answers = { ...VALID_ANSWERS, hosts: ['claude'] };
    const prepared = prepareInit({ projectRoot: dir, answers });
    const names = prepared.files.map((f) => f.rel);
    assert.ok(names.includes('CLAUDE.md'));
    // AGENTS.md is the cross-agent entrypoint 16-19 hosts read: a
    // claude-only project must not be left without it.
    assert.ok(names.includes('AGENTS.md'));
    assert.ok(!names.some((n) => n.includes('codex-mcp')));
  } finally { cleanup(dir); }
});

// Antigravity reads AGENTS.md as a documented rules surface and generic
// follows the universal convention — a project scoped to either must
// still receive the root rules entrypoint (regression: AGENTS_HOSTS
// excluded both and silently skipped session-start instructions).
for (const host of ['antigravity', 'generic']) {
  test(`${host}-only project still gets AGENTS.md`, () => {
    const dir = makeTempDir(`init-${host}`);
    try {
      const prepared = prepareInit({ projectRoot: dir,
        answers: { ...VALID_ANSWERS, hosts: [host] } });
      assert.ok(prepared.files.some((f) => f.rel === 'AGENTS.md'));
    } finally { cleanup(dir); }
  });
}

test('config filename colliding with generated siblings is blocked', () => {
  const dir = makeTempDir('init-collide');
  try {
    // Config file that would be an ancestor of generated skill files.
    assert.throws(
      () => prepareInit({
        projectRoot: dir, configRel: 'cfg/skills', answers: VALID_ANSWERS,
      }),
      (e) => ['PLAN_CONFLICT', 'PATH_COLLISION', 'FILE_ANCESTOR'].includes(e.code));
    // Config file sharing the generated instructions.md destination.
    assert.throws(
      () => prepareInit({
        projectRoot: dir, configRel: 'cfg/instructions.md', answers: VALID_ANSWERS,
      }),
      (e) => ['PLAN_CONFLICT', 'PATH_COLLISION'].includes(e.code));
    assert.ok(!exists(dir, 'cfg/instructions.md'));
  } finally { cleanup(dir); }
});

test('regular-file ancestor of a destination is blocked before writes', () => {
  const dir = makeTempDir('init-fileanc');
  try {
    writeFile(dir, 'cfg', 'not a directory');
    assert.throws(
      () => prepareInit({
        projectRoot: dir, configRel: 'cfg/config.json', answers: VALID_ANSWERS,
      }),
      (e) => e.code === 'FILE_ANCESTOR' || e.code === 'PLAN_CONFLICT');
    assert.ok(!exists(dir, 'cfg/config.json'));
  } finally { cleanup(dir); }
});

test('symlink introduced after prepare is caught by apply-time preflight', (t) => {
  const dir = makeTempDir('init-late-link');
  try {
    const prepared = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    const target = makeTempDir('link-target');
    try {
      writeFile(target, 'x.txt', 'x');
      let made = false;
      try {
        fs.mkdirSync(path.join(dir, '.scopegrain'), { recursive: true });
        fs.symlinkSync(target, path.join(dir, '.scopegrain', 'integrations'), 'junction');
        made = true;
      } catch (e) {
        if (['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(e.code)) {
          t.skip(`symlink creation unavailable: ${e.code}`);
          return;
        }
        throw e;
      }
      if (made) {
        assert.throws(() => applyPlan(dir, prepared.files),
          (e) => ['SYMLINK_REJECTED', 'PLAN_CONFLICT'].includes(e.code));
      }
    } finally { cleanup(target); }
  } finally { cleanup(dir); }
});

test('deleted discovery.json is recreated on re-init while config stays', () => {
  const dir = makeTempDir('init-rediscovery');
  try {
    applyPlan(dir, prepareInit({ projectRoot: dir, answers: VALID_ANSWERS }).files);
    const cfgBefore = fs.readFileSync(`${dir}/.scopegrain/config.json`);
    fs.rmSync(path.join(dir, '.scopegrain', 'discovery.json'));
    const second = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    const dFile = second.files.find((f) => f.rel === '.scopegrain/discovery.json');
    const cFile = second.files.find((f) => f.rel === '.scopegrain/config.json');
    assert.equal(dFile.action, 'create');
    assert.equal(cFile.action, 'noop'); // config bytes preserved
    applyPlan(dir, second.files);
    assert.ok(exists(dir, '.scopegrain/discovery.json'));
    assert.ok(fs.readFileSync(`${dir}/.scopegrain/config.json`).equals(cfgBefore));
  } finally { cleanup(dir); }
});

test('short writes still produce complete files; zero progress rolls back', () => {
  const dir = makeTempDir('init-shortwrite');
  try {
    const prepared = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    // Writes only 4 bytes per call: loop must complete the file.
    const orig = fs.writeSync;
    fs.writeSync = (fd, buf, off, len) => orig(fd, buf, off, Math.min(len, 4));
    try {
      applyPlan(dir, prepared.files);
    } finally {
      fs.writeSync = orig;
    }
    const written = fs.readFileSync(`${dir}/.scopegrain/config.json`);
    const expected = Buffer.isBuffer(prepared.files[0].content)
      ? prepared.files[0].content : Buffer.from(prepared.files[0].content);
    assert.ok(written.equals(expected));

    // Zero-progress write fails structurally and rolls back own files.
    const dir2 = makeTempDir('init-zerowrite');
    try {
      const prepared2 = prepareInit({ projectRoot: dir2, answers: VALID_ANSWERS });
      fs.writeSync = () => 0;
      try {
        assert.throws(() => applyPlan(dir2, prepared2.files));
      } finally {
        fs.writeSync = orig;
      }
      assert.ok(!exists(dir2, '.scopegrain/config.json'));
      assert.ok(!exists(dir2, 'AGENTS.md'));
    } finally { cleanup(dir2); }
  } finally { cleanup(dir); }
});

test('mid-write failure rolls back only files created by this operation', () => {
  const dir = makeTempDir('init-rollback');
  try {
    const prepared = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    writeFile(dir, 'keep-me.txt', 'unrelated');
    const orig = fs.writeSync;
    let count = 0;
    fs.writeSync = (fd, ...rest) => {
      count += 1;
      if (count === 3) {
        const e = new Error('injected write failure'); e.code = 'EIO'; throw e;
      }
      return orig(fd, ...rest);
    };
    try {
      assert.throws(() => applyPlan(dir, prepared.files));
    } finally {
      fs.writeSync = orig;
    }
    // The unrelated file survives; every file this operation created is gone.
    assert.ok(exists(dir, 'keep-me.txt'));
    assert.ok(!exists(dir, '.scopegrain/config.json'));
    assert.ok(!exists(dir, 'AGENTS.md'));
  } finally { cleanup(dir); }
});

test('a foreign file appearing mid-apply is never overwritten by publish', () => {
  const dir = makeTempDir('init-pubrace');
  try {
    const prepared = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    writeFile(dir, 'keep-me.txt', 'unrelated');
    const target = path.join(dir, 'AGENTS.md');
    const link = fs.linkSync;
    // A foreign file materializes at a planned destination between the
    // apply-time preflight and the atomic publish. link(2) must fail
    // EEXIST instead of replacing it (rename would silently overwrite).
    fs.linkSync = function (from, to) {
      if (to === target) fs.writeFileSync(target, 'foreign bytes');
      return link.call(this, from, to);
    };
    try {
      assert.throws(() => applyPlan(dir, prepared.files),
        (e) => e.code === 'EEXIST');
    } finally { fs.linkSync = link; }
    assert.equal(fs.readFileSync(target, 'utf8'), 'foreign bytes');
    assert.ok(exists(dir, 'keep-me.txt'));
    // Every file this operation created is rolled back; no staging temps.
    assert.ok(!exists(dir, '.scopegrain/config.json'));
    const leftovers = fs.readdirSync(dir)
      .filter((n) => n.includes('.scopegrain-tmp-'));
    assert.deepEqual(leftovers, []);
    assert.deepEqual(fs.readdirSync(path.join(dir, '.scopegrain'))
      .filter((n) => n.includes('.scopegrain-tmp-')), []);
  } finally { cleanup(dir); }
});

test('hardlink-less filesystems fall back to exclusive direct writes', () => {
  const dir = makeTempDir('init-nolink');
  try {
    const prepared = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    const link = fs.linkSync;
    fs.linkSync = () => {
      throw Object.assign(new Error('no links'), { code: 'EPERM' });
    };
    try {
      applyPlan(dir, prepared.files);
    } finally { fs.linkSync = link; }
    for (const f of prepared.files) {
      const expected = Buffer.isBuffer(f.content)
        ? f.content : Buffer.from(f.content);
      assert.ok(fs.readFileSync(path.join(dir, ...f.rel.split('/')))
        .equals(expected), `${f.rel} bytes differ after fallback write`);
    }
    const leftovers = [];
    const walk = (rel) => {
      for (const name of fs.readdirSync(path.join(dir, rel))) {
        const r = rel ? `${rel}/${name}` : name;
        if (fs.statSync(path.join(dir, r)).isDirectory()) walk(r);
        else if (name.includes('.scopegrain-tmp-')) leftovers.push(r);
      }
    };
    walk('');
    assert.deepEqual(leftovers, []);
  } finally { cleanup(dir); }
});

test('case-insensitive duplicate plan destinations are rejected', () => {
  const dir = makeTempDir('init-case');
  try {
    // AGENTS.md already generated by hosts; a config named agents.md would
    // collide case-insensitively on the same destination basename rule via
    // ancestor/dup check at plan level (configRel 'AGENTS.md').
    assert.throws(
      () => prepareInit({
        projectRoot: dir, configRel: 'agents.md', answers: VALID_ANSWERS,
      }),
      (e) => ['PLAN_CONFLICT', 'PATH_COLLISION'].includes(e.code));
  } finally { cleanup(dir); }
});

// Machine-local host destinations (absolute paths embedded) must be proposed
// for git exclusion: versioning one guarantees PLAN_CONFLICT or a broken MCP
// on any other machine.
for (const [host, dest] of [
  ['devin', '/.devin/mcp_config.json'],
  ['antigravity', '/.agents/mcp_config.json'],
  // OpenCode's manual-merge target is the project's own config file, which
  // carries the absolute serverPath/--project values from the fragment.
  ['opencode', '/opencode.jsonc'],
]) {
  test(`${host} init proposes git exclusion for ${dest}`, () => {
    const dir = makeTempDir('mlprop');
    try {
      const prepared = prepareInit({ projectRoot: dir,
        answers: { ...VALID_ANSWERS, hosts: [host] } });
      const prop = prepared.files.find((f) =>
        f.rel.endsWith('integrations/gitignore-proposal.txt'));
      assert.ok(prop, 'gitignore proposal file planned');
      assert.ok(
        String(prop.content).includes(dest),
        `proposal must cover ${dest}`);
    } finally { cleanup(dir); }
  });
}
