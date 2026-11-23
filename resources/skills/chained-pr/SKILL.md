---
name: chained-pr
description: Use when a change forecasts more than ~400 authored lines or the owner asks for stacked/chained PRs; selects a bounded delivery-slice strategy.
---
# Chained PR / Delivery Slices

Delivery strategy for organic or formal work whose authored line count
forecasts beyond the reviewable-slice budget (~400 additions + deletions).
Splitting happens once, at plan time — not by retroactive branch surgery.

Small, focused changes are easier to review, faster to merge and safer to
revert. The budget exists because review quality collapses with diff size:
a reviewer holds ~100 lines comfortably, ~300 acceptably for one logical
change, and anything toward ~1000+ is where defects hide. The ~400 authored
line ceiling (additions + deletions; generated artifacts excluded from the
count) is the harness's reviewable-slice budget — see `work-unit-commits`.

**Scope boundary.** This skill owns *delivery* mechanics: forecasting,
strategy selection, slice contracts and the stacking/rebase chain. The
implement→verify→commit cycle *inside* each slice is
`incremental-implementation` — its vertical/contract-first/risk-first
slicing patterns are the ordering vocabulary below, applied at PR
granularity.

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

**Forecasting:** estimate authored additions + deletions per work unit at
plan time. Generated artifacts (lockfiles, codegen output, vendored code)
stay in the diff but not in the authored count. When the forecast is
uncertain, round up — an unnecessary chain degrades gracefully into small
PRs; an unplanned oversized PR does not degrade into anything reviewable.

## Slice anatomy

Each slice is a written contract before it is code. Per slice, record:

- **Deliverable unit** — one work unit that stands alone (never a
  horizontal layer like "all the tests" or "all the models").
- **Start state / end state** — what the tree does before and after.
- **Dependencies** — which earlier slices it builds on; a slice with no
  dependencies on in-flight work can proceed in parallel.
- **Follow-ups** — work explicitly deferred to later slices.
- **Out-of-scope** — adjacent items noticed but deliberately untouched.
- **Verification** — the scoped checks this slice must pass on its own.

Tests and docs travel with the unit they verify or explain — same slice,
same commit set (see `work-unit-commits`).

## Ordering strategies

Choose the ordering once, at plan time; port from `incremental-implementation`:

- **Vertical slices (default):** each PR delivers a complete, working
  behavior across all layers it touches.
- **Contract-first:** slice 0 fixes the interface/schema; parallel slices
  implement each side against it; a final slice integrates.
- **Risk-first:** the riskiest or least certain mechanism lands first so a
  failure is discovered before the rest is invested.
- **By concern/file group:** only when slices need different reviewers —
  never as an excuse to split one logical unit arbitrarily.

## Slice rules

- One deliverable work unit per slice; tests and docs travel with the unit.
- Each slice states: start state, end state, dependencies on earlier
  slices, follow-up work and out-of-scope items.
- Each slice must verify independently and roll back without reverting
  unrelated work.
- Polluted diffs are a defect: retarget or rebase until only the current
  unit appears; never widen a slice to hide contamination.
- Never mix strategies once chosen.
- Keep each slice green: the project builds and its declared checks pass
  after every slice, not only at the end of the chain.
- Incomplete-but-merged work rides behind a feature flag or safe default —
  a merged slice is deployable even though the feature is unfinished.
- Refactors and behavior changes are different slices — never one PR
  wearing two hats.

## Stacking mechanics

When slices depend on each other, run them as a chain:

1. Slice 1 branches from the base branch. Slice 2 branches from slice 1's
   branch — its diff contains only unit 2 because its base is slice 1.
2. Keep the chain shallow and ordered; review bottom-up.
3. When slice N merges, retarget slice N+1's PR onto the base branch and
   rebase so the diff again contains only its own unit.
4. If a slice is reworked after review, propagate the change down the
   chain deliberately — rebase each descendant, re-verify each.
5. Land in order unless a later slice is provably independent; merging out
   of order is what creates the polluted-diff defect above.
6. Never let a slice absorb the next slice's work to "save a rebase" —
  scope discipline applies to PRs the same as commits.

## Authority boundaries

- This skill plans slices only. Creating branches/PRs, pushing, merging or
  publishing are separate owner-authorized actions (`gitPush: ask`).
- A recorded strategy is a delivery plan, not a merge authorization.
- Formal SDD work applies the same budget: slice boundaries belong in the
  design document when forecast exceeds it.
- `exception-ok` is a documented owner decision with rationale — not a
  default, not retroactive cover for a diff that grew unplanned.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "I'll split it after it's written" | Retroactive splitting is branch surgery; plan-time slicing is cheap. |
| "One big PR is faster to review once" | Reviewers skim large diffs; defects hide in the middle thousand lines. |
| "The chain adds rebase overhead" | The rebase tax is small next to a reverted mega-PR or a missed defect. |
| "This refactor fits inside the feature PR" | Two hats, two PRs — mixed diffs defeat per-slice review. |
| "Generated files blow the count" | Generated artifacts ride along but do not count as authored lines. |
| "Asking once per slice keeps the owner informed" | Re-asking is noise; record the strategy once, report progress per slice. |

## Red flags

- A forecast above the budget with no recorded strategy.
- Slice boundaries drawn by file type instead of deliverable units.
- A slice that cannot verify or revert independently.
- A PR diff containing another slice's work — retarget, never widen.
- Out-of-order merges on a dependent chain.
- Strategy changed mid-flight ("just this once I'll batch two units").
- `exception-ok` claimed after the fact rather than decided up front.
- Tests/docs shipped in a separate trailing slice from the unit they cover.

## Output contract

A chained delivery produces:

- The recorded strategy (`single-pr` / `ask-on-risk` / `auto-chain` /
  `exception-ok`) chosen once, before the first PR.
- A written slice contract per PR: unit, start/end state, dependencies,
  follow-ups, out-of-scope, scoped verification.
- Per-slice evidence: independent check results and a diff containing
  only its own unit.
- For `exception-ok`, the owner's documented rationale — decided up front.

## Verification

Before the chain is declared delivered:

- [ ] The strategy and slice boundaries were recorded before the first PR.
- [ ] Every slice states start/end state, dependencies, follow-ups and
      out-of-scope items.
- [ ] Every slice verified independently with its scoped checks.
- [ ] Every slice's diff contains only its own unit (no contamination).
- [ ] Risk-named units were isolated, not batched with ordinary work.
- [ ] Merges happened in dependency order; each landed green.
- [ ] The full feature verifies end-to-end after the last slice lands.
- [ ] Any `exception-ok` carries the owner's documented rationale.

## See also

- `incremental-implementation` — the implement→verify→commit cycle inside
  each slice; source of the ordering strategies.
- `work-unit-commits` — the reviewable-slice budget (~400 authored lines)
  and what belongs in each commit.
- `spec-driven-development` — slice boundaries live in the design document
  for formal work.
- `deprecation-and-migration` — migrations often need `exception-ok` or a
  carefully ordered chain.
