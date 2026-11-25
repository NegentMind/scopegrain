# Clean Code & Clean Architecture — Directives

> **Scope:** always-on coding discipline — dependency direction, function
> shape, boundary DTOs, error handling and modification hygiene that apply
> to every code change, not only audits.
> **Not here:** the audit checklist, worked examples and severity scale
> (`references/clean-code-clean-architecture`), the review procedure
> (`commands/review-change`), the simplification procedure
> (`commands/simplify-code`).
> **Status:** Active

## Rules

### 1 — Dependencies point inward only

- **Must:** keep imports flowing Infrastructure → Adapters → Application
  → Domain; organize the project by functional domain (screaming
  architecture), not by technical component type.
- **Must not:** import web frameworks, ORMs or I/O libraries into Domain
  or Use Cases.
- **Why:** the dependency rule is the mechanism of clean architecture —
  one outward import silently couples business logic to a replaceable
  detail.

### 2 — Boundaries stay humble

- **Must:** keep controllers, CLI handlers and consumers limited to
  receiving input, translating DTOs and invoking use cases; use flat
  DTOs for all data crossing use-case boundaries.
- **Must not:** return Domain entities to infrastructure or controllers.
- **Why:** business logic in delivery code is untestable and locks the
  domain to the framework.

### 3 — One abstraction level per function

- **Must:** apply SLAP; keep functions small (~≤20 lines default) with
  ≤3 arguments — more becomes a config object; names carry intent, so
  no comments describing WHAT the code does.
- **Must not:** use boolean flag parameters — split into separate methods.
- **Why:** mixed levels bury the algorithm under mechanics, and a flag
  parameter hides two behaviors under one name.

### 4 — Errors are typed and explicit

- **Must:** propagate domain errors as typed values — `thiserror` enums
  in Rust, `Result<T,E>`/discriminated unions in TypeScript, specific
  domain/infra exceptions in Python; validate external input at the
  boundary (`unknown` + schema in TS, never `any`).
- **Must not:** `unwrap()`/`expect()` in production paths, bare
  `except:`/`catch` that swallows, untyped throws.
- **Why:** a panic path or silent catch converts a recoverable fault
  into an uncontrolled crash or hidden state corruption.

### 5 — Language idioms carry the invariants

- **Must (Rust):** newtype for primitives carrying validation or domain
  semantics; application ports as traits; borrow (`&str`, `&[T]`) in
  signatures instead of forced `.clone()`; never hold a
  `std::sync::MutexGuard` across `.await`.
- **Must (Python):** strict type hints on all functions and methods;
  `typing.Protocol` for port abstractions; `@dataclass(frozen=True)` or
  frozen Pydantic for value objects and DTOs; domain entities are pure
  classes — no ORM base classes or decorators.
- **Must (TypeScript):** `readonly` on domain interface props and
  `ReadonlyArray` for collections; small focused repository interfaces,
  not monolithic ones.
- **Why:** idioms are how the architecture survives contact with the
  type system — each one enforces a rule the compiler then checks.

### 6 — Surgical modification only

- **Must:** make bounded edits — never rewrite a whole file when a
  targeted change suffices; ship AAA-structured unit tests with every
  behavioral change.
- **Why:** wholesale rewrites destroy reviewability and blame history,
  and a change without tests carries no recorded evidence of behavior.

<!-- Cross-references: → see references/clean-code-clean-architecture,
     commands/review-change, commands/simplify-code -->
