---
name: security-and-hardening
description: Use when a change touches untrusted inputs, permissions, sensitive data or dependency trust
---
# Security and Hardening

## Core discipline

Map inputs, identities, authority and sensitive outputs for the actual path.
Check validation, containment, injection, privilege and error disclosure.
Inspect dependency and protocol boundaries without assuming installed tools.
Use owned fixtures for adversarial inputs; request permission for external
tests, exploit delivery or destructive actions.
Report causal evidence, prerequisites and residual risks.
Do not equate a checklist or clean scanner with security certification.

Treat every external input as hostile, every secret as sacred, and every
authorization check as mandatory. Security is not a phase — it is a
constraint on every line that touches user data, authentication or external
systems.

## When to use

- Anything that accepts user input.
- Authentication or authorization changes.
- Storing or transmitting sensitive data.
- External integrations, file uploads, webhooks, callbacks.
- Payment or PII handling; dependency and supply-chain changes.

## Process: threat model first

Controls bolted on without a threat model are guesses. Before hardening,
spend five minutes thinking like an attacker:

1. **Map trust boundaries.** Where does untrusted data cross in? Requests,
   form fields, uploads, webhooks, third-party responses, queues — and
   model/LLM output. Every boundary is attack surface.
2. **Name the assets.** What is worth stealing or breaking? Credentials,
   PII, payment data, admin actions, stored state.
3. **Run STRIDE over each boundary** — a quick lens, not a ceremony:

| Threat | Ask | Typical mitigation |
|---|---|---|
| **S**poofing | Can someone impersonate a user/service? | Authentication, signature verification |
| **T**ampering | Can data be altered in transit or at rest? | Integrity checks, parameterized queries, TLS |
| **R**epudiation | Can an action be denied later? | Audit logging of security events |
| **I**nformation disclosure | Can data leak? | Encryption, field allowlists, generic errors |
| **D**enial of service | Can it be overwhelmed? | Rate limits, input size caps, timeouts |
| **E**levation of privilege | Can a user gain undue rights? | Authorization checks, least privilege |

4. **Write abuse cases next to use cases.** For each feature ask "how would
   I misuse this?" — that becomes the first adversarial test.

If the trust boundaries cannot be named, the feature is not ready to
secure. Insecure design fails before code does — OWASP Top 10:2025
**A06 Insecure Design** (the 2021 edition ranked it A04).

## The three-tier boundary system

### Always do (no exceptions)

- Validate all external input at the system boundary.
- Parameterize all database queries — never concatenate input into queries
  or commands.
- Encode output to prevent injection (auto-escaping; do not bypass it).
- Use encrypted transport for all external communication.
- Hash passwords with a memory-hard algorithm (bcrypt ≥12 rounds, scrypt,
  argon2) — never store plaintext.
- Set security headers where applicable (CSP, HSTS, frame/content-type
  protections).
- Use `httpOnly`, `secure`, `sameSite` attributes on session cookies.
- Run the ecosystem's dependency-audit tool before every release
  (`npm audit`, `pip-audit`, `cargo audit`, `govulncheck` — whatever the
  project declares).

### Ask first (requires owner approval)

- New authentication flows or changes to auth logic.
- New categories of stored sensitive data (PII, payment info).
- New external service integrations.
- CORS changes; file-upload handlers; rate-limit changes.
- Elevated permissions or roles; external tests, exploit delivery or any
  destructive security action — use owned fixtures for adversarial inputs
  and request permission for anything beyond them.

### Never do

- Commit secrets to version control (keys, passwords, tokens).
- Log sensitive data (passwords, tokens, full card numbers, unredacted PII).
- Treat client-side validation as a security boundary.
- Disable security mechanisms for convenience.
- Evaluate user-provided data as code (`eval`-style sinks, raw HTML sinks).
- Store sessions in client-accessible storage.
- Expose stack traces or internal error details to callers.

## OWASP prevention patterns

Prevention patterns below map to the OWASP Top 10:2025 (RC1 — item names
final, text still in draft): A05 Injection, A07 Authentication Failures,
A01 Broken Access Control (SSRF rolled in), A02 Security Misconfiguration,
A04 Cryptographic Failures, A03 Software Supply Chain Failures. The rest:
A06 Insecure Design (the threat-model step above), A08 Software or Data
Integrity Failures (dependency/CI integrity below), A09 Logging & Alerting
Failures (security-event audit logging — `observability-and-instrumentation`)
and A10 Mishandling of Exceptional Conditions (fail closed; error responses
leak nothing internal).

### Injection — A05 (query, command, ORM)

