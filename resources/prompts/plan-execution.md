---
name: plan-execution
description: Execute an approved plan end to end — orchestrator loop, per-task protocol, gates, recovery and close-out.
---
# Plan Execution

Two layers, one file: **Part A — the orchestrator loop** that walks an
approved plan dispatching one task at a time to fresh delegated contexts;
**Part B — the single-task protocol** every delegate (or an inline fallback)
executes at full depth. Loaded by `coordinate-plan` for a full-plan run and
embedded in every worker brief it dispatches. Every task passes
DISCOVERY → EXECUTION → CLOSURE; never inline seven-line task prompts.

Question gates D/V/C apply inside every delegate per `decision-request`; the
orchestrator does not re-ask what was decided. Recovery of any non-DONE
result follows `recovery-brief`. Handoff blocks follow `session-recitation`.

State mutations, verification records, plan reads, memory writes, session
tracking, budgets and journal events go through the harness task runtime
when bound; otherwise persist the equivalent records under `.scopegrain/`
through approved harness operations. Under manual verification, propose
exact commands + directories; the owner runs them and returns output —
never claim an unexecuted check passed.

## PART A — Orchestrator loop

Parameters: `FAIL_MODE = stop | skip | parallel` (declared per run). `stop`:
halt on first failure. `skip`: record and continue. `parallel`: run
independent tasks in dependency waves.

1. **Read the plan** through the runtime: plan identity, summary
   (completed/failed/pending), continuation block, next ready task. No plan
   → report and stop.
2. **Session tracking:** open a session record at start; update per completed
   task; write the final state at end.
3. **Integrity probes before starting:** (a) the plan exists and has tasks;
   (b) the continuation block is legible; (c) the same task is not repeating
   with no progress; (d) `git status` is clean or the changes belong to this
   run; (e) any declared index/graph capability is healthy enough for the
   task's key files — re-index only if the check says the needed paths are
   stale. A failed probe → ask the owner before continuing.
4. **Claim the next ready task atomically** through the runtime: a second
   instance must not start discovery on the same task. If the claim is
   blocked, take the next pending task or wait. No pending tasks → campaign
   complete (§A.7).
