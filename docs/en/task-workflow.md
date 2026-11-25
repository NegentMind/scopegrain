<!-- translated-from: docs/task-workflow.md @ 2026-11-23 -->
# Task workflow and evidence

> English translation of the canonical Spanish document
> (`../task-workflow.md`). The Spanish version prevails.

Factual description of the task commands, the review progression and
the evidence format per `policy/workflow.json` and
`docs/implementation.md`. The examples are synthetic: they are not
execution results.

## Compatibility and methodology

The historical examples on this page use V1 tasks in `manual` mode.
Under `organic-sdd` or `sdd`, a creation without the required
metadata does not represent an authorized task. The
[Organic and SDD](methodology.md) guide describes lightweight
records, V2 specifications/designs, approvals, scenarios and linked
reports.

ACT and ACCEPT keep the workflow edges and add the mode/record
gates. An allowed methodology query does not by itself authorize a
transition or native tools. Revoking consent may remove `edit` from
a task that was already in ACT.

## States and transitions

The canonical state machine is in `policy/workflow.json`:

```text
PLAN -> ACT | RESEARCH | STALL | ABANDON
ACT -> VERIFY | STALL | ABANDON
VERIFY -> COLLATERAL | EVALUATE | ACT | STALL | ABANDON
COLLATERAL -> RESEARCH | ACT | EVALUATE | STALL | ABANDON
RESEARCH -> PLAN | ACT | STALL | ABANDON
EVALUATE -> REVIEW | ACT | STALL | ABANDON
REVIEW -> ACCEPT | ACT | STALL | ABANDON
ACCEPT -> CLOSE | ACT | STALL | ABANDON
STALL -> PLAN | ABANDON
CLOSE -> (terminal)
ABANDON -> (terminal)
```

`ABANDON` is the terminal abandonment state: it requires neither
evidence nor the methodology gate. A task whose `disposition` is
`discarded`/`cancelled` may only transition to `ABANDON` (the
disposition is effective, not decorative); resuming requires clearing
the disposition first. Verification checks admit `status`
`pass`/`fail`/`error` as honest records; acceptance still requires
`pass`. Review verdicts admit `approve`/`reject`/`changes-requested`;
acceptance still requires `approve`.

The policy `constraints` block pins the content guards that edges
cannot express; the runtime reads and pins them (`transition.mjs`,
divergence = `POLICY_INVALID`): `terminalDispositions` =
`discarded`/`cancelled` with `terminalDispositionTarget` = `ABANDON`,
and `methodologyRevalidatedTargets` = `ACT`/`ACCEPT`/`CLOSE` (the
targets requiring a revalidated methodology gate).

There is one exception that is not a policy edge: `REVIEW -> REVIEW`
is admitted in code exclusively as an evidence attachment. It allows
accumulating `verification` and/or `review` while the task is parked
in REVIEW, without the detour via ACT that would empty the stored
evidence. The state stays in REVIEW and the review advances as in
every CAS transition. A `REVIEW -> REVIEW` without evidence is
rejected (`INVALID_TRANSITION`): an empty self-transition would only
add noise to the history. Self-loops of any other state remain
invalid.

Allowed actions per state (also in the policy): `read` in all;
`research` in PLAN/COLLATERAL/RESEARCH; `propose` in PLAN/ACT/VERIFY/
COLLATERAL/RESEARCH; `edit` only in ACT; `verify` in VERIFY;
`evaluate` in EVALUATE; `review` in REVIEW.

## CLI commands

```powershell
# Create (PLAN state, revision 0, own UUID): via --input JSON with
# preview by default; --apply persists
node .\bin\scopegrain.mjs task create --project P --input task.json [--apply]
```

`task.json` carries `{title, contract, authorContext, scope}` plus
the mode metadata: a `methodology` assessment under `organic-sdd`
(`schemas/organic-assessment.schema.json`) or the `specId`+`designId`
pair. The flags form `--title/--contract/--author [--scope] [--spec
--design --plan]` remains available only in projects with
`methodology: "manual"`, where it creates the V1 task directly;
under `organic-sdd` or `sdd` without the formal pair it fails with
`METHODOLOGY_REQUIRED` pointing to `--input`.

```powershell
# List / show
node .\bin\scopegrain.mjs task list --project P
node .\bin\scopegrain.mjs task show --project P <UUID>

# Transition (mandatory CAS with --revision N)
node .\bin\scopegrain.mjs task transition --project P <UUID> ACT --revision 0
node .\bin\scopegrain.mjs task transition --project P <UUID> VERIFY --revision 1 [--evidence evidence.json]

# Check an action in the current state
node .\bin\scopegrain.mjs task check-action --project P <UUID> edit
```

`--config` points to an alternative config in any of them.
`--evidence` only accepts the `verification` and/or `review` keys.

## Semantic layer (schemaVersion 3)

