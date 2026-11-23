# Orchestration Patterns

Specify goal, inputs, scope, acceptance cases and authority for each role.
Parallelize only independent work with settled inputs and disjoint writes.
At fan-in inspect actual artifacts, preserve partial success and report
which dependencies remain blocked. Resume valid work before retrying it.
Fresh-context review needs real independence, not only different names.

Reference catalog of agent orchestration patterns this harness endorses,
plus anti-patterns to avoid. Read this before adding a new command that
coordinates multiple personas, or before introducing a persona that "wraps"
existing ones.

The governing rule: **the user (or a command) is the orchestrator. Personas
do not invoke other personas.** Skills/references are mandatory hops inside
a persona's workflow.

---

## Endorsed patterns

### 1. Direct invocation (no orchestration)

Single persona, single perspective, single artifact. The default and the
cheapest option.

```
user → code-reviewer → report → user
```

**Use when:** the work is one perspective on one artifact and you can
describe it in one sentence.

**Examples:** "Review this PR" → a code reviewer. "Find security issues in
`auth.ts`" → a security auditor. "What tests are missing for the checkout
flow?" → a test engineer.

**Cost:** one round trip. The baseline you should always compare
orchestrated patterns against.

---

### 2. Single-persona command

A command that wraps one persona with the project's skills. Saves the user
from re-explaining the workflow every time.

```
/audit review → five-axis code review → report
```

**Use when:** the same single-persona invocation happens repeatedly with
the same setup.

**Cost:** same as direct invocation. The command is just a saved prompt.

**Anti-signal:** if the command's body is mostly "decide which persona to
call," delete it and let the user call the persona directly.

---

### 3. Parallel fan-out with merge

