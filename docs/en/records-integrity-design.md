<!-- translated-from: docs/records-integrity-design.md @ 2026-11-24 -->
# Design: signed journal checkpoint (records integrity)

> English translation of the canonical Spanish document
> (`../records-integrity-design.md`). The Spanish version prevails.

> **Status:** DESIGN — decision document from the 2026-11-24 audit.
> Nothing is implemented: no `.mjs` in the repo contains `ed25519`,
> `sign(` or `checkpoint`. Every signature, command and schema below is
> a proposal, not existing code.

## 1. Verified current state (premise correction)

The brief described a "journal with a SHA-256 hash-chain and a
`head.json` carrying `lastSequence`/`lastHash`". Reading the code shows
something different; the design starts from what exists:

| Piece | Verified reality | Reference |
|---|---|---|
| `head.json` | `{schemaVersion:1, lastSequence, activeOperation:{operationId,intentDigest}\|null, pendingOperations?}` — **there is no `lastHash`** | `src/core/journal.mjs:239-269` |
| Global event→event chain | **Does not exist.** Events live inside `operations/<uuid>/intent.json`; global order comes from `journalSequence` (contiguity validated within each intent, `journal.mjs:325-326`) | `src/core/journal.mjs:306-363` |
| Per-record chain | Yes: `update` events carry `previousHash` (pre-image digest, byte CAS) + expected `sourceRevision`. Chain coherence is a read-model check, not a kernel gate | `src/core/record-history.mjs`, `docs/journal-recovery.md` ("CAS updates" section) |
| `sourceHash` per event | SHA-256 of blob content; content-addressed snapshot at `snapshots/<hash>.blob`, re-verified on every read | `src/core/journal.mjs:440-447, 794-808` |
| `intentDigest` | `canonicalDigest(intent)` = SHA-256 over `canonicalJSON` (custom serializer at `src/core/digests.mjs:6-72`); replicated in `head.activeOperation`, `outbox/<id>.json` and `commit.json` — triple-checked | `src/core/journal.mjs:406, 500-520, 874-894` |
| Writes | exclusive `wx` + file fsync + `syncDir` + atomic `head.json` rename via temp | `src/core/journal.mjs:164-207` |

Conclusion: today's integrity is **internal provenance** (the audit
already declared it: "correct chain as internal provenance; NOT
tamper-evident vs whole-rollback/fabrication"). An attacker with local
write access can delete the last N operations, roll `lastSequence`
back, rewrite `head.json` or fabricate complete intents undetected.
That is the gap this design covers.

## 2. Threat model

### Covered

| Threat | Detection mechanism |
|---|---|
| **Truncation** (deleting tail operations/files and lowering `lastSequence`) | The latest signed checkpoint declares a higher `headSequence` than observed + a `headSha256`/`chainHead` that no longer matches |
| **Rollback** (restoring an old head/intents) | Checkpoint `headSha256` mismatches current `head.json` bytes; with `chainHead` the chain replay diverges |
| **Fabrication** of events, intents or checkpoints without the key | Missing/invalid Ed25519 signature; fabricated checkpoints cannot validly continue `prevCheckpointDigest` |
| **Silent modification** (bit-rot, manual edits of intents/snapshots) | Offline verification replays event/snapshot/intent digests against the chain |
| **Fork** of `checkpoints.jsonl` mid-chain | `prevCheckpointDigest` links each checkpoint to the previous one's digest; a fork breaks the link at the divergence point |

### NOT covered (declared, not hidden)

| Threat | Why it stays out |
|---|---|
| **Private key compromise** | With the key, the attacker signs anything. The key lives outside the journal but on the same machine; this is operational tamper-evidence, not an HSM |
| **Full atomic rewrite** (journal + checkpoints + new keypair) | Indistinguishable from a legitimate new journal unless the public key was distributed earlier through another channel |
| **Deleting ALL checkpoints** with no external copy | `checkpoints.jsonl` truncated to an earlier point is only detectable if the verifier knows the latest `checkpointSeq`/digest externally → see `external-anchoring-eval.md` |
| **Live OS-level adversary** | Outside the repo's threat model (`docs/security.md`: cooperative locks, no OS isolation) |
| **Denial** (deleting the whole journal) | Signing does not restore data; it only makes absence detectable |