```
BAD:  `SELECT * FROM users WHERE id = '${userId}'`
GOOD: db.query('SELECT * FROM users WHERE id = $1', [userId])
GOOD: orm.user.findUnique({ where: { id: userId } })   // parameterized
```

### Broken authentication — A07

- Hash with a memory-hard algorithm at current cost settings.
- Session secrets come from the environment, never from code.
- Session cookies: `httpOnly` + `secure` + `sameSite` + bounded `maxAge`.
- Rate-limit login and reset flows; reset tokens expire.

### Cross-site scripting — output injection, A05

```
BAD:  element.innerHTML = userInput;
GOOD: render through the framework's auto-escaping;
      if raw HTML is required, sanitize through a vetted sanitizer first.
```

### Broken access control — A01

Authentication is not authorization. Every protected operation checks that
the caller may act on *this* resource:

```
on update(resourceId):
  resource = load(resourceId)
  if resource.owner != caller.id → 403 FORBIDDEN
  proceed
```

### Security misconfiguration — A02

- Send a restrictive content/security policy; tighten over time.
- Restrict cross-origin access to a known-origin allowlist; never wildcard
  origins together with credentials.

### Sensitive data exposure — A04 Cryptographic Failures

```
function toPublic(user):  strip passwordHash, resetToken, internal fields
                          before any response leaves the boundary.
secrets read from environment/config; missing → fail closed, never default.
```

### Server-side request forgery (SSRF) — within A01 since 2025

Any time the server fetches a caller-influenced URL — webhooks, "import
from URL", image proxies, link previews — an attacker can aim it at
internal services (cloud metadata endpoints, loopback, private ranges).

```
BAD:  fetch(request.body.webhookUrl)

GOOD: allowlist scheme + host, resolve ALL DNS records, reject if ANY
      resolved address is non-unicast (loopback/link-local/private/
      unique-local across v4+v6), and forbid redirects.
```

**Caveat — TOCTOU gap:** the fetch may resolve DNS again after the check,
so a short-TTL record can rebind to an internal IP between validation and
connection. For high-risk surfaces, resolve once and connect to the pinned
address, or place an egress filter in front.

## Input validation patterns

- **Schema-validate at the boundary**: declared types, length caps,
  enumerated values, trimmed strings. Reject with the consistent error
  shape and field-level details; afterwards internal code trusts types.
- **File uploads**: allowlist media types, cap sizes, and check content
  (magic bytes) rather than trusting the extension when it matters.

## Dependency-audit triage

Not every finding needs immediate action. Decision tree:

```
audit reports a vulnerability
├── severity critical/high
│   ├── vulnerable code reachable in this app?
│   │   ├── yes → fix now (update, patch or replace the dependency)
│   │   └── no (dev-only, dead path) → fix soon, not a blocker
│   └── fix available?
│       ├── yes → update to the patched version
│       └── no → workaround, replace the dep, or allowlist with a review date
├── moderate → reachable in production? next release cycle; dev-only? backlog
└── low → track; fix during regular dependency updates
```

Key questions: is the vulnerable function actually called? runtime or
dev-only dependency? exploitable in this deployment context? When
deferring, record the reason and a review date.

### Supply-chain hygiene

Audit tools catch known vulnerabilities; they do not catch malicious or
typosquatted packages.

- **Commit the lockfile**; install reproducibly in CI — no silent drift.
- **Review new dependencies** — maintenance, adoption, whether they earn
  their place. Every dependency is attack surface (OWASP **A03 Software
  Supply Chain Failures**, **LLM03 Supply Chain**).
- **Beware install-time scripts** in unfamiliar packages — arbitrary code
  at install time.
- **Watch for typosquats** — lookalike names differing by a character.

## Rate limiting

Bound consumption at the boundary: a general per-window limit for the API,
and a much stricter one for authentication endpoints (attempts, not just
requests). Return limit headers and `Retry-After`.

## Secrets management

```
.env.example  → committed template with placeholders
.env, *.local → NEVER committed
ignore rules must cover: .env*, *.pem, *.key
```

Scan staged diffs for `password|secret|api_key|token` before committing.
**If a secret reaches a remote, rotate it** — deleting the line or
rewriting history is not enough; assume compromise, revoke and reissue
first, then purge history.

## Securing AI/LLM features

Any feature calling a model inherits a new attack surface (OWASP Top 10
for LLM Applications 2025):

- **Model output is untrusted input (LLM05 Improper Output Handling).**
  Never pipe it into code evaluation, queries, shells, raw HTML or file
  paths. Parse defensively → validate → encode, exactly like raw user
  input.
