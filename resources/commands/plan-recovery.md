---
name: plan-recovery
description: Prepare a recovery plan from observed state without applying it.
---
# Plan Recovery

Load `shipping-and-launch` (rollback section) and
`debugging-and-error-recovery` with `references/ship-runbook`; structure
resume context with `prompts/recovery-brief` and continuation records
with `prompts/session-recitation`. This command prepares a plan only —
execution, deletion and external rollback require separate
action-specific authorization. Owner confirmations for permission-class
and irreversible steps use `prompts/decision-request`. Governing rules:
`rules/durability`, `rules/human-decisions`.

Prerequisite: a prior `assess-release` ship record (fallback: git
history and release receipts in the state path).

## Step 1 — Discover

- Identify the incident, the desired safe state, the actual completed
  effects and the available receipts/backups. Read the recorded ship
  state and the ship report's rollback plan — **the exact plan recorded
  for that ship overrides any generic procedure.** A wide or uncertain
  effect surface may be delegated read-only to `resilience-tester` under
  `release-engineer` coordination.
- Do not infer external state from local progress: inspect which data,
  registries, deployments or notifications a source revert would not
  undo.

## Step 2 — Preconditions

- Confirm each step's prerequisites and the permission class it needs
  (local revert, registry action, data operation, external service).
- Flag irreversible operations — data loss, destructive migrations,
  published immutable artifacts: these abort with a warning unless the
  owner explicitly confirms that specific operation
  (`prompts/decision-request`).
- Never delete a stale lock or restore over existing content merely
  because its age looks suspicious; reconcile uncertain effects before
  retrying.

## Step 3 — Propose the revert plan

Bounded steps in safe order: each with the exact action, expected
effect, verification check, and abort condition. Preserve backups of
anything being overwritten. Mark the steps needing explicit permission.

## Step 4 — Finalize contract

- Present exact destinations and consequences for approval.
- On approval-less failure inside a later execution: stop immediately
  and report done-vs-pending — never improvise past a failed revert
  step.
- Record the plan under the configured reports path
  (`<reports path>/rollback-<YYYYMMDD>-<HHMMSS>.md`) so a later
  authorized execution and `report-status` can pick it up; record the
  continuation state per `prompts/session-recitation`.

## Authority and verification

Plan-only: no revert step runs inside this command. Every permission
class and every irreversible effect is named explicitly for owner
decision; observed state comes from receipts and records, never
inference.

## Output contract

- Rollback plan report: `rollback-<YYYYMMDD>-<HHMMSS>.md` under the
  configured reports path, with per-step action/effect/verify/abort.
- Continuation record enabling a later authorized execution to resume
  without re-deriving state.

## Red flags

- A stale lock deleted or content overwritten on suspicion of age.
- An irreversible step executed without that specific confirmation.
- Improvised recovery past a failed revert step — stop and report
  done-vs-pending.
- Local progress treated as proof of external state.

## Handoff

Close by handing the owner the next gate: execute the approved plan,
or `report-status` for the post-recovery dashboard.
