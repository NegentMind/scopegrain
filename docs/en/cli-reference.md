# CLI surface reference

> English translation of the canonical Spanish document
> (`../cli-reference.md`). The Spanish version prevails.

Reference for the `scopegrain` binary verbs that `doctor`'s
`docs-cli-drift` check reported as
undocumented. The full command table comes from `scopegrain --help`;
this document covers lifecycle, owned records, catalog resource
recovery and the catalog aliases resolved at dispatch.

Common conventions (source: `src/cli.mjs`):

- All output is JSON on stdout; errors are JSON on stderr. The exit
  code is 2 for `INVALID_ARGS` (usage errors: unknown flag, extra
  positional, malformed value), 1 for any other failure and 0 on
  success. Verbs with their own contract reserve semantic codes on
  the success path (`task gate`: 2 deny, 3 require-gate;
  `verify run --fail-on-error` propagates the child code) — a
  usage-error 2 stays fail-closed for those consumers.
- Mutating verbs show a read-only preview (`mode: 'dry-run'`) unless
  `--apply` is passed; `--apply` is create-only and never overwrites,
  merges or reinitializes.
  Documented exception: the `dist` local-registry verbs
  (`extension-register`, `extension-activate`, `extension-deactivate`,
  `bundle-mount`, `bundle-unmount`, `preset-register`) mutate the
  registry immediately — bounded non-destructive appends/flips
  (duplicates conflict with `CONFLICT`), not file-tree mutations.
- `--yes` and `--force` do not exist: confirmation is always explicit.
- `--project PATH` autodetects: without the flag the CLI walks up from
  the cwd to the first `.scopegrain/config.json` (bounded at 10 levels
  or the filesystem root). An explicit flag always wins, and with no
  marker at all the error is the historical `INVALID_ARGS`. `init` is
  the exception: it names the directory to initialize, is never
  inferred, and requires the flag. `--config REL` selects an
  alternate config.
- GNU flag syntax: `--flag=value` is equivalent to `--flag value`
  (a boolean flag given `=value` is `INVALID_ARGS`), and `--` ends
  flag parsing — what follows counts as positionals.
- `<verb> --help` (or `-h`) prints that command's entry (usage,
  flags, description); an unknown command with `--help` falls back to
  the global table.
- An `--input` resolving outside `--project` emits an
  `INPUT_OUTSIDE_PROJECT` warning on stderr — advisory
  defense-in-depth, never a block.
- Integer flags (`--limit`, `--tail`, `--timeout`, `--top-k`,
  `--cursor`, `--revision`, `--index`, `--since-sequence`,
  `--token-limit`, `--port`, `--structure-debounce`) require a
  non-negative decimal; anything else is `INVALID_ARGS`, never `NaN`.
- `context` and `workflow` accept `--fields CSV` (top-level key
  projection of the resulting packet) and `--compact` (single-line
  JSON); every other verb rejects them with `INVALID_ARGS`.
- Interactive prompts (`init` without `--answers`/`--defaults`) go to
  stderr: stdout never carries anything but the result JSON.

Error-code families (orientation list — the envelope is always
`{error:{code,message,retryable}}`; the canonical command table and
usages come from `scopegrain --help`):

| Family | Meaning |
|---|---|
| `INVALID_*`, `MALFORMED`, `UNKNOWN_KEY` | Rejected input, flag or document shape |
| `NOT_FOUND`, `*_NOT_FOUND`, `INPUT_NOT_FOUND` | Missing resource, record or file |
| `CONFLICT`, `*_CONFLICT`, `INIT_CONFLICT`, `CAS_MISMATCH`, `REVISION_MISMATCH`, `STATE_CONFLICT` | State/version collision; `*MISMATCH`, `STATE_CONFLICT`, `WRITE_FAILED` and `JOURNAL_BUSY` carry `retryable: true` |
| `READ_FAILED`, `WRITE_FAILED`, `INVALID_PATH`, `DOCUMENT_TOO_LARGE`, `INPUT_TOO_LARGE` | Disk access or size problems |
| `WORKSPACE_*`, `JOURNAL_*` | Workspace enrollment and journal kernel |
| `SESSION_*` | Bounded sessions (budget, revision, schema) |
| `APPROVAL_*` | Approval records (CAS, state, schema) |
| `CATALOG_*`, `BUNDLE_*`, `HASH_MISMATCH`, `REMOTE_CATALOG_UNSUPPORTED` | Catalog, bundles and the `dist` mounted layer |
| `VERIFY_*` | Verification commands (approval, cwd, executable, timeout) |
| `VANTADB_*`, `BRAIN_*` | VantaDB backend and brain channel |
| `METHODOLOGY_REQUIRED`, `INTERACTIVE_REQUIRED`, `HOST_*` | Methodology, interaction and host gates |
| `INTERNAL` | Any unclassified failure — reportable as a defect |

## Lifecycle

Internal detail of each `prepare`/`apply`: `../lifecycle.md`
(`src/core/lifecycle.mjs`).

### adopt

`adopt --project PATH [--config REL] [--apply]`