## 3. Design decisions

### 3.1 Signature: native Ed25519 (`node:crypto`)

Verified by running it in this repo:

- `crypto.generateKeyPairSync('ed25519')` → PKCS8/SPKI pair.
- `crypto.sign(null, payload, privateKey)` → **64-byte** signature;
  `crypto.verify(null, payload, publicKey, sig)` → `true`.
- `publicKey.export({format:'der',type:'spki'})` → 44 bytes.

Native Ed25519 is chosen over **minisign** (external dependency, a
second format to audit) and over HMAC (offline verification would
require sharing the secret). Zero new dependencies.

### 3.2 What gets signed

Each checkpoint signs a self-contained `checkpoint` object:

```json
{
  "schemaVersion": 1,
  "checkpointSeq": 7,
  "createdAt": "2026-11-24T12:00:00.000Z",
  "headSequence": 512,
  "headSha256": "<sha256 hex of the exact head.json bytes>",
  "chainHead": "<sha256 hex | null>",
  "prevCheckpointDigest": "<sha256 hex of the previous checkpoint | null>"
}
```

- `headSha256` anchors the exact `head.json` bytes at that instant
  (including transient `activeOperation`/`pendingOperations` —
  deliberate: any later head rewrite diverges).
- `chainHead` is the new field proposed in §3.4. Until implemented it
  may serialize as `null`; the rest of the schema is unchanged.
- `prevCheckpointDigest` chains checkpoints
  (`= sha256(JCS(checkpoint))` of the previous line; `null` at genesis).
- `checkpointSeq` is a strictly monotonic counter (previous + 1).

### 3.3 About the original premise `{headSequence, headHash, ts, prevCheckpointHash}`

The brief's proposal is kept in spirit with two corrections derived
from the real code:

1. `headHash` materializes as two fields: `headSha256` (bytes of the
   current head) and `chainHead` (event-chain accumulator, §3.4).
   Signing `lastSequence` alone, with no digest, does not detect
   fabrication.
2. `ts` is named `createdAt` and reuses the journal's strict ISO
   validator (`journal.mjs:75-78`).

### 3.4 `chainHead`: a real event chain (detected gap)

Since **no** global event→event chain exists, the design introduces it
in `head.json`:

```
chainHead_0   = sha256("scopegrain-journal-v1")
chainHead_n   = sha256(chainHead_{n-1} || ":" || canonicalDigest(event_n))
```

- Updated inside `atomicHead` in the same write that already advances
  `lastSequence` (integration: `persistIntent`, `journal.mjs:874-894`).
- Each event consumes its `canonicalDigest` (already computed for acks,
  `journal.mjs:457`), so the cost is O(1) per event.
- Offline verification: replay the chain across all intents (live +
  `archive/operations/`, ordered by `journalSequence`) and compare
  with the head's or latest checkpoint's `chainHead`. O(N) once per
  audit, not per read.
- Backward compatibility: heads without `chainHead` are treated as the
  previous `schemaVersion` — migration: the first checkpoint replays
  the full chain and seals it (equivalent to an initial "snapshot").

Alternative considered and rejected: signing `headSha256` only. It
detects head rewriting but **not** history fabrication at equal
`lastSequence`, nor content verification without recomputing every
snapshot. The accumulator solves both at marginal cost.

### 3.5 Checkpoints file: `checkpoints.jsonl`

Location: `<paths.state>/journal/checkpoints.jsonl` (same journal tree;
`paths.state` is owner-configured — `.scopegrain/state` in this repo).

Byte format — **one canonical JSON line per checkpoint**:

```json
{"checkpoint":{...§3.2 object...},"signature":{"alg":"ed25519","keyId":"<fingerprint>","sig":"<base64>"}}
```

