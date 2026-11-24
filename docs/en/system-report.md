<!-- translated-from: docs/system-report.md @ 2026-11-24 -->
# Scopegrain system report

> English translation of the canonical Spanish document
> (`../system-report.md`). The Spanish version prevails.

## 1. Identity and purpose

Scopegrain is a portable proportional-engineering harness for working
with AI agents. It binds context, request, declared authorization,
tasks, evidence and continuity in a project. It does not invent Organic
or SDD: it applies these methodologies as procedures and controls over
recorded work. It is not an autonomous agent or model executor.

The product ships the `scopegrain` entry point (CLI and MCP server,
`scopegrain_*` tools) and the canonical `.scopegrain/config.json`
configuration as technical identifiers. The
product name does not imply automatic migration of commands or records.
The [README](../../README.md) contains the quick start.

## 2. Audience and problems

It is aimed at teams, owners and operators working with coding agents
who need continuity across projects, sessions and hosts. It seeks to
reduce context drift, avoid uniform bureaucracy for every change and
make scope, approval and evidence explicit.

The harness does not demonstrate code comprehension nor eliminate
hallucinations. Its controls do not replace investigation, human
judgment or real environment permissions. A result allowed by
methodology does not by itself grant authorization to operate tools.

## 3. Operational flow

1. `inspect` examines manifests in a bounded, read-only way; it presents
   detected commands as proposals, without executing them.
2. `init` asks for identity, language, hosts, methodology, config path,
   seven destinations and eight Git versioning preferences.
3. The operator reviews the file plan and confirms its creation. New
   instructions at the root are created without overwriting existing
   ones.
4. The project receives configuration, catalog and a resource snapshot;
   integration proposals are kept for manual review.
5. A workflow packet gathers procedure, context and, where applicable,
   state and effective actions of a task, without executing an agent.
6. Tasks and DAG plans record scope, dependencies, gates, verification,
   review and acceptance per the applicable workflow and methodology.
7. Sessions, recovery and `doctor` allow querying continuity,
   diagnosing resources and detecting problems without repeating
   effects.

The alternative configuration is selected via `--config`. Configuration
or path changes require resolving the context again; there is no watcher
that silently updates already-bound processes.
See [onboarding](onboarding.md) and [workflows](workflows.md).

## 4. Architecture

- `bin/` and `src/cli.mjs`: entry point, parser, interactive and JSON
  interface.
- `src/discovery/`: bounded local inspection of manifests.
- `paths`, `config`, `context`, `fsx` and `bootstrap`: path boundaries,
  configuration, bound context, files and onboarding plans.
- `catalog`, `workflows` and `resource-recovery`: catalog, snapshots,
  procedure packets, diagnosis and controlled restoration.
- `tasks`, `plans` and `transition`: tasks, DAG, state and transitions.
- `artifacts`, `specifications`, `formal-bindings`, `digests`, `outcomes`,
  `approvals` and `methodology`: typed records, relationships, digests,
  consent and reports bound to methodological gates.
- `evidence`, `sessions`, `versioning` and `doctor`: declared evidence,
  continuity, versioning preferences and diagnosis.
- `hosts` and `adapters`: projections for review and compatible facades.
- `mcp`: optional query server, bound to a project.

The complete map of modules and responsibilities is in
[architecture](architecture.md). `policy/workflow.json` holds the
canonical contract of states and actions; methodology adds gates, not
another state machine.

## 5. Catalog inventory

The frozen inventory of the active manifest as of 2026-11-24
(`resources/manifest.json` v`0.1.2`) contains
**140 entries**:

| Type | Count |
| --- | ---: |
| `agent` | 15 |
| `command` | 18 |
| `mcp` | 1 |
| `profile` | 5 |
| `prompt` | 11 |
| `reference` | 24 |
| `rule` | 22 |
| `skill` | 44 |

There are 24 distinct alias identifiers and 32 alias correspondences,
including their mode variants. These counts are not equivalent.
The 44 active skills do not certify the skills of the original archive.
The catalog source is `resources/manifest.json`; proposals and
snapshots do not constitute authorization to activate tools.

### Procedures

The 18 catalog commands are grouped by responsibility:

- Planning and execution: `plan-work`, `implement-task`,
  `coordinate-plan`, `specify-change`, `triage-work`.
- Status and quality: `report-status`, `verify-work`, `review-change`,
  `audit-project`, `audit-harness`.
- Investigation and decisions: `investigate`, `compare-options`,
  `assess-release`, `plan-recovery`.
- Technical improvement: `simplify-code`, `analyze-structure`,
  `audit-web-performance`.
- Request classification: `intake`.

