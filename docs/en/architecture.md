# Architecture

> English translation of the canonical Spanish document
> (`../architecture.md`). The Spanish version prevails.

Scopegrain is a private Node.js ESM package (Node >=22). The core is
synchronous, with no external dependencies, no `child_process`, no
sockets and no writes outside the explicitly indicated project. The MCP
server is optional and loads its dependencies
(`@modelcontextprotocol/sdk`, `zod`) lazily at startup. The viewer's
local HTTP API is opt-in: pure `node:http`, bound exclusively to
loopback and GET-only; `viewer/` is a separate package with its own
toolchain.

## Modules

```text
bin/scopegrain.mjs        Binary entry point; delegates to src/cli.mjs
bin/tasksystem.mjs        Compatible alias; delegates to src/cli.mjs
src/cli.mjs               Command parser (incl. lifecycle, investigate, host activate, capture proposals/review, view) and interactive flows; injectable IO
src/core/errors.mjs       Errors {code, message} (TaskError)
src/core/fsx.mjs          Synchronous filesystem helpers
src/core/paths.mjs        Safe relative paths, containment, anti-symlink
src/core/config.mjs       config.json contract, answers and collisions
src/core/context.mjs      Binds explicit project root + loaded config
src/core/workspaces.mjs   Per-project identity, areas, internal scope authorization and mutable owned descriptor
src/core/journal.mjs      Internal create/update journal with CAS under lock and bounded outbox
src/core/record-history.mjs Pure validators for update changes and create/update chain coherence
src/core/capture-data.mjs Pure capture note/ownership contracts
src/core/captures.mjs     Typed capture store with journal proof
src/core/capture-proposals.mjs Deterministic capture proposals from journal and init answers
src/core/record-ownership-data.mjs Pure sidecar primitives (capture/spec/design/report rev0)
src/core/record-ownership.mjs Shared proof of committed two-event creation
src/core/owned-specifications.mjs Typed store of V2 specs with proven ownership
src/core/owned-designs.mjs Typed store of V2 designs with ownership and spec binding
src/core/owned-outcomes.mjs Typed store of V2 outcomes/reports with proven ownership
src/integrations/vantadb.mjs  Internal MCP projection of confirmed events
src/core/policy.mjs       Loads the installed runtime's canonical policies
src/core/tasks.mjs        Task documents, createTask, getTask, listTasks
src/core/catalog.mjs      Validated active catalog and resource projection
src/core/resource-recovery.mjs Search, diagnosis and hash-based restoration
src/core/workflows.mjs    Procedure/context packages, no LLM execution
src/core/plans.mjs        DAG plans, readiness from current tasks and mutable owned store
src/core/artifacts.mjs    Immutable operational artifacts by UUID
src/core/specification-data.mjs Specification/design shape and types
src/core/outcome-data.mjs  Linked outcome report shape
src/core/specifications.mjs Structured specifications and linked design
src/core/approvals.mjs    Content-bound approvals, CAS question/answer and mutable owned store
src/core/digests.mjs      Canonical JSON and static projections
src/core/methodology-data.mjs Pure classification and scenario references
src/core/formal-bindings.mjs Independent reads and relationship digests
src/core/outcomes.mjs     Report preparation bound to the current REVIEW
src/core/methodology.mjs  ACT/ACCEPT gates and shared effective actions
src/core/sessions.mjs     Registered operations, CAS, budget, resume and mutable owned store
src/core/versioning.mjs   Own ignore and external proposals by category
src/core/evidence.mjs     Verification/review validation (attestations)
src/core/transition.mjs   CAS transitions with per-task lock, checkAction and mutable owned store
src/core/bootstrap.mjs    Init plan, preflight, apply with rollback
src/core/doctor.mjs       Read-only health check
src/core/docs-cli-drift.mjs docs<->CLI drift: documented verbs vs the real surface
src/core/lifecycle.mjs    adopt/update/backup/restore/uninstall: create-only previews and applies
src/discovery/inspect.mjs Bounded manifest scan
src/discovery/semantic.mjs Bounded read-only semantic investigation
src/hosts/render.mjs      Per-host integration fragments
src/hosts/native.mjs      Versioned native proposals for seven hosts (generic = scaffold)
src/hosts/activation.mjs  Opt-in create-only activation of project-local proposals
src/hosts/host-manifest.mjs Per-host manifest: sha256 + ownership (whole/partial/shared)
src/core/managed-section.mjs SCOPEGRAIN:BEGIN/END sections in AGENTS.md/CLAUDE.md
src/core/host-cli.mjs     Host CLI detection by filesystem (no child_process)
src/core/mcp-inventory.mjs Self-describing MCP inventory derived from descriptors
src/core/operations.mjs   Shared operation descriptors (CLI/MCP parity)
src/core/active.mjs       Active-task pointer: SCOPEGRAIN_TASK env over state
src/core/activity.mjs     Retroactive activity registration: worklog, never unclosable tasks
src/core/worklog.mjs      Bounded JSONL logs (lessons/outcomes/progress/goals/activity) with rotation
src/core/converge.mjs     Typed findings spec/plan/tasks vs code + verdict
src/core/checklists.mjs   Reviewer-owned CHK### checklists with CAS
src/core/analyze.mjs      Cross-artifact coverage and drift analysis
src/core/clarify.mjs      Dated create-only clarification sessions
src/core/constitution.mjs Constitution semver + bump rules + history
src/core/story-tasks.mjs  tasks.md render per user-story (T###, [P], USn phases)
src/core/placeholders.mjs {SCRIPT}/$ARGUMENTS/handoff tokens fail-closed in commands
src/core/hooks-policy.mjs Declarative policy/hooks.json loading (before_/after_)
src/core/jsonc.mjs        JSONC comment stripping + recursive deep merge
src/core/distribution.mjs file:// catalog stack, composition, bundles, extensions, presets, mounted layer
src/core/workflow-runner.mjs Declarative runner: whitelisted ops, atomic checkpoints, resume
src/core/identifiers.mjs  Unified id validator (slugs + Windows reserved names)
src/core/locks.mjs        Token-verified locks (acquire/release with {dev,ino})
src/core/helpers.mjs      Helper script install: JSON-stdio, bounded copy, tamper check
src/adapters/             Compatible entries towards src/hosts
src/mcp/server.mjs        Stdio MCP server: reads + bounded journaled mutations
src/api/server.mjs        Read-only local JSON API: single loopback, GET only
src/api/queries.mjs       Query facade with hard caps for the local API
viewer/                   Read-only local viewer (Vite/React/TS/Tailwind/shadcn), separate package
assets/                   Project SVG graphic resources
```

