---
name: contract-execution
description: Use when executing a scoped engineering task through the recorded lifecycle, with acceptance criteria, verification evidence, review and a resumable handoff.
---

# Contract execution

1. Read the approved configuration, relevant project rules and task contract.
2. Confirm the behavior does not already exist and identify affected modules.
3. Record scope, exclusions, acceptance criteria, risks and recovery strategy.
4. Use PLAN for investigation and ACT for authorized implementation.
5. Use VERIFY to propose exact commands. Wait for authorization and record
   actual output references; a proposed command is not a passing check.
6. Diagnose failures without hiding them. Use COLLATERAL or RESEARCH when
   needed, and STALL when blocked on a decision.
7. Use EVALUATE for self-assessment and REVIEW for a separate reviewer.
8. Accept only current verification and an independent approval or an
   explicit owner waiver with owner, reference and reason.
9. If implementation changes, invalidate old evidence and obtain a new review.
10. On completion or failure record the outcome:
    `memory add --log outcomes --input {taskId, outcome: ok|fail, skills:[...]}`.
    Durable learnings belong in `memory add --log lessons`; the advance
    archive (`progress`) is written automatically when the task reaches CLOSE.
11. Save changed files, results, evidence, unresolved risks and next action.
    Stop at the agreed boundary. Never push or publish implicitly.

Workflow modes (PLAN, ACT, VERIFY, COLLATERAL, RESEARCH, EVALUATE, REVIEW,
ACCEPT, STALL) are defined in `policy/workflow.json`.

Scopegrain state checks do not intercept all native host tools. Do not
describe the workflow as a sandbox or claim authenticated reviewer identity.
