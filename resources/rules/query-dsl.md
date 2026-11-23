# Query Language Contracts — Rules

> **Scope:** query/DSL implementations: syntax, tokenization, matching
> semantics, error behavior and resource bounds as public contracts.
> **Not here:** index internals (`indexes.md`), API surface documentation
> (`api-contract.md`).
> **Status:** Active
> **Sources:** phrase-matching investigation (positional matching,
> literal tokenization, planner delegation, no external engine).

Apply to query or DSL implementations. Treat syntax, tokenization,
matching semantics and error behavior as public contracts; test quoted,
empty, malformed, nested and adversarial inputs as applicable. Do not
import another product's operators, ranking or phrase semantics.

## Rules

### 1 — Quoted phrases mean strict adjacency

- **Must:** interpret quoted multi-word input as a phrase with contiguous
  tokens in exact order (zero slop), matched against stored positional
  data.
- **Must not:** relax default phrase adjacency (proximity or slop > 0);
  relaxed proximity requires an explicit opt-in extension in the matching
  layer — never a change to storage.
- **Why:** positional matching with strict order is the established
  default, equivalent to mainstream phrase-query semantics; once verified
  working it must not silently loosen.

### 2 — Phrase tokens are literal — no stopword removal or stemming inside quotes

- **Must:** tokenize quoted phrases literally when building the query
  plan.
- **Must not:** run the stemming or stopword pipeline over quoted
  content — it distorts exact matching.
- **Why:** aggressive normalization breaks literal phrases; the parser
  already resolves quoted literals and that semantic must survive parser
  evolution.

### 3 — Do not adopt a heavy external search engine for covered scope

- **Must not:** add a full-text search-engine dependency (and its
  transitive tree) for phrase matching the existing storage already
  implements and tests.
- **Why:** an external engine demands a separate schema, a duplicated
  index and write-path synchronization for a capability already covered —
  YAGNI.

### 4 — One grammar path — the parser delegates phrases to the planner

- **Must:** extract quoted phrases at parse time and delegate to the
  planner's existing phrase-plan path for every new text condition.
- **Must not:** build a second phrase grammar in the parser competing
  with the planner's.
- **Why:** duplicate extraction creates drift between parsing and
  execution; one path keeps semantics checkable end to end.

### 5 — Untrusted queries get explicit work and size bounds

- **Must:** bound query work and input size where untrusted queries can
  exhaust resources — input length limits, plan complexity caps, timeout
  or cancellation support.
- **Must not:** let a user-supplied query drive unbounded allocation or
  evaluation (`→ see api-contract.md` boundary validation).
- **Why:** the query interface is a remote-controlled resource consumer;
  without bounds, a crafted input is a denial-of-service primitive.
