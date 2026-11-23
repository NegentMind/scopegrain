---
name: analyze-structure
description: Analyze structural impact with available graph and source evidence.
---
# Analyze Structure

Structural/semantic audit: architecture, coupling, dead code, complexity,
change impact, public API, unsafe/FFI boundaries, documentation drift.
Read-only — findings are fixed via backlog items and `implement-task`.
Load `context-engineering` for context budgeting on whole-workspace
sweeps. Governing rules: `rules/evidence`, `rules/api-contract`.

Scope argument (optional): a module/crate name, a directory, or nothing =
whole workspace. Pass the scope to every query below.

This command complements, never replaces: `verify-work` (mechanical
gate), `audit-web-performance` (web perf) and `architect` (design
decisions). A `--apply`-style flag does nothing: application is a
separate task.

## Phase 0 — Sanity (before auditing)

1. Define the question and inspect actual graph-tool availability, index
   scope and freshness (`references/graph-investigation`). Re-index or
   install nothing without separate permission — state the weaker
   guarantee and fall back to source search + caller inspection.
2. Confirm coverage of the target scope; where the index reports partial
   or skipped files, search those files directly before claiming an
   absence.
3. Capture the working diff for the impact phase; if it is empty, use
   the last commit's diff as the scope and say so.

## Audit phases (run in order; record file:line + evidence per finding)

| # | Phase | Method | Typical action |
|---|-------|--------|----------------|
| 1 | Architecture and layers | Map de-facto module clusters vs declared boundaries (`references/architecture`); detect cycles; read suspicious cluster source | FIX / REFACTOR |
| 2 | Inter-module coupling | Dependency edges between modules; god-modules with excess inbound edges; real vs transitive deps | REFACTOR / INVESTIGATE |
| 3 | Dead code / orphans | Symbols with no inbound edges; confirm not public API, test-only or dynamically registered before flagging | REFACTOR / INVESTIGATE |
| 4 | Semantic duplication | Conceptually identical implementations across domains; compare signatures | REFACTOR / INVESTIGATE |
| 5 | Complexity hotspots | Deep nested loops, scans-in-loops, allocations-in-loops, unguarded recursion, high cyclomatic complexity | OPTIMIZE (requires a benchmark before claiming gains) / REFACTOR |
| 6 | Public API / breaking surface | Exported surface per module; external callers incl. bindings/FFI consumers; contrast with the project's recorded API-compat gate | MODIFY / FIX / INVESTIGATE |
| 7 | Change impact radius | What the captured diff touches: inbound callers of changed symbols; read impacted source | INVESTIGATE / FIX |
| 8 | Unsafe / FFI boundaries | Unsafe blocks, FFI exports/imports (where the stack has them); each needs a documented safety invariant and its recorded test | FIX / INVESTIGATE |
| 9 | Fragility | Panic/unwrap/todo-style unguarded-failure patterns; check recoverability and logging context | FIX / MODIFY |
| 10 | Test coverage gaps | Production symbols never referenced by tests | MODIFY / INVESTIGATE |
| 11 | Documentation drift | Documented API/behavior vs current signatures and behavior | MODIFY |
| 12 | Decision records | Architecture decisions recorded vs architecture actually present; propose ADRs for gaps | INVESTIGATE |

Rules per finding: a missing static caller is **not** proof of dead code
(dynamic registration, generated code, external consumers). Distinguish
semantic risk from style preference. Do not invent graph symbols, index
statistics or tools.

## Final phase — Consolidate and report (output contract)

1. **Bucket every finding** into one of five actions:
   - **FIX** — bugs, broken contracts, unsafe code without a safety
     invariant.
   - **MODIFY** — API surface, docs, config, missing tests.
   - **OPTIMIZE** — hotspots (execution requires a reproducible
     benchmark first).
   - **REFACTOR** — duplication, dead code, undue coupling.
   - **INVESTIGATE** — risks, semantics to confirm, pending ADRs.
2. **Severity:** Critical / High / Medium / Low by impact + reach.
3. **Report:** `<reports path>/structure-<YYYYMMDD>-<HHMMSS>.md` —
   executive summary (counts per bucket + severity), per-phase findings
   with file:line and evidence (tool + query used), and a consolidated
   table `| ID | Title | Action | Severity | Location | Recommendation |`.
4. **Backlog:** every finding ≥ Medium registers per
   `prompts/finding-record` — `source` names this report, schema per
   `references/backlog-format`, deduplicated first.
5. **Index:** a row in the reports index.
6. **Final message:** bucket counts, report path, and
   "Run `plan-work` to triage the new findings."

## Authority and verification

Audit-only: no reindexing, installation, deletion or refactoring inside
this command — each needs its own applicable permission. Findings cite
the tool and query that produced them; an absent index means a stated
weaker guarantee, not a false absence claim.

## Red flags

- Dead code claimed without checking dynamic registration, generated
  code and external consumers.
- A phase skipped silently instead of reported as not-run.
- Graph symbols, index statistics or tools invented.
- An `--apply` flag honored — application is a separate task.

## Handoff

Registered findings flow to `plan-work` for triage; individual fixes go
through `implement-task`.
