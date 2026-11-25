# Clarity and Boundaries

Evaluate whether names reveal intent, responsibilities cohere, dependency
direction is deliberate and side effects are explicit.
Examples and language idioms matter more than arbitrary line thresholds.
Separate behavioral risks, maintainability consequences and preferences.
An architecture pattern is useful only when it addresses this project's
constraints; a checklist alone is not evidence of correctness.

Compendium of Clean Code (Martin, 2008/2025) and Clean Architecture
(Martin, 2017) adapted for AI-assisted multi-language work (Rust, Python,
TypeScript). Numeric limits like "≤20 lines / ≤3 args" are operational
convention, not literal citations — treat them as defaults the project may
retune, not as natural law.

## 1. Foundations

Sustainable software development is the systematic containment of code
entropy. Unconstrained agents pick the path of least local resistance:
diffuse coupling, mixed abstraction levels, business logic polluted with
infrastructure, fast accumulation of code smells.

### Key axioms

- **Boy Scout Rule**: whoever touches a file leaves it cleaner than found.
- **LeBlanc's Law**: "later equals never" — deferred cleanup becomes
  permanent technical debt.
- **KISS & DRY**: maximize work not done; every piece of knowledge has a
  single unambiguous representation.
- **Domain primacy over infrastructure**: frameworks, databases and UIs are
  interchangeable mechanisms; business rules are primary.
- **Make invalid states unrepresentable**: design types so contradictory
  states fail at compile/parse time.

| Dimension | Ad-hoc / legacy | Clean architecture | Lifecycle impact |
|---|---|---|---|
| Operating cost curve | Exponential via debt accumulation | Linear and bounded | Economic viability |
| Environment coupling | Business logic welded to framework/DB | Business isolated from tools | Swap libraries without rewrites |
| Testability | Slow tests needing DB/servers | Fast in-memory domain tests | Enables CI |
| Change speed | Fragile; small changes cascade | Surgical, small blast radius | Delivery frequency |

## 2. Micro-architecture: polyglot clean code

### 2.1 Naming

- Names reveal intent; they must not need clarifying comments.
- No Hungarian notation or embedded types (`strName`, `iCounter`).
- Pronounceable, text-searchable, aligned with the ubiquitous language.
- **Don't add gratuitous context (no stuttering):** `account.address`
  not `account.accountAddress`; `store.get` not `store.storeGet`;
  `Error::Io` not `Error::IoError`. Legitimate exceptions: framework
  conventions (`ComponentProps`), compat aliases, i18n namespaces,
  hierarchical test IDs, CSS pseudo-elements.

| Language | vars/fns/methods | types/classes/traits | constants |
|---|---|---|---|
| Rust | `snake_case` | `PascalCase` | `SCREAMING_SNAKE_CASE` |
| Python | `snake_case` | `PascalCase` | `SCREAMING_SNAKE_CASE` |
| TypeScript | `camelCase` | `PascalCase` | `SCREAMING_SNAKE_CASE` |

### 2.2 Function design & abstraction levels (SLAP)

- One responsibility per function; a single level of abstraction per body.
  Mixing orchestration with string formatting or socket calls in one body
  is prohibited.
- Arity: 0–1–2 args ideal; 3 needs justification; ≥4 → pass an immutable
  config object or a Builder.
- **No flag arguments**: a boolean that switches internal behavior proves
  the function does two things — split it.
- Convention: functions stay short enough to read at a glance (default
  ≤ ~20 lines); judgment over the number.

### 2.3 Error handling

| Language | Rules |
|---|---|
| Rust | No `unwrap()`/`expect()` in production code (except documented impossible invariants). `Result<T, E>` + `?` propagation. Domain errors as typed enums (`thiserror` in libs, `anyhow` in binaries). |
| Python | Explicit custom exceptions inheriting a `DomainException` base. No `except Exception:` silent catches or bare `except:`. Catch only at the layer that translates to infrastructure responses/DTOs. |
| TypeScript | Prefer discriminated unions or an explicit `Result<T, E>` over uncontrolled throws for domain operations. If exceptions are used, custom `Error` subclasses caught at interface adapters. |

