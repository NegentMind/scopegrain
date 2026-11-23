# Public Contracts — Rules

> **Scope:** public API surfaces, bindings, endpoints and tool registries:
> documented claims, observable behavior, boundary validation, error
> semantics, enum/feature compatibility and where business logic lives.
> **Not here:** version numbering and release sync (`release-ci.md`),
> transport-level input handling (`server-mcp.md`), storage corruption
> (`durability.md`).
> **Status:** Active
> **Sources:** API/docs audit findings (documented methods missing from all
> bindings, version drift inside one docset, feature-gated tools exposed as
> live, adapter-side silent behavior divergence).

## Rules

### 1 — Every documented API claim resolves to a real symbol

- **Must:** before documenting a function, class, method, endpoint or tool
  as supported, verify it exists in the code and in the shipped bindings or
  adapters that claim it.
- **Must not:** document speculative or planned APIs as existing. A
  capability implemented in the core but exposed by no binding is documented
  as unavailable on those surfaces, not as supported.
- **Why:** a user following the documented example fails at runtime. A real
  audit found a documented client method that existed in no binding at all;
  the pattern stays prohibited even after that instance was fixed.

### 2 — Version claims resolve to the canonical declaration

- **Must:** API specs, protocol headers and versioned docs take their
  version from the project's canonical version declaration, not from a
  hardcoded literal — the full sync rule including packaging and workflows
  lives in `release-ci.md`.
- **Must not:** let two documents in the same docset declare different
  versions of the same product (`→ see release-ci.md`).
- **Why:** version drift makes it impossible to know which release a
  document describes; mechanical version bumping always leaves hardcoded
  literals behind.

### 3 — Do not expose capabilities the core rejects under default features

- **Must:** a tool, endpoint or adapter method may only invoke a core
  capability that works under the project's default feature set, or must be
  advertised as gated or degraded.
- **Must not:** register a live-looking surface that always fails because
  its implementation is behind a non-default feature or does not exist.
- **Why:** an API that always errors erodes trust and generates false
  issues; audits have caught registered tools whose backing capability was
  feature-gated off by default.

### 4 — Exact file references in documentation

- **Must:** cite real module paths as they exist in the repository.
- **Must not:** cite collapsed paths (`src/sdk.rs` when the module is a
  directory) or invented prefix conventions for the root package.
- **Why:** broken paths fail navigation for readers and agents; one audit
  found multiple false path conventions inside a single docset.

### 5 — Tool and endpoint parity between code and docs in the same change

- **Must:** when adding, renaming or removing a registered tool at the
  tool-registration surface, or an HTTP route, update the protocol and API
  documentation in the same PR.
- **Must not:** merge new tools without documentation entries; where a
  parity gate exists, an undocumented tool must fail it.
- **Why:** undocumented tools accumulate silently — one audit found roughly
  half of the registered toolset missing from the protocol document.

### 6 — Growing public enums are non-exhaustive or versioned

- **Must:** any public enum or union type that may gain variants (errors,
  modes, backends) is declared non-exhaustive or explicitly versioned so
  downstream matches stay source-compatible.
- **Must not:** match exhaustively without a fallback arm over another
  package's public enum; do not add error variants as bare strings where a
  structured/chained error pattern exists — they lose cause-chaining.
- **Why:** adding a variant to an exhaustive enum is a silent breaking
  change; stringly error variants drop diagnostic context that callers rely
  on.

### 7 — Public data shapes are feature-invariant

- **Must not:** conditionally compile an individual public field of a public
  type (e.g., a feature-gated `pub` struct field) — literal construction
  then breaks between feature combinations, making the API non-commutative.
- **Must:** if a field only exists under a feature, use an internal optional
  value, hide the field, or gate the entire type.
- **Why:** consumers with a different feature set fail to compile for
  reasons unrelated to their own code.

### 8 — Business logic lives in the core; bindings and adapters are glue plus memory

- **Must:** business logic — validation semantics, scoring and distance
  math, search decisions (metric selection, result fusion, top-k, dedup),
  state handling — lives in the core. Language bindings, server adapters and
  framework integrations are glue plus memory: serialization, type mapping,
  error translation, runtime-lock release, convenience defaults and input
  guards at the FFI boundary (clamps, length caps — legitimate
  defense-in-depth at a trust boundary).
- **Must not:**
  - reimplement in a binding a calculation the core already provides
    (distance functions, score-to-similarity conversion, normalization);
  - make search decisions at the interface layer: silent metric fallback by
    input shape, client-side fusion or client-side dedup;
  - work around a deliberate core error in one binding while others surface
    it — a binding that silently swallows a deliberate core error creates
    per-platform divergence: same input, different behavior per adapter;
  - duplicate formulas across adapters without a single source.
- **Why:** without the rule each adapter reinvents core semantics and drift
  grows. One audit found an adapter silently substituting a distance metric
  for inputs the core deliberately rejects, duplicate scoring formulas in
  two integrations, and client-side result fusion — same input, different
  results per platform.
- **Exceptions:** framework adapters may implement framework-required
  features (e.g., opt-in reranking or fusion modes) provided (a) the primary
  distance/score computation comes from the core, (b) the score mapping is
  documented and marked with a `TODO(core)` pointer to the core source, and
  (c) the divergent behavior is justified by the framework's contract.
- **Fixes:** move logic to the core only if no public API changes; if it
  requires a spec or breaking change, document it, leave a `TODO(core)`
  marker in the binding and note it in the task report.

### 9 — Validate untrusted input at the boundary; fail fast

- **Must:** validate untrusted inputs and external responses at the
  contract boundary, rejecting locally-invalid arguments before dispatching
  to a remote service or inner layer.
- **Must not:** forward malformed input inward and let a deeper layer
  discover it, or trust an external response shape without checking.
- **Why:** boundary validation localizes faults to the layer that can
  report them coherently; inward propagation turns caller errors into
  internal crashes (`→ see safety.md` for untrusted-content handling).

### 10 — Preserve observable behavior or manage the breaking change

- **Must:** keep observable behavior stable for consumers, or manage the
  break explicitly — versioning, deprecation window, migration notes —
  through the project's change process.
- **Must not:** ship a silent behavior change and let consumers discover
  it.
- **Why:** an unmanaged break transfers the migration cost to every
  consumer at once; a managed break schedules it.

### 11 — Propagate partial and degraded signals; never collapse to empty success

- **Must:** propagate partial-result signals to the caller — abstained
  results, truncation, abstention reasons, degraded or fallback operation —
  reported as such.
- **Must not:** collapse a partial or degraded response into an
  indistinguishable empty success, or present a degraded capability as
  healthy (`→ see core-engine.md` for corrupted internal state).
- **Why:** an empty success is indistinguishable from "no data"; the caller
  silently makes decisions on a fraction of the truth.

### 12 — Error semantics, examples and protocol metadata stay consistent

- **Must:** keep error codes/shapes, documented examples and protocol
  metadata aligned with the implementation in the same change that alters
  them.
- **Must not:** let examples or error contracts drift from what the code
  actually returns.
- **Why:** a drifting error contract is a second, fictional API that
  consumers code against.
