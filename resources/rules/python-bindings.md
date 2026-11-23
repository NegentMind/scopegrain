# Python and Native Boundaries — Rules

> **Scope:** Python/native integrations: object ownership, the host runtime
> lock (GIL-class), lifetime, cancellation, exception conversion and batch
> operation contracts.
> **Not here:** business-logic placement (`api-contract.md`), binding
> lifecycle gate/drain (`js-ecosystem.md`), async runtime mechanics
> (`concurrency-async.md`).
> **Status:** Active
> **Sources:** binding-contract design investigation (lock release,
> parallel iteration, callback ownership).

Apply only to Python/native integrations. Before writing binding code,
identify object ownership, the runtime-lock boundary, lifetimes,
cancellation behavior and exception conversion on both sides. Use the
project's actual binding library and supported versions — do not assume a
specific binding framework or GIL API.

## Rules

### 1 — Batch operations release the host runtime lock early, run in parallel, fail fast

- **Must:** batch methods release the host-language runtime lock (e.g.,
  the GIL) as early as possible, execute the batch through the project's
  parallel-iteration mechanism, and propagate the first error rather than
  continuing — every new batch follows this pattern.
- **Must not:** run batch requests sequentially under the held lock, or
  degrade into a loop that keeps going after a failure while holding
  resources.
- **Why:** early release plus parallel fail-fast is the measured contract
  for throughput and tail latency in binding batch paths.

### 2 — Callback lifetimes belong to the binding that manages the runtime lock

- **Must:** when releasing the host runtime lock, move notification and
  callback handlers into the lock-free closure and drop them inside the
  binding layer itself.
- **Must not:** retain those closures in the core or in wrappers that do
  not manage the host runtime's locking.
- **Why:** closing callbacks in the binding avoids dangling references
  between the host-language runtime and native closures.

### 3 — Public parity and error behavior are tested across the language boundary

- **Must:** test that the binding's public surface and its error behavior
  (exception types, messages, edge cases) match the core contract on every
  supported version.
- **Must not:** assume exceptions or return shapes survive the boundary
  unchanged (`→ see api-contract.md` — error semantics are contract).
- **Why:** boundary translation silently alters semantics — a mistyped
  exception or swallowed error is a contract break the compiler cannot
  see.
