// SPDX-License-Identifier: Apache-2.0
// Native gate-channel proposals. `task gate` is the machine decision
// endpoint a host hook calls; this module emits the READ-ONLY merge
// proposal that would wire a host's documented pre-action surface to it.
// Nothing here is installed: merging into shared host config is the
// owner's explicit act, same contract as MCP merge targets. Hosts with
// no verified hook surface are reported `documented-only` — no fragment
// is fabricated for them, and `interceptsNativeTools` stays false until
// a real pilot proves a merged channel.
import { err } from '../core/errors.mjs';
import { KNOWN_HOSTS } from '../core/config.mjs';

// Hosts with a documented pre-action surface we can propose a bounded
// fragment for. Everything else stays documented-only.
const SURFACES = new Set(['claude', 'opencode', 'codex']);

const GATE_EXIT = {
  0: 'allow', 2: 'deny', 3: 'require-gate (advisory: host should ask the user)',
  1: 'error — fail-closed: a hook must treat non-zero as block',
};

// Claude Code blocks a PreToolUse call ONLY on exit 2 (stderr feeds
// back to the model); every other non-zero exit is a NON-blocking
// error. `task gate` returns {0,2,3} plus 1 on error, so the emitted
// command remaps any non-zero to 2 — the documented fail-closed policy
// ("any non-zero must block") then actually holds once merged.
function gateCmd(ctx, action) {
  return `scopegrain task gate --project "${ctx.projectRoot}" - ${action}`
    + '; s=$?; [ "$s" -eq 0 ] || exit 2';
}

// Claude Code: settings.json hooks.PreToolUse runs a command before the
// matched tool. We gate only mutation-class tools on the abstract
// `edit` action — read tools stay ungated by design.
function claudeProposal(ctx) {
  return {
    surface: 'settings.json hooks.PreToolUse',
    mergeTarget: '.claude/settings.json',
    fragment: {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Edit|Write|MultiEdit|NotebookEdit',
            hooks: [
              { type: 'command', command: gateCmd(ctx, 'edit') },
            ],
          },
        ],
      },
    },
    note: 'exit contract: 0 allow, 2 deny, 3 require-gate; any non-zero'
      + ' (incl. 1 error) must block per fail-closed policy. Claude Code'
      + ' blocks only on exit 2, so the wrapper remaps {1,3} to 2.'
      + ' The "-" task argument resolves SCOPEGRAIN_TASK env then the'
      + ' active pointer.',
  };
}

// OpenCode: declarative permission map in opencode.jsonc (documented
// surface). No arbitrary command hooks are claimed — this proposes the
// conservative ask-on-mutation map for owner review.
function opencodeProposal() {
  return {
    surface: 'opencode.jsonc permission map',
    mergeTarget: 'opencode.jsonc',
    fragment: { permission: { edit: 'ask', bash: 'ask' } },
    note: 'Declarative only: prompts the operator on mutation tools.'
      + ' It does not call `task gate`; a real interception pilot would'
      + ' need an OpenCode plugin hook (unverified surface).',
  };
}

// Codex: declarative approval policy in .codex/config.toml.
function codexProposal() {
  return {
    surface: 'config.toml approval_policy',
    mergeTarget: '.codex/config.toml',
    fragment: 'approval_policy = "on-request"',
    note: 'Declarative only: routes tool calls through the host\'s own'
      + ' approval flow. It does not call `task gate`.',
  };
}

// A gate is only as honest as its surface: claude gets a live command
// hook proposal; opencode/codex get declarative permission proposals;
// every other host reports documented-only with no fabricated wiring.
export function gateProposal(ctx, { host }) {
  if (!KNOWN_HOSTS.includes(host)) {
    throw err('UNKNOWN_HOST',
      `unknown host '${host}'; known: ${KNOWN_HOSTS.join(', ')}`);
  }
  const base = {
    host,
    channel: 'gate-proposal',
    installed: false,
    interceptsNativeTools: false,
    exitContract: GATE_EXIT,
    actionMapping: {
      'edit-class host tools (Edit/Write/MultiEdit/NotebookEdit)': 'edit',
      'read-class host tools': 'ungated by design',
    },
  };
  if (!SURFACES.has(host)) {
    return {
      ...base,
      status: 'documented-only',
      reason: `no verified pre-action hook surface is documented for`
        + ` '${host}'; a native pilot remains required before any`
        + ` interception claim. No fragment emitted.`,
    };
  }
  const proposal = host === 'claude' ? claudeProposal(ctx)
    : host === 'opencode' ? opencodeProposal()
    : codexProposal();
  return {
    ...base,
    status: 'proposal',
    ...proposal,
    merge: 'owner merges `fragment` into `mergeTarget` manually;'
      + ' the harness never writes shared host configuration',
  };
}
