# Legacy components and migration destination

> English translation of the canonical Spanish document
> (`../component-migration.md`). The Spanish version prevails.

## Actual state

Scopegrain has a new core, not a complete conversion of the previous
harness. The original content of this copy remains in
`legacy/opencode/`; it has not been deleted or automatically
activated. The `.opencode` folder of the source project is not
modified.

Inventory by local file enumeration, not by the old manifest counts:

| Legacy component | Captured inventory | Current treatment |
| --- | --- | --- |
| `commands/` | 13 Markdown files | Intentions split into canonical commands and compatible aliases; no shell is executed |
| `agents/` | 11 definitions | Expanded neutral roles and native proposals, without automatic dispatch |
| `skills/` | 198 direct folders and 197 `SKILL.md` files | Individual inventory and triage; new procedures, not mass import |
| `rules/` | 14 rules and a README | Neutral rules selected by command/profile |
| `references/` | 24 files | Twenty-four new neutral references, on demand |
| `task-system/` | 82 recursive files | New core with tasks, plans, artifacts and sessions; does not replicate every tool |
| `mcp/` | A media server | No |
| `mcp-profiles/` | Three JSON, README and selector script | No |
| `plugins/` | `ponytail.ts` | No |
| `opencode-loop/` | 52 recursive files | No; they are state and history, not a portable library |

The active source is `resources/manifest.json`, including its
`aliases` array. The historical `provenance/` inventory does not
determine the number of current resources. Textual or functional
equivalence with each original is not certified; the topics and the
neutral contracts are preserved.

The CLI incorporates `catalog`, `workflow`, `plan`, `artifact` and
`session` besides inspect/init/doctor/mcp/task. The thirteen command
aliases produce packages for the host, not autonomous LLM processes.
See [operations and formats](workflows.md).

**Preserved does not mean migrated.** `legacy/opencode/` is ignored
by Git while licenses and possible secrets are reviewed. A clone of
the new repository will not include that local archive. Before
distributing the catalog, each approved piece and its provenance
must be expressly incorporated.

## Implemented canonical organization

```text
src/core/             Contracts, state, configuration and validations
src/discovery/        Project evidence and proposals
src/hosts/            Versioned proposals per host capabilities
src/adapters/         Compatibility entries towards src/hosts
resources/commands/   One intention per procedure, not shell scripts
resources/agents/     Neutral roles, not automatically executed agents
resources/skills/     Reusable procedures loaded on demand
resources/rules/      Obligations and application criteria
resources/references/ Consultation, not implicit security authority
resources/profiles/   Opt-in specializations, complemented with core
resources/prompts/    Briefs and context, not storage logic
templates/hosts/      Native formats generated from canonical sources
policy/               Policies the code actually validates
provenance/                          Historical provenance/triage inventories
docs/                 Product documentation, not task artifacts
.scopegrain/          Plans, task files, reports, reviews, memory and state
legacy/               Local provenance copy, never an implicit active source
```

The conceptual separation is kept: command = when and what for;
agent = responsibility; skill = procedure; rule = obligation;
reference = knowledge; profile = specialization; adapter = format
and real host capabilities.

Duplicating the roles and the entire catalog per host is not
advisable. The source of each behavior must be unique; the adapter
only translates the format.

## Commands: preserving the thirteen intentions

The following table preserves the meaning of the previous
entrypoints; it does not claim their names remain the editable
source. For example, `pipeline plan/task/run` resolves to
`plan-work`, `implement-task` and `coordinate-plan`; `audit
quick/review/full` separates verification, review and audit. The
exact correspondences live in `resources/manifest.json`. An alias
grants no new effects nor automatically executes its proposal.

This table defines the intentions of the new canonical procedures.
No row claims they are already activated inside a host.

| Legacy command | Preserved intention | Neutral contract |
| --- | --- | --- |
| `/pipeline` | Plan, execute a task or walk a plan | Resolve paths from configuration; delegate per real capabilities |
| `/spec` | Specify before implementing | Investigate first and ask only what the repository does not answer |
| `/backlog` | Consult active work and recommend priority | Do not assume `docs/dev/Backlog.md` or VantaDB taxonomies |
| `/status` | Consolidated status of work and verifications | Read the configured artifacts; not another project's historical files |
| `/audit` | Quick, certify, review and full | A common procedure with project-approved verifications; do not impose Cargo |
| `/harness` | Audit the health of the agent system itself | Validate catalogs, links, roles, profiles and adapters; current doctor is more limited |
| `/research` | Per-area investigation and decision synthesis | Discover project areas and record sources; network requires permission |
| `/ship` | Preflight and delivery decision with planned recovery | Separate evaluating from publishing; approve every operation with external effects |
| `/rollback` | Recovery of a failed delivery | Exact plan and authorization; never infer permission to lose data |
| `/code-simplify` | Simplification with preserved behavior | Apply the project's conventions and tests, not a fixed module list |
| `/codeGraph` | Structural and impact analysis | Optional graph; report degradation if only reading or search is available |
| `/cleanCA` | Code and architecture review, report only | Remove fixed crate scopes and VantaDB-specific exceptions |
| `/webperf` | Web performance, only when applicable | Opt-in web profile; differentiate static hypotheses from real measurements |

