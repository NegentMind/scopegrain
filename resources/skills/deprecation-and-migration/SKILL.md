---
name: deprecation-and-migration
description: Use when replacing behavior, configuration or stored data while preserving a recoverable upgrade path
---
# Deprecation and Migration

## Core discipline

Inventory consumers, stored versions and actual behavior before changing them.
Define source/target contracts, compatibility period and recovery boundary.
Distinguish discovery, dry-run, approval and mutation.
Test old, new, partial and interrupted states in owned fixtures.
Never delete old data or rewrite user configuration without specific approval.
Document breaking cases and unresolved external consumers explicitly.

Code is a liability, not an asset — every line carries ongoing cost: tests,
documentation, security patches, dependency updates, onboarding overhead.
Deprecation is the discipline of removing what no longer earns its keep;
migration is moving consumers safely from old to new.

## When to use

- Replacing a system, API, library or stored format with a new one.
- Sunsetting a feature; consolidating duplicate implementations.
- Removing dead code nobody owns but everybody depends on.
- Planning a new system's lifecycle (deprecation planning starts at design).
- Deciding whether to maintain or migrate away from a legacy system.

## Core principles

- **Code is a liability.** Value is the functionality provided, not the
  code. When the same functionality exists with less code or better
  abstractions, the old code should go.
- **Hyrum's Law makes removal hard.** Every observable behavior — bugs,
  timing quirks, undocumented side effects — may be depended on. Removal
  requires active migration, not just announcement.
- **Deprecation planning starts at design time.** Ask "how would we remove
  this in three years?" Clean interfaces, flags and small surface area make
  future deprecation cheap.

## The deprecation decision

```
1. Does this still provide unique value?        → yes: maintain; no: proceed
2. How many consumers depend on it?             → quantify migration scope
3. Does a replacement exist?                    → no: build it first — never
                                                  deprecate without an alternative
4. What is the migration cost per consumer?     → automatable: do it;
                                                  manual+heavy: weigh vs. maintenance
5. What does NOT deprecating cost?              → security risk, engineer
                                                  time, complexity drag
```

## Advisory vs compulsory

| Type | When | Mechanism |
|---|---|---|
| **Advisory** (default) | migration optional, old system stable | warnings, docs, nudges — consumers move on their own timeline |
| **Compulsory** | security issues, blocks progress, unsustainable cost | hard deadline + provided migration tooling, docs and support |

Default to advisory. Compulsory deprecation obligates you to provide
tooling and support — a bare deadline announcement is not a plan.

## The migration process

### Step 1: Build the replacement first

The alternative must cover all critical use cases, carry documentation and
migration guides, and be proven in production — not merely "theoretically
better".

### Step 2: Announce and document

```markdown
## Deprecation Notice: OldService
**Status:** Deprecated as of <date>
**Replacement:** NewService (migration guide below)
**Removal:** Advisory — no hard deadline | Hard deadline <date>
**Reason:** <why the replacement wins>
### Migration Guide
1. Replace <old import/call> with <new import/call>
2. Update configuration (examples below)
3. Run the verification script/check
```

Distinguish **discovery** (read-only inventory), **dry-run** (simulated
migration, no mutation), **approval** (owner decision) and **mutation**
(actual change). Never skip from discovery to mutation.

### Step 3: Migrate incrementally

One consumer at a time:

```
1. Identify all touchpoints with the deprecated system
2. Update to the replacement
3. Verify behavior matches (tests, integration checks)
4. Remove references to the old system
5. Confirm no regressions
```

**The Churn Rule:** if you own the infrastructure being deprecated, you own
migrating its users — or you provide backward-compatible updates needing no
migration. Do not announce and abandon.

### Step 4: Remove the old system

Only after consumers have migrated:

```
1. Verify zero active usage (metrics, logs, dependency analysis)
2. Remove the code — and only with specific approval, any stored old data
3. Remove associated tests, docs and configuration
4. Remove the deprecation notices
```

## Migration patterns

### Strangler pattern

Run old and new in parallel; route traffic incrementally:

```
0% → 10% (canary) → 50% → 100%; old idle → remove
```

### Adapter pattern

Translate the old interface onto the new implementation; consumers keep
the old contract while the backend changes underneath.

### Feature-flag migration

Switch consumers old→new one at a time behind a flag; roll back per
consumer without redeploying.

### Stored-data migrations: expand/contract (parallel change)

A schema change is the riskiest migration — data is the one thing a
reverted deploy cannot roll back. The failure mode is coupling schema
change to code change: rename a column in the same release that starts
using it, and during the rollout window old and new code run at once — one
of them queries a column that does not exist. **Never change a field in
place.** Migrate in additive phases so both code versions stay valid:

