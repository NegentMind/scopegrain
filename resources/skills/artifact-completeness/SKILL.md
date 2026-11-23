---
name: artifact-completeness
description: Use when completeness matters and large tool output or generated files risk silent truncation
---
# Artifact Completeness (Full-Output Enforcement)

Overrides default truncation behavior. Enforces complete generation,
bans placeholder patterns, and handles output-limit splits cleanly.
Apply to any task requiring exhaustive, unabridged artifacts.

## When to use

- Generating a full file, module, document or configuration where a
  skeleton would silently ship as "done"
- Producing N named deliverables (functions, components, sections,
  answers) where any subset is a failure
- Reviewing or judging large tool output (test logs, build output,
  dumps) where the truncated head is not the whole evidence
- Any handoff where a downstream consumer cannot tell a placeholder
  from a finished part

Not for: exploratory sketches the requester explicitly scoped as
partial, or prose answers whose length was never a requirement.

Treat every task as production-critical. **A partial output is a broken
output.** Do not optimize for brevity — optimize for completeness. If
the request asks for a full file, deliver the full file. If it asks for
5 components, deliver 5 components. No exceptions.

## Banned output patterns

The following are hard failures — never produce them:

**In code blocks:** `// ...`, `// rest of code`, `// implement here`,
`// TODO`, `/* ... */`, `// similar to above`, `// continue pattern`,
`// add more as needed`, bare `...` standing in for omitted code.

**In prose:** "Let me know if you want me to continue", "I can provide
more details if needed", "for brevity", "the rest follows the same
pattern", "similarly for the remaining", "and so on" (when replacing
actual content), "I'll leave that as an exercise".

**Structural shortcuts:** outputting a skeleton when the request was a
full implementation; showing the first and last section while skipping
the middle; replacing repeated logic with one example and a description;
describing what code should do instead of writing it.

## Execution process

1. **Scope** — Read the full request. Count how many distinct
   deliverables are expected (files, functions, sections, answers).
   Identify the actual required deliverables and acceptance boundaries.
   Lock that number.
2. **Build** — Generate every deliverable completely. Write complete
   files, not placeholder sections or omitted implementations. No
   partial drafts, no "you can extend this later".
3. **Cross-check** — Before output, re-read the original request.
   Compare deliverable count against the scope count. If anything is
   missing, add it before responding.

## Handling long outputs

When a response approaches the output limit:

- Do NOT compress remaining sections to squeeze them in.
- Do NOT skip ahead to a conclusion.
- Write at full quality up to a clean breakpoint (end of a function,
  end of a file, end of a section).
- End with:

```
[PAUSED — X of Y complete. Send "continue" to resume from: <next section>]
```

On "continue", pick up exactly where you stopped — no recap, no
repetition.

## Truncated tool output

When a tool truncates its output (test logs, build output, large reads):

- Read the omitted portion from a preserved artifact — log file,
  redirect, paged read — before judging it. Never evaluate "the rest" on
  the truncated head alone.
- Do not dump large files into chat to compensate; write them to their
  real paths and reference those paths.

## Honesty requirements

- State unfinished work explicitly — never hide it behind an upbeat
  summary.
- If a deliverable could not be completed, say which part, why, and
  what the next safe action is.
- Completeness never authorizes out-of-scope or unsafe actions — a
  "complete" file that bypasses validation is still a violation.

## Common rationalizations

|| Rationalization | Reality |
||---|---|
|| "The pattern is obvious — one example suffices" | Only if the request asked for an example. A "full" deliverable where item 4 of 7 is a comment is a broken deliverable. |
|| "They can ask me to continue" | That shifts your truncation onto the requester's attention. Deliver complete, or pause at a clean breakpoint with the marker. |
|| "Brevity is good manners" | Brevity is for prose. An abbreviated artifact is a defect the next reader cannot distinguish from finished work. |
|| "The middle sections are repetitive anyway" | Repetition is not license to elide — if the content is genuinely identical, the request probably wanted an abstraction, so say that instead of truncating. |
|| "I judged the log from the visible part" | Tool truncation is not a verdict boundary. Read the omitted portion from the preserved artifact before concluding. |

## Red flags

- Any banned pattern anywhere in the output — including in "just this
  one spot".
- A deliverable count silently different from the request's scope.
- A `[PAUSED]` marker at a non-clean break, or resume that recaps or
  repeats finished sections.
- Conclusions drawn from truncated tool output without reading the
  omitted portion.
- An upbeat summary that hides an unfinished or unverifiable part.
- A "complete" artifact that bypassed validation to get there.

## Output contract

The deliverable is **all of it or an explicit marker**: every item in
the scope count, complete; or a clean-break `[PAUSED — X of Y]` state
with an exact resume point; or an explicit statement naming which part
is unfinished, why, and the next safe action. Nothing else counts as
complete — a truncated artifact presented without its marker is a
silent defect, which is worse than an admitted pause.

## Quick check — before finalizing any response

- [ ] No banned patterns appear anywhere in the output
- [ ] Every item the user requested is present and finished
- [ ] Code blocks contain actual runnable code, not descriptions of
      what code would do
- [ ] Nothing was shortened to save space
- [ ] Any pause point uses the explicit `[PAUSED — X of Y]` marker
- [ ] Unfinished or unverifiable parts are stated as such
