# Context and Memory Budgets — Rules

> **Scope:** two budget domains: (a) agent context, memory and operation
> budgets of the harness; (b) process memory-residency budgets of a data
> engine — what lives in RAM vs disk, pressure measurement and
> back-pressure.
> **Not here:** resource loading mechanics (`workflow.md`), storage
> durability (`durability.md`), concurrency bounds
> (`concurrency-async.md`).
> **Status:** Active
> **Sources:** memory-residency audit (resident-pages-only metric
> undercounting real RSS ~6.5×); harness budget design.

## Agent context and operation budgets

### 1 — Load only task-relevant resources; keep continuation evidence concise

- **Must:** keep loaded context and continuation/handoff evidence to what
  the task needs — the loading discipline itself lives in `workflow.md`.
- **Must not:** accumulate unrelated context or verbose state that crowds
  out working evidence (`→ see workflow.md`).
- **Why:** context is a budget; every irrelevant page displaces evidence
  the task actually needs.

### 2 — Keep each project's memory isolated

- **Must:** read and write memory within the selected project's
  configured paths.
- **Must not:** import another project's decisions, tasks or evidence.
- **Why:** cross-project memory smuggles foreign context into decisions it
  was never made for.

### 3 — An operation budget counts recorded operations only

- **Must:** interpret budget limits as counts of recorded operations.
- **Must not:** reinterpret the budget as native host calls, tokens,
  financial spend or elapsed time — or narrow it to undercount.
- **Why:** redefining the unit silently moves the limit; both directions
  of drift break the owner's accounting.

### 4 — Never reset a budget or rotate away evidence to bypass a limit

- **Must:** when a budget is exhausted, ask for an explicit new limit or a
  new strategy (`→ see human-decisions.md`).
- **Must not:** reset counters or rotate evidence out of view to make room.
- **Why:** the limit is the owner's control surface; bypassing it silently
  removes the only check on runaway work.

## Process memory budgets

### 5 — Every new user-data structure declares its residence (RAM vs disk)

- **Must:** any new structure retaining user data declares in its design
  or review report where it lives: heap/resident memory, memory-mapped
  file, or a managed store on disk.
- **Must not:** assume "it is on disk" because the data is persisted — the
  live copy may still be RAM-resident.
- **Why:** memory audits confirm headline structures can be fully
  RAM-resident while their persistence suggests otherwise; confusing
  persistence with residence produces surprise out-of-memory kills.

### 6 — Back-pressure decisions use real process memory, not partial estimates

- **Must:** base memory-pressure decisions on actual process resident
  memory measured from the OS, or on a logical estimate explicitly
  documented as such, with a defined fallback when measurement is
  unavailable.
- **Must not:** use the sum of a subset of resident structures (e.g.,
  resident mmap pages only) as the sole pressure signal — it hides heap,
  buffers, caches and indexes.
- **Why:** field measurement found a resident-pages-only metric
  undercounting real process memory by roughly 6.5×, making the guard
  read near-zero pressure while real usage grew linearly with the
  dataset.

### 7 — Apply back-pressure before the OS kills the process

- **Must:** when measured memory crosses the configured threshold, reject
  new writes with a typed resource-limit error carrying bytes used, the
  threshold and a suggested action — before the physical limit is reached.
- **Must not:** let any resident structure grow without a bound set by
  configuration or watermark.
- **Why:** at a linear per-item memory cost, dataset growth eventually
  reaches total machine RAM; without effective back-pressure the OOM
  killer terminates the process with no chance of graceful degradation.

### 8 — Every new resident structure carries a declared hard cap and at-cap policy

- **Must:** in-memory structures whose size depends on user data declare a
  hard cap in the same module, plus a documented policy at the cap: evict,
  stop learning, or reject.
- **Must not:** add an unbounded map, cache or vector whose size follows
  the user's dataset.
- **Why:** existing caps are the only reason those structures do not
  exhaust memory today; the uncapped ones are exactly where the
  back-pressure rules are needed.
