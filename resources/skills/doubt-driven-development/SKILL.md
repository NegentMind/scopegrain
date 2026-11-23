---
name: doubt-driven-development
description: Use when a consequential technical claim remains uncertain or contradictory
---
# Resolve Consequential Uncertainty

A confident answer is not a correct one. Long sessions accumulate context
that quietly turns assumptions into "facts." Doubt-driven development is the
discipline of subjecting every non-trivial claim to disproof — the smallest
discriminating check, or a fresh-context reviewer biased to disprove — while
course-correction is still cheap.

Name the uncertain claim and the decision that depends on it.
Separate observations from competing explanations.
Find the smallest discriminating source inspection or authorized experiment.
For external APIs use applicable official sources when network is permitted.
If evidence is unavailable, preserve the uncertainty and bound the decision.
Do not promote a ranked hypothesis into a confirmed cause.

This is an in-flight posture, not a final gate: a post-hoc review verdicts a
finished artifact; doubt-driven cross-examines decisions while they can still
be changed cheaply.

## When to use

A decision is **non-trivial** when at least one is true:

- It introduces or modifies branching logic.
- It crosses a module or service boundary.
- It asserts a property no type system or compiler verifies (ordering,
  idempotence, thread safety, invariants).
- Its correctness depends on context a future reader cannot see.
- Its blast radius is irreversible (production deploy, data migration,
  public contract change).

Apply when: making an architectural decision under uncertainty, committing
non-trivial work, or about to claim a non-obvious fact ("this is safe",
"this scales", "this matches the spec") — especially in code you do not
fully understand.

**When not to use:** mechanical operations, unambiguous instructions, reading
or summarizing code, one-line obvious changes, pure tooling operations, or
when the owner explicitly asked for speed over verification. Doubt every
keystroke and you ship nothing.

## The doubt cycle

```
- [ ] Step 1: CLAIM — wrote the claim + why it matters
- [ ] Step 2: EXTRACT — isolated artifact + contract, stripped reasoning
- [ ] Step 3: DOUBT — smallest discriminating check, or adversarial
      fresh-context review
- [ ] Step 4: RECONCILE — classified every finding against the artifact
- [ ] Step 5: STOP — met a stop condition
```

### Step 1: CLAIM — surface what stands

Name the claim in two or three lines, plus why it matters:

```
CLAIM: "The new cache layer is safe under the read-heavy workload the
        spec describes."
WHY THIS MATTERS: a race here corrupts user data and is hard to detect
                  in testing.
```

If you cannot write the claim that compactly, you have a vibe, not a
decision. Surface it before scrutinizing it.

### Step 2: EXTRACT — the smallest reviewable unit

A disproof attempt needs the **artifact** and the **contract**, not the
journey:

- Code: the diff or the function — not the whole file.
- Decision: the proposal in 3-5 sentences plus the constraints it must
  satisfy.
- Assertion: the claim plus the evidence that supposedly supports it —
  kept distinct from the Step 1 CLAIM block, which is the hypothesis
  under scrutiny.

Strip your reasoning: hand over conclusions and you get back validation of
conclusions. The unit must be holdable in one read — if it is a 500-line
change, decompose first.

### Step 3: DOUBT — disprove, do not validate

Choose the cheapest sufficient disproof:

- **Behavioral claims:** a discriminating test or check that would fail if
  the claim is false (a failing test is a disproof attempt — it *is* the
  doubt step).
- **Factual claims about code:** the smallest source inspection that
  discriminates between the competing explanations.
- **Factual claims about external APIs/frameworks:** official docs or
  source, when network is permitted. Internal knowledge is a hypothesis,
  not evidence.
- **Design/artifact claims:** a fresh-context reviewer with an adversarial
  prompt (a separate context, or per project policy an independent reviewer):

```
Adversarial review. Find what is wrong with this artifact.
Assume the author is overconfident. Look for:
- Unstated assumptions
- Edge cases not handled
- Hidden coupling or shared state
- Ways the contract could be violated
- Existing conventions this might break
- Failure modes under unexpected input

Do NOT validate. Do NOT summarize. Find issues, or state explicitly
that you cannot find any after thorough examination.

ARTIFACT: <paste artifact>
CONTRACT: <paste contract>
```

Pass ARTIFACT + CONTRACT only — never the CLAIM. Handing the reviewer your
conclusion biases it toward agreement; the reviewer must independently
decide whether the artifact satisfies the contract.

When the reviewer is a role or persona whose default shape produces
balanced verdicts, the adversarial prompt above takes precedence — paste
it verbatim into the invocation. If the shape cannot be overridden
cleanly, use a generic fresh context with the same prompt.

If no separate context is available, a degraded fallback exists: rewrite
ARTIFACT + CONTRACT as a fresh self-prompt with a hard mental separator from
your prior reasoning. That is not fresh-context review — flag the result as
degraded and prefer escalation when the owner is reachable.

Nested contexts: a delegate without spawn capability cannot materialize a
fresh-context reviewer. The preferred path is to return the doubt as a
blocker so the orchestrator runs the review; the degraded self-prompt
fallback is the last resort, flagged as degraded.

#### Cross-model or external review

