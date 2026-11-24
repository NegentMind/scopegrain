// SPDX-License-Identifier: Apache-2.0
// Runtime context: binds an explicit project root and config location.
// No path is ever derived by ascending from the Scopegrain installation.
import { configDirOf, loadConfig } from './config.mjs';
import { resolveProjectRoot } from './paths.mjs';

export function resolveContext({ project, config: configPath }) {
  const projectRoot = resolveProjectRoot(project);
  const { config, configPath: configRel } = loadConfig(projectRoot, configPath);
  return {
    projectRoot,
    projectName: config.project?.name ?? null,
    configPath: configRel,
    configDir: configDirOf(configRel),
    config,
  };
}
