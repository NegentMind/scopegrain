// SPDX-License-Identifier: Apache-2.0
// Shared lightweight fixtures for the lifecycle test files.
//
// The generic bootstrappedCtx() projects the FULL installation catalog
// (130+ resources, ~230 files) through prepareInit+applyPlan, and every
// update/uninstall/doctor call re-derives that plan from the real install
// root. None of the lifecycle assertions depend on catalog size -- they
// name specific files (config.json, task-contract.md, instructions.md,
// catalog.json, commands/plan-work.md, CLAUDE.md, state/workspace.json).
//
// This module therefore provides two cheaper tiers:
//
//   configuredCtx()       -- config.json only; enough for adopt/backup/
//                            restore paths that never inspect generated
//                            files (backup walks the declared artifact
//                            paths only; generated resources are outside
//                            them even in the full fixture).
//   bootstrappedMiniCtx() -- full generated plan built from a minimal
//                            install root (one command, one skill, one
//                            agent) via buildInitPlan with explicit
//                            installRoot/templatesDir. On-disk state is
//                            byte-equivalent for every file the tests
//                            name; the update/uninstall/doctor verbs all
//                            accept the matching {installRoot} option.
//
// The minimal install root is created lazily once per test process under
// the shared tests/.tmp convention and removed via
// destroyLifecycleInstall() from an after() hook in each file that uses
// it. Per-test project dirs stay isolated -- tests mutate the tree, so
// nothing is shared between tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPlan, buildInitPlan } from '../../src/core/bootstrap.mjs';
import { createConfig } from '../../src/core/config.mjs';
import { resolveContext } from '../../src/core/context.mjs';
import { inspectProject } from '../../src/discovery/inspect.mjs';
import { prepareWorkspace } from '../../src/core/workspaces.mjs';
import {
  cleanup, DEFAULT_ANSWERS, makeTempDir, writeFile, writeJson,
} from '../helpers.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// Answers used by bootstrappedCtx() in these files (.scopegrain
// artifact paths, claude-only hosts). Same shape, same defaults.
export const MINI_ANSWERS = { ...DEFAULT_ANSWERS, hosts: ['claude'] };

let miniRoot = null;

// Minimal installation: resources/manifest.json with three entries (the
// command id/path is 'plan-work' so the projected snapshot keeps the exact
// 'commands/plan-work.md' path the snapshot-pin test looks up), the seven
// templates doctor requires, verbatim copies of the projected policy
// files, and a claude-only native-adapters policy whose single
// readOnlyAgentIds entry exists in the catalog.
export function lifecycleInstallRoot() {
  if (miniRoot) return miniRoot;
  const dir = makeTempDir('lifecycle-install');

  writeFile(dir, 'resources/commands/plan-work.md', '# plan-work\n');
  writeFile(dir, 'resources/skills/mini-skill/SKILL.md', '# mini-skill\n');
  writeFile(dir, 'resources/agents/reviewer.md', '# reviewer\n');
  writeJson(dir, 'resources/manifest.json', {
    schemaVersion: 1,
    entries: [
      { kind: 'command', id: 'plan-work',
        path: 'resources/commands/plan-work.md',
        description: 'Plan work (lifecycle fixture)', modes: ['default'] },
      { kind: 'skill', id: 'mini-skill',
        path: 'resources/skills/mini-skill/SKILL.md',
        description: 'Mini skill (lifecycle fixture)' },
      { kind: 'agent', id: 'reviewer',
        path: 'resources/agents/reviewer.md',
        description: 'Reviewer agent (lifecycle fixture)' },
    ],
  });

  // Rendered by buildInitPlan/renderNativeAdapters: every {{var}} used is
  // one of the documented substitution keys, so rendering never throws
  // TEMPLATE_UNRESOLVED.
  writeFile(dir, 'templates/project-instructions.md',
    'Instructions. config={{configPath}} discovery={{discoveryPath}}\n');
  writeFile(dir, 'templates/entrypoint.md',
    'Entrypoint. instructions={{instructionsPath}} config={{configPath}}\n');
  writeFile(dir, 'templates/task-contract.md',
    'fixture task contract\n');
  writeFile(dir, 'templates/hosts/native-resource.md',
    '# {{kind}}/{{id}}\nresource={{resourcePath}} config={{configPath}}'
    + ' catalog={{catalogPath}} instructions={{instructionsPath}}\n');
  writeFile(dir, 'templates/hosts/native-agent.md',
    '# agent {{id}} config={{configPath}}'
    + ' instructions={{instructionsPath}}\n');
  writeFile(dir, 'templates/approval-prompts.json', '{}\n');
  writeFile(dir, 'templates/render-specification.mjs', '// fixture stub\n');

  // Projected verbatim into <configDir>/policy by buildInitPlan; copied
  // from the real installation so projected bytes match the real ones.
  const realPolicy = path.join(REPO_ROOT, 'policy');
  for (const p of ['workflow.json', 'operation-limits.json',
    'methodology.json', 'native-variants.json']) {
    const dest = writeFile(dir, `policy/${p}`, '');
    fs.copyFileSync(path.join(realPolicy, p), dest);
  }
  // Claude-only native policy; 'reviewer' satisfies the non-empty
  // readOnlyAgentIds requirement and exists in the minimal catalog.
  const real = JSON.parse(fs.readFileSync(
    path.join(realPolicy, 'native-adapters.json'), 'utf8'));
  writeJson(dir, 'policy/native-adapters.json', {
    ...real,
    readOnlyAgentIds: ['reviewer'],
    hosts: { claude: real.hosts.claude },
  });

  miniRoot = dir;
  return miniRoot;
}

