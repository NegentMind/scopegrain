---
name: spec-brief
description: Guided mini-specification for feature-adds and new logic — open decisions resolved with the owner before implementation.
---
# Spec Brief

Template and procedure for the guided mini-spec required by every
feature-add or new-logic task (Gate P/Gate D in `decision-request`) BEFORE
approving `do` and BEFORE the task record's ACT phase. Open decisions (⚠️)
are resolved with the owner via the question interface — one round, concrete
options + recommended default. No complete spec → no ACT.

# Spec: <ID> — <title>

- **Type:** feature-add | new-logic | behavioral-refactor
- **Origin:** backlog | owner | discovery
- **Date:**

## 1. Problem

The real problem solved, in ≤5 lines. Evidence (issue, complaint,
benchmark, use case).

## 2. Acceptance criteria

Observable commands/behaviors proving it is solved — they become the task
record's `Contract`:

1. `<mechanical check>` passes
2. <specific verifiable behavior>

## 3. Scope

- **Includes:** ...
- **Does NOT include:** ... (explicit — anti-scope-creep is defined here)

## 4. Proposed design

≤10 lines: files to touch, new signatures/signature changes, data flow.

## 5. Open decisions (⚠️ → owner question)

> **Minimum depth per row:** ≥2 REAL alternatives (materially different
> approaches, not cosmetic variants) + a one-line cost/tradeoff per option.
> If only one viable path exists, do NOT invent filler options: record the
> single path with its evidence (`ref: file:line` or official doc) and mark
> it `decided-by-evidence`.

| # | Decision | Options (+tradeoff) | Recommended default | Resolved |
|---|----------|---------------------|---------------------|----------|
| 1 | e.g. sync or async API | sync (simple, blocks caller) / async (throughput, complexity) | sync | |

> Each row is asked before closing the spec. The answer is recorded here
> (`Resolved` column) and in the continuation record.

## 6. Risks and expected blast radius

Top-3 risks (they seed the plan's risk register) + estimated files.

---
**Spec state:** ⬜ draft → 🔄 questions sent → ✅ owner-confirmed

Once confirmed: the spec lands in the task record's `## Spec` section and
the `Contract` is copied from §2. Mechanical gate: a feature-add task
record without a FILLED `## Spec` (decision table or per-item evidence —
see `decision-request` §valid-spec) does NOT enter ACT.