### 2.4 Comments

A comment is often a failure to express intent in code. Allowed: non-obvious
design decisions, performance-consequence warnings, formal public-API docs.
Delete: redundant narration, commented-out code, block-closing comments.

### 2.5 Code-smell catalog

| ID | Smell | Manifestation | Correction | Impact |
|---|---|---|---|---|
| G1 | **Rigidity** | One requirement change cascades through many modules | Decouple via DIP and interfaces/traits | Lower maintenance cost |
| G2 | **Fragility** | A change breaks unrelated parts without warning | Encapsulate volatile concepts; remove implicit deps | Stability, fewer regressions |
| G3 | **Immobility** | Module can't be reused — welded to its environment | Extract pure business logic from infra libs | Reuse across apps |
| G4 | **Opacity** | High cognitive load to read | Rename, shrink functions, apply SLAP | Easier onboarding (human and AI) |
| G5 | **Feature envy** | A method touches another object's data more than its own | Move the method to the data owner | Cohesion, encapsulation |
| G6 | **Train wreck** | `a.getB().getC().getD().execute()` | Law of Demeter: talk to direct collaborators only | Shallow coupling |
| G7 | **Primitive obsession** | `string`/`int` used for validated concepts | Value Objects (Newtype / frozen dataclass / branded types) | Centralized validation |

## 3. Language-specific idioms

### Rust

1. **Newtype pattern**: wrap primitives in single-field structs for
   compile-time safety against primitive obsession.
2. **Typestate pattern**: encode object state + valid transitions in the
   type system so invalid calls don't compile.
3. **Borrow over clone**: signatures take `&str`, `&[T]`, `&Path` rather
   than demanding `String`, `Vec<T>`, `PathBuf`; `.clone()` only as a
   documented design choice.
4. **Async governance**: NEVER hold a `std::sync::Mutex` guard across
   `.await`; NEVER run blocking/CPU-heavy work on the async executor —
   delegate to `spawn_blocking`.

### Python

1. **Strict type hints**: 100% of production code typed (`Self`, `Unpack`,
   `Literal`, `Callable`, `Generic`); verified under mypy/pyright strict.
2. **`typing.Protocol` over ABCs** for port contracts — loose coupling
   without rigid inheritance.
3. **Immutability**: `@dataclass(frozen=True)` or frozen Pydantic models
   for Value Objects and boundary DTOs.
4. **No mutable module-level globals / mutable singletons**; config is
   injected through constructors.

### TypeScript

1. **No `any`**. Use `unknown` for external values and validate at the
   boundary with a schema library (Zod/Valibot-class).
2. **Discriminated unions** for states and fallible results
   (`{ status: 'success'; data: T } | { status: 'error'; message: string }`).
3. **Immutable by default**: `readonly` props, `ReadonlyArray<T>` for
   domain collections.
4. **Small composed interfaces** over monolithic ones; infra classes
   implement only what each use case needs.

## 4. SOLID and component governance

### SOLID

1. **SRP** — one reason to change per module; serves one business actor.
2. **OCP** — open for extension (new implementations of contracts), closed
   for modification (don't edit proven code).
3. **LSP** — implementations substitutable for their abstractions; don't
   weaken postconditions or strengthen preconditions.
4. **ISP** — no client forced to depend on methods it doesn't use; small
   specialized interfaces.
5. **DIP** — high-level and low-level modules both depend on abstractions;
   details depend on abstractions, not vice versa.

### Component cohesion

- **REP** — reuse grain = release grain; grouped classes ship together
  under one version.
- **CCP** — classes that change for the same reason live in the same
  component (SRP at package level).
- **CRP** — classes not reused together don't share a package (ISP at
  package level).

### Component coupling

