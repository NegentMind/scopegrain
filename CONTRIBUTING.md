# Contributing to Scopegrain

## Evidence gate

A contribution is evaluated on the evidence it carries, not on how
plausible its reasoning sounds. Claims about behavior must cite executed
checks; "could theoretically fail" is not a bug report, and "should work"
is not verification. Never claim an unexecuted check passed.

## Testing deterministic behavior

- Behavioral changes require **positive and negative** coverage: the new
  path works *and* the failure/rejection path is asserted.
- Bug fixes require before-and-after regression evidence: a test that
  fails on the old behavior and passes on the fix.
- Security-sensitive changes (path validation, CAS, ownership, journal)
  additionally need an adversarial case (forged/tampered input).
- Run `node --test tests/` (or the focused file) and report real output.

## Commit and review hygiene

- Behavioral changes update `docs/` and tests in the same change.
- AI-authored commits disclose generation: `Generated with [Devin]` +
  `Co-Authored-By` trailer in the commit message.
- Keep changes inside the authorized workspace; never write outside the
  project root or to global host paths.
- A local commit does not authorize push or publication — ask first.

## Invariants not negotiable

- Core is synchronous, dependency-light, and never spawns processes or
  opens sockets (`child_process`, network) implicitly.
- Mutations are dry-run/preview first, exclusive/create-only, bounded,
  conflict-detecting and atomic.
- Paths stay inside authorized roots; symlinks, junctions and
  regular-file ancestors on destination paths are rejected.
- Foreign user bytes are never overwritten outside the explicit
  managed-marker contract.
