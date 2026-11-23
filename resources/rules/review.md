# Independent Review — Rules

> **Scope:** independence requirements, waiver mechanics and review focus
> for change review.
> **Not here:** orchestration role boundaries (`workflow.md`), evidence
> standards (`evidence.md`), general owner-question mechanics
> (`human-decisions.md`).
> **Status:** Active

## Rules

### 1 — Review the actual change and contract

- **Must:** the reviewer inspects the real diff or artifact and the contract
  it implements.
- **Must not:** review from a summary, a plan or remembered intent.
- **Why:** the gap between described change and actual change is exactly
  where defects live.

### 2 — The implementing context cannot review itself

- **Must:** obtain review from a separate context — or an explicit owner
  waiver under rule 3.
- **Must not:** let the context that wrote the change claim fresh,
  independent review of it.
- **Why:** same-context review re-derives the same blind spots; it is
  re-reading, not review.

### 3 — A waiver is explicit, named and recorded

- **Must:** where real independence is unavailable, obtain an owner waiver
  naming the owner, the change reference, the reason and the explicit
  approval (`→ see human-decisions.md`).
- **Must not:** proceed on an implied or blanket waiver.
- **Why:** the waiver converts a missing gate into a recorded, owned risk —
  an unrecorded one is just a skipped gate.

### 4 — Prioritize correctness, risk and missing tests over style

- **Must:** focus findings on behavior, contracts, security and coverage
  gaps.
- **Must not:** block a correct change on preference-level style.
- **Why:** review budget spent on taste crowds out the defects that matter.

### 5 — New work invalidates prior approval

- **Must:** treat implementation or verification performed after an
  approval as voiding it, per the task lifecycle.
- **Must not:** present a superseded approval as current.
- **Why:** approval binds to the content reviewed; changed content is
  unreviewed content.
