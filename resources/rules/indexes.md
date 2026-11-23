# Index and Search Semantics — Rules

> **Scope:** indexing and search implementations: lifecycle semantics,
> correctness vs performance trade-offs, and published benchmark
> integrity.
> **Not here:** concurrency primitives (`concurrency-async.md`), memory
> residency (`memory-budget.md`), query-language semantics
> (`query-dsl.md`).
> **Status:** Active
> **Sources:** benchmark-contract audit (illustrative numbers at risk of
> publication); performance-claim policy.

Apply only to indexing/search implementations. Specify insert, update,
delete, rebuild and failure behavior along with query semantics; test
empty, duplicate, boundary and concurrent cases as relevant. Do not assume
vector indexes, a distance metric or a particular backend — derive the
index contract from the project's actual storage.

## Rules

### 1 — Competitive and benchmark metrics come from real harness runs

- **Must:** publish only numbers produced by actually executing the
  project's benchmark harness, with hardware, versions and run date
  declared alongside the results (e.g., in a results contract or schema
  file).
- **Must not:** publish invented or placeholder numbers in sites, docs or
  PRs, and do not compare runs collected on different hardware.
- **Why:** benchmark credibility depends entirely on reproducibility and
  transparency; fabricated numbers also break consumers that render from
  the results contract (`→ see evidence.md`).

### 2 — Correctness is never traded for a claimed speedup without a recorded contract

- **Must:** keep index semantics (recall, ordering, deletion visibility,
  rebuild correctness) intact under optimization, or record the accepted
  trade-off explicitly with its measurement (`→ see durability.md` for
  trade-off decision records).
- **Must not:** weaken correctness on the strength of a claimed,
  unmeasured or unrecorded speedup.
- **Why:** a faster index that returns wrong results is a defect shipped at
  higher speed; the contract is what separates an accepted trade-off from
  an accidental regression.
