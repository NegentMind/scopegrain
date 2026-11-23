---
name: systematic-debugging
description: Use when a test, command or observed behavior fails before proposing a code fix
---
# Systematic Debugging

Random fixes waste time and create new bugs. Quick patches mask
underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes.
Symptom fixes are failure. Violating the letter of this process is
violating the spirit of debugging.

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## When to use

Use for ANY technical issue: test failures, production bugs, unexpected
behavior, performance problems, build failures, integration issues.

**Use it ESPECIALLY when:**
- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- The previous fix didn't work
- You don't fully understand the issue

**Don't skip when:** the issue seems simple (simple bugs have root
causes too), you're in a hurry (rushing guarantees rework), or someone
wants it fixed NOW (systematic is faster than thrashing).

For interruption/partial-work recovery (resuming safely, preserving
outputs) rather than root-cause work, see
`debugging-and-error-recovery`.

## The phases

You MUST complete each phase before proceeding to the next.

### Phase 0 — Containment (production impact only)

**Only when there is live production impact (incident, service down):**

- FIRST mitigate/restore service: rollback, feature flag off, restart,
  scale out.
- Root-cause AFTER — never debug hot while the service is down.
- No production impact → skip straight to Phase 1.

### Phase 1 — Root cause investigation

**Before attempting ANY fix:**

1. **Read error messages carefully.** Don't skip past errors or
   warnings — they often contain the exact solution. Read stack traces
   completely. Note line numbers, file paths, error codes.
2. **Reproduce consistently.** Can you trigger it reliably? Exact steps?
   Every time? If not reproducible → gather more data, don't guess.
   Capture the exact failure, inputs, environment and the smallest
   reproducible boundary.
3. **Check recent changes.** What changed that could cause this? Git
   diff, recent commits, new dependencies, config changes, environment
   differences.
4. **Gather evidence across component boundaries.** When the system has
   multiple components (CI → build → signing; API → service → database),
   add diagnostic instrumentation BEFORE proposing fixes:

   ```
   For EACH component boundary:
     - Log what data enters the component
     - Log what data exits the component
     - Verify environment/config propagation
     - Check state at each layer

   Run once to gather evidence showing WHERE it breaks
   → then analyze evidence to identify the failing component
   → then investigate that specific component
   ```

5. **Trace data flow backward** when the error is deep in the call stack
   (see Root-Cause Tracing below). Where does the bad value originate?
   What called this with the bad value? Keep tracing up until you find
   the source — fix at the source, not at the symptom.

### Phase 2 — Pattern analysis

**Find the pattern before fixing:**

1. **Find working examples** — locate similar working code in the same
   codebase. What works that's similar to what's broken?
2. **Compare against references** — if implementing a pattern, read the
   reference implementation COMPLETELY. Don't skim — read every line.
   Understand the pattern fully before applying.
3. **Identify differences** — list every difference between working and
   broken, however small. Don't assume "that can't matter".
4. **Understand dependencies** — what other components does this need?
   Settings, config, environment? What assumptions does it make?

### Phase 3 — Hypothesis and testing

Scientific method:

1. **Form a single hypothesis.** State clearly: "I think X is the root
   cause because Y." Write it down. Be specific, not vague.
2. **Test minimally.** The SMALLEST possible change to test the
   hypothesis. One variable at a time. Don't fix multiple things at once.
   Choose a **discriminating** check — agreement with a symptom is not
   proof.
3. **Verify before continuing.** Worked → Phase 4. Didn't work → form a
   NEW hypothesis. DON'T add more fixes on top. If evidence contradicts
   the hypothesis, reassess rather than stacking fixes.
4. **When you don't know** — say "I don't understand X". Don't pretend.
   Ask for help. Research more.
5. **Make the reproduction automatable for bisection** — if the repro is
   deterministic with a non-zero exit code, leave it as a script so
   `git bisect run <script>` works; record the command in the task's
   repro section. Traps: commits that don't compile → `bisect skip`;
   interaction bugs between two commits (bisect points at the worst of
   the two).

### Phase 4 — Implementation

**Fix the root cause, not the symptom:**