- **Prompts can be hijacked (LLM01 Prompt Injection).** Untrusted text in
  the context (user message, fetched page, document) can carry
  instructions. The system prompt is not a security boundary — enforce
  permissions in code, not in the prompt.
- **Keep secrets and cross-tenant data out of prompts (LLM02 Sensitive
  Information Disclosure / LLM07 System Prompt Leakage).** Anything in the
  context can be echoed back.
- **Constrain tool/agent permissions (LLM06 Excessive Agency).** Minimum
  scope, confirmation for destructive or irreversible actions, validate
  every tool argument.
- **Bound consumption (LLM10 Unbounded Consumption).** Cap tokens, rate
  and loop depth so crafted input cannot run up cost or hang the system.
- **Isolate retrieval data (LLM08 Vector and Embedding Weaknesses).** In
  retrieval-augmented systems, partition embeddings per tenant and
  validate documents before indexing.

```
BAD:  db.query(await llm.generate(sqlText));  container.innerHTML = reply;
GOOD: intent = schema.parse(json.parse(reply));  // validate
      runAllowlistedAction(intent.action, intent.params);
      container.textContent = reply;              // encode
```

## Security review checklist

**Authentication**
- [ ] Passwords hashed with a memory-hard algorithm (bcrypt ≥12 / scrypt / argon2).
- [ ] Session tokens httpOnly + secure + sameSite; login rate-limited; reset tokens expire.

**Authorization**
- [ ] Every endpoint checks permissions; users reach only their own resources; admin actions re-verified.

**Input**
- [ ] All external input validated at the boundary; queries parameterized; output encoded.
- [ ] Server-side fetches allowlisted (no SSRF to internal services).

**Data**
- [ ] No secrets in code or history; sensitive fields excluded from responses; PII protected at rest.

**Infrastructure**
- [ ] Security headers set; CORS restricted to known origins; dependencies audited; errors leak nothing internal.

**Supply chain**
- [ ] Lockfile committed; reproducible CI install; new dependencies reviewed (maintenance, install scripts, typosquats).

**AI/LLM (if present)**
- [ ] Model output treated as untrusted; secrets/PII kept out of prompts; tool permissions scoped with confirmation for destructive actions.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "Internal tool, security doesn't matter" | Internal tools get compromised; attackers hit the weakest link. |
| "We'll add security later" | Retrofitting is an order of magnitude harder than building it in. |
| "No one would exploit this" | Automated scanners will find it; obscurity is not security. |
| "The framework handles security" | Frameworks provide tools, not guarantees — they must be used correctly. |
| "It's just a prototype" | Prototypes become production. |
| "Threat modeling is overkill" | Five minutes of "how would I attack this?" prevents design flaws no control patches later. |
| "It's just model output, only text" | That "text" can be a query, a script tag or a shell command. |
| "A clean scanner means we're secure" | A checklist or green scan is evidence of checks run — never a certification. |

## Output contract

A hardening pass reports findings, not certification:

- The threat model: trust boundaries mapped, assets named, abuse cases
  written.
- Each finding with causal evidence (path, payload, preconditions) and the
  control that closes it.
- Deferred items with reason and review date — triaged, not silently
  dropped.
- Residual risk stated explicitly; a clean scan is evidence of checks run,
  not proof of security.

## Red flags

- User input reaching queries, commands, or markup rendering directly.
- Secrets in source or history.
- Endpoints without authentication or authorization checks.
- Wildcard origins, missing rate limits on auth endpoints.
- Stack traces or internals exposed to callers.
- Dependencies with known critical vulnerabilities unaddressed.
- Server fetching caller-supplied URLs without an allowlist.
- Model output flowing into a query, the DOM, a shell or `eval`.
- Secrets, PII or the full system prompt inside a model context.

## Verification

- [ ] The ecosystem's audit tool reports no unaddressed critical/high findings.
- [ ] No secrets in source or history; staged diffs scanned.
- [ ] All external input validated at boundaries; auth checked per endpoint.
- [ ] Security headers present; error responses expose no internals.
- [ ] Server-side URL fetches validated against an allowlist.
- [ ] Model output validated and encoded before use (if AI features exist).
- [ ] Report carries causal evidence, prerequisites and residual risks —
      framed as findings, not certification.

## See also

- `resources/references/security-checklist.md` — the detailed checklist and
  pre-commit verification steps.
- `source-driven-development` — retrieval safety for fetched content.
- `observability-and-instrumentation` — audit logging of security events
  without leaking secrets into telemetry.
