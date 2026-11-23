---
name: performance-optimization
description: Use when a performance claim or optimization needs workload-specific measured evidence
---
# Performance Optimization

## Core discipline

Define the workload, metric, environment and trustworthy baseline first.
Record actual commands and raw results; do not invent sample counts,
percentiles or improvement percentages.
Trace the bottleneck before changing implementation.
Compare the same workload and verify correctness after the change.
Label static suspicions and unmeasured effects.
Do not generalize a local run to a production population without evidence.

Measure before optimizing. Performance work without measurement is
guessing — and guessing produces premature optimization that adds
complexity without improving what matters. Profile, identify the actual
bottleneck, fix it, measure again. Optimize only what measurements prove
matters.

## When to use

- Performance requirements exist in the spec (budgets, SLAs).
- Users or monitoring report slow behavior.
- Measured metrics breach thresholds (e.g. web vitals).
- A change is suspected of introducing a regression.
- Features handle large datasets or high traffic.

**Not for:** optimizing before evidence of a problem exists.

**Scope boundary.** This skill owns the measure→fix→re-measure loop for a
suspected or proven bottleneck. Always-on production telemetry (RED/USE
metrics, tracing, alerting) that supplies the evidence is designed in
`observability-and-instrumentation` — instrument once there, measure for
optimization here.

## Web vitals reference targets

The three Core Web Vitals (INP replaced FID in 2024), evaluated at the
**75th percentile of page loads** from field data:

| Metric | Good | Needs improvement | Poor |
|---|---|---|---|
| LCP (largest contentful paint) | ≤ 2.5 s | ≤ 4.0 s | > 4.0 s |
| INP (interaction to next paint) | ≤ 200 ms | ≤ 500 ms | > 500 ms |
| CLS (cumulative layout shift) | ≤ 0.1 | ≤ 0.25 | > 0.25 |

FCP, TBT and TTFB are supporting diagnostics — useful for isolating causes,
not part of the Core Web Vitals set.

## The workflow

```
1. MEASURE  → establish a baseline with real data
2. IDENTIFY → find the actual bottleneck, not the assumed one
3. FIX      → address that specific bottleneck
4. VERIFY   → measure the same workload again, confirm improvement
5. GUARD    → add monitoring or checks to prevent regression
```

### Step 1: Measure

Use both families of measurement:

- **Synthetic** (profilers, lab tooling, CI traces): controlled and
  reproducible — best for regression detection and isolating issues.
- **Real-user** (field telemetry, RUM): required to prove a fix improved
  actual user experience.

Record the actual commands run and raw results. Never invent sample
counts, percentiles, or improvement percentages. A number you did not
measure is a claim, not evidence.

**Start from the symptom:**

```
What is slow?
├── First load
│   ├── Large payload?      → measure transfer sizes, check splitting
│   ├── Slow server?        → measure time-to-first-byte
│   │   ├── DNS long?       → prefetch/preconnect known origins
│   │   ├── TLS/connect long? → newer protocol, edge placement, keep-alive
│   │   └── waiting long?   → profile backend, queries, caching
│   └── Render-blocking?    → inspect the request waterfall
├── Sluggish interaction
│   ├── Freezes on input?   → profile the main thread; long tasks >50ms
│   ├── Input lag?          → check re-render or event overhead
│   └── Animation jank?     → layout thrashing, forced reflows
├── Post-navigation
│   ├── Data loading?       → measure response times, request waterfalls
│   └── Rendering?          → component render time, N+1 fetches
└── Backend / API
    ├── One endpoint?       → profile its queries, check indexes
    ├── All endpoints?      → connection pool, memory, CPU
    └── Intermittent?       → lock contention, GC pauses, external deps
```

### Step 2: Identify the bottleneck

| Symptom | Likely cause | Investigation |
|---|---|---|
| Slow first paint | large assets, render-blocking, slow server | waterfall, asset sizes |
| Layout shift | undimensioned media, late content, fonts | shift attribution |
| Sluggish input | heavy work on the main thread, large DOM updates | long-task trace |
| Slow responses | N+1 queries, missing indexes, unoptimized queries | query log |
| Memory growth | leaked references, unbounded caches, large payloads | heap snapshot |
| CPU spikes | synchronous heavy work, regex backtracking | CPU profile |
| High latency | missing caching, redundant work, network hops | trace through stack |

