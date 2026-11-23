---
name: ci-cd-and-automation
description: Use when a change affects an existing verification or delivery pipeline
---
# Pipeline Boundaries

Read the project's actual workflows, triggers, credentials and supported
matrix. Trace which inputs, artifacts and privileges cross each job
boundary. Preserve least privilege, reproducibility and clear failure
reporting. Do not weaken tests, widen secrets or add remote side effects
implicitly. Validate syntax and relevant owned fixtures when authorized.
Separate editing a workflow from authorizing its production execution.

Automate quality gates so that no change reaches production without
passing tests, lint, type checking and build. CI/CD is the enforcement
mechanism for every other discipline — it catches what humans and agents
miss, consistently, on every change.

**Shift left:** catch problems as early in the pipeline as possible. A bug
caught in linting costs minutes; the same bug in production costs hours.
Move checks upstream — static analysis before tests, tests before staging,
staging before production.

**Faster is safer:** smaller batches and more frequent releases reduce
risk. A deployment with 3 changes is easier to debug than one with 30.

## When to Use

- Setting up a new project's CI pipeline
- Adding or modifying automated checks
- Configuring deployment pipelines
- Any change that should trigger automated verification
- Debugging CI failures

## Output Contract

- A report of gates added, removed or reordered — with the failure signal
  each gate produces.
- The permissions/secrets delta of the change, called out explicitly
  (new secrets, widened token scopes, new remote side effects).
- Syntax and fixture validation status, marked *executed* or *pending* —
  editing a workflow is reported separately from authorizing its
  production execution.
- No unexecuted check is claimed as passing.

## The Quality Gate Pipeline

Every change passes these gates before merge:

```
Pull Request Opened
    │
    ▼
┌─────────────────┐
│   LINT           │
│   TYPE CHECK     │
│   UNIT TESTS     │
│   BUILD          │
│   INTEGRATION    │
│   E2E (optional) │
│   SECURITY AUDIT │
│   SIZE BUDGET    │
└─────────────────┘
    │
    ▼
  Ready for review
```

**No gate can be skipped.** If lint fails, fix lint — do not disable the
rule. If a test fails, fix the code — do not skip the test. If a gate is
genuinely wrong, change the gate deliberately with owner approval, never
silently.

## Pipeline Shape (portable pattern)

Adapt this skeleton to the project's actual CI platform:

```yaml
# quality job — one job per gate, run in parallel where independent
steps:
  - checkout
  - setup toolchain (pinned version, dependency cache)
  - install dependencies (locked/frozen install)
  - lint
  - type check
  - test (with coverage)
  - build
  - dependency/security audit (fail on high+)
```

Integration tests run against ephemeral services declared in the workflow
(containers with health checks), with credentials from the CI secrets
store — even test-only credentials are never hardcoded. End-to-end jobs
upload their reports/screenshots as artifacts on failure.

## Feeding CI Failures Back to Agents

The power of CI with agents is the feedback loop:

```
CI fails → copy the specific failure output → feed it to the agent
"The pipeline failed with this error: [paste]. Fix and verify locally."
→ agent fixes → pushes → CI runs again
```

| Failure | Agent response |
|---|---|
| Lint | Run the linter's auto-fix, commit |
| Type error | Read the error location, fix the type |
| Test failure | Apply systematic debugging; fix code, not the test |
| Build error | Check config and dependencies |

Never feed back a redacted or paraphrased error — the verbatim output is
the evidence.

## Deployment Strategies

### Preview deployments

Every PR gets an isolated preview deployment for manual verification
before merge.

### Feature flags

Flags decouple deployment from release — ship code without enabling it,
roll back without redeploying, canary a small percentage then widen. Flag
lifecycle (owner, expiry, cleanup), staged rollout percentages and the
advance/hold/rollback thresholds live in `shipping-and-launch`; the
pipeline only has to exercise both flag states in CI.

### Staged rollouts

```
merge to main
  → staging deployment (auto) → manual verification
  → production deployment (manual or auto-after-staging)
  → monitoring window
      ├── errors detected → rollback
      └── clean → done
```

### Rollback mechanism

Every deployment needs a rehearsed reverse path: redeploy a pinned
previous version via a manual/dispatch workflow, or disable the flag.
Document trigger conditions and time-to-rollback before the deploy, not
during the incident.

## Environment and Secrets Management

```
.env.example        → committed (template, no real values)
.env                → never committed (local development)
.env.test           → committed only if it holds no real secrets
CI secrets          → CI secrets store / vault
Production secrets  → deployment platform / vault
```

- CI never holds production secrets; use separate CI-scoped credentials.
- Trace which jobs can read which secrets; a unit-test job should not hold
  deploy credentials (least privilege per job boundary).
- A workflow edit that adds a new secret, token scope or remote side
  effect is a privileged change — flag it explicitly, do not slide it in
  with unrelated edits.

## Automation Beyond CI

- **Dependency updates:** scheduled automated PRs (e.g. Dependabot-style)
  with an open-PR cap so updates stay reviewable.
- **Build Cop role:** designate a rotating owner for keeping the pipeline
  green. When the build breaks, the Build Cop fixes or reverts — preventing
  broken builds from accumulating while everyone assumes someone else will.
- **PR checks:** required reviews, required status checks before merge,
  branch protection against force-pushes, optional auto-merge when green.

## CI Optimization

When the pipeline exceeds ~10 minutes, apply in order of impact:

```
├── Cache dependencies and toolchain artifacts
├── Split gates into parallel jobs (lint ‖ typecheck ‖ test ‖ build)
├── Path filters: skip unrelated jobs (e.g. skip e2e on docs-only PRs)
├── Matrix/shard large test suites across runners
├── Move slow tests off the critical path (scheduled runs)
└── Larger or self-hosted runners for CPU-heavy builds
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "CI is too slow" | Optimize the pipeline; do not skip it. |
| "This change is trivial, skip CI" | Trivial changes break builds; CI is fast for trivial changes anyway. |
| "The test is flaky, just re-run" | Flaky tests mask real bugs. Fix the flakiness. |
| "We'll add CI later" | Projects without CI accumulate broken states. Set it up on day one. |
| "Manual testing is enough" | Manual testing does not scale and is not repeatable. |

## Red Flags

- No CI pipeline in the project
- CI failures ignored or silenced
- Tests disabled to make the pipeline pass
- Production deploys without staging verification
- No rollback mechanism
- Secrets in code or workflow files instead of the secrets store
- Long CI times with no optimization effort
- A workflow edit that widens token permissions or adds remote effects
  without calling it out

## Verification

After setting up or modifying CI:

- [ ] All quality gates present (lint, types, tests, build, audit)
- [ ] Pipeline runs on every PR and push to the default branch
- [ ] Failures block merge (branch protection configured)
- [ ] CI results feed back into the development loop
- [ ] Secrets live in the secrets store, scoped per job
- [ ] Deployment has a documented rollback mechanism
- [ ] Pipeline stays within the project's time budget, or optimization was
      applied (~10 minutes advisory ceiling)
- [ ] Workflow syntax validated; relevant fixtures exercised when authorized
- [ ] Editing the workflow is reported separately from authorizing its
      production execution

## See Also

- `shipping-and-launch` — flag lifecycle, staged-rollout thresholds and
  the launch GO/NO-GO this pipeline feeds.
- `git-workflow-and-versioning` — branching and tagging the pipeline
  protects and publishes.
- `systematic-debugging` — applied when a CI failure needs diagnosis
  rather than a blind re-run.
