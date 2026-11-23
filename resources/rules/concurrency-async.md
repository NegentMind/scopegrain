# Concurrency and Async — Rules

> **Scope:** concurrent and asynchronous code: event-loop protection, lock
> discipline across suspension points, concurrency bounds, multi-structure
> lock ordering, and runtime neutrality.
> **Not here:** transport/handler applications (`server-mcp.md`,
> `mcp-integration.md`), write ownership in storage (`durability.md`).
> **Status:** Active
> **Sources:** runtime blocking audit; multi-index lock-coordination
> findings (non-reentrant mutex re-acquisition, same-thread rwlock
> deadlock).

Apply only where concurrent or asynchronous code exists.

## Rules

### 1 — Heavy engine work in async handlers goes through blocking-work offload

- **Must:** every call into a synchronous, CPU- or disk-bound engine path
  made from an async context uses the runtime's blocking-work offload
  mechanism (e.g., `spawn_blocking`), following the project's established
  handler pattern.
- **Must not:** run synchronous filesystem calls, batch/flush operations or
  other CPU/disk work directly inside event-loop tasks.
- **Why:** one long synchronous call blocks a runtime worker thread,
  starving the event loop and spiking tail latency under concurrent load.

### 2 — Never hold a synchronous lock guard across a suspension point

- **Must not:** hold a synchronous mutex guard while the task suspends
  (`.await`, yield, or any hand-off back to the scheduler).
- **Must:** use the runtime's async-aware mutex for state shared across
  suspensions; for purely synchronous state, acquire and release the guard
  inside a single synchronous call with no suspension in between.
- **Why:** a synchronous guard crossing a suspension blocks the worker
  thread outside the scheduler's view and can deadlock against task
  scheduling.

### 3 — Bound server concurrency with async-aware semaphores, not locks

- **Must:** cap concurrent handler work with the runtime's async semaphore
  or a connection-pool pattern built on it; bound the offload pool itself
  too — unbounded requests will saturate it.
- **Must not:** invent concurrency limits with synchronous mutexes wrapped
  around handlers.
- **Why:** an async semaphore yields instead of blocking worker threads; a
  synchronous mutex does not.

### 4 — Synchronous locks stay inside synchronous call trees

- **Must:** confine synchronous mutexes to synchronous methods that are
  only reached via the blocking-offload path or a dedicated thread.
- **Must not:** expose those methods as direct async entry points or hold
  their guards across suspensions.
- **Why:** mixing the two models collapses the separation between I/O
  threads and CPU/disk threads; the confinement is what makes the sync
  locks safe.

### 5 — Synchronous file I/O lives on dedicated threads; dual-mode builds stay feature-gated

- **Must:** run synchronous filesystem work inside the blocking offload or
  on dedicated background/init threads — never on the event loop.
- **Must:** where the codebase supports both event-loop and non-event-loop
  builds (e.g., embedded targets), gate the two I/O variants behind a build
  feature with parallel sync/async signatures instead of duplicating logic.
- **Why:** audits confirm dedicated threads do not block the runtime;
  moving those calls into async context without offload reintroduces the
  stall, and a single gated implementation prevents logic drift.

### 6 — Multi-structure writes follow a global lock order; no re-entrant acquisition

- **Must:** every write path that touches multiple shared structures
  acquires locks in one documented global order.
- **Must not:**
  - re-acquire a non-reentrant mutex inside a critical section that already
    holds it — a timed try-lock silently degrades when it expires;
  - call a method that takes a read/write lock the same thread already
    holds for writing (same-thread rwlock re-entry deadlocks);
  - take a blocking write lock on a read path — use try-write with a read
    fallback.
- **Must:** methods that internally acquire a given lock expose a
  `*_locked` (crate-private) variant that assumes the lock is already held;
  callers inside a guarded section always use the `_locked` variant and
  drop other guards before invoking it.
- **Must:** a lock-free "refresh" variant must not silently become a no-op —
  required state transitions still run, just without re-locking.
- **Why:** an audit found a write path calling maintenance work under both
  an outer lock and a cache write guard: the callee re-acquired the
  non-reentrant lock (per-candidate timeout, silent failure) and the rwlock
  deadlocked on the same thread. A fixed order guarantees writers serialize
  predictably and readers never queue behind a writer.

### 7 — Test the concurrent contract, not just the happy path

- **Must:** exercise cancellation, contention, ordering and failure cleanup
  for concurrent paths — queues, permits and shared resources included.
- **Must not:** treat a sequential or single-client test pass as coverage
  of concurrent behavior.
- **Why:** races, leaks and permit starvation are invisible to sequential
  tests; the failure modes this file exists to prevent only appear under
  concurrency (`→ see evidence.md`).

### 8 — Do not impose a runtime or lock type without evidence

- **Must:** use the runtime and primitives the project actually runs on,
  established by inspection.
- **Must not:** impose a specific async runtime, a particular mutex type or
  a language-specific API without evidence that this is the project's
  runtime.
- **Why:** these rules describe a contract, not a vendor; forcing a foreign
  runtime into a codebase creates a second, unowned concurrency model.