Task records may carry an optional semantic layer — named backlog,
disposition, priority, severity, type, effort, estimate, source,
`dependsOn`, typed `relations`, `goalIds`, deep `analysis`, `steps`,
`notes`, exercised `skills` and `uncertainty` (uphill/downhill). It is
orthogonal to the lifecycle: it never changes `state` or touches evidence.
Any semantic field at creation, or any `meta` write, upgrades the record
to `schemaVersion: 3` (V2 records keep their methodology bundle; V1
records null it out). Full field table:
`resources/references/backlog-format.md`.

`budget` (task and plan records) declares per-record operational
ceilings — `maxIterations`, `maxRecordedOperations`,
`maxSubAgentDispatches`, `maxConsecutiveFails`, `maxDurationMinutes`
plus `turns`/`notes`. Any key omitted falls back to `budgetDefaults`
in `policy/operation-limits.json` (legacy `BUDGET_LIMITS` equivalent);
an explicit `null` disables that measure. Counts cover recorded
operations only — transitions, `check_action`, `verify run`, member
dispatches — never native tool calls
(`budgetMeasures: explicitly-recorded-operations-only`).

Two deliberately distinct dependency layers: a plan's DAG
(`tasks[].dependsOn` by keys) is the hard constraint — the ACT gate
enforces it transitively and `plan next` turns it into readiness
(ready/blocked). At materialization that DAG also propagates into each
V3 task record as UUID `dependsOn`, so task-level consumers (MCP
ordering, the viewer) see the same structure. Record-level
`dependsOn`/`relations` on tasks outside a plan is declarative and
informational — it orders suggestions and documents the graph but does
not gate. Declare it when sequencing work (`see`, `supersedes`,
`duplicateOf`, `blocks` under `relations`).

```powershell
# Metadata patch (CAS with --revision N): {set:{...}, disposition?,
# addNote?, stepStatus?} in the --input file
node .\bin\scopegrain.mjs task meta --project P <UUID> --revision 2 --input meta.json

# Disposition shortcut: deferred|icebox|future|discarded|cancelled;
# 'active' clears the disposition
node .\bin\scopegrain.mjs task disposition --project P <UUID> deferred --revision 2 --reason "waiting on owner" --by agent

# Note and step status
node .\bin\scopegrain.mjs task note --project P <UUID> --revision 3 --text "root cause confirmed"
node .\bin\scopegrain.mjs task step --project P <UUID> --revision 4 --index 0 --status done

# Task links (meta shortcut): union/diff of dependsOn and typed
# relations without a JSON file. Without --kind edits dependsOn (the
# target must be a real task); with --kind edits relations[REL]
# (external refs allowed). CAS with --revision N
node .\bin\scopegrain.mjs task link --project P <UUID> <TARGET> --revision 1 --apply
node .\bin\scopegrain.mjs task link --project P <UUID> ext:doc-42 --kind see --revision 2 --apply
node .\bin\scopegrain.mjs task unlink --project P <UUID> <TARGET> --revision 3 --apply

# Suggest candidate links (read-only; never writes). Detects plan-DAG
# edges missing from the record and similar titles between an open task
# and an ABANDON one (supersedes) or between two open ones (see).
# Apply each with task link --apply
node .\bin\scopegrain.mjs task link-suggest --project P

# Post-creation authorization (the only legal path for a methodology
# 'missing' authorization; CAS with --revision N)
node .\bin\scopegrain.mjs task authorize --project P <UUID> --revision 1 --actor owner --reference "decision D-7" --apply

# Re-assess the stored methodology (light records; formal spec/design
# bindings are immutable). --input carries the assessment object;
# CAS with --revision N
node .\bin\scopegrain.mjs task reassess --project P <UUID> --revision 1 --input assessment.json --apply

# List a named backlog (no filter = all)
node .\bin\scopegrain.mjs task list --project P --backlog future

# Human-readable task document (Markdown rendered from the record)
node .\bin\scopegrain.mjs task doc --project P <UUID>
```

`task doc` writes `.scopegrain/tasks/<uuid>.md` (or the destination
configured under `paths.tasks`): front matter with id, state, revision and
timestamps, plus sections for contract, scope, methodology, dependencies,
steps, verification, review, notes and history. Document headings and
labels follow `config.locale` (the document IS an operational artifact,
not a canonical instruction — see the language policy in
[product-contract](product-contract.md)). It is idempotent — a
second run with no changes reports `changed: false` and does not rewrite
the file.

## Session context

```powershell
# Session-start packet (read-only)
node .\bin\scopegrain.mjs context --project P [--tail N] [--no-vantadb] [--no-structure]
```

