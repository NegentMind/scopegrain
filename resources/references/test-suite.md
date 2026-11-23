# Verification Selection

Start with acceptance criteria and real project scripts/CI evidence.
Select narrow checks for the change and a final agreed integration gate.
Record skipped tests, missing dependencies and supported-version gaps.
Never infer a passing result from a documented command.
Separate unit construction, transport tests and real-host integration.

This is the structure for a project's test-suite reference. Record the real
commands and the hard scoping rules; the examples below are illustrative.

## Command tiers

| Tier | Shape | When |
|---|---|---|
| Iteration (scoped) | `<runner> --profile <audit-profile> -p <package>` — always scoped to the touched package | The daily edit loop |
| Single test | `<runner> --test <name>` or the framework's filter flag | Debugging one case |
| Feature-gated | `<runner> --features "<flag>" --test <name>` | Tests that only exist behind a feature flag |
| Full suite (deliberate) | `<runner> --workspace` or equivalent | Close-of-task verification, certification, release — **never** the iteration default |
| Fuzz / nightly / platform-gated | Separate lane, usually excluded from the workspace | Scheduled or on-demand, with its own toolchain requirements |

## Hard scoping rule

**Always run iteration commands scoped to the touched package.** A
workspace-wide default-member build can unify feature flags in a shared
build dir and hang or collide (e.g. a test server binding a fixed port).
The full-workspace form is legitimate only as a deliberate final check.

## Test categories to enumerate

- [ ] Unit tests (co-located or `tests/unit/`)
- [ ] Integration tests per subsystem (`tests/<domain>/`)
- [ ] API/transport tests (bindings, network surface)
- [ ] Certification/long-running suites (marked; not in the default gate)
- [ ] Property/fuzz targets and their toolchain constraints
- [ ] Real-host interop tests — kept distinct from in-process tests

## Evidence rules

- [ ] A "pass" claim names the command, the scope, and the observed result;
      a documented command is not a passing result.
- [ ] Skipped tests, missing fixtures, and supported-version gaps are
      recorded in the task record — silence implies coverage.
- [ ] A failure is reproduced with a discriminating minimal case before
      being labeled a product bug vs. a broken fixture.

<!-- Cross-references: → see testing-patterns.md, build-system.md, definition-of-done.md, quality-floor.md -->
