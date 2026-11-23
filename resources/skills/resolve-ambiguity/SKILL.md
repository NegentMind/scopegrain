---
name: resolve-ambiguity
description: Use when a consequential ambiguity remains after inspecting the project and available decisions
---
# Resolve Ambiguity

What people ask for and what they actually want are different things. They
ask for "a dashboard" because that is the conventional answer, not because
it solves their problem. The cheapest moment to close this gap is before
any plan, spec or code exists — once building starts, switching costs are
real and the misfit gets rationalized into "good enough."

Derive what local evidence already answers before questioning the owner.
Ask one consequential question at a time, with concrete alternatives,
tradeoffs and a recommendation when justified.
Do not ask the owner to rediscover source facts.
Treat skipped questions as a request to use safe judgment, not approval
for a destructive or external action.
Record approved choices without converting preferences into security grants.

## Loading constraint

This skill needs a live, responsive owner. In non-interactive contexts (CI,
scheduled runs, autonomous loops), record the ambiguity as a blocker in the
task record instead of guessing.

## When to use

- The ask is missing at least one of: **who** it is for, **why**, what
  **success** looks like, or the binding **constraint**.
- The request is conventional rather than specific ("build me X", "make it
  faster") and unpacking it requires guessing.
- You are tempted to start on assumptions you have not surfaced.
- Two reasonable values are in tension (simplicity vs flexibility, speed vs
  cost) and the owner has not said which to optimize.

**When not to use:** unambiguous self-contained asks, mechanical operations,
pure information requests, or when you can already predict the owner's
answers — re-read the stop condition below before assuming you cannot.

## Canonical position

This skill owns the **interview mechanics** for the family: hypothesis with
a confidence number, one question at a time with a guess attached, the
want-vs-should-want probe, the restate and the explicit yes.
`clarify-intent`, `brainstorming`, `constraint-driven-development` and the
specification intake in `spec-driven-development` all run these mechanics;
their files keep their own procedures and reference this one.

Inside the gated pipeline the form changes, not the substance:
`decision-request` batches the questions into **one structured round per
gate** (Gates P/D/V/C) rather than an open interview — follow it when a
recorded gate is the reason you are asking. A stated premise that should
be challenged rather than elicited routes to `discernment-nudge`.

## The process

### Step 1: Hypothesize, with a confidence number

Before asking anything, write down your best read in one sentence plus an
honest confidence number (0-100%):

```
HYPOTHESIS: You want a way to answer "how are we doing?" in standup, and
            "dashboard" was the convention that came to mind.
CONFIDENCE: ~30% — missing: who it is for, what "metrics" means here, what
            success looks like
```

The number forces honesty. If you wrote a high number but cannot predict
reactions to the next three questions you would ask, the number is wrong.
Below ~70%, append a one-line reason — what is still unresolved — so the
owner knows exactly what the interview must surface.

### Step 2: One question at a time, each with a guess attached

```
Q:     <one focused question>
GUESS: <your hypothesis for the answer, with the reasoning behind it>
```

Wait for the reaction before the next question. Why one at a time: owners
cannot react to buried hypotheses; batches encourage skim-reading; the third
question often depends on the first answer; attention is finite — spend it
one question at a time. Why a guess: reacting to a wrong guess is faster
than generating an answer; it commits you to a hypothesis you can be visibly
wrong about; it exposes *your* assumptions, which is the point.

The risk is a polite owner agreeing to be agreeable. Mitigate by being
visibly willing to be wrong — occasionally guess in a direction you expect
pushback on.

### Step 3: Listen for "want" vs "should want"

The most dangerous answers sound like what a thoughtful answer *should* be:
best-practice talk without specifics ("scalable", "clean architecture"),
deference to convention ("the standard approach"), "I should probably…",
buzzwords as goals. When you hear them, ask:

> *"If you didn't have to justify this to anyone, what would you actually
> want?"*

That single question often does more work than the previous five.

### Step 4: Restate intent in the owner's words

When confidence is high, write back what you now think they want — 5-8
lines, their language, structured for line-by-line confirm or correct:

```
Here's what I now think you want:

- Outcome:      <one line>
- User:         <one line — who benefits>
- Why now:      <one line — what changed>
- Success:      <one line — how we know it worked>
- Constraint:   <one line — the binding limit>
- Out of scope: <one line — what we are explicitly not doing>

Yes / no / refine?
```

"Out of scope" is non-negotiable: half of misalignment is silent
disagreement about what is not being built.

### Step 5: Confirm — explicit yes, not "whatever you think"

The gate is an explicit yes. These are **not** yes:

- "Whatever you think is best." → Delegation, not decision. Re-ask with two
  concrete options framed as a choice.
- "Sounds good." → Ambiguous. Ask "anything you'd refine?" Silence is not
  confirmation.
- "Sure, let's go." → Often a polite exit, not endorsement. Same follow-up.
- Silence then "okay let's start." → The owner gave up on the interview,
  not converged. Stop and ask what you missed.

Fold corrections in and restate. Loop until an explicit yes.

### The stop condition

You are done when you can answer yes to:

> *Can I predict the owner's reaction to the next three questions I would
> ask?*

This is a checkable test, not a vibe — and it has a floor: after several
rounds without being able to predict, that is information about the ask.
Stop and say so: "I've asked X questions and still can't predict your
reactions. Something foundational is missing. Step back?"

## Output

The deliverable is a **confirmed statement of intent** — the restate plus an
explicit yes. Specs, plans and task records are downstream consumers. If the
intent should persist across sessions, offer to save it under the configured
`.scopegrain/` destination; save only on confirmation.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "The ask is clear enough" | If you cannot write the desired outcome in one sentence, it is not clear. Run Step 1 first. |
| "Questions waste their time" | 4-6 targeted questions cost minutes; building the wrong thing costs days — borne by the owner. |
| "I'll figure it out as I build" | Switching costs after code exists are 10x. Discovery during implementation is rework. |
| "They said 'whatever you think,' so I decide" | Delegation, not decision. Re-ask with two concrete options. |
| "Offering options is better than asking" | Options work when the owner knows what they want and is choosing trade-offs. Here they do not know yet — asking narrows; options widen. |
| "Attaching my guess leads them" | Leading is the point — reacting beats generating. The risk is sycophancy; mitigate by being visibly willing to be wrong. |
| "We've talked enough, I get it" | Test it: can you predict the next three reactions? If not, you do not. |
| "They said yes, done" | A yes after a vague restate or "sounds good" is hollow. Restate concretely and re-confirm. |

## Red flags

- Three or more questions in one message — that is batching, not asking.
- A question without your hypothesis attached — surveying, not committing.
- Accepting "whatever you think is best" as a terminal answer.
- Producing a spec, plan or task list before explicit confirmation.
- Accepting sophistication-signaling answers ("scalable", "modern") without
  probing what the owner actually wants.
- Several rounds with confidence not visibly rising — wrong questions;
  reframe.
- A confidence number under ~70% with no reason attached.
- Saving the intent record before confirmation.
- Skipping the "out of scope" line in the restate.
- Converting a stated preference into authorization for a destructive or
  external action.

## Verification

- [ ] An explicit hypothesis with a confidence number opened the interview
- [ ] Every sub-70% confidence carried a one-line reason
- [ ] Questions ran one at a time, each with a guess attached
- [ ] At least one "what would you actually want?" probe ran when answers
      signaled convention or sophistication
- [ ] A concrete restate (outcome / user / why-now / success / constraint /
      out-of-scope) was written back
- [ ] The owner confirmed with an explicit yes
- [ ] At the stop point, the next three reactions were predictable
- [ ] Any downstream handoff is framed in the confirmed intent, not the
      original underspecified ask