Detects an already-initialized project and reports what adopting it
would bind: resolved config, existing workspace enrollment, journal
state and `issues`; the report ends in
`status: 'adoptable' | 'attention'`. With `--apply` it performs **only**
workspace enrollment when the report is `adoptable`, the workspace is
missing and the config resolved; it never reinitializes or overwrites.

### backup

`backup --project PATH --to REL [--config REL] [--apply]`

Exports the config, the adjacent `discovery.json` and every regular
file under the declared `config.paths` into `<dest>/manifest.json` +
`<dest>/files/<rel>`. `--to` must be a project-relative path that does
not overlap any source. On `--apply` every source is re-read and
re-hashed; anything that changed since the preview is skipped
(`skipped`) instead of being exported under a stale hash.

### restore

`restore --project PATH --from REL [--apply]`

Restores a bundle created by `backup`: validates `manifest.json`,
verifies each payload's sha256 and classifies every entry as
`create`/`skip`/`conflict`. `--apply` creates only absent targets;
identical ones are skipped and diverged ones are reported as
conflicts, never merged. It does not require `--config`: it operates
on the project root.

### uninstall

`uninstall --project PATH [--config REL] [--apply]`

Enumerates and deletes **only** files provably owned by the harness:
the config, byte-identical generated files (or ones pinned by the
catalog snapshot) and files under `paths.state`. On `--apply` each
candidate is hash re-verified before deletion; anything diverged or
changed is reported in `leftBehind`, never deleted. Emptied harness
directories are removed bottom-up; the project root is never touched.

## Owned records

### approval show

`approval show --project PATH DIGEST`

Returns the stored approval record whose id is the sha256 digest
`DIGEST`. Read-only: validates the shape, rejects symlinks and requires
the content id to match the filename.

### approval answer

`approval answer --project PATH --input FILE [--apply]`

Answers an existing approval. The JSON input is a closed object
`{id, answer, expectedRevision, expectedTargetDigest, actor, comment?}`
with `answer` in `approve|reject|decline|custom|revoke`. The dry-run
returns the prospective record (`previousRevision`, `next`); `--apply`
revalidates the CAS (revision and target digest) under a lock before
rewriting the file. `revoke` is only valid from `approved`, and
answers on a non-`pending` record (or `custom`) require a non-empty
`comment`.

### session show

`session show UUID` (with optional `--project PATH` and `--config REL`)

Returns the stored bounded session record with id `UUID`. Read-only:
validates the file shape and that the internal id matches.

### session create / session record

`session create --task UUID --limit N [--token-limit N] [--apply]`
`session record UUID --revision N --input FILE [--apply]`

`create` opens a bounded session (`schemaVersion` 2; stored v1 documents
stay readable and are promoted on record). The optional
`--token-limit N` flag declares a self-reported token budget (integer
>= 1; `null` when omitted). `record` appends an event
`{action, evidence, context?, tokens?}` where `tokens` is a closed
`{prompt, completion, total}` object of integers >= 0 with
`total === prompt + completion`. Tokens are caller-declared, never
observed: `tokenUsage.measures` is `self-reported-unverified`. The event
that reaches the budget is accepted (the declared consumption already
happened); an event that would push the stored sum above it, and any
record after the budget is reached, fail with
`SESSION_TOKEN_BUDGET_EXHAUSTED` — a stored document never exceeds its
own `tokenLimit`. `resume` and the `record` dry-run expose
`usage.tokenUsage` / `tokenUsage` with `reported`, `limit`, `remaining`,
`percent` (`null` without a budget) and `measures`.

## Catalog resource recovery

All four subcommands read the workspace snapshot and never download or
use external fallbacks: the byte source is always this installation at
the snapshot-pinned SHA (`src/core/resource-recovery.mjs`).

### resource search

`resource search [KIND] --project PATH [--query Q]`

Lists workspace-catalog entries filtered by `KIND`
(`command|agent|skill|rule|reference|profile|prompt|mcp`) and by a
substring query over id/description. Metadata only: it works even when
a resource body is missing on disk.

### resource diagnose

`resource diagnose KIND ID --project PATH`

Read-only health report for one installed resource:
`missing`, `invalid-form`, `legacy-unpinned`, `unreadable`,
`oversized`, `drift` (with `actualSha256`) or `healthy`, comparing the
content against the snapshot-pinned sha256. Non-healthy statuses
include `hint` (recommended action) and `suggestions`: a deterministic
ranking of up to 5 probable resources scored over catalog metadata
(id tokens, description, same kind, mode, bindings) with per-candidate
`reasons` declared. An unknown id still throws `CATALOG_UNKNOWN_ID`,
now naming the near matches in the message.

### resource restore-plan

`resource restore-plan --project PATH --input FILE`

Dry-run only: computes the restore plan for the input
`{kind, id, expectedCurrentHash}`. It yields `action: 'create'` only
when the target is absent and this installation's copy hashes to the
pinned SHA; `expectedCurrentHash` acts as a CAS over an existing
target and any divergence is `RESOURCE_RESTORE_CONFLICT`.

### resource restore

`resource restore --project PATH --input FILE [--apply]`

