# Graph-Assisted Investigation

Graph tools can accelerate symbol and dependency investigation when their
scope and freshness are known. They are optional external capabilities.
Source search and caller inspection provide a fallback, not an identical
guarantee. Dynamic registration, generated code and external consumers can
invalidate a simple no-callers conclusion. Record the inspected surface.

Two distinct graph capabilities may exist in a project — do not conflate
them:

- **Symbol index** — deterministic, pre-built index of the codebase
  (symbols, call paths, blast radius). Millisecond answers, no LLM cost.
- **Narrative knowledge graph** — an LLM-built graph with descriptive
  layers and a guided tour of the codebase. Complements the index for
  architecture, onboarding and storytelling.

## Decision guide: symbol index vs. narrative graph

| Situation | Tool | Why |
|---|---|---|
| "Where is function X defined?" | Symbol index | Pre-built index, ms answer |
| "What calls this function?" | Symbol index explore | Precise call paths incl. dynamic dispatch |
| "What breaks if I change X?" | Symbol index explore | Blast radius from source |
| "How is the architecture structured?" | Narrative graph | Layers with narrative descriptions |
| "Give me a tour of the codebase" | Narrative graph | Guided tour from entrypoint |
| "Explain this module in detail" | Narrative-graph explain skill/tool | Contextual narrative analysis |
| "Which tests should I run?" | `git diff` + symbol index | Diff-connected exploration |
| "Onboard a new dev" | Narrative-graph onboard | Generated interactive guide |
| "What is the business domain?" | Narrative-graph domain | Domain flows extracted from the graph |
| "What changed in this PR?" | Narrative-graph diff | Diff analyzed against the graph |

**General rule:** symbol index first for anything symbol/code-precise;
narrative graph for architectural context, narrative, onboarding and
visualization.

## Narrative-graph operations (generic)

A narrative-graph tool typically exposes, as commands or skills:

| Operation | Effect |
|---|---|
| scan / build | Scan repo, build the graph into a state dir |
| auto-update | Post-commit hook for incremental updates |
| full rebuild | Complete regeneration (expensive — only when structure changed) |
| chat | Architecture-contextualized Q&A |
| dashboard | Interactive visual panel |
| explain `<path>` | Isolated analysis of one file/module |
| diff | Staged/unstaged changes → predicted impact |
| onboard | Guided tours for newcomers |
| domain | Group code by business entities |
| knowledge `<path>` | Ingest external markdown docs into the graph |

## Recommended workflow

1. **Daily navigation** → symbol index. Faster, deterministic, no LLM
   tokens spent re-analyzing.
2. **Understanding architecture** → narrative-graph chat/explain against
   the *existing* graph; no regeneration needed.
3. **Onboarding/review** → explain/onboard on the existing graph.
4. **Regenerate only when** project structure changes materially (large
   new modules) or a fresher analysis is required.
5. **Never** run a full rebuild casually — a repo-scale graph costs
   substantial agent time; incremental updates cover the daily case.

## Graph schema reference (typical)

```json
{
  "nodes": [{"id": "file:src/engine.rs", "type": "file", "name": "engine.rs",
             "summary": "In-memory storage engine", "tags": ["storage", "core"]}],
  "edges": [{"source": "file:src/engine.rs", "target": "file:src/storage/mod.rs",
             "type": "imports", "direction": "directed", "weight": 0.7}],
  "layers": [{"id": "layer:core-engine", "name": "Core Engine",
              "description": "In-memory engine and storage backends",
              "nodeIds": ["file:src/engine.rs", "..."]}],
  "tour": [{"order": 1, "title": "Project Overview",
            "description": "Start with README", "nodeIds": ["document:README.md"]}]
}
```

Layers are named architectural strata (engine, storage, index, bindings,
integrations, frontend, tests, docs, CI, …) grouping nodes for narrative
and navigation.

## Freshness and trust rules

- [ ] Record graph scope and last-built time before trusting a result.
- [ ] A "no callers" answer is invalidated by: dynamic/reflective dispatch,
      generated code, external consumers, FFI entrypoints, unindexed files.
- [ ] On a pending-sync warning, read the file directly instead of the
      graph.
- [ ] When no index exists, source search + caller inspection is the
      fallback — a weaker guarantee, say so.

<!-- Cross-references: → see architecture.md, mcp-tools.md, task-domain.md -->
