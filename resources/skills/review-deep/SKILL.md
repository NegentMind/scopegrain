---
name: review-deep
description: Use when a high-risk change needs deeper causal and boundary review than a quick check
---
# Deep Review Loop

Iterative deep review that walks a codebase **module by module** instead
of producing a one-shot report. For each module it performs structural
mapping → mechanical analysis → deep code review → external research →
comparison against alternatives → triage → module report, then yields so
the loop continues with the next module. It complements
`unified-review`: that one gates a change; this one audits a surface
across many iterations.

## When to use

- A high-risk change needs deeper causal and boundary review than a quick
  check
- A periodic deep audit of the whole project surface, module by module
- After `unified-review` flags a module that deserves dedicated depth
- Before a release, when "the gate passed" is not enough assurance

## Loop architecture

```
Invoke the loop once per module: MODULE=<name>, DEPTH=full|quick
  │
  ├─ PHASE 0: Load the skills that fit the module type
  │
  ├─ PHASE 0b: Tool focus per phase (best-effort)
  │   ├─ F1–F3 (analysis): structural index/graph tools + read + shell
  │   ├─ F4–F5 (research): web search/fetch tools + read
  │   ├─ F6 (triage):      edit/write on the backlog + read
  │   └─ Explicit transitions: never jump F3→F6 without F4–F5
  │
  ├─ PHASE 1: Structural mapping
  │   └─ Map: callers, callees, API surface, tests, file sizes, complexity
  │
  ├─ PHASE 2: Static analysis (mechanical tools per language)
  │   └─ Record: warnings, errors, issues
  │
  ├─ 🟢 QUALITY GATE 1 (between F3→F4)
  │   ├─ Every finding has file:line?
  │   ├─ Every finding has type + severity?
  │   └─ If not → back to F3. Quality in the loop, not at the end.
  │
  ├─ PHASE 3: Deep code review (7 sub-axes, below)
  │
  ├─ PHASE 4: External research per non-trivial finding
  │   └─ Record: source URL, recommended solution, alternatives, decision
  │
  ├─ PHASE 5: Comparison vs relevant alternatives/competitors
  │   └─ Record: gap / advantage / parity per finding
  │
  ├─ 🟢 QUALITY GATE 2 (between F5→F6)
  │   ├─ Every Medium+ finding has ≥1 verified reference URL?
  │   ├─ URLs are real, not placeholders?
  │   └─ If not → back to F4. Quality over quantity: discard false positives.
  │
  ├─ PHASE 6: Triage → backlog
  │   └─ fix-now (<30 min) | backlog (tracked ID) | discard (with reason)
  │
  └─ PHASE 7: Module report + yield
      ├─ More modules → yield for the next invocation
      └─ Last module → consolidated report + complete
```

`DEPTH=quick` runs F0–F3 + F6–F7 only (no external research, no
competitor comparison); Medium+ findings then go to the backlog marked
`needs-research` instead of carrying URLs.

## Iteration order

Order modules by descending impact potential — the project's own
dependency graph decides. A generic shape:

```
Wave 0 — Core critical      (entry points, engine, durability/persistence)
Wave 1 — Domain internals   (indexing, algorithms, data structures)
Wave 2 — Governance         (admission, consistency, conflict handling)
Wave 3 — SDKs and bindings  (foreign-language surfaces)
Wave 4 — Infrastructure     (server, integrations, packaging)
Wave 5 — Adapters/plugins   (parallelizable — usually independent)
Wave 6 — Utilities & misc
```

Waves run sequentially (natural dependencies); modules *within* a wave
may be reviewed in parallel when independent. With >30 modules, derive
the order from a dependency DAG instead of intuition.

### Context preservation for large modules

Tool outputs dominate context cost. Strategy by module size:

| Size | Strategy |
|------|----------|
| <500 lines | Normal loop, one iteration |
| 500–2000 | Compact intermediate findings to a scratch file under the review workspace |
| >2000 | Split into sub-modules, run a sub-loop per part |
| >5000 | Delegate each sub-module to an independent sub-review in parallel |

Keep intermediate findings in a per-module scratch file
(e.g. `<reviews>/review-deep/<module>-findings.json`) so context loss
between iterations never loses evidence.

### Per-iteration scorecard

Each module iteration records a JSON scorecard so runs can be compared
over time and regressions (new findings vs previously resolved) detected:

```json
{
  "module": "<name>",
  "wave": 0,
  "duration": "12m34s",
  "findings": {"critical": 2, "high": 5, "medium": 3, "low": 8, "info": 12},
  "fixed_now": 3,
  "to_backlog": 4,
  "discarded": 3,
  "research_urls": 7
}
```

## PHASE 0 — Skills to load, by module type