1. **Create a failing test case.** Simplest possible reproduction —
   automated test if possible, one-off script if no framework. MUST
   exist before fixing. Use `test-driven-development` for the proper
   failing test.
2. **Implement a single fix.** Address the identified root cause. ONE
   change at a time. No "while I'm here" improvements. No bundled
   refactoring.
3. **Verify the fix.** Test passes now? No other tests broken? Issue
   actually resolved end-to-end?
4. **If the fix doesn't work — STOP.** Count attempts:
   - <3 failed fixes → return to Phase 1 with the new information.
   - **≥3 failed fixes → STOP and question the architecture (5).**
   - DON'T attempt fix #4 without an architectural discussion.
5. **3+ failed fixes ⇒ question the architecture.** Pattern indicating
   an architectural problem: each fix reveals new shared state/coupling
   in a different place; fixes require "massive refactoring"; each fix
   creates new symptoms elsewhere. Ask: is this pattern fundamentally
   sound? Are we sticking with it through inertia? Should we refactor
   instead of fixing symptoms? **Discuss with the owner before more
   fixes.** This is not a failed hypothesis — it's a wrong architecture.
6. **DMAIC for recurrent bugs.** For fixes to bugs that keep coming
   back: Define / Measure (baseline) / Analyze (root cause with data) /
   Improve / **Control** — the missing step is usually Control: without
   regression monitoring after the fix, the bug returns. Record a
   re-verification date/method when closing the fix.

## Supporting techniques

### Root-cause tracing (backward through the call chain)

Bugs manifest deep in the stack; instinct says fix where the error
appears — that's a symptom.

1. **Observe the symptom.** `Error: git init failed in packages/core`
2. **Find the immediate cause.** What code directly produces it?
   `execFile('git', ['init'], { cwd: projectDir })`
3. **Ask: what called this?** `WorktreeManager.createSession(dir)` →
   `Session.initializeWorkspace()` → `Session.create()` → test calls
   `Project.create()`.
4. **What value was passed?** `projectDir = ''` — empty string resolves
   to `process.cwd()` — the source tree!
5. **Find the original trigger.** `setupCoreTest()` returns
   `{ tempDir: '' }` — accessed before `beforeEach` ran.

Fix at the source (e.g. a getter that throws when accessed before
initialization), then **also** add defense-in-depth at each layer.

**When you can't trace manually, add stack instrumentation:** before the
dangerous operation (not after it fails), log context + `new
Error().stack`. In tests use `console.error`/stderr — a logger may be
suppressed. Capture the call site, cwd, env, timestamp. Analyze which
test/caller triggers the pattern.

**Finding a polluting test:** when something appears during tests but
you don't know which test — bisect by running tests one at a time and
checking for the artifact after each; stop at the first polluter.
Sketch:

```bash
for f in $TEST_FILES; do
  [ -e "$POLLUTION" ] && continue   # already dirty before run
  run_test "$f" >/dev/null 2>&1
  [ -e "$POLLUTION" ] && { echo "POLLUTER: $f"; break; }
done
```

### Defense-in-depth validation

A fix at one place can be bypassed by other paths, refactoring, or
mocks. **Validate at EVERY layer data passes through — make the bug
structurally impossible.** Single validation: "we fixed the bug".
Multiple layers: "we made the bug impossible".

| Layer | Purpose | Example |
|-------|---------|---------|
| 1. Entry point | Reject obviously invalid input at the API boundary | validate non-empty, exists, correct type |
| 2. Business logic | Ensure data makes sense for the operation | preconditions on domain values |
| 3. Environment guard | Prevent dangerous ops in specific contexts | refuse `git init` outside tmpdir under `NODE_ENV=test` |
| 4. Debug instrumentation | Capture forensics when layers fail | stack + context logging before the dangerous op |

Apply: trace the data flow → map every checkpoint → add validation at
each layer → test each layer by trying to bypass the one before it.

### Condition-based waiting

Flaky tests guess timing with arbitrary delays (`setTimeout`,
`sleep`) — race conditions that pass locally and fail under CI load.
**Wait for the actual condition, not a guess about duration.**

