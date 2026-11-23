---
name: observability-and-instrumentation
description: Use when operational claims require real logs, metrics or traces rather than static placeholders
---
# Observability and Instrumentation

## Core discipline

Define the question and the events needed to answer it.
Inspect existing instrumentation and correlation identifiers.
Keep sensitive inputs and credentials out of shared telemetry.
Verify that data is actually collected before exposing or claiming a metric.
Record gaps and collection cost; do not fabricate measurements.
Use owned or authorized environments and preserve failure evidence.

Code that cannot be observed cannot be operated. Observability is the
ability to answer "what is the system doing and why?" from the outside,
using telemetry the code emits. Instrumentation is written alongside the
feature, like tests — a feature shipped without telemetry turns the first
incident into archaeology instead of a query.

## When to use

- Building anything that runs in production.
- New endpoints, background jobs, external integrations, retries or queues.
- An incident took too long to diagnose from available data.
- Setting up or reviewing alerting.

**Not for:**

- Diagnosing a live failure — that is `systematic-debugging` (this skill is
  what makes that one fast next time).
- Optimizing measured slowness — `performance-optimization`.
- Launch-day monitoring checklists and rollback triggers — `shipping-and-launch`.

## Process

### 1. Define "working" before instrumenting

Telemetry without a question is noise. Before adding any signal, write down
2–4 questions an on-call engineer will ask about this feature:

```
FEATURE: payment retry
QUESTIONS ON-CALL WILL ASK:
1. What fraction succeeds on first attempt vs after retry?
2. On permanent failure, why? (provider error? timeout? validation?)
3. Is the provider slower than usual?
→ Every signal below must answer one of these.
```

If the questions cannot be named, do not instrument yet — logging
everything teaches nothing.

### 2. Pick the right signal per question

| Signal | Answers | Cost profile | Example |
|---|---|---|---|
| Structured log | "What happened in this specific case?" | per-event; grows with traffic | `payment_failed` + provider code |
| Metric | "How often / how fast, in aggregate?" | fixed per series; cheap to query | p99 latency of provider calls |
| Trace | "Where did time go across services?" | per-request; usually sampled | one slow checkout by hop |

Rule of thumb: metrics tell you **that** something is wrong, traces tell
you **where**, logs tell you **why**.

### 3. Structured logging

Log events, not prose. Every line is a structured object with a stable
event name and machine-readable fields:

```
BAD:  info(`Payment ${id} failed for user ${userId} after ${n} retries`)
GOOD: warn({ event: 'payment_failed', paymentId: id, provider: 'x',
             errorCode: err.code, attempt: n }, 'payment failed')
```

**Log levels — consistent semantics:**

| Level | Meaning | On-call action |
|---|---|---|
| `error` | invariant broken; someone may need to act | investigate |
| `warn` | degraded but handled (retry succeeded, fallback used) | watch trends |
| `info` | significant business event | none |
| `debug` | diagnostic detail | off in production by default |

**Correlation IDs are mandatory.** Generate or accept a request ID at the
system boundary; attach it to every log line, span and outbound call —
without it, one request cannot be reconstructed from interleaved logs.
Propagate it across service and queue boundaries.

**Never log secrets, tokens, passwords or full PII.** Telemetry pipelines
are a classic leak path — allowlist fields; never log whole request bodies.

### 4. Metrics

