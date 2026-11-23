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
artifacts (create-only, CAS, gated in converge).

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
scopegrain dist bundle-uninstall --project PATH ID [--keep-files]
scopegrain dist mounted-list --project PATH
scopegrain dist extension-register --project PATH --input FILE
scopegrain dist extension-list --project PATH
scopegrain dist extension-activate|deactivate --project PATH ID
scopegrain dist extension-remove --project PATH ID
scopegrain dist preset-register --project PATH --input FILE
scopegrain dist preset-list --project PATH
scopegrain dist preset-remove --project PATH ID
scopegrain dist pack --project PATH --source DIR --out FILE
```

`run` executes declarative workflows whose steps may only name
whitelisted harness primitives (`task.transition`, `converge.evaluate`,
`analyze.task`, `checklist.*`, `noop`, ...); never shell nor third-party
binaries. Atomic checkpoints under `<state>/workflow-runs/` allow
resuming without re-running completed steps. `stack` merges local
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
bundle directory fails `MALFORMED`.

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
 "hooks": {"*": {"before_": [{"id": "log", "description": "aviso"}]},
           "implement-task": {"after_": [{"id": "check",
             "description": "verificar"}]}}}
```

Hooks are projected into `packet.hooks` as advisory data for the host;
the harness never executes them.

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

### structure refresh

```text
scopegrain structure refresh --project PATH [--config REL] [--apply]
```

Explicit bounded structural index refresh: runs a cheap stat-only freshness
check first and returns `mode: "noop"` without reading source files when
already fresh. When missing or stale, previews without `--apply` and
rebuilds/persists atomically with `--apply`. `context` remains strictly
read-only and reports `refreshPolicy: "explicit"`.

### vantadb sync-persona

```text
scopegrain vantadb sync-persona --project PATH [--limit N] [--timeout MS] [--apply]
```

Opt-in L3 projection into `l3/sg-persona-<scopeHash>`: reads only
ownership-proved `preference` and `decision` captures from `.scopegrain`
(sole authority), projects idempotently with readback and never adopts
unproved files (`skippedUnproved`). Preview without `--apply`.
