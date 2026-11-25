# Paquete canónico de recursos

`manifest.json` es el contrato del catálogo: `entries` son los recursos
canónicos, `aliases` mapea identificadores deprecated a objetivos
canónicos, y `version` es un semver de contenido que debe incrementarse
estrictamente cada vez que algo bajo `resources/` cambia (aplicado por
`scripts/check-manifest-version.mjs`).

## Formato de archivo por tipo

| Tipo | Ubicación | Formato de archivo |
|---|---|---|
| `command` | `commands/*.md` | YAML frontmatter (`name`, `description`) + cuerpo Markdown |
| `skill` | `skills/<id>/SKILL.md` | YAML frontmatter (`name`, `description`) + cuerpo Markdown |
| `agent` | `agents/*.md` | YAML frontmatter (`name`, `description`) + cuerpo Markdown |
| `prompt` | `prompts/*.md` | YAML frontmatter (`name`, `description`) + cuerpo Markdown |
| `rule` | `rules/*.md` | Markdown plano; frontmatter rule-meta opcional y acotado (ver abajo) |
| `reference` | `references/*.md` | Markdown plano, **sin frontmatter** |
| `mcp` | `mcps/*.json` | Descriptor JSON (`schemaVersion`, `id`, transport) |
| `profile` | `profiles/*.json` | Descriptor JSON (`schemaVersion`, `id`, listas de dependencias) |

## Por qué rules y references no llevan frontmatter descriptivo

El formato plano es deliberado, no una omisión. Rules y references nunca
son unidades de host seleccionables individualmente: se empaquetan como
texto de cuerpo dentro de commands, skills y agents a través de las claves
de dependencia del manifest (`rules:`, `references:`). Su `description`
legible por humanos vive solo en `manifest.json`. El renderer nativo lee el
frontmatter de los archivos exclusivamente para las entradas `skill` y
`command` (`descFor` en `src/hosts/native.mjs`); duplicar descripciones en
los archivos de rule/reference crearía una segunda fuente de verdad sin
consumidor — el mismo riesgo de deriva que el comentario del loader ya
registra para skills y commands.

## Frontmatter opcional de metadatos en rules

Los archivos `rule` son la única excepción: pueden abrir con un bloque
`---` de líneas planas `key: value` (las claves punteadas direccionan
campos anidados — la misma gramática de línea que el peek de frontmatter
de queries, nunca YAML anidado) declarando metadatos de activación y
ciclo de vida. El conjunto cerrado de claves es `category`, `status`
(`active|proposed|archived`), `origin.source`, `origin.evidenceRefs`,
`activation.globs`, `activation.stacks`, `activation.languages`,
`enforcement.level` (`advisory|strict`),
`enforcement.verificationRef`, `examples.good` y `examples.bad`,
definido en `src/core/rule-meta.mjs` y expuesto en los recursos
`kind=rule` como `meta` a través de `getResource` tras la comprobación
de integridad. Sin clave `status` declarada, la cabecera humana
`> **Status:**` del archivo actúa de fallback (`Active | In review |
Draft | Deprecated` mapean a `active | proposed | proposed |
archived`). Los archivos sin bloque obtienen los defaults declarados
(`status: active`, `origin.source: canonical`,
`enforcement.level: advisory`); un bloque malformado falla cerrado.
Límites: valores escalares ≤300 caracteres, listas separadas por comas
≤32 ítems de ≤160 cada una (refs de evidencia ≤120), y el bloque debe
cerrar dentro de los primeros 8 KiB del archivo. El bloque porta solo
metadatos consumibles por máquina:
sin `name`, sin `description` (esa vive en `manifest.json`) y nunca
comandos ejecutables — `enforcement.verificationRef` es una referencia
por id a `verification.commands`, nada más.
