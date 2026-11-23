---
name: task-brief
description: Structure a bounded implementation brief from settled inputs and the selected methodology route.
---
# Task Brief

Use this to define or dispatch ONE task in full depth: investigate, classify,
write the complete task record, then implement or hand off. Loaded when a
host defines a task record (`plan-work`, `implement-task`) or briefs a
worker delegate (`coordinate-plan`, `audit-harness`). Keep the original
request, scope and exclusions intact. Execute the phases sequentially; do not
skip gates. A brief cannot expand the owner's authorized scope. The output
is the persisted task record — plus, on dispatch, a delegate bound to the
return contract below.

## Required slots

Common required slots: actual task identity and revision; original request;
scope and exclusions; selected route and recorded authority; settled findings;
exact interfaces and acceptance cases; available authorized checks; required
artifacts; permission/budget limits; dependencies and current runtime state.

For SDD include current specification/design/plan references, reviewed digests,
approvals and assigned scenarioRefs. For light work include classification
facts and recorded bounded authorization, not fictitious formal approvals.

Include live processes and whether to reuse or leave them running. Pass
frozen derived inputs rather than asking a worker to recompute known results.
Unresolved product or permission decisions block dispatch. Do not offer
alternative interfaces and ask the implementer to silently select one.

Require the complete diff, raw evidence and explicit limitations rather than
only a success summary. A dispatch brief also fixes the return contract:
the RESULT block per `session-recitation` (plus open questions as
`BLOCKER:` entries) — a delegate dispatched without a return contract is
unverifiable.

## Phase 1 — Classify the task and select capabilities

Classify by the files actually touched, not by title keywords. Typical
mapping: product source → implementation checks the project declares;
bindings/SDK surface → binding tests plus public-contract review; docs/plans
→ no mechanical check beyond link/format validation; mixed → all applicable
capabilities and checks.

Run the skill-discovery pass (skill `select-capabilities`): match the task
type, the current lifecycle phase and the contract keywords against the
skills catalog; load at most 8 candidates with a one-line justification each
and record them as `SKILLS_LOADED`. If none apply beyond the base set, record
`SKILLS_LOADED: base-only, no additional candidates`.

Type `bug` additionally requires `systematic-debugging`: no fix without a
recorded root-cause investigation first (see "Debugging evidence" below).
New or complex logic adds `test-driven-development`; security-sensitive work
adds `doubt-driven-development` or `security-and-hardening`.

### Feature-add detection (spec gate)

The detected task type does NOT decide whether the task is a feature-add.
Check mechanically whether the planned solution adds new public symbols or
contracts: new public function/type/endpoint/CLI flag/tool, a new method on a
published binding surface, or a user-facing capability that did not exist.
Any such signal makes it a feature-add for methodology purposes even when the
files suggest fix/wrapper/refactor. Consequences:

1. The task record MUST carry a valid spec section per `spec-brief`
   (a decision table or per-item evidence justification; `N/A` is invalid).
2. Open design decisions go through ONE round of the decision gate
   (`decision-request`, Gate D) before implementation.
3. No valid spec → do not enter ACT. This is a mechanical gate.

## Phase 2 — Discovery and blast radius

Light discovery (a few files) runs inline; heavy discovery (many files, broad
transitive impact, multi-source web research) may be delegated to a read-only
research context returning a digest — see `research-brief`. Do not fragment
the delegation per step; delegate the whole heavy phase.

Use the project's structural/graph capability when available (reference
`graph-investigation`); fall back to grep/read for unindexed content. Record
in the task record (`analysis.blastRadius` / `analysis.impact`):

- CALLERS: what modules call these files/symbols.
- CALLEES: what these files depend on.
- IMPLICATIONS: does it break existing contracts? change public behavior
  (API, CLI, SDK)? affect performance, memory, serialization? require data
  migration or re-indexing? affect existing tests?
- RISK: high / medium / low.
- CONTRACT: "done = [mechanically checkable condition]" — never a vague
  contract (see the appendix).

## Phase 3 — External research when ambiguous

If the task involves external APIs/libraries whose documentation is not in
the code, unfamiliar patterns, or technically divergent options: use approved
search tooling (skill `web-research`) with owner authorization for network
access. Document findings in the task's investigation notes with URLs; mark
any citation not mechanically resolved as `[UNVERIFIED citation]` and record
the pending check as debt.

## Phase 4 — Decompose into atomic steps

Each step must be: a single action (edit a file, run a check), roughly ≤100
lines of change, and mechanically verifiable. Record steps in the task record
`steps[]` with `name`, `files`, `action`, `verify`, `status`. Estimate effort
into the declared bucket (`effort`: hours/day/days/weeks) and `estimate.turns`.

## Phase 5 — Independent review gate

The review of this task is executed by a DIFFERENT context than the
implementer — never the same context. Use the reviewer role or `review-deep`/
`independent-review` skills; brief that reviewer per `review-request`.
Mandatory scope of that review:

1. Approach — is the chosen approach correct; were better alternatives missed?
2. How it was verified — is the evidence real and sufficient; a self-reported
   green check is not evidence.
3. Risk tiering — diffs touching the project's declared high-risk surfaces
   (public API contracts, storage/wire formats, parsers, auth boundaries)
   require adversarial review; the rest get mechanical verification plus a
   recorded verdict. A mixed diff is adversarial.
