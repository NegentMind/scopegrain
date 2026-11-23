---
name: documentation-and-adrs
description: Úsala al documentar APIs reales, cambiar registros de arquitectura o explicar una decisión de diseño consecuente
---
# Documentación y decisiones

Lee la implementación actual y las convenciones de documentación.
Documenta comportamiento soportado, semántica de fallos, ejemplos y
limitaciones.
Para un registro de decisión enuncia contexto, alternativas consideradas,
resultado elegido y consecuencias positivas y negativas.
Usa enlaces relativos resolubles y etiqueta propuestas frente a
funcionalidades existentes.
Mantén las notas operativas dentro del espacio de trabajo del harness;
publica documentación de producto solo como entregable explícitamente
pedido.

Documenta decisiones, no solo código. El código muestra *qué* se construyó;
la documentación explica *por qué se construyó así* y *qué alternativas se
rechazaron*. Escribe CommonMark plano que se renderice correctamente en la
forge principal del proyecto primero, y se comporte en cualquier segundo
consumidor (vaults, generadores de sitio) después.

## Cuándo usar

- Al tomar una decisión arquitectónica significativa o elegir entre
  enfoques en competencia.
- Al añadir o cambiar una API pública o comportamiento visible al usuario.
- Al escribir o reorganizar cualquier documento bajo el árbol de docs del
  proyecto.
- Al explicar lo mismo repetidamente — esa repetición es una decisión no
  documentada.

No para: código autoexplicativo, prototipos desechables, o notas operativas
que pertenecen al espacio de trabajo del harness en lugar de a los docs de
producto.

## No negociables

1. **Nunca escribas `[[wikilinks]]` en prosa.** Se renderizan como
   `[[text]]` literal en las forges comunes. Usa `[Label](relative/path.md)`.
2. **Da siempre frontmatter a un documento nuevo** con al menos `title` y
   `kind` (o el equivalente establecido del proyecto).
3. **`kind` se deriva de la ruta, nunca se elige independientemente.** Ruta
   y kind deben coincidir, o la puerta de docs falla.
4. **Nunca edites a mano un índice generado.** Los archivos que llevan un
   banner de generado se regeneran con las herramientas del proyecto.
5. **Nunca escribas campos de frescura auto-reportados** (`last_reviewed`
   y similares). La frescura es `git log -1 --format=%cs -- <file>` —
   exacta y gratis.

## Enlaces

| Propósito | Escribe | Se renderiza en forge |
|---|---|---|
| Documento interno | `[Name](../path/doc.md)` | sí |
| Encabezado dentro de un doc | `[Section](./API.md#section)` | sí |
| Imagen | `![Diagram](../assets/x.png)` | sí |
| Externo | `[docs](https://example.com)` | sí |

- Las rutas son **relativas al archivo contenedor**, nunca "la más corta" —
  los proyectos acumulan nombres base duplicados y solo las rutas relativas
  resuelven sin ambigüedad.
- Enlaza al archivo canónico, no a una copia generada o árbol espejo —
  enlazar a una copia crea una segunda fuente de verdad.
- Enlaces dentro de tablas: un `|` dentro de una etiqueta o URL rompe la
  celda — escápalo como `\|`.
- **Enlaces rotos: reporta, nunca adivines.** Un enlace erróneo es peor que
  uno roto: el roto es ruidoso, el erróneo desvía silenciosamente a
  lectores *y* agentes mientras pasa las comprobaciones de existencia. Si
  el destino se desconoce, señálalo.
- Si el proyecto guarda enlaces de propiedades estilo vault en frontmatter,
  déjalos — reescribir propiedades tipadas las corrompe a nivel de
  herramienta.

## Frontmatter

```yaml
---
title: "Hybrid retrieval: lexical + vector fused with RRF"
kind: reference
status: active
description: "One line. This text appears in generated indexes."
tags: [api, retrieval]
---
```

| Clave | Obligatoria | Notas |
|---|---|---|
| `title` | sí | Debe coincidir con el H1, o el H1 debería estar ausente. Dos títulos se lee inacabado. |
| `kind` | sí | Del enum del proyecto; debe coincidir con la ruta. |
| `status` | no | p.ej. `draft` `active` `stable` `proposed` `accepted` `rejected` `deprecated` `superseded` |
| `description` | no | Una línea; los archivos sin ella suelen omitirse de los índices. |
| `tags` | no | Pocas, en minúsculas con guiones, reutiliza el vocabulario del proyecto. |
| `supersedes` / `superseded_by` | no | Solo cadenas de ADR. |

Mantén el esquema pequeño: las forges renderizan el frontmatter como una
tabla clave/valor visible en cada página. Unas pocas claves planas es el
punto óptimo.

### `kind` decide la ruta (mapa típico — sigue el del proyecto)

```
index      README.md / index.md
concept    docs/concepts|architecture|strategy/
tutorial   docs/tutorials/
howto      docs/guides|howto|user/
runbook    docs/operations|runbooks|workflow/
reference  docs/api/
glossary   docs/glossary/
adr        docs/**/adr/
plan       docs/plans/
research   docs/research/
review     docs/reviews|progress/
report     docs/reports|benchmarks/
changelog  CHANGELOG.md
```

