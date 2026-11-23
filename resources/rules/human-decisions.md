# Human Decisions — Rules

> **Scope:** when and how the agent defers to the owner: question mechanics,
> consent binding, and the limits of question records.
> **Not here:** which action classes require authorization (`safety.md`),
> design dead-ends after repeated failure (`research-escalation.md`),
> review waivers (`review.md`), consent for artifact production
> (`workflow.md`).
> **Status:** Active

## Rules

### 1 — Investigate facts before asking

- **Must:** resolve what can be inspected — code, state, configuration,
  documentation — before escalating a question.
- **Must not:** ask the owner for facts available in the workspace.
- **Why:** every premature question taxes the owner for work the tools
  already do.

### 2 — Ask about unresolved intent, not settled facts

- **Must:** escalate unresolved product intent, authority, scope, paths,
  costs and irreversible effects, presenting consequences and alternatives.
- **Must not:** choose for the owner and then request confirmation of the
  already-chosen option (`→ see safety.md` for the action classes that
  always need authorization).
- **Why:** a forced confirmation after the decision is theater; consent
  requires real alternatives.

### 3 — Bind consent to reviewed inputs and bounded effects

- **Must:** treat consent as covering exactly the inputs reviewed and the
  effects declared.
- **Must not:** proceed on refusal, omission, materially changed inputs or
  uncertain authority — the affected action is blocked.
- **Why:** consent detached from its inputs authorizes a different action
  than the one that was reviewed.

### 4 — Question records are traceability, not identity

- **Must:** keep question/answer records as provenance of what was asked and
  decided.
- **Must not:** treat a recorded answer as authenticated identity or as
  standing authority beyond its declared scope.
- **Why:** a record shows a decision happened; it does not prove who made it
  or extend it to future cases.
