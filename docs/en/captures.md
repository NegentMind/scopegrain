---
title: "Selective captures (core)"
kind: reference
---

# Selective captures (core)

> English translation of the canonical Spanish document
> (`../captures.md`). The Spanish version prevails.

`src/core/captures.mjs` exposes a typed store of immutable capture notes
with journal-proven ownership. It is groundwork for selective capture:
it does not activate automatic collection, does not collect arbitrary
files (it reads only the managed files its own contract names), does
not read conversations, and does not integrate native backends or
processes.

## Store (core)

```js
import { createCaptureStore } from '../src/core/captures.mjs';

const store = createCaptureStore(ctx, { areaIds: [areaId], origin: 'local-cli' });
const preview = store.prepare({ category: 'decision', title: 'T',
  summary: 'S', areaIds: [areaId] });
const result = store.create({ category: 'decision', title: 'T',
  summary: 'S', areaIds: [areaId] });
const current = store.get(result.record.id);
```

- `ctx` is the resolved project context; `options` is a closed object
  `{areaIds, origin}` validated at construction. The store is frozen
  with exactly `prepare`, `create` and `get`.
- Input `areaIds` require all-of grants from the binding; `origin` is
  fixed at the factory, not per note.

## Record and ownership

Each creation generates a `crypto.randomUUID()` and a strict two-event
journal operation: the note at `<paths.memory>/captures/<id>.json` and
the ownership sidecar at
`<paths.state>/record-ownership/capture/<id>.json`. The two journal
events share `operationId`, `createdAt` and scope; the note does not
carry `operationId`: `note.capturedAt` and `ownership.createdAt` equal
the events' `createdAt`, and the sidecar hash covers the note's exact
UTF-8 bytes.

`create` returns `{mode:'applied', record, sourceRel, ownershipRel,
ownershipConfirmed, journal}`. `ownershipConfirmed` is only `true` if
the journal ended `committed` and `confirmed`; an uncertain result
keeps the journal receipts and does not turn durable sources into a
total failure inviting blind retry.

## Current read

`get(recordId)` returns `{record, ownership, locator:{operationId,eventId},
isCurrentSource:true, memoryConsulted:false}` only if the canonical
sidecar exists, its scope is authorized by the binding, the named
operation is `committed` with exactly two `create` revision-0 events of
the same record, the immutable snapshots match the current files byte
for byte, the typed note matches the event and the current source
equals the snapshot. Drift, absence or non-regular files fail closed
(`CAPTURE_SOURCE_CHANGED`, `CAPTURE_NOT_FOUND`, `CAPTURE_MALFORMED`,
`CAPTURE_NOT_COMMITTED`); historic content is never returned as current
and plausible files are never adopted. Explicit history remains
available through the journal's known APIs, without scanning.

## Fields and limits

- Categories: `decision`, `event`, `attempt`, `discard`, `preference`,
  `tool`, `skill`, `stack`, `lesson`. They are memory notes, not formal
  approvals or ADRs.
- `basis: declared` is an assertion supplied by the caller, NOT
  authenticated human input. `basis: inferred` is never promoted to a
  confirmed preference. `subjectId` is a local attribution label,
  required and non-empty only for `preference`; it is not authenticated
  identity.
- `supersedes` links to a predecessor with the same `category`,
  `subjectId` and exact area set, validated by `get` before writing. An
  `inferred` preference cannot replace a `declared` one
  (`CAPTURE_SUPERSESSION_CONFLICT`). There is no mutable pointer or
  automatic winner between branches; previous bytes are never altered.
- Exact schemas live in `schemas/capture.schema.json` and
  `schemas/record-ownership.schema.json`; pure validators in
  `src/core/capture-data.mjs`.
- Own errors: `INVALID_CAPTURE_INPUT`, `CAPTURE_MALFORMED`,
  `CAPTURE_NOT_FOUND`, `CAPTURE_SOURCE_CHANGED`,
  `CAPTURE_NOT_COMMITTED`, `CAPTURE_SUPERSESSION_CONFLICT`. The codes
  `SCOPE_DENIED`, `WORKSPACE_STALE`, `SYMLINK_REJECTED`,
  `DOCUMENT_TOO_LARGE` and `JOURNAL_*` are kept from the kernel.

## CLI

