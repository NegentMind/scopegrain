---
name: review-request
description: Supply an independent reviewer with the contract and actual evidence, and orchestrate phased audits.
---
# Review Request

Two uses: (a) brief an independent reviewer on a bounded change; (b) run a
phased audit pipeline over an agreed project surface. Loaded when a command
or orchestrator briefs a reviewer (`review-change`, `implement-task`,
`simplify-code`) or runs a phased audit (`audit-project`, `verify-work`
modes). Both return severity-ordered findings with locations; neither edits
the change under review nor fabricates a passing receipt.

## Required slots (change review)

Required slots: approved behavior and scope; complete diff location;
changed boundaries/callers; exact tests and raw logs; known gaps; prior
findings already resolved; reviewer independence and allowed tools.

Ask for confirmed defects, regressions, security/compatibility risks and
missing acceptance coverage, ordered by severity with locations.
Require separation of evidence, hypothesis and unavailable checks.
Do not give the author a second role name and call that independent review.
Read-only reviewers return findings; the lead persists reports.
Approval or waiver must follow actual review, never an invented receipt.
Verdict vocabulary follows `policy/workflow.json`:
`approve | reject | changes-requested` — only `approve` satisfies the
acceptance gate.

## Audit pipeline (phased review of a surface)

Execute ONE mode at a time; the mode selects the phases. Each review phase
may run in a fresh delegated context that returns structured findings —
delegate only through an actually available authorized host capability;
otherwise run phases sequentially in-session.

| Mode | Phases | Use |
|---|---|---|
| quick | 1 | mechanical checks only |
| certify | 0→1→2→3→4→8 | pre-merge/pre-push gate |
| review | 0→4→5→6→7 | deep review without CLI checks |
| full | 0→1→2→3→4→5→6→7→8 | complete pipeline |

### Phase 0 — Pre-check (direct)

Inspect the working tree (`git diff --name-only`, `git status`). No changes →
suggest the full mode. Unstaged changes → continue. Staged changes → suggest
certify. Record `{hasChanges, staged, unstaged, branch}`.

### Phase 1 — Mechanical checks (direct)

Run the project's declared check suite for the mode — under manual
verification, propose the exact commands and working directories; the owner
executes and returns output; record actual results, never self-report.
Capture outputs and count failures.

**If the formatter or the test suite fails → ABORT.** Do not proceed to
Phase 2. Record `{passed, failed, results per check}`.

### Phase 2 — Security review (delegated or in-session)

Skill `security-and-hardening`. Input: dependency-audit output from Phase 1
plus the project's declared threat/advisory policy. Review input validation,
unsafe/panic paths on public surfaces, trust boundaries, secret exposure.
Deliverable: findings `[{file, line, severity, description, recommendation}]`.
A phase may VETO with reason — record the veto; it does not abort the pipeline
(only Phase 1 aborts).

### Phase 3 — Performance review

Skill `performance-optimization`. Input: size/profile output from Phase 1.
Review declared hot paths, unnecessary allocation/cloning, large variants.
Same findings shape; may VETO with reason.

### Phase 4 — Code review

Skills `code-review-and-quality` plus `code-simplification` (over-engineering:
YAGNI violations, needless abstractions, reimplemented stdlib). Input:
the change diff or recent commits. Axes: correctness, security, performance,
maintainability, consistency. Each capability may VETO independently.

### Phase 5 — Root-cause analysis (conditional)

Only if Phases 1-4 produced failures. Skill `systematic-debugging`. For each
failure: identify root cause (not symptom), propose a specific fix with
file:line, estimate effort. Deliverable:
`[{failure, rootCause, fix, estimatedEffort}]`.

### Phase 6 — Deep module review (review/full only)

Skill `review-deep`. Iterate per agreed module: structural investigation,
comparison against alternatives, score 0-10 with evidence. Deliverable:
`[{module, score, issues, recommendations}]`.

### Phase 7 — Quality-model review (full only)

Skill `unified-review`. Apply the agreed quality model (e.g., ISO 25010:
functional suitability, reliability, usability, efficiency, maintainability,
portability). Cross-reference all prior findings; score each dimension with
evidence — never invented scores.

### Phase 8 — Certification gate (certify/full only)

Run the project's declared heavyweight certification suite (propose commands;
owner executes under manual verification), then re-check with
`unified-review` in certify posture: all prior-phase findings resolved or
waived, no blocking issue open. Return PASS/FAIL with evidence.

## Parallel waves

- Wave 1: Phase 0 + Phase 1 (mechanical checks gate the rest)
- Wave 2: Phase 2 + 3 + 4 (mutually independent)
- Wave 3: Phase 5 (depends on Wave-2 failures)
- Wave 4: Phase 6 + 7 (independent of each other)
- Wave 5: Phase 8

## Report

Write the report under the configured reports path (`.scopegrain/reports`),
ISO-8601 timestamped, covering ALL phases regardless of pass/fail:

```markdown
# Audit Report: <mode>
**Date:** <timestamp>  **Mode:** <mode>  **Duration:** <elapsed>

## Summary
- Phases completed: X/Y · Blocking issues: N · Recommendations: N
- Verdict: PASS / FAIL

## Per-phase results
| Phase | Status | Wave | Details |
| 0..8  | pass/fail/skipped/subagent-error | direct/delegated | N findings |

## Findings by phase
- `file:line` — defect (severity)

## Scoreboard (only when a quality model ran)
| Category | Score (0-10) | Evidence |

## Recommendations (prioritized)
1. (severity) `file:line` — action
```

## Post-report

- review/full: register unresolved findings as finding records per
  `finding-record` — at discovery time, not deferred to notes.
- certify: all phases pass → "CERTIFY PASSED — safe to push" (the push itself
  still requires explicit owner authorization); any failure → "CERTIFY FAILED".
- Finish with the `session-handoff` skill for status recording.

## Rules

- **Phase-1 failure = STOP.** Never proceed on a red formatter/test suite.
- **Delegate limits:** bounded tool calls and a declared timeout per delegated
  context (per `policy/operation-limits.json` or the runtime's budgets). A
  timed-out/error delegate is recorded as `SUBAGENT_ERROR`; continue the
  remaining phases.
- **Vetoes are recorded**, not silently overridden.
- **Findings ≠ fixes:** this pipeline reports; corrections are separate tasks.
- **No invented evidence:** a check not executed is reported as unavailable,
  not as passed.