4. Anti-pattern checklist (see the record template's Review section).

Without a recorded review verdict from a different context — or an explicit
owner waiver `{owner, reference, reason}` — the task is not COMPLETED even if
the contract passes. Fallback when no second context exists: an adversarial
self-review in a fresh context, marked as degraded and escalated to the owner.

## Task record template

Persist the record under the configured tasks path (`.scopegrain/tasks`) via
the harness task runtime. Required content:

```markdown
# <TASK-ID>: <short description>

## Metadata
- Plan: <plan identity or "single-task">
- Source: <backlog key / request / finding id>
- Type: bug | feature | refactor | research | docs | ops | mixed
- Effort: hours | day | days | weeks   ·   Estimated turns: N
- Priority / Severity / Disposition: per semantic layer
- State: PLAN (lifecycle state, not a checkbox)
- Revision: <current revision>
- Uncertainty: uphill N (open unknowns) / downhill M (known steps left)
- Created / last-synced: ISO timestamps

## Blast radius
| Direction | Modules |
| Callers   | ...     |
| Callees   | ...     |
| Implications | contract X unchanged, performance Y affected |

## Mapped impact (pre-edit gate)
> GATE before ANY edit: every file to be modified/deleted is read completely
> and its impact mapped BEFORE the first edit step. Without this block filled,
> no step that edits files may run.
- Files read (completely): [paths]
- Incoming references (who references the edited files): [search result]
- Impact verdict: [low/medium/high — what breaks if changed/removed]

## Contract
"<exact check or observable condition> passes and <specific behavior> holds"

## Spec (mandatory when feature-add detection fired)
> Valid content per `spec-brief`: a decision table (≥1 row, ≥2 real
> alternatives + one-line tradeoff + recommended default + Resolved column)
> OR per-item `decided-by-evidence (ref: file:line | official doc)` notes.
> `N/A`/empty is invalid; `no technical decisions` + touched-file list only
> for a 100%-docs task.

## Domain invariants (handoff)
- Invariants to preserve: [domain/security condition the next context must not break]
- Verification commands: [exact command + expected result — proposed, owner-run under manual verification]
- Pending debt: [what stays incomplete, or "none"]

## Continuation (recitation mapping — canonical format in `session-recitation`)
| Field | ← source in this record |
| activeGoal | the `# <ID>: <description>` header |
| lastAction | last done step + context save point |
| result | OK ↔ CLOSE-ready · PARTIAL ↔ in-flight with pending steps · FAILED ↔ failed |
| nextAction | next pending step (file + command) |
| contract | Contract + verification + per-claim evidence + artifacts + invariants + debt + pending-for-orchestrator |
| nextTask | next task in the plan |

## Technical debt
Net debt balance: none | new debt recorded with id + paying reference
(new debt must be registered, not silently introduced).

## Definition of Done (per level — gate, not afterthought)
| Level | Gate |
| Task  | record contract verified + declared checks pass + tests for the change pass |
| Commit | atomic diff (~100 lines), declared commit convention, clean mechanical verification (never self-report) |
| Release | project's declared release gate, changelog/version policy, pre-push consent |

## Capabilities
- Tools/checks: [the project's real commands]
- SKILLS_LOADED: [list + one-line justification, or `base-only`]

## Investigation notes
- Web-research findings, verified citations, unresolved questions.

## Uncertainty report (uphill/downhill)
Report THREE counters separately, never a bare percentage:
- Uphill (open unknowns): approach to validate, dependency to investigate,
  open decision — must reach 0 before completion.
- Downhill (known pending steps): remaining execution work.
- % executed: progress over steps.
A resolved unknown moves to Notes with its answer.

## Debugging evidence (bug tasks only — gate before any fix step)
- Repro: deterministic reproduction (exact steps/command).
- Hypothesis: probable root cause, written BEFORE touching code.
- One controlled variable: exactly ONE variable changed per attempt.
- RED test: regression test that reproduces the bug, verified FAILING before
  the fix and GREEN only with the fix applied.
Fix steps and their verifies are defined only AFTER this block is filled.

## Mandatory domain phases (evaluate before coding; justify if N/A)
- [ ] SECURITY — if it touches trust boundaries, user input, auth, data, or
      adds/removes dependencies → `security-and-hardening`, findings in Notes.
- [ ] PERFORMANCE — if it touches a hot path → `performance-optimization`,
      record baseline/expected impact.

## Steps
### Step 1: <name>
- Files: `path/to/file`
- Action: what to do
- Verify: <exact mechanical check>
- Status: pending | done | skipped

## Dependencies
- <task id>: <why it must complete first>

## Review (gate — different context)
- Reviewer: [role/context, ≠ author]
- Approach: [is it correct; alternatives]
- Verification: [real evidence, not self-report]
- Anti-pattern checklist (reviewer confirms the implementer did NOT):
  - [ ] invent outputs of commands/tools that were not run
  - [ ] skip clarification "because I already knew"
  - [ ] declare done without checking acceptance criteria
  - [ ] ignore failures or report all-OK on partial failure
  - [ ] stop after one search attempt and call it saturated
  - [ ] copy without citing or present assumptions as evidence
  - [ ] retry in a loop without diagnosis
  - [ ] leave orphan steps disconnected from the goal
  - [ ] degrade error checking on money/security paths
  - [ ] spend unbounded budget; stops must be explicit
  - [ ] leave a capability gap: does SKILLS_LOADED cover the task domain?
- Verdict: approve | changes-requested (return to Steps)

## Notes
- Design decisions, learned context, known issues.
```

## Appendix — vague vs verifiable contract

| Vague | Verifiable |
|---|---|
| "Fix the memory bug" | "`tests/test_memory` passes, linter reports 0 new warnings" |
| "Improve the web UI" | "`tsc --noEmit` 0 errors, declared lint passes, declared build succeeds" |
| "Refactor module" | "declared check passes, no new warnings, existing tests pass" |
| "Works well" | "build + declared test suite pass, and <specific behavior> works" |
