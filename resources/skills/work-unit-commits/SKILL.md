---
name: work-unit-commits
description: Use when splitting authorized implementation into reviewable commits, keeping tests and docs with the unit they verify, or deciding what belongs in each commit.
---
# Work-Unit Commits

A commit is a reviewable work unit when the task authorizes commits. Local
commits are part of implementation evidence; push, PR, merge and release
remain separate owner decisions.

## Rules

- One commit = one deliverable work unit (behavior, fix, migration or docs
  unit that stands alone). Never split by file type (`models`, then
  `services`, then `tests`) when none works alone.
- Keep tests and docs in the same commit as the unit they verify or explain.
- Use Conventional Commit messages that explain the outcome, not the file
  list.
- A unit carrying named risk (security, data-integrity, public-contract,
  concurrency, delivery, external-effects, verification-gap) gets its own
  commit — never batched with ordinary work.
- Size: aim for slices a reviewer can hold (~400 authored lines as the
  advisory ceiling). Count authored additions plus deletions; generated
  artifacts stay in the commit but not in the authored count. Larger
  forecasts belong to the `chained-pr` delivery strategy.
- The repository must still make sense after applying only that commit;
  rollback removes the unit without touching unrelated work.

## Checklist per commit

- [ ] Single clear purpose, reviewable from diff + message alone.
- [ ] Tests/docs included with the unit they verify or explain.
- [ ] Risk-named units isolated in their own commit.
- [ ] Commit identity (sha) recorded in the task evidence or worklog.
- [ ] No unrelated or pre-existing user changes staged into the commit.

## Boundaries

- Commit authorization comes from the task/owner; the harness observes
  commits for evidence but never pushes implicitly.
- The review candidate is the work-unit commit (or the PR slice it belongs
  to), never the accumulated feature branch.
- A commit does not authorize the next work unit, publication or merge.
