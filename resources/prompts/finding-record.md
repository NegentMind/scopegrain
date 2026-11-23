---
name: finding-record
description: Route defects discovered during execution into backlog records at discovery time — never only in notes.
---
# Finding Record

Canonical routing for bugs, errors and failures discovered while executing a
task or plan. Other prompts REFERENCE this file; they never redefine it.
Loaded at discovery time inside any task or plan execution, and by
review/audit flows registering derived findings; the output is a backlog
record created at discovery, referenced — not copied — by the task record.

## What counts as a finding

Any defect discovered during execution that is NOT the objective of the
current task. The current task's own defect is fixed through its normal
debugging workflow (`systematic-debugging`), not as a finding.

## Single rule

**Every finding not fixed inline is born as a backlog record AT DISCOVERY
TIME — not at closure.** The plan/task record only references it. Recording
findings only in plan notes, continuation blocks or commit messages loses
them when the plan is archived.

## Inline vs record — the agent's call

Decide case by case whether to fix now or register. Sole constraint: an
inline fix follows the complete bug workflow (mandatory root cause, no
"while I'm here" refactor) and lands in the same `fix:` commit. When in
doubt → record it: a record is cheap; a lost finding is not.

## Record format

Use the project's declared backlog schema. For harness task records, create
a task record in the default backlog with the semantic-layer fields:

- **Key:** a finding key per the project's registered taxonomy (portable
  convention: `FIND-<n>`, continuing the highest existing number — locate it
  by searching the backlog). ONE scheme for ALL derived findings: audit,
  review, investigation and execution findings share it. Do not create new
  prefixes per campaign or tool — traceability lives in the `source` field,
  not the prefix.
- **Severity / Effort / Priority:** from the semantic layer (`critical|high|
  medium|low|info`, `hours|day|days|weeks`, `p0..p3|backlog`). Default
  priority is the lowest; the next planning triage adjusts it.
- **Type:** `bug` (or the matching kind).
- **Location:** `file:line` of the defect.
- **Description:** what was found + proposed action.
- **Source (mandatory):** the plan id, task id and commit where it was
  discovered (`source: "<plan>#<task> · commit <hash>"` or the equivalent
  `relations` edges).
- **State / disposition:** pending, active.
- **Contract:** like every backlog item — a verifiable done-condition.