- The line is serialized with `canonicalJSON` (single line, no pretty
  printing — see §4) terminated by `\n`.
- `sig` signs exactly the UTF-8 bytes of `JCS(checkpoint)` (the inner
  object, without the envelope).
- `keyId` = `sha256(publicKey DER spki)` hex truncated to 16 chars — a
  convenience label, not authentication (authentication is the
  signature verified against the distributed public key).
- Append under the existing journal lock (`acquireVerifiedLock`,
  `journal.mjs:213-221`): the checkpoint is emitted in
  `finalizeOperation` **after** clearing `activeOperation`, or via the
  explicit `journal checkpoint` command.
- Bound: lines are O(200 B); `readDirBounded`/document limits do not
  apply to JSONL — a `maxCheckpoints` policy cap is proposed
  (rotation: truncate lines older than the last externally sealed one
  only under an explicit flag; by default it never rotates).

### 3.6 Keys

- Separate keyfile, **outside** the journaled tree:
  `<projectRoot>/.scopegrain/integrity/journal-ed25519.key` (PKCS8 PEM)
  + `.pub` (SPKI PEM). `.scopegrain/` is already git-ignored here.
- 0600 permissions where the FS supports it; on Windows the equivalent
  ACL is the operator's responsibility (same as the rest of state).
- Config: optional `integrity.signingKey` pointer in `config.json`
  (project-relative path, validated by `resolveInside`); without a key
  journaling works identically — checkpoints simply are not emitted
  (opt-in, fail-visible, never fail-silent: `journal verify` reports
  "unsigned" explicitly).
- Rotation: new pair → first checkpoint with the new `keyId` carries a
  `supersedesKeyId` field signed by the NEW key; the checkpoint chain
  continues (`checkpointSeq` does not reset). Trust in the new key is
  distributed through the same channel as before (signed git tag,
  pubkey published in the repo).

## 4. Canonicalization: `canonicalJSON` ≡ JCS (RFC 8785)

Signing demands stable bytes. `canonicalJSON` (`src/core/digests.mjs`)
already implements: keys sorted by UTF-16 (`Object.keys(v).sort()`),
number serialization via `JSON.stringify` (exactly the ECMAScript
algorithm RFC 8785 §3.2.2.3 adopts) and minimal string escaping.

Over the **domain the journal admits** (plain objects, strict UTF-8 —
`decodeUtf8Strict` rejects lone surrogates on read —, finite numbers,
no symbols or accessors), output is identical to JCS. Divergences to
declare:

1. Programmatic input with *lone surrogates* in strings would produce
   non-JCS output; the journal never persists such bytes (fail-closed
   on read), though a formal JCS serializer would reject the input.
2. `canonicalJSON` accepts `null`-prototype objects; irrelevant for JCS
   (same result).
3. JCS does not define `undefined`/`bigint`/`NaN` — `canonicalJSON`
   rejects them with `INVALID_JSON_VALUE`: stricter, compatible.

Test vectors (computed with the real code, `digests.mjs`):

| JS input | `canonicalJSON` | `canonicalDigest` (SHA-256) |
|---|---|---|
| `{b:"x",a:1}` | `{"a":1,"b":"x"}` | `ecf9e98ec0641e23113ff3ce8bdc78d0ddd249886517fd4a7f68cc83d4e65667` |
| `{n:1e21,m:-0,s:"€"}` | `{"m":0,"n":1e+21,"s":"€"}` | `1f89e64f1c7fe76427a3470dfeaffbd0f946ad4f29c37d14270ba51925d8fd20` |
| Genesis checkpoint from §3.2 (seq 0, `headSha256`=64 zeros, `chainHead`/`prevCheckpointDigest` null, `createdAt` `2026-11-24T00:00:00.000Z`) | `{"chainHead":null,"checkpointSeq":0,"createdAt":"2026-11-24T00:00:00.000Z","headSequence":0,"headSha256":"0000000000000000000000000000000000000000000000000000000000000000","prevCheckpointDigest":null,"schemaVersion":1}` | `1a0d29b90e1807e1b795298172e40c3a5d50469bc694f2eee1481091cf24baec` |