The CLI exposes four grouped commands: `capture create` and
`capture show` over the store, plus `capture proposals` and
`capture review` over the proposal producers. The
project must already be enrolled: config created and
`node ./bin/scopegrain.mjs workspace init --project "C:\path\my-project" --apply`
(without `--apply` enrollment is preview only). Area grants are derived
from the registered workspace; `workspace show` returns its area IDs:

```powershell
node ./bin/scopegrain.mjs capture create --project "C:\path\my-project" --input capture.json
node ./bin/scopegrain.mjs capture create --project "C:\path\my-project" --input capture.json --apply
node ./bin/scopegrain.mjs capture show "66666666-6666-6666-6666-666666666666" --project "C:\path\my-project"
node ./bin/scopegrain.mjs capture proposals --project "C:\path\my-project" --since-sequence 12
node ./bin/scopegrain.mjs capture review --project "C:\path\my-project" --input review.json
node ./bin/scopegrain.mjs capture review --project "C:\path\my-project" --input review.json --apply
```

Placeholders (`<workspace-area-id>`, the example UUID) must be replaced
with real IDs returned by `workspace show` and by
`capture create --apply`/`capture show`.

(`tasksystem` remains a compatible alias.) `--input` is a path in the
current working directory, not relative to the project. `--config REL`
selects an explicit configuration; memory and state paths are inherited
from that configuration, never written by default. Without `--apply`,
`create` is a read-only preview with provisional identity; `--apply`
returns the full core value, including the journal result with its
receipts and preserved uncertainty. `create` has no `--force`, `--yes`
or command-line selection of destination, namespace, hash or own ID;
`show` accepts the record UUID and `supersedes` references a previous
note.

`capture proposals` is read-only: it lists review proposals derived from
the journal's committed operations (optional `--since-sequence N` cursor)
and from the persisted init answers. `capture review --input review.json`
evaluates a closed decision `{proposal, action, reason?, changes?}` with
`reviewProposal`; without `--apply` it returns the review as a dry run and
with `--apply` it creates an owned capture only if the decision ended
`approved`. A rejected decision or an incomplete proposal never writes.

Minimal input (`capture.json`):

```json
{"category": "decision", "title": "Elegir X", "summary": "Razon breve",
  "areaIds": ["<workspace-area-id>"], "basis": "declared",
  "subjectId": null, "supersedes": null}
```

To correct a note, a new one is created with `supersedes` pointing to
the previous ID; it requires the same `category`, `subjectId` and exact
area set, and an `inferred` preference never replaces a `declared` one.
Previous versions are kept intact: there is no deletion or mutable
pointer, and history remains available through the journal's known
APIs.

This surface is typed manual writing: automatic capture producers, host
hooks and conversation collection remain unconnected. Capture notes are
own records, they do not migrate tasks or formal approvals, and free
text is not declared secret-free or automatically classified.

## Selective proposal producers (core)

`src/core/capture-proposals.mjs` generates capture **proposals** from
activity already recorded by the harness; it never creates captures
itself. It is a pure, opt-in surface: it does not intercept
conversations, does not write to the store or to disk, does not query
memory backends and does not promote inferences into facts. Wiring into
`store.create` belongs to the CLI layer; only the reviewed DTO is
produced here.

A proposal is a closed object `{schemaVersion:1, proposalId, category,
statement, provenance, suggestedAreaIds, suggestedSubjectId, evidence}`.
`statement` is `{kind, title, text, inference}`: `kind:'declared'` only
when the text derives from recorded facts; everything derived from
absent or default values stays `kind:'inferred'` with `inference`
naming the derivation (`harness-default`). `proposalId` is a sha256
digest in UUID shape (version 5, name-seeded), deterministic from
`operationId`/field — repeating the call produces the same IDs, which
enables deduplication without persistence. It is not a random UUID nor
the identity of a stored record.

```js
import { proposeFromJournal, proposeFromInitAnswers, reviewProposal,
  validateProposal } from '../src/core/capture-proposals.mjs';

const proposals = proposeFromJournal(bound, { sinceSequence: 12 });
const prefs = proposeFromInitAnswers(answers, { areaIds: [areaId],
  subjectId: 'owner' });
const reviewed = reviewProposal(proposals[0], { action: 'approve' });
// reviewed.input === { areaIds, capture: { category, title, summary,
//   basis, subjectId, supersedes } } — DTO ready for the store.
```