For request-driven services instrument **RED** on every endpoint and every
external dependency: **R**ate, **E**rrors, **D**uration (histogram, not
average). For resources (queues, pools, hosts) use **USE**: **U**tilization,
**S**aturation, **E**rrors. (RED is the request-driven subset of the Google
SRE **four golden signals** — latency, traffic, errors, saturation; USE is
the resource-level method.) Prefer the vendor-neutral telemetry standard
(OpenTelemetry or the project's equivalent) so instrumentation outlives
the backend choice.

**Cardinality is the failure mode.** Every unique label combination is a
separate series. Labels come from small, fixed sets only:

```
OK as label:    route_template   status_class="5xx"   provider
NEVER a label:  user_id, email, request_id, raw URL, error text
```

Track averages never, percentiles always — an average hides the 1% of
users having a terrible time. Use histograms; read p50/p95/p99.

### 5. Distributed tracing

- Prefer the vendor-neutral standard with auto-instrumentation covering
  transports and common data clients — near-zero code.
- Add manual spans only around meaningful internal units of work; attach
  the attributes on-call will filter by.
- Propagate context across every async boundary (headers, queue metadata)
  or the trace dies at the gap.
- Sample head-based at a low default rate; keep 100% of errors where the
  backend supports tail sampling.

### 6. Alerting

Alert on **symptoms users feel**, not causes:

```
SYMPTOM (page-worthy):        CAUSE (dashboard, not a page):
error rate > 1% for 5 min     CPU at 85%
p99 latency > 2s              one instance restarted
queue age > 10 min            disk at 70%
```

Cause-based alerts fire when nothing is wrong and miss unpredicted
failures. Rules for every alert:

1. **Actionable** — if the response is "it self-heals", delete it.
2. **Links a runbook** — even three lines: meaning, first query, escalation.
3. **Threshold + duration** justified by the SLO or history, not a guess.
4. **Two severities only**: page (user-facing, act now) and ticket
   (degradation, act this week). A third tier trains people to ignore all.

### 7. Verify the telemetry itself

Instrumentation is code; it can be wrong. Before calling the work done:

- Force an error in an owned/authorized environment → find it by
  correlation ID; confirm fields are structured, not `[object Object]`.
- Send test traffic → confirm metric series appear with expected labels
  and sane values.
- Follow one request end-to-end → no broken spans.
- Fire each new alert once (temporarily lower the threshold) → confirm it
  reaches the right channel and the runbook link works.
- Preserve the failure evidence; record gaps and collection cost. Never
  fabricate measurements or claim a metric before data actually flows.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "I'll add logging after it works" | "After" becomes "after the first incident" — the most expensive time to discover blindness. |
| "More logs = more observability" | Unstructured noise slows incidents. Three queryable events beat 300 prose lines. |
| "console output is fine for now" | Unstructured output cannot be filtered, correlated or alerted on. |
| "We'll check dashboards when it breaks" | Dashboards built without defined questions show everything except the answer. |
| "Alert on everything, tune later" | A noisy pager trains people to ignore it; the real page gets missed. |
| "User ID as a metric label helps debugging" | It also collapses the metrics backend. High-cardinality lookups live in logs/traces. |
| "Tracing is overkill for two services" | Two services already raise cross-service questions logs cannot answer; auto-instrumentation is cheap. |

## Red flags

- A feature with retries, queues or external calls and zero new telemetry.
- Log lines built by string interpolation instead of structured fields.
- No correlation ID — every log line an orphan.
- Metric labels carrying user IDs, raw URLs or error text (cardinality bomb).
- Latency tracked as an average with no percentiles.
- Alerts that fire daily and get acknowledged without action.
- Cause-based paging while user-facing error rate is unmonitored.
- Secrets, tokens or full request bodies in logs.
- "Works on my machine" offered as evidence of production health.

## Output contract

Instrumentation ships with proof it works:

- The on-call questions written down, each signal mapped to one.
- Real telemetry output shown — a structured log line found by correlation
  ID, a metric series with its labels, an end-to-end trace.
- Every alert listed with its symptom, threshold justification, runbook
  link and test-fire result.
- Gaps and collection cost (sampling rate, cardinality, log volume)
  recorded — never a metric claimed before data actually flows.

## Verification

- [ ] On-call questions written down; every signal maps to one.
- [ ] All log output structured with stable event names and a correlation
      ID on every line.
- [ ] No secrets, tokens or unredacted PII in telemetry (spot-checked real
      output).
- [ ] RED metrics on every new endpoint and external dependency, with
      bounded label sets.
- [ ] Latency is a histogram; p95/p99 queryable.
- [ ] One request followable end-to-end in traces without broken spans.
- [ ] Every new alert is symptom-based, runbook-linked, and test-fired once.
- [ ] An induced failure was located via telemetry alone — data actually
      collected, not assumed.

## See also

- `resources/references/observability-checklist.md` — at-a-glance checklist
  and pre-launch instrumentation gate.
- `security-and-hardening` — keep credentials and PII out of telemetry.
- `performance-optimization` — what to do once telemetry proves slowness.
