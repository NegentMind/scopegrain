---
name: api-design-principles
description: Use to review an existing HTTP or GraphQL API for consistency, authority boundaries and evolution
---
# API Design Principles

## Core discipline

Read the actual routes or schema and consumers. Check identity,
authorization, input validation, error semantics and compatibility.
For collections define pagination and resource limits where relevant.
For partial updates distinguish omission, null and explicit removal.
Test success and failure examples against implementation.
Do not impose REST conventions on an unrelated protocol.

Apply these principles to design or review HTTP and GraphQL APIs that are
intuitive, consistent and safe to evolve. Review the real surface — the
declared routes, the schema, actual consumers — not a description of it.

**Scope boundary.** This skill covers protocol mechanics: methods, status
codes, pagination strategies, schema patterns. The language-neutral
contract discipline behind them — what a surface promises, compatibility
obligations, boundary validation — belongs to `api-and-interface-design`.

## When to use

- Designing new HTTP or GraphQL APIs.
- Reviewing an API specification or implementation for consistency.
- Establishing design standards for a team.
- Migrating between paradigms or versions.
- Optimizing an API for specific consumers (mobile, third-party).

## HTTP semantics

Resources are nouns; methods carry the action:

| Method | Semantics | Properties |
|---|---|---|
| `GET` | Retrieve | safe, idempotent |
| `POST` | Create (or non-idempotent action) | — |
| `PUT` | Replace entire resource | idempotent |
| `PATCH` | Partial update | — |
| `DELETE` | Remove | idempotent |

**Status codes — one vocabulary:**

```
200 OK (read/update)   201 Created (+ Location)   204 No Content (delete)
400 malformed          401 unauthenticated        403 unauthorized
404 not found          409 state conflict         422 validation failed
429 rate limited       500 server error           503 unavailable
```

**Error format — one shape everywhere:**

```json
{ "error": { "code": "VALIDATION_ERROR",
             "message": "Request validation failed",
             "details": [{"field": "email", "message": "Invalid format"}],
             "timestamp": "...", "path": "/api/users" } }
```

## REST patterns

### Resource design

```
GOOD:  GET /api/users          GET /api/users/{id}/orders
BAD:   POST /api/createUser    POST /api/getUserById

Shallow nesting (preferred):   /users/{id}/orders → then /orders/{id}
Avoid deep chains:             /users/{id}/orders/{o}/items/{i}/reviews
Better:                        /order-items/{id}/reviews
```

### Filtering, sorting, sparse fieldsets

```
GET /api/users?status=active&role=admin
GET /api/users?sort=-created_at        # '-' = descending
GET /api/users?search=john
GET /api/users?fields=id,name,email    # sparse fieldsets
```

### Pagination

- **Offset** (simple): `?page=2&page_size=20` → return
  `items, page, page_size, total, pages`. Always cap `page_size`.
- **Cursor** (large/volatile sets): `?limit=20&cursor=...` → return
  `items, next_cursor, has_more`. Stable under concurrent writes.
- **Link headers** (hypermedia): `Link: <...?page=3>; rel="next"`.

### Partial updates

For `PATCH`, define the semantics explicitly: a missing field means "leave
unchanged", an explicit `null` means "clear" — or the API declares `null`
invalid. Never leave omission vs null vs removal ambiguous. `PUT` requires
the complete object every time. Two standardized body formats exist if a
convention is needed rather than invented: JSON Merge Patch (RFC 7386 —
partial object literal, `null` deletes) and JSON Patch (RFC 6902 —
explicit `add`/`remove`/`replace` operation list).

### Rate limiting

Return limit headers and a bounded retry:

```
X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset
429 Too Many Requests + Retry-After: <seconds>
```

### Idempotency

Unsafe retried writes need an idempotency key: `Idempotency-Key: <unique>`
— a duplicate request returns the stored response instead of re-executing.

### Caching and CORS

- `Cache-Control` per resource mutability; `ETag`/`If-None-Match` → `304`.
- CORS restricted to known origins — never wildcard `*` with credentials.

### Versioning

| Strategy | Form | Trade-off |
|---|---|---|
| URL | `/api/v1/users` | clear, routable; multiple URLs per resource |
| Header | `Accept: application/vnd.api+json; version=2` | clean URLs; less visible, harder to test |
| Query | `?version=2` | easy to test; forgettable optional param |

Pick one; document the deprecation policy alongside it.

### Optional: HATEOAS

When discoverability matters, responses may carry `_links` (`self`,
related resources, allowed actions with method hints). Adopt deliberately —
do not bolt it onto an API whose consumers never follow links.

## GraphQL patterns

### Schema-first

Types model the domain; queries read, mutations write, subscriptions push.
Structure decisions:

- **Nullability:** start nullable, tighten to `!` only when guaranteed —
  non-null is a breaking commitment.
- **Interfaces** for polymorphic entities (`Node` with `id`, `createdAt`);
  **unions** for heterogeneous results (`SearchResult = User | Post`).
- **Custom scalars** for domain types (`DateTime`, `Email`, `Money`).
- **camelCase fields, PascalCase types.**

### Pagination — Relay-style cursors

