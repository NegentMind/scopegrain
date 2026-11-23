---
name: session-handoff
description: Use at session boundaries and task completion to report evidence-backed progress and next work
---
# Session Handoff

Read current task and plan records rather than relying on conversation.
Report completed work, active work, blockers and the next safe action.
Identify executed versus pending checks and any changed assumptions.
Preserve useful partial work and mention unrelated changes.
Distill durable learnings into the lessons log (`memory add --log lessons`)
so the next session inherits them, and note any task-level claim or
disposition changes through the meta verbs, not prose.
Save a concise handoff in the configured harness workspace.
Do not invent completion percentages or silently advance task states.

Progress is tracked in two places that must never disagree: the project's
active work registry (backlog/plan/task records) and the completed-work
registry under `.scopegrain/` (worklog/state, `reports/`, `decisions/`,
`memory/`). **Invariant:** no item exists in both registries at once, and
no item is silently dropped — removal without completion is archived with
its reason.

This skill owns the *written record*: registries, worklog entries and the
handoff format below. Re-curating the loaded context itself — what to
reload, what to revalidate — belongs to `context-engineering`.

## Trigger 1 — A task completes

Run when a task reaches its done state in this session, in this order:

### A. Doc impact analysis

For each modified file, verify the corresponding documentation is
updated. Maintain the project's file→doc mapping; if a touched file has
no mapped doc, note the gap rather than guessing one.

### B. Extract task data

ID, name, date, objective, modified files, result, commit sha(s).

### C. Update the active registry

- Mark or remove the completed row in the backlog/plan record per the
  project's convention — no accumulating struck-through rows.
- Update the plan's status tracker and recitation.
- An item removed *without* completing goes to the project's archive
  record with its reason — never silently dropped.

### D. Register the completion

1. Route the entry to the domain file the project uses for completed
   work (by subsystem/domain: engine, bindings, frontend, ci-cd, ops,
   security/audit, decisions, research, process changes).
2. Check the ID is not already registered — update, do not duplicate.
3. Record: `### <ID>: Description` + date, one-line objective, result,
   commit sha.
4. Significant milestone → note it in the process/meta record.
5. Research or discovery outcome → route to the research registry.
6. Only user-visible changes (features, breaking changes, public fixes,
   CLI surface) get a changelog entry — not every task.

### D2. Archive completed plans

When a plan's tasks are all done or aborted:

1. Run a short retrospective (start/stop/continue + one measurable
   action); if an earlier step already produced it, copy it forward.
2. Move the plan file **and its sidecar state files** (budget, session
   state) to the plan archive — moving the plan without its sidecars
   corrupts the historical record.
3. Verify no orphan sidecar files remain in the active plans directory.
4. Add an archive note (date, N/M completed, retrospective result) to the
   process record.

### E. Validate coverage

Run the project's doc-coverage / registry checks if they exist; report
the result rather than asserting it. The standing bar a completed task
must still satisfy is `resources/references/definition-of-done.md`.

### F. Report

State what was updated: active registry, plan file, completed-work
registry, changelog (if applicable), validation outcome. Commit policy:
standalone → no commit without instruction; inside an orchestrated run →
the orchestrator owns commits. A significant decision is recorded in the
decisions log, not left in prose.

## Trigger 2 — Starting a task

1. Search the completed-work registry for prior art on this ID or topic —
   never re-do registered work.
2. Locate the task in the active registry; a previously discarded item
   being resumed returns to pending explicitly.
3. Proceed. If resuming after an interruption, re-validate recorded state
   against the repository per `context-engineering` before acting on it.

## Trigger 3 — Periodic maintenance

1. Registry: items inactive beyond the project's threshold move to the
   icebox or are discarded (discards are archived with reason).
2. Completed-work registry: deduplicate entries, repair stale
   cross-references.
3. Cross-check the invariant: nothing sits in both registries at once.

## Trigger 4 — Sync review reports

New review/audit reports get a row in the reports index
(`.scopegrain/reports/`); findings at or above the agreed severity derive
into the active registry as findings rows with their origin recorded.
Never silence a report newer than its index row.

## Trigger 5 — Postmortem

On failure signals — a task abandoned, the same error twice, an incident,
a stall beyond appetite, a fix taking 3+ attempts — write a short
postmortem and persist it:

```
memory add --log lessons
entry: "YYYY-MM-DD | POSTMORTEM <ID> | <context> | <lesson> | <action>"
```

No persistence, no closure: an unpersisted lesson will be re-learned at
full price.

## Trigger 6 — Memory reconciliation

Reconcile agent-side memory (`lessons`, `decisions` logs) against the
project registries: entries claiming work the project does not record are
divergences — surface them as findings or pending notes. Never silently
drop a memory entry whose referenced task does not exist in the project.

## Handoff Format

At session end or task boundary, record in the configured workspace:

```
COMPLETED:    <units done, with commit shas / evidence paths>
ACTIVE:       <unit in flight, current state, next safe action>
BLOCKERS:     <what blocks, what unblocks>
CHECKS:       <executed (with outcome) vs pending>
CHANGES:      <files touched; unrelated foreign changes left alone>
ASSUMPTIONS:  <anything that changed or remains unverified>
```

## Boundaries

- Report executed checks only — never claim a check that was not run.
- Do not invent completion percentages or advance task states silently;
  state changes go through the project's meta verbs/commands.
- Distill durable learnings into the lessons log; task-level claims and
  dispositions into the proper records — not into prose.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The conversation already says what happened" | Conversation memory is the least reliable record; registries are evidence. |
| "I'll register the task later" | Unregistered completions get re-done or lost; register before summarizing. |
| "Struck-through rows show history" | Strikethrough accumulates noise and breaks the registry invariant — completions move to the completed-work registry. |
| "The lesson is obvious, no need to persist it" | An unpersisted lesson is re-learned at full price in the next session. |
| "The check probably passes" | Report executed checks with outcomes; a pending check stays pending. |

## Red Flags

- The same task registered in both the active and completed-work
  registries.
- A handoff that restarts from conversation memory instead of records.
- A completion summary with no commit sha or evidence path.
- An item removed from the active registry with no archive record or
  reason.
- A report newer than its index row — silent drift in the reports index.
- Orphan sidecar files after a plan archive move.
- Memory entries claiming work the project never recorded, left
  unreconciled.

## Verification

- [ ] Completed work moved out of the active registry into the completed
      registry — never both, never dropped.
- [ ] Entry carries date, objective, result and commit sha where it
      applies.
- [ ] Executed checks are reported with outcomes; pending checks stay
      pending.
- [ ] Foreign/unrelated changes are reported, not absorbed.
- [ ] The handoff record was saved in the configured workspace with all
      six fields (COMPLETED/ACTIVE/BLOCKERS/CHECKS/CHANGES/ASSUMPTIONS).
- [ ] Learnings worth keeping reached the lessons log via `memory add`.
