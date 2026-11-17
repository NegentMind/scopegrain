---
title: Native host projections and limits
kind: guide
---
# Native Host Projections

> English version of the canonical document (`../native-hosts.md`),
> which is already authored in English. Content is identical except for
> adjusted relative links.

TaskSystem shares canonical procedures and project snapshots across five
documented hosts, plus one admitted provisional host (Hermes). Native
files are thin bridges, not independently maintained implementations.
The `tasksystem-` namespace avoids replacing built-ins.

## Status

Documented formats and local fixture tests are not native certification —
for any host, including the provisional one. Structural parse checks on
applied fixtures verify only that generated files are syntactically
well-formed, never that a real host binary accepts, discovers or enforces
them. The foundation suite completed locally with one test file at a
time; see
[verification](verification.md) for its scope and separate earlier runs.
No host was activated by these changes. Initialization creates proposals
under the selected configuration directory, normally
`.scopegrain/integrations/`; intended active paths below are NOT written
automatically.

| Host | Invocation proposal | Intended skill path | Intended role path |
| --- | --- | --- | --- |
| Claude Code | `/tasksystem-NAME` | `.claude/skills/<name>/SKILL.md` | `.claude/agents/<name>.md` |
| Codex | `$tasksystem-NAME` | `.agents/skills/<name>/SKILL.md` | `.codex/agents/*.toml` plus declarations |
| OpenCode V2 | `/tasksystem-NAME` | `.opencode/skills/<name>/SKILL.md` | `.opencode/agents/<name>.md` |
| Devin CLI/Local | `/tasksystem-NAME` | `.devin/skills/<name>/SKILL.md` | `.devin/agents/<name>.md` |
| Antigravity App/CLI | `/tasksystem-NAME` | `.agents/skills/<name>/SKILL.md` | `.agents/agents/<name>.md` |
| Antigravity IDE | `/tasksystem-NAME` | `.agents/skills/<name>/SKILL.md` | None assumed; skills-only proposal |
| Hermes Agent (provisional) | None verified | `~/.hermes/skills/` (global; never written) | None assumed |

OpenCode native command bridges additionally target `.opencode/commands/`.
Commands, skills and roles still refer to the same configured canonical
resources and runtime. Copying a bridge without its project configuration
and snapshot is insufficient.

## Explicit Variants

Only OpenCode V2 proposals are generated, using `permissions`,
`mcp.servers` and `disabled`. Existing V1 files are not deleted. Inspect the
activation plan and do not assume a V2 proposal works on V1.

Antigravity App/CLI and IDE are separate surfaces. The App/CLI proposal
includes documented custom agents; the IDE proposal does not infer that
capability. MCP remains disabled in the generated `mcp_config.json`
proposal, with actual selected installation/project values, pending manual
review. No automatic agent, workflow or MCP installation occurs.

Codex role declarations are collected outside discoverable role files in
`agents-fragment.toml`; the proposed `.codex/config.toml` destination needs
a manual merge. Role loading and discovery depend on the installed version.

The `.agents/` convention is shared by products. A namespaced file there
can still be discovered by more than one host; it is not product isolation.

## Provisional Hosts

Hermes Agent is an admitted host whose native format has NOT been verified
against an in-repo specification; it has no `policy/native-adapters.json`
block by design. Instead of fabricated per-resource bridges, selecting
`hermes` emits exactly two review artifacts under
`<configDir>/integrations/native/hermes/`:

- `hermes-proposal.json` — a descriptor marked `format: "provisional"`,
  `verified: false`, pointing at the machine-local MCP fragment and
  naming its documented manual-merge target
  (`~/.hermes/config.yaml`, key `mcp_servers.tasksystem`).
- `instructions.md` — manual activation steps and the sources consulted.

The companion fragment `integrations/hermes-mcp.json` wraps a
`fragment.mcp_servers` subtree in strict JSON (a valid YAML 1.2 subset,
so it can be reviewed against the documented YAML shape) with
`enabled: false`. All Hermes roots are global paths under `~/.hermes/`;
the harness never writes them — see the activation contract below.

## Permissions And Models

Selected read-only roles receive host-specific restrictions:

- Claude: requested read-tool list.
- Codex: requested read-only filesystem sandbox.
- OpenCode V2: requested edit/shell/subagent denial.
- Devin: custom subagent tool allowlist.
- Antigravity App/CLI: requested documented read-tool list; IDE has no
  custom-agent restriction proposal because agents are not assumed there.

These scopes are not equivalent guarantees. Validate actual tool names,
effective denial, MCP side effects and organization policy inside the host.
Other roles inherit the owner's native policy; model prompts are not a
sandbox or a substitute for native permission enforcement.

Devin inline skill `allowed-tools` grants auto-approval rather than
restricting availability. Generated inline skills deliberately omit it.
Only the documented custom subagent field is treated as an availability
allowlist, and that custom-agent interface is experimental. A child that
cannot ask the user must return a blocker to the lead, not fabricate consent.
Devin Cloud behavior is not certified by CLI/Local fixtures.