```
EXPAND ──────────────→ MIGRATE ──────────────→ CONTRACT
add new field,        backfill existing       once no code reads the old
nullable, alongside   rows; dual-write        shape, drop it in a later,
the old               old+new                 separate deploy
```

Worked example — renaming `name` to `full_name`:

1. **Expand.** Add `full_name` nullable. Deploy (old code ignores it).
2. **Dual-write.** Write both fields on every mutation. Deploy.
3. **Backfill.** Copy `name → full_name` in batches, throttled, off the
   hot path.
4. **Switch reads.** Read `full_name`, keep writing both. Deploy and bake.
5. **Contract.** Stop writing `name`; in a *separate, later* deploy, drop it.

Each step is independently deployable and reversible — if step 4
misbehaves, rolling back still leaves `full_name` populated. Each phase is
a thin vertical slice (`incremental-implementation`).

**Rules:**

- **Additive first, destructive last and alone.** Adds are safe in any
  deploy; drops/renames get their own deploy after no code references the
  old shape.
- **Every migration has a tested down path.** An irreversible migration is
  a deploy that cannot roll back — write and run the `down` before merging.
- **Backfill in batches, off the hot path.** A single mass update locks
  storage; chunk and throttle.
- **Build large indexes non-blockingly** where the engine supports it.
- **Decouple from code by flag** when the cutover is risky.
- **Test old, new, partial and interrupted states** in owned fixtures —
  including a crash mid-backfill and a resumed migration.
- **Never delete old data or rewrite user configuration without specific
  owner approval.**

## Zombie code

Code nobody owns but everybody depends on — unmaintained, unowned,
accumulating vulnerabilities. Signs: no changes in months with active
consumers; no maintainer; failing checks nobody fixes; dependencies with
known issues nobody updates; docs referencing dead systems.

**Response:** assign an owner and maintain it, or deprecate with a concrete
plan. Zombie code cannot stay in limbo — investment or removal.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "It still works, why remove it?" | Unmaintained working code accumulates silent security and complexity debt. |
| "Someone might need it later" | Rebuildable later; keeping it "just in case" costs more every month. |
| "Migration is too expensive" | Compare against 2–3 years of maintenance; migration usually wins. |
| "We'll deprecate after the new system is done" | Planning starts at design time; post-delivery there are always new priorities. |
| "Users will migrate on their own" | They will not. Provide tooling, docs and incentives — or migrate them yourself. |
| "Maintain both indefinitely" | Two systems doing one job doubles every cost. |
| "Just rename the column, it's one line" | During rollout old and new code coexist; one will query a missing field. |
| "Add and drop in the same migration" | That couples a safe add to a destructive drop; drops get their own deploy. |
| "We'll write the rollback if needed" | A migration without a down path is a deploy you cannot reverse. |

## Red flags

- Deprecation with no replacement, or announcement without tooling/docs.
- "Soft" deprecation advisory for years with no progress.
- Zombie code with no owner and active consumers.
- New features added to a deprecated system.
- Removal without verifying zero active consumers.
- Schema change and dependent code shipped in the same deploy.
- Field renamed/dropped in place instead of expand/contract.
- Migration merged with no tested down path; a backfill that locks storage.
- Old data deleted or user configuration rewritten without explicit approval.
- Discovery/dry-run evidence presented as completed mutation.

## Output contract

A deprecation or migration produces:

- The consumer inventory and usage evidence (metrics/logs) that scoped it.
- The deprecation notice and migration guide with concrete steps.
- Per-phase verification results — old, new, partial and interrupted
  states all exercised in owned fixtures.
- The approval trail: discovery → dry-run → approval → mutation, each
  distinguishable; destructive steps and data deletion only under
  specific owner approval.
- Breaking cases and unresolved external consumers documented explicitly.

## Verification

After a deprecation:

- [ ] Replacement is production-proven and covers all critical use cases.
- [ ] Migration guide exists with concrete steps and examples.
- [ ] All active consumers migrated — verified by metrics/logs, not assumption.
- [ ] Old code, tests, docs and config fully removed; notices removed.
- [ ] Breaking cases and unresolved external consumers documented explicitly.

After a stored-data migration:

- [ ] Additive phases (expand → backfill → contract), not a single edit.
- [ ] Old and new code both valid against the schema at every step.
- [ ] Each migration has a tested down path; backfills ran in throttled batches.
- [ ] Destructive steps shipped in their own deploy, after the old shape
      had no readers.
- [ ] Old, new, partial and interrupted states all exercised in fixtures.

## See also

- `incremental-implementation` — thin vertical slices per migration phase.
- `chained-pr` — delivery slicing when a migration's diff exceeds the
  reviewable budget.
- `api-and-interface-design` — the replacement contract.
- `systematic-debugging` — trace regressions across old/new paths.