5. **While pending tasks exist — per task, full depth:**

   a. Identify `id`, description, contract, key files and its declared route
      (destination role). If a task record already exists, read it to learn
      where it stopped (done/pending steps, context save point).
   b. If `FAIL_MODE=parallel` and ≥2 independent tasks → go to §A.6 (waves).
   c. **No orchestrator skill-loading:** the real skill-discovery pass runs
      inside the delegate (Part B, step 0b). The orchestrator only detects
      type for routing — never double-load.
   d. **Research isolation:** if the task needs many files (3+) or heavy
      docs, spawn a read-only research delegate FIRST (`research-brief`
      digest format), keep the digest, pass it into the execution brief —
      it must not eat the executor's context.
   e. **Routing — never generic delegates.** Map the task's declared route to
      an available authorized role (implementer default; security-auditor for
      security/delivery surfaces; researcher for research; documentation for
      docs; performance-engineer for perf; lead for release/coordination).
      Take only the first token if the route carries a parenthetical like
      "(with review by X)" — the secondary review is your post-check (step i).
      With no route, route by detected type. Without any authorized delegate
      capability, propose supervised sequential execution — do not claim
      fan-out.
   f. **Spawn ONE execution delegate** whose prompt references Part B and
      carries the TEN mandatory blocks:

      1. TASK: goal + exact contract + plan acceptance criteria.
      2. FILES: key (with :line) + related (callers/callees) + forbidden
         (other sessions' WIP that must NOT be touched).
      3. DEPENDENCIES: wave + blocking tasks + previous/next task.
      4. REFERENCES: relevant docs/rules of the area + the spec decision
         table (or evidence justifications) if new public surface.
      5. SKILLS: the discovery-pass list (≤8) with one-line applicability
         each — or instruct the delegate to run the pass itself.
      6. TOOLS+CHECKS: exact proposed commands (build/lint/test/verify) +
         which capabilities to use — no grep-loops when the structural
         capability answers.
      7. CODE INVESTIGATION: summarized blast radius (callers → callees,
         implications, risk) copied from the task record.
      8. PROBLEM INVESTIGATION: root-cause hypothesis or spec decision with
         tradeoff.
      9. EXTERNAL RESEARCH: digest ≤500 words + verified URLs (unverifiable
         → mark `[UNVERIFIED citation]` + record as contract debt).
      10. VALIDATION+CLOSURE: contract verify + full verify + deterministic
          checks + per-level DoD + different-context review + active gates
          D/V/C + mandatory RESULT block.
      Plus: verified plan context (gate justification, pre-mortem, appetite,
      branch/commit, wave) copied — NOT re-derived — and task-record state
      when it exists (done steps, next pending step, blast-radius summary,
      spec decisions, debt/forbidden WIP).

      **Pre-spawn checklist (all checked before dispatch):**
      - [ ] Task record read or declared absent (→ full discovery inside)
      - [ ] All 10 blocks populated — zero `{...}` placeholders, zero "see the plan"
      - [ ] Foreign WIP listed as FORBIDDEN (orchestrator ran `git status`
            and separated own vs other sessions' changes)
      - [ ] Exact `file:line` in FILES and REFERENCES
      - [ ] Mechanical contract copied verbatim, not paraphrased
      - [ ] Skills listed with one-line applicability each
      - [ ] No-delegate fallback: do not improvise gateless execution — run
            Part B inline keeping the 10 blocks + gates D/V/C + recorded review

   g. Await the delegate's result.
   h. **Validate the gate record** (`decision-request` §mandatory record):
      a `fired` gate must carry a matching `BLOCKER:`; a `BLOCKER:` with no
      question capability on your side → escalate. Missing/invalid →
      MALFORMED → recovery rung 1.
   i. **Classify per `recovery-brief`:** COMPLETE → step j. INCOMPLETE /
      FAILED / MALFORMED / empty / self-stopped → the recovery ladder
      (RESUME same session → RETRY fresh → STRATEGY → ESCALATE). Each
      recovery consumes the failure budget; 3 consecutive non-DONE on one
      task → pause and ask the owner.
   j. **On completion (post-recovery):**
      - Record the transition through the runtime — the ACCEPT gate is
        mechanized: a valid review payload is required (fresh review with
        reviewer context ≠ author context + verdict approve, or degraded +
        owner waiver `{owner, reference, reason}`). Reuse the delegate's own
        closing payload if it already closed the task; without a valid
        payload the record is rejected — never fabricate one.
      - Re-run the contract check (double verification — no verify, no done).
        A failed verify → treat as INCOMPLETE → step h.
      - Secondary review per the route's parenthetical (e.g. "with review by
        the auditor") → fork that reviewer over the diff before closing.
      - **Consistency review every 5 completions:** re-read the full plan;
        verify consistent states, legible continuation, no duplicated
        progress. Note `Review N/5: OK` in the plan.
   k. **On ladder exhaustion:** record failed; increment fail counters;
      `stop` halts the run; `skip` logs and continues; 3+ consecutive fails
      force `stop` regardless of declared mode.
   l. **Stagnation:** 3 consecutive failed delegates (even post-recovery) →
      no-progress limit; query stalled tasks; pause and ask the owner.
   m. **Budget ceilings:** declared operation budgets
      (`policy/operation-limits.json` / runtime counters) are hard stops;
      every ladder rung counts.
   n. **Checkpoint:** update the run-state record under `.scopegrain/state`
      (plan, totals, consecutive fails, fail mode, ISO timestamp).
   o. Read the plan again; take the next pending task.

6. **Parallel waves (FAIL_MODE=parallel):**
   a. Build the dependency DAG over pending tasks (`dependsOn` edges plus
      file-overlap conflicts detected by the structural capability).
   b. Group into waves (wave 0 = no dependencies, wave N = deps in earlier
      waves).
   c. `MAX_CONCURRENT = min(3, tasks_in_wave)` unless the declared budget
      says otherwise.
   d. Claim each member atomically BEFORE spawning it; claim-blocked → skip
      and report it. Spawn the wave's delegates in parallel with the same
      full-depth brief (§A.5.f); join all, classify each result
      individually (§A.5.i).
   e. A failed task inside a wave does not stop its siblings; subsequent
      waves do NOT start. Partial report; recovery applies per delegate.
   f. After the last sequential commit, check parallel branches for
      conflicts (`git log --oneline`).

7. **When no pending tasks remain:**
   - Report campaign complete: N/M done, K failed, S stalled.
   - Record progress for all completed tasks (`session-handoff`).
   - Produce the **closing retrospective** (mandatory before stopping):
     Start (keep doing — what worked) / Stop (drop — what failed) /
     Continue (unchanged) + ONE measurable process-improvement action with
     a metric against baseline (e.g. "verify retries per task 3→1").
     Record it in the plan and into progress/decision records so it is
     archived with the plan, not just moved tasks.
   - Close the session record (delete/close) to avoid stale sessions.
   - Stop.

## PART B — Single-task protocol (per invocation: ONE complete task)

Follow this whether invoked as a delegate or run inline. Process exactly ONE
task per invocation, then stop; the outer loop handles continuation. If you
cannot finish, return the RESULT block with the work done — never stop
silently; the orchestrator resumes via `recovery-brief`.

### B.0 — Capability setup

- Read the active task through the runtime.
- Run the skill-discovery pass (`select-capabilities`): key files +
  lifecycle phase (`BUILD`, or `DEFINE` when spec-first) + contract keywords
  → ≤8 skills with justifications. Load each; record `SKILLS_LOADED` in the
  task record and the RESULT block; `base-only` when none beyond base.
  Always load declared policy pins when present.
- Bug → add `systematic-debugging`. New/complex logic →
  `test-driven-development`. Security-sensitive → `doubt-driven-development`
  / `security-and-hardening`.
- Read the applicable rules/references of the touched area completely before
  discovery. Re-run the discovery pass if discovery reveals the task type
  changed (e.g. fix → feature-add).

### B.1 — Read the plan / task

Locate the task by id. Pending or in-progress → execute it. Already done or
failed → report and stop. If its task record already exists, READ it and
continue from the first pending step — never redo done steps or overwrite
prior work; partial work lives in the worktree and the record.

### B.2 — By state

#### Pending → DISCOVERY

- Structural investigation: callers/callees, transitive blast radius,
  architecture context, index coverage — via the available structural
  capability before grep/read.
- **Zero-code planning:** before writing code or the record, describe the
  solution in ≤3 pseudocode bullets: which files change, which functions,
  which signature, which tests. Ambiguity → research first (delegate per
  `research-brief` when heavy).
- **Gate D** (`decision-request`): blast radius >10 / hot path / public API /
  ambiguous contract / feature-add without spec / **plan adds new public
  symbols** → ask the owner (GO / adjust / split) BEFORE writing the record.
- **Spec-first mechanical gate:** feature-add/new-logic records need a valid
  `## Spec` (decision table or per-item evidence — `decision-request`
  §valid-spec). Invalid → return to discovery; no ACT.
- Record discovery in the task record (`analysis.*`, contract, steps[]) —
  full template in `task-brief`. Create the record only if absent.
- Implement the first step (~100 lines) and verify it.

#### Implementation → ACT loop

- **Pre-edit gate (mandatory):** before the FIRST edit of any file, the
  record's "Mapped impact" block must be filled (files read completely,
  incoming references, impact verdict). Missing → back to discovery.
- Per step: PLAN → ACT → VERIFY per `policy/workflow.json`; only the actions
  allowed in the current state. Before a risky/destructive command use the
  declared isolation mechanism if one exists — it is containment, not a
  security guarantee.
- Each step ~100 lines, mechanically verified. Under manual verification,
  propose the exact command; record the owner's returned output.
- **Verify failure → retry ladder:** (1) fix with the processed error —
  diagnose root cause and hand back a precise instruction, not the raw
  error; (2) fresh context (~200-token digest). At the single threshold —
  2 same-error failures (file+line+message) → **Gate V**: ask the owner
  (fresh retry / strategy change / FAILED). No answer → STOP.
- Evaluator-optimizer after each verify: correctness, simplicity,
  consistency (max 2 iterations).
- **Security phase** when touching trust boundaries (user input, auth,
  dependency changes, persistence, FFI, network): `security-and-hardening`
  checklist + the project's declared dependency audit.
- **Performance phase** on declared hot paths: `performance-optimization`;
  compare against a measured baseline; no undocumented regression.
- **Fork/join inside execution:** consecutive pending steps on disjoint
  files with no mutual dependency may run in parallel (max 2 delegates,
  reduced prompt = step + contract); join both before continuing; one
  failing delegate → its own RESUME, siblings unaffected.
- **Budget:** if the declared budget exhausts without finishing → return
  `RESULT: INCOMPLETE` with the next pending step — do NOT mark FAILED for
  budget; the orchestrator decides RESUME/RETRY.

#### Closure → VERIFY→EVALUATE→REVIEW→ACCEPT→CLOSE

1. **Citation gate (research/evidence tasks):** resolve every cited URL
   mechanically. Unresolvable → the evidence is invalid: replace the source
   or drop the claim. No network → mark each `[UNVERIFIED citation — no
   network]` and record the pending check as contract debt; never present
   it as verified.
2. **Full verify:** the project's declared check suite (format, lint,
   tests, docs coverage), plus — when the change has unsafe/concurrent code
   — the toolchain's UB/sanitizer/fuzz options if available; critical
   components (parsers, serializers, persistence) get a property test.