- **ADP** — the dependency graph is acyclic (a DAG).
- **SDP** — dependencies point toward stability; depend only on more-stable
  components.
- **SAP** — a component is as abstract as it is stable; stable high-level
  components rest on abstractions for extensibility.

### Quantitative metrics

- **Ca** (afferent coupling): outsiders depending on this module — its
  responsibility.
- **Ce** (efferent coupling): outsiders this module uses — its vulnerability.
- **Instability**: `I = Ce / (Ca + Ce)` — `0` maximally stable, `1` totally
  unstable.
- **Abstractness**: `A = Na / Nc` — abstractions over total types.
- **Distance from main sequence**: `D = |A + I - 1|` — `≈0` is balanced.

| Zone | (I, A) | Diagnosis | Maintainability |
|---|---|---|---|
| Zone of pain | `I≈0, A≈0` | Concrete yet depended-on — hard to extend | Critical rigidity (typical: schema-heavy legacy without interfaces) |
| Zone of uselessness | `I≈1, A≈1` | Abstract, no dependents | Dead abstractions adding no value |
| Main sequence | `D≈0` | Abstraction/stability balance | Safe evolution, reuse |

## 5. Clean Architecture (macro)

### Dependency rule

**Source dependencies point only inward, toward higher-level policy.**
Inner circles may not know, import or name anything declared in outer
circles.

### Layers

| Layer | Level | Component types | Depends on | Responsibility |
|---|---|---|---|---|
| 1. Entities | Center / highest | Domain entities, value objects, domain services | Nothing | Global business rules; no framework, UI, ORM or DB |
| 2. Use cases | Mid-high | Interactors, input/output ports, app DTOs | Entities only | Orchestrate data flow to satisfy requirements |
| 3. Interface adapters | Mid-low | Controllers, presenters, mappers, concrete repos | Use cases + entities | Translate between app format and external agents |
| 4. Frameworks & drivers | Outer / lowest | DB, web framework, UI, third-party SDKs, CLI | Adapters | Technical infrastructure, I/O details |

### Screaming architecture

Organize folders by **functional domain**, not technical layer — the
shape is the same in every language:

```
src/<domain>/            # e.g. identity/, ordering/, billing/
  domain/                # entities, value objects, domain errors
  application/           # use cases + ports (traits / Protocols / interfaces)
  infrastructure/        # repos, HTTP/CLI controllers, ORM adapters
```

If the real tree is flat-by-technical-module while the intended shape is
domain-oriented, record that explicitly — audit **dependency direction**,
not folder form, and don't reorganize without an approved decision record.

### Humble Object + boundary DTOs

Boundary modules (HTTP controllers, message consumers, CLI entrypoints)
stay "humble": receive, translate to DTOs, invoke a use case — zero business
logic. Data crosses boundaries only via flat DTOs or primitives. **ORM
entities, DB-state models and framework decorators never enter Application
or Domain.**

## 6. Worked example (bad → good, language-neutral)

The violations and the fix are identical in every language — only the
syntax changes. Neutral pseudocode; the mini-map below binds each
construct to the concrete idiom of the supported stacks.

### Antipattern — everything fused in the delivery boundary

```text
function postCharge(request):                      # BAD
    body = request.body                            # untyped input trusted raw
    if body["amount"] <= 0: return http(400)
    acct = db.query("SELECT * FROM accounts WHERE id=" + body["id"])
                                                   # string SQL: injection + ORM row leaks upward
    if acct.balance - body["amount"] < 0:          # the business rule lives in the controller
        return http(409, "insufficient funds")
    db.execute("UPDATE accounts SET balance = " + acct.balance - body["amount"])
    return json(acct)                              # storage entity returned to the wire
```

Smells visible: business rules in delivery layer · untrusted input used
without a DTO or schema · string-concatenated SQL · infrastructure types
crossing into the response · no error taxonomy — one `return` per
failure mode.

### Corrected — layers, ports and humble boundary