export function destroyLifecycleInstall() {
  if (miniRoot) {
    cleanup(miniRoot);
    miniRoot = null;
  }
}

// Full tree snapshot used by read-only preview assertions (moved here
// from the three lifecycle files, where it was duplicated verbatim).
export function snapshot(dir) {
  const result = {};
  function walk(abs, rel = '') {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        result[name] = 'directory';
        walk(path.join(abs, entry.name), name);
      } else {
        result[name] = fs.readFileSync(path.join(abs, entry.name));
      }
    }
  }
  walk(dir);
  return result;
}

// Workspace enrollment identical to the inline applyPlan(prepareWorkspace)
// sequences these tests used.
export function enroll(ctx) {
  const prepared = prepareWorkspace(ctx);
  applyPlan(ctx.projectRoot, [prepared.file]);
  return prepared.workspace;
}

// Tier A: valid config.json only. prepareAdopt, prepareBackup and
// prepareRestore read only the config, its discovery.json sibling and
// the declared artifact paths, so this is state-equivalent for those
// tests (an absent discovery.json previews as a skipped-source issue).
export function configuredCtx(answers = MINI_ANSWERS) {
  const dir = makeTempDir('cfg');
  writeJson(dir, '.scopegrain/config.json', createConfig(dir, answers, {}));
  return { dir, ctx: resolveContext({ project: dir }) };
}

// Tier B: full generated plan from the minimal install root. Mirrors the
// prepareInit+applyPlan sequence of bootstrappedCtx(): discovery first,
// config serialized exactly as init writes it, plan applied create-only.
// Callers pass the returned installRoot to lifecycle verbs via
// options.installRoot so previews/apply/doctor compare against the same
// generation source that produced the fixture.
export function bootstrappedMiniCtx(answers = MINI_ANSWERS) {
  const dir = makeTempDir('boot');
  const configRel = '.scopegrain/config.json';
  const discovery = inspectProject(dir);
  const config = createConfig(dir, answers, discovery);
  const installRoot = lifecycleInstallRoot();
  const plan = buildInitPlan({
    projectRoot: dir,
    configRel,
    config,
    configContent: JSON.stringify(config, null, 2) + '\n',
    discovery,
    discoveryContent: JSON.stringify(discovery, null, 2) + '\n',
    installRoot,
    templatesDir: path.join(installRoot, 'templates'),
  });
  applyPlan(dir, plan.files);
  return {
    dir, ctx: resolveContext({ project: dir }), plan, installRoot,
  };
}
