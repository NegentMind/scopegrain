# Architecture Evidence

Useful evidence includes entrypoints, module boundaries, public interfaces,
data ownership, dependencies, persistence, concurrency and deployment layout.
Compare documentation with executing code and tests. Distinguish a proposed
boundary from an enforced one. Record uncertainties and tradeoffs rather
than imposing the architecture of a different repository.

This reference guides how to produce and maintain an architecture map for a
repository. The concrete module inventory of any specific product is the
owner's documentation — record the *structure* of that map, not a borrowed
layout.

## What an architecture map must capture

For each top-level unit (package, crate, module, service, directory):

| Field | Question it answers |
|---|---|
| Identity | Name and path as they exist in the tree today |
| Role | What it owns: business rule, port, adapter, composition root, tooling |
| Public surface | Entrypoints, exported API, feature flags that gate it |
| Dependencies | What it imports and what is allowed to import it |
| Data ownership | State it mutates, persistence backend, schema it defines |
| Concurrency | Threads/actors/async boundaries it introduces |
| Deployment | How it is built, packaged, shipped, or excluded from release |

Example of the annotation style (not a template to copy — the arrows record
one fact each):

```
core/                    ← primary library
  api/                   ← embedded public API (connect(), top-level types)
  engine.*               ← in-memory engine
  storage/               ← persistent backends (default + fallback)
  wal.*                  ← write-ahead log
cli/                     ← feature-gated binary
bindings-python/         ← native bindings for the Python SDK
server/                  ← standalone network server
integrations/            ← thin per-framework adapters
fuzz/                    ← fuzz targets (nightly only, excluded from workspace)
benches/                 ← benchmark suite
```

## Verification questions

- [ ] Does each documented boundary hold in the imports/build graph, or only
      in prose? A boundary that nothing enforces is a proposal, not a rule.
- [ ] Which units are `publish = false`-style internals vs. shipped artifacts?
- [ ] Which modules are excluded from default builds/tests (nightly-only,
      feature-gated, platform-gated)? Iterating against them blind fails.
- [ ] Where does external data enter, and which layer validates it?
- [ ] Which units are the composition root (DI/startup wiring) vs. logic?
- [ ] Are there generated or vendored trees that must not be hand-edited?

## Recording discipline

- Derive the map from the manifest/build files and import graph, then
  annotate — not the other way around.
- When the real tree is flat-by-technical-module but the intended
  architecture is domain-oriented, say so explicitly; do not reorganize
  folders without an approved decision record.
- Update the map in the same change that moves a boundary. An architecture
  doc that trails the code is an evidence defect, not documentation debt.

<!-- Cross-references: → see clean-code-clean-architecture.md, graph-investigation.md, mcp-tools.md -->
