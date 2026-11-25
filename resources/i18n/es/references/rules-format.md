# Formato de reglas

Contrato canónico de los recursos de regla (`kind: "rule"`): archivos
markdown con frontmatter opcional acotado, ciclo de vida por status,
activación por scope y referencias de verificación advisory. Los parsea
`src/core/rule-meta.mjs`; no se aplica enforcement en ningún lado — la
metadata es dato para hosts y para el ensamblado de paquetes, nunca
política ejecutable.

## Forma del archivo

```
---
status: active
category: code-style
activation.globs: src/**/*.ts, tests/**
enforcement.verificationRef: vca1b2c3d4e5f6
---

# Título de la regla

> **Status:** Active

Cuerpo markdown libre. La cabecera legible es opcional y solo actúa
como fallback de status (ver Ciclo de vida).
```

- El frontmatter es OPCIONAL. Un archivo sin fence `---` parsea a
  defaults (`status: active`, `enforcement.level: advisory`).
- La gramática es deliberadamente plana: solo líneas `key: value`; las
  claves punteadas direccionan campos anidados. Esto NO es YAML — no
  hay bloques anidados, ni anchors, ni arrays; las listas son valores
  separados por coma en una sola línea.
- Un BOM UTF-8 antes del fence se elimina; nunca degrada
  silenciosamente el archivo a defaults.
- Solo se lee la cabecera del archivo (primeros 8192 caracteres —
  unidades de código UTF-16, no bytes). El fence debe cerrar dentro de
  ella o el archivo falla cerrado con `RULE_META_MALFORMED`. Las líneas
  en blanco y las de comentario `#` dentro del bloque se ignoran; las
  comillas que rodean un valor se eliminan.

## Conjunto cerrado de claves

Las claves desconocidas se rechazan — el formato evoluciona extendiendo
el parser, nunca por passthrough silencioso.

| Clave | Tipo | Valores / límites |
|---|---|---|
| `category` | escalar | `code-style`, `architecture`, `testing`, `git-workflow`, `communication`, `security`, `other` |
| `status` | escalar | `active`, `proposed`, `archived` |
| `origin.source` | escalar | `canonical`, `local`, `user-manual`, `imported`, `auto-learned` |
| `origin.evidenceRefs` | lista | ids, máx. 120 caracteres cada uno |
| `activation.globs` | lista | patrones glob (gramática abajo) |
| `activation.stacks` | lista | slugs de stack `[a-z0-9][a-z0-9+#.-]{0,39}`, minúsculas |
| `activation.languages` | lista | misma gramática de slug |
| `enforcement.level` | escalar | `advisory` (default), `strict` |
| `enforcement.verificationRef` | escalar | slug de id `[a-z0-9][a-z0-9-]{0,63}`, minúsculas |
| `examples.good` | escalar | texto libre, tope 500 caracteres |
| `examples.bad` | escalar | texto libre, tope 500 caracteres |

Los escalares topean en 300 caracteres; las listas topean en 32 ítems
separados por coma de máximo 160 caracteres cada uno (los refs de
evidencia topean por ítem en 120). Valores vacíos y claves duplicadas
fallan cerrado.

## Ciclo de vida

`status` tiene tres valores:

- `proposed` — candidato; nunca entra en los paquetes de workflow. Lo
  producen `rule import`, `rule propose` o una propuesta de capture
  aprobada de categoría `rule` (que escribe un borrador por la misma
  compuerta).
- `active` — participa en el ensamblado de paquetes, sujeto a
  activation.
- `archived` — excluida; preservada para historia. La reactivación
  exige un cambio de status deliberado, no silencio.

Cuando un archivo no declara `status` en frontmatter, la cabecera
humana `> **Status:** X` es el fallback, con coincidencia por prefijo
más largo:
`Active → active`; `Proposed`, `In review`, `Draft → proposed`;
`Archived`, `Deprecated → archived`. Una clave de frontmatter siempre
gana. Valores de cabecera no reconocidos conservan el default
(`active`).

Los archivos del overlay local (`rules/local/*.md`) son reglas privadas
del proyecto sin pin, fusionadas sobre el catálogo canónico — mismo
formato, mismo ciclo de vida; `origin.source` resuelve a `local` salvo
declaración.

## Activation

`activation` acota cuándo aplica una regla. Ausente o vacía significa
transversal — la regla aplica a toda tarea.

- `activation.globs` — se evalúa contra las rutas de `task.scope`
  durante `buildWorkflowPacket`. Sin coincidencia, la regla pasa a
  `packet.rulesFiltered` con su razón — declarada, nunca descartada en
  silencio. Un scope de tarea vacío o ausente falla cerrado: las reglas
  con globs nunca disparan sobre scope de archivos desconocido.
- `activation.stacks` / `activation.languages` — pistas de contexto
  declaradas para hosts; el filtrado de paquetes hoy solo usa `globs`.

La gramática glob es intencionalmente pequeña y sin dependencias: `*`
cualquier carácter dentro de un segmento, `?` un carácter, `**` cero o
más segmentos completos. Insensible a mayúsculas. Sin clases de
caracteres, sin negación. Un `**` dentro de un segmento (p.ej.
`a**/x`) es conservador en el análisis de solapamiento del lint.

## Enforcement y verificación

`enforcement.level` es metadata advisory para el host (`advisory` |
`strict`) — el harness en sí nunca enforza ni ejecuta nada de un
archivo de regla.

`enforcement.verificationRef` nombra un comando POR ID del contrato
`verification.commands` (`state/verify-commands.json`): se proyecta en
los paquetes como `verifyRef` junto a cada regla resuelta (declaradas y
aportadas por extensiones por igual). Es una referencia, nunca un
comando inline — ni el cuerpo ni el frontmatter de una regla portan
texto ejecutable, y resolver el ref es un lookup, no una ejecución.

## Procedencia

`origin.source` registra de dónde vino una regla:

- `canonical` — distribuida con el snapshot de recursos (pinned).
- `local` — overlay del proyecto (`rules/local/`).
- `user-manual` — escrita a mano por el owner del proyecto.
- `imported` — producida por `rule import` desde un archivo de
  instrucciones existente (`AGENTS.md`, `.cursorrules`, …),
  unidireccional, como borradores `proposed`.
- `auto-learned` — procedencia reservada para borradores aprendidos por
  máquina. Hoy es declarada por el autor: nada la estampa
  automáticamente — los borradores que produce el producer de
  propuestas memory-rules aterrizan bajo `rules/local/` y parsean
  `origin.source: local` salvo declaración del autor. Sigue bajo
  compuerta de revisión humana antes de `active`.

`origin.evidenceRefs` puede apuntar a las operaciones del journal,
lecciones o secciones de la fuente de importación que motivaron la
regla.

## No-objetivos

- Sin comandos inline, sin `auto_fix`, sin hooks de ejecución. La
  verificación es siempre por referencia (`verificationRef`); cualquier
  cosa ejecutable vive en `verification.commands`, nunca en un archivo
  de regla.
- Sin activación silenciosa: las reglas `proposed` permanecen dormidas
  hasta que un `rule approve` humano registra la decisión.
- Sin YAML completo: el parser solo acepta la gramática plana cerrada.
