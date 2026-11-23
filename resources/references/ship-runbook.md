# Delivery Runbook Skeleton

Discover the actual release process and target. Validate agreed checks,
review, compatibility, secrets handling and recovery feasibility.
Assess GO/NO-GO separately from executable publication steps.
Obtain action-specific authority before external side effects.
On failure inspect actual changed state; a source revert may leave data,
registries or deployments unchanged. Record every completed/pending step.

This is the canonical procedure shape for a fan-out GO/NO-GO ship decision
plus its rollback. Commands and personas referenced below are the harness's
ship/rollback operations — adapt the names to the project.

## Pre-flight (mandatory)

Run the project's mechanical audit gate before the ship decision. An audit
failure defaults to **NO-GO**. Never start publication to make a failing
gate pass.

## Phase A — Parallel fan-out

Spawn the specialist reviews in parallel — all spawns in a single turn.
Three lenses cover most releases:

1. **Security & memory safety** — unsafe blocks, FFI boundaries, dependency
   advisories, supply chain. No functional review (that lives in Phase B).
2. **Coverage & resilience** — fuzzing/chaos gaps, edge cases, races,
   concurrency. Output: analysis + recommended tests.
3. **Performance & observability** — latency/error metrics on new
   endpoints, benchmark regression in hot paths (named baseline
   before/after), binary size, backpressure.

If parallel spawning is unavailable, run them sequentially — the merge
works the same.

## Phase B — Merge (in the main context, no personas)

1. **Code quality** — Critical/Important findings from every specialist +
   tests/lint/build. Deduplicate. Functional review axes live here
   (correctness, readability, architecture).
2. **Security** — Critical/High findings are blockers.
3. **Performance** — from the perf specialist; web vitals if applicable.
4. **Accessibility** — keyboard, screen reader, contrast (own checklist).
5. **Infrastructure** — env vars, migrations, monitoring, feature flags.
6. **Documentation** — README, decision records, changelog.

## Phase C — Decision + mandatory rollback plan

```markdown
## Ship Decision: GO | NO-GO
### Blockers (must fix) — [origin: finding severity + file:line]
### Recommended fixes — [origin: finding + file:line]
### Acknowledged risks — [risk + mitigation]
### Rollback plan — triggers, exact procedure, RTO, previous SHA
### Specialist reports (full)
```

Persist both artifacts:

- A dated report file under the project's ship-reports path.
- A machine-readable last-ship-state record:
  `{timestamp, decision, sha_shipped, previous_sha, rollback_plan, trigger_conditions}`.

## Rules

1. Fan-out is parallel, never sequential. Personas do not call each other.
2. A rollback plan is mandatory before any GO.
3. A Critical finding from any lens → default NO-GO unless explicitly
   accepted by the owner.
4. Skip fan-out only if: ≤2 files AND diff <50 lines AND does not touch
   auth/payments/data/env-config. Default is always fan-out.

## Rollback (post-ship failure)

Prerequisite: a prior ship report (fallback: git history).

1. **Discover** — locate the latest ship report + last-ship-state record +
   recent ship commits in history. Identify shipped SHA, rollback plan,
   which triggers fired, which flags/migrations were applied.
2. **Preconditions** — working tree clean (stash or abort). Target SHA from
   the plan or owner-chosen; verify the target is an ancestor of HEAD.
   **Unrevertible check:** destructive migrations (DROP/DELETE without
   WHERE) → abort; manual intervention required.
3. **Revert** — `git revert --no-commit <target>..HEAD` (on conflict, abort
   the merge/revert and report). Revert flags/env/configs. Roll back
   migrations if a rollback exists. Compile + test; if that fails, reset
   hard and report.
4. **Finalize** — commit `rollback: revert <desc>`. Health check. Write a
   dated rollback report (cause, SHAs, lessons, link to ship report).
   If the original ship plan gave exact steps, those steps take precedence
   over this generic procedure.

## Registry/publication traps (learned from failed releases)

- **Secrets must exist and be non-empty.** In registry publishing, the
  *presence* of an empty token env var can disable trusted/OIDC publishing
  while still failing authentication. Use OIDC *or* a publish-scoped token —
  never both, never an empty variable.
- **A token is only verified if a real publish accepts it.** Reading an
  owners list or `whoami` does not prove publish scope.
- **Staging channels can't create packages.** A first-publish needs a
  direct-capable token.
- **Channel pins collide.** If a CI step names a different toolchain channel
  than the repo's pin file, the file wins — set the env override in the step.
- **Don't resolve a just-published version in the same run.** Registry
  propagation races (ETARGET); retry with backoff, don't hard-fail.
- **`workflow run` dispatches need an explicit repo flag** when there's no
  checkout.
- **Release automation often requires a branch-name prefix** to trigger
  publication; merging from an un-prefixed branch leaves the release
  unpublished.
- **Post-release hygiene:** fast-forward the development branch to the
  release branch so a later merge doesn't revert fixes that only exist on
  the release branch.

**Final verification:** run the project's release-verification script
(assets + registries + checksums + `--version` smoke) after the tag lands.

<!-- Referencias cruzadas: → ver definition-of-done.md, observability-checklist.md, orchestration-patterns.md, dev-tools.md -->
