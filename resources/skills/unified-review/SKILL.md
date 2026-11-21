---
name: unified-review
description: Use to choose quick verification, certification, focused review or wider inspection proportional to evidenced risk, without duplicating audit procedures
---
# Review Modes

Quick selects the narrow authorized checks for the change.
Certify checks all agreed prerequisites and separates task, commit and
release readiness. Review inspects logic and risks with source evidence.
Full expands surfaces but must list areas not exercised.
Use project-specific approved commands, never a hardcoded stack.
Report findings and evidence; do not manufacture scores or conformance.
Save the report or review inside the harness workspace.

## Proportionality by evidenced risk

Classify the review depth from evidence — paths, diff content and declared
risk categories — never from change size or author confidence alone:

- **Contained/passive** (docs, comments, tests for existing behavior):
  structural readback — confirm scope boundaries and that nothing
  executable changed; no deep inspection needed.
- **Ordinary/medium**: self-verification plus the standard diff review.
- **Named risk** (security, data-integrity, public-contract, concurrency,
  delivery, external-effects, verification-gap): independent fresh-context
  review is mandatory for that unit; a same-context label change is not
  independence. Owner waiver must explicitly cover the named risk.

The review boundary is the finished work-unit commit or PR slice, not the
accumulated feature. A high-risk unit reviewed inside a bulked diff is
treated as unreviewed: isolate it and review that boundary alone.

Review findings and tiers are attestations of evidence seen — never an
authorization to merge, publish or deliver.
