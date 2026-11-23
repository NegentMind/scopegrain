---
name: compare-options
description: Compare existing evidence and recommend an explicit owner decision.
---
# Compare Options

Global decision room over completed research — the synthesis step after
per-area `investigate` runs. Load `source-driven-development`,
`discernment-nudge`, `outcome-driven-development`,
`doubt-driven-development`, `resolve-ambiguity` as needed. Decisions use
`prompts/decision-request`; the round mechanics and materialization
follow `prompts/research-brief` §C. Governing rules: `rules/evidence`,
`rules/human-decisions`. Roles: `researcher` consolidates, `lead`
materializes decisions.

## Step 1 — Gather evidence

- Read every research report under the configured research path plus
  the actual decision constraints (budget, compatibility, deadlines,
  recorded owner preferences).
- Preserve frozen measurements and inputs; do not rerun derivations
  merely to format or rank their results. Investigate a genuinely new
  gap as a separate `investigate` action, not inside synthesis.
- Collect the H-NN finding appendices of all reports; merge duplicates
  and cross-area findings into one canonical list with their origins
  (area semantics: `references/research-modules`).

## Step 2 — Compare

Compare viable alternatives across: failure modes, reversibility,
maintenance cost, privacy, required permissions and supported
environments. State uncertain assumptions and name the evidence that
could change the recommendation. Do not invent scores, costs, licensing
clearance or superiority.

## Step 3 — Decide (HITL)

Round mechanics — the consolidated master table, themed question rounds,
the >25-item pre-selection and the cut rule — follow `research-brief` §C.

- Present the recommendation with complete consequences and ask the
  owner to decide wherever authority or product intent is required —
  one decision round per theme, concrete options, recommendation first.
- Record each decision bound to the reviewed inputs (report identity +
  finding ids) in the configured decisions path; a recommendation alone
  does not authorize execution.
- Materialize decisions exactly like the per-area flow: approved actions
  → backlog items with `source` naming this synthesis; discarded →
  wontfix record; quick wins → a plan under the plans path; strategy →
  decision record + suggested ADR (`documentation-and-adrs`).
- No finding may remain destination-less; sweep leftovers into a final
  question or a recorded explicit default.
- Record a journal event (`compare-options.completed`) with the decision
  counts.

## Authority and verification

Synthesis is read-only: it produces recorded owner decisions and
materialized destinations — it executes nothing. Frozen inputs stay
frozen; a recommendation is evidence-bound and never silently executes.

## Output contract

- Per-theme decision records in the configured decisions path, each bound
  to reviewed inputs.
- Materialized destinations: backlog items, wontfix records, a quick-wins
  plan or ADR suggestions.
- Journal event with the decision counts.

## Red flags

- Scores, costs or licensing clearance invented to rank options.
- New investigation smuggled into synthesis — open a separate
  `investigate` run.
- Findings left destination-less after the rounds.
- Execution begun on a recommendation the owner never confirmed.

## Handoff

Report per-theme decisions, their destinations and the next gate:
`coordinate-plan` for approved work, `implement-task` for a single item,
or `assess-release` when the decision gates a release.
