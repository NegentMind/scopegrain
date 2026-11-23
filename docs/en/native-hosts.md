---
title: Native host projections and limits
kind: guide
---
# Native Host Projections

Scopegrain shares canonical procedures and project snapshots across five
documented hosts, plus one admitted provisional host (Hermes) and an
uncertified `generic` fallback adapter (scaffold for stdio MCP hosts
without a dedicated adapter). Native
files are thin bridges, not independently maintained implementations.
The `scopegrain-` namespace avoids replacing built-ins.

## Status

Documented formats and local fixture tests are not native certification.
Structural parse checks on applied fixtures verify only that generated
files are syntactically well-formed, never that a real host binary accepts,
discovers or enforces them. Two native pilots are certified: a fresh real
Devin Local session on 2026-11-17 auto-loaded the 42 `scopegrain-*` skills
and 15 subagents, activated the `scopegrain` MCP from
`.devin/mcp_config.json` and invoked `scopegrain_status` (read-only, 16
doctor checks, 130-entry catalog hash-verified); and a fresh real
Antigravity App/CLI session on 2026-11-19 auto-discovered the 72
`scopegrain-*` skills and 15 subagents under `.agents/`, activated the
`scopegrain` MCP from `.agents/mcp_config.json` (22 read-only tools) and
invoked `scopegrain_status` and `scopegrain_catalog_list` live. The other
hosts and surfaces — Claude, Codex, OpenCode, the Antigravity IDE surface
and the provisional Hermes — still lack a native pilot. The foundation
suite completed locally with one test file at a time; see
[verification](verification.md) for its scope and separate earlier runs.
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
- OpenCode V2: requested edit/shell/subagent denial.
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
(`.claude/`, `.codex/`, `.opencode/`, `.devin/`, `.agents/`). It never
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
Rebinding requires review of the new destination, not silent replacement.
Resource restoration only recovers compatible missing canonical bytes; it
does not overwrite divergent files or reconnect a remote MCP service.

The portable CLI works without native registration. Its project-bound MCP
server is an optional stdio query surface, not a mutating remote executor.
See [onboarding](onboarding.md), [security](security.md) and
[verification](verification.md).

## Native Pilots

Devin Local completed its pilot in a fresh real session on 2026-11-17 and
Antigravity App/CLI completed its own on 2026-11-19 (see Status above);
Devin Cloud remains outside the Devin pilot's scope. For every other
selected version/surface — Claude, Codex, OpenCode, the Antigravity IDE
surface and the provisional Hermes — separately approve an isolated pilot:
verify discovery and invocation, actual role tools and write denials,
unapproved MCP/network effects, delegation, interruption/resumption,
recovery without repeating effects and cleanup of only approved owned
configuration. Keep transcripts, actual versions, logs and full diffs.
Success on one host or surface does not certify another.

### Pilot certification procedure

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
   date — one certified host/surface implies none of the others.

Certified criterion: all 7 steps executed with archived evidence.
Failure criterion: any unverified step leaves the host/surface as
"without pilot" — never "partially certified".

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