### proposeFromJournal(target, options)

- `target` is an authentic `bindWorkspace` binding or a resolved context
  `{projectRoot, config}`; with a context all enrolled areas are
  granted, same as the local CLI.
- Closed options `{sinceOperationId, sinceSequence, limit}`; the two
  `since*` are mutually exclusive (`INVALID_PROPOSAL`).
  `sinceOperationId` resolves via `getJournalOperation` to the last
  `journalSequence` of that operation; `sinceSequence` acts as an
  `afterSequence` cursor; `limit` is bounded by `journal.maxPageSize`.
- Enumeration uses paginated `listJournalPending`, the only read of
  committed operations the journal exposes. **Structural limit:** the
  outbox only contains operations with events not yet acknowledged;
  fully acknowledged committed operations or those without an index
  produce no proposals. Proposals are review material, not an audit
  trail. A journal with an abandoned or inconsistent active operation
  propagates `JOURNAL_RECOVERY_REQUIRED` — no proposing over a journal
  that requires recovery.
- Only `committed` items produce proposals; `record-ownership` (sibling)
  events never propose separately.
- Mapping: each committed `create` event produces a `declared` `event`
  proposal (it is a recorded fact). For `sourceKind:'capture'` the
  hash-verified snapshot is read via `readJournalSnapshot`; if it parses
  as a capture note, its recorded title/category enrich the text (stays
  `declared`). An unreadable snapshot degrades to metadata text, never a
  failure for a single event. A recovery receipt in the operation
  produces a `declared` `decision` proposal with `eventId`/`sourceKind`/
  `recordId` as null. A `SCOPE_DENIED` when reading the operation only
  omits the recovery proposal: already authorized events still propose.

### proposeFromInitAnswers(answers, options)

- `answers` is validated with `validateAnswers` (its domain codes
  propagate). Closed options `{areaIds, subjectId}`, both optional;
  `suggestedAreaIds` may end up `[]` because answers can predate
  enrollment. Without an explicit `subjectId`, `suggestedSubjectId`
  defaults to the answered setting's key (`locale`, `hosts`,
  `methodology`, `versioning.<key>`) — a stable subject label, so a
  generated preference approves verbatim and a later preference on the
  same setting can supersede it.
- Emits `preference` proposals in fixed order: locale, hosts,
  methodology and one per versioning key — all `declared` as explicit
  answers. If `methodology` or `versioning` were absent from the raw
  answers, the emitted proposal is `inferred` with
  `inference:'harness-default'`: the validator's defaults are a
  derivation, not an answer.

### reviewProposal(proposal, decision)

- Pure. `decision` is closed `{action, reason?, changes?}` with `action`
  in `approve|reject|edit`; `changes` is required only on `edit` and
  forbidden otherwise — never silently ignored.
- `reject` returns `{status:'rejected'}` and nothing else.
- `approve`/`edit` return `{status:'approved', input:{areaIds,
  capture:{...}}}` — the wrapped DTO the CLI layer will deliver to the
  store (the store consumes the flat shape; adaptation is the CLI's
  responsibility). The composed DTO is validated with
  `normalizeCaptureInput`: approving an incomplete proposal (preference
  without `subjectId`, empty areas) fails closed with
  `INVALID_CAPTURE_INPUT`.
- `approve` keeps the statement `kind` as `basis` — an approved
  `inferred` proposal stays `inferred` (no promotion). `edit` re-marks
  `basis:'declared'` because the text becomes the operator's; `changes`
  admits `title`, `summary`, `category`, `subjectId`, `areaIds` and
  `supersedes` (`basis` is not editable).

### Producer errors and limits

- `INVALID_PROPOSAL` covers proposal, decision, option and target
  validation. Domain codes are preserved: `INVALID_CAPTURE_INPUT`,
  `INVALID_ANSWERS`, `SCOPE_DENIED`, `WORKSPACE_*`, `JOURNAL_*`,
  `INVALID_JSON_VALUE`.
- No conversation capture: there is no message, transcript or channel
  input in the API. No self-writing: producers and `reviewProposal`
  make zero filesystem writes. No inference promotion: only an explicit
  operator `edit` produces `declared`. No project file scanning: sources
  are the journal (including its verified snapshots) and the provided
  answers object; nothing else is read.
- `validateProposal` remains exported to reuse the closed contract in
  the review layer.
