# Accessible Interaction

Relevant checks include semantics, accessible names, keyboard operation,
focus order/visibility, contrast, reflow, reduced motion and error feedback.
Automated checks do not establish complete conformance.
State what was exercised and what requires a user or assistive technology.
Do not label an untested criterion as passing.

Quick reference for **WCAG 2.2 AA**-level review (WCAG 2.2 is the current
W3C Recommendation; WCAG 3.0 remains a working draft). Checklist items are
verifiable; automated tooling covers only a subset — keyboard,
screen-reader and zoom checks require hands-on exercise.

## Table of Contents

- [Essential Checks](#essential-checks)
- [WCAG 2.2 AA Additions](#wcag-22-aa-additions)
- [Common HTML Patterns](#common-html-patterns)
- [Testing Tools](#testing-tools)
- [Quick Reference: ARIA Live Regions](#quick-reference-aria-live-regions)
- [Common Anti-Patterns](#common-anti-patterns)

## Essential Checks

### Keyboard Navigation
- [ ] All interactive elements focusable via Tab key
- [ ] Focus order follows visual/logical order
- [ ] Focus is visible (outline/ring on focused elements)
- [ ] Custom widgets have keyboard support (Enter to activate, Escape to close)
- [ ] No keyboard traps (user can always Tab away from a component)
- [ ] Skip-to-content link at top of page — visible (at least) on keyboard focus
- [ ] Modals trap focus while open, return focus on close

### Screen Readers
- [ ] All images have `alt` text (or `alt=""` for decorative images)
- [ ] All form inputs have associated labels (`<label>` or `aria-label`)
- [ ] Buttons and links have descriptive text (not "Click here")
- [ ] Icon-only buttons have `aria-label`
- [ ] Page has one `<h1>` and headings don't skip levels
- [ ] Dynamic content changes announced (`aria-live` regions)
- [ ] Tables have `<th>` headers with scope

### Visual
- [ ] Text contrast ≥ 4.5:1 (normal text) or ≥ 3:1 (large text, 18px+)
- [ ] UI components contrast ≥ 3:1 against background
- [ ] Color is not the only way to convey information
- [ ] Text resizable to 200% without breaking layout
- [ ] No content that flashes more than 3 times per second

### Forms
- [ ] Every input has a visible label
- [ ] Required fields indicated (not by color alone)
- [ ] Error messages specific and associated with the field
- [ ] Error state visible by more than color (icon, text, border)
- [ ] Form submission errors summarized and focusable
- [ ] Known fields use autocomplete (for example `type="email" autocomplete="email"`)

### Content
- [ ] Language declared (`<html lang="en">`)
- [ ] Page has a descriptive `<title>`
- [ ] Links distinguishable from surrounding text (not by color alone)
- [ ] Touch targets ≥ 44x44px on mobile (best practice; WCAG 2.2 AA floor
      is SC 2.5.8: ≥24×24 CSS px or sufficient spacing between targets)
- [ ] Meaningful empty states (not blank screens)

## WCAG 2.2 AA Additions

Success criteria introduced at AA by WCAG 2.2 that older checklists miss:

- [ ] SC 2.4.11 Focus Not Obscured — the focused element is not entirely
      hidden by sticky headers, banners or overlays
- [ ] SC 2.5.7 Dragging Movements — any drag action has a single-pointer
      alternative (a button or control that achieves the same result)
- [ ] SC 3.2.6 Consistent Help — help/contact mechanisms appear in the
      same relative order on every page that has them
- [ ] SC 3.3.7 Redundant Entry — data already entered is not requested
      again in the same session (auto-populated or selectable)
- [ ] SC 3.3.8 Accessible Authentication — login does not require a
      cognitive function test (puzzle, transcription) unless an
      alternative, a mechanism (password-manager support, paste allowed)
      or object/personal-content recognition is provided

## Common HTML Patterns

### Buttons vs. Links

```html
<!-- Use <button> for actions -->
<button onClick={handleDelete}>Delete Task</button>

<!-- Use <a> for navigation -->
<a href="/tasks/123">View Task</a>

<!-- NEVER use div/span as buttons -->
<div onClick={handleDelete}>Delete</div>  <!-- BAD -->
```

### Form Labels

```html
<!-- Explicit label association -->
<label htmlFor="email">Email address</label>
<input id="email" type="email" required />

<!-- Implicit wrapping -->
<label>
  Email address
  <input type="email" required />
</label>

<!-- Hidden label (visible label preferred) -->
<input type="search" aria-label="Search tasks" />
```

### ARIA Roles

```html
<!-- Navigation -->
<nav aria-label="Main navigation">...</nav>
<nav aria-label="Footer links">...</nav>

<!-- Status messages -->
<div role="status" aria-live="polite">Task saved</div>

<!-- Alert messages -->
<div role="alert">Error: Title is required</div>

<!-- Modal dialogs -->
<dialog aria-modal="true" aria-labelledby="dialog-title">
  <h2 id="dialog-title">Confirm Delete</h2>
  ...
</dialog>

<!-- Loading states -->
<div aria-busy="true" aria-label="Loading tasks">
  <Spinner />
</div>
```

### Accessible Lists

```html
<ul role="list" aria-label="Tasks">
  <li>
    <input type="checkbox" id="task-1" aria-label="Complete: Buy groceries" />
    <label htmlFor="task-1">Buy groceries</label>
  </li>
</ul>
```

## Testing Tools

```bash
# Automated audit
npx @axe-core/cli <url>  # Programmatic accessibility testing (axe CLI)
npx pa11y <url>          # CLI accessibility checker

# In browser
# Chrome DevTools → Lighthouse → Accessibility
# Chrome DevTools → Elements → Accessibility tree

# Screen reader testing
# macOS: VoiceOver (Cmd + F5)
# Windows: NVDA (free) or JAWS
# Linux: Orca
```

Automated tools catch roughly a third of WCAG issues; they cannot verify
focus order sanity, meaningful alt text quality, or screen-reader
comprehensibility. Record what was automated vs. manually exercised.

## Quick Reference: ARIA Live Regions

| Value | Behavior | Use For |
|-------|----------|---------|
| `aria-live="polite"` | Announced at next pause | Status updates, saved confirmations |
| `aria-live="assertive"` | Announced immediately | Errors, time-sensitive alerts |
| `role="status"` | Same as `polite` | Status messages |
| `role="alert"` | Same as `assertive` | Error messages |

## Common Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| `div` as button | Not focusable, no keyboard support | Use `<button>` |
| Missing `alt` text | Images invisible to screen readers | Add descriptive `alt` |
| Color-only states | Invisible to color-blind users | Add icons, text, or patterns |
| Autoplaying media | Disorienting, can't be stopped | Add controls, don't autoplay |
| Custom dropdown with no ARIA | Unusable by keyboard/screen reader | Use native `<select>` or proper ARIA listbox |
| Removing focus outlines | Users can't see where they are | Style outlines, don't remove them |
| Empty links/buttons | "Link" announced with no description | Add text or `aria-label` |
| `tabindex > 0` | Breaks natural tab order | Use `tabindex="0"` or `-1` only |

<!-- Cross-references: → see frontend-web.md, performance-checklist.md, ocr-review.md -->
