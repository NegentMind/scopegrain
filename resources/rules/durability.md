# Persistence and Recovery — Rules

> **Scope:** persistent state: atomicity, durability and recovery
> semantics, write ownership, interruption/corruption testing, accepted
> storage trade-offs and backend tuning.
> **Not here:** lock ordering and async models (`concurrency-async.md`),
> in-memory residency budgets (`memory-budget.md`), destructive-action
> authorization (`safety.md`).
> **Status:** Active
> **Sources:** storage-layout trade-off decision (closed, with measured
> reopening threshold); backend-configuration decision record.

Apply to persistent state. Specify what atomicity, durability and recovery
actually mean for the storage and failure model before writing code.

## Rules

### 1 — Accepted trade-offs stay closed — reopening requires the original measurement

- **Must:** treat a closed "accepted trade-off" decision (e.g., a simpler
  storage layout chosen over physical data locality, at a measured cost
  below a documented threshold) as a frozen contract, and record the
  quantitative reopening signal in the decision record.
- **Must not:** reintroduce the rejected complexity (buffer caches,
  locality-optimized data layouts) without a fresh measurement against the
  original benchmark that crosses the documented threshold.
- **Why:** without the recorded threshold, every new contributor
  re-litigates a measured decision on intuition alone.

### 2 — Storage backend configuration must match the documented access pattern

- **Must:** justify every backend tuning option (compaction, memtable,
  block and cache sizing) against the workload's real, declared access
  pattern — e.g., small frequent writes plus random reads versus
  sequential scans — and require a decision record citing both the pattern
  and a before/after benchmark.
- **Must:** ensure the benchmark dataset exceeds the cache under test; if
  the working set fits in cache, the measured delta is noise.
- **Must not:** change backend options on speculation, or accept tuning
  claims measured on a fully cached working set. Accepted deviations are
  documented with their scope conditions, not silently ignored.
- **Why:** backend defaults are usually aligned with common access
  patterns; unmeasured tuning optimizes a workload that may not exist, and
  a too-small benchmark hides the effect entirely.

### 3 — Writes run under exclusive ownership or declared concurrency control

- **Must:** serialize or explicitly coordinate every write to persistent
  state — exclusive ownership, a write lock, or a declared concurrency
  protocol.
- **Must not:** allow uncoordinated writers against the same persistent
  structure (`→ see concurrency-async.md` for lock ordering when several
  structures are involved).
- **Why:** uncoordinated writes interleave at the byte level; recovery then
  inherits a state no single writer ever produced.

### 4 — Interruption and corruption are tested, never inferred

- **Must:** test interruption and corruption paths — kill mid-write, torn
  pages, truncated logs — and state the durability guarantee each mechanism
  actually provides.
- **Must not:** infer power-loss durability from one successful rename, a
  normal process exit, or a clean shutdown test.
- **Why:** durability claims live or die on the failure paths; a clean-path
  test cannot observe the property being claimed (`→ see evidence.md`).

### 5 — Never destroy user data to recover convenience

- **Must:** recover tests and clear stale locks without deleting
  pre-existing user data; quarantine or back up first when data must move.
- **Must not:** delete or overwrite user data to unblock a test, a stale
  lock or a migration (`→ see safety.md` — destructive operations need
  authorization regardless).
- **Why:** recovery that destroys the data it was meant to preserve is a
  second failure, not a fix.