Multiple personas operate on the same input concurrently, each producing an
independent report. A merge step (in the main agent's context) synthesizes
them into a single decision.

```
                    ┌─→ code-reviewer    ─┐
ship → fan out  ───┼─→ security-auditor ─┤→ merge → go/no-go + rollback
                    └─→ test-engineer    ─┘
```

**Use when:**
- The sub-tasks are genuinely independent (no shared mutable state, no
  ordering dependency)
- Each sub-agent benefits from its own context window
- The merge step is small enough to stay in the main context
- Wall-clock latency matters

**Cost:** N parallel sub-agent contexts + one merge turn. Higher than
direct invocation, but faster wall-clock and produces better reports
because each sub-agent stays focused on its single perspective.

**Validation checklist before adopting this pattern:**
- [ ] Can I run all sub-agents at the same time without ordering issues?
- [ ] Does each persona produce a different *kind* of finding, not just the
      same finding from a different angle?
- [ ] Will the merge step fit in the main agent's remaining context?
- [ ] Is the user's wait time long enough that parallelism is actually
      noticeable?

If any answer is "no," fall back to direct invocation or a single-persona
command.

---

### 4. Sequential pipeline as user-driven commands

The user runs commands in a defined order, carrying context (or commit
history) between them. There is no orchestrator agent — the user IS the
orchestrator.

```
user runs:  spec  →  plan  →  task  →  task (bug)  →  review  →  ship
```

**Use when:** the workflow has dependencies (each step needs the previous
step's output) and human judgment between steps adds value.

**Cost:** one sub-agent context per step. Free for the orchestration layer
because there is no orchestrator agent.

**Why not automate it:** an LLM "lifecycle orchestrator" would (a) lose
nuance between steps because it has to summarize for hand-off, (b) skip the
human checkpoints that catch wrong-direction work early, and (c) double the
token cost via paraphrasing turns.

---

### 5. Research isolation (context preservation)

When a task requires reading large amounts of material that shouldn't
pollute the main context, spawn a research sub-agent that returns only a
digest.

```
main agent → research sub-agent (reads 50 files) → digest → main agent continues
```

**Use when:**
- The main session needs to stay focused on a downstream task
- The investigation result is much smaller than the input it consumes
- The decision quality benefits from the main agent having room to think
  after

**Examples:** "Find every call site of this deprecated API across the
monorepo," "Summarize what these 30 decision records say about caching."

**Cost:** one isolated sub-agent context. Worth it any time the alternative
is loading hundreds of files into the main context.

If the host provides a built-in read-only explore/search subagent, prefer
it over defining a custom research persona; define a custom one only when
you need a domain-specific system prompt the default wouldn't infer.

---

## Host capability mapping

This catalog is harness-agnostic, but hosts differ in what they enforce:

| Capability | Implication |
|---|---|
| Subagents | Pattern 3: the main agent fans out; sub-agents only report back. Parallel execution requires issuing the spawn calls **in a single turn** — sequential turns serialize. |
| Teammate-style agents ("teams") | Peers that message each other and share a task list. Right for adversarial/collaborative work; higher cost. Often experimental. |
| Platform-enforced limits | Some hosts forbid subagents spawning subagents, or nested teams — anti-patterns B and D then fail by construction. Do not rely on this; keep the rule anyway. |
| Per-persona frontmatter | Fields like `tools`, `model`, `disallowedTools`, `maxTurns` may be honored only in subagent mode — check the host. If a persona depends on a skill or tool being loaded, configure it at session level so it works in both modes. |
| Built-in read-only agents | Many hosts ship explore/plan/general-purpose agents. Don't redefine them; layer specialist personas on top. |
| Cost knobs | If the host allows per-persona model selection, cheap models for coverage scans and strong models for security review is a legitimate optimization. |

### Worked example: teammate mode for competing-hypothesis debugging

Use teammates instead of fan-out when the value comes from investigators
**challenging each other**, not from parallel coverage:

> *Checkout occasionally hangs ~30 s before completing, roughly once in 50
> sessions, no errors in logs, started after last week's release.*

Plausible mutually-exclusive causes: a race in the new confirmation flow, an
auth check falling through to a slow synchronous call, a missing index that
scales with cart size, a flaky third-party retrying silently.

| | Fan-out (subagents) | Teammates |
|---|---|---|
| Sub-agents see | The same diff, different lenses | A shared task list, each other's messages |
| Output | Independent reports → one merge | Adversarial debate → consensus root cause |
| Right when | You want a verdict on a known artifact | You want to *find* the artifact among hypotheses |

A fan-out is a verdict; a team is an investigation. Trigger by describing
the symptom and naming which persona lenses to spawn and instructing them
to challenge each other's theories until two can disprove the others'.

**Do not** rebuild this as a command that fans out subagents — subagents
can't message each other, and you'd lose the adversarial debate that makes
the pattern work. Document the trigger prompt as a snippet instead.

**When *not* to use teammates:** production-bound verdict on a known diff
(fan-out), one perspective on one artifact (direct invocation), sequential
lifecycle (Pattern 4), read-heavy research with a small digest (Pattern 5).

---

## Anti-patterns

### A. Router persona ("meta-orchestrator")

A persona whose job is to decide which other persona to call.

```
/work → router-persona → "this needs a review" → code-reviewer → router (paraphrases) → user
```

**Why it fails:**
- Pure routing layer with no domain value
- Adds two paraphrasing hops → information loss + roughly 2× token cost
- The user already knew they wanted a review; they could have invoked it
  directly
- Replicates the work that commands and intent-mapping already do

**Instead:** add or refine commands; document intent → command mapping in
the project's agent instructions.

### B. Persona that calls another persona

A `code-reviewer` that internally invokes a `security-auditor` when it sees
auth code.

**Why it fails:**
- Personas were designed to produce a single perspective; chaining defeats
  that
- The summary the caller passes loses context the callee needs
- Failure modes multiply (whose output format wins? whose rules apply?)
- Hides cost from the user

**Instead:** the calling persona *recommends* a follow-up audit in its
report. The user or a command runs the second pass.

### C. Sequential orchestrator that paraphrases

An agent that runs spec → plan → task → … on the user's behalf.

**Why it fails:**
- Loses the human checkpoints that catch wrong-direction work
- Each hand-off summarizes context — accumulated drift over a long pipeline
- Doubles token cost: orchestrator turn + sub-agent turn per step
- Removes user agency exactly where judgment matters most

**Instead:** keep the user as orchestrator; document the recommended
sequence and let users invoke it.

### D. Deep persona trees

A ship command calling a pre-ship coordinator calling a quality coordinator
calling the actual reviewer.

**Why it fails:**
- Each layer adds latency and tokens with no decision value
- Debugging becomes a multi-level investigation
- Leaf personas lose context to multiple summarization steps

**Instead:** keep orchestration depth at most 1 (command → personas); the
merge happens in the main agent.

---

## Decision flow

```
Is the work one perspective on one artifact?
├── Yes → Direct invocation. Stop.
└── No  → Will the same composition repeat?
         ├── No  → Direct invocation, ad hoc. Stop.
         └── Yes → Are sub-tasks independent?
                  ├── No  → Sequential user-driven commands (Pattern 4).
                  └── Yes → Parallel fan-out with merge (Pattern 3).
                           Validate against the checklist above.
                           If any check fails → single-persona command (Pattern 2).
```

## When to add a new pattern to this catalog

Add a new entry only after:

1. You've used the pattern at least twice in real work
2. You can name a concrete artifact in this repo that demonstrates it
3. You can explain why an existing pattern wouldn't have worked
4. You can describe its anti-pattern shadow (what people will mistakenly
   build instead)

Premature catalog entries become aspirational documentation that no one
follows.

<!-- Referencias cruzadas: → ver ship-runbook.md, skills-engineering.md, task-system.md -->
