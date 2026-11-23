---
name: plan-design-review
description: Use to assess a proposed design or task plan before committing implementation work
---
# Review Before Work

Gate a proposed design or task plan before implementation work is committed.
The cheapest moment to find a wrong plan is before anything is built; after
code exists, the user rationalizes the wrong thing into "good enough" and the
misfit locks in.

Compare the plan with observed code, constraints and requested outcome.
Check task boundaries, dependency cycles, interface contracts and verification.
Inspect cascading failure, migration, rollback and authority requirements.
Identify unstated assumptions or unnecessary complexity.
Return concrete gaps and acceptance blockers before suggesting polish.
Do not implement an unsettled plan merely because it is written down.

## When to use

- A plan or design produced by `writing-plans`,
  `planning-and-task-breakdown`, `brainstorming` — or supplied by the
  owner — is about to commit implementation effort.
- A consequential plan needs a verdict before execution starts.

Do not use it for trivial single-scope plans, as a mid-execution audit
(that is a review skill's job during `contract-execution`), or as a
substitute for the spec-approval gate in `spec-driven-development` — this
review challenges the plan's mechanics and grounding, not product intent.

## Review procedure

Run the checks in order; each can independently block acceptance.

1. **Premise** — does the plan solve the stated problem, or a different,
   more convenient one? Quote the requested outcome and the plan's goal
   side by side. A plan that answers a different question is rejected no
   matter how well-built it is.
2. **Grounding** — verify plan claims against the actual code: every file,
   symbol and convention named in the plan exists; the behavior described
   as missing is actually missing; nothing planned is already implemented.
3. **Boundaries** — task scopes are coherent deliverables; write scopes of
   parallel-eligible tasks are disjoint; no two tasks need the same lines.
4. **Dependencies** — the DAG is acyclic; the proposed order is satisfiable;
   hidden coupling (shared state, generated files, migrations) is named.
5. **Contracts** — every task carries verifiable acceptance tied to its
   scenarioRefs; no contract reduces to "it works" or restates the title.
   The union of scenarios covers the specification exactly.
6. **Failure analysis** — cascading failure modes, migration and rollback
   paths, irreversible effects, and the authority each requires are stated.
   Anything irreversible without a recovery story is a blocker.
7. **Assumption sweep** — unstated assumptions, invented baselines or
   metrics, and complexity the requirements do not justify (YAGNI). Name
   each; do not silently repair them.

## Rating (for consequential plans)

Rate each dimension 0-10 and state what a 10 looks like. Any dimension
below ~7 with no named, closable gap is an acceptance blocker:

| Dimension | What a 10 looks like |
|-----------|----------------------|
| Coverage | Union of tasks covers the spec exactly; nothing outside it |
| Verifiability | Every task has mechanical acceptance evidence |
| Ordering | DAG acyclic; high-risk units early; checkpoints between phases |
| Reversibility | Each unit individually revertible; recovery stated |
| Minimalism | Nothing in the plan that needn't exist |
| Grounding | Every claim verified against the code or spec |

## Plan-slop signals

Auto-generated plans fail in characteristic ways. Flag on sight:

- Acceptance criteria that restate the task title ("X is implemented").
- File paths or symbols that do not exist in the repository.
- Invented baselines, metrics or thresholds presented as measured.
- Tasks ordered by narrative rather than dependency.
- A phase named "integration", "wiring" or "polish" hiding unresolved design.
- Every task rated the same effort, or all XL.
- Scope that answers more than the request asked (quiet feature creep).

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "The plan was written carefully" | Careful authorship is not verification. Grounding checks the plan against the code, not against its own prose. |
| "A strong model generated it" | Plan-slop is characteristic of generated plans, not hypothetical — flag the signals on sight. |
| "Blockers can be fixed during implementation" | Fixing after code exists costs multiples of fixing on paper — that asymmetry is the reason this gate exists. |
| "It is close enough to approve" | Approved-with-conditions still carries conditions — into the task records, not just into this review. |

## Output format

```
VERDICT: approved | approved with conditions | blocked
BLOCKERS:  [acceptance blockers, ordered by severity — each with evidence]
GAPS:      [concrete gaps that need closing, not blocking]
POLISH:    [optional improvements — never before blockers]
ASSUMED:   [what the review could not verify — kept explicit]
```

Report blockers first and polish last. A plan approved with conditions
carries the conditions into the task records, not just into this review.
Unsettled questions surfaced here route to `resolve-ambiguity`; contract
and evidence defects are judged against `outcome-driven-development`'s
falsifiability bar.

## Verification

- [ ] The verdict used the output format; blockers precede polish
- [ ] Grounding claims were checked against the code, not the plan's text
- [ ] Every task-scope boundary and write-scope disjointness was verified
- [ ] The scenario union was compared against the specification, not assumed
- [ ] Irreversible actions without a recovery story were flagged as blockers
- [ ] Conditions of an approval were propagated into the task records