## Tipos de documento: qué debe cada uno al lector

Tomado de Diátaxis — cuatro necesidades, no una (`concept` aquí es el
cuadrante *explicación* de Diátaxis; conserva el vocabulario `kind` del
proyecto):

| Tipo | La pregunta del lector | Regla |
|---|---|---|
| tutorial | "Enséñame, estoy atascado." | Una ruta funcional, de extremo a extremo; sin alternativas ofrecidas como si fueran opciones |
| howto | "Haz esta cosa específica." | Parte de un objetivo; asume competencia |
| reference | "¿Qué hace esto exactamente?" | Exhaustivo, uniforme, sin narrativa; prefiere generado sobre escrito a mano |
| concept | "¿Por qué es así?" | El único tipo donde la prosa es el punto; mantenlo corto |

**Un cambio de API pública no reflejado en los docs de referencia está
incompleto.** La página de documentación se entrega en el mismo cambio que
el código.

## Registros de decisión de arquitectura

### Cuándo escribir uno

Elección de framework/dependencia, modelo de datos, estrategia de auth,
arquitectura de API, selección de plataforma o infraestructura — cualquier
decisión cara de revertir.

### Primero iguala la convención existente

Antes de crear un ADR, inspecciona el repositorio en busca de una
convención establecida — ADRs existentes, configuración de docs (p.ej. un
archivo adr-dir), plantillas. Iguala:

- **Ubicación y formato** — directorio, extensión, marcado.
- **Numeración y nomenclatura** — continúa la secuencia; nunca reinicies en
  001 ni introduzcas un segundo esquema.
- **Encabezados de sección** — reutiliza el conjunto de encabezados del
  proyecto.

La evidencia en conflicto se saca a la superficie, no se resuelve en
silencio con un esquema nuevo. Solo en ausencia de toda convención aplicas
la plantilla de abajo.

### Plantilla ADR (estilo MADR, el valor por defecto seguro)

```markdown
# NNNN. Decision title

Status: proposed | accepted | superseded by ADR-NNNN   (or frontmatter `status:`)
Date: YYYY-MM-DD

## Context and problem statement
What forces are at play? What is the actual problem?

## Decision drivers
- The quality, constraint or force that decides this.

## Considered options
- Option A — pros / cons
- Option B — pros / cons
- Option C — pros / cons

## Decision outcome
Chosen option and why.

### Positive consequences
### Negative consequences          ← an ADR without this is incomplete
```

Reglas:

- **Inmutable una vez aceptado.** Un cambio de opinión es un ADR *nuevo*
  que nombra al reemplazado vía `supersedes:`/`superseded_by:`. Nunca
  edites el cuerpo de un ADR aceptado para cambiar la decisión.
- **Registra al menos dos opciones consideradas.** Una decisión que no
  nombra alternativas no es una decisión — y un lector repropondrá la
  opción rechazada.
- Ciclo de vida: `proposed → accepted → (superseded | deprecated)`. No
  borres ADRs viejos; guardan contexto histórico.
- No todo archivo merece ser un ADR: un detalle de implementación no es un
  registro de decisión.

## Documentación inline

Comenta el *por qué*, no el *qué*:

```typescript
// BAD: restates the code
// Increment counter by 1
counter += 1;

// GOOD: non-obvious intent
// Sliding window resets at the boundary, not on a schedule,
// to prevent burst attacks at window edges
if (now - windowStart > WINDOW_SIZE_MS) { counter = 0; windowStart = now; }
```

No hagas: comentar código autoexplicativo, dejar TODOs para trabajo que
puedes hacer ahora, o mantener código comentado (el historial es el
archivo).

Documenta las trampas conocidas donde muerden:

```typescript
/**
 * IMPORTANT: must run before first render; after hydration the theme
 * context is unavailable and the UI flashes unstyled. See ADR-003.
 */
```

## Documentación de API

- Prefiere documentación tipada inline en las superficies públicas:
  propósito, parámetros, retorno, errores lanzados, un ejemplo ejecutable.
- Las superficies REST tienen una especificación (OpenAPI o el formato del
  proyecto) — generada o escrita, nunca ambas divergiendo.
- Documenta la semántica de fallos y las limitaciones, no solo el camino
  feliz.

## Estructura de README

```markdown
# Project Name
One-paragraph description.

## Quick Start      — clone, install, env setup, run
## Commands         — build / test / lint / dev table
## Architecture     — brief map; link ADRs for the why
## Contributing     — standards and PR process
```

## Changelog

Entradas curadas agrupadas por impacto (`Added / Changed / Fixed /
Deprecated / Removed / Security`), las más nuevas primero, redactadas para
el consumidor — nunca un volcado crudo de `git log`. Escribe la entrada con
el cambio. El contrato de versionado detrás del changelog es de
`git-workflow-and-versioning`; la página por entrega para el consumidor es
de `release-notes-one-pager`.