```graphql
type UserConnection { edges: [UserEdge!]!  pageInfo: PageInfo!  totalCount: Int! }
type UserEdge       { node: User!  cursor: String! }
type PageInfo       { hasNextPage: Boolean!  hasPreviousPage: Boolean!
                      startCursor: String  endCursor: String }
type Query          { users(first: Int = 20, after: String, search: String): UserConnection! }
```

Fetch `first + 1` rows to compute `hasNextPage`. Use offset pagination only
for simple, bounded lists.

### Mutations — input/payload pattern

```graphql
input CreateUserInput { email: String!  name: String! }
type CreateUserPayload { user: User  errors: [Error!]  success: Boolean! }
type Error { field: String  message: String!  code: ErrorCode! }
```

Return structured errors in the payload (or union result types like
`UserResult = User | ValidationError | NotFoundError | AuthorizationError`)
so clients handle failures in-band. Support `clientMutationId` when
optimistic responses matter.

### N+1 prevention and query cost

- **Batch-loading (DataLoader pattern)** for every relationship field:
  collect keys per request, load in one query, return in input order.
- **Depth limiting** and **complexity analysis** reject abusive queries —
  list fields multiply cost; enforce caps.
- **Track query cost** — monitor complexity and execution time.

### Evolution

Deprecate with `@deprecated(reason: "Use X")` instead of removing fields;
evolve additively (add optional fields, never tighten nullability on
published fields).

## Common rationalizations

|| Rationalization | Reality |
|---|---|---|
| "REST conventions are universal" | They are HTTP mechanics. Imposing them on RPC, event streams or GraphQL produces cargo-cult design. |
| "Any status code close enough works" | Clients branch on codes. A 200 wrapping an error or a 500 for bad input breaks every consumer's error handling. |
| "GraphQL solves over-fetching for free" | It moves the cost to resolvers — without batch-loading you trade over-fetching for N+1. |
| "We'll add pagination when needed" | Retrofitting pagination changes the response shape — a breaking change to every existing consumer. |
| "Versioning is premature" | Versioning decided after the first breaking change is too late; pick the strategy at design time. |
| "Rate limits hurt legitimate users" | Unbounded APIs invite abuse and cascade failures; limits with clear headers protect both sides. |

## Red flags

- Over/under-fetching in REST (fixed by GraphQL, which then requires
  batch-loading).
- Breaking changes without versioning or a deprecation window.
- Inconsistent error formats across operations.
- Missing rate limits — an unbounded API is an abusable API.
- API structure mirroring the storage schema instead of the domain.
- POST used for idempotent operations — breaks HTTP semantics.
- Imposing REST conventions on a protocol that is not REST.
- Ambiguous partial-update semantics (omission vs `null` vs removal).
- A resolver graph with no depth/complexity limit or batch-loading.

## Pre-implementation review checklist

Condensed gate before an API ships or a review concludes:

**Design**
- [ ] Resources are nouns; collections plural; naming consistent.
- [ ] Nesting ≤ 2 levels; CRUD mapped to correct methods.
- [ ] Versioning and deprecation policy defined.

**Behavior**
- [ ] Correct status codes; one error shape; field-level validation errors.
- [ ] Every collection paginates with a maximum page size.
- [ ] Filtering, sorting and (where needed) search defined.
- [ ] Partial-update semantics (omission vs null vs removal) specified.
- [ ] Unsafe retried writes are idempotent.

**Authority and safety**
- [ ] Authentication method defined; authorization checked per operation;
      401 vs 403 used correctly.
- [ ] Rate limits defined with limit headers and `Retry-After`.
- [ ] Input validation on every field; no sensitive data in URLs; no
      secrets in responses.
- [ ] CORS restricted to known origins; transport encryption enforced.

**Operations**
- [ ] Documentation generated (OpenAPI or schema introspection) with
      request/response and error examples.
- [ ] N+1 prevented; caching strategy and headers set; heavy endpoints
      bounded.
- [ ] Health endpoint exists; errors and latency are observable.

**GraphQL additionally**
- [ ] Schema-first; nullability decided deliberately; input types on every
      mutation; errors in payloads or unions.
- [ ] Depth/complexity limits; DataLoaders on relationships; deprecations
      via `@deprecated`, never silent removal.

## Output contract

A design or review produces:

- A versioned surface spec (OpenAPI document or GraphQL schema) with
  request/response and error examples for every operation.
- Explicit semantics for partial updates, pagination, filtering and
  idempotent retries — testable, not prose.
- Compatibility obligations per changed contract and the deprecation
  policy that governs them.
- Findings with route/field locators and evidence — not style preferences.

## Verification

- [ ] The actual routes/schema and real consumers were read — not assumed.
- [ ] Success AND failure examples tested against the implementation.
- [ ] Compatibility obligations identified for every changed contract.
- [ ] Findings reported with route/field locators and evidence, not
      style preferences.

## See also

- `api-and-interface-design` — the language-neutral contract discipline
  (Hyrum's Law, one-version rule, boundary validation) this file's
  mechanics implement.
- `deprecation-and-migration` — the deprecation window and expand/contract
  path for breaking changes.
- `security-and-hardening` — authentication, authorization, SSRF and input
  validation enforcement.
- `observability-and-instrumentation` — RED metrics, rate-limit and error
  telemetry for the shipped surface.
