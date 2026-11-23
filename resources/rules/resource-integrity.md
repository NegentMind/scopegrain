# Resource Integrity — Rules

> **Scope:** trust boundaries of the project's instruction and resource set:
> which snapshot is authoritative, validation before reliance, recovery from
> missing or divergent resources, and unpinned legacy handling.
> **Not here:** loading order and the mandatory force of loaded rules
> (`workflow.md`, `methodology.md`), untrusted external text (`safety.md`).
> **Status:** Active

## Rules

### 1 — Use one authoritative snapshot per project

- **Must:** take operational context from the selected project's own
  snapshot.
- **Must not:** silently mix it with installation, global or archived
  instructions.
- **Why:** two instruction sets disagreeing about workflow produce hybrid
  behavior accountable to neither.

### 2 — Validate resources before relying on them

- **Must:** check schema, paths, dependencies and whatever integrity
  evidence exists (hashes, manifests, signatures).
- **Must not:** assume a resource is current because it is present.
- **Why:** presence proves existence, not correctness or provenance.

### 3 — Missing or divergent resources need diagnosis, not silent repair

- **Must:** diagnose the divergence and obtain an explicit recovery
  decision.
- **Must not:** auto-download, overwrite, activate replacements, or claim
  version equivalence without evidence.
- **Why:** silent repair substitutes unverified content for declared
  content — the exact failure mode integrity checking exists to prevent.

### 4 — Unpinned legacy stays labeled, never hash-verified

- **Must:** label content with no pinned version or hash as unpinned legacy.
- **Must not:** present it as verified or integrity-checked.
- **Why:** the label preserves the honest trust level; a false verification
  claim is worse than none.