### Step 3: Fix common anti-patterns

**N+1 access (backend)**

```
BAD:  rows = findMany(); for each row → findUnique(related)   // N+1
GOOD: findMany({ include: related })                          // one query
```

**Unbounded fetching**

```
BAD:  findMany()                       // all rows
GOOD: findMany({ take, skip, order })  // paginated, bounded
```

**Unoptimized media (frontend)**

- LCP/hero media: responsive variants (modern formats, `srcset`/`sizes`
  for resolution and art direction), declared dimensions,
  `fetchpriority="high"`.
- Below-fold media: `loading="lazy"`, `decoding="async"`, declared
  dimensions (prevents layout shift).

**Unnecessary re-renders (component frameworks)**

- Keep prop references stable; extract constants out of the render path.
- Memoize only proven-expensive components and computations — blanket
  memoization is its own cost.

**Oversized bundles**

- Modern bundlers tree-shake ESM named imports when packages mark
  `sideEffects: false`; profile before changing import style.
- Real gains come from splitting: lazy-load heavy, rarely-used features
  and route-level chunks behind a loading boundary.

**Missing caching**

- Cache frequently-read, rarely-changed data with an explicit TTL.
- Immutable static assets: long `max-age` + content-hashed filenames.
- API responses: `Cache-Control` appropriate to mutability.

### Step 4: Verify

Re-measure the **same** workload under the **same** conditions as the
baseline, then verify correctness — an optimization that changes behavior
is a bug. Report before/after numbers with the command and environment
that produced them. Label any expected-but-unmeasured effects as such.

### Step 5: Guard

Set budgets and enforce them in CI where the project supports it:

```
Example budgets:
  JS bundle < 200KB gzipped (initial)   CSS < 50KB gzipped
  image < 200KB above the fold          API p95 < 200ms
  interaction readiness < 3.5s on mid-tier networks
```

Enforcement: bundle-size checks, automated audits (e.g. lab-score CI
runs), or the project's declared performance gate.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "We'll optimize later" | Performance debt compounds; fix proven anti-patterns now, defer micro-optimizations. |
| "It's fast on my machine" | Your machine is not the user's. Profile on representative hardware and networks. |
| "This optimization is obvious" | Without measurement you do not know. Profile first. |
| "Users won't notice 100ms" | Small delays measurably affect behavior; users notice more than assumed. |
| "The framework handles it" | Frameworks prevent some issues; they cannot fix N+1 queries or oversized bundles. |

## Red flags

- Optimization without profiling data to justify it.
- N+1 patterns in data access.
- List endpoints without pagination.
- Media without dimensions, lazy loading or responsive variants.
- Bundle/payload size growing without review.
- No production performance signal at all.
- Memoization everywhere — overuse is as harmful as underuse.
- A local run generalized to a production population without evidence.

## Output contract

An optimization produces evidence, not adjectives:

- The defined workload, metric, environment and baseline (commands + raw
  results).
- The identified bottleneck — traced, not assumed.
- Before/after measurements on the same workload and conditions.
- Correctness confirmation: the project's declared checks still pass.
- Expected-but-unmeasured effects labeled as unmeasured.

## Verification

- [ ] Workload, metric, environment and baseline recorded before changes.
- [ ] Actual commands and raw results preserved; no invented numbers.
- [ ] The specific bottleneck identified and addressed.
- [ ] After-measurement taken on the same workload; numbers reported.
- [ ] Correctness verified — the project's declared checks still pass.
- [ ] Budgets enforced where configured; unmeasured effects labeled.
- [ ] Static suspicions explicitly separated from measured findings.

## See also

- `resources/references/performance-checklist.md` — detailed checklists,
  commands and anti-pattern reference.
- `observability-and-instrumentation` — the telemetry that proves the fix
  held in production.
