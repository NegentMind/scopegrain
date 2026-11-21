---
name: plan-coordination
description: Use when executing one or more dependent tasks and preserving continuation across interruptions
---
# Plan Coordination

Read the plan and actual tasks. Select only dependency-ready work.
For each task read state/revision, confirm scope, execute a narrow slice,
record authorized verification and obtain review before acceptance.
Parallelize only disjoint scopes whose inputs are settled.
On partial completion retain useful work and identify missing evidence.
Use resume context rather than rerunning completed operations blindly.
Report blockers and stop at the agreed boundary.

## Delegation contract

Delegate only when a named trigger applies and the work is settled — never
because the remaining context feels large or the file count looks high:

- **Mapping/exploration** — several disjoint lookups the parent should not
  serialise (roughly five or more independent traces).
- **Parallel disjoint units** — settled tasks with non-overlapping scopes
  and no shared intermediate state.
- **Independent verification** — a reviewer for a named-risk unit, whose
  context must differ from the author's.
- **Context backstop** — the parent approaches a hard context budget and
  remaining work is mechanical.

Every delegation states: the exact task/locator references (never
paraphrased requirements), the allowed edit surfaces (paths the delegate
may write — anything else is out of bounds), the return contract, and the
rework bound before escalation.

The delegate returns: completed work, actual evidence produced, deviations
from the assigned surfaces, and open questions — not a narrative summary.

The parent verifies the delegated result against the *original request and
task contract*, not against the delegate's self-report. Verification of a
request is not a review of the worker.

A role, agent name or fresh context label is not authentication and does
not widen authority; delegated work keeps the parent's authorized scope.