Each procedure contributes instructions and context; it does not create
a process, execute a model or delegate by itself.

### Roles and profiles

The 15 roles are `requirements-analyst`, `verification-engineer`,
`integration-engineer`, `release-engineer`, `lead`, `architect`,
`implementer`, `algorithm-specialist`, `security-auditor`,
`resilience-tester`, `performance-engineer`, `documentation`, `researcher`,
`reviewer` and `harness-maintainer`. They are responsibilities, not
authenticated identities or model choices.

The five profiles are `core`, `web`, `rust`, `python` and `database`.
Opt-in profiles do not install stacks or authorize tools.

## 6. Data and locations

By default, the project places under `.scopegrain/`:

| Data | Usual location |
| --- | --- |
| Configuration, discovery, catalog and resources | `config.json`, `discovery.json`, `catalog.json` and resource folders |
| Host proposals | `integrations/` |
| Plans, specifications and designs | `plans/`, `plans/specs/`, `plans/designs/` |
| Tasks | `tasks/` |
| Reports and reviews | `reports/`, `reports/reviews/` |
| Research | `research/` |
| Decisions and approvals | `decisions/`, `decisions/approvals/` |
| Lessons and handoffs | `memory/lessons/`, `memory/handoffs/` |
| State and sessions | `state/`, `state/sessions/` |

Locations depend on the configured paths; they are not fixed universal
destinations. Operational documents do not replace or merge by default
with the managed product's documentation. See
[workflows](workflows.md) and [versioning in onboarding](onboarding.md).

## 7. Proportional methodology

`manual` preserves V1 compatibility; `organic-sdd` chooses a light or
formal route based on declared facts; `sdd` requires formal references
for changes. An old configuration without the field is interpreted as
`manual` in memory without rewriting the file. A V2 task keeps its
controls even if the later configuration is `manual`.

ODD means Organic Driven Development. Intent, authorization,
comprehension, uncertainty, risk and continuity are declarations: the
size of the change does not demonstrate safety. Unknown risk, unresolved
uncertainty, insufficient comprehension or lack of authorization block
the change. The light route keeps a task without inventing the chain of
formal artifacts; it still requires declared authorization.

The formal route requires a bound structured specification and design,
approvals, contained scope and assigned scenarios. Every SDD task,
including preparatory ones, has at least one scenario; the plan must
cover the complete union of the specification. See
[methodology](methodology.md).

## 8. Lifecycle and consistency

The usual progression is:

```text
PLAN -> ACT -> VERIFY -> [COLLATERAL] -> EVALUATE -> REVIEW -> ACCEPT -> CLOSE
```

`RESEARCH` and `STALL` are foreseen detours, not arbitrary shortcuts,
and `ABANDON` is the terminal exit without evidence.
The exact edges and allowed returns are in
[task workflow](task-workflow.md) and `policy/workflow.json`. For formal
advancement, transitive dependencies must be in `CLOSE`.

Returning to `ACT` invalidates previous verification and review. A new
verification also invalidates the previous review unless another one is
supplied in the same operation. Transitions use expected revision, own
lock and exclusive temporary file with rename; this is not a global
transaction across all records nor a continuous lock of external tools.

## 9. Approvals and evidence

`approval target/create/show/answer` separates content description,
request, query and response. Responses include custom options,
rejection and revocation per the contract; changing the bound content or
revoking an approval can block the next gate. The response uses expected
revision and digest, revalidated under lock.

Checks, review and supplied identities are attestations:
recorded declarations, not authenticated identity nor observation of a
real execution. Hashes bind records and declared payloads; they do not
prove the complete worktree nor the changing bytes of a cited log.
The formal report binds the review and the current digests, without
turning the operator-supplied body into proof of truth.

## 10. CLI

Syntax examples from the repository root:

```powershell
node ./bin/scopegrain.mjs inspect --project "C:\ruta\proyecto"
node ./bin/scopegrain.mjs init --project "C:\ruta\proyecto"
node ./bin/scopegrain.mjs doctor --project "C:\ruta\proyecto"
node ./bin/scopegrain.mjs catalog list command
node ./bin/scopegrain.mjs pipeline --project "C:\ruta\proyecto" --mode plan
node ./bin/scopegrain.mjs specification create --project "C:\ruta\proyecto" --input spec.json
node ./bin/scopegrain.mjs design create --project "C:\ruta\proyecto" --input design.json
node ./bin/scopegrain.mjs approval target --project "C:\ruta\proyecto" --input target.json
node ./bin/scopegrain.mjs approval create --project "C:\ruta\proyecto" --input approval.json
node ./bin/scopegrain.mjs outcome create --project "C:\ruta\proyecto" --input outcome.json
node ./bin/scopegrain.mjs methodology check --project "C:\ruta\proyecto" UUID --to ACT
```

