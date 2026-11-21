# CLI surface reference

> English translation of the canonical Spanish document
> (`../cli-reference.md`). The Spanish version prevails.

Reference for the `scopegrain` binary verbs (compatible alias:
`tasksystem`) that `doctor`'s `docs-cli-drift` check reported as
undocumented. The full command table comes from `scopegrain --help`;
this document covers lifecycle, owned records, catalog resource
recovery and the catalog aliases resolved at dispatch.

Common conventions (source: `src/cli.mjs`):

- All output is JSON on stdout; errors are JSON on stderr with exit
  code 1.
- Mutating verbs show a read-only preview (`mode: 'dry-run'`) unless
  `--apply` is passed; `--apply` is create-only and never overwrites,
  merges or reinitializes.
- `--yes` and `--force` do not exist: confirmation is always explicit.
- `--project PATH` is required unless stated otherwise; `--config REL`
  selects an alternate config.

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
content against the snapshot-pinned sha256.

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
`--project PATH [--config REL] [--mode M] [--task UUID] [--host H] [--profile ID] [--interaction direct|guided]`.

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

### structure scan / status / show

```
structure scan --project PATH [--config REL] [--apply]
structure status --project PATH [--config REL]
structure show --project PATH [--config REL]
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

It never reads secrets or binary contents, never executes project
commands, honors depth/entry budgets with warnings, and rejects
symlinks/junctions under the existing security boundaries.

## Automatic context rehydration (VantaDB)

When a VantaDB backend is enrolled, the projected project history is
injected automatically at both resume points — no manual CLI queries:

```
context --project PATH [--tail N] [--no-vantadb] [--timeout MS]
session resume UUID [--no-vantadb] [--timeout MS]
```

- `context` adds `vantadb`: a bounded `memory_recall` (top_k 5, agent
  scope) over distilled L1 memories, so the session-start packet carries
  verified episodic context.
- `session resume` adds `vantadb`: `memory_context` by `recordId` over
  the `sg-formal-v1-*` namespaces — every remotely projected journal
  event for that task.
- Both fail closed: without enrollment the field is
  `{ enrolled: false }`; a dead backend degrades to
  `{ enrolled: true, error: {...} }` without aborting the packet.
- `--no-vantadb` skips the backend spawn entirely; `--timeout MS`
  bounds the wait (15 s default).
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
memory list --project PATH --log lessons|outcomes|progress|goals [--tail N]
```

`add` validates the entry against the per-log closed schema (lessons
`{topic?,text,ref?,taskId?}`, outcomes `{taskId,outcome,skills[]}`,
progress `{taskId,title,result,...}`) and appends it; `list` returns the
latest `tail` entries (default 50, max 1000) plus malformed lines. The
`goals` log is read-only here: goals enter through `goal *`.

Logs larger than the configured document cap are read as a bounded tail
window, so an oversized log never breaks session start; the result marks
`truncated: true`. On append, an active segment that already exceeds the
cap rotates whole into `paths.memory/archive/` — immutable and never
deleted — so a single log file does not grow without bound. Rotation is
best-effort: a busy file defers it and the append still succeeds.

### goal create / goal list / goal transition

```text
goal create --project PATH --input FILE
goal list --project PATH
goal transition --project PATH ID --to open|achieved|dropped
```

Meta-level objectives: `{id,title,description?,status,horizon?,metrics?}`
records in `goals.jsonl`; latest entry per `id` wins. Tasks link via
`task.goalIds`. `create` requires `title` and generates the UUID;
`transition` re-appends the current entry with the new status.

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

Retroactively registers work done outside the task lifecycle: creates a
`type: ops` task with `source: activity:<kind>` plus a `progress` log
entry. With `taskId` it links the action to an existing task instead.
Input: `{kind: action|commit|note, title, summary?, ref?, files?,
taskId?, author?, methodology?}`. Under gated methodology modes it
synthesizes a **declared** assessment (authorized by the actor - never a
fabricated approval).

### hooks install / hooks uninstall

```text
scopegrain hooks install --project PATH [--apply]
scopegrain hooks uninstall --project PATH [--apply]
```

Installs/removes a managed block in `.git/hooks/post-commit` that calls
`activity record` after every commit (auto-registration of out-of-loop
commits). Idempotent, never rewrites user hook content and never breaks
a commit (always exits 0).