Same plan as `restore-plan`; without `--apply` it returns
`mode: 'dry-run'` and with `--apply` it creates the file only when the
revalidated plan is `create` (`action: 'noop'` when the target already
matches the pin).

## Catalog aliases

Aliases are single-token verbs resolved at dispatch against the
catalog (`command/*` entries and `aliases` in
`resources/manifest.json`, mirrored in the workspace snapshot). Each
alias dispatches through the same path as `workflow COMMAND`: it
builds a read-only packet (canonical command + resolved resources +
profile) for a host to interpret; the harness never executes the
content. Common flags for every alias:
`--project PATH [--config REL] [--mode M] [--task UUID] [--host H] [--profile ID] [--interaction direct|guided] [--arguments TEXT] [--script PATH] [--lazy]`.

`--arguments`/`--script` feed the command's placeholder substitution
(`{ARGUMENTS}`/`{SCRIPT}`): when the body declares a token and no value
is supplied, resolution fails closed (`UNRESOLVED_PLACEHOLDER`) instead
of silently stripping it.

With `--lazy` the packet does not inline resource bodies: every
`resources`/`contributedResources` entry carries `{kind,id,description,
path,sha256}` (no `content`, no composed preset layers — hits are
declared under `presets.deferred`) and the packet exposes `hydrate` with
the hydration channels (`catalog show KIND ID` /
`scopegrain_catalog_get`). The command and profile bodies stay full.

`packet.posture` declares `{current: 'lazy'|'full', recommended: 'lazy'}`
— lazy is the recommended posture for hosts that can hydrate via
`catalog_get`. When the command's rendered body equals `content` (no
placeholders), the packet emits `command.sameAsContent:true` instead of
a second copy; `command.rendered` only appears when it differs
(consumers: `command.rendered ?? command.content`).

With `--task`, skills declared on `task.skills` auto-include into
`resources.skills` (task-typed routing, declared on
`packet.taskRouting`: `included` resolved ids, `skipped` ids not in the
catalog). Command-declared dependencies still fail closed; unresolvable
task ids are reported, never fatal. `taskRouting.suggested` additionally
declares the heuristic's candidates derived from task metadata (see
`task suggest`) — a pure trace, never entering the bucket by itself.

`packet.deep` declares the opt-in mounted-bundle layer:
`{available, mounted, bundles[], path:'bundles/'}` — entries carrying
`bundle` are deep resources whose bodies live under
`<configDir>/bundles/<bundle>/` and hydrate through the same channels.

| Alias | Canonical command | Modes |
|---|---|---|
| `backlog` | `triage-work` | `default` (default) |
| `ship` | `assess-release` | `default` (default) |
| `rollback` | `plan-recovery` | `default` (default) |
| `harness` | `audit-harness` | `default` (default) |
| `code-simplify` | `simplify-code` | `default` (default) |
| `codeGraph` | `analyze-structure` | `default` (default) |
| `cleanCA` | `review-change` | `default` (default), with parameter `focus: architecture` |
| `webperf` | `audit-web-performance` | `quick` (default), `deep` |
| `pipeline` | `plan-work` / `implement-task` / `coordinate-plan` / `report-status` | `plan` (default), `task`, `run`, `interactive` (guided) |

Examples:

```text
scopegrain backlog --project .
scopegrain ship --project . --task <uuid>
scopegrain pipeline --project . --mode run
```

Other aliases declared in the catalog (`spec` -> `specify-change`,
`status` -> `report-status`, `audit` -> `verify-work`/`review-change`/
`audit-project` by mode, `research` -> `investigate`/
`compare-options`) follow exactly the same mechanism.

## Structural discovery

### investigate --diff

`investigate --project PATH [--config REL] [--save] [--diff]`

With `--diff`, the semantic investigation is compared against the
recorded discovery evidence (`discovery.json` and the configuration) and
reports: fingerprint match/mismatch, added/removed/retained manifests
and lockfiles, content changed under an unchanged path set, added or
dropped stacks and commands, new host signals, stale decisions and
explanatory notes. `doctor` embeds this diff in its fingerprint warning
when the evidence changed, and `update --diff` attaches it as
`discoveryDiff` in the result before re-projecting generated files.

### assess

`assess --input DIFF_FILE [--assessment FILE]`

Evidence-only risk classification over a unified diff. The core never
runs git: the operator produces the diff with their own tooling (e.g.
`git diff > out.patch`) and `assess` derives signals from paths, file
modes and added content. Deterministic JSON output: `risk`
(`passive|medium|high`), `reasons[]` with signal+path+detail,
`changed_paths`, `changed_lines` and `review_due` (`high_risk` |
`under_budget` | `passive`). Fail-closed: binary content, malformed
diffs or exceeded limits never lower the tier. With `--assessment` (a
methodology assessment JSON) it compares declared risk against the
derived tier and reports a `discrepancy` when the declaration under- or
over-states it. This is an input signal for the assessment — it neither
decides nor replaces it.

### structure scan / status / show

```
scopegrain structure scan --project PATH [--config REL] [--apply]
scopegrain structure status --project PATH [--config REL]
scopegrain structure show --project PATH [--config REL]
```