A conversational command and a terminal command are different
interfaces. Proposals are generated with the `scopegrain-`
namespace, as commands or skills depending on the host. An identical
slash syntax is not promised nor are those files activated at
initialization. See [native bridges](native-hosts.md).

## Agents: preserve responsibilities, not couplings

| Legacy role | Registered neutral role | Responsibility |
| --- | --- | --- |
| `vanta-lead` | `lead` | Coordination, human decisions and authorized delivery |
| `vanta-arch` | `architect` | Architecture, interfaces and tradeoffs |
| `vanta-worker` | `implementer` | Implementation within the contract |
| `vanta-engine` | `algorithm-specialist` | Domain algorithms; optional specialization |
| `vanta-audit` | `security-auditor` | Security and risks, without implementing its own fixes |
| `vanta-chaos` | `resilience-tester` | Fuzzing and controlled failures in authorized environments |
| `vanta-tuner` | `performance-engineer` | Measurement, profiles and evidence-backed optimization |
| `vanta-docs` | `documentation` | Documentation and consistency with real APIs |
| `vanta-research` | `researcher` | Investigation and verifiable sources |
| `vanta-review` | `reviewer` | Independent review of implementation and contract |
| `vanta-harness` | `harness-maintainer` | Harness health and drift |

Responsibilities are added without inventing execution or
permissions: `requirements-analyst` for requirements and
ambiguities; `verification-engineer` for checks and evidence;
`integration-engineer` for boundaries and environment adaptation;
`release-engineer` for delivery preparation, without implicit
permission to publish.

The configuration must not invent permissions the host does not
enforce. A role written in Markdown does not create a subagent or
context isolation. If no real delegation or independent review
exists, the adapter must declare it and request human intervention
or an explicit exception.

## Skills: broad catalog, selective loading

The 197 skills were captured individually with hashes, indicators
and blocks in `provenance/legacy-inventory.json`. The identifier triage
is in `provenance/legacy-classification.json`:

- **General engineering (37):** planning, specification, incremental
  implementation, debugging, review, investigation and
  documentation.
- **Stack (16):** procedures for concrete technologies, only if they
  exist or were selected in the project.
- **Domain (112):** data, accessibility, content, documents or
  design, selected per task, not always injected.
- **External integration (28):** tools, MCP, services or plugins
  with explicit dependencies and authorizations.
- **Project (4):** `vantadb`, `vantadb-mcp`,
  `vanta-design-orchestrator` and `documentation-skill`, outside the
  generic profile.

The categories are review routes, NOT audits of the bodies, licenses
or dependencies. The 197 originals remain blocked; the fresh
replacements do not authorize their redistribution. The 160
non-general specialties are not activated automatically by detecting
a stack. The new procedures are usable without reading the private
archive.

`catalog legacy [KIND]` queries the captured inventory without
serving bodies. `catalog legacy-show KIND ID` shows the detail and,
if it exists, the related current resource. Historical capture and
active state are distinguished. Before activating an original,
semantic review, license, dependencies, capabilities and behavior
tests are still missing.

## Rules and references

The rules mix general principles with concrete decisions. For
example, `api-contract.md` contains API consistency, but also
VantaDB paths, versions and bindings. Removing the name prefix is
not enough.

The new sources separate general rules of contract, evidence,
review and scope from opt-in specializations. The core, web, rust,
python and database profiles do not impose IQL, WAL or a commercial
model. Core always complements the chosen profile, without assuming
tools. Release and license policies are agreed with the owner.

The 24 active references are new neutral consultation syntheses;
their originals are kept separately. A reference does not acquire
security authority by being cited.

## Other components that must not silently disappear

- **Campaign/C0:** stateful tasks, DAG, artifacts and new sessions.
  Not every tool from the previous server is replicated.
- **Memory and traces:** use approved destinations and per-project
  provenance; do not import VantaDB decisions or sessions as another
  repo's memory.
- **Budgets:** limit on operations recorded in sessions, not on
  native calls, tokens, money or skipped executions.
- **MCP and profiles:** keep neutral definitions and generate
  per-host proposals; do not copy global servers, credentials or
  personal paths.
- **Ponytail:** preserve its principles if chosen, but the
  `ponytail.ts` plugin uses the OpenCode API and state and depends
  on global files. It is not considered a portable plugin just by
  changing folders.
- **Sandbox:** do not reuse the weak isolation as a strong
  guarantee.
- **Self-modification:** harness maintenance with review and
  permission, not implicit authorization for it to change its own
  restrictions.
- **History:** keep sessions and logs as a private archive; do not
  publish them or automatically migrate them to every project.

## Complete migration criterion

The core enables the vertical flow specify -> plan -> implement with
the host -> verify -> review -> close -> recover context. The
executed evidence and its gaps are in
[verification](verification.md). Full equivalence with plugins,
sandbox or specialties that remain archived is not claimed, nor real
certification in the six hosts: only Devin Local (real session,
2026-11-17) and Antigravity App/CLI (real session, 2026-11-19) have
certified native pilots.

A piece only changes from pending to active when its references and
permissions are coherent, it does not impose a domain, it preserves
its provenance and it has behavior checks. The new core's tests do
not automatically certify the still-archived commands, agents or
skills.

Core tests and status: [verification](verification.md).
General limits: [migration](migration.md).
