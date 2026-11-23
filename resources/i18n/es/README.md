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
| `rule` | `rules/*.md` | Markdown plano, **sin frontmatter** |
| `reference` | `references/*.md` | Markdown plano, **sin frontmatter** |
| `mcp` | `mcps/*.json` | Descriptor JSON (`schemaVersion`, `id`, transport) |
| `profile` | `profiles/*.json` | Descriptor JSON (`schemaVersion`, `id`, listas de dependencias) |

## Por qué rules y references no llevan frontmatter

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