Bounded structural analysis of the project tree: file inventory,
LOC/bytes per language, imports, internal and external dependency edges,
fan-in/fan-out and heuristic complexity. It produces a deterministic
fingerprint used for change detection without rescanning.

- `scan` is a preview; `--apply` persists the index at
  `<paths.state>/cache/structure-index.json`. `init --apply` seeds it.
- `status` reports whether an index exists and whether the fingerprint
  is still fresh.
- `show` returns the persisted document (or `NOT_FOUND` when absent).
- `context` includes the freshness summary so the agent knows when to
  refresh before relying on the index.
- The packet also exposes `methodology` and `intake` (the project's
  `intake.mode`, `off` by default). The same packet is served over MCP
  by the read-only `scopegrain_context` tool.

It never reads secrets or binary contents, never executes project
commands, honors depth/entry budgets with warnings, and rejects
symlinks/junctions under the existing security boundaries.

## Automatic context rehydration (VantaDB)

When a VantaDB backend is enrolled, the projected project history is
injected automatically at both resume points — no manual CLI queries:

```
context --project PATH [--tail N] [--no-vantadb] [--no-structure] [--structure-debounce MS] [--timeout MS] [--fields CSV] [--compact] [--explain]
session resume UUID [--no-vantadb] [--timeout MS]
```

- `context` adds `vantadb`: a bounded `memory_search` (top_k 5, in the
  per-project namespace `l1/sg-<projectHash>`) over distilled L1
  memories, so the session-start packet carries verified, project-
  isolated episodic context.
- `session resume` adds `vantadb`: `memory_context` by `recordId` over
  the `sg-formal-v1-*` namespaces — every remotely projected journal
  event for that task.
- Both fail closed: without enrollment the field is
  `{ enrolled: false }`; a dead backend degrades to
  `{ enrolled: true, error: {...} }` without aborting the packet.
- `--no-vantadb` skips the backend spawn entirely; `--timeout MS`
  bounds the wait (15 s default).
- `--fields CSV` projects only the listed top-level keys
  (`--fields project,methodology` returns `{project, methodology}`) —
  meant for large packets where only a few sections are needed.
- `--compact` emits the JSON document on a single line (no indent),
  same as on `workflow`.
- `--explain` adds `explain`: per-section provenance (source,
  selection rule, `estimatedTokens`), the applied flags and, with
  `--fields`, the requested/matched/unknown projection report. Opt-in
  debug layer — `tokenEstimate` figures do not cover it (equivalent to
  the MCP `explain` argument).
- `--no-structure` serves the persisted structural index without
  rescanning the tree (equivalent to the MCP `noStructure` argument).
- `--structure-debounce MS` is opt-in: within the `MS` window the
  structural freshness answer comes from a bounded cache
  (`<paths.state>/cache/structure-status.json`) instead of rescanning;
  it is the only write `context` can produce — best-effort, derived,
  and invalidated by any `structure scan|refresh`.
- The MCP tool `scopegrain_session_resume` applies the same
  record-level rehydration. The MCP surface stays read-only.

## Operational memory, goals and metrics

Bounded append-only JSONL logs under `paths.memory`; field contract in
`resources/references/backlog-format.md` and task verbs in
`docs/en/task-workflow.md` (`task meta|disposition|note|step`,
`task list --backlog`).

### memory add / memory list

```text
memory add --project PATH --log lessons|outcomes|progress --input FILE
memory list --project PATH --log lessons|outcomes|progress|goals|activity [--tail N]
```

`add` validates the entry against the per-log closed schema (lessons
`{topic?,text,ref?,taskId?}`, outcomes `{taskId,outcome,skills[]}`,
progress `{taskId,title,result,...}`) and appends it; `list` returns the
latest `tail` entries (default 50, max 1000) plus malformed lines. The
`goals` and `activity` logs are read-only here: goals enter through
`goal *` and retroactive activity through `activity record`.

Logs larger than the configured document cap are read as a bounded tail
window, so an oversized log never breaks session start; the result marks
`truncated: true`. On append, an active segment that already exceeds the
cap rotates whole into `paths.memory/archive/` — immutable and never
deleted — so a single log file does not grow without bound. Rotation is
best-effort: a busy file defers it and the append still succeeds.

### goal create / goal list / goal show / goal transition

```text
goal create --project PATH --input FILE
goal list --project PATH
goal show --project PATH ID
goal transition --project PATH ID --to STATUS
```

Meta-level objectives: `{id,title,description?,status,horizon?,metrics?}`
records in `goals.jsonl`; latest entry per `id` wins. Tasks link via
`task.goalIds`. `create` requires `title` and generates the UUID;
`transition` re-appends the current entry with the new status.

Optional V2 fields (closed shape, each validated only when present):
`successMetrics` `[{name,operator:lt|lte|eq|gte|gt,target,current?,
source?}]`, `guardrails` (each element a non-empty string or the same
metric shape), `priority` `p0|p1|p2|p3`, `deadline` ISO
`YYYY-MM-DD[THH:mm]`, `modality` `milestone|continuous`, `parentGoalId`
UUID of an existing goal (hierarchy), `linkedPlanKeys` `[slug]`
(format-only — plan existence is verified where ctx is available),
`notes` string. `status` widens to
`open|proposed|active|at-risk|verifying|achieved|stalled|abandoned|dropped`
— legacy values stay valid with no migration. `transition` preserves all
V2 fields on re-append.

