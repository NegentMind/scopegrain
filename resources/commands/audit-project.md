---
name: audit-project
description: Assess an agreed project surface and report evidence-based risks.
---
# Audit a Project

Router over `unified-review` (full mode) — load that skill and run its
complete pipeline; this file owns the scope agreement and the output
contract. A heavier, deeper pass than `verify-work`: full surfaces with
prioritized findings, not only the changed diff.

The phased audit pipeline — phases, waves, per-phase deliverables,
veto handling and the report format — lives in `prompts/review-request`
§Audit pipeline. Load `review-deep` and `security-and-hardening` for the
module-review and security phases. Findings register per
`prompts/finding-record`. Governing rules: `rules/safety`,
`rules/evidence`.

## Step 1 — Agree scope

- Agree with the owner: surfaces (modules, crates, packages, services),
  relevant risk categories, environments, permitted checks and the
  report destination. Default scope: the whole project.
- Confirm which recorded verification commands may run and which
  surfaces are inspection-only. If execution is owner-reserved, propose
  exact commands and record actual output.
- Read `references/quality-floor` and `references/security-checklist`
  before assessing; the floor is not weakened to make a run pass.

## Step 2 — Execute the full pipeline

Run the pipeline phases per `prompts/review-request` §Audit pipeline —
phase set, wave grouping and per-phase findings shape come from there.
Typical surfaces:

1. Mechanical gates — the project's recorded format/lint/type/test/
   policy checks (`references/test-suite`; never hardcode a stack).
2. Boundary and dependency inspection — entrypoints, layer direction,
   external contracts (`references/architecture`, delegated `architect`).
3. Security surface — trust boundaries, secret handling, unsafe/FFI
   blocks, dependency policy (`security-and-hardening`, delegated
   `security-auditor`).
4. Test adequacy — missing regression coverage for named risks.
5. Documentation drift — public behavior vs documented behavior.

Sample explicitly when exhaustive inspection is infeasible; name every
omission.

## Step 3 — Classify findings

Separate reproduced defects, static findings, hypotheses and unavailable
evidence. For each issue provide location, prerequisites, impact and a
discriminating check or regression case. Use qualitative FMEA unless
probabilities and scoring were independently justified and approved.

## Authority and verification

Read-only against the product: the audit does not modify code, install
scanners, scan external systems or publish security details. Every claim
carries evidence; an unavailable check is reported as unavailable, not
passed. Delegated phases run only through actually available authorized
capabilities — `SUBAGENT_ERROR` is recorded, not hidden.

## Output contract (mandatory)

1. **Report:** `<reports path>/audit-full-<YYYYMMDD>-<HHMMSS>.md` with a
   scoreboard per phase, prioritized findings (Critical/Important/
   Suggestion, file:line + fix), a strengths/weaknesses summary and the
   verdict.
2. **State:** a last-audit record in the configured state path:
   `{timestamp, mode: full, verdict, findings_critical, report_file}`.
3. **Index:** a row in the reports index; mark superseded earlier audits.
4. **Backlog:** each finding ≥ medium registers per
   `prompts/finding-record` — `source` names this report, schema per
   `references/backlog-format`, deduplicated against existing items.

## Final message

- `AUDIT PASSED (full)` + findings summary, or
- `AUDIT FAILED — fix the findings above before shipping.`

## Red flags

- A phase silently skipped or its veto overridden instead of recorded.
- Hypotheses scored as reproduced defects; invented quality scores.
- The quality floor weakened to make a run pass.
- Corrections applied inside the audit — the lead records the report in
  the approved harness workspace; fixes are separate tasks.

## Handoff

Findings flow to `implement-task` through the backlog; bulk triage goes
through `plan-work`; release readiness assessment is `assess-release`.
