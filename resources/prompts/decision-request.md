---
name: decision-request
description: Ask a consequential question with explicit alternatives and authority; canonical gate contract for the pipeline.
---
# Decision Request

Canonical contract for human-in-the-loop gates. Other prompts REFERENCE the
gates defined here (P, D, V, C, H); they never redefine them. Loaded by the
lead or a delegate whenever a consequential decision, an ambiguous contract
or a declared gate trigger is hit. The output is a recorded question/answer
with its scope — or, with no question interface, a structured report plus
STOP; an unanswered question blocks, it never implies GO.

## Required slots

Required slots: the single unresolved question; observed facts and unknowns;
why investigation cannot settle product intent/authority; viable options
with tradeoffs; recommendation; exact scope, paths, effects, costs and risks;
reviewed-input identity/digest; what remains blocked.

Use the available native question interface when its schema is known,
otherwise ask clearly in text. Prefer a small set of complete alternatives.
Allow refusal, cancellation and another answer. A skipped question is not
approval; do not convert a recommendation into a selected option.
Record the actual response and its scope. New effects or changed reviewed
inputs require renewed consent; an approval record is not authentication.

## Principles

1. Every question carries concrete options plus a recommended default,
   listed first and marked `(Recommended)`. Never an open question without
   context.
2. Record each gate's outcome in the continuation record and, when it
   changes direction, as a decision/journal entry with the reason.
3. At most ONE question round per gate per task: the owner already decided;
   do not re-ask unless the code contradicts the decision.
4. If the host exposes no question interface, fall back to a structured
   report and STOP awaiting owner input — never assume GO.

## Who asks

| Context | How |
|---|---|
| Orchestrator / lead | Directly via the question interface |
| Delegate WITH question capability | Directly |
| Delegate WITHOUT question capability | Returns `BLOCKER: <gate + options>` in its RESULT block — the orchestrator asks on receipt and resumes the delegate with the answer. The delegate NEVER assumes GO. |

## Gate P — Plan/triage

During backlog triage, BEFORE fixing the final gate decision:

| Trigger | Question |
|---|---|
| Critical-priority task | Confirm inclusion/scope: GO as-is / adjust scope / defer / skip |
| Ambiguous contract (≥2 interpretations that change the result) | Show the interpretations, request a choice |
| Plan adds new public symbols/contracts (public function, endpoint, tool, binding method, consumable component) — even when the detected type says fix/wrapper/refactor | Treat as feature-add: mini-spec per `spec-brief` → open decisions to the owner (one round, options + recommended default) BEFORE approving `do`. Type labels do not override this trigger. |
| Feature-add or new logic | Guided spec: generate the `spec-brief` mini-spec → ask its open decisions (one round) BEFORE `do`. The confirmed spec travels into the task record — without it, no ACT. |
| Final triage summary | Confirm the complete defer/skip set before persisting the plan |

## Gate D — Discovery

After zero-code planning, BEFORE writing the task record / entering ACT:

| Trigger | Question |
|---|---|
| Blast radius >10 files, or touches a declared hot path / public API / persistence boundary | Show summarized blast radius + proposed approach → GO / adjust / split into tasks |
| Solution plan adds new public symbols/contracts (same detection as Gate P — detect in planning, not from the type label) | Confirm the public surface design (names, signatures, error semantics) → GO / adjust |
| Contract ambiguity discovered in code that triage did not see | Stop; choose among valid paths |
| Feature-add/new logic without a mini-spec | Generate the spec; confirm acceptance criteria with the owner |

### Valid `## Spec` content (mechanical spec-first gate)

A task's spec section counts as FILLED only if it satisfies ONE of:

1. **Decision table** (`spec-brief` §5): ≥1 row with ≥2 REAL alternatives
   (materially different approaches, not cosmetic variants) + one-line
   tradeoff per option + recommended default (+ `Resolved` column when it
   went through a question), OR
2. **Per-item evidence justification:** each technical decision marked
   `decided-by-evidence (ref: file:line | official doc)` — a single viable
   path is still recorded, never omitted.

INVALID: `N/A`, empty, or only "mechanical contract" without the decisions.
Sole exception: a 100%-docs task with no technical decisions → write
`no technical decisions` + the touched-file list (verifiable).