`goal show ID` derives the progress rollup (read-only, nothing
persists): tasks linked via `task.goalIds`, plans linked (the members'
`planKey` plus `linkedPlanKeys` — each reports its `derivedStatus` and
percent, or `{error}` when missing), a per-state `counts` histogram,
`percent` progress, evaluated `successMetrics` (`met: true|false|null`
— absent `current` or mixed types do not evaluate) and `health`
`on-track|at-risk|null` when a `deadline` exists (past and incomplete ->
`at-risk`; 100% or still open -> `on-track`).

### metrics

`metrics --project PATH`

Aggregates derived on read (nothing precomputed on write): counts by
state/backlog/type/priority/disposition, verification and first-try
rates, close-time p50/p95/p99 and per-skill ok/fail rates.

### report save / report list

```text
scopegrain report save --project PATH
scopegrain report list --project PATH [--tail N]
```

`save` runs the live doctor report and persists it create-only under
`paths.reports` as `<ISO>-status.json`; `list` enumerates saved reports
newest-first (default 50).

### activity record

```text
scopegrain activity record --project PATH --input FILE [--apply]
```

Retroactively registers work done outside the task lifecycle as
**bookkeeping evidence**, never as actionable work: writes an entry to
the `activity` log (`<state>/memory/activity.jsonl`), surfaced via
`context`, the API, MCP and the VantaDB runtime. A retroactive record
cannot honestly produce the evidence `ACCEPT`/`CLOSE` require, so the
default behavior **creates no tasks** — the workflow policy has no legal
transition for them.

Link resolution, in order: (1) explicit `taskId` links to that task;
(2) without `taskId`, the active-task pointer (`SCOPEGRAIN_TASK` or
`<state>/active-task`) links automatically — evidence lands on real
work; (3) with no pointer the entry lands `taskId: null` — "evidence
beats linkage": a corrupt pointer degrades to `linkWarning` without
losing the record. Opt-in `record: "task"` preserves the legacy
behavior (`type: ops` task in PLAN) for manual calls that do want an
actionable item.

Input: `{kind: action|commit|note, title, summary?, ref?, files?,
taskId?, author?, methodology?, record?}`. Only with `record: "task"`
and under gated methodology modes it synthesizes a **declared**
assessment (authorized by the actor - never a fabricated approval).

### hooks install / hooks uninstall

```text
scopegrain hooks install --project PATH [--apply]
scopegrain hooks uninstall --project PATH [--apply]
```

Installs/removes a managed block in `.git/hooks/post-commit` that calls
`activity record` after every commit (auto-registration of out-of-loop
commits). Idempotent, never rewrites user hook content and never breaks
a commit (always exits 0).

## SDD cycle (spec-kit extraction waves)

### task activate / task active / task deactivate

```text
scopegrain task activate --project PATH ID|SLUG
scopegrain task active --project PATH
scopegrain task deactivate --project PATH
```

Every task carries a monotonic `NNN-` slug derived from the title. The
active-task pointer resolves `SCOPEGRAIN_TASK` (env) before the
`<state>/active-task` file; a tampered pointer fails closed.

### task converge / task analyze / task checklist

```text
scopegrain task converge --project PATH ID|SLUG [--record]
scopegrain task analyze --project PATH ID|SLUG
scopegrain task checklist --project PATH [ID] (--input FILE [--apply] |
  ID --key CHK### --status S --revision N [--text NOTE])
```

`converge` compares the real state against spec/design/plan/tasks and
emits typed findings with a verdict; `--record` persists a create-only
convergence record. `analyze` produces the cross-artifact report with
severities and coverage. `checklist` manages reviewer-owned `CHK###`
artifacts (create-only, CAS, gated in converge). Checklist items still
`pending` or `fail` also block `REVIEW -> ACCEPT` directly
(`ACCEPT_CHECKLIST_OPEN`) — the gate is universal, independent of
methodology mode; `pass` and `na` never block.

### task suggest

```text
scopegrain task suggest --project PATH ID|SLUG [--limit N]
```

Suggestive task-type -> capability heuristic (`scopegrain_task_suggest`
in MCP): scores catalog skills against the record's `type`/`title`/
`contract`/`scope` and returns ranked candidates with declared `reasons`
(`type:bug~debug`, `title:…`, `scope:…`). Skills already declared on
`task.skills` are excluded and echoed under `declared`. Read-only: it
never writes `task.skills` or injects into packets — declaration stays
explicit via `task meta`/`create`.

### plan stories / specification clarify / constitution

```text
scopegrain plan stories --project PATH KEY
scopegrain specification clarify --project PATH --input FILE [--apply]
scopegrain constitution show|set --project PATH [--input FILE]
```

`stories` renders `tasks.md` per user-story (`T###`, `[P]`, phases).
`clarify` records dated, create-only clarification sessions on the spec.
`constitution` manages the versioned constitution (semver + complexity
tracking).

