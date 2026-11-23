---
name: assess-release
description: Assess release readiness without publishing or deploying.
---
# Assess Release Readiness

Load `shipping-and-launch` and follow `references/ship-runbook`.
Assessment is read-only: it produces a GO/NO-GO plus a rollback plan —
it never publishes. Owner confirmations and renewed consent on changed
inputs use `prompts/decision-request`. Governing rules:
`rules/release-ci`, `rules/licensing-and-provenance`.

## Pre-flight

`verify-work` (quick or certify) must have passed recently against the
release candidate. A failed or missing verification defaults to **NO-GO**.

## Phase A — Fan-out (evidence collection)

Dispatch three read-only assessments in parallel through the available
delegation capability (one turn; degrade to sequential if unavailable):

- `security-auditor` — security surface, secrets handling, dependency
  and license exposure of the release artifact.
- `resilience-tester` — failure modes, durability, migration and
  downgrade risk; what the release cannot undo.
- `performance-engineer` — performance evidence vs recorded baselines;
  unmeasured claims are flagged, not trusted.

Each returns findings with evidence — not a narrative summary.

## Phase B — Merge

The lead (`release-engineer`) synthesizes the three reports (synthesis
lives in the main context, not a persona): deduplicate blockers, resolve
contradictions, mark unverified items explicitly.

Check the release prerequisites against `references/definition-of-done`:

- Verification evidence covers the candidate revision — an unexecuted
  publish cannot be marked verified.
- Independent review exists for named risks or an explicit owner waiver.
- Compatibility and provenance prerequisites are evidenced.
- Configuration/secrets prerequisites are confirmed **without disclosing
  secret values** — presence and non-emptiness, never contents.
- Distinguish evidence of authentication (an identity check) from
  evidence of publication scope (a real accepted publish). A successful
  test is not an approved release; a prepared branch is not a merged
  pull request.

## Phase C — Decide

Return **GO**, **NO-GO** or **blocked** with reasons, remaining
authorized steps and a **mandatory rollback plan**: exact revert
actions, irreversible effects (data, registries, deployments that a
source revert would not undo), and verification after rollback. Executing
a GO requires a separate explicit owner decision (`decision-request`) —
a GO verdict is an assessment, not an authorization.

## Authority and verification

Read-only assessment. Do not push, tag, publish, deploy, send
notifications or change production. Delegation runs through actually
available authorized capabilities; every prerequisite cites inspected
evidence, not intent.

## Output contract

- Report: `<reports path>/ship-<YYYYMMDD>-<HHMMSS>.md` + index row.
- State: a last-ship record in the configured state path
  `{timestamp, verdict, revision, rollback_plan}` — required by
  `plan-recovery` and `report-status`.

## Red flags

- GO on top of a missing or failed `verify-work` run.
- Secret contents surfaced instead of presence/non-emptiness.
- Authentication evidence presented as publication-scope evidence.
- A missing rollback plan — the decision is incomplete without it.

## Handoff

GO hands the owner the release decision; execution is a separate
explicitly authorized action. A failed or compromised release goes to
`plan-recovery`; post-decision state is visible in `report-status`.