3. **Cognitive pivot (self-review):** stop implementing; find 1–3
   security/memory/inefficiency/logic issues in what you just wrote; fix
   them.
4. **Deterministic review:** run the project's declared rule/lint checks
   over touched paths; blockers fixed now, mediums → finding records per
   `finding-record`, lows discarded.
5. **Evaluator-optimizer — 3 axes:** (a) correctness — edge cases, empty
   input, limits, nulls, empty collections, concurrent access; (b)
   simplicity — reuse ladder (existing > stdlib > existing dependency >
   minimal new code); (c) consistency — same patterns/naming/error handling
   as the surrounding code. Re-check the full blast radius post-change.
6. **Collateral errors:** each one — small+same-file → fix and commit
   together; larger/different-module → finding record at discovery time,
   never only in notes. Do not lose focus on the main task.
7. **Self-harness gate (propose → evaluate → accept):** PROPOSE: read the
   complete diff, summarize in 3 lines (what changed, why, which contract it
   satisfies). EVALUATE booleans: satisfies contract? generated outputs
   validated? nothing outside blast radius broken? new tech debt? public
   API documented? All yes → continue; any no → back to ACT with the issue
   list; 2 consecutive rejections → block and escalate to the owner.
8. **Risk-tiered review — different context (mandatory):** classify touched
   paths against the project's declared high-risk list (public API
   contracts, storage/wire formats, parsers, auth/security boundaries):
   matching → adversarial review by a different context (fallback: degraded
   adversarial self-review, marked degraded + escalated to owner); others →
   mechanical verify + recorded verdict. A mixed diff is adversarial.
   Without a recorded verdict the task is NOT complete.