### helper install / helper list

```text
scopegrain helper install --project PATH --input FILE
scopegrain helper list --project PATH
```

Installs project-local helper scripts with a manifest (declarative
contract; the harness never executes them). `list` enumerates and
verifies integrity.

## Distribution (dist)

Declarative distribution machinery: `file://` catalogs only — a remote
URI is `REMOTE_CATALOG_UNSUPPORTED`, never a download.

```text
scopegrain dist run --project PATH --input FILE [--no-resume]
scopegrain dist stack --project PATH --input FILE
scopegrain dist compose --project PATH --input FILE
scopegrain dist validate --project PATH --input FILE
scopegrain dist bundle-validate --project PATH --input FILE
scopegrain dist bundle-install --project PATH --input FILE [--apply]
scopegrain dist bundle-mount --project PATH ID
scopegrain dist bundle-unmount --project PATH ID
scopegrain dist bundle-uninstall --project PATH ID [--keep-files] [--apply]
scopegrain dist mounted-list --project PATH
scopegrain dist extension-register --project PATH --input FILE
scopegrain dist extension-list --project PATH
scopegrain dist extension-activate|deactivate --project PATH ID
scopegrain dist extension-remove --project PATH ID [--apply]
scopegrain dist preset-register --project PATH --input FILE
scopegrain dist preset-list --project PATH
scopegrain dist preset-remove --project PATH ID [--apply]
scopegrain dist pack --project PATH --source DIR --out FILE
```

`run` executes declarative workflows whose steps may only name
whitelisted harness primitives (`task.transition`, `methodology.check`,
`converge.evaluate`, `converge.record`, `analyze.task`,
`checklist.mark`, `checklist.findings`, `noop`); never shell nor
third-party binaries. Step `args` are closed per op: an unknown key is
rejected at document validation instead of being silently dropped. In
`task.transition`, `verification` and `review` map onto the transition
DTO and `evidence` is a legacy alias for `verification` — declaring both
is ambiguous and rejected. Atomic checkpoints under
`<state>/workflow-runs/` allow resuming without re-running completed
steps. `stack` merges local
catalogs by priority. `compose` applies `replace|prepend|append|wrap`
layers. `validate`/`bundle-validate` check submissions (slug id, semver,
mandatory sha256 pinning on remote sources).

`bundle-install` (input `{bundle, sources:[{uri,priority}]}`) copies the
required `file://` sources under `<configDir>/bundles/<id>/` — bounded
(256 files / 16 MiB / 32 depth levels), create-only, idempotent
re-install, content-addressed provenance in `provenance.json`; pinned
sha256 is verified before copying.

`bundle-mount` registers the installed bundle's typed entries in
`<configDir>/mounted-catalog.json`, a layer `loadWorkspaceCatalog`
merges after snapshot validation: each entry confined to `bundles/` and
sha256-verified on every load. Re-mounting the same bundle refreshes;
collisions with snapshot ids or other bundles are `CONFLICT`.
Directory-type sources mount the kind's conventional file (`SKILL.md`,
`AGENT.md`, ...); entries without a main file are reported in
`unmounted`, never guessed. `bundle-unmount` removes only that bundle's
entries. `bundle-uninstall` unmounts and deletes only files still
matching provenance — divergent bytes land in `leftBehind`;
`--keep-files` deletes nothing. Provenance tampered to point outside the
bundle directory fails `MALFORMED`. `bundle-uninstall`,
`extension-remove` and `preset-remove` follow the same
preview/`--apply` contract as `bundle-install`: without `--apply` they
return `mode: 'dry-run'` with the plan (entries to unmount,
`deleteCandidates`, registry record to delete) validated against current
state — `NOT_FOUND`/`CONFLICT` surface in the preview, not only at
write time.

Presets declare `overrides:[{target, op, content}]` where `target` is
`'*'`, `'<kind>/*'` or `'<kind>/<id>'` and `op` is `replace`, `prepend`,
`append`, `wrap` (with `{{BODY}}`) or `replace-section` (with
`selector`, a lowercase heading anchor: replaces the section body, not
the heading nor same/higher-level sections; empty content removes the
body; a missing heading is a no-op). They apply to projected resources
in the workflow packet (ascending priority, last wins) and the trace is
declared in `packet.presets.applied`. `preset-remove` deletes a
registered preset.

Extensions follow the lifecycle `registered -> active <-> disabled`:
`extension-activate` validates that the `contributes` (`<kind>/<id>`)
exist in the workspace catalog before activating; an `active` extension
contributes its declared resources to the workflow packet
(`packet.contributedResources` + trace in `packet.extensions.applied`).
`extension-remove` requires `disabled` state — no silent teardown. All
registry mutations (`extensions.json`, `presets.json`, `bundles/`,
`mounted-catalog.json`) serialize under a verified `dist.lock`. Mounted
resources are first-class consumers: `host activate` projects them as
native bridges through the same pipeline as snapshot resources — their
`resourcePath` points inside `<configDir>/bundles/<id>/`, and `doctor`
treats the mounted layer as an overlay (never an `upgradeAvailable`
signal).