Whoever executes ACT and whoever reviews MUST validate this before entering
ACT; invalid → return to discovery (spec + questions). An `N/A` on a task
with new public symbols is a blocking review finding.

## Gate V — Verify-failure ×2

At the single threshold of **2 verify failures with the same error**
(file+line+message). Replaces silent human escalation.

Mandatory question WITH evidence: the 2 errors, which attempts ran, options:
1. Retry with a fresh context (consumes budget)
2. Change strategy (describe the proposed alternative)
3. Mark FAILED and move to the next task (the declared failure policy applies)

No answer → STOP (do not mark FAILED unilaterally unless an explicit
stop-policy was declared).

## Gate C — Closure

During closure, before the final commit:

| Trigger | Question |
|---|---|
| Collateral errors found | Fix now (small, same file) / include in this commit — the derived finding record already exists per `finding-record` if not fixed inline |
| `git status` shows files OUTSIDE the declared blast radius | Include in the commit / leave uncommitted (staged apart) / investigate origin |
| Plan completed (campaign close) | Confirm plan archival and migration of completed work to progress records |
| Task closure → ACCEPT | NOT a question: enforcement. Recording `CLOSE`/`ACCEPT` requires a valid review payload — `fresh` mode with reviewer context ≠ author context + verdict `approve`, or `degraded` mode + owner waiver `{owner, reference, reason}` recorded in trace/decisions. Without it the transition is rejected; a degraded waiver is a recorded owner decision, never self-granted. |

## Gate H — Harness self-change

When the diff touches harness resources (commands, agents, skills, prompts,
rules, references, host descriptors, MCP profiles):

| Trigger | Action |
|---|---|
| Any change to harness resource trees | Run the `audit-harness` command green before the harness commit |
| Harness audit red with ≥medium findings | Register finding records + fix in the same harness PR — not "later" |
| Declared agent-eval regression | NO-GO: do not merge or ship until the baseline is restored |
| New tool findings over baseline | Block: triage (false positive → baseline with justification, real → fix) |

The harness change is audited by a context that did not author it; its
acceptance also passes the mechanized review payload (Gate C).

## Anti-abuse

- Gates do NOT apply to trivial tasks with a clear mechanical contract.
- A family explicitly approved by the owner this session (same plan, same
  goal) suppresses individual Gate P/D ONLY for fix/test/docs/refactor tasks
  with no new public surface. Feature-add or new-public-symbol tasks inside
  an approved family still fire ONE batched spec-confirmation round (all
  open decisions together, options + recommended default) before ACT.
  Rationale: plan approval covers the WHAT of each task; a new feature's
  spec defines the technical HOW, which the plan does not detail.
- If the plan declares autonomy (`autonomous: true`), only Gate V and Gate
  C's safety cases (files outside blast radius) operate. Without the flag,
  all gates operate.

## Non-stop run defaults

A full-plan run operates non-stop with safe defaults + structured log:
- **Critical Gate D → question** (blast radius >10 / hot path / public API /
  ambiguous contract / new public symbols → GO/adjust/split). Non-critical D
  (trivial, mechanical contract) does not ask.
- **Gate V → mandatory question** (2 same-error verify failures → fresh
  retry / strategy change / FAILED; no answer → STOP).
- **Gate C → auto+log** (small same-file collaterals fixed inline, rest get
  finding records; files outside blast radius left uncommitted absent a
  decision; campaign close asks about archival). Questions only on safety
  cases or campaign close.
- Every applied default lands in the continuation record + `GATES_EVALUATED`
  audit trail; the orchestrator never re-asks what was decided.

## Mandatory gate-evaluation record

Every RESULT block includes:

```
GATES_EVALUATED: P:<no|fired> D:<no|fired> V:<no|fired> C:<no|fired> | <reason per gate, ≤6 words>
```

Orchestrator rules on receipt:
1. Field absent, or a `no` without reason → treat as MALFORMED and re-invoke
   for the field (recovery rung 1).
2. A gate marked `fired` must correspond to a reported `BLOCKER:` or a
   recorded question/answer. Discrepancy → re-invoke with feedback.
3. Persist the field in the continuation record — the audit trail that
   gates were EVALUATED, not just executed.

This turns gates from "delegate's judgment" into a verifiable checklist:
the delegate must prove it evaluated them even when none fired.