Models remain under host policy or an explicit owner choice. No universal
provider, model identifier, cost estimate or paid call is selected by
TaskSystem. Availability, router behavior and billing are host-dependent.

## Activation Contract

`src/hosts/activation.mjs` provides the opt-in machinery that materializes
generated native proposals into project-local host destinations:

- `prepareActivation(ctx, {host, surface?})` returns
  `{mode: 'dry-run', files: [{rel, action}], skipped, warnings, format}`
  where `action` is `create`, `conflict` or `noop` under the same checks
  as `preflightPlan` (planned collisions, containment, links/non-files,
  bounded identical-bytes comparison). It writes nothing.
- `applyActivation(ctx, {host, surface?})` re-runs the throwing preflight
  immediately before writing (`PLAN_CONFLICT` aborts everything), then
  creates files with exclusive `wx` descriptors and rolls back only the
  files it created. Existing identical files are `noop`; divergent or
  linked destinations are conflicts — never overwrites.
- Only whole new project-local files are applyable. Entries that merge
  into shared host configuration (`agent-declaration` fragments,
  `mcp` descriptors) and any destination that is not a canonical
  project-relative path — including every global `~` path — are reported
  in `skipped` with warnings and never written. Machine-local MCP
  fragments under `integrations/<host>-mcp.*` stay manual-merge proposals.
- `surface` selects a variant id (e.g. `app-cli`, `ide`) or one of its
  declared surfaces. Because Antigravity variants emit the same
  destinations with different permissions, omitting a surface there makes
  duplicated destinations collide into `conflict` — selection is required
  in practice. For the provisional host, `format` is `'provisional'` and
  nothing is auto-applied.
- Proposal bytes are re-derived from catalog and policy at call time; a
  hand-edited proposal file never propagates into a destination.

Applying activation creates host roots inside the project only
(`.claude/`, `.codex/`, `.opencode/`, `.devin/`, `.agents/`). It never
writes global host configuration, never installs hooks or plugins, and
grants no auto-approval.

## Activation And Recovery

Inspect the complete generated activation plan, source, destination,
version/surface and existing settings. Activation requires specific approval
for that fixture/project and any associated tools, models, network or cost.
Initialization does not install hooks/plugins, alter active host roots,
grant auto-approval, register external servers or start MCP.

MCP configuration is machine-local. Relocation can leave absolute paths
pointing to the old project or installation; `doctor` reports that condition.
Rebinding requires review of the new destination, not silent replacement.
Resource restoration only recovers compatible missing canonical bytes; it
does not overwrite divergent files or reconnect a remote MCP service.

The portable CLI works without native registration. Its project-bound MCP
server is an optional stdio query surface, not a mutating remote executor.
See [onboarding](onboarding.md), [security](security.md) and
[verification](verification.md).

## Native Pilot Still Required

For each selected version/surface, separately approve an isolated pilot:
verify discovery and invocation, actual role tools and write denials,
unapproved MCP/network effects, delegation, interruption/resumption,
recovery without repeating effects and cleanup of only approved owned
configuration. Keep transcripts, actual versions, logs and full diffs.
Success on one host or surface does not certify another.

## Sources

The implementation contracts are
[native adapters](../../policy/native-adapters.json) and
[native variants](../../policy/native-variants.json).
Official sources consulted during the migration:

- Claude [skills](https://code.claude.com/docs/en/skills) and
  [subagents](https://code.claude.com/docs/en/sub-agents).
- Codex official [skill discovery](https://github.com/openai/codex/blob/main/codex-rs/ext/skills/src/host_roots.rs)
  and [role loader](https://github.com/openai/codex/blob/main/codex-rs/agent-roles/src/loader.rs).
- OpenCode [commands](https://opencode.ai/docs/commands/),
  [agents](https://opencode.ai/docs/agents/),
  [MCP](https://opencode.ai/docs/mcp-servers/) and
  [versioned migration source](https://github.com/anomalyco/opencode/blob/v2.1.2/services/www/src/docs/content/migrate-v1.mdx).
- Devin [skills](https://docs.devin.ai/cli/extensibility/skills/creating-skills.md),
  [subagents](https://docs.devin.ai/cli/subagents.md) and
  [MCP](https://docs.devin.ai/cli/extensibility/mcp/configuration.md).
- Antigravity [skills](https://antigravity.google/docs/skills),
  [subagents](https://antigravity.google/docs/subagents),
  [MCP](https://antigravity.google/docs/mcp) and
  [IDE workflows](https://antigravity.google/docs/ide/workflows).
- Hermes Agent [configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration),
  [MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp),
  [skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
  and [MCP config reference](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)
  — consulted for the provisional proposal; not verified against a live
  install.
