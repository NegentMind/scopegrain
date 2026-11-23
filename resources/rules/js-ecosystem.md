# JavaScript Ecosystem — Rules

> **Scope:** JavaScript/TypeScript/WASM/Node packages: package-manager and
> lockfile integrity, install-time script safety, documented capability
> claims, build artifacts, workspace membership and binding lifecycle.
> **Not here:** browser UI rules (`frontend-web.md`), core business logic
> placement (`api-contract.md`), concurrency primitives
> (`concurrency-async.md`).
> **Status:** Active
> **Sources:** JS/WASM audits (uncommitted artifact cited as structure,
> documented exclusions reported as defects, stale persistence claims,
> fire-and-forget writes lost on close).

## Rules

### 1 — Persistence claims name the opt-in mechanism that enables them

- **Must:** document storage/persistence features with the actual explicit
  backends and the specific call or option that enables them (e.g., a
  persistent constructor versus the default in-memory one).
- **Must not:** claim persistence for the default in-memory path, or
  promise capabilities the target runtime disables.
- **Why:** capability documentation drifts in both directions — a stale
  "always in-memory" claim once hid an implemented persistence layer.
  Claiming less than exists is also a diagnostic failure.

### 2 — Build artifacts are not source — never cite them as repo structure

- **Must:** treat generated package and distribution directories as
  regenerable artifacts; verify a directory exists before citing it in
  docs or research.
- **Must not:** document the contents of an uncommitted artifact directory
  as existing repository structure.
- **Why:** an audit once cited a generated directory — with specific
  modules inside it — as existing; the directory was never committed at
  all.

### 3 — Documented workspace exclusions are decisions, not omissions

- **Must:** keep a package excluded from workspace/monorepo membership
  when a comment records why (e.g., a toolchain or linker conflict), and
  treat it as an intentional decision.
- **Must not:** "fix" an empty or missing members entry without reading
  the exclusion comment and the root manifest.
- **Why:** audits have reported deliberate, documented exclusions as
  defects; reverting them reintroduces the original build failure.

### 4 — Binding lifecycle: op-gate plus drain on close

- **Must:** any binding or adapter exposing asynchronous operations over a
  synchronous engine must (1) offload each operation through the
  blocking-work mechanism, (2) gate every operation so it rejects once
  shutdown begins, and (3) drain the gate before closing the engine.
- **Must not:** allow a fire-and-forget write whose offloaded work has not
  run when `close()` returns — the write is silently lost on exit.
- **Why:** the gate-and-drain pattern is the established lifecycle contract
  across maintained adapters since a dedicated audit; every new binding
  must reproduce it.

### 5 — Package-manager and lockfile evidence governs; contradictions get resolved

- **Must:** determine the package manager from the declared evidence
  (`packageManager` field, lockfile type) and honor the project's module
  format, runtime and supported-version policy; resolve contradictions
  between sources before acting.
- **Must not:** mix package managers inside one project or act on a
  lockfile that contradicts the declared manager.
- **Why:** two managers produce two resolution graphs; the lockfile is the
  only reproducible witness of what was actually installed.

### 6 — Never execute lifecycle scripts to inspect or install

- **Must:** inspect manifests statically, and run installs with lifecycle
  script execution disabled (e.g., `--ignore-scripts`, or the package
  manager's equivalent default), using an explicit allowlist where a
  package legitimately needs one.
- **Must not:** run `install`/`postinstall`-style scripts merely to read
  metadata, or execute them implicitly on untrusted dependency trees
  (`→ see safety.md` — a script's existence is not authorization).
- **Why:** lifecycle scripts are a top supply-chain vector — they run
  arbitrary code from any transitive dependency at install time; disabling
  them by default is the standing industry recommendation.

### 7 — Validate serialization at the browser/server boundary

- **Must:** verify the serialized shapes crossing between JS contexts
  (main thread/worker, browser/server, WASM boundary) against the actual
  emitted payload.
- **Must not:** assume the two sides agree on types, field names or
  encoding.
- **Why:** boundary serialization fails silently — a mistyped field reads
  as undefined, not as an error.

### 8 — No unrelated framework additions or lockfile churn

- **Must:** keep dependency and lockfile changes inside the declared task
  scope (`→ see workflow.md` scope discipline).
- **Must not:** introduce a framework or regenerate lockfiles for
  unrelated work.
- **Why:** lockfile churn rewrites the resolution graph for every consumer
  and hides the real change inside thousands of unrelated diffs.