Vectors 1 and 2 reproduce the classic RFC 8785 cases (key ordering,
`1e+21`, `-0`→`0`, unescaped euro) and confirm equivalence over the
admitted domain.

## 5. Schemas (proposal, `schemas/`)

- `schemas/journal-checkpoint.schema.json` — closed shape of the §3.5
  line (required `checkpoint`, required `signature`, closed keys in the
  same style as `plain()` at `journal.mjs:35-50`).
- `schemas/journal-head.schema.json` — extend when `chainHead` exists
  (no published head schema today; journal schemas cover
  intent/commit/recovery).
- **Mutable sidecars**: the opt-in stores (tasks, approvals, sessions,
  plans, workspaces) keep mutable sidecars (`record-ownership/`,
  `session-ownership/`) whose revisions are already journaled `update`
  events with `previousHash` CAS. Checkpoints do not sign sidecars
  directly: they are covered through the journal chain + the prefix
  re-proof `owned-chain.mjs` already performs (each sidecar snapshot
  re-proves its chain prefix, `transition.mjs:573-609`). The existing
  `schemas/record-ownership.schema.json` is unchanged.

## 6. Integration points (concrete, unimplemented)

| Point | Proposed change | Current reference |
|---|---|---|
| `persistIntent` | Compute the incremental `chainHead` per event and write it into the reserved head | `src/core/journal.mjs:874-894` |
| `atomicHead` | No mechanism change (temp+rename is already atomic); the head object gains `chainHead` | `journal.mjs:196-207` |
| `validateHead` | Accept optional `chainHead` (the `HASH` regex already exists) | `journal.mjs:239-257` |
| `finalizeOperation` | Post-commit checkpoint emission point (cadence: every commit or every N commits — recommended every commit, ~0.2 ms cost) | `journal.mjs:898-924` |
| `compactJournal` | Nothing: archiving alters neither events nor chain; `checkpoints.jsonl` is not compacted | `journal.mjs:658-699` |
| `recoverJournalOperation` | Nothing: `recovery.json` receipts are not events; the chain is unchanged | `journal.mjs:1374-1402` |
| CLI | `journal checkpoint [--project P]` (emit) and `journal verify [--project P] [--export DIR]` (verify chain + signatures + checkpoints, fully offline) | `src/cli.mjs` |
| Standalone verifier | `scripts/verify-checkpoints.mjs` self-contained (~150 LOC: `node:crypto` + a copy of the `canonicalJSON` algorithm + JSONL readers). Exportable: the folder `{head.json, checkpoints.jsonl, operations/, archive/, snapshots/, journal-ed25519.pub}` is a bundle verifiable outside the repo | new |

## 7. What is NOT proposed

- Signing individual events (over-engineering: checkpoint + chain
  already cover them; intents are already `wx`-immutable by convention).
- Mandatory transparency log (evaluated separately in
  `external-anchoring-eval.md`; stays an optional export here).
- Authenticating actors (`authorContext`/`reviewerContext` remain
  attestations — recorded in `known-limitations.md`).
- HMAC or any signature library dependency.

## 8. Residual FMEA of the proposal

| Failure | Effect | Mitigation |
|---|---|---|
| `checkpoints.jsonl` truncated to line k | Detectable only with an external copy of the latest digest | Optional external anchoring; `journal verify --expect-digest` |
| Key readable by another process of the user | Signature forged under the same OS profile | Documented: same boundary as cooperative locks |
| Head migrated to `chainHead` while an event is corrupted | The chain seals the corrupt byte | Migration requires a prior full replay (fail-closed) |
| System clock backwards | Non-monotonic `createdAt`; signature stays valid | `createdAt` is declarative; order is guaranteed by `checkpointSeq` and `prevCheckpointDigest`, not the clock |
| Public key never distributed | Full rewrite undetectable | Publish pubkey in repo/signed tag (see release runbook) |