```
❌ await sleep(50); expect(getResult()).toBeDefined();
✅ await waitFor(() => getResult() !== undefined);
```

Generic poller: evaluate the condition inside the loop (fresh data, not
a cached snapshot), poll ~10 ms, always carry a timeout with a clear
error message ("Timeout waiting for <description> after N ms").

Common mistakes: polling too fast (1 ms — burns CPU); no timeout (hangs
forever); stale cached state (call the getter inside the loop).

**When an arbitrary timeout IS correct:** first wait for the triggering
condition, then wait a documented interval based on *known* timing
(e.g. "200 ms = 2 ticks of a 100 ms timer") — and comment WHY.

## Red flags — STOP and return to Phase 1

If you catch yourself thinking:

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I'll manually verify"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "Pattern says X but I'll adapt it differently"
- "Here are the main problems: [lists fixes without investigation]"
- Proposing solutions before tracing data flow
- **"One more fix attempt" (when already tried 2+)**
- **Each fix reveals a new problem in a different place**

ALL of these mean: STOP. Return to Phase 1. At 3+ failures, question the
architecture.

## Owner signals you're doing it wrong

- "Is that not happening?" — you assumed without verifying
- "Will it show us…?" — you should have added evidence gathering
- "Stop guessing" — you're proposing fixes without understanding
- "Think harder" — question fundamentals, not just symptoms
- "We're stuck?" (frustrated) — your approach isn't working

When you see these: STOP. Return to Phase 1.

## Common rationalizations

| Excuse | Reality |
|--------|---------|
| "Issue is simple, don't need process" | Simple issues have root causes too. The process is fast for simple bugs. |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check thrashing. |
| "Just try this first, then investigate" | The first fix sets the pattern. Do it right from the start. |
| "I'll write the test after confirming the fix" | Untested fixes don't stick. Test first proves it. |
| "Multiple fixes at once saves time" | Can't isolate what worked — causes new bugs. |
| "Reference too long, I'll adapt the pattern" | Partial understanding guarantees bugs. Read it completely. |
| "I see the problem, let me fix it" | Seeing symptoms ≠ understanding root cause. |
| "One more fix attempt" (after 2+) | 3+ failures = architectural problem. Question the pattern, don't fix again. |

## Quick reference

| Phase | Key activities | Success criteria |
|-------|---------------|------------------|
| 0. Containment | Mitigate live impact first (production only) | Service restored |
| 1. Root cause | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY |
| 2. Pattern | Working examples, compare | Differences identified |
| 3. Hypothesis | Theory, minimal discriminating test | Confirmed or new hypothesis |
| 4. Implementation | Failing test, single fix, verify | Bug resolved, tests pass |

## When the process reveals "no root cause"

If systematic investigation shows the issue is truly environmental,
timing-dependent or external: you've completed the process — document
what you investigated, implement appropriate handling (retry, timeout,
clear error message), and add monitoring/logging for future
investigation. **But:** ~95% of "no root cause" cases are incomplete
investigation. Report honestly when reproduction or causal confirmation
remains unavailable.

A failure may also have **several contributing causes**: a linear
why-chain that stops at the first cause leaves the second to recur.
When the confirmed cause explains only part of the symptom set, keep
investigating — each remaining unexplained symptom is its own Phase 1.

## Output contract

The deliverable of this process is not "it works again" — it is:

1. The documented root cause (what failed, why, the evidence chain).
2. A failing test or reproducer that proved the cause before the fix.
3. The minimal fix at the source, plus defense-in-depth where the data
   crosses layers.
4. The regression case that survives the session.
5. An honest account of what remains unverified — environmental,
   intermittent or externally caused elements are named as such.

Resuming after an interruption, or recovering a delegate that returned
an incomplete result, is `debugging-and-error-recovery`'s contract —
finish the root-cause loop here first when the cause is still open.

## Boundaries

- Capture the exact failure, inputs, environment and reproducible
  boundary before proposing anything.
- Commands run under the host's permission model — propose exact
  commands when execution is owner-reserved; never claim an unexecuted
  check proved a fix.
- A passing fix is evidence for that boundary; the regression test is
  the durable artifact.