```text
# domain/ — pure: no HTTP, no SQL, no framework imports
type Money(value)                                  # value object: constructor validates > 0
entity Account:
    can_charge(m: Money) -> bool                   # the rule lives next to the data it guards
    charge(m: Money) -> Result<Account, InsufficientFunds>
                                                   # typed domain error, never panic/throw-string

# application/ — orchestration; owns its ports
port AccountRepo:                                  # interface declared by the consumer
    find(id) -> Account | NotFound
    save(account) -> void

use_case ChargeAccount(repo: AccountRepo):
    execute(cmd: ChargeCmd) -> Result<Receipt, AppError>:
        amount = Money.new(cmd.raw_amount)?        # boundary validation, earliest possible
        acct  = repo.find(cmd.account_id) ?? return Err(NotFound)
        acct' = acct.charge(amount)?               # domain rule, typed propagation
        repo.save(acct')
        return Ok(Receipt.of(acct', amount))       # DTO out — never the entity

# infrastructure/ — humble adapters: receive, translate, delegate
handler postCharge(request):
    cmd    = ChargeCmd.parse(request.body)         # untrusted -> schema-validated DTO at the edge
    result = chargeAccount.execute(cmd)            # one delegation, zero branching on rules
    return http(result.code, result.dto)           # translate the Result; no business logic

class SqlAccountRepo implements AccountRepo:       # SQL exists ONLY here, behind the port
    find(id) = db.query("SELECT ... WHERE id = ?", id)
    save(a)  = db.execute("UPDATE ...", a.id, a.balance)
```

### Construct → idiom mini-map

| Generic construct | Rust | Python | TypeScript |
|---|---|---|---|
| Port (consumer-owned interface) | `trait` + `Box<dyn>` | `typing.Protocol` | `interface` (small, focused) |
| Value object | newtype + `Result` ctor | `@dataclass(frozen=True)` | `readonly` class + factory |
| Typed domain error | `thiserror` enum | exception hierarchy | `Result<T,E>` / discriminated union |
| DTO at the edge | `serde::Deserialize` | pydantic / plain dataclass | schema-validated type (`unknown` in) |
| Concrete adapter | `impl Trait for X` | class conforming to Protocol | `class X implements I` |
| Test double for a port | mockall-generated | pytest-mock / in-memory fake | in-memory fake (preferred) |

## 7. Testing and TDD

### The three laws of TDD

1. No production code except to make a failing test pass.
2. No more test code than needed to fail (compile errors count as failures).
3. No more production code than needed to pass the current test.

### F.I.R.S.T.

- **Fast** — milliseconds, runnable constantly.
- **Independent** — no inter-test state or ordering.
- **Repeatable** — identical results in any environment.
- **Self-validating** — boolean pass/fail, no manual log inspection.
- **Timely** — written just before the production code.

### Arrange-Act-Assert + test doubles (generic taxonomy)

Every unit test: **Arrange** the fixture and doubles, **Act** on one
operation, **Assert** on results and nothing else. Doubles substitute
collaborators at ports — pick the simplest that satisfies the contract:

| Double | What it is | When to use |
|---|---|---|
| Dummy | Fills an argument slot; never actually used | Required parameter irrelevant to this test |
| Fake | Working implementation, simplified (in-memory repo) | **Default for ports** — real contract, no I/O |
| Stub | Canned answers to calls | Control the SUT's indirect inputs |
| Spy | Records calls it received | Verify indirect outputs (e.g. "was save called once") |
| Mock | Pre-programmed expectations verified on teardown | Interaction contracts only — prefer fakes first; overuse couples tests to implementation |

Rule of thumb: a port exercised through a fake tests behavior; the same
port mocked tests the protocol — and breaks on every refactor that
keeps behavior but changes call shape.

## 8. Governance matrix