## Data flow

```text
CLI (--project) -> resolveProjectRoot -> inspectProject -> answers
  -> createConfig -> buildInitPlan -> preflightPlan -> applyPlan
CLI task/doctor/mcp -> resolveContext -> loadConfig -> operations
```

- Every project path comes from `--project` or from the loaded
  configuration; nothing is derived by ascending from the installation.
- Without `--config`, selection recognizes `.scopegrain/config.json` and
  the legacy `.tasksystem/config.json` config; two entries produce
  `CONFIG_AMBIGUOUS`. An explicit selection does not fall back.
- A descriptor at `paths.state/workspace.json` identifies a single
  `projectRoot`, project, logical repository and areas. It is created
  only through explicit enrollment, independent of bootstrap and V1
  config. An internal binding keeps per-area grants and requires all
  IDs of a scope; it revalidates the root and the digest before
  authorizing or resolving the repository.
  Missing metadata produces `WORKSPACE_NOT_FOUND`; if it disappears or
  changes on revalidation, that binding is permanently invalidated with
  `WORKSPACE_STALE`; a new explicit binding is required.
- Areas are logical scopes, not operating-system ACLs or a sandbox.
  The workspace layer does not connect VantaDB nor implement
  synchronization or MCP authorization; it does not authenticate
  identities nor isolate actors with access to the same filesystem.
- The internal journal stores snapshots, intent and outbox before
  mutating sources; only a complete application allows the committed
  marker, both in creates (exclusive `wx`) and in CAS updates (two
  phases: temps fsynced next to the destination, `previousHash`
  re-check and rename). An uncertain result keeps the reservation
  active and blocks new writes until a future explicit
  reconciliation. A failure to clean the reservation after the marker
  also blocks writes, without repeating the operation. Outbox
  pagination is not a synchronization boundary.
