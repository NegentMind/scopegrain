# Web Project Evidence

Identify routes, framework boundaries, server/client execution, state,
forms, assets and accessibility semantics before proposing changes.
Use established visual conventions and verify responsive behavior.
Static code review can identify risks but cannot establish real user
performance or complete keyboard/screen-reader operation.

This is the structure for a web-frontend reference. Record the project's
actual stack decisions and conventions — the concrete inventory below is a
template, not the answer.

## What to record

### Structure map

Annotate the real tree — one fact per arrow:

```
web/
  src/
    app/            ← framework routes (note: server vs. client components)
    components/
      ui/           ← design-system primitives
      <domain>/     ← product-specific composite components
    hooks/          ← shared behavior hooks (focus trap, reveal, toast, …)
    lib/            ← dictionaries/i18n, utilities (class-merge helper, …)
  public/assets/    ← static media
```

### Stack decisions table

| Decision | Why it was made |
|---|---|
| Framework + major version | Router model, rendering strategy, build output mode, any `ignoreBuildErrors`-style compromises — recorded explicitly |
| Component library | Which design system, which style preset, which icon set |
| Styling | CSS framework version and where the theme actually lives (theme tokens in CSS vs. config file — a stale config file is a trap) |
| Animation | Which library for page transitions, scroll reveal, count-up, interactive graphics |
| State management | Which store, and whether it is actually used or merely installed |

### Design system tokens

- Colors: named tokens with hex values.
- Borders/shadows: the project's signature treatment (e.g. rigid offset
  shadows), with the exact utility classes.
- Named effects/utilities the codebase already defines — reuse them
  instead of inventing parallel ones.

### i18n

- Mechanism: provider/context + hook shape (`{ t, lang, setLang }`-style),
  dictionary location, language set, approximate key count.
- Dead ends: i18n libraries installed but unused — record them so an agent
  does not wire a second i18n system.

### Animation conventions

- Page transitions: the wrapper component used and where it mounts.
- Scroll reveal: the wrapper + direction/delay props.
- Specialized graphics: which library owns which signature visual.

### Content facts that must match reality

- The real stack versions the site advertises (language/runtime floors).
- Real integrations/features named in copy — a marketing claim that
  disagrees with the codebase is a bug.
- The actual product version displayed.

## Verification before proposing a change

- [ ] Which routes/pages exist and which render server-side vs. client-side.
- [ ] Which visual conventions the edit must follow (tokens, effects).
- [ ] Whether the change must be exercised at mobile + desktop widths and
      under reduced-motion.
- [ ] Whether any claim in the site's content depends on a stack fact you
      are about to change.

<!-- Referencias cruzadas: → ver accessibility-checklist.md, performance-checklist.md, ocr-review.md -->
