---
name: triage-work
description: Recommend backlog priorities from current evidence without applying them.
---
# Triage Work

Read-only — do not modify any file. Load `planning-and-task-breakdown`;
run as `lead`. Backlog semantics: `references/backlog-format`; governing
rule: `rules/evidence`. When the recommendation needs a consequential
owner choice, ask with `prompts/decision-request`.

## 1. Read the backlog

1. Read the project's recorded backlog source completely (paged reads if
   long) plus persisted task records, including completed/closed
   locations where relevant.
2. Keep only **active** items. The recorded status/disposition is the
   source of truth:
   - Exclude: deferred, icebox, future, discarded, cancelled.
   - Include: pending and in-progress items; include blocked items
     listing their reason, but never recommend them as #1.
3. Check the configured plans path — if the newest plan has tasks in
   flight, mark which backlog items are already running and lower their
   recommendation priority.
4. If no backlog source exists, report that and stop.

## 2. List active items

Group by the backlog's own sections/phases. For each active item emit one
row:

| ID | What it is (one explanatory line) | Effort | Prio |

- **What it is** — the essence in plain language: which problem it
  solves, which risk it mitigates or what it unblocks. Do not copy the
  full description.
- **Effort** and **Prio** — the recorded buckets (e.g. effort
  hours/day/days/weeks; priority p0–p3/backlog, or the project's own
  scale).
- If a section has more than 10 actives, show the first 10 and collapse
  the rest into `+N more (<IDs>) — see backlog`.
- End with `**Total: N active items across M sections.**`

## 3. Score and recommend

Score each active item with this heuristic (simple, not perfect):

| Signal | Points |
|--------|--------|
| Highest recorded priority band | +3 |
| Second priority band | +2 |
| Third band | +1 |
| Lowest bands | 0 |
| Text says "blocks release" / "blocker" | +3 |
| Named-risk category (security, data-integrity, public-contract) | +2 |
| Other items declare a dependency on it | +2 |
| Small effort (quick win of high value) | +1 |
| Very large effort | −1 |
| Already running in the active plan | −2 |

Show the **Top 3** with score and one-line justification each.

**Final recommendation:** the #1 item, with the explicit "why now" (risk
mitigated, release unblocked, dependency freed) and the exact command to
start it — `implement-task <ID>` regardless of type; routing to a
specialist role is that command's concern.

### Graceful degradation

Omit sections with no active items; do not mention an empty plans path;
show no errors.

## Authority and verification

Purely advisory: return recommendations and references only. Do not
create tasks, edit priorities, reopen closed work or start
implementation. Recommending is not authorizing — the owner picks.

## Output contract

Concise markdown — ideally one page, maximum two:

- Section 2: per-section tables with descriptions.
- Section 3: Top 3 with scores plus the final recommendation in bold.

## Red flags

- Recommending a `blocked` item as #1.
- Re-scoring from prose without checking what the active plan already
  runs.
- Emitting errors for absent state instead of degrading gracefully.

## Handoff

The recommendation names the exact `implement-task <ID>` invocation;
batched triage into a formal graph goes through `plan-work`.