- The internal seam `applyJournaledRecordCreation` is for trusted typed
  adapters: the kernel generates operationId/createdAt once, hands a
  frozen copy to the synchronous callback and validates the result like
  any other change. All proposed sources must be new creations; a noop
  is a conflict, never adoption. It is not a JSON API, CLI or activated
  capture.
- The mutable seam `applyJournaledRecordUpdate` is the strict twin:
  each change declares `previousHash` and the expected
  `sourceRevision`; the byte CAS is checked before the lock, under the
  lock before reserving sequences and once more after temp staging.
  Pre-images remain as content-addressed audit snapshots with no
  automatic restore; there are no mixed create/update operations.
  `record-history.mjs` provides the pure chain validators
  (`validateUpdateChange`, `resultingSourceRevision`,
  `validateRecordTransition`); the journal does not index per record
  and coherence is a read-model check.
- `createCaptureStore(ctx, options)` binds an authentic binding and a
  private copy of config; it only creates the capture form under
  `paths.memory` and the ownership one under `paths.state`, both in a
  single strict two-event journal operation. `get` requires canonical
  sidecar, authorized scope, a committed operation of exactly two
  events, snapshots matching the current bytes and current source equal
  to the snapshot; it does not adopt plausible files nor return history
  as current. A note is a contributed assertion, not authenticated
  identity, active truth or authorization. No listings, generic writer
  or automatic capture; the `capture create|show` CLI only applies this
  contract.
- The creation ownership proof is shared across typed stores:
  `record-ownership.mjs` requires canonical sidecar, authorized scope,
  a committed operation of exactly two create events, snapshots equal
  to the current bytes and current source equal to the snapshot;
  `record-ownership-data.mjs` closes the sidecar shape for `capture`,
  `spec`, `design` and `report`, all revision0. The static JSON Schema
  `schemas/record-ownership.schema.json` remains exclusive to capture:
  it does not validate spec, design or report sidecars.
- `createOwnedSpecificationStore(ctx, { areaIds })`,
  `createOwnedDesignStore(ctx, { areaIds })` and
  `createOwnedOutcomeStore(ctx, { areaIds })` are opt-in frozen stores
  with exactly `prepare`, `create` and `get`. Their closed inputs are
  `{ areaIds, specification }`, `{ areaIds, design }` and
  `{ areaIds, outcome }`. They copy config/grants and clone the nested
  DTO to flat JSON; they authorize the explicit all-of areas before
  preparing. The logical grant areas live in the sidecar/events, they
  are not derived from the paths declared in `spec.data.scope`.
- Each store uses its typed preparer inside the strict seam:
  `prepareSpecification`, `prepareDesign` or `prepareOutcomeEvidence`.
  Sources go to `<paths.plans>/specs/<uuid>.json`,
  `<paths.plans>/designs/<uuid>.json` or `<paths.reports>/<uuid>.json`;
  sidecars to `<paths.state>/record-ownership/<sourceKind>/<uuid>.json`.
  Two create/revision0 events, exact byte hash and complete receipts
  are preserved, even uncertain ones. `prepare` does not write nor
  reserve IDs: the preview ID is not reused when creating. `get`
  validates the proven snapshot bytes, it does not re-read the source
  through the legacy getter.
- The design requires a structured V2 spec whose digest matches, even
  if the parent has no ownership. `validateArtifactBindings` keeps that
  check both at preparation and in the owned getter, without re-reading
  the design via `getArtifact`. An outcome is prepared from the real
  formal task in REVIEW, its verification and healthy bindings; its
  digests are derived, never supplied by the caller. The report's owned
  getter proves present bytes and provenance, without re-reading the
  task or re-evaluating its current bindings. The methodology gates
  keep judging validity and eligibility for ACCEPT.
