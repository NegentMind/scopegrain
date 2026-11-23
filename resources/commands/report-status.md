---
name: report-status
description: Report actual progress, verification gaps and the next decision.
---
# Report Status

Read-only dashboard of at most ~30 lines. If a state file or section is
absent, omit it — graceful degradation, no error output. Load
`session-handoff` only if the session-start packet did not already run.
Load `context-engineering` for the ~30-line budget; run as `lead`.
Governing rule: `rules/evidence`.

Continuation and checkpoint records follow `prompts/session-recitation`;
guided next-action choices use `prompts/decision-request`.

## 1. Repository state

- Uncommitted changes, recent commits and current branch via the host's
  git tools (`git status --short`, `git log --oneline -5`,
  `git branch --show-current` where a shell is authorized).

## 2. Active work

- Resumable sessions and checkpoint state in the configured state path
  (`session-recitation` continuation format); if an in-progress task is
  recorded, name it and the resume point.
- Newest plan under the configured plans path: counts by state (closed /
  active / ready / blocked / failed) and the next-ready task.
- Task records under the configured tasks path (`references/task-system`
  semantics): separate completed, active, blocked, failed, unexecuted and
  unknown work. Do not infer execution, publication or pull-request
  lifecycle from a prose summary.

## 3. Latest verification

- The recorded last-verification state or the newest report under the
  configured reports path: mode, date, verdict and open critical
  findings.
- A passing subset is not a passing full suite; a proposed command is
  not an executed check.

## 4. Latest release assessment

- Recorded ship state or newest ship report: GO/NO-GO, assessed revision,
  whether a rollback plan exists and where it lives.

## 5. Specification coverage

- Whether a settled specification exists for in-flight substantial work;
  if absent, note `specify-change`.

## 6. Recommended next step

One line, evidence-based:

| Situation | Recommend |
|---|---|
| Uncommitted changes | `implement-task` or commit the recorded unit |
| Plan with ready tasks | `coordinate-plan` |
| Latest verification failed | `verify-work`, then `review-change` |
| All green, spec missing | `specify-change` |
| GO with no rollback plan | prepare recovery evidence before continuing |
| Unresolved NO-GO | read the ship report before new work |

## Guided interaction

When invoked interactively (no task context), explain the current stage,
surface conflicting priorities and ask which consequential next action
the owner wants (`prompts/decision-request` format — concrete options,
recommendation first). Do not choose or execute it implicitly.

## Authority and verification

Purely advisory and read-only: report, do not act. Status claims come
from records, not inference — a prose summary is not an executed check,
a publication or a merged pull request.

## Output contract

- A dashboard of at most ~30 lines returned to the owner.
- Any saved copy is an explicit harness artifact under the configured
  reports path.

## Red flags

- Emitting errors for absent state files — omit the section instead.
- Exceeding ~30 lines; this is a glance, not an audit.
- Treating a passing subset, a proposed command or a prose claim as a
  passing suite.

## Handoff

Terminal command — the dashboard names the next gate; it never executes
it.
