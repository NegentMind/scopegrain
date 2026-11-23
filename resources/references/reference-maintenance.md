# Reference Maintenance

These are fresh project-neutral inspection guides, not verbatim copies
or endorsements of all links in the original local archive.
Keep actionable procedures in commands/skills, obligations in rules and
background topics here. Inspect authoritative sources before making a
version-specific claim. Preserve uncertainty and provenance.

## Maintaining a synthesis/index document

When several source documents inform the harness's design, keep ONE
synthesis document rather than scattered notes. Its structure:

1. **Header** — date, source list, purpose.
2. **Per-source digest** — location, definition, files analyzed (table),
   extracted patterns (table: pattern → description → application).
3. **Per-checklist digests** — section-level structure of each actionable
   reference (sections × check counts), plus the 3–5 load-bearing
   principles each contributes.
4. **Prioritized improvement registry** — what the sources suggest adding,
   in severity buckets with effort/value/what-exists/what's-missing/
   pattern/application columns.
5. **Pattern → code map** — which harness file each adopted pattern lives
   in (keeps the synthesis honest: a pattern with no location is
   aspiration, not implementation).
6. **Glossary** — terms the harness uses that readers may not share.

### Improvement-registry row shape

| Field | Content |
|---|---|
| # / Improvement | Name and one-line explanation |
| Sourced from | Which reference motivates it |
| Effort / Value | Low·Med·High |
| Already covered | What exists today |
| What's missing | The concrete gap |
| Pattern | Named pattern it instantiates |
| Application | Where/how it would land |

Bucket by priority (🔴 high / 🟡 medium / 🟢 low) and keep a summary count.
Also keep a "does-not-apply" list with reasons — it prevents re-litigating
rejected ideas.

## Harness-engineering pattern catalog

Patterns extracted from industry harness literature (agent harness =
everything around the model: prompts, tools, state, context, guardrails,
verification, observability, orchestration):

| Pattern | Description |
|---|---|
| CAR decomposition | Document the harness in Control-Agency-Runtime dimensions |
| Initializer agent | Separate agent that sets up context + task list, then hands off to workers |
| init script | Script that bootstraps the agent's environment at session start |
| Self-verification | Agent verifies its own output before declaring done |
| Handoff artifacts | Structured state carried between context windows |
| While-loop harness | `while :; do cat PROMPT.md \| agent; done` — minimalist, deterministic |
| Bounded conversation memory | Preserve only: goals, progress, critical files, failing tests |
| Filesystem memory | The filesystem as persistent memory between turns |
| Tool masking | Show only the tools relevant to the current step |
| Layered verification | Multiple layers: unit tests, critics, sandboxed execution |
| Ratcheted gates | Quality hooks that only tighten, never loosen |
| Self-repair loop | Plan → Execute → Validate → Diagnose → Fix → Retry → Report → Escalate |
| N-factor agents | Explicit prompts, state ownership, clean pause-resume, event-stream logs |
| Spec-driven development | Run agents against explicit specs for predictable results |
| Static capability scanning | CI-time scan for shadow capabilities, credentials in context, unverified tool endpoints, eval/subprocess in tools, direct prompt interpolation |
| HarnessCard | A one-page harness description (CAR format) |
| Rehearsal/score-movement | Trial a pipeline change in rehearsal mode before making it default |
| Evolutionary selection | Choose pipeline/agent versions by `σ(α·performance + β·novelty)` |
| gen_sm → llm_solve | A planner model generates a task-specific state machine once (low temperature, cacheable); a cheaper executor model runs inside its constraints |
| MoM escalation | Mixture-of-Models ladder: cheap tier → mid tier → frontier tier, each with its own traits; escalate on failure |
| Per-state model routing | Cheap states → small models, expensive states → frontier models |
| Fork/join | Independent sub-steps (lint/test/docs) run in parallel, join all/any |
| Conversation retention by model size | Clear context per cycle for small models, per phase for mid, keep-all for large |

### Context-management principles

1. Context window = working-memory budget, not a dumping ground.
2. Useful failures stay in-context — keep what went wrong for diagnosis.
3. Prevent context drift — resumability needs a stable context structure.
4. Backpressure on low-value work — don't burn context on noise.
5. Bounded memory — preserve only goals, progress, critical files,
   failing tests.

### State-machine guardrail set (12)

