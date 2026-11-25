<!-- translated-from: docs/known-limitations.md @ 2026-11-24 -->
# Known limitations (consolidated register)

> English translation of the canonical Spanish document
> (`../known-limitations.md`). The Spanish version prevails.

> Register of the harness's **declared** residuals: what the system
> knowingly does not guarantee. Each entry's nature:
> `design` (deliberate invariant or decision), `declared` (limit
> honestly documented in the contract) or `debt` (known inconsistency
> pending resolution). The fixable defects catalogued in the audit
> (P0/P1) are not repeated here — this covers residuals, not bugs.

| # | Limitation | Nature | Reference |
|---|---|---|---|
| 1 | **`task gate` covers only edit-class tools** (`Edit/Write/MultiEdit/NotebookEdit` → abstract `edit` action); Bash and other native tools stay outside the gate | `declared` (with debt: Bash coverage is the audit's latent P1 gap) | `src/hosts/gate-proposal.mjs` (matcher, `actionMapping`), `docs/security.md` ("Markdown is not enforcement") |
| 2 | **`VERIFY→STALL→PLAN→ACT` does not accumulate rework.** `FORWARD_SOURCES = {STALL, PLAN, RESEARCH}`: entering `ACT` from those states counts as forward progress or the sanctioned research escape, never as rework — a deliberate semantic decision of the escalation counter | `design` | `src/core/methodology.mjs:19` and the policy comment `~:213-227` |
| 3 | **Evidence is attested, not executed.** A recorded `pass` check does not prove execution; `classificationBasis:'operator-attestation'`, `authenticatesEvidence:false`. Trust comes from the human process | `declared` | `src/core/methodology.mjs:178-179`, `docs/security.md` ("Declared scope and evidence") |
| 4 | **`authorContext`/`reviewerContext` are attestations, not authenticated identities.** No cryptographic authentication of who authored or reviewed | `declared` | `docs/security.md` ("Attestations, not identity"), `src/core/methodology.mjs:179` |
| 5 | **`writeHostRoots:false` is a deliberate security invariant**: state stays project-local; the harness does not write into host roots | `design` | `policy/native-adapters.json:5`, `src/hosts/native.mjs:910`, audit §1 ("design decision — document, do not fix") |
| 6 | **`session resume` restores operational state (`used` counter, CAS, bindings), not the agent's conversation.** The naming is misleading: there is no conversational context replay | `declared` | `src/core/sessions.mjs` (owned session store), audit §3 |
| 7 | **`interceptsNativeTools:false`**: the harness does not intercept the host's native tools; gates are consultable record discipline (`checkAction`), not runtime enforcement | `declared` | `policy/operation-limits.json:12`, `src/core/methodology.mjs:179`, `src/hosts/gate-proposal.mjs:96` |
| 8 | **Residual TOCTOU window**: validation is re-run just before writing, but a local process with write access can interleave between check and write (links, files, post-symlink-check mkdir) | `declared` | `docs/architecture.md` (TOCTOU limits ~:400-415), `docs/security.md` ("Containment vs in-situ write"), `src/api/queries.mjs:1174` |
| 9 | **`scopegrain_context` can write cache under `readOnlyHint`**: `structureDebounceMs` refreshes a record under `<state>/cache` (small derived write) while the tool is annotated `readOnlyHint:true` — declared in the tool's own description | `declared` | `src/mcp/server.mjs:213-219` (`structureDebounceMs` description, `READ_BACKEND` annotation) |
| 10 | **`dist` mutations without `--apply` or preview**: `bundle-mount`/`unmount`, `extension-register`/`activate`/`deactivate`/`remove`, `preset-register`/`remove`, `helper install`, `report save`, `task doc`/`activate` mutate directly (journaled, but without preview) — systemic asymmetry vs `bundle-install` | `debt` (recorded as audit P1-12) | `docs/distribution.md` (verb table), audit §2 |
| 11 | **Unsigned records/journal: whole-rollback/fabrication undetectable** (tail truncation, `head.json` rewrite, fabricated intents). Current integrity is internal provenance | `declared` → **design resolution pending**: [records-integrity-design.md](../records-integrity-design.md) | audit §3, `src/core/journal.mjs` (no signing; `head.json` has no `lastHash`) |
| 12 | **Tokens are declared, not measured**: per-event `tokens` and `tokenLimit` are caller attestations (`tokenMeasures:self-reported-unverified`); the harness does not observe the host's real consumption | `declared` | `docs/security.md` ("Declared, not measured tokens") |
| 13 | **Journal CAS is cooperative, not OS isolation**: writers bypassing the journal can interleave in the check→rename window; locks do not stop foreign processes | `declared` | `docs/journal-recovery.md` (CAS section), `src/core/journal.mjs:1201-1207` |
| 14 | **`memory_recall` with explicit scope leaves per-project isolation** (`agent`/`team` are machine-global pools): hits can include memories from OTHER projects — marked `untrusted` in the tool | `declared` | `src/mcp/server.mjs:534-560` (explicit WARNING in description), audit P1-17 |

## Maintenance notes

- Entry 11 is **covered by a design decision** once
  `records-integrity-design.md` is implemented; until then it stays
  open.
- Nothing here is a bug: these are the limits the contract declares
  (`docs/security.md` "What the code does NOT guarantee" is the
  canonical source of the `declared` class). Any change of nature
  (from `declared` to `design`, or closure) is recorded here with the
  resolving reference.