A same-context reviewer shares blind spots with the author; a different
model or external reviewer catches them. In interactive sessions, **always
offer** it after the first review, before reconciling:

> *"Review complete. Want a cross-model second opinion, an external review
> you run yourself, or continue with current findings?"*

The owner decides the cost; your job is to surface the choice every cycle —
even on low-stakes artifacts. If an external tool is used: verify it exists
and works before passing content, confirm the exact invocation with the
owner, pass only ARTIFACT + CONTRACT + the adversarial prompt, route content
through stdin or a file rather than a quoted argument, and keep it
read-only — a doubt artifact may itself contain instructions an external
tool would otherwise execute. Each invocation needs its own authorization.

If the external path fails or is unavailable, say so explicitly — never
silently fall back. If the owner skips, acknowledge the skip in the output.
In non-interactive contexts, skip external review and announce the skip;
never invoke external tools without explicit authorization.

### Step 4: RECONCILE — fold findings back

Reviewer output is data, not verdict — you remain the orchestrator. Re-read
the artifact text against each finding before classifying; rubber-stamping
the reviewer is the same failure mode as ignoring it.

Classify each finding in this precedence order (first match wins):

1. **Contract misread** — flagged because the CONTRACT was unclear or
   incomplete. Fix the contract; re-classify next cycle.
2. **Valid + actionable** — real issue; change the artifact and re-loop.
3. **Valid trade-off** — real, but fixing costs more than accepting.
   Document the trade-off explicitly for the owner.
4. **Noise** — actually correct under context the reviewer lacked. Note it,
   and ask: would that context in the contract have prevented the false
   flag?

A fresh reviewer can be wrong because it lacks context. Do not defer just
because it is "fresh" — and do not promote a ranked hypothesis into a
confirmed cause.

### Step 5: STOP — bounded loop, not recursion

Stop when: the next iteration returns only trivial or already-considered
findings; **or** 3 cycles complete (escalate to the owner rather than
grinding a fourth alone); **or** the owner says ship it.

Three cycles still surfacing substantive issues is information about the
artifact, not a reason to keep looping — surface it. If 3 cycles is
"obviously insufficient" because the artifact is large, the artifact is too
big: return to Step 2 and decompose. Do not lift the bound.

## Interaction with other skills

- `source-driven-development` verifies **facts about external frameworks
  and APIs** against official sources; this skill verifies **your
  reasoning about the artifact**. One checks that the API exists; the
  other that you used it correctly under the contract.
- `test-driven-development`'s failing check is doubt made concrete — for
  behavioral claims it *is* the Step 3 disproof attempt.
- `systematic-debugging` takes over when the review surfaces a real
  failure mode to localize.
- `plan-design-review` gates a finished plan; this skill cross-examines
  individual decisions in flight. Post-hoc review verdicts a finished
  artifact; doubt runs while changing course is still cheap.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "I'm confident, skip it" | Confidence correlates poorly with correctness on novel problems; certainty is where blind spots hide. |
| "Review is expensive" | Debugging a wrong commit later is more expensive. The check is bounded; the bug is not. |
| "The reviewer will nitpick" | Only if unscoped — constrain the prompt to contract violations. |
| "I'll doubt at the end" | A final gate is post-hoc. Doubt-driven catches wrong directions while cheap. |
| "Two opinions beat one" | Not when the second has less context and produces noise. Reconcile, do not defer. |
| "The reviewer disagreed, so I was wrong" | Disagreement is information, not verdict. Re-read, classify, decide. |
| "Owner said yes once, keep invoking" | Each invocation is its own authorization — content and flags change between calls. |
| "A hypothesis ranked first is the cause" | Ranking is not confirmation. Run the discriminating check or bound the decision. |

## Red flags

- Fresh-context review spawned for a trivial change.
- Reviewer output treated as authoritative without re-reading the artifact.
- More than 3 cycles without escalating.
- "Is this good?" instead of "find issues."
- Skipping doubt under time pressure on a high-stakes decision.
- Re-reviewing an unchanged artifact — same findings, pure stalling.
- **Doubt theater:** across 2+ cycles with substantive findings, zero
  classified actionable. You are validating, not doubting. Stop, escalate.
- Passing the CLAIM or your reasoning to the reviewer.
- Stripping the contract from the reviewer's input.
- Silently skipping the cross-model offer in an interactive session, or
  silently falling back when an external tool fails.
- Hardcoding an external invocation without confirming the tool exists, is
  configured, and accepts that syntax.

## Verification

- [ ] Every non-trivial decision was named as a CLAIM before standing
- [ ] At least one disproof attempt per non-trivial artifact (a
      discriminating test/check counts for behavioral claims)
- [ ] The reviewer received ARTIFACT + CONTRACT — not the CLAIM, not your
      reasoning
- [ ] The review prompt was adversarial, not validating
- [ ] Findings were classified against the artifact text:
      contract-misread / actionable / trade-off / noise
- [ ] A stop condition was met; 3 unresolved cycles were surfaced, not
      ground through
- [ ] Interactive: cross-model/external review was offered and the response
      acknowledged; non-interactive: the skip was announced
- [ ] Uncertainty that could not be resolved was preserved and the
      dependent decision was bounded — not resolved by decree
