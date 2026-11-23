# Core Invariants — Rules

> **Scope:** invariants of the core engine: feature gating, public surface
> discipline, error propagation, unsafe-code accountability, configuration
> conventions and corrupted-state handling.
> **Not here:** public contract/docs parity (`api-contract.md`), storage
> durability (`durability.md`), locking models (`concurrency-async.md`),
> scope discipline (`workflow.md`).
> **Status:** Active
> **Sources:** feature-gating audit (experimental capability shipped
> ungated); code audit (panics in low-level storage, dual env-var naming).

Before changing core code, identify who owns each invariant and which way
the dependencies run; test boundary conditions; avoid unrelated
architecture changes and imported domain assumptions.

## Rules

### 1 — Experimental capability stays behind feature flags — never in defaults

- **Must:** every experimental module or capability compiles behind an
  `experimental-*`-style feature flag declared in the package manifest.
- **Must not:** enable experimental modules in the default feature set or
  in production builds, or leave a capability documented as experimental
  ungated.
- **Why:** an ungated experimental module ships to production by accident,
  exposes unstable API and contradicts the spec contract that tests
  enforce — a feature-gating audit found exactly this drift.

### 2 — Internal functions without external callers stay out of the public surface

- **Must:** mark functions with no verified external callers as internal —
  hidden from docs or package-private.
- **Must not:** export into the public API functions that are only invoked
  internally.
- **Why:** every public symbol is a compatibility contract; what nothing
  outside the package uses must not be promised.

### 3 — No panic-on-error shortcuts outside tests

- **Must:** propagate errors through the project's error/result type in all
  non-test code.
- **Must not:** use unwrap/expect-style calls or error-masking fallbacks on
  non-test paths. Sanctioned exception: a lock-poison helper where a
  poisoned lock is an unrecoverable process invariant.
- **Why:** a panic on a hot path kills the entire process instead of
  returning a typed error to the caller; audits have found panics in
  low-level storage code.

### 4 — Every unsafe block carries a documented invariant

- **Must:** each unsafe block documents its invariant (lifetime, alignment,
  aliasing) with a `// SAFETY:`-style comment naming the property that
  guarantees it; FFI/transmute-style blocks get a memory-checker test where
  the toolchain supports one.
- **Must not:** introduce new unsafe without equivalent debt paydown
  elsewhere in the change (net zero or negative unsafe debt) or without
  its documented invariant.
- **Why:** unsafe concentrates in a few files; a block without a documented
  invariant is an unverifiable promise.

### 5 — Environment configuration uses one prefix and one parse helper

- **Must:** all environment variables share a single documented project
  prefix; reading goes through a common parse helper; an unrecognized or
  malformed value warns and falls back to the documented default — never
  panics.
- **Must not:** hand-roll per-call-site parsing or let two different names
  denote the same concept.
- **Why:** operators cannot predict variable names when conventions drift
  between layers; one audit found the same concept configured under two
  different variable names in different modules.

### 6 — Corrupted state is an explicit error, never an empty success

- **Must:** surface corrupted or unreadable state as a typed error through
  the error path.
- **Must not:** silently replace corrupted state with an empty/default
  result that reads as success (`→ see api-contract.md` for the
  response-level form of this rule).
- **Why:** an empty success converts data loss into a plausible "no data"
  answer; the caller then treats missing data as legitimate emptiness.
