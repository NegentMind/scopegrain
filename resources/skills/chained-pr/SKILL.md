---
name: chained-pr
description: Use when a change forecasts more than ~400 authored lines or the owner asks for stacked/chained PRs; selects a bounded delivery-slice strategy.
---
# Chained PR / Delivery Slices

Delivery strategy for organic or formal work whose authored line count
forecasts beyond the reviewable-slice budget (~400 additions + deletions).
Splitting happens once, at plan time — not by retroactive branch surgery.

## Strategy selection (one question, once)

| Condition | Strategy |
|---|---|
| Forecast ≤ ~400 authored lines, focused | `single-pr` — one PR, no chain. |
| Forecast exceeds budget, risk-named units present | `ask-on-risk` — chain proposed; owner confirms slice boundaries. |
| Forecast exceeds budget, all units ordinary | `auto-chain` — chain proceeds under the recorded strategy. |
| Diff cannot split cleanly (generated/vendor/migration) | `exception-ok` — documented owner exception; single PR with explicit rationale. |

Ask the owner exactly once when no strategy is recorded and the budget is
exceeded; do not re-ask per slice. Record the chosen strategy and the slice
boundaries (which work units land in each PR) in the task record or plan.

## Slice rules

- One deliverable work unit per slice; tests and docs travel with the unit.
- Each slice states: start state, end state, dependencies on earlier
  slices, follow-up work and out-of-scope items.
- Each slice must verify independently and roll back without reverting
  unrelated work.
- Polluted diffs are a defect: retarget or rebase until only the current
  unit appears; never widen a slice to hide contamination.
- Never mix strategies once chosen.

## Authority boundaries

- This skill plans slices only. Creating branches/PRs, pushing, merging or
  publishing are separate owner-authorized actions (`gitPush: ask`).
- A recorded strategy is a delivery plan, not a merge authorization.
- Formal SDD work applies the same budget: slice boundaries belong in the
  design document when forecast exceeds it.
