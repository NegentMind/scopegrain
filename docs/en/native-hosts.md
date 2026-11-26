---
title: Native host projections and limits
kind: guide
---
<!-- translated-from: docs/native-hosts.md @ 2026-11-24 -->
# Native Host Projections

> English translation of the canonical Spanish document
> (`../native-hosts.md`). The Spanish version prevails.

Scopegrain shares canonical procedures and project snapshots across twelve
documented hosts, plus one admitted provisional host (Hermes) and an
uncertified `generic` fallback adapter (scaffold for stdio MCP hosts
without a dedicated adapter). Native
files are thin bridges, not independently maintained implementations.
The `scopegrain-` namespace avoids replacing built-ins.

## Status

Documented formats and local fixture tests are not native validation.
Structural parse checks on applied fixtures verify only that generated
files are syntactically well-formed, never that a real host binary accepts,
discovers or enforces them. Three native pilots were validated in real
sessions (self-run): a fresh real Devin Local session on 2026-11-17
auto-loaded the 42 `scopegrain-*` skills and 15 subagents, activated the
`scopegrain` MCP from `.devin/mcp_config.json` and invoked
`scopegrain_status` (read-only, 16 doctor checks, 130-entry catalog
hash-verified); a fresh real Antigravity App/CLI session on 2026-11-19
auto-discovered the 72 `scopegrain-*` skills and 15 subagents under
`.agents/`, activated the `scopegrain` MCP from `.agents/mcp_config.json`
(22 read-only tools) and invoked `scopegrain_status` and
`scopegrain_catalog_list` live; and OpenCode V2 completed its pilot on
2026-11-23 against `opencode v2.3.2` as detailed below. The other hosts and
surfaces — Claude, Codex, the Antigravity IDE surface, provisional Hermes,
GitHub Copilot, Cursor and the tier-2b set (Cline, Roo Code, Kilo Code,
Gemini CLI, Windsurf) — still lack a native pilot. `self-run` means executed
by the project team, not independent validation or an endorsement by the host
vendor. The foundation suite completed locally with one test file at a time;
see [verification](verification.md) for its scope and separate earlier runs.

