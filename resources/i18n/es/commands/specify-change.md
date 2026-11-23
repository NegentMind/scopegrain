---
name: specify-change
description: Define un resultado observable y requisitos de cambio falsables.
---
# Especificar un cambio

Invoca `spec-driven-development`, `outcome-driven-development` y
`clarify-intent`. Si los requisitos son ambiguos, invoca también
`resolve-ambiguity` para extraer lo que el propietario realmente
necesita. Haz preguntas consecuentes con `prompts/decision-request`.
Reglas rectoras: `rules/api-contract`, `rules/methodology`.
Roles: `requirements-analyst` redacta, `architect` revisa los límites.

Este comando produce la spec independiente de feature/cambio. La
mini-spec más ligera embebida en un registro de tarea usa
`prompts/spec-brief` — misma profundidad de tabla de decisiones,
ámbito de tarea.

## Paso 1 — Contexto primero (no preguntes lo que el código ya responde)

Antes de cualquier pregunta, deriva todo lo posible del repositorio:

1. Inspecciona el área afectada: estructura, patrones, pila real
   (límites de `references/architecture`). Usa herramientas de grafo
   cuando esté indexado y fresco, en caso contrario búsqueda en el
   código (`references/graph-investigation`).
2. Lee la documentación existente: README, especificaciones previas,
   registros de decisiones de arquitectura, specs anteriores; comprueba
   las convenciones existentes de `references/definition-of-done` antes
   de escribir criterios de aceptación.
3. Lee las decisiones previas registradas en la ruta de decisiones
   configurada.
4. Si una decisión involucra una biblioteca/API/tecnología externa,
   valídala contra documentación oficial tras permiso de red
   (`web-research`) **antes** de proponerla como opción. Un tradeoff
   citado vale más que un adjetivo.

Cada hecho derivable del contexto entra en la spec directamente como un
elemento **decidido** con evidencia citada (`ref: file:line`). Esto
minimiza las preguntas.

## Paso 2 — Tabla de decisiones abiertas

Lista solo lo que el contexto no puede responder. Cada fila necesita al
menos dos alternativas reales con un tradeoff de una línea; si solo una
vía es viable, regístrala como decidida-por-evidencia — nunca rellenes
con opciones de relleno.

| # | Decisión | Opciones (+tradeoff) | Por defecto recomendado |
|---|----------|---------------------|---------------------|
| 1 | p. ej. autenticación de sesión vs token | session (simple, revocable) / token (sin estado, revocación compleja) | session |

Si nada está abierto (todo derivable), salta al Paso 4.

## Paso 3 — Una ronda de decisiones

Haz todas las preguntas abiertas en una sola ronda, cada una con
opciones concretas y la opción recomendada primero
(`prompts/decision-request`).

- Nunca preguntas abiertas sin opciones («¿qué quieres?»).
- Si el host no expone interfaz de preguntas, emite la tabla del Paso 2
  como informe estructurado y **detente** — nunca asumas respuestas.
- Registra las respuestas en la columna de resueltas de la tabla y en
  la ruta de decisiones configurada. Una pregunta omitida o rechazada
  no es aprobación.

## Paso 4 — Escribir la especificación (máx. 1 página + enlaces)

Cubre las seis áreas centrales usando el contexto (Paso 1) y las
respuestas (Paso 3): objetivo, interfaces/comandos, estructura del
proyecto, estilo de código, estrategia de testing, límites. El detalle
vive en los registros de decisión enlazados; una spec de cinco páginas
ni se lee ni se mantiene.

Persiste la spec en las rutas de harness configuradas, no en docs del
producto (`rules/methodology`). Registra la decisión clave en la ruta
de decisiones. Considera un ADR por decisión arquitectónica
(`documentation-and-adrs`).

Puertas de decisión antes de escribir:

- ¿Existen specs previas, ADR o docs de diseño? Léelos primero
  (Paso 1).
- ¿Es el objetivo lo bastante claro para criterios de aceptación
  testables? Si no, es otra fila de la tabla del Paso 2.
- ¿La pila necesita validación? Valida contra la documentación oficial
  o una comprobación local autorizada; ejecutar una puerta mecánica
  sobre una spec en markdown es un no-op.

## Autoridad y verificación

Una ronda de preguntas, luego la spec se escribe a partir de respuestas
registradas — nunca de supuestas. Las decisiones persisten a través de
operaciones de harness aprobadas en la ruta de decisiones configurada;
el artefacto spec va a la ruta de spec del harness configurada, no a la
documentación del producto.

## Contrato de salida

```markdown
# Spec: [Project/Feature Name]

## Objective
[1-2 lines]

## Target Users
[who, what problem]

## Core Features
- [ ] Feature 1: [AC: what "done" looks like]

## Tech Stack
[language, framework, deps, constraints]

## Boundaries
- Always: [patterns to follow]
- Ask first: [decisions requiring approval]
- Never: [prohibited patterns]

## Testing Strategy
[how to verify each feature]

## Project Structure
[file tree or module layout if known]
```

Devuelve el contrato aprobado o las preguntas sin resolver. Las
decisiones registradas aterrizan en la ruta de decisiones; la spec
misma en la ruta de spec configurada.

## Señales de alarma

- Opciones de relleno inventadas para que una fila parezca completa.
- Una pregunta abierta hecha sin opciones concretas, o una respuesta
  omitida tratada como aprobación.
- Una pila externa propuesta antes de validarla contra su documentación
  primaria.
- Implementación iniciada dentro de este comando — `plan-work` consume
  la spec a continuación.

## Entrega

`plan-work` consume la spec resuelta; `implement-task` consume
directamente una spec de tarea única para ámbito light.
