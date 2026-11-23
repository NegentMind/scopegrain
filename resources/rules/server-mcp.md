# Server and Protocol Boundaries — Rules

> **Scope:** server and protocol-serving surfaces: identity/version
> fidelity, handler concurrency, transport input validation, metrics
> honesty and failure-path testing.
> **Not here:** stdio/MCP-specific integration (`mcp-integration.md`),
> concurrency contract details (`concurrency-async.md`), public API
> surface rules (`api-contract.md`).
> **Status:** Active
> **Sources:** protocol audits (documented tool that did not exist,
> phantom resource scheme, mismatched declared version); metrics-endpoint
> finding (registered-but-never-observed histograms).

## Rules

### 1 — Server identity and protocol versions match the implementation

- **Must:** keep declared server identity, protocol version, resource
  schemes and the tool list synchronized with the actual implementation.
- **Must not:** document tools that are not registered, resource schemes
  that do not exist, or protocol versions the server does not speak.
- **Why:** one audit found a documented tool that did not exist, a
  phantom resource scheme and a declared version matching nothing —
  clients negotiate against fiction.

### 2 — Handler concurrency follows the shared contract

- **Must:** cap concurrent handler work with the runtime's async
  semaphore and run engine work through the blocking-work offload
  mechanism — the contract is defined in `concurrency-async.md`.
- **Must not:** block the server event loop with synchronous engine
  work, or invent concurrency limits with synchronous mutexes
  (`→ see concurrency-async.md`).
- **Why:** unbounded synchronous work on the event loop starves every
  connected client.

### 3 — Metrics endpoints serve fed metrics — no placeholders

- **Must:** a public metrics endpoint exports metrics actually recorded
  from the serving hot path (request-latency histograms, request
  counters, import/export counters) through the real registry.
- **Must not:** register metrics nothing records, expose empty counters
  or histograms, or return placeholder text while the metrics feature is
  enabled.
- **Why:** an integrator will probe the endpoint; a
  registered-but-never-observed histogram returns empty output and the
  endpoint reads as decorative.

### 4 — Transport inputs, authorization context and serialized outputs are validated

- **Must:** validate request inputs at the transport boundary, carry the
  authorization context explicitly into handlers, and verify serialized
  output shapes against the declared contract (`→ see api-contract.md`
  boundary validation).
- **Must not:** pass raw transport payloads into engine calls, or assume
  the caller's identity/permissions from connection state alone.
- **Why:** the transport boundary is where untrusted bytes become engine
  work; validation there is the only place the trust transition can be
  checked coherently.

### 5 — Failure paths are tested: errors, malformed requests, cancellation, shutdown

- **Must:** exercise error responses, malformed requests, cancellation
  and clean shutdown — including in-flight work at close (`→ see
  js-ecosystem.md` for the op-gate/drain lifecycle where it applies).
- **Must not:** treat happy-path integration tests as coverage of server
  behavior.
- **Why:** servers fail at the edges — a malformed frame, a cancelled
  request, an in-flight write during shutdown; each is a distinct defect
  class invisible to happy-path tests.