| Engineering rule | Anti-pattern prevented | Implementation example | Guaranteed effect |
|---|---|---|---|
| Domain isolation | ORM/web framework imports inside entities | Entities as pure structs/classes, no third-party decorators | Infra independence, core portability |
| SLAP separation | SQL/HTTP calls mixed with calculation | Persistence in repositories, rules in entities | In-memory unit tests without I/O |
| Ports & interfaces | DB/HTTP clients instantiated inside use cases | Abstractions injected via constructor | Swappable providers via IoC |
| Value-object immutability | Direct mutation of emails/amounts/IDs | New immutable instance per change | No uncontrolled side effects |
| DTOs at boundaries | ORM models returned to controllers/UI | Explicit DTO conversion in the adapter layer | No DB detail leakage outward |

## 9. Injectable agent directives

The normative directive set is the catalog rule `rules/clean-code`,
declared in `profiles/core` so it enters every workflow packet —
always-on rather than audit-only. To embed the directives in a project
instruction file (AGENTS.md / system prompt), copy that rule's
Must/Must-not lines; this compendium does not keep a second copy.

### Project appendices

The audit checklist in this compendium is generic. A project records
its own layer map, naming exceptions and local severities as an
**appendix** composed over this reference — never by editing it.
Mechanism: register a preset (`dist preset-register`) whose override
targets `reference/clean-code-clean-architecture` with `op: append`
and the appendix as `content`. The packet composer applies it whenever
this reference enters a packet, so project appendices override the
generic examples during audits.

## 10. Audit severity scale

When auditing a codebase against this compendium:

- **🔴 Blocker**: outward dependency (domain importing infrastructure),
  panic-path constructs in production (`unwrap()`, unhandled throw),
  `any`, empty catch, lock guard across `.await`, SQL/ORM inside an entity.
- **🟡 Debt**: over-long function, >3 args without justification, flag
  boolean, stuttering names, primitive obsession without a Value Object,
  redundant comment, missing DTO at a boundary.
- **🟢 Suggestion**: micro-naming, vertical ordering, style-guide
  cosmetics.

New 🔴/🟡 debt introduced by a change should be paid in the same change —
net debt per change ≤ 0 (Boy Scout applied to the PR, not just the file).

## 11. Cross-checks when auditing

- [ ] Compare the documented architecture with the import/build graph — a
      boundary that nothing enforces is a proposal.
- [ ] Separate findings into: behavioral risk, maintainability consequence,
      preference. Do not report preferences as defects.
- [ ] Verify a smell against real code paths before reporting (Regla 0:
      impact analysis before flagging).
- [ ] Idiomatic exceptions exist (framework conventions, compat aliases) —
      check the project's exceptions list before flagging names.

## 12. Sources

Canonical texts behind this compendium (titles for lookup; no links):

- Robert C. Martin — *Clean Code* (naming, functions, comments, smells)
- Robert C. Martin — *Clean Architecture* (layers, dependency rule,
  humble object, component principles REP/CCP/CRP, ADP/SDP/SAP)
- Robert C. Martin — *Agile Software Development: PPP* (SOLID,
  Ca/Ce/I/A/D metrics, main sequence)
- Martin Fowler — *Refactoring* (feature envy, train wrecks, primitive
  obsession)
- Martin Fowler — *Patterns of Enterprise Application Architecture*
  (DTO, repository, mapper)
- Eric Evans — *Domain-Driven Design* (entities, value objects,
  ubiquitous language)
- Freeman & Pryce — *Growing Object-Oriented Software, Guided by Tests*
  (test-double taxonomy)
- Kent Beck — *Test-Driven Development: By Example* (TDD cycle)
- Michael Feathers — *Working Effectively with Legacy Code* (seams,
  characterization tests)
- David Parnas — *On the Criteria To Be Used in Decomposing Systems
  into Modules* (information hiding)
- Law of Demeter — talk to direct collaborators only

<!-- Cross-references: → see architecture.md, definition-of-done.md, quality-floor.md, testing-patterns.md -->
