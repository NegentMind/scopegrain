# Workflow — Rules

> **Scope:** recorded task workflow, command dispatch, resource loading,
> orchestration, impact analysis, proliferation control, session hygiene,
> decision records, documentation language, pre-action checks and
> traceability.
> **Not here:** mode selection and request fidelity (`methodology.md`),
> evidence standards (`evidence.md`), when to ask the owner
> (`human-decisions.md`), authorization boundaries and secrets
> (`safety.md`), retry budgets (`research-escalation.md`), review
> independence (`review.md`), resource trust (`resource-integrity.md`),
> publish/version gates (`release-ci.md`).
> **Status:** Active

## Recorded workflow

### 1 — Check existing behavior before planning

- **Must:** verify whether the requested behavior already exists before
  proposing or planning changes.
- **Must not:** plan against assumptions or remembered state.
- **Why:** re-implementing existing behavior duplicates code and breaks the
  baseline that inspection would have established.

### 2 — Read actual task state before mutating it

- **Must:** read the current task state and revision before any mutation;
  respect dependency readiness; treat unrecorded success as not CLOSE.
- **Must not:** mutate against a remembered state or close work whose
  success was never recorded.
- **Why:** state drifts between sessions and actors; the stored revision is
  the only guard against lost updates and premature closure.

### 3 — Edits require ACT; changed work needs fresh evidence

- **Must:** hold an authorized execution state before editing, and re-run
  verification and review after any change.
- **Must not:** reuse pre-change verification as proof of the changed work
  (`→ see evidence.md`).
- **Why:** a stale passing result proves only the revision that produced it.

### 4 — Preserve partial work and evidence across interruption

- **Must:** keep in-flight artifacts and evidence resumable when work is
  interrupted.
- **Must not:** silently discard partial progress.
- **Why:** lost partial state forces rework and hides how far verification
  actually got.

### 5 — Write artifacts only after a displayed plan and explicit consent

- **Must:** display the plan and obtain explicit apply/consent before
  producing artifacts (`→ see human-decisions.md`).
- **Must not:** treat silence or an ambiguous message as consent.
- **Why:** consent bound to reviewed inputs is what makes the output
  authorized.

### 6 — Stop at the agreed boundary

- **Must:** end at the declared scope; report adjacent findings instead of
  acting on them.
- **Must not:** launch unrelated tasks because capacity remains.
- **Why:** unrequested expansion destroys scope accounting and review
  integrity.

## Command dispatch

### 7 — Load the matching command resource before acting

- **Must:** treat a command-shaped user message as a request to load the
  matching command resource, and interpret its mode from the argument.
- **Must not:** improvise a command's behavior from memory.
- **Why:** the command file is the contract; a remembered version may be
  stale or wrong.

### 8 — Resolve references through the catalog and all state locations

- **Must:** resolve every relative reference inside commands and prompts
  through the configured catalog and state paths, searching active,
  completed and closed locations before declaring an item missing.
- **Must not:** report an item missing after checking a single location.
- **Why:** lifecycle paths exist precisely so completed and closed records
  stay findable; a shallow search fabricates absence.

### 9 — Follow declared phases in order; never skip steps

- **Must:** load referenced prompts, skills and rules in their declared
  order and follow their phases.
- **Must not:** skip steps, reorder phases or treat them as advisory.
- **Why:** phases encode checks; each skipped step is a silently dropped
  gate.

### 10 — End a command at its declared output

- **Must:** stop when the command's declared output is produced and the
  handoff is written.
- **Must not:** continue into an implied next task.
- **Why:** continuation was never authorized; the handoff is the boundary.

## Resource loading

### 11 — Evaluate and load applicable skills and rules before acting

- **Must:** evaluate which skills and rules apply before any action; when in
  doubt, load the resource.
- **Must not:** skip loading on a size or familiarity excuse — "too small
  for the process", "tests later", "I already know this code" or "no need to
  load the procedure".
- **Why:** those rationalizations are precisely how gates get bypassed; the
  excuse is the symptom the rule exists for.

### 12 — A loaded rule is mandatory; never weaken it to pass

- **Must:** load only the resources for the area being changed; a loaded
  rule is mandatory, not advisory (`→ see methodology.md`).
- **Must not:** weaken or delete a rule to make a change pass; if a rule
  does not apply to the exact sub-task, leave it unmodified.
- **Why:** editing the constraint to fit the change converts governance into
  decoration.

### 13 — Record undocumented findings in their established format

- **Must:** when a consulted reference resolves an undocumented problem, add
  the missing entry in its established format.
- **Must not:** fix a knowledge gap only in the working context.
- **Why:** undocumented fixes recur; the record is what makes the next
  occurrence cheap.

## Orchestration

### 14 — Respect the role split: commands when, skills how, agents who

- **Must:** let the user or a command orchestrate; commands are entry
  points, skills are procedures, agents are perspectives.
