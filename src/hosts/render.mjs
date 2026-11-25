// SPDX-License-Identifier: Apache-2.0
// Host integration proposals. These are reviewable FRAGMENTS, never merged
// into active host configuration by Scopegrain. serverPath and projectRoot
// inside are absolute and machine-local: regenerate after moving the
// installation. --config is rendered as the project-relative POSIX path that
// loadConfig accepts, validated as contained inside the project root.
import path from 'node:path';
import { err } from '../core/errors.mjs';
import { isInside, toCanonicalRelative } from '../core/paths.mjs';

// JSON.stringify output is compatible with TOML basic strings (both escape
// backslash, quote and control characters), so reuse it for TOML quoting.
function tomlString(s) {
  return JSON.stringify(s);
}

// Convert an absolute config path inside projectRoot to the relative POSIX
// token the CLI/MCP server expects after --config.
export function configArgToken(projectRoot, configAbs) {
  if (!isInside(projectRoot, configAbs) || configAbs === projectRoot) {
    throw err('INVALID_ADAPTER_INPUT',
      'configPath must be contained inside projectRoot');
  }
  const rel = path.relative(projectRoot, configAbs).split(path.sep).join('/');
  return toCanonicalRelative(rel, 'configPath');
}

function stdioArgs(serverPath, projectRoot, configRel) {
  return [serverPath, '--project', projectRoot, '--config', configRel];
}

function renderClaude(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    mcpServers: {
      scopegrain: {
        type: 'stdio',
        command: 'node',
        args: stdioArgs(serverPath, projectRoot, configRel),
      },
    },
  }, null, 2) + '\n';
}

function renderDevin(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    mcpServers: {
      scopegrain: {
        command: 'node',
        args: stdioArgs(serverPath, projectRoot, configRel),
      },
    },
  }, null, 2) + '\n';
}

function renderCodex(serverPath, projectRoot, configRel) {
  const args = stdioArgs(serverPath, projectRoot, configRel)
    .map(tomlString).join(', ');
  return [
    '# Proposed fragment for .codex/config.toml (review before merging)',
    '[mcp_servers.scopegrain]',
    'command = "node"',
    `args = [${args}]`,
    '',
  ].join('\n');
}

// Authoritative OpenCode V2 shape (opencode.ai/docs/mcp-servers):
// {mcp:{servers:{scopegrain:{type:'local',command:[tokens],disabled:true}}}}
function renderOpencode(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    mcp: {
      servers: {
        scopegrain: {
          type: 'local',
          command: ['node', ...stdioArgs(serverPath, projectRoot, configRel)],
          disabled: true,
        },
      },
    },
  }, null, 2) + '\n';
}

// Antigravity (.agents/mcp_config.json): disabled:true proposal, stdio.
function renderAntigravity(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    mcpServers: {
      scopegrain: {
        command: 'node',
        args: stdioArgs(serverPath, projectRoot, configRel),
        disabled: true,
      },
    },
  }, null, 2) + '\n';
}

// Hermes Agent (~/.hermes/config.yaml): PROVISIONAL - the format is an
// approved target without a verified in-repo spec. The fragment subtree
// mirrors the documented mcp_servers shape as strict JSON (valid YAML 1.2)
// for manual merge only; enabled:false until the owner reviews it.
function renderHermes(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    format: 'provisional',
    verified: false,
    note: 'unverified proposal: merge fragment.mcp_servers manually into '
      + '~/.hermes/config.yaml after review; the harness never writes '
      + 'global host configuration',
    fragment: {
      mcp_servers: {
        scopegrain: {
          command: 'node',
          args: stdioArgs(serverPath, projectRoot, configRel),
          enabled: false,
        },
      },
    },
  }, null, 2) + '\n';
}

function renderCopilot(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    servers: {
      scopegrain: {
        type: 'stdio',
        command: 'node',
        args: stdioArgs(serverPath, projectRoot, configRel),
      },
    },
  }, null, 2) + '\n';
}

function renderCursor(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    mcpServers: {
      scopegrain: {
        type: 'stdio',
        command: 'node',
        args: stdioArgs(serverPath, projectRoot, configRel),
      },
    },
  }, null, 2) + '\n';
}

// Cline (docs.cline.bot/mcp): the mcpServers shape lives in the GLOBAL
// settings file (~/.cline/data/settings/cline_mcp_settings.json for the
// CLI; the VS Code extension keeps its own cline_mcp_settings.json under
// globalStorage). There is no project-level MCP config — the fragment is
// a manual-merge proposal into a global file the harness never writes;
// disabled:true keeps the merge opt-in after review.
function renderCline(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    mcpServers: {
      scopegrain: {
        command: 'node',
        args: stdioArgs(serverPath, projectRoot, configRel),
        disabled: true,
      },
    },
  }, null, 2) + '\n';
}

