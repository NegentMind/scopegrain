---
name: shipping-and-launch
description: Use to assess delivery readiness or plan recovery from a failed release
---
# Delivery and Recovery

Ship with confidence: every launch must be reversible, observable and
incremental. Read the actual release process, target environment and
acceptance evidence. Identify blockers, compatibility, observability and
recovery feasibility. Produce a GO/NO-GO assessment separately from
proposed executable steps. Require action-specific approval for
publication, push, deployment or data migration; credentials must never
enter reports. For recovery inspect actual changed state; a Git revert may
not undo external side effects. Stop when a step fails and record what
remains.

## Output Contract

- A **GO/NO-GO assessment** against the pre-launch checklist — every red
  or yellow item named, none silently skipped.
- A **rollback plan** (trigger conditions, steps, data considerations,
  time-to-rollback) written before any deploy step.
- **Proposed executable steps**, listed separately from the assessment —
  each publish, push, deploy or migrate action carries its own approval
  state.
- **Post-launch evidence** — health, error rate, latency, critical flow —
  reported from observed output, never asserted.

## When to Use

- Deploying a feature to production for the first time
- Releasing a significant change to users
- Migrating data or infrastructure
- Opening a beta or early access program
- Recovering from a failed or partial release
- Any deployment that carries risk (all of them)

## The Pre-Launch Checklist

Run every section; a launch is only as safe as its weakest gate.

### Code Quality

- [ ] All tests pass (unit, integration, end-to-end)
- [ ] Build succeeds with no warnings
- [ ] Lint and type checking pass
- [ ] Code reviewed and approved
- [ ] No TODO comments that should be resolved before launch
- [ ] No debug logging left in production code paths
- [ ] Error handling covers expected failure modes

### Security

- [ ] No secrets in code or version control
- [ ] The ecosystem's dependency audit shows no critical or high
      vulnerabilities
- [ ] Input validation on all user-facing endpoints
- [ ] Authentication and authorization checks in place
- [ ] Security headers configured (CSP, HSTS, etc.)
- [ ] Rate limiting on authentication endpoints
- [ ] CORS restricted to specific origins (no wildcard)

### Performance

- [ ] Latency and size budgets met on critical paths
- [ ] No N+1 queries in critical paths
- [ ] Static assets optimized and cached
- [ ] Database queries backed by appropriate indexes

### Accessibility (when the change is user-facing)

- [ ] Keyboard navigation works for all interactive elements
- [ ] Screen reader can convey page content and structure
- [ ] Contrast meets the project's adopted standard
- [ ] Focus management correct for modals and dynamic content
- [ ] Error messages descriptive and associated with form fields
- [ ] No outstanding automated-scan warnings

### Infrastructure

- [ ] Environment variables set in production
- [ ] Database migrations applied (or ready, with rollback defined)
- [ ] DNS and TLS configured
- [ ] CDN or caching layer configured for static assets (if applicable)
- [ ] Logging and error reporting configured
- [ ] Health check endpoint exists and responds

### Documentation

- [ ] README and setup requirements current
- [ ] API documentation current
- [ ] ADRs written for any architectural decisions
- [ ] Changelog entry written for consumers
- [ ] User-facing documentation updated where applicable

## Feature Flag Strategy

Ship behind feature flags to decouple deployment from release:

```
1. DEPLOY with flag OFF     → Code is in production but inactive
2. ENABLE for team/beta     → Internal testing in production environment
3. GRADUAL ROLLOUT          → 5% → 25% → 50% → 100% of users
4. MONITOR at each stage    → Watch error rates, performance, user feedback
5. CLEAN UP                 → Remove flag and dead code path after full rollout
```

**Rules:**

- Every feature flag has an owner and an expiration date.
- Clean up flags within an agreed window after full rollout.
- Do not nest feature flags (exponential combinations).
- Test both flag states (on and off) in CI.

## Staged Rollout

```
1. DEPLOY to staging
   └── Full test suite + manual smoke test of critical flows

2. DEPLOY to production (feature flag OFF)
   └── Verify deployment succeeded (health check)
   └── Check error monitoring (no new errors)

3. ENABLE for team (flag ON for internal users)
   └── Team uses the feature in production
   └── Monitoring window before wider exposure

4. CANARY rollout (flag ON for a small % of users)
   └── Compare metrics: canary vs. baseline
   └── Advance only if all thresholds pass (table below)

5. GRADUAL increase (25% → 50% → 100%)
   └── Same monitoring at each step
   └── Ability to return to the previous percentage at any point

6. FULL rollout (flag ON for all users)
   └── Monitor for a full observation period
   └── Clean up the feature flag
```