Guardrails a state-machine harness can enforce ("agents are suggestions,
states are laws"):

| Guardrail | Effect |
|---|---|
| Per-state tool enforcement | Agent sees/can call only `allowed_tools` for the current state |
| Shell discernment | Block `echo > file`, `rm -rf`, in-place editors, script interpreters |
| Edit guards | Reject diffs > `max_edit_lines`; cap files touched per state |
| Command allow-lists | Only prefix-matched commands (e.g. the test runner) |
| Conditional transitions | Programmatic guards: `test_result eq pass` |
| Approval gates | `requires_approval` pauses for human review |
| Interrupts | Touching a file auto-transitions to a validation state |
| Fork/join | Sequential or parallel branches; `join: all|any` |
| Environment scoping | Hide sensitive env (`blocked_env`), substitute via `env_overrides` |
| Session isolation | State keyed by session id |
| Per-state model routing | State-level model choice |
| Thinking-level control | Per-state reasoning effort (high/medium/low/off) |
| Escalation detection | Warn when a state jumps ≥2 privilege levels without approval |

### Model-traits registry (shape)

Per-model behavioral registry so the harness adapts prompts/limits:

| Field | Meaning |
|---|---|
| `tool_mode` | native / raw / auto |
| `reasoning` | bool — emits a reasoning field |
| `response_field` | which field carries the answer |
| `history_window` | turns retained (smaller for small models) |
| `max_full_read_lines` | read limit without ranges |
| `max_diff_lines` | oversize-diff threshold |
| `unescape_tool_args` | model double-escapes JSON |
| `single_quote_json` | model uses single-quoted JSON |
| `num_ctx` | context-window override |

Resolution order: defaults → family → size → tag. Empirical findings worth
remembering: default context sizes in local runners are often dangerously
small (raise deliberately); reasoning models emit non-standard formats
(mixed JSON+text, reasoning fields, special tokens); raw-JSON tool mode is
the portable default — native modes are optimizations; per-state context
minimization is the single biggest factor making small models work on
non-trivial tasks.

## Per-checklist digest (what each reference contributes)

| Reference | Structure | Load-bearing principles |
|---|---|---|
| definition-of-done | 5 axes (correctness, quality, integration, docs, ship-readiness) + red flags | Unverified work is not done; runtime-verified is mandatory; DoD and acceptance criteria are complementary gates |
| security-checklist | threat model → pre-commit → authn/authz → input validation → headers/CORS → data → deps → LLM → errors → OWASP×2 | Model output is untrusted; permissions enforced in code not prompts; scope tool permissions; bound consumption |
| observability-checklist | on-call questions → logs → metrics → traces → alerts → dashboards → verify → launch gate | Telemetry without a question is noise; metrics=that, traces=where, logs=why; no unbounded labels; verify telemetry end-to-end |
| orchestration-patterns | 5 endorsed + 4 anti-patterns + decision flow | User/command is the orchestrator; personas never call personas |
| testing-patterns | AAA, naming, assertions, mocks, component, API, E2E, anti-patterns | Mock at boundaries only |
| performance-checklist | CWV targets → TTFB → frontend → backend → measurement → anti-patterns | Field data first; test on mid-range hardware |
| accessibility-checklist | keyboard, screen reader, visual, forms, content + patterns/tools/ARIA/anti-patterns | Automation covers only part; untested ≠ passing |

## Glossary

| Term | Meaning |
|---|---|
| Harness | Everything around the agent: prompts, tools, state, guardrails, orchestration |
| CAR | Control-Agency-Runtime — 3 dimensions for documenting a harness |
| gen_sm / llm_solve | Planner generates a state machine once; executor runs inside it |
| MoM | Mixture of Models — escalate across model tiers by difficulty |
| Model traits | Per-model capabilities (tool mode, context, response field) |
| RED / USE | Rate·Errors·Duration / Utilization·Saturation·Errors metric sets |
| Handoff artifact | Structured state between context windows |
| Bounded memory | Preserve only goals, progress, critical files, failing tests |
| Ratchet | One-direction mechanism: quality rises, never relaxes |
| Rehearsal | Trial-run a pipeline change before defaulting it |
| Capability scanning | CI-time static scan of agent-tool risks |
| Fork/join | Parallel branches rejoining on all/any completion |

<!-- Cross-references: → see skills-engineering.md, orchestration-patterns.md, task-system.md, quality-floor.md -->