| Module type | Load |
|---|---|
| Core implementation | `code-review-and-quality`, `doubt-driven-development`, `code-simplification`, `security-and-hardening`, `performance-optimization`, `api-and-interface-design`, `source-driven-development` |
| Foreign-language SDK | `code-review-and-quality`, `security-and-hardening`, `source-driven-development` |
| Adapters/plugins | `code-review-and-quality`, `doubt-driven-development` |
| Performance-critical surface | `performance-optimization`, `code-review-and-quality` |
| Any | progress/session tracking per project convention; `brainstorming` if a finding needs design; `writing-plans` if it needs a plan; `spec-driven-development` if it's a new feature |

Load only what the module needs — the point is depth per iteration, not
a fixed skill list.

## PHASE 1 — Structural mapping

Map the module before reading it:

- **API surface:** exported functions/types entry points.
- **Callers:** which modules use this one.
- **Callees:** what it depends on.
- **Test coverage:** which tests exercise it.
- **File sizes:** files >500 lines → split candidates.
- **Complexity:** modules carrying too many responsibilities.

Use the project's structural index / knowledge graph if one exists;
otherwise derive it from imports, package manifests and grep. Record the
map in the module's scratch file.

## PHASE 2 — Static analysis

Run the project's own toolchain (checked-in wrappers preferred):

- **Rust:** `cargo check -p <crate>` · `cargo clippy -p <crate>
  --all-targets --all-features -- -D warnings` · `cargo fmt --check` ·
  `cargo machete` · `cargo outdated` · `cargo audit` · `cargo deny check`
- **Python:** `pytest`, `mypy`, `ruff check` (project env)
- **TypeScript:** `npx tsc --noEmit` · `eslint` · `vitest run`
- **Web:** `npm ci --ignore-scripts` → `lint` → `tsc --noEmit` → `build`
- **Adapters:** the minimal compile check for their ecosystem

Under the host's permission model, propose the exact commands when
execution is owner-reserved; record output honestly, including skips.

## PHASE 3 — Deep code review

### 3a. Pattern scanning

Count and justify each occurrence in the module:

```
expect( unwrap( unsafe { todo!( unimplemented!( unreachable!(
#[allow(  as-casts  transmute  clone()  .lock()  .block()
catch {} / empty except  let _ = / ignored results
```

Every `expect`/`unwrap` gets justified or flagged replaceable; every
`unsafe` requires a complete safety rationale; every suppression
(`#[allow]`, `eslint-disable`, `# noqa`) needs a stated reason.

### 3b. Error handling

- [ ] All `Result`/error returns handled — no silent `ok()`/swallow
- [ ] `expect()` messages descriptive and state the precondition
- [ ] `unwrap()` provably infallible
- [ ] Nothing swallowed via `let _ =` / empty catch
- [ ] Errors propagated (`?`/typed errors) or wrapped with context
- [ ] Error messages actionable

### 3c. Performance

- [ ] Avoidable allocations in hot paths
- [ ] Lock contention (global vs granular locking)
- [ ] O(n²) where O(n log n) is possible
- [ ] Efficient serialization format for the use case
- [ ] Batch operations vs one-by-one
- [ ] Reasonable durability/sync policy on I/O

### 3d. Concurrency

- [ ] Consistent lock ordering — no deadlock potential
- [ ] Lock kind matches access pattern (read-heavy vs write)
- [ ] Reference cycles in shared ownership
- [ ] Correct atomic orderings (Acquire/Release/SeqCst)
- [ ] Send/Sync or equivalent threading guarantees hold

### 3e. Security

- [ ] Input validation at every public boundary
- [ ] Path traversal in file operations
- [ ] Secrets via env/config, never hardcoded
- [ ] Crypto primitives current and correctly composed
- [ ] Unsafe-code invariants documented

### 3f. Architecture

- [ ] Single responsibility
- [ ] No circular dependencies
- [ ] Feature gating correct — no leakage between features
- [ ] Public API semver-aware
- [ ] Files >500 lines flagged as split candidates

### 3g. Testing

- [ ] Unit tests per public function
- [ ] Edge cases covered (empty, null, boundaries)
- [ ] Integration tests for complete flows
- [ ] Property-based tests where applicable
- [ ] Benchmarks for hot paths

## PHASE 4 — External research per finding

For every non-trivial finding (never typos/formatting — only findings
needing a technical decision), research through whatever web
search/fetch tools the host provides:

