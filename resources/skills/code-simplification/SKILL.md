---
name: code-simplification
description: Use to remove demonstrated duplication or complexity from an approved change scope
---
# Code Simplification

## Core discipline

Inspect the behavior, callers and project idioms before choosing a change.
Identify what is actually redundant and why removal is safe.
Protect observable behavior with scoped regression checks.
Prefer a smaller coherent representation over a new abstraction layer.
Do not chase arbitrary line-count goals, rewrite unrelated code or weaken
validation to make a design look simpler.
Report preserved behavior, changed boundaries and residual uncertainty.

Simplify by reducing complexity while preserving exact behavior. The goal is
not fewer lines — it is code that is easier to read, understand, modify and
debug. Every simplification must pass one test: "Would a new team member
understand this faster than the original?"

## When to use

- A feature works and checks pass, but the implementation is heavier than needed.
- Review flags readability or complexity issues.
- Deeply nested logic, long functions or unclear names are encountered.
- Related logic is scattered, duplicated or inconsistent after merges.

**Not for:**

- Code already clean — do not simplify for its own sake.
- Code not yet understood — comprehend before simplifying.
- Performance-critical paths where the "simpler" version is measurably slower.
- Code about to be rewritten entirely.

## The five principles

### 1. Preserve behavior exactly

Change only how code expresses itself, never what it does. Inputs, outputs,
side effects, error behavior and edge cases stay identical.

```
ASK BEFORE EVERY CHANGE:
→ Same output for every input?
→ Same error behavior and ordering of side effects?
→ Do all existing checks pass WITHOUT modification?
```

If a simplification cannot be shown to preserve behavior, do not make it.

### 2. Follow project conventions

Simplification aligns code with the codebase, not with personal preference.
Before editing, read the project's conventions and study how neighboring
code handles the same patterns — naming, module style, error handling,
annotation depth. Simplification that breaks project consistency is churn,
not simplification.

### 3. Prefer clarity over cleverness

Explicit beats compact when the compact version requires a mental pause.

```
UNCLEAR: const label = a ? 'A' : b ? 'B' : c ? 'C' : 'D';
CLEAR:   a named function with early returns per case.

UNCLEAR: a chained reduce that rebuilds a map inline.
CLEAR:   a named accumulator filled by a plain loop.
```

### 4. Maintain balance — avoid over-simplification

- **Inlining too aggressively** — a helper that names a concept aids reading.
- **Combining unrelated logic** — two simple functions merged into one
  complex one is not simpler.
- **Removing "unnecessary" abstraction** — some abstractions exist for
  extensibility or testability, not complexity.
- **Optimizing for line count** — comprehension speed is the metric.

### 5. Scope to what changed

Default to simplifying code inside the approved change scope. Avoid drive-by
refactors of unrelated code; unscoped simplification creates noisy diffs and
risks regressions nobody asked for.

## The simplification process

### Step 1: Understand before touching (Chesterton's Fence)

Never remove what you cannot explain. If a fence crosses the road and its
purpose is unknown, find the purpose before tearing it down.

```
BEFORE SIMPLIFYING, ANSWER:
- What is this code's responsibility?
- What calls it? What does it call?
- What are the edge cases and error paths?
- Do tests define the expected behavior?
- Why might it have been written this way?
  (performance? platform constraint? historical reason?)
- What does the change history say about its original context?
```

If these cannot be answered, read more context first.

### Step 2: Identify concrete opportunities

Each pattern below is a signal, not a vague smell.

**Structural complexity**

| Pattern | Signal | Simplification |
|---|---|---|
| Deep nesting (3+ levels) | Control flow hard to follow | Guard clauses or extracted helpers |
| Long functions (~50+ lines) | Multiple responsibilities | Split into named, focused functions |
| Nested ternaries | Requires a mental stack | if/else chain, switch or lookup table |
| Boolean parameter flags | `doThing(true, false, true)` | Options object or separate functions |
| Repeated conditionals | Same check in many places | One well-named predicate |

**Naming and readability**

| Pattern | Signal | Simplification |
|---|---|---|
| Generic names | `data`, `result`, `temp`, `item` | Rename to describe content |
| Abbreviations | `usr`, `cfg`, `evt` | Full words unless universal (`id`, `url`) |
| Misleading names | `getX` that mutates state | Rename to actual behavior |
| "What" comments | `// increment counter` over `count++` | Delete — code is clear enough |
| "Why" comments | `// retry: API is flaky under load` | Keep — intent code cannot express |

**Redundancy**

