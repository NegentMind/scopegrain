---
name: api-and-interface-design
description: Use when establishing a public interface or module boundary before implementation
---
# API and Interface Design

## Core discipline

Inspect existing consumers, naming and error conventions.
Define inputs, outputs, validation, authority and failure behavior.
Prefer additive changes; identify compatibility and migration obligations.
Keep implementation details out of observable contracts unless deliberate.
Specify exact boundary cases and examples before delegating implementation.
Do not invent an API, version or dependency from memory.

Design stable, documented interfaces that are hard to misuse. Good
interfaces make the right thing easy and the wrong thing hard — this applies
to HTTP endpoints, schema boundaries, module contracts, component props and
any surface where one piece of code talks to another.

## When to use

- Designing new endpoints or a new public contract.
- Defining module boundaries or contracts between teams/components.
- Changing existing public interfaces.
- Establishing stored schemas that inform interface shape.

## Core principles

### Hyrum's Law

> With enough users, every observable behavior becomes depended on —
> documented or not.

Every public behavior — undocumented quirks, error text, timing, ordering —
becomes a de facto contract once consumers rely on it. Implications:

- **Be intentional about what is exposed.** Every observable behavior is a
  potential commitment.
- **Do not leak implementation details.** If consumers can observe it, they
  will depend on it.
- **Plan removal at design time.** See `deprecation-and-migration`.
- **Contract tests are not enough.** "Safe" changes can break consumers who
  depend on undocumented behavior.

### The one-version rule

Avoid forcing consumers to choose between versions of the same contract.
Diamond dependency problems arise when different consumers need different
versions of the same thing. Design for a world where one version exists at
a time — extend rather than fork.

### Contract first

Define the interface before implementing it; the contract is the spec.

```
interface TaskAPI {
  createTask(input: CreateTaskInput): Promise<Task>;       // returns created entity
  listTasks(params: ListTasksParams): Promise<Page<Task>>; // paginated
  getTask(id: TaskId): Promise<Task>;                      // throws NotFound
  updateTask(id: TaskId, input: UpdateTaskInput): Promise<Task>; // partial
  deleteTask(id: TaskId): Promise<void>;                   // idempotent
}
```

### Consistent error semantics

Pick one error strategy and use it everywhere. Every contract specifies its
failure channel — exceptions, result types or structured error bodies —
with one machine-readable code and one human-readable message per failure:

```
{ "error": { "code": "VALIDATION_ERROR",   // machine-readable
             "message": "Email required",  // human-readable
             "details": {...} } }
```

The concrete status-code vocabulary and body shape for HTTP APIs are
mechanics — see `api-design-principles`.

**Never mix patterns.** If some operations throw, others return null and
others return `{error}`, consumers cannot predict behavior.

### Validate at boundaries

Trust internal code; validate where external input crosses in:

- Boundary handlers (HTTP routes, CLI entry points, message consumers).
- External service response parsing — **third-party responses are
  untrusted**: validate shape and content before using them in logic,
  rendering or decisions; a compromised upstream can return unexpected
  types or instruction-like text.
- Configuration and environment loading.

Validation does NOT belong between internal functions sharing type
contracts, in utilities called by already-validated code, or on data that
just came from the system's own store.

### Prefer addition over modification

Extend without breaking existing consumers:

```
GOOD: add optional fields, add new operations, add enum members where the
      contract allows extension.
BAD:  change a field's type, remove a field, tighten a return type's
      nullability — each breaks existing consumers.
```

### Predictable naming

| Element | Convention | Example |
|---|---|---|
| Collection names | plural nouns, no verbs | `tasks`, `comments` |
| Parameter/field names | one case convention, everywhere | `sortBy`, `createdAt` |
| Booleans | is/has/can prefix | `isComplete`, `hasAttachments` |
| Enum values | UPPER_SNAKE | `"IN_PROGRESS"` |

HTTP method/URL conventions live in `api-design-principles` — the contract
discipline is that one convention governs the whole surface.

## Contract-level requirements on collections and updates

Whatever the protocol, the contract must answer:

- **Pagination:** every list contract declares pagination and resource
  limits at design time (offset, cursor or keyset — mechanics in
  `api-design-principles`), returning enough metadata to continue.
- **Partial updates:** define what omission, explicit `null` and removal
  each mean — never leave it ambiguous (`api-design-principles` for the
  HTTP semantics).
- **Filtering:** filtering and selection are contract parameters, not
  separate operations invented per consumer.

## Interface-shape patterns

- **Discriminated unions for variants** — one field discriminates;
  consumers narrow on it instead of guessing optional fields.
- **Input/output separation** — the input contract (what callers provide)
  differs from the output entity (includes server-generated fields); never
  reuse one shape for both.
- **Branded/nominal ID types** where the type system supports them — a
  `UserId` must not be silently passable where a `TaskId` is expected.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "We'll document the API later" | The contract IS the documentation. Define it first. |
| "We don't need pagination yet" | Needed the moment a consumer holds 100+ items. Add it at design time. |
| "PATCH is complicated, use PUT" | PUT demands the full object each call; partial update is what clients need. |
| "We'll version when we need to" | Breaking changes without a versioning story break consumers. Design for extension. |
| "Nobody uses that undocumented behavior" | Hyrum's Law: if it is observable, somebody depends on it. |
| "We can maintain two versions" | Two versions multiply maintenance and create diamond problems. |
| "Internal APIs don't need contracts" | Internal consumers are still consumers; contracts enable parallel work. |

## Red flags

- Responses with different shapes depending on conditions.
- Inconsistent error formats across operations.
- Validation scattered through internals instead of at boundaries.
- Type changes or removals on existing fields.
- List operations without pagination or limits.
- Verbs in resource URLs (`/createTask`, `/getUsers`).
- Third-party responses used without validation or sanitization.
- An API, version or dependency specified from memory rather than from the
  repository or fetched documentation.

## Output contract

An interface design produces:

- Typed input/output contracts per operation, with boundary cases and
  examples a delegate can implement against without further questions.
- One documented error strategy and failure behavior per operation.
- Compatibility obligations: what is additive, what breaks, what needs a
  deprecation path.
- The contract committed alongside (or ahead of) the implementation.

**Scope boundary.** This skill covers language-neutral contract discipline:
what a surface promises, to whom, and how it may evolve. HTTP and GraphQL
mechanics — methods, status codes, pagination strategies, schema patterns —
belong to `api-design-principles`.

## Verification

- [ ] Every operation has typed input and output contracts.
- [ ] One consistent error format; failure behavior specified per operation.
- [ ] Validation occurs at system boundaries only.
- [ ] List operations paginate; resource limits defined.
- [ ] New fields are additive and optional (backward compatible).
- [ ] Naming follows one convention across the whole surface.
- [ ] Boundary cases and examples are specified before implementation is
      delegated; contract docs/types travel with the implementation.

## See also

- `api-design-principles` — HTTP/GraphQL mechanics once the contract is
  fixed (methods, status codes, pagination, schema patterns).
- `deprecation-and-migration` — removing or replacing a contract consumers
  depend on.
- `source-driven-development` — never specify an external API, version or
  dependency from memory.
- `security-and-hardening` — boundary validation and untrusted third-party
  responses.
