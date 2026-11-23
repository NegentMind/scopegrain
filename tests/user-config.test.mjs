// SPDX-License-Identifier: Apache-2.0
// Global user configuration: onboarding defaults only, with strict workspace
// precedence and fail-closed validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadUserConfig, resolveUserConfigPath, saveUserConfig, validateUserConfig,
} from '../src/core/user-config.mjs';
import { run } from '../src/cli.mjs';
import { runDoctor } from '../src/core/doctor.mjs';
import {
  bootstrappedMiniCtx, cleanup, fakeIO, makeTempDir, readJson, withEnv,
  writeFile, writeJson,
} from './helpers.mjs';

test('resolveUserConfigPath honors SCOPEGRAIN_USER_CONFIG > XDG_CONFIG_HOME > default', () => {
  assert.deepEqual(resolveUserConfigPath({ SCOPEGRAIN_USER_CONFIG: 'none' }),
    { path: null, source: 'disabled' });
  assert.deepEqual(resolveUserConfigPath({ SCOPEGRAIN_USER_CONFIG: '' }),
    { path: null, source: 'disabled' });
  const envRes = resolveUserConfigPath({ SCOPEGRAIN_USER_CONFIG: '/tmp/sg.json' });
  assert.equal(envRes.source, 'env');
  assert.ok(envRes.path.endsWith('sg.json'));
  const xdgRes = resolveUserConfigPath({ XDG_CONFIG_HOME: '/tmp/xdg' });
  assert.equal(xdgRes.source, 'xdg');
  assert.ok(xdgRes.path.endsWith(path.join('scopegrain', 'config.json')));
  const defRes = resolveUserConfigPath({});
  assert.equal(defRes.source, 'default');
  assert.ok(defRes.path.endsWith(path.join('.config', 'scopegrain', 'config.json')));
});

test('validateUserConfig rejects permission/workspace keys and invalid values', () => {
  assert.throws(() => validateUserConfig({ schemaVersion: 1, verification: { commands: [] } }),
    { code: 'UNKNOWN_KEY' });
  assert.throws(() => validateUserConfig({ schemaVersion: 1, project: { root: '.' } }),
    { code: 'UNKNOWN_KEY' });
  assert.throws(() => validateUserConfig({ schemaVersion: 1, paths: {} }),
    { code: 'UNKNOWN_KEY' });
  assert.throws(() => validateUserConfig({ schemaVersion: 2 }),
    { code: 'USER_CONFIG_INVALID' });
  assert.throws(() => validateUserConfig({ schemaVersion: 1, locale: 'fr' }),
    { code: 'USER_CONFIG_INVALID' });
  assert.throws(() => validateUserConfig({ schemaVersion: 1, hosts: ['unknown'] }),
    { code: 'USER_CONFIG_INVALID' });
  assert.throws(() => validateUserConfig({ schemaVersion: 1, hosts: ['devin', 'devin'] }),
    { code: 'USER_CONFIG_INVALID' });

  const valid = validateUserConfig({
    schemaVersion: 1,
    locale: 'en',
    hosts: ['devin', 'claude'],
    methodology: 'sdd',
    versioning: { plans: true, tasks: false },
  });
  assert.equal(valid.locale, 'en');
  assert.deepEqual(valid.hosts, ['devin', 'claude']);
  assert.equal(valid.methodology, 'sdd');
  assert.deepEqual(valid.versioning, { plans: true, tasks: false });
});