- Five opt-in mutable owned stores reuse both seams:
  `createOwnedTaskStore` (transition.mjs), `createOwnedApprovalStore`
  (approvals.mjs), `createOwnedSessionStore` (sessions.mjs),
  `createOwnedPlanStore` (plans.mjs) and `createOwnedWorkspaceStore`
  (workspaces.mjs). Each defines its mutable sidecar: task and
  approval carry a dense `chain` under `record-ownership/`; session
  and plan use per-domain chain heads; the workspace uses a pointer
  with lazy journal enrollment. `get` is fail-closed and re-proves
  the committed chain back to the create; there is no adoption,
  listings or `prepareAnswer`; domain gates run inside the kernel
  callback. They are core factories: nothing is wired to CLI or MCP.
  Full contract in the
  [ownership guide](record-ownership.md#mutable-ownership-with-journal-history).
- The `specification create|show --owned` CLI adapts the store without
  changing the default legacy mode or its help note. `design create`
  and `outcome create` accept optional `--owned`; the new `design show`
  and `outcome show` require it and fail with `INVALID_ARGS` before
  accessing the context if it is missing. `artifact show design UUID`
  and `artifact show report UUID` keep the structural read without
  asserting ownership. The local CLI uses grants for all enrolled
  areas, but each input still asks for its explicit all-of areas. No
  wrapper auto-detection, implicit enrollment/adoption, automatic
  producers or hooks; native activation only exists as an explicit
  command (`host activate`) and VantaDB's only through the explicit
  `vantadb setup` enrollment.
  Result, error and boundary contract in the
  [ownership guide](record-ownership.md#cli).
- A local ack is an adapter declaration, not proof of remote execution.
  Before exposing the journal to untrusted tools, typed adapters and
  record ownership are needed. The lock is cooperative; it does not
  guarantee OS transactions or detect all manipulation of head or
  history without a separate full audit.
- Explicit recovery validates the operation and its scopes under the
  lock, keeps an immutable receipt and never adopts or modifies the
  sources. Only an existing marker allows finishing as committed;
  abandonment keeps an unconfirmed result. With no active reservation
  the listing does not detect missing historic indexes; an empty page
  does not prove synchronization.
- The VantaDB projection is an internal, injected bridge with no native
  process: it sends only confirmed historic events and snapshots
  verified by `memory_get`/`memory_put`, with immutable keys and
  readback. It allows reconciliation on explicit retry, without
  promising CAS or a single physical write. The local ack declares what
  the adapter verified, it does not authenticate the backend. Delivering
  current state requires ownership and later hash checks; there is no
  activation of writers, automatic capture, gateway or engine. A
  cooperative lease bounds the worker without holding the journal lock
  during remote calls; the timeout is a client contract, not a guarantee
  for arbitrary callbacks. The concrete client lives in
  `src/integrations/vantadb-runtime.mjs`: it downloads the sha256-verified
  official binary only inside `vantadb setup --apply`, spawns
  `vantadb-server --mcp` per operation with `VANTADB_STORAGE_PATH` over a
  machine-shared instance, and closes the process when done. See
  [vantadb.md](vantadb.md).
- `policy/workflow.json` defines states, edges, actions and base
  acceptance. `policy/methodology.json` defines the methodology
  contract. The gates add controls; they do not create another state
  machine.
- Templates in `templates/` are rendered with placeholder substitution;
  after rendering, no `{{` may remain.
- Discovered commands are proposals (`approved:false`), never executed
  by the harness.
- `resources/manifest.json` indexes the canonical sources and their
  aliases. The generated catalog fixes the project snapshot and hashes;
  packages do not silently substitute their bytes for another
  installation's.
- Procedures are interpreted by the host. Scopegrain does not create
  LLM clients or execute subagents because a role definition exists.
- The onboarding policy proposes all artifacts inside `.scopegrain/`;
  the eight versioning preferences do not authorize modifying the
  project's Git or publishing private data.

## Relevant decisions

- **Real containment:** lexical containment plus symlink/junction
  rejection at every existing ancestor; the chosen root must exist and
  be a real directory. `project.root` is fixed to `"."` to keep the
  config relocatable; the real root is always passed at runtime.
- **Writes:** only after full preflight, with exclusive `wx` flag. An
  identical destination is a no-op; a different one, a link or a
  directory blocks the whole plan before writing anything. Rollback
  removes only the files created by that operation; it does not delete
  directories.
- **Re-init:** if the config exists and matches the answers, and the
  discovery fingerprint has not changed, the complete config object and
  the original bytes of `config.json` and `discovery.json` are
  preserved (format, order, approved verification commands, original
  evidence); re-running is a no-op when the other generated contents
  also match. An old OpenCode V1/V2 snapshot can produce
  `PLAN_CONFLICT` with the V2 generator, without modifying the previous
  files. If `discovery.json` was deleted, it is re-proposed as a new
  file with the current serialization. If the fingerprint changed, the
  contents differ and preflight blocks with an explicit conflict
  (manual reconciliation).
- **Tasks:** per-file lock `<id>.json.lock` opened with `wx`; an
  existing lock is a conflict and is never recovered automatically.
  Atomic write via exclusive temp + rename; `finally` only cleans the
  own lock and temp.
- **Evidence:** verification and review are declared attestations;
  `ACT` invalidates them and a new verification invalidates the
  previous review.
- **Methodology:** the pure classifier does not import storage or
  gates. Getters validate the shape of historic records; gates resolve
  their current references without turning someone else's loss into a
  TypeError. Outcome preparation uses the real REVIEW, not
  caller-supplied hashes.
- **Local consistency:** the transition revalidates its candidate under
  lock and checks methodology before temp/rename. `checkAction` and
  packages use the same action evaluation, avoiding a parallel `edit`
  without a gate. This is not a serializable transaction across all
  files.
- **Bound configuration:** the context keeps the configuration loaded
  when resolving it or starting MCP; changes require a new resolution
  or restart. Policy copies in the project are references, not
  overrides of the installed runtime's policies.
- **Lifecycle:** adopt/update/backup/restore/uninstall re-run their
  preview inside the apply before mutating (create-only: nothing
  existing is overwritten or merged); uninstall deletes only files
  still byte-identical to the preview.
- **Discovery:** depth <=4, <=1000 entries, manifests <=128 KiB from an
  allowlist; no link following; specific folders excluded (`.git`,
  `node_modules`, `vendor`, `.venv`, `venv`, `target`, `dist`, `build`,
  `coverage`, `legacy`, `.tasksystem`, `.scopegrain`, and every
  dot-prefixed name except `.github`).
- **Fingerprint:** sha256 over the sorted array of
  `JSON.stringify([path, size, content])` per admitted manifest, plus
  `JSON.stringify([path, 'lockfile'])` per recognized lockfile
  (presence only; its content is never read). It does not include date
  or absolute path; manifests skipped for size contribute `null` as
  content but keep path and size. Adding or removing a lockfile changes
  the fingerprint, because it changes the command proposals.

## Published schemas

`schemas/` is the machine-readable contract surface: each JSON Schema
(draft 2020-12) describes one closed shape the runtime produces, persists
or accepts. They are descriptive contracts, not validators: effective
validation always happens in the runtime validators, the code is
authoritative, and a schema that drifts is fixed to describe reality —
never the reverse. Limits JSON Schema cannot express (chronology,
cross-field coherence, CAS) are noted in each schema's `description`.

| Schema | Contract |
|---|---|
| `answers.schema.json` | Interactive init answers; byte-fingerprinted by init sessions |
| `capture.schema.json` | Selective capture note |
| `record-ownership.schema.json` | Ownership sidecar (capture only) |
| `specification-data.schema.json` | `data` of a structured V2 spec |
| `design-data.schema.json` | `data` of a V2 design bound to a spec |
| `outcome-data.schema.json` | `data` of a V2 report (outcome) |
| `workspace.schema.json` | Workspace identity descriptor (`paths.state/workspace.json`) |
| `journal-intent.schema.json` | Journal intent (homogeneous create/update events) |
| `journal-commit.schema.json` | Operation commit marker |
| `journal-recovery.schema.json` | Recovery receipt (`finalize-committed`/`abandon-prepared`) |
| `approval.schema.json` | Content-bound approval record with history |
| `organic-assessment.schema.json` | Methodology assessment persisted in V2 tasks |

Conformance is a real gate: `tests/schemas.test.mjs` persists or derives
records through the real APIs (workspace, create/update intents, commit,
both recovery receipts, pending/answered/revoked approvals and normalized
assessments) and requires each one to satisfy its schema with a bounded
draft-2020-12 subset checker — no ajv dependency. A shape change that
breaks the contract fails the test; a schema edited with keywords outside
the subset fails loudly.

## Structural limits

- Stack detection is based on manifests, not on `src/`; a stack without
  a recognized manifest remains unknown.
- `src/discovery/semantic.mjs` adds a bounded read-only semantic layer
  (fixed probes, manifest allowlist, signals with evidence and
  confidence, investigation records); still, the scan does not
  understand the project: real investigation remains the agent's job,
  required by the generated instructions.
- MCP proposals are machine-local fragments; they are not merged with
  the host's active configuration nor registered automatically.
  `src/hosts/activation.mjs` applies opt-in only full-file proposals
  with a destination inside the project (create-only, same bootstrap
  rules); merges into shared config and global (`~/`) paths are
  always manual. Activation consumes the workspace catalog: mounted
  resources (`<configDir>/bundles/<id>/`, sha256-verified on every
  load via `mounted-catalog.json`) materialize as native bridges
  through the same pipeline as snapshot resources — the mounted
  layer is an overlay, never altering the projected manifest nor
  triggering `upgradeAvailable` in `doctor`.
- Distribution mutations (extension/preset registries,
  `mounted-catalog.json`, bundle install/uninstall) leave a trail in
  `<configDir>/dist-journal.jsonl` under `dist.lock`: each entry carries
  chained `previousSha256`/`newSha256` (byte-level CAS) and a monotonic
  `revision`. When the project has an enrolled workspace, the registry
  write is also routed through the shared journal kernel
  (`journaled: true`, events to the outbox); without enrollment the
  write stays local and the dist journal is the only trail
  (`journaled: false`).
- The local API (`src/api/`) is a read-only convenience with no auth
  beyond the loopback bind: it is not a production host and the port
  must not be exposed.
- The native projection uses permission formats documented per host,
  without installing them. Its scopes are not equivalent and do not
  constitute universal harness isolation; no executable hooks are
  generated.
- State is controlled only for operations that go through Scopegrain;
  native tools are not intercepted.
- Containment checks reject links at validation points, but do not
  constitute operating-system isolation against hostile concurrent
  substitution of filesystem ancestors.
- Digests bind records/payloads, not the worktree or the bytes of a
  cited file. Identities, risk and results are declarations.
  See [Organic and SDD](methodology.md) for the contracts and limits.
- Journaled updates declare `previousHash` and `sourceRevision` as
  CAS provenance: the kernel rechecks bytes under lock but does not
  verify the revision against previous operations (there is no
  per-record index). Writers outside the journal can interleave and
  the owned proof fails closed on drift, without preventing or
  reverting it.
- Remote catalogs: permanent non-goal. All distribution machinery
  (`distribution.mjs`: stack, bundles, extensions, presets, mounted
  layer) operates on `file://` URIs only; http(s) URIs validate their
  shape but `loadCatalogStack`/`installBundle` refuse them with
  `REMOTE_CATALOG_UNSUPPORTED`. There is no download layer, no trust
  anchors and no inert "future remote" metadata: the decision closes
  the boundary rather than deferring it. A remote resource is brought
  in by downloading it manually and referencing it via `file://`
  with its pinned sha256.
- Declared TOCTOU limits: `lstat`/`readFileLimited` checks and
  `temp+rename` writes are separated by a window in which a
  concurrent process with directory access can substitute the
  destination. The design shrinks the window (apply-time re-preflight,
  exclusive `wx` create) but does not eliminate it: the guarantee is
  detection (conflict/drift), not mutual exclusion with actors outside
  the lock. On Windows, path identity comparison follows the
  filesystem's case-insensitive semantics.
- Verified catalog reuse: `loadWorkspaceCatalog` re-runs the full
  sha256 pass only when a fingerprint changes (manifest and
  mounted-catalog hashes plus size+mtimeMs tuples for every covered
  entry). A size- and mtime-preserving edit escapes only eager
  detection; `getResource` re-hashes served bytes, so delivery still
  fails closed. Same limit family as the TOCTOU window, made
  explicit.
- Artifact persistence model: flow-forward. Formal artifacts (specs,
  designs, outcomes, checklists, clarifications, convergence records)
  are immutable once created: a new iteration produces a new chained
  record (or a new create-only file), never an in-place rewrite of
  history. Deliberately mutable state stays confined to explicit
  pointers (`active-task`, journal `head`) and derived indexes,
  always under CAS.