### Rollout Decision Thresholds

Decide at each stage whether to advance, hold, or roll back:

| Metric | Advance (green) | Hold and investigate (yellow) | Roll back (red) |
|--------|-----------------|------------------------------|-----------------|
| Error rate | Within ~10% of baseline | 10-100% above baseline | >2x baseline |
| P95 latency | Within ~20% of baseline | 20-50% above baseline | >50% above baseline |
| New client errors | No new error types | New errors <0.1% of sessions | New errors >0.1% of sessions |
| Business metrics | Neutral or positive | Decline <5% (may be noise) | Decline >5% |

**Roll back immediately if:** error rate exceeds 2x baseline, p95 latency
grows >50%, user-reported issues spike, data integrity problems are
detected, or a security vulnerability is discovered.

## Monitoring and Observability

Monitor three layers:

```
Application:  error rate (total and per endpoint), p50/p95/p99 latency,
              request volume, key business metrics
Infrastructure: CPU/memory, connection pools, disk, network, queue depth
Client:       real-user performance metrics, client-side errors,
              API failure rates from the client perspective
```

Report errors with context (route, subject, stack) but never expose
internals, secrets or credentials in user-facing responses, dashboards or
reports.

### Post-Launch Verification (first hour)

```
1. Health endpoint returns success
2. Error monitoring shows no new error types
3. Latency shows no regression
4. Critical user flow tested manually
5. Logs flowing and readable
6. Rollback mechanism confirmed ready (dry run if possible)
```

## Rollback Plan (write it before deploying)

```markdown
### Trigger Conditions
- Error rate > 2x baseline | P95 latency > [X] | reports of [specific issue]

### Rollback Steps
1. Disable feature flag, OR redeploy the previous known-good version
2. Verify rollback: health check, error monitoring
3. Communicate: notify the team

### Data Considerations
- Migration rollback path: [command, or irreversible + mitigation]
- Data written by the new feature: [preserved / cleaned up]

### Time to Rollback
- Flag: < 1 minute | Redeploy: < 5 minutes | Data rollback: < 15 minutes
```

## Recovery from a Failed Release

- **Stop at the first failed step.** Record completed actions and what
  remains before attempting anything else.
- **Inspect actual changed state** — deployments, flags, migrated data,
  published artifacts, caches — not only the commit graph. A revert does
  not undo external side effects such as published packages, applied
  migrations or invalidated caches.
- **Distinguish rollback from roll-forward.** Restoring the previous
  running state (flag off, previous version) is different from shipping a
  fix. Prefer flag-disable or redeploy over history surgery on shared
  branches.
- Re-run the post-launch verification after recovering.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It works in staging, it'll work in production" | Production has different data, traffic patterns and edge cases. Monitor after deploy. |
| "We don't need feature flags for this" | Every feature benefits from a kill switch. Even simple changes break things. |
| "Monitoring is overhead" | Without it you discover problems from user complaints instead of dashboards. |
| "We'll add monitoring later" | You cannot debug what you cannot see. Add it before launch. |
| "Rolling back is admitting failure" | Rolling back is responsible engineering. Shipping a broken feature is the failure. |

## Red Flags

- Deploying without a rollback plan
- No monitoring or error reporting in production
- Big-bang releases (everything at once, no staging)
- Feature flags with no expiration or owner
- No one monitoring the deploy for the first hour
- Production configuration done from memory, not code
- "It's Friday afternoon, let's ship it"

## Verification

Before deploying:

- [ ] Pre-launch checklist completed (all sections green)
- [ ] Feature flag configured (if applicable)
- [ ] Rollback plan documented
- [ ] Monitoring dashboards set up, team notified
- [ ] Action-specific approval recorded for publish, push, deploy or migrate

After deploying:

- [ ] Health check returns success
- [ ] Error rate and latency normal
- [ ] Critical user flow verified
- [ ] Logs flowing
- [ ] Rollback tested or verified ready

## See Also

- `ci-cd-and-automation` — pipeline-side delivery mechanics (preview
  deployments, promotion flow, rollback workflows); this skill owns the
  launch decision and rollout gates.
- `git-workflow-and-versioning` — tags, SemVer and the changelog contract
  a release consumes.
- `release-notes-one-pager` — the consumer-facing release communication.
- `resources/references/ship-runbook.md` — per-registry publish runbook
  when the project has one.
- `resources/references/definition-of-done.md`,
  `resources/references/security-checklist.md`,
  `resources/references/performance-checklist.md`,
  `resources/references/accessibility-checklist.md`,
  `resources/references/observability-checklist.md` — the standing gates
  behind the pre-launch checklist sections.