test('CLI config set previews by default, --apply writes atomically, show reads back', async () => {
  const dir = makeTempDir('usercfg');
  const cfgFile = path.join(dir, 'global-config.json');
  const inputFile = path.join(dir, 'input.json');
  try {
    fs.writeFileSync(inputFile, JSON.stringify({
      locale: 'en',
      hosts: ['devin', 'codex'],
      methodology: 'sdd',
      versioning: { decisions: true },
    }));
    await withEnv({ SCOPEGRAIN_USER_CONFIG: cfgFile }, async () => {
      const ioPath = fakeIO();
      assert.equal(await run(['config', 'path'], ioPath), 0);
      assert.equal(JSON.parse(ioPath.out.stdout.at(-1)).exists, false);

      const ioPreview = fakeIO();
      assert.equal(await run(['config', 'set', '--input', inputFile], ioPreview), 0);
      assert.equal(JSON.parse(ioPreview.out.stdout.at(-1)).mode, 'preview');
      assert.equal(fs.existsSync(cfgFile), false);

      const ioApply = fakeIO();
      assert.equal(await run(['config', 'set', '--input', inputFile, '--apply'], ioApply), 0);
      assert.equal(JSON.parse(ioApply.out.stdout.at(-1)).mode, 'applied');
      assert.equal(fs.existsSync(cfgFile), true);

      const ioShow = fakeIO();
      assert.equal(await run(['config', 'show'], ioShow), 0);
      const shown = JSON.parse(ioShow.out.stdout.at(-1));
      assert.equal(shown.exists, true);
      assert.equal(shown.config.locale, 'en');
      assert.deepEqual(shown.config.hosts, ['devin', 'codex']);
      assert.equal(shown.precedence[0], 'workspace');
    });
  } finally { cleanup(dir); }
});

test('workspace config strictly beats global user config; new projects inherit user defaults', async () => {
  const dir = makeTempDir('usercfg-prec');
  const cfgFile = path.join(dir, 'global.json');
  const freshProj = path.join(dir, 'fresh-proj');
  fs.mkdirSync(freshProj, { recursive: true });
  try {
    saveUserConfig({
      locale: 'en',
      hosts: ['devin'],
      methodology: 'sdd',
      versioning: { decisions: true },
    }, { apply: true, env: { SCOPEGRAIN_USER_CONFIG: cfgFile } });

    await withEnv({ SCOPEGRAIN_USER_CONFIG: cfgFile }, async () => {
      // 1. Fresh project with init --defaults inherits global defaults.
      const ioInit = fakeIO();
      assert.equal(await run(
        ['init', '--project', freshProj, '--defaults', '--apply'], ioInit), 0);
      const projCfg = readJson(freshProj, '.scopegrain/config.json');
      assert.equal(projCfg.locale, 'en');
      assert.deepEqual(projCfg.hosts, ['devin']);
      assert.equal(projCfg.methodology, 'sdd');
      assert.equal(projCfg.versioning.decisions, true);

      // 2. Changing global config afterwards NEVER alters the workspace config
      // nor re-init --defaults on that workspace.
      saveUserConfig({
        locale: 'es',
        hosts: ['claude'],
        methodology: 'manual',
      }, { apply: true, env: { SCOPEGRAIN_USER_CONFIG: cfgFile } });

      const ioReinit = fakeIO();
      assert.equal(await run(
        ['init', '--project', freshProj, '--defaults'], ioReinit), 0);
      const plan = JSON.parse(ioReinit.out.stdout.at(-1));
      assert.equal(plan.methodology, 'sdd');
      assert.equal(readJson(freshProj, '.scopegrain/config.json').locale, 'en');
    });
  } finally { cleanup(dir); }
});

test('doctor reports warning on malformed global user config without breaking workspace', async () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  const badGlobal = path.join(dir, 'bad-global.json');
  try {
    fs.writeFileSync(badGlobal, '{corrupt');
    await withEnv({ SCOPEGRAIN_USER_CONFIG: badGlobal }, () => {
      const report = runDoctor(ctx);
      const chk = report.checks.find((c) => c.name === 'user-config');
      assert.ok(chk && !chk.ok && chk.severity === 'warning');
      assert.equal(loadUserConfig({ env: { SCOPEGRAIN_USER_CONFIG: 'none' } }).exists, false);
    });
  } finally { cleanup(dir); }
});