`host parity --project . [--hosts CSV]` compares the canonical resource
sets each selected host would project (activation plan, read-only) via
each bridge's `source:` frontmatter. It reports per-host `coverage`,
`drift` (resources absent from a host that does emit that kind — a
projection-bug signal) and `structural` (absences where the host emits
no resource of that kind at all, e.g. codex with no `agent/*`). Hosts
with surfaces (antigravity) are compared by the union of their declared
variants.

`dist selftest --project PATH` exercises the full distribution cycle
(discovery → validate → dry-run → install → mount → unmount →
uninstall) against a fixture generated inside the project and always
removed afterwards. Returns `{ok, steps[]}` with each step
pass/fail — local diagnostics, no telemetry. Mutations leave a trail in
`dist-journal.jsonl` (CAS via `previousSha256`/`newSha256`); with an
enrolled workspace the registry write also goes through the journal
kernel (`journaled: true`).

`dist journal --project PATH [--tail N] [--registry R] [--op O] [--id I]`
reads that trail in bounded fashion: returns `{entries, corrupt, chain}`
where `chain` verifies the per-file CAS property
(`previousSha256[n] == newSha256[n-1]` for the same `rel`) — `valid`,
`broken@<revision>` or `empty`. Corrupt lines are reported in `corrupt`,
never aborting the read.

`dist pack` packages a source directory into a deterministic POSIX ustar
tarball: identical input bytes produce identical output bytes (mtime 0,
uid/gid 0, normalized modes, name-sorted entries, no machine-local
fields). It is the publishable-artifact path; distribution remains
local-only — there is no remote feed.

### policy/hooks.json — declarative example

```json
{"schemaVersion": 1,
 "hooks": {"before": {"*": [{"id": "log", "description": "notice"}]},
           "after": {"implement-task": [{"id": "check",
             "description": "verify"}]}}}
```

The real shape is `{hooks: {before|after: {<commandId>|'*': [{id, description,
command?}]}}}`: phase first, command second — the inverse produces
`POLICY_MALFORMED`. Each entry requires `id` + `description`; `command`
is optional.

`before`/`after` hooks are projected into `packet.hooks` as advisory data
for the host; the harness never executes them.

The optional `preAction` key is the bounded executable layer: closed
`when` conditions over task metadata, evaluated by the runtime inside
`evaluateTaskActions`, with declared effects — `block` prunes the action
from the permitted set (real denial), `require-gate` keeps it but flags
it on `gated` (the host must obtain approval), `record` only annotates.
Never argv, never scripts: conditions and effects are data.

```json
{"schemaVersion": 1, "hooks": {},
 "preAction": [{"id": "gate-large-scope",
   "when": {"action": "edit", "scopeOver": 9},
   "then": "require-gate",
   "reason": "scope above 9 needs approval"}]}
```

`when.action` is an action name or `*`; `when.stateIn` a task-state list;
`when.scopeOver` an integer (strict `>` over `task.scope.length`);
`when.skillsMissing` a skill list — matches if the task lacks any;
`when.scopeOverlapIn` a task-state list — cross-task condition: matches
when another task in one of those states declares a scope entry that
overlaps this task's (equal or directory containment). The task itself is
excluded; an empty scope declares no write region and never overlaps.
Matched peer ids are traced as `with` on the applied entry.
`when.dataClassificationIn` a level list
(`public|internal|confidential|pii`) — matches when the task's effective
classification (its own, or the parent plan's when the task declares
none) is in the list; an unclassified task never matches.
Matching entries are traced on `packet.actionHooks.applied` and
`task check-action`/`scopegrain_check_action` expose `actionHooks` + `gate`.

### task gate / host gate — native interception channel

```text
scopegrain task gate --project PATH ID|SLUG|- ACTION
scopegrain host gate --project PATH --host NAME
```

`task gate` is the decision endpoint a host hook can call before an
action: it runs the full check (state + methodology + `preAction`) and
emits `{decision: allow|deny|gate, exitCode, check}` with the exit
contract `0` allow, `2` deny, `3` require-gate and `1` error —
fail-closed: any non-zero code must block the hook. `-` as the task
resolves `SCOPEGRAIN_TASK` then the active-task pointer.

`host gate` emits the read-only merge proposal wiring each host's
documented surface to the gate — nothing is installed and the harness
never writes shared host configuration:

- `claude`: `hooks.PreToolUse` fragment (matcher `Edit|Write|MultiEdit|
  NotebookEdit` → `edit`) for `.claude/settings.json`.
- `opencode`: declarative `permission` map (`edit`/`bash` → `ask`) for
  `opencode.jsonc` — it does not call `task gate`.
- `codex`: `approval_policy = "on-request"` for `.codex/config.toml` —
  declarative, no gate call either.
- `devin`/`antigravity`/`hermes`/`generic`: `documented-only`, no
  fragment — a native pilot remains required before any claim.

`interceptsNativeTools` stays `false`: interception only exists once the
owner merges a proposal and a pilot proves it.

### verify * — supervised verification commands