// Roo Code (.roo/mcp.json): project-level MCP config, mcpServers object
// with command/args/disabled per the documented example.
function renderRoo(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    mcpServers: {
      scopegrain: {
        command: 'node',
        args: stdioArgs(serverPath, projectRoot, configRel),
        disabled: true,
      },
    },
  }, null, 2) + '\n';
}

// Kilo Code (kilo.ai/docs/automate/mcp): servers live under the top-level
// `mcp` key of kilo.jsonc (project root or .kilo/kilo.jsonc) as
// {type:'local', command:[tokens], enabled} — enabled:false until the
// owner reviews the merge.
function renderKilo(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    mcp: {
      scopegrain: {
        type: 'local',
        command: ['node', ...stdioArgs(serverPath, projectRoot, configRel)],
        enabled: false,
      },
    },
  }, null, 2) + '\n';
}

// Gemini CLI (.gemini/settings.json): mcpServers entries take
// command/args/cwd/timeout/trust — stdio is implied by `command` (no
// `type` field). `trust` is never emitted: server approval stays
// interactive.
function renderGemini(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    mcpServers: {
      scopegrain: {
        command: 'node',
        args: stdioArgs(serverPath, projectRoot, configRel),
      },
    },
  }, null, 2) + '\n';
}

// Windsurf / Devin Desktop (~/.codeium/windsurf/mcp_config.json): the
// documented Cascade MCP file is GLOBAL — never written. The fragment is
// a manual-merge proposal; disabled:true keeps it opt-in.
function renderWindsurf(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    mcpServers: {
      scopegrain: {
        command: 'node',
        args: stdioArgs(serverPath, projectRoot, configRel),
        disabled: true,
      },
    },
  }, null, 2) + '\n';
}

// Generic host: the most common JSON stdio MCP shape plus a note that the
// descriptor is a scaffold, not a certified format (generic adapter).
function renderGeneric(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    note: 'generic host scaffold: merge mcpServers.scopegrain into the '
      + 'host MCP configuration manually after review',
    mcpServers: {
      scopegrain: {
        type: 'stdio',
        command: 'node',
        args: stdioArgs(serverPath, projectRoot, configRel),
        disabled: true,
      },
    },
  }, null, 2) + '\n';
}

const RENDERERS = {
  claude: { file: 'claude-mcp.json', format: 'json', render: renderClaude },
  generic: { file: 'generic-mcp.json', format: 'json', render: renderGeneric },
  codex: { file: 'codex-mcp.toml', format: 'toml', render: renderCodex },
  opencode: { file: 'opencode-mcp.json', format: 'json', render: renderOpencode },
  devin: { file: 'devin-mcp.json', format: 'json', render: renderDevin },
  antigravity: { file: 'antigravity-mcp.json', format: 'json',
    render: renderAntigravity },
  hermes: { file: 'hermes-mcp.json', format: 'provisional',
    render: renderHermes },
  copilot: { file: 'copilot-mcp.json', format: 'json',
    render: renderCopilot },
  cursor: { file: 'cursor-mcp.json', format: 'json',
    render: renderCursor },
  cline: { file: 'cline-mcp.json', format: 'json', render: renderCline },
  roo: { file: 'roo-mcp.json', format: 'json', render: renderRoo },
  kilo: { file: 'kilo-mcp.json', format: 'json', render: renderKilo },
  'gemini-cli': { file: 'gemini-cli-mcp.json', format: 'json',
    render: renderGemini },
  windsurf: { file: 'windsurf-mcp.json', format: 'json',
    render: renderWindsurf },
};

// renderAdapters(config, {projectRoot, configPath, instructionsPath,
// serverPath}) -> {files, metadata}. projectRoot/configPath/serverPath must
// be absolute; configPath must be contained inside projectRoot. Fragments
// embed machine-local absolute server/root paths plus the project-relative
// --config token.
export function renderAdapters(config, opts) {
  const { projectRoot, configPath, instructionsPath, serverPath } = opts || {};
  for (const [k, v] of Object.entries({
    projectRoot, configPath, serverPath,
  })) {
    if (typeof v !== 'string' || !path.isAbsolute(v)) {
      throw err('INVALID_ADAPTER_INPUT',
        `${k} must be an absolute path string`);
    }
  }
  const configRel = configArgToken(projectRoot, path.resolve(configPath));
  const files = [];
  for (const host of config.hosts) {
    const spec = RENDERERS[host];
    if (!spec) throw err('UNKNOWN_HOST', `no adapter renderer for '${host}'`);
    files.push({
      host,
      relativePath: `integrations/${spec.file}`,
      format: spec.format,
      machineLocal: true,
      content: spec.render(serverPath, projectRoot, configRel),
    });
  }
  return {
    files,
    metadata: {
      machineLocal: true,
      instructionsPath: instructionsPath || null,
      note: 'proposal fragments only; review before merging into host config; '
        + 'regenerate after moving the installation or project',
    },
  };
}