These are examples, not execution evidence. JSON creations preview by
default and use explicit `--apply` to write; previewed IDs are not
reserved. Mutating verbs preview as dry-run unless `--apply` — including
`task create` (both flag and `--input` forms), meta/disposition/note/
step/transition, goal create/transition, memory add, journal compact,
constitution set and the VantaDB verbs.
Discovery never executes the commands it finds.
See [onboarding](onboarding.md) and [workflows](workflows.md).

## 11. Optional MCP

The MCP server offers 37 tools, strictly bound to the project and
configuration selected at startup: 23 read-only (`READ_ONLY`), 4 that
write local state under the same CAS/lock discipline as the CLI
(`WRITE_LOCAL`: `scopegrain_next_task` with `claimBy`,
`scopegrain_task_meta`, `scopegrain_memory_add`,
`scopegrain_goal_create`), 2 discard writers (`WRITE_DISCARD`:
`scopegrain_task_disposition`, `scopegrain_goal_transition`, both with
`destructiveHint: true` for their discard/drop semantics) and 6 backend
reads (`READ_BACKEND`) that spawn the enrolled `vantadb-server` binary
and are annotated `openWorldHint: true`. Among the
read-only tools are `scopegrain_specification_get`,
`scopegrain_approval_get`, `scopegrain_methodology_check`,
`scopegrain_memory_read`, `scopegrain_goal_list`,
`scopegrain_context`, `scopegrain_metrics` and `scopegrain_task_suggest`
(a declared suggestion of skills from task metadata; it never writes
`task.skills`).

The optional transport is stdio. SDK loading is lazy; the declared
dependencies are `@modelcontextprotocol/sdk` 1.27.1 and `zod`
4.5.4. The tools never execute shell or start an autonomous network;
arguments are bounded in two layers (advertised schema plus a serialized
bytes ceiling) and contents are validated by the core. The existence of
the interface does not imply starting a server or certifying a native
integration.

## 12. Host proposals

The following paths are proposed destinations, not files activated by
`init`. Formats and permissions must be reviewed for the installed
version.

| Surface | Proposal and limit |
| --- | --- |
| Claude Code | Skills and agents under `.claude/`; requested read list for restricted roles. |
| Codex | Skills under `.agents/skills/`; `.codex/agents/` roles and TOML declaration for manual merge. |
| OpenCode V2 | Bridges under `.opencode/`; V2 uses `permissions` and `mcp.servers`. Earlier V1 files are kept. |
| Devin Local/CLI | Skills and agents under `.devin/`; proposed allowlist for custom subagents. Cloud is not a certified equivalent. |
| Antigravity App/CLI | Proposed skills and agents under `.agents/`; proposed MCP disabled pending review. |
| Antigravity IDE | Skills proposal; custom-agent support is not assumed. |

In Devin, inline `allowed-tools` means auto-approval, not an
availability allowlist; generated inline skills omit it. `.agents/` is a
shared convention and does not isolate products. No proposal certifies
permissions, discovery or real behavior in a host. See
[native formats](native-hosts.md).

## 13. Recovery and continuity

Resource search and diagnosis compare the snapshot and its sources.
Restoration only recovers absent files with compatible bytes and
matching hash; it does not overwrite divergent files. `session resume`
queries state, events and recorded budget; it does not repeat effects.

MCP fragments contain machine-local paths: a relocation requires review
and manual rebinding. An existing foreign or possibly stale lock is not
broken automatically. Recovery authorization is not inferred from the
mere presence of a proposal.

## 14. Temporaries and rollback

Relevant writes use exclusive `wx` open; only locks and temporaries
whose ownership the operation acquired are cleaned up. Rollback of
create-only files removes files created by that operation; it does not
delete directories or preexisting content. Existing records and evidence
are not deleted as a general recovery mechanism.

No general collector, TTL, automatic lock recovery or universal
durability against hardware failure or power loss is promised.

## 15. Permissions, security and FMEA

| Risk | Control and residual limit |
| --- | --- |
| Local path substitution | Containment and link rejection at validation points; a TOCTOU window persists. |
| Drift between files | Digests, CAS and local locks; there is no serializable multi-file transaction. |
| Confusing instructions with permissions | Gates and proposals are harness controls; Markdown is not a sandbox nor does it intercept every tool. |
| False evidence or identity | Checks, actors, review and risk are declarations; they are not authenticated nor is the whole execution observed. |
| Sensitive data | Free bodies require review and redaction; there is no universal secret detector. |
| Host paths or versions | MCP uses local absolute paths and host-dependent formats; review and rebind manually. |
| Transitive dependencies | Without a lockfile, identical transitive resolution is not guaranteed on every install. |

