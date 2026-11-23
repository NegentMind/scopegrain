---
name: simplify-code
description: Simplify demonstrated complexity while preserving observable behavior.
---
# Simplify Code

Invoke `code-simplification` and `test-driven-development` (the
characterization tests below). Simplify recently changed code — or the
explicitly passed scope — while preserving exact behavior. Brief the
closing reviewer with `prompts/review-request`. Governing rules:
`rules/api-contract`, `rules/review`. Roles: `implementer` simplifies,
`reviewer` checks.

## Procedure

1. Read the project instructions and conventions; inspect the target,
   callers, contracts and existing tests before touching anything.
2. Identify the target code — recent changes unless a broader scope was
   authorized. Do not expand scope into an aesthetic rewrite, and do not
   delete apparently unused code without checking external, generated
   and dynamic consumers.
3. Agree scope and acceptance; add missing behavioral characterization
   (a characterization test) before changing code where coverage is thin
   (`references/testing-patterns`).
4. Scan for simplification opportunities
   (`references/clean-code-clean-architecture`):
   - Deep nesting → guard clauses or extracted helpers.
   - Long functions → split by responsibility.
   - Nested ternaries → if/else or switch/match.
   - Generic names → descriptive names.
   - Duplicated logic → shared functions.
   - Dead code → remove only after confirming zero consumers.
5. Apply each simplification incrementally — run the project's recorded
   narrow checks after each change (proposed until authorized; manual
   verification by default). If a check fails after a simplification,
   revert that change and reconsider.
6. Verify all authorized checks pass and inspect the complete diff.

## Authority and verification

Each change is verified incrementally by the project's recorded checks —
proposed to the owner under manual verification, never self-reported
green. Scope stays at what was agreed: no aesthetic rewrites, no bundled
cleanup, no publication.

## Output contract

- The complete inspected diff plus the executed check evidence.
- A review record where the risk required it (`code-review-and-quality`,
  briefed via `prompts/review-request`); verified effects and remaining
  gaps stated plainly.

## Red flags — do NOT simplify

- Performance-critical hot paths — measurement drives those decisions,
  not style (`performance-optimization`).
- Security-sensitive validation — redundancy is defense-in-depth.
- Public API signatures — breaking changes need deprecation cycles
  (`deprecation-and-migration`).
- Unsafe/FFI boundaries — change one, audit them all.
- Generated code — re-generate instead.

## Handoff

Upstream: `implement-task` produces the code this command simplifies;
for a defect found mid-simplification, a reproducing check precedes the
fix, and unrelated defects register per `prompts/finding-record`. Do not
claim faster execution without measurement.