| Pattern | Signal | Simplification |
|---|---|---|
| Duplicated logic | Same 5+ lines in several places | Extract a shared function |
| Dead code | Unreachable branches, unused vars | Remove after confirming it is dead |
| Valueless wrappers | Indirection that adds nothing | Inline the call |
| Over-engineering | Factory-for-a-factory, one-strategy strategy | Replace with the direct approach |
| Redundant assertions | Casting an already-inferred type | Remove the assertion |

### Step 3: Apply changes incrementally

One simplification at a time, verified after each:

```
FOR EACH SIMPLIFICATION:
1. Make the change
2. Run the scoped checks the repository declares
3. Green → commit (or continue)
4. Red → revert and reconsider
```

Never batch simplifications into one untested change — when something
breaks, the culprit must be identifiable. **Rule of 500:** if a refactor
would touch more than ~500 lines, invest in automation (codemods, scripted
transforms) instead of manual edits.

### Step 3b: Two-hat discipline

Separate behavior changes from structure changes into **distinct commits**
with the suite green between them — the behavior hat (feature/fix; output
changes) or the structure hat (refactor; output identical), never both.

```
REFACTOR CHECK — before committing the structure hat:
1. Checks green before (baseline, unmodified)
2. Make structure-only changes
3. Run the SAME checks — must be green WITHOUT touching tests
4. A test needing edits → the change was behavior; split it out
```

A "refactor" that requires editing tests to pass is a behavior change in
disguise. Keep each hat reviewable alone.

### Step 4: Verify the result

```
COMPARE BEFORE AND AFTER:
- Is the result genuinely easier to understand?
- Any new patterns inconsistent with the codebase?
- Is the diff clean and reviewable?
- Would a reviewer approve this as a net improvement?
```

If the "simplified" version is harder to read or review, revert it. Not
every simplification attempt succeeds.

## Common substitutions

Mechanical wins that preserve behavior in any language:

```
redundant boolean return:
  if (x) return true; return false;   →   return x;

manual filter loop:
  out = []; for i in items { if p(i) out.push(i) }
                                      →   items.filter(p)  // or comprehension

nested validation:
  if (a) { if (b) { work } else err } else err
                                      →   guard clauses + early errors, then work

unnecessary async wrapper:
  async f(x) { return await g(x) }    →   f(x) { return g(x) }

inline literal config:
  options = { sort: 'date' } each call →  hoist to a named constant
```

The shape differs per language and framework — the test is always the
same: identical observable behavior, faster comprehension.

## Output contract

A simplification pass reports:

- Which patterns were found and which were applied (with file locations).
- Preserved behavior — the same checks, unmodified, green before and after.
- Changed boundaries, if any (new helper, moved responsibility).
- Residual uncertainty — anything simplified without full confidence in
  the original's intent (Chesterton's Fence left standing is stated, not
  hidden).

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "It's working, no need to touch it" | Working code that is hard to read is hard to fix when it breaks. |
| "Fewer lines is always simpler" | A 1-line nested ternary is not simpler than a 5-line if/else. |
| "I'll quickly simplify this unrelated code too" | Unscoped edits create noisy diffs and risk regressions elsewhere. |
| "The types make it self-documenting" | Types document structure, not intent. Names carry the why. |
| "This abstraction might be useful later" | Speculative abstraction is complexity without value; remove it. |
| "The original author had a reason" | Maybe — check the history. Accumulated complexity is often just residue. |
| "I'll refactor while adding this feature" | Mixed changes are harder to review, revert and understand. Split them. |

## Red flags

- A "simplification" that requires modifying tests to pass (behavior changed).
- Output longer or harder to follow than the original.
- Renames matching personal preference rather than project conventions.
- Error handling removed "to make the code cleaner".
- Simplifying code not fully understood.
- Many simplifications batched into one hard-to-review commit.
- Validation weakened or removed to make a design look simpler.
- Edits outside the approved change scope without owner request.

## Verification

- [ ] All existing checks pass without modification.
- [ ] Build clean, no new warnings; lint/format pass.
- [ ] Each simplification is a reviewable, incremental change.
- [ ] The diff is clean — no unrelated changes mixed in.
- [ ] Result follows project conventions.
- [ ] No error handling removed or weakened; no dead code left behind.
- [ ] Report states preserved behavior, changed boundaries and residual
      uncertainty — a reviewer would call it a net improvement.

## See also

- `incremental-implementation` — one simplification per verified slice.
- `work-unit-commits` — behavior and structure changes ship as separate
  commits (two-hat discipline).
- `deprecation-and-migration` — when the redundant thing is a whole
  system, not a function.
- `code-review-and-quality` — where complexity findings typically surface.