9. **Mechanized ACCEPT:** recording completion requires the review payload
   (`decision-request` Gate C): `fresh` — reviewer context ≠ author context
   + verdict approve; or `degraded` + owner waiver `{owner, reference,
   reason}` recorded in decisions/trace. No payload → transition rejected.
10. **Pre-commit checklist:** DoD applied · security checklist (data/auth) ·
    performance checklist (critical path) · tests pass · affected docs
    updated · reuse ladder applied.
11. **Commit:** stage ONLY this task's touched paths — never `add -A` —
    message per the project's declared convention (conventional-commits
    style: `type(scope): <ID> — <desc>` + blast radius / skills / contract /
    collaterals in the body). LOCAL ONLY: never `git push` — push requires
    explicit owner authorization.
12. **Learnings:** record 1–2 learnings in the harness memory log
    (`lessons`); do not edit standing docs by hand.
13. **Progress + context save point:** `session-handoff`; record date,
    branch, pending CI, decisions, known issues, next task in the record.
14. **Self-improvement note:** what was harder than expected, and why.

#### In progress → resume

Read the continuation record for exact position; continue from the next
pending step. Same retry ladder and Gate V apply. Collateral findings route
per `finding-record` (registered at discovery, never only in notes). Files
outside the declared blast radius in `git status` → confirm commit scope
before staging. 2 consecutive stalls → FAILED (no-progress limit).
Budget-exceeded verify → reset the counter with reason recorded; not a
failure.

#### Failed

Record why it failed and what was tried (the ladder rungs), mark failed
through the runtime, record progress, STOP. Do not continue to the next
task.

### B.3 — Continuation record and RESULT block

After every action, update the continuation record per `session-recitation`
(active goal, last action, result, next action, contract + evidence +
invariants + debt, next task, plus the `review` payload when closing). The
next context must be able to continue WITHOUT asking the previous one.

At the end of EVERY invocation return the RESULT block verbatim —
canonical definition in `session-recitation`. Status semantics here:

- COMPLETE: all steps done + contract verify passes + commit made.
- INCOMPLETE: partial work; always update the task record (done steps +
  context save point) BEFORE returning — that is what enables lossless
  resume. Budget exhaustion, a clarification stop or an interruption all
  land here, not in silence.
- FAILED: internal retry ladder exhausted at VERIFY.
- MALFORMED: no parseable block, or a GATES_EVALUATED line missing/without
  reasons — the orchestrator will re-invoke for it.

Never return empty output, "done", or silence.

## Run rules

- Unified depth: every delegate follows Part B; the task record is the
  durable state — continue it, never recreate it.
- The contract is law — if it is not met, the task is not complete.
- Mechanical verification, never self-report.
- ~100 lines per step, one step per turn, each step independently
  reversible.
- No scope change: quick collaterals fixed inline; slow ones → finding
  records (`finding-record`).
- Single stagnation rule: 2 same-error verify failures → Gate V; no
  answer → STOP.
- A delegate sees only its own task, not the full plan.
- After completing a task, STOP — do not advance to the next one.
