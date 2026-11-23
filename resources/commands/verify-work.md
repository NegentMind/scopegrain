---
name: verify-work
description: Execute or prescribe scoped verification and preserve raw evidence.
---
# Verify Work

Router over `unified-review` — load that skill and run its flow for the
selected mode; this file owns only mode selection and the output
contract. If the owner passes a named project profile, use it.
Role: `verification-engineer`. Governing rule: `rules/evidence`.

Findings register per `prompts/finding-record`; the verification outcome
lands in the continuation/state record per `prompts/session-recitation`.

## Modes

| Invocation | `unified-review` mode | Use |
|---|---|---|
| `verify-work` / `verify-work quick` | quick | Narrow mechanical gate over the changed surface |
| `verify-work certify` | certify | Pre-merge/pre-push gate: sequential, hard stop at first failure |

## Execution

1. Discover actual acceptance criteria, the project's recorded
   verification commands, supported environments and the applicable
   permission to run checks. **Never hardcode a stack** — use the
   commands recorded for this project (`references/build-system`,
   `references/test-suite`, `references/testing-patterns`); unknown
   stacks stay unknown. The quality floor (`references/quality-floor`)
   defines what a gate may never skip.
2. Scope: if the working diff is empty, use the last commit's diff as the
   review scope and say so.
3. Verification is manual by default: propose exact commands and working
   directories, then record actual output. If execution is reserved for
   the owner, hand over the exact commands and await the complete output.
   A proposed command is never reported as a passing check.
4. **quick:** the smallest adequate check set for the changed surface —
   the recorded format/lint/test/policy checks that actually apply.
5. **certify:** the agreed integration gate, sequential, hard stop at the
   first failure ("FAILED at <gate> — aborting" / "CERTIFY PASSED —
   safe to push"). Covers compatibility boundaries; neither mode changes
   the quality floor or authorizes installations or services.

## Authority and verification

This command executes or prescribes checks — it does not fix the
product, approve a release or claim independent review. Manual
verification by default; a passing certify still requires explicit owner
authorization for the push itself.

## Output contract (mandatory, post-execution)

1. **Report:** `<reports path>/verify-<mode>-<YYYYMMDD>-<HHMMSS>.md`
   (zero-padded) with a scoreboard per gate, prioritized findings
   (Critical/Important/Suggestion with file:line and a concrete fix),
   and the verdict.
2. **State:** a last-verification record in the configured state path:
   `{timestamp, mode, verdict: PASS|FAIL, findings_critical, report_file}`,
   plus the continuation update per `session-recitation`.
3. **Index:** a row in the reports index; mark any superseded earlier
   report of the same mode.
4. **Backlog:** each finding ≥ medium registers per
   `prompts/finding-record` — `source` names this report, schema per
   `references/backlog-format`, deduplicated against existing items.

## Final message

- PASS: `VERIFICATION PASSED (<mode>)` + findings summary.
- FAIL: `VERIFICATION FAILED — fix the errors above before shipping.`

## Red flags

- A proposed or partially-run check reported as passing.
- A hardcoded stack command instead of the project's recorded ones.
- certify continued past the first failure.
- The quality floor weakened to make a run pass.

## Handoff

Deep logic review belongs to `review-change`; full-surface audit belongs
to `audit-project`. Findings flow to `implement-task`; release readiness
is `assess-release`.
