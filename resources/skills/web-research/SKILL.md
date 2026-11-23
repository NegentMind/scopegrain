---
name: web-research
description: Use for an explicit external research question after network access has been authorized
---
# External Research

State the decision and precise question before searching.
Prefer applicable primary documentation and recent relevant evidence.
Open and inspect a cited source; a search summary is not its full content.
Cross-check consequential claims and record contradictory evidence.
If sources are inaccessible, report the gap rather than inventing support.
Do not leak project secrets into queries or perform external write actions.
Save findings and uncertainty inside the harness workspace.

## When to Use

- An explicit research question whose answer affects a decision.
- Verifying a claim about tools, libraries, APIs or fast-moving facts
  against official documentation or a primary source.
- Reading a specific URL, recovering a dead link, or validating a fact
  against independent sources.

Not for: questions answerable from the repository itself — local evidence
is faster and more authoritative for local facts.

## The Cascade Router

Never depend on a single tool. Route every query through the cheapest
capable tier first and escalate on failure or insufficient depth:

```
Research request
    │
    ▼
[0] WHICH TIER can answer this?
    │
    ├── 1. KEYLESS SEARCH (zero config, fastest)
    │      Free search endpoints / built-in web search /
    │      direct fetch of a known URL
    │
    ├── 2. MULTI-ENGINE / SPECIALIZED SEARCH
    │      Aggregators covering code, packages, academic,
    │      news, repos; cross-engine comparison =
    │      URLs consistent in ≥2 engines are more trustworthy
    │
    ├── 3. DEEP EXTRACTION
    │      Page → clean text/markdown extractors
    │      Archive lookups for dead URLs
    │      Real-browser rendering for JS-heavy pages
    │
    └── 4. FALLBACKS (escalate, never stall)
           alternate fetch path → text-extraction proxy →
           scripted browser → report the gap explicitly
```

**Golden rules:**

- **Never depend on one engine.** Every tier falls back to the next; if a
  free tier fails, continue with the next keyless option before giving up.
- **Cite every claim with its source URL.** If no tier responds, say so
  explicitly — never fill the gap with internal knowledge presented as
  research.
- **Match the tier to the query type** — do not burn a deep extractor on
  a question a free search answers.

## Flow by Query Type

### General search ("find X on the internet")

1. Free/keyless web search first.
2. Insufficient or biased → multi-engine search.
3. Validate → compare engines; URLs appearing in ≥2 engines rank higher.
4. Read the primary source → fetch/extract the page, quote from the page
   itself, not the snippet.

### Page content ("read this URL")

1. Fast text extraction of the URL.
2. Deeper extractor when the first returns thin or JS-gated content.
3. Paywall/failure → text-extraction proxy endpoints or a real browser.
4. Still inaccessible → report the gap; do not paraphrase unseen content.

### Dead URL / broken link

1. Archive lookup (web archives/mirrors).
2. Nothing → find the same content at a live source via general search.

### Code / packages / repositories

1. Code-and-package-aware search (repos, registries: package indexes,
   source hosts).
2. Fallback → fetch raw file URLs directly.
3. For APIs and libraries, official documentation and the project's own
   repo outrank any third-party writeup.

### Papers / academia

1. Academic search across preprint and index sources.
2. Fallback → fetch the abstract page or PDF directly.
3. Cite the paper, not a blog post about the paper.

### Fact validation ("is it true that...?")

1. Query at least two independent tiers.
2. Prefer sources corroborated across engines.
3. Extract the original text of agreeing sources and cite each.
4. Record contradictory evidence explicitly — a claim with dissenting
   sources is reported as contested, not flattened.

### Deep research (multi-step)

1. Discover candidate sources (general search).
2. Extract the 3-5 most relevant in parallel.
3. Synthesize with per-URL citations and an uncertainty note.
4. Save the digest under the harness workspace (`research/` or the
   configured state path), not in chat only.

## Decision Matrix

| Query type | First tier | Escalate to |
|---|---|---|
| General web / docs / Q&A | keyless search | multi-engine → extraction |
| Known URL content | fast extraction | deep extractor → proxy → browser |
| Dead URL | archive lookup | general search for live copies |
| Repos / code / packages | code/package search | raw-file fetch |
| Academic | academic search | direct abstract/PDF fetch |
| Recent news | keyless search (news) | news-specialized engines |
| Credibility check | 2+ tiers | corroborated original sources |
| Batch / multi-query | keyless search | parallel extraction |

## Failure Diagnosis

| Symptom | Likely cause | Action |
|---|---|---|
| One engine times out / errors | provider or network wedge | next tier; do not retry-loop the same call |
| Extractor returns thin content | JS-rendered or bot-gated page | deeper extractor or real browser |
| "Missing key" / provider disabled | capability needs a credential | use a keyless tier; report the limitation |
| Everything fails | no network route | report the gap explicitly; mark claims unverified |

## Boundaries

- State the decision the research feeds before searching — a question
  without a decision is a fishing expedition.
- Prefer primary documentation and recent (recent years') sources on
  fast-moving topics; note publication dates when recency matters.
- A search snippet is a lead, not evidence: open the source before citing.
- Never place secrets, credentials, private identifiers or unreleased
  internal details into queries.
- Read-only by default: no accounts, posts, comments or other external
  write actions.
- Record sources, contradictions and residual uncertainty in the saved
  finding.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The snippet says enough" | A snippet is a lead, not evidence — open the source before citing it. |
| "I already know this" | Fast-moving topics go stale; an unverified internal claim is not research. |
| "One source agrees, that's confirmation" | One engine's index is one view; consequential claims need ≥2 independent sources. |
| "The tool failed, I'll answer from memory" | Tool failure is a reportable gap, not a license to invent support. |
| "Newer source is always better" | Recency matters on moving topics; primary docs outrank recent blog posts regardless of date. |

## Red Flags

- A cited claim with no source URL, or a URL never actually opened.
- Internal knowledge presented as researched fact.
- Secrets, private identifiers or unreleased details inside a query.
- Findings saved nowhere — the research exists only in chat.
- Contradictory sources flattened into a single confident claim.
- A "verified" claim produced after every tier failed.

## Verification

- [ ] The decision the research feeds was stated before searching.
- [ ] Every claim carries its source URL; each cited source was opened.
- [ ] Consequential claims were corroborated across ≥2 independent
      sources or tiers.
- [ ] Contradictions and residual uncertainty were recorded, not smoothed.
- [ ] The finding was saved under the harness workspace (`research/` or
      the configured state path).
- [ ] No secrets or private identifiers left the project inside a query.