- Search the specific issue (e.g. "rust RwLock poisoned recover best
  practice", "HNSW ef_search auto-tuning").
- Fetch authoritative sources: official docs, RFCs, issue trackers,
  reference implementations.
- Record per finding: **source URL · recommended solution (cited) ·
  alternatives considered · final decision and why.**

If no research tooling exists, mark Medium+ findings `needs-research`
and continue — never fabricate sources.

## PHASE 5 — Comparison vs alternatives

For each module, compare against the relevant alternatives in the domain
(competitor products, standard libraries, established implementations):

- Do alternatives have this capability? → **feature gap**
- Do they do it better? → **improvement opportunity**
- Do they lack it? → **advantage — keep it**
- Public benchmarks exist? → record the comparison

Record per finding: gap / advantage / parity, with evidence.

## PHASE 6 — Triage gate

Every finding passes this gate before touching the backlog:

```
Finding: [concrete issue]
Location: path/to/file:42
Type: LOGIC|PATTERN|ARCH|CODE|ERROR|MISSING|FEATURE|ALGO|SECURITY|PERF
        (module-local triage labels — when a finding enters the shared
        registry it folds into `unified-review`'s canonical categories
        and severity scale so cross-module dedupe works)

[ ] 1. Real issue? (reproducible, not a false positive)
[ ] 2. Honest severity? (not inflated)
      critical — data loss, security, broken build
      high     — broken feature, major perf regression
      medium   — degraded UX, CI warning, missing docs
      low      — code smell, minor improvement
      info     — observation, suggestion
[ ] 3. Real user impact? (not theoretical)
[ ] 4. Effort estimate? (XS/S/M/L/XL)
[ ] 5. Known workaround?
[ ] 6. Relation to other findings? (duplicate, shared root cause)
[ ] 7. Needs a feature flag or migration?

Output: ✅ BACKLOG | 🟢 FIX NOW | ❌ DISCARD
```

- **🟢 FIX NOW** — effort XS–S, <30 min, same module → fix immediately
  (with a regression test per `test-driven-development`).
- **✅ BACKLOG** — add to the project's declared backlog/registry with a
  unique finding ID in the project's canonical scheme; record
  `Origin: <module/report>` in the row.
- **❌ DISCARD** — record the reason; do not add.

## PHASE 7 — Module report + yield (output contract)

The deliverable per module: the structural map, the finding list with
`file:line` + type + severity, the research record (URL, cited
solution, decision) for every non-trivial finding, the triage outcome
per finding, the scorecard JSON, and this report:

```markdown
## Module: <name> — Report

**Analyzed:** files N, lines N, public API N, tests N
**Findings:** critical N · high N · medium N · low N · info N
**Fixed immediately:** N   **To backlog:** <IDs>   **Discarded:** N
**Comparison gaps:** N     **Research URLs:** N
**Next module:** <name>
```

Yield with a progress note for the loop driver; on the last module emit
the consolidated report and complete.

## Common rationalizations

|| Rationalization | Reality |
||---|---|
|| "The gate passed, so depth is unnecessary" | A gate samples; the loop exhausts a surface. They answer different questions — see `unified-review`'s division of labor. |
|| "I'll skim the research — I already know the fix" | Unverified fixes from memory are how plausible-but-wrong patterns spread. Medium+ findings need a real source or a `needs-research` mark. |
|| "Findings without file:line are still useful" | They are not actionable and cannot be deduped. Quality Gate 1 exists to bounce them back to analysis. |
|| "Quick triage: put everything in the backlog" | An untriaged backlog is a landfill. Discard with a reason, fix the small ones now, track only what survives the gate. |
|| "Depth=quick is just as good for this module" | Only when external context genuinely cannot change the decision — name why at triage. |

## Red flags

- Findings at Quality Gate 1 missing `file:line`, type or severity.
- A Medium+ finding at Quality Gate 2 with no verified source — or with
  a placeholder/invented URL. Never fabricate references.
- `FIX NOW` applied to a change without a regression case per
  `test-driven-development`.
- Triage that inflates severity to look thorough, or deflates it to
  shrink the report.
- Comparing only against alternatives that confirm the current design.
- Skipping the research and comparison phases for "obvious" findings —
  those are exactly where familiarity bias hides.
- The loop run inside the implementation context for a named-risk
  unit, presented as independent — that requires `independent-review`
  in a genuinely different context, or a disclosed waiver.

## Boundaries

- Inspect the full relevant diff, public contracts, callers and failure
  paths. Trace data, authority, ownership, persistence and concurrency
  where relevant; check adversarial and interrupted states, not only
  ordinary success.
- Compare every acceptance claim with actual verification evidence —
  report evidenced findings first and list unexercised surfaces.
- Do not manufacture quality scores, URLs or comparisons. Do not
  confuse your own implementation context with an independent reviewer —
  for named-risk units, the deep review runs under `independent-review`
  in a fresh context or carries a disclosed degradation plus owner
  waiver.
- Findings are attestations — they authorize nothing by themselves.
