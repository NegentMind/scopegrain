---
name: brainstorming
description: Use before choosing a feature design when requirements or tradeoffs remain unsettled
---
# Design Exploration

Turn an idea into a settled design through collaborative dialogue before any
implementation. Start from project context, ask questions one at a time to
refine the idea, then present the design in small validated sections.

Inspect whether the requested behavior already exists and why it falls short.
State the problem, constraints, non-goals and success cases.
Compare a small set of concrete approaches including the simplest viable one.
Ask focused questions only for consequential unresolved choices.
Settle boundaries and acceptance before assigning implementation.
Preserve the approved decision in the harness workspace.

## When to use

- The problem is understood but the **design** is not settled — several
  viable approaches exist and one must be chosen before planning.

Do not use it when the raw product idea itself is still unformed (that is
`clarify-intent` — ideation before design), when a missing fact rather
than a design choice is blocking (that is `resolve-ambiguity`), or when
the design is already settled (go straight to `writing-plans`).

This skill owns the design-settlement dialogue: alternatives compared and
sections validated incrementally. The interview mechanics it runs on —
hypothesis-with-guess, one question at a time, explicit confirmation —
are canonical in `resolve-ambiguity`.

## The process

### Understand the idea

- Check current project state first — files, docs, recent decisions.
- Ask questions **one at a time**. Batches encourage skim-reading and
  surface answers; the third question often depends on the first answer.
- Prefer multiple-choice questions with a recommended option; open-ended is
  acceptable when options genuinely cannot be enumerated.
- Focus on: purpose, constraints, success criteria, non-goals.

### Explore approaches

- Propose 2-3 meaningfully different approaches with trade-offs — not
  variations on one theme.
- Lead with your recommendation and the reasoning behind it.
- Always include the simplest viable approach; complexity must earn its place.

### Present the design incrementally

- Break the design into sections of ~200-300 words.
- After each section, ask whether it looks right so far. Do not dump the
  whole design at once — a late "no" wastes everything after the divergence
  point.
- Cover: architecture, components, data flow, error handling, verification
  approach.
- Go back and clarify whenever a section does not land. Iterating a section
  is normal, not failure.

## After the design

- Write the validated design to the configured harness destination
  (`.scopegrain/` plans or decisions path per project config), only after
  the owner confirms it.
- For implementation, hand off to `writing-plans` for the executable plan
  and `planning-and-task-breakdown` for task decomposition. Ask before
  proceeding — an approved design is not authorization to build.

## Key principles

- **One question at a time** — never overwhelm with a questionnaire.
- **YAGNI ruthlessly** — remove unneeded features from every design.
- **Explore alternatives** — always 2-3 approaches before settling.
- **Incremental validation** — sections, not documents.
- **Be flexible** — revisit earlier sections when later answers contradict.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "Jump straight to planning" | An unsettled design inside a plan becomes rework inside a diff. Settle the approach while changing it is free. |
| "Ask everything up front" | Batches get skimmed and answered shallowly; the third question usually depends on the first answer. |
| "Present the whole design once" | A late "no" wastes every section after the divergence point. Incremental validation bounds the loss. |
| "One approach, well told" | A single option hides the trade-offs the owner is entitled to weigh — always compare, always include the simplest viable one. |

## Red flags

- Asking several questions in one message.
- Presenting a full design without section-by-section validation.
- One approach offered as the only option.
- Design saved before the owner confirmed it.
- Proceeding to implementation on the strength of a written design alone.

## Verification

- [ ] Existing behavior and its shortcomings were inspected before proposing
- [ ] Two or three meaningfully different approaches were compared —
      including the simplest viable one — with a stated recommendation
- [ ] The design was presented and confirmed section by section, not dumped
- [ ] Boundaries, non-goals and acceptance were settled in the dialogue
- [ ] The design record was persisted only after owner confirmation
- [ ] Implementation handoff was asked, not assumed