OpenCode V2 completed its pilot on 2026-11-23 against a real
`opencode v2.3.2` installation, including steps 5 (interruption and
resumption) and 6 (cleanup) in an isolated temporary fixture: see
[OpenCode V2 surface limits](#opencode-v2-surface-limits) and
[verification](verification.md). All seven procedure steps were executed
with evidence, so OpenCode V2 is the third surface validated in a real
session (self-run). The `/` autocomplete is capped by the TUI, so the 30
command files were not
enumerated on screen; what is verified is real dispatch of
`/scopegrain-status` from the composer.
No host was activated by these changes. Initialization creates proposals
under the selected configuration directory, normally
`.scopegrain/integrations/`; intended active paths below are NOT written
automatically.

| Host | Invocation proposal | Intended skill path | Intended role path |
| --- | --- | --- | --- |
| Claude Code | `/scopegrain-NAME` | `.claude/skills/<name>/SKILL.md` | `.claude/agents/<name>.md` |
| Codex | `$scopegrain-NAME` | `.agents/skills/<name>/SKILL.md` | `.codex/agents/*.toml` plus declarations |
| OpenCode V2 | `/scopegrain-NAME` | `.opencode/skills/<name>/SKILL.md` | `.opencode/agents/<name>.md` |
| Devin CLI/Local | `/scopegrain-NAME` | `.devin/skills/<name>/SKILL.md` | `.devin/agents/<name>.md` |
| Antigravity App/CLI | `/scopegrain-NAME` | `.agents/skills/<name>/SKILL.md` | `.agents/agents/<name>.md` |
| Antigravity IDE | `/scopegrain-NAME` | `.agents/skills/<name>/SKILL.md` | None assumed; skills-only proposal |
| GitHub Copilot | `/scopegrain-NAME` | `.agents/skills/<name>/SKILL.md` | `.github/agents/<name>.md` |
| Cursor | `/scopegrain-NAME` | `.cursor/skills/<name>/SKILL.md` | `.cursor/agents/<name>.md` |
| Cline | `/scopegrain-NAME` | `.cline/skills/<name>/SKILL.md` | None: subagents are `.yaml` under `.cline/agents` (CLI/Desktop only) and are not projected |
| Roo Code | `/scopegrain-NAME` | `.roo/skills/<name>/SKILL.md` | None: modes are YAML settings, not markdown agent files |
| Kilo Code | `/scopegrain-NAME` | `.kilo/skills/<name>/SKILL.md` | `.kilo/agents/<name>.md` |
| Gemini CLI | `/scopegrain-NAME` | `.gemini/skills/<name>/SKILL.md` | None documented at project level |
| Windsurf (legacy Cascade) | `/scopegrain-NAME` | `.windsurf/skills/<name>/SKILL.md` | None documented under `.windsurf/` |
| Hermes Agent (provisional) | None verified | `~/.hermes/skills/` (global; never written) | None assumed |

OpenCode native command bridges additionally target `.opencode/commands/`,
which the host dispatches only from its interactive composer; a
non-interactive `opencode run` does not expand them. Commands, skills and
roles still refer to the same configured canonical resources and runtime.
Copying a bridge without its project configuration and snapshot is
insufficient.

## Tier-2b surfaces

The five tier-2b adapters follow the tier-2 declarative pattern with these
differences, verified against current official documentation:

- **Cline**: commands projected as skills (workflows are on a deprecation
  path toward skills). Managed rules bridge `.cline/rules/scopegrain.md`
  and auto-detected `AGENTS.md`. Cline subagents are `.yaml` files under
  `.cline/agents` and only apply to the CLI/Desktop products — no
  markdown agent bridges are emitted. There is no project-level MCP
  config: the `cline-mcp.json` fragment declares the global destination
  `~/.cline/data/settings/cline_mcp_settings.json` (the VS Code
  extension keeps its own file under globalStorage) — never written.
- **Roo Code**: markdown slash commands in `.roo/commands/`, skills in
  `.roo/skills/` (v3.38+), rules bridge `.roo/rules/scopegrain.md`,
  `AGENTS.md` (`roo-cline.useAgentRules`, on by default). No agent
  bridges: modes are YAML definitions, not `.md` files. MCP: manual
  merge of `mcpServers.scopegrain` into `.roo/mcp.json`.
- **Kilo Code**: `.kilo/` roots of the current product (the legacy
  `.kilocode/` extension layout still auto-loads rules for backward
  compatibility, which is why the rules bridge targets
  `.kilocode/rules/scopegrain.md`). Commands `.kilo/commands/<n>.md`,
  agents `.kilo/agents/<n>.md` (documented `mode`/`permission`
  frontmatter, but no restriction proposal is emitted), always-loaded
  `AGENTS.md`. MCP: manual merge of `mcp.scopegrain` (`type: "local"`,
  `enabled: false`) into `kilo.jsonc` (or `.kilo/kilo.jsonc`, which takes
  precedence).
- **Gemini CLI**: skills `.gemini/skills/` (requires a trusted folder),
  TOML commands `.gemini/commands/<n>.toml` (`prompt` + `description`) —
  the new `commandFormat: 'toml'` dialect of the declarative model. The
  default context file is `GEMINI.md` (managed bridge at the project
  root); `AGENTS.md` only loads via a `context.fileName` opt-in the
  harness never writes. No agent bridges. MCP: manual merge of
  `mcpServers.scopegrain` into `.gemini/settings.json`; `trust` is never
  emitted.
- **Windsurf**: legacy Cascade surface (`.windsurf/`). Devin Desktop/
  Devin Local reads the `.devin/` roots already covered by the `devin`
  adapter; the windsurf adapter covers the documented legacy roots:
  `.windsurf/skills/`, workflows `.windsurf/workflows/`, rules
  `.windsurf/rules/scopegrain.md`, `AGENTS.md`. MCP exists only globally
  at `~/.codeium/windsurf/mcp_config.json` — never written.

Hosts without a documented markdown agent surface omit `agentRoot` in
policy: the absence of `agent/*` bridges is structural (a documented
host limitation), never a fabricated root.

## Explicit Variants

Only OpenCode V2 proposals are generated, using `permissions`,
`mcp.servers` and `disabled`. Existing V1 files are not deleted. Inspect the
activation plan and do not assume a V2 proposal works on V1.

Antigravity App/CLI and IDE are separate surfaces. The App/CLI proposal
includes documented custom agents; the IDE proposal does not infer that
capability. The `integrations/antigravity-mcp.json` fragment remains
disabled (`disabled: true`), while the dedicated `.agents/mcp_config.json`
file is ready to apply via
`host activate --host antigravity --surface <app-cli|ide> --apply`. No
automatic agent, workflow or MCP installation occurs.

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
  (`~/.hermes/config.yaml`, key `mcp_servers.scopegrain`).
- `instructions.md` — manual activation steps and the sources consulted.

The companion fragment `integrations/hermes-mcp.json` wraps a
`fragment.mcp_servers` subtree in strict JSON (a valid YAML 1.2 subset,
so it can be reviewed against the documented YAML shape) with
`enabled: false`. All Hermes roots are global paths under `~/.hermes/`;
the harness never writes them — see the activation contract below.

## `generic` Adapter (Uncertified Scaffold)

`generic` is the fallback adapter for stdio MCP-capable hosts without a
dedicated adapter. It is NOT certified against any product: no real host
claims the `.agent/` roots — they are a project-local convention the
owner must point at manually. Its output contract:

- Skill and command bridges at `.agent/skills/<name>/SKILL.md`
  (`commandFormat: 'skill'` — commands project as skills).
- Agent bridges at `.agent/agents/<name>.md` — plain markdown, no
  frontmatter.
- MCP fragment `integrations/generic-mcp.json` in the common stdio JSON
  shape: `{note, mcpServers.scopegrain:{type:'stdio', command:'node',
  args, disabled:true}}`. The `disabled:true` forces opt-in: the
  fragment is merged by hand after review; the harness never writes host
  configuration.
- The `invocation: 'workflow NAME'` label is a documentation convention
  inside bridge text; nothing enforces it.

`host activate --host generic --apply` materializes the `.agent/` roots
under the project, create-only and without global writes — like any
other host. No pilot: there is no certification that any binary
discovers or enforces these roots.

## Permissions And Models

Selected read-only roles receive host-specific restrictions:

- Claude: requested read-tool list.
- Codex: requested read-only filesystem sandbox.
- OpenCode V2: requested edit/shell/subagent denial — see
  [OpenCode V2 surface limits](#opencode-v2-surface-limits) for the scope
  actually measured on a real installation.
- Devin: custom subagent tool allowlist.
- Antigravity App/CLI: requested documented read-tool list; IDE has no
  custom-agent restriction proposal because agents are not assumed there.

These scopes are not equivalent guarantees. Validate actual tool names,
effective denial, MCP side effects and organization policy inside the host.
The 2026-11-19 App/CLI pilot confirmed effective denial of the native
write and shell tools for the read-only role, yet `call_mcp_tool` stayed
exposed and reaches other globally configured MCP servers with external
write operations — the read-tool list does not isolate third-party MCP
effects. Other roles inherit the owner's native policy; model prompts are
not a sandbox or a substitute for native permission enforcement.

Devin inline skill `allowed-tools` grants auto-approval rather than
restricting availability. Generated inline skills deliberately omit it.
Only the documented custom subagent field is treated as an availability
allowlist, and that custom-agent interface is experimental. A child that
cannot ask the user must return a blocker to the lead, not fabricate consent.
Devin Cloud behavior is not certified by the CLI/Local pilot or fixtures.

Models remain under host policy or an explicit owner choice. No universal
provider, model identifier, cost estimate or paid call is selected by
Scopegrain. Availability, router behavior and billing are host-dependent.

## OpenCode V2 Surface Limits

Measured against a real `opencode v2.3.2` installation (node v26.8.1,
Windows 10.0.26200) on 2026-11-23, with the bridges applied to an isolated
fixture project. These adapter observations complement the interactive
pilot recorded above: by themselves they do not validate discovery,
invocation and end-to-end denials on other versions or surfaces. OpenCode
V2 was used as documented at
[opencode.ai/docs](https://opencode.ai/docs/): skills, agents, commands and
MCP servers.

What the real binary accepted:

- `.opencode/skills/<id>/SKILL.md` and `.opencode/agents/<id>.md` are
  discovered without further configuration — 44 skills and 15 subagents
  were resolved from the applied fixture. Frontmatter scalars,
  `mode: subagent` and the `metadata.*` provenance block were tolerated.
- The ordered `permissions` list (`action`/`resource`/`effect`) is the V2
  schema and is enforced, last matching rule winning. The V1 legacy
  `permission` map (singular) is the form the migration guide deprecates;
  generated V2 bridges do not use it.
- `mcp.servers.<name>` with `type: "local"`, a `command` array and
  `disabled` is the canonical V2 MCP shape and connects as written once
  `disabled` is cleared. V2 documentation states server names no longer
  live directly under `mcp`; a real installation may still honour that
  legacy flat form alongside it, so a merged project file can legitimately
  carry both.
- `.opencode/commands/<name>.md` is the documented command path, but the
  host dispatches commands only from the interactive composer:
  `opencode run "/<name>"` does not expand one. A non-interactive run can
  therefore neither prove nor disprove command discovery — command counts
  must be read from a fresh interactive session.

### Read-only role scope in OpenCode V2

`opencode debug agents` resolves the generated `scopegrain-reviewer`
permissions exactly as emitted:

```text
action   resource        effect
*        *               allow    <- host base policy, inherited
read     *.env           ask
edit     *               deny     <- proposal
shell    *               deny     <- proposal
subagent *               deny     <- proposal
```

`edit`, `shell` and `subagent` are effectively denied because the last
matching rule wins. Every action not named there still inherits
`* -> allow`: `webfetch`, `websearch`, `skill`, `todowrite`, the MCP
resource tools and every external MCP tool (`<server>_<tool>`). The
read-only role can therefore still cause external write effects through a
third-party MCP server. This is the same class of finding the 2026-11-19
Antigravity pilot recorded for `call_mcp_tool`: a read-only proposal does
not isolate third-party MCP or network effects.

Per-tool denial is technically expressible — the real binary accepts an
exact `action` name (`scopegrain_memory_add`) and a prefix wildcard
(`server_*`) — so narrowing the profile to deny only the mutating
Scopegrain tools without blocking the read-only ones is possible. That is a
role-semantics decision, so it is not applied here.

A real child session launched as `scopegrain-reviewer` on 2026-11-23
measured the concrete effect: the `edit` and `shell` tools **do not exist**
in the child context (they do not ask for approval, they are unavailable)
and the loader denies `fs`, `node:fs`, `node:child_process`, `path` and
`os`. Neither `todowrite` nor the subagent tool appeared. What does remain
available is `read`, `glob`, `grep`, `webfetch`, `websearch`, `skill`,
`question` and the whole MCP catalog: the six Scopegrain local-write tools
plus the notion, todoist, tui, chrome-devtools, playwright, argus and
opencode writers. The read-only posture holds for disk and shell; it is not
a read-only sandbox over MCP or network.

### Cross-host skill discovery

OpenCode also indexes `.claude/skills` and `.agents/skills` for
compatibility. Documented precedence is project `.opencode/skills` first,
then `.agents/skills`, then `.claude/skills`, and skills are selected by
ID. Activating several hosts in one project therefore exposes the same
`scopegrain-*` IDs through more than one root: the highest-precedence copy
is the one loaded, but the overlapping roots are not isolation and the
duplicate surface is project-specific.

Measured in this workspace on 2026-11-23, with `.agents/skills/` already
populated by the Antigravity pilot (74 IDs) and `.opencode/skills/` just
activated (44 IDs, all already present in `.agents`): the visible count was
**74**, not 118, so de-duplication by ID does happen; and the
`scopegrain-unified-review` skill loaded from
`.opencode/skills/scopegrain-unified-review`, confirming the
higher-precedence root wins. The practical effect is that activating
OpenCode adds no new IDs when Antigravity already projected the same
skills, but it does replace the copy that gets loaded.

## Activation Contract

`src/hosts/activation.mjs` provides the opt-in machinery that materializes
generated native proposals into project-local host destinations:

- `prepareActivation(ctx, {host, surface?})` returns
  `{mode: 'dry-run', files: [{rel, action}], skipped, warnings, format}`
  where `action` is `create`, `conflict` or `noop` under the same checks
  as `preflightPlan` (planned collisions, containment, links/non-files,
  bounded identical-bytes comparison). It writes nothing.
- Every manifest proposal declares `activationMode`: `apply` (whole file
  `host activate --apply` may create), `merge` (fragment merged by hand
  into shared host configuration — Claude `.mcp.json`, Codex
  `.codex/config.toml`, OpenCode `opencode.jsonc`, Copilot
  `.vscode/mcp.json`, Cursor `.cursor/mcp.json`, Roo `.roo/mcp.json`,
  Kilo `kilo.jsonc` and Gemini CLI `.gemini/settings.json` — listed under
  `skipped` by activation) or `manual` (disclosure/review only). The
  legacy `manualMerge` key is retained only for consumers of the older
  schema and is deprecated in favor of `activationMode`.
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
- Devin and Antigravity are exceptions to the merge-only MCP rule: since
  Devin v3000.3 project MCP servers live in the dedicated whole file
  `.devin/mcp_config.json`, and in Antigravity they live in
  `.agents/mcp_config.json`, so activation applies them like any other
  projected file (create-only; a divergent existing file is a conflict,
  never an overwrite). The legacy shared `.devin/config.json` destination
  stays a skipped `mcp` merge entry for pre-v3000.3 hosts, and the
  `integrations/antigravity-mcp.json` fragment remains `disabled: true`.
  The generated files embed absolute machine-local paths — regenerate per
  machine with `host activate --host devin --apply` or
  `host activate --host antigravity --surface <app-cli|ide> --apply`
  after relocating the project or the installation (Devin does not expand
  env vars, so no templating is possible). The same machine-local caveat
  applies to every host's MCP fragment: `.mcp.json` (Claude),
  `.codex/config.toml` (Codex) and the OpenCode V2 proposal all embed
  absolute `serverPath`/`--project` values and must be re-merged or
  regenerated after a move.
- OpenCode V2 has no whole-file MCP destination, so its
  `integrations/opencode-mcp.json` fragment also declares its manual-merge
  target — the project `opencode.jsonc` (or `opencode.json` where the
  project uses that name) — as a skipped `mcp` entry. That declaration is
  disclosure only: `host manifest` labels the target `shared`, activation
  lists it in `skipped`, `doctor` never re-renders it as a fragment, and
  the absolute paths the fragment embeds reach the gitignore proposal so
  the merged project file stays unversioned. Nothing is ever written to it.
  Claude and Codex fragments keep the older, silent arrangement.
- `surface` selects a variant id (e.g. `app-cli`, `ide`) or one of its
  declared surfaces. Because Antigravity variants emit the same
  destinations with different permissions, omitting a surface there makes
  duplicated destinations collide into `conflict` — selection is required
  in practice. For the provisional host, `format` is `'provisional'` and
  nothing is auto-applied.
- Proposal bytes are re-derived from catalog and policy at call time; a
  hand-edited proposal file never propagates into a destination.
- Every generated artifact carries a provenance stamp: frontmatter
  `metadata.generated-by`/`scopegrain-version`/`source` in Markdown, a
  `# generated-by` comment in TOML and the `x-scopegrain-version` key in
  whole-file `mcp_config.json`. Deterministic (no timestamps) — a stale
  or hand-copied file is diagnosable without re-rendering.

Applying activation creates host roots inside the project only
(`.claude/`, `.codex/`, `.opencode/`, `.devin/`, `.agents/`, `.cursor/`,
`.github/`, `.cline/`, `.roo/`, `.kilo/`, `.kilocode/`, `.gemini/` and
`.windsurf/`, plus the root `GEMINI.md` for Gemini CLI). It never
writes global host configuration, never installs hooks or plugins, and
grants no auto-approval.

## Activation And Recovery

Inspect the complete generated activation plan, source, destination,
version/surface and existing settings. Activation requires specific approval
for that fixture/project and any associated tools, models, network or cost.
Initialization does not install hooks/plugins, alter active host roots,
grant auto-approval, register external servers or start MCP.

`host manifest --project PATH --host NAME [--surface X]` produces the
per-host install manifest (spec-kit parity): every file activation would
generate, with sha256 and an ownership label — `whole` (harness-owned
file), `partial` (user file carrying a managed `SCOPEGRAIN` section) or
`shared` (manual-merge proposal into host configuration). It is a
read-only preview artifact; writing or applying remains a separate
explicit step.

MCP configuration is machine-local. Relocation can leave absolute paths
pointing to the old project or installation; `doctor` reports that condition.
The `host-merge-targets` check also inspects every declared `merge`/`manual`
destination (`.mcp.json`, `.codex/config.toml`, `.devin/config.json`,
`opencode.jsonc`, `.vscode/mcp.json`, `.cursor/mcp.json`,
`.roo/mcp.json`, `kilo.jsonc`, `.gemini/settings.json`, ...) and
verifies the merged `scopegrain` block is still
present and intact — a missing destination or a lost merge fails the check.
Rebinding requires review of the new destination, not silent replacement.
Resource restoration only recovers compatible missing canonical bytes; it
does not overwrite divergent files or reconnect a remote MCP service.

`uninstall` derives its deletion set from the current configuration, not
from the journal of what was generated. If the `hosts` set is narrowed
after `init`, the native proposals of the removed hosts, their root
entrypoints and any diverged artifact survive `uninstall --apply` and need
a manual second pass; task records are preserved by design. Measured in the
OpenCode pilot fixture on 2026-11-23: 235 files deleted, 103 directories
removed, 2 diverged artifacts reported as `leftBehind` and 532 stale
proposals that had to be removed by hand.

The portable CLI works without native registration. Its project-bound MCP
server is an optional stdio query surface, not a mutating remote executor.
See [onboarding](onboarding.md), [security](security.md) and
[verification](verification.md).

## Native Pilots

Devin Local completed its pilot in a fresh real session on 2026-11-17 and
Antigravity App/CLI completed its own on 2026-11-19 (see Status above);
OpenCode V2 completed its own on 2026-11-23. Devin Cloud remains outside
the Devin pilot's scope. For every other selected
version/surface — Claude, Codex, the Antigravity IDE surface, the
provisional Hermes and the five tier-2b hosts — separately approve an
isolated pilot:
verify discovery and invocation, actual role tools and write denials,
unapproved MCP/network effects, delegation, interruption/resumption,
recovery without repeating effects and cleanup of only approved owned
configuration. Keep transcripts, actual versions, logs and full diffs.
Success on one host or surface does not validate another.

### Pilot validation procedure

Manual per host/surface. It is an owner action: execution requires a
real installed host and explicit approval of any associated tool,
model, network or cost.

1. **Isolated setup.** Fresh fixture project (not the development
   repo): `scopegrain init`, projected catalog, `host activate
   --host <H> [--surface S] --apply`. Record real versions of the host,
   the `node` runtime and the OS in the evidence.
2. **Discovery.** Fresh session of the real host: verify the
   skills/bridges appear without undocumented manual steps, the
   `scopegrain-` namespace does not collide with built-ins, and the MCP
   fragment loads the server (or stays disabled when the fragment says
   so).
3. **Invocation.** Run at least one `scopegrain-*` skill and one
   read-only MCP tool (e.g. `scopegrain_status`); verify output
   against the fixture state.
4. **Denials.** In a read-only role attempt one native write operation
   and one third-party MCP call: both must fail or request approval —
   document the real scope (native denial does not isolate external
   MCP effects, see the Antigravity pilot).
5. **Interruption and resumption.** Cut an operation mid-flight and
   resume: no repeated effects, no corrupt state.
6. **Cleanup.** Deactivate and remove only the approved fixture
   configuration; verify no traces remain in global host config.
7. **Evidence.** Keep the full transcript, diffs of written files,
   versions and logs. Record the result in this document (Status) with
   date — one host/surface validated in a real session (self-run) implies
   none of the others.

Validation criterion: all 7 steps executed with archived evidence.
Failure criterion: any unverified step leaves the host/surface as
"without pilot" — never "partially validated".

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
- Cline [skills](https://docs.cline.bot/customization/skills),
  [configuration layout](https://docs.cline.bot/getting-started/config),
  [rules](https://github.com/cline/cline/blob/main/docs/customization/cline-rules.mdx)
  and [MCP](https://github.com/cline/cline/blob/main/docs/mcp/mcp-overview.mdx).
- Roo Code [skills](https://github.com/RooCodeInc/Roo-Code/blob/main/apps/docs/docs/features/skills.mdx),
  [custom instructions/AGENTS.md and rules](https://github.com/RooCodeInc/Roo-Code/blob/main/apps/docs/docs/features/custom-instructions.md),
  [slash commands](https://github.com/RooCodeInc/Roo-Code/pull/6263) and
  [project MCP](https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo/).
- Kilo Code [skills](https://kilo.ai/docs/customize/skills),
  [workflows/slash commands](https://kilo.ai/docs/customize/workflows),
  [custom modes/agents](https://kilo.ai/docs/customize/custom-modes),
  [subagents](https://kilo.ai/docs/customize/custom-subagents),
  [rules](https://kilo.ai/docs/customize/custom-rules),
  [AGENTS.md](https://kilo.ai/docs/customize/agents-md) and
  [MCP](https://kilo.ai/docs/automate/mcp/using-in-kilo-code).
- Gemini CLI [skills](https://geminicli.com/docs/cli/using-agent-skills/),
  [TOML commands](https://geminicli.com/docs/cli/custom-commands/),
  [GEMINI.md/context](https://geminicli.com/docs/cli/gemini-md/) and
  [MCP](https://geminicli.com/docs/tools/mcp-server/).
- Windsurf [skills and customization surface](https://docs.windsurf.com/windsurf/cascade/skills.md)
  and [config import in Devin CLI](https://docs.devin.ai/cli/reference/configuration/read-config-from).
- Hermes Agent [configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration),
  [MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp),
  [skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
  and [MCP config reference](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)
  — consulted for the provisional proposal; not verified against a live
  install.
