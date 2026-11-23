---
name: clarify-intent
description: Use to turn an initial product idea into a bounded, testable engineering request
---
# Clarify Intent

Refine a raw idea into a sharp, bounded, testable engineering request through
structured divergent and convergent thinking. You are an ideation partner,
not a yes-machine: push toward the simplest version that solves the real
problem, challenge assumptions, and make trade-offs explicit.

Establish the target user, current pain, intended outcome and actual constraints.
Inspect existing features before proposing new components.
Separate the minimum useful outcome from optional extensions.
Compare alternatives and identify the riskiest unanswered assumption.
Ask for a decision when product authority is needed.
Produce a concise contract, not an unbounded implementation roadmap.

This skill owns the divergent→convergent **ideation** pass that turns a
raw idea into a bounded request. The interview mechanics it uses —
hypothesis-with-guess, one question at a time, the "what would you
actually want?" probe — are canonical in `resolve-ambiguity`; this file
keeps only the format, not the rationale. Design-level alternatives and
settlement belong to `brainstorming`; the output feeds
`spec-driven-development` or `planning-and-task-breakdown`.

## When to use

- A raw product idea or feature request needs shaping before anyone can
  plan or specify it.
- The request names a solution ("build X") and the underlying problem has
  not been stated.

Do not use it when the request is already bounded and testable (go to
`planning-and-task-breakdown` or `spec-driven-development`), or when what
blocks is a missing fact or a stated premise — `resolve-ambiguity` and
`discernment-nudge` respectively.

## Loading constraint

This skill needs a live, responsive owner. In non-interactive contexts,
record the unresolved intent questions as blockers in the task record
instead of guessing.

## Phase 1: Understand and expand (divergent)

**Goal:** take the raw idea and open it up.

1. **Restate the idea** as a crisp "How might we" problem statement. This
   forces clarity on what is actually being solved. Keep it narrow enough
   to act on, broad enough to allow creative solutions, and free of an
   embedded solution.

2. **Ask 3-5 sharpening questions — no more.** Focus on:
   - Who is this for, specifically?
   - What does success look like?
   - What are the real constraints (time, tech, resources)?
   - What has been tried before? Why now?

   Ask one question at a time, each with your best guess attached —
   mechanics per `resolve-ambiguity` (why the guess, why one at a time,
   how to probe convention-signaling answers):

   ```
   Q:     <one focused question>
   GUESS: <your hypothesis, with the reasoning that produced it>
   ```

3. **Generate 5-8 idea variations** using these lenses — pick the ones that
   fit; do not run every lens mechanically:
   - **Inversion:** what if we did the opposite?
   - **Constraint removal:** what if budget/time/tech were not factors?
   - **Audience shift:** what if this were for a different user?
   - **Combination:** what if merged with an adjacent idea?
   - **Simplification:** what is the 10x-simpler version?
   - **10x version:** what does this look like at massive scale?
   - **Expert lens:** what would a domain expert find obvious?
   - **SCAMPER:** substitute, combine, adapt, modify, put-to-other-uses,
     eliminate, reverse.
   - **First principles:** which assumptions are convention, not physics?
   - **Jobs-to-be-done:** "When I [situation], I want [motivation], so I can
     [outcome]." The real competitor is the current workaround.
   - **Pre-mortem:** it shipped and flopped — why?

   Push beyond what was asked. If inside a codebase, ground variations in
   what exists — read the relevant code and reference concrete files and
   patterns.

## Phase 2: Evaluate and converge

After the owner reacts (what resonates, pushback, added context):

1. **Cluster** the resonating ideas into 2-3 meaningfully different
   directions.

2. **Stress-test** each direction on three criteria:
   - **User value:** who benefits and how much? Painkiller (acute, frequent,
     users switch for it) or vitamin (nice, changes no behavior)? Can you
     name 3 specific people with this problem — and what they do today?
   - **Feasibility:** what is the hardest part? Dependencies you do not
     control? Is there a version that delivers value in days, not months?
   - **Differentiation:** what does this do that nothing else does, in the
     order: new capability > 10x improvement > new audience > new context >
     better UX > cheaper?

   Rank directions: high value + high feasibility first; high value + low
   feasibility is a calculated risk; low value + low feasibility is rejected;
   differentiation breaks ties.

3. **Surface hidden assumptions — do not skip this.** For each direction,
   name explicitly:
   - **Must be true** (dealbreakers — validate before building)
   - **Should be true** (important — adjust approach if wrong)
   - **Might be true** (nice-to-have — validate after the core is proven)
   - What could kill the idea; what you are choosing to ignore and why.

**Be honest, not supportive.** If an idea is weak, say so with specificity.
Push back on complexity, question real value, point out when the emperor
has no clothes.

## Phase 3: Sharpen and ship

Produce a concrete artifact — a bounded one-pager that moves work forward:

```markdown
# [Idea name]

## Problem statement
[One-sentence "How might we" framing]

## Recommended direction
[Chosen direction and why — 2-3 paragraphs max]

## Key assumptions to validate
- [ ] [Assumption — and how to test it]

## MVP scope
[Minimum version that tests the core assumption. In / out.]

## Not doing (and why)
- [Thing] — [reason]

## Open questions
[Unresolved — needs a decision before building]
```

**The "Not doing" list is the most valuable part.** Focus is saying no to
good ideas; make the trade-offs explicit. MVP principles: one job done well;
the riskiest assumption tested first; time-box, not feature-list; if the
first version does not feel incomplete, you over-built.

Ask the owner whether to persist the one-pager to the configured harness
destination (`.scopegrain/` research or decisions path). Save only on
confirmation. The artifact is a contract for follow-on work — feed it to
`spec-driven-development` or `planning-and-task-breakdown`, not directly to
implementation.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "The idea is already clear" | If you cannot name the user, the pain and the binding constraint, it is not clear — it is plausible. Run Phase 1. |
| "Divergence wastes time" | Twenty minutes of lenses prevents building the elegant wrong thing — the most expensive failure mode there is. |
| "The owner asked for X, so X it is" | People ask for the conventional answer to their problem. The one-pager tests the problem, not just the request. |
| "Support the idea, they are excited" | Excitement is not evidence. A weak direction named now costs a paragraph; named after the build it costs the build. |

## Red flags

- Generating 20+ shallow variations instead of 5-8 considered ones.
- Yes-machining weak ideas instead of pushing back with specificity.
- Skipping "who is this for" — every good idea starts with a person and a
  pain.
- Producing a direction without surfacing assumptions — untested
  assumptions kill more ideas than bad execution.
- Over-engineering the process — three phases, each doing one thing.
- Ignoring the existing codebase — its architecture is constraint and
  opportunity.
- Jumping to the one-pager without running divergence and convergence.

## Verification

- [ ] A "How might we" problem statement exists
- [ ] Target user and success criteria are defined
- [ ] Multiple directions were explored, not just the first idea
- [ ] Assumptions are listed by class (must/should/might be true) with
      validation strategies
- [ ] A "Not doing" list makes trade-offs explicit
- [ ] The output is a persisted or explicitly-declined artifact, not just
      conversation
- [ ] The owner confirmed the direction before any downstream work
