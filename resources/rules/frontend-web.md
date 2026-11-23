# Browser Interfaces — Rules

> **Scope:** browser-facing surfaces: design-system fidelity, accessibility,
> trust boundaries in rendering, dependency hygiene, motion tokens and
> naming conventions.
> **Not here:** package-manager and lockfile policy (`js-ecosystem.md`),
> API/backend contracts (`api-contract.md`, `server-mcp.md`), general
> untrusted-input rules (`safety.md`, `api-contract.md`).
> **Status:** Active
> **Sources:** frontend audits (dead/transitive dependencies, missing
> structured-data emission, rejected-mode plumbing, undersized touch
> targets, hardcoded motion values, naming-convention churn).

Apply only to browser-facing surfaces. Distinguish source-level
performance concerns from measured user experience — claims about the
latter need measurement (`→ see evidence.md`).

## Rules

### 1 — Use the framework's native error boundary, not external libraries

- **Must:** handle page-level errors with the framework's built-in
  error-boundary mechanism (e.g., the router's error-file convention).
- **Must not:** install or directly import an error-boundary library; if
  one arrives transitively, leave it unused.
- **Why:** a transitive dependency nobody imports is dead weight on install
  and audit surface; the native mechanism ships zero dependencies.

### 2 — Remove dead dependencies when an audit detects them

- **Must:** drop any dependency with zero verified direct imports in the
  same change that detects it, or in a dedicated cleanup task.
- **Must not:** keep orphaned dependencies because they "might be used
  someday".
- **Why:** for statically built bundles every dead dependency inflates
  install time and the dependency-audit tree.

### 3 — Verify what the platform's metadata API actually emits

- **Must:** when machine-readable structured data (e.g., JSON-LD) is
  required, emit it explicitly in server-rendered markup.
- **Must not:** assume the framework's metadata API generates
  structured-data payloads — typical metadata APIs only emit head tags.
  Verify the emitted HTML before claiming the feature.
- **Why:** a registry note claiming structured data was implemented proved
  false because the API it relied on never emitted it; unverified output
  means the feature does not exist.

### 4 — Preserve deliberate design constraints; delete plumbing for rejected alternatives

- **Must:** keep the design system's declared constraints (e.g., a
  single-scheme palette decided by the owner).
- **Must not:** reintroduce a rejected mode (theme variants, alternate
  schemes) or leave its dead plumbing — providers, toggles, theme
  dependencies — in place; remove it during cleanup.
- **Why:** inert wiring for a rejected feature misleads audits into
  inverted "dead code" findings and contradicts an explicit design
  decision.

### 5 — Touch targets: 44px preferred, 24px absolute floor

- **Must:** give every interactive element (buttons, icon buttons, links) a
  hit area of at least 44×44 CSS px on touch viewports — the WCAG 2.2
  SC 2.5.5 (AAA, Target Size Enhanced) level; 24×24px — SC 2.5.8 (AA,
  Target Size Minimum) — is the absolute floor and only for secondary
  inline controls.
- **Must not:** ship targets below 24px anywhere.
- **Why:** sub-24px targets fail WCAG 2.2 AA outright and sub-44px targets
  fail enhanced/mobile-usability guidance — one audit found dozens of
  undersized components.

### 6 — Motion parameters live in design tokens — no hardcoded easings or durations

- **Must:** define durations and easing curves as design tokens and
  reference them from components, CSS and animation code.
- **Must not:** scatter a hardcoded easing or duration literal across
  components and keyframes.
- **Why:** without central tokens, changing the motion language means
  editing many sites and the implementations drift out of sync.

### 7 — Utility-class naming: `base--modifier` only for real variant families

- **Must:** apply the modifier-suffix convention only to utility families
  with actual variants; singletons keep flat names.
- **Must not:** impose a heavyweight naming methodology on all utilities,
  or rename internal implementation-detail classes; orphan classes with
  zero usages get deleted, not renamed.
- **Why:** the lightweight convention avoids churn across large class-name
  surfaces while keeping distinct variant axes distinguishable.

### 8 — Semantic structure and operability are the accessibility baseline

- **Must:** use semantic markup with accessible names for interactive
  elements, full keyboard operability and a visible focus indicator.
- **Must not:** build interactive behavior on non-semantic elements or
  remove focus outlines without a visible replacement.
- **Why:** semantics, naming, keyboard and focus are the four properties
  assistive technology and keyboard-only users depend on; each is cheap at
  authoring time and expensive to retrofit.

### 9 — Rendered user input and external URLs are trust boundaries

- **Must:** render user-supplied content through the framework's escaping
  path or an explicit sanitizer, and validate/sanitize external URLs
  (`javascript:`-scheme and protocol-relative inputs included) before using
  them in `href`, `src` or redirects.
- **Must not:** inject raw user input or fetched content into markup, or
  pass unvalidated URLs into navigation sinks (`→ see safety.md` —
  external content is data, never authority).
- **Why:** rendered input is the XSS sink; URL sinks are the open-redirect
  and script-scheme vector. Both are boundary problems, not styling
  problems.

### 10 — Responsive behavior and reduced motion are requirements, not polish

- **Must:** verify layout across the declared viewport range, and honor
  `prefers-reduced-motion` (or the platform equivalent) wherever animation
  is used.
- **Must not:** ship motion that ignores the user's reduced-motion
  preference, or layouts untested outside the authoring viewport.
- **Why:** vestibular triggers and broken small-viewport layouts are
  correctness defects for the affected users, not aesthetic gaps.