`context` returns a bounded JSON packet (`schemaVersion: 1`) with the
instructions and config paths, `locale` (the user's preferred language:
generated operational artifacts and interactive surfaces follow it), the
user knowledge file `.scopegrain/context.md` (when present; read, never
written — content capped at 32 KiB), a task summary (totals, open by
state and the `ready` list: PLAN tasks with no disposition), open goals,
the latest `progress` entries, up to 3 resumable sessions and the pending
journal event count. Hosts invoke it at session start per the generated
instruction in AGENTS.md/CLAUDE.md and `.scopegrain/instructions.md`; it
never executes commands or mutates state. `--no-structure` serves the
persisted structure index without rescanning (the `structureDebounceMs`
option exists at API level for a time-window cache); the equivalent MCP
argument is `noStructure`.

The packet also carries `tokenEstimate`: a local heuristic estimate
`utf8-bytes/4` (UTF-8 bytes after CRLF normalization, divided by four,
rounded up) — never the host tokenizer count, which the harness cannot
observe. `tokenEstimate.sections` reports `{estimatedTokens, estimator,
bytes}` per assembled section; for `userContext` the measurement covers
only the returned `content` (post 32 KiB cap) and
`coversTruncatedContent` says so. `tokenEstimate.total` estimates the
whole packet without the `tokenEstimate` key itself
(`excludesSelf: true`); `tokenEstimate.wire` is the honest self-inclusive
figure — the serialized packet including the block, iterated to a fixed
point. When `wire` exceeds the advisory `packetBudgetTokens` budget
(16000, `policy/operation-limits.json`), the packet declares it in
`warnings[]`. Advisory and degradable: on failure it is `null` instead
of aborting the packet.

## Operational memory, goals and metrics

Bounded append-only JSONL logs under `paths.memory`
(`.scopegrain/memory/`):
`lessons` (durable learnings), `outcomes`
(ok/fail per skills used), `progress` (advance archive — written
automatically when a task reaches CLOSE), `goals` (meta-level objectives;
tasks link via `goalIds`, latest entry per `id` wins).

```powershell
node .\bin\scopegrain.mjs memory add --project P --log lessons --input lesson.json
node .\bin\scopegrain.mjs memory list --project P --log outcomes [--tail 20]
node .\bin\scopegrain.mjs goal create --project P --input goal.json
node .\bin\scopegrain.mjs goal list --project P
node .\bin\scopegrain.mjs goal transition --project P <UUID> --to achieved
node .\bin\scopegrain.mjs metrics --project P
```

`metrics` aggregates the store on read: counts by state/backlog/type/
priority/disposition, verification and first-try rates, close-time
p50/p95/p99 and per-skill outcome rates.

## Typical progression

1. `create` -> PLAN, revision 0.
2. `transition ... ACT --revision 0` -> ACT, revision 1.
3. `VERIFY --revision 1` -> revision 2.
4. `EVALUATE --revision 2` -> revision 3.
5. `REVIEW --revision 3` -> revision 4.
6. `ACCEPT --revision 4 --evidence e.json` -> revision 5, requires evidence.
7. `CLOSE --revision 5` -> revision 6, terminal.

If the expected revision does not match the stored one:
`REVISION_MISMATCH`. A transition forbidden by the policy:
`INVALID_TRANSITION`. An existing lock (`<id>.json.lock`):
`TASK_LOCKED`, never recovered automatically.

## Evidence format (declared attestations)

`verification` requires non-empty checks; each check requires
`command`, `cwd`, `status:"pass"` (the only one accepted by the
policy) and non-empty `evidence`. `review` admits two modes, both
with `verdict:"approve"`:

```json
{
  "verification": {
    "checks": [
      {"command": "npm test", "cwd": ".", "status": "pass", "evidence": "output.log"}
    ]
  },
  "review": {
    "mode": "fresh", "reviewer": "agent-b",
    "authorContext": "ctx-a", "reviewerContext": "ctx-b",
    "verdict": "approve"
  }
}
```

`waived` alternative: `{"mode":"waived","owner":"...","reference":"...",
"reason":"...","verdict":"approve"}`. In `fresh` mode, `authorContext`
must match the stored author and `reviewerContext` must be non-empty
and different. These are recorded declarations, not authenticated
identity.

## Invalidation

- Returning to `ACT` clears the stored `verification` and `review`;
  approval cannot be carried over from a previous implementation.
- Attaching a new `verification` without `review` in the same call
  invalidates the previous review. This also applies to the
  `REVIEW -> REVIEW` attachment: to keep the review it must be
  resent or attached in a later self-transition.
- A transition rejected by validation or by the policy leaves the
  file, the state and the revision intact. This does not promise
  recovery from hardware failures or a power cut mid-write.

## Scope and reads

`scope` is a list of normalized relative paths. Creation validates
destinations and the V2 gates revalidate their current containment;
a historical reader is not a continuous check of permissions or
foreign references. `..` and reserved prefixes are not accepted.
`list` returns `{tasks, malformed}`; corrupted or non-UUID-named
files are reported, never silently discarded.
