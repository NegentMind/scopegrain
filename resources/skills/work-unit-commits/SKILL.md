---
name: work-unit-commits
description: Use when splitting authorized implementation into reviewable commits, keeping tests and docs with the unit they verify, or deciding what belongs in each commit.
---
# Work-Unit Commits

A commit is a reviewable work unit when the task authorizes commits. Local
commits are part of implementation evidence; push, PR, merge and release
remain separate owner decisions.

## When to Use

- An implementation task authorizes local commits and produces slices.
- Deciding what belongs in a commit — or whether a slice is one commit
  or several.
- Tests or docs were written and must land with the unit they cover.
- A change exceeds the reviewable budget and must be split (then see
  `chained-pr`).

Not for: message wording, branching strategy or version bumps — the
convention lives in `git-workflow-and-versioning`; this skill owns the
*cycle*.

## The Commit Cycle

Each unit follows the same loop — a commit is earned, not scheduled:

```
Implement slice → Run narrow checks → Inspect the diff → Commit → Next slice
```

- **Implement** the smallest complete unit of functionality.
- **Test** — run the checks the unit affects (or the new test it adds).
- **Inspect** — `git status` + `git diff --staged`: only the unit's files,
  no foreign changes, no secrets.
- **Commit** — save the increment with a descriptive message.
- **Carry forward** — the next slice builds on the verified state; do not
  re-run unchanged long checks by default.

If a check fails after the slice, the last commit is the save point:
revert to it, investigate, retry. You never lose more than one increment.

## Choosing the Slice Boundary

Prefer the slicing strategy that fits the work:

- **Vertical slices (default):** one complete path through the stack per
  commit (e.g. create → list → edit → delete, each end-to-end).
- **Contract-first:** when sides develop in parallel — commit the
  interface/types contract first, then implementations against it, then
  integration.
- **Risk-first:** when uncertainty is high — commit the riskiest proof
  first so failure is discovered before the dependent slices exist.

A unit carrying named risk (security, data-integrity, public-contract,
concurrency, delivery, external-effects, verification-gap) gets its own
commit — never batched with ordinary work.

## Rules

- One commit = one deliverable work unit (behavior, fix, migration or docs
  unit that stands alone). Never split by file type (`models`, then
  `services`, then `tests`) when none works alone.
- Keep tests and docs in the same commit as the unit they verify or explain.
- Use Conventional Commit messages that explain the outcome, not the file
  list (full convention in `git-workflow-and-versioning`):

  ```
  <type>[optional scope][!]: <short outcome>   # feat|fix|refactor|test|docs|chore

  <optional body: why, not what>

  BREAKING CHANGE: <what consumers must do>     # or the ! marker
  ```

  A breaking change is its own unit — never smuggled inside an ordinary
  commit.

- Size: aim for slices a reviewer can hold (~400 authored lines as the
  advisory ceiling; smaller is better). Count authored additions plus
  deletions; generated artifacts stay in the commit but not in the
  authored count. Larger forecasts belong to the `chained-pr` delivery
  strategy — split at plan time, not by branch surgery.
- The repository must still make sense after applying only that commit:
  it builds, existing tests pass, and rollback removes the unit without
  touching unrelated work.
- Keep concerns separate: no formatting mixed with behavior, no refactor
  folded into a feature, no "while I'm here" cleanups.
- Make units rollback-friendly: additive changes first; destructive and
  replacement changes in separate commits; migrations with a defined
  reverse path.

## Pre-Commit Hygiene

Before each unit lands:

```bash
git status --short     # only this unit's files staged
git diff --staged      # review the complete intended diff
# scan staged diff for secrets
# run the narrow checks this unit affects
```

Never stage changes you did not make; pre-existing foreign edits are left
alone and reported.

## Checklist per commit

Each commit produces: the sha recorded in the task evidence or worklog,
and a diff the reviewer can accept or revert without touching anything
else.

- [ ] Single clear purpose, reviewable from diff + message alone.
- [ ] Tests/docs included with the unit they verify or explain.
- [ ] Risk-named units isolated in their own commit.
- [ ] Repo builds and existing tests pass on this commit alone.
- [ ] Commit identity (sha) recorded in the task evidence or worklog.
- [ ] No unrelated or pre-existing user changes staged into the commit.
- [ ] Reverting this commit removes the unit without collateral.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll commit when the feature is done" | One giant commit is impossible to review, debug or revert. |
| "I'll split this change later" | Retroactive splitting is history surgery; the next slice boundary is the cheap place to split. |
| "Tests can ride in a later commit" | A commit without its tests is unverifiable in isolation and breaks `bisect`. |
| "It's all part of the same feature" | Same feature ≠ same unit. Reviewable units land separately. |
| "Staging foreign changes is harmless" | Absorbing someone else's work into your commit steals their history and hides scope creep. |

## Red Flags

- Hours of uncommitted work accumulating with no save point.
- A commit that cannot build or pass checks on its own.
- Tests or docs trailing in a separate "test commit".
- A breaking change inside an ordinary `fix:`/`feat:` with no `!` or
  `BREAKING CHANGE:` marker.
- Staged diff containing files the unit did not touch.
- A unit forecast far beyond the budget with no `chained-pr` strategy.

## Boundaries

- Commit authorization comes from the task/owner; the harness observes
  commits for evidence but never pushes implicitly.
- The review candidate is the work-unit commit (or the PR slice it belongs
  to), never the accumulated feature branch.
- A commit does not authorize the next work unit, publication or merge.