```text
scopegrain verify list --project PATH
scopegrain verify add --project PATH --command CMD [--apply]
scopegrain verify approve ID --project PATH [--apply]
scopegrain verify discover --project PATH [--apply] [--approve]
scopegrain verify approve-discovered --project PATH [--all] [--apply]
scopegrain verify run ID --project PATH [--timeout MS] [--fail-on-error]
```

Full contract in `../verification.md`: nothing auto-approves or
auto-executes — `add`/`approve`/`discover` preview like every other
mutating verb, and `run` only executes an explicitly approved record as
literal argv (bounded, never a shell). `--fail-on-error` propagates the
child exit code (or 1 on timeout/signal) for CI.

Windows note: a declared executable that resolves to a `.cmd`/`.bat`
PATH shim (typically `npm`, `yarn`, `pnpm`) fails `run` with
`VERIFY_EXEC_REJECTED` — Node >= 18.20.2 refuses to spawn batch files
without a shell (CVE-2024-27980). Re-declare the command with a real
executable: `node <script>` (e.g.
`node node_modules/npm/bin/npm-cli.js test`) or the tool's `.exe`.

## Global user config, version, wave progress and VantaDB L3

### `--version` / `-v` / `-V` / `-h`

```text
scopegrain --version
scopegrain -h
```

Prints `{name, version, node}` from the installed `package.json` without
conflicting with `vantadb setup --version X`. `-h` aliases `--help`.

### config path / config show / config set

```text
scopegrain config path
scopegrain config show
scopegrain config set --input FILE [--apply]
```

Manages optional global user onboarding defaults at
`~/.config/scopegrain/config.json` (or `$XDG_CONFIG_HOME/scopegrain/config.json`
or `$SCOPEGRAIN_USER_CONFIG`; `"none"` or empty disables it). Only permits
`locale`, `hosts`, `methodology` and `versioning`. Rejects permissions,
verification commands and project paths. Strict precedence:
`workspace > --answers > repo-signals > user-global > policy-defaults`.
An already-initialized workspace never inherits or merges global changes at runtime.

### plan run (wave progress persistence)

```text
scopegrain plan run --project PATH KEY [--apply]
```

Without `--apply` returns the deterministic wave schedule plus a checkpoint
preview and `resume` summary. With `--apply` atomically persists a bounded
checkpoint (max 50) at `<paths.state>/plan-runs/<KEY>.json` under a verified
lock so interrupted multi-task runs can resume accurately.

### plan status (derived status)

```text
scopegrain plan status --project PATH KEY
```

Plan status derived from member task states — read-only, nothing is
persisted. Returns `{status, percent, done, total, counts, activeTasks,
members}`. Taxonomy by precedence: `empty` (no members), `failed` (any
ABANDON — terminal failure of the plan as declared), `completed` (all
CLOSE or terminally disposed `discarded|cancelled|icebox|future|deferred`),
`blocked` (any STALL), `active` (any in
RESEARCH/ACT/VERIFY/COLLATERAL/EVALUATE/REVIEW/ACCEPT), `partial` (done
mixed with pending and nothing in flight), `draft` (all PLAN). `counts` is
a per-state histogram with `dropped` (disposition) and `unreadable`
buckets; `activeTasks` lists in-flight members.
`GET /api/plans/:key/status` exposes the same plus `runState`, and the
`plans`/`plan` projections now include `derivedStatus` next to the prior
coarse `status` (unchanged for compatibility).

### plan conclude (closing retrospective)

```text
scopegrain plan conclude --project PATH KEY [--partial] [--report] [--apply]
```

Plan closing retrospective. Without `--apply` returns a preview
(`mode:"preview"`) with the summary and `wouldWrite`. If any member is
not in a terminal state (CLOSE/ABANDON/terminal disposition) it fails
with `PLAN_NOT_TERMINAL` unless `--partial` is passed. With `--apply`:
writes one `outcomes` entry per terminal member not recorded before
(CLOSE->`ok`, ABANDON->`fail`; members with a `dropped` disposition get
no outcome — descoped, not failed), an `activity` line
(`kind:"plan-conclusion"`) with the summary, an optional `report`
artifact via `--report`, and a bounded record (max 50) at
`<paths.state>/plan-conclusions/<KEY>.json` under a verified lock.
Idempotent: a second call with no changes returns `mode:"noop"` with the
same summary and zero writes; if a member's state changes only the new
outcomes are written (already-recorded members are never duplicated).

### structure refresh

```text
scopegrain structure refresh --project PATH [--config REL] [--apply]
```

Explicit bounded structural index refresh: runs a cheap stat-only freshness
check first and returns `mode: "noop"` without reading source files when
already fresh. When missing or stale, previews without `--apply` and
rebuilds/persists atomically with `--apply`. `context` remains strictly
read-only and reports `refreshPolicy: "explicit"` (except the opt-in
`--structure-debounce` cache, see above).

### vantadb sync-persona

```text
scopegrain vantadb sync-persona --project PATH [--limit N] [--timeout MS] [--apply]
```

Opt-in L3 projection into `l3/sg-persona-<scopeHash>`: reads only
ownership-proved `preference` and `decision` captures from `.scopegrain`
(sole authority), projects idempotently with readback and never adopts
unproved files (`skippedUnproved`). Preview without `--apply`.