- **Must not:** let a procedure or a role self-orchestrate beyond its
  declared scope.
- **Why:** conflating the layers hides who authorized what.

### 15 — Fan out only across independent work; leaves do not delegate

- **Must:** parallelize only across independent work and merge actual
  produced artifacts; specialist roles are leaf nodes.
- **Must not:** let a leaf role delegate further.
- **Why:** delegated delegation loses accountability and produces
  unmergeable partial results.

### 16 — A review or audit role verifies and reports; it never implements

- **Must:** keep review/audit roles read-only on the artifact under review
  (`→ see review.md`).
- **Must not:** let the reviewer apply the fix.
- **Why:** a reviewer who fixes destroys the independence the review exists
  to provide.

## Impact analysis

### 17 — Map inbound and outbound references before modifying or deleting

- **Must:** before modifying or deleting a file, read it fully, map its
  inbound references across the workspace and its outbound dependencies,
  and report what breaks.
- **Must not:** delete on an "unused" or "duplicate" impression without an
  actual search.
- **Why:** impressions miss dynamic, string-based and cross-boundary
  references; the report is what lets the owner price the change.

## Proliferation control

### 18 — New commands, modes and ID prefixes must name what they replace

- **Must:** declare, for every new command, mode or identifier prefix, which
  existing resource it replaces or why none covers the need; register new ID
  schemes in the project taxonomy.
- **Must not:** invent ad-hoc prefixes or parallel commands per campaign or
  tool.
- **Why:** proliferation fragments the routing table until nothing is
  discoverable.

## Session hygiene

### 19 — Inspect before planning, re-inspect before closing

- **Must:** inspect working-tree state and recent history before planning
  changes; before closing, re-inspect the diff for residual
  over-engineering and report it.
- **Must not:** silently expand scope inside a diff.
- **Why:** uninspected state and uninspected diffs are where unrelated
  changes and scope creep hide.

## Decisions and claims

### 20 — Record consequential trade-off decisions in the decisions path

- **Must:** record consequential trade-offs in the configured decisions
  path: the owner articulates context, choice and consequences; the agent
  supplies evidence (`→ see human-decisions.md`).
- **Must not:** let consequential choices exist only in conversation.
- **Why:** unrecorded trade-offs get re-litigated by every future session
  without the original context.

### 21 — No unexplained generated code

- **Must:** be able to explain the non-trivial decisions inside generated
  code before merging it.
- **Must not:** merge generated code on the justification that "the tool
  wrote it".
- **Why:** code nobody can explain is unreviewable and unmaintainable; the
  merger owns it.

### 22 — Never hide a failing check

- **Must:** fix a failing check or record it as a tracked, justified issue
  (`→ see evidence.md`).
- **Must not:** hide failure behind skipped verification, suppressed
  diagnostics or a silent continue.
- **Why:** suppressed failures convert known defects into invisible ones.

## Documentation language

### 23 — One source-of-truth language for technical content

- **Must:** keep technical documentation in one declared source-of-truth
  language; operational and planning artifacts follow the configured
  project locale.
- **Must not:** maintain the same technical content in two languages.
- **Why:** parallel translations drift within one edit cycle; the reader can
  never tell which copy is current.

## Pre-action checks

### 24 — Keep each edit step bounded

- **Must:** keep each edit step to roughly ≤100 authored lines or ≤5 files;
  split larger changes or record them as deliberate, justified exceptions.
- **Must not:** slip an oversized change through silently.
- **Why:** bounded steps keep review, rollback and blame tractable; the
  exception record keeps honest work honest.

### 25 — Verify only through declared channels

- **Must:** run verification through the declared/recorded commands, or the
  manual path: propose the command, the owner runs it and returns the
  output.
- **Must not:** improvise shell work outside authorized states.
- **Why:** undeclared execution is unaudited execution — the record cannot
  show what it never saw.

### 26 — Secrets stay out of every channel

- **Must:** apply the secrets rule in all reads, commands and artifacts
  (`→ see safety.md`).
- **Must not:** read or echo secret or environment values; reference
  variable names, never contents.
- **Why:** see `safety.md` — a leaked value cannot be un-leaked.

### 27 — Two identical failures trigger escalation, not retry

- **Must:** apply the retry/escalation budget when verification fails
  (`→ see research-escalation.md`).
- **Must not:** retry the same approach after a repeated identical failure
  signature.
- **Why:** canonical rule in `research-escalation.md`; stated here as the
  workflow entry point.

## Traceability

### 28 — Propagate the task identifier to long-lived artifacts

- **Must:** reference the owning task/session identifier in commit messages,
  reports, finding records and handoff blocks — at write time, not later.
- **Must not:** leave a finding, decision or lesson without its task link.
- **Why:** an unlinked record is an orphan; provenance added later is
  reconstructed, not recorded.
