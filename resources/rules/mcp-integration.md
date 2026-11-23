# MCP Integration — Rules

> **Scope:** MCP (Model Context Protocol) server integration: package
> placement, tool-surface fidelity, transport purity, environment hygiene,
> capability hints and interoperability claims.
> **Not here:** HTTP transport specifics (`server-mcp.md`), concurrency
> contract (`concurrency-async.md`), authorization boundaries
> (`safety.md`).
> **Status:** Active
> **Sources:** protocol-integration audits (tools registered against
> nonexistent paths, spec/schema drift); spawned-server environment
> findings.

## Rules

### 1 — Protocol integration lives in its own decoupled package

- **Must:** keep all protocol-server integration in a dedicated,
  separately-versioned package with its own dependencies — not inside the
  core package and not in paths that do not exist.
- **Must not:** place protocol-server logic inside the core package, or
  reference removed or never-created directories as if they held it.
- **Why:** the integration is decoupled so protocol dependencies never
  weigh down the core; references to nonexistent paths mislead every
  consumer.

### 2 — The exposed tool set matches a declared profile and registered schemas

- **Must:** synchronize tool exposure with the active capability profile
  or governance tier, keeping dispatch unified and the registered schemas
  exactly matching the documented specification.
- **Must not:** expose undeclared tools, or let specification and
  registered schema diverge.
- **Why:** agentic clients plan against the declared schema; extra or
  drifting tools waste context-window budget and break strict-schema
  consumers.

### 3 — Never block the transport channel with engine work

- **Must:** route I/O- and CPU-intensive calls through the runtime's
  blocking-work offload, bounded by semaphores — the contract is defined
  in `concurrency-async.md`.
- **Must not:** run synchronous engine computation directly on the stdio
  or streaming transport path (`→ see concurrency-async.md`).
- **Why:** the transport channel serializes every request; one synchronous
  call stalls the entire session.

### 4 — Protocol output and diagnostics travel on separate channels

- **Must:** keep the protocol framing channel (e.g., stdout for stdio
  transports) exclusively for protocol messages; diagnostics, logs and
  progress go to the side channel (e.g., stderr).
- **Must not:** write logging or human-readable output onto the protocol
  channel.
- **Why:** a single stray line corrupts the framed message stream and
  desynchronizes every subsequent request.

### 5 — Capability hints describe intent; they do not enforce access control

- **Must:** treat read-only/destructive-style annotations and Markdown
  roles as advisory declarations.
- **Must not:** rely on them to gate access — enforcement belongs to real
  authorization checks (`→ see safety.md`).
- **Why:** a hint is client-visible text; clients may ignore it and
  servers must not depend on it.

### 6 — No implicit server registration, credential passing or permission widening

- **Must:** register servers, pass credentials and widen host permissions
  only through explicit, authorized configuration (`→ see safety.md`).
- **Must not:** perform any of them as a side effect of setup or probing.
- **Why:** each one silently extends the host's trust boundary; implicit
  extension is indistinguishable from compromise.

### 7 — Interoperability is claimed only from a working exchange

- **Must:** verify an actual protocol exchange (initialize, list, call)
  before claiming a host or client is supported.
- **Must not:** claim interoperability from a generated configuration
  fragment alone.
- **Why:** a config file proves intent to connect, not that negotiation
  succeeds — handshake, schema and capability mismatches only appear on
  the wire (`→ see evidence.md`).

### 8 — Spawned servers run with a constrained environment

- **Must:** when spawning an MCP server, pin or strip ambient variables
  that alter its negotiated surface — profile, injection, taint and budget
  variables of the target server included.
- **Must not:** spawn with an unconstrained inherited environment.
- **Why:** ambient variables silently change the negotiated tool surface;
  the host then plans against tools that differ from what was declared.