Inspection, rules and evidence do not grant permissions for network,
installations, publication, out-of-scope writes or other effects.
See [security](security.md) and [compatibility](compatibility.md).

## 16. Verification status

The suite currently numbers **1703 tests** (count verified in the
2026-11-24 audit). The latest recorded full run (`npm test` serial,
2026-11-23) reported 1440 tests: 1435 pass, 5 fail (4 long-run flakes
that pass standalone and 1 pre-existing `host-variants` failure
reproducible on a clean `HEAD` worktree), exit 1, on Windows with
Node.js v26.8.1 and npm 11.6.0; later commits grew the suite without a
new recorded full run. The intermediate full runs
(673, 699, 770, 813, 1152 and 1411) and the earlier batches of each
block are separate runs, not summable figures; their scope and
historical results are in [verification](verification.md). Historical
batches must not be summed as if they were a single suite of the
current state.

The Devin Local native pilot was certified in a fresh real session on
2026-11-17: 42 `scopegrain-*` skills and 15 subagents auto-loaded, the
`scopegrain` MCP active from `.devin/mcp_config.json` and
`scopegrain_status` invoked (doctor with 16 checks and a 130-entry
catalog hash-verified).
Antigravity was first piloted on 2026-11-18 (`.agents/` activation
applied and consumed by its agent session), and its App/CLI surface
completed the certified native pilot in a fresh real session on
2026-11-19: 72 `scopegrain-*` skills and 15 subagents auto-discovered,
the `scopegrain` MCP active from `.agents/mcp_config.json` and live
`scopegrain_status` and `scopegrain_catalog_list` invocations. The
OpenCode V2 native pilot was certified in a fresh real session on
2026-11-23 against `opencode v2.3.2`: 15/15 `scopegrain-*` subagents
resolved, 74 de-duplicated skill IDs with `.opencode/skills` winning
precedence over `.agents/skills`, the `scopegrain` MCP active with live
`scopegrain_status`, `scopegrain_catalog_list` and
`scopegrain_list_tasks` invocations, and cleanup leaving no traces in
the global configuration. The other
hosts and surfaces (Claude, Codex, the Antigravity IDE surface
and Hermes) still lack one. CI was dispatched successfully on 2026-11-18. These tests do not certify untested hosts, versions or
operating systems.

## 17. Continuous integration

The [verification workflow](../../.github/workflows/verify.yml) is
triggered by manual `workflow_dispatch`, by `push` to `develop`/`main`
and by `pull_request` targeting `develop`. It has already run: the
first remote run (`44391417084` on `develop`, 2026-11-18) finished
green on every matrix cell. The `test` job declares Node 22 and 24 on
`ubuntu-latest` and `windows-latest`, with `contents: read`, official
actions pinned by SHA, checkout without persistent credentials, a
manifest-version guard on PRs touching `resources/` and a 180-minute
limit. A second `viewer` job (ubuntu, 30 minutes) runs lint, typecheck,
tests and build of the viewer.

Only on runners does it install dependencies with `--ignore-scripts`,
`--no-package-lock`, `--no-audit` and `--no-fund`, and run `npm test`.
There is no deployment or release in that workflow. There is no
lockfile guaranteeing exact reproducibility of transitive dependencies.

## 18. Limitations and priorities

1. Run isolated, authorized pilots per native version and surface;
   fixtures do not replace real permission and recovery testing.
   Devin Local, Antigravity App/CLI and OpenCode V2 already have their
   certified pilots (real sessions, 2026-11-17, 2026-11-19 and
   2026-11-23); Claude, Codex, the Antigravity IDE surface and Hermes
   remain pending.
2. Resolve licensing and provenance before granting redistribution.
   `package.json` already declares the Apache-2.0 license, the
   `scopegrain` binary, a bounded `files` list and repository metadata;
   publication to an external registry still requires explicit owner
   authorization and the `legacy/` material remains outside the
   distribution pending per-piece review.
3. Decide a lockfile strategy to improve reproducibility without
   confusing pinned direct versions with pinned transitive ones.
4. Evaluate any technical rename as an independent compatibility
   change; the existing identifiers remain in force.
5. Keep the limits explicit: there is no global executor, host sandbox
   or universal guarantee over permissions, execution or results.

Code repository: [ness-e/scopegrain](https://github.com/ness-e/scopegrain).
The first-publication strategy uses the same initial commit on `main`
and `develop`: `main` as public entry and default branch, `develop`
to continue work. The result of each push is checked
separately on the remote references; it is not inferred from the content
of this document.