## Documentación para agentes

- Archivos de reglas/instrucciones — convenciones para que los agentes las
  sigan.
- Specs — mantenidas al día para que los agentes construyan lo correcto.
- ADRs — evitan re-decidir preguntas ya resueltas.
- Trampas inline — evitan caer en trampas conocidas.

## Longitud: la restricción de Nygard

> "Large documents are never kept up to date. Small, modular documents
> have at least a chance. Nobody ever reads large documents."

- Ningún documento más allá de ~300 líneas sin una tabla de contenidos y un
  plan de división.
- Si un lector necesita dos documentos para responder una pregunta, el
  límite entre ellos está mal.

## Generado vs escrito a mano

**Un hecho, un archivo. En todos los demás sitios, un enlace.** Un enlace
falla ruidosamente; una copia falla en silencio (la deriva de contenido
sobrevive a los 404).

- Si un valor puede generarse (versiones, índices, superficies de API,
  cobertura de docs), genéralo — copiar a mano un valor generado significa
  que una copia ya está mal.
- Las cadenas de versión, superficies de API, índices y changelogs tienen
  exactamente un propietario cada uno; todo lo demás enlaza.

## Definición de Terminado

Ejecuta las comprobaciones de docs del proyecto (todas offline, segundos):
comprobación de enlaces, comprobación de esquema/frontmatter, regeneración
de índice, lint de prosa — luego confirma leyendo:

- [ ] ¿Un lector familiarizado con el proyecto encontraría esto en el
      índice generado?
- [ ] ¿El H1 coincide con `title`, o está ausente uno de ellos?
- [ ] ¿Toda afirmación está fundamentada o es verificable por un comando
      del repo?
- [ ] ¿Cada ejemplo de código seguiría ejecutándose?
- [ ] Si este documento queda obsoleto, ¿qué lo hace visible? (Una puerta —
      no una fecha en frontmatter.)

## Antipatrones

| Antipatrón | Por qué está mal |
|---|---|
| `[[wikilink]]` en prosa | Texto literal en las forges |
| Un duplicado de un doc en un segundo árbol | Segunda fuente de verdad; diverge en silencio |
| Añadir un archivo sin regenerar el índice | El huérfano es invisible hasta que el índice se regenere |
| Campos estilo `last_reviewed` | Auto-reporte, no medición; obsoleto en el mismo commit |
| Listas `related:` mantenidas a mano | Mismo modo de fallo que un índice a mano, a menor escala |
| Documento de arquitectura de 500 líneas | Nunca actualizado, nunca leído |
| ADR con una opción | La opción rechazada se repropone |
| Adivinar un destino de enlace para dejar CI en verde | Un enlace erróneo es peor que uno roto |
| Lint-fix masivo sobre prosa escrita a mano | Ruido que oculta ediciones reales en el diff |

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "El código se autodocumenta" | El código muestra el qué — no el por qué, ni qué se rechazó. |
| "Docs cuando la API se estabilice" | Las APIs se estabilizan más rápido documentadas; el doc es la primera prueba del diseño. |
| "Nadie lee docs" | Los agentes sí. Los ingenieros futuros sí. Tu yo futuro sí. |
| "Los ADRs son sobrecarga" | Diez minutos ahora previenen un re-debate de dos horas en seis meses. |
| "Los comentarios quedan obsoletos" | Los comentarios sobre *qué* quedan obsoletos; los comentarios sobre *por qué* son estables. Escribe solo los segundos. |

## Señales de alerta

- Decisiones arquitectónicas sin justificación escrita
- APIs públicas sin documentación ni tipos
- README que no puede poner a un desarrollador nuevo en marcha
- Código comentado en lugar de eliminado
- Comentarios TODO envejeciendo durante semanas
- Docs que repiten el código en lugar de explicar la intención
- Enlaces internos apuntando a copias generadas/espejo

## Verificación

- [ ] Existen ADRs para todas las decisiones arquitectónicas significativas
- [ ] El README cubre inicio rápido, comandos, visión de arquitectura
- [ ] Las superficies de API públicas tienen documentación de
      parámetros/retorno/fallos
- [ ] Trampas documentadas inline donde importan
- [ ] No queda código comentado
- [ ] Los enlaces resuelven; frontmatter válido; índices regenerados
- [ ] Los archivos de reglas/instrucciones (AGENTS.md o el equivalente del
      proyecto) están actualizados y son correctos
- [ ] Las notas operativas se quedaron en el espacio de trabajo del
      harness; los docs de producto fueron un entregable explícitamente
      pedido

## Ver también

- `git-workflow-and-versioning` — el contrato SemVer/tag/changelog que la
  sección Changelog resume.
- `release-notes-one-pager` — la página por entrega orientada al
  consumidor.
- `project-onboarding` — configura el espacio de trabajo del harness y la
  disposición de referencia donde viven las notas operativas.
- `resources/references/definition-of-done.md` — la puerta permanente que
  los cambios de docs también superan.
