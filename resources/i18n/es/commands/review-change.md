---
name: review-change
description: Revisa un cambio en busca de riesgos de comportamiento y verificación ausente.
---
# Revisar un cambio

Dos enfoques, seleccionados por argumento o intención del propietario:

| Enfoque | Invocación | Comportamiento |
|---|---|---|
| Revisión de cambio (por defecto) | `review-change [scope]` | Revisión profunda de un diff o unidad de trabajo |
| Auditoría de arquitectura / clean-code | `review-change` con `focus: architecture` + ruta opcional | Barrido de cumplimiento del libro de reglas; solo reporta, nunca edita |

Skills a cargar: `unified-review` (modo review), `review-deep`,
`code-review-and-quality`, `independent-review` cuando un contexto de
revisor separado esté disponible. Prepáralo con
`prompts/review-request`; registra hallazgos según
`prompts/finding-record`. Reglas rectoras: `rules/review`,
`rules/api-contract`.

## Enfoque: revisión de cambio

1. Lee el contrato aprobado, el diff completo, los llamadores y la
   evidencia real de comprobaciones. Si el diff de trabajo está vacío,
   usa el diff del último commit como ámbito de revisión e indícalo.
2. Prioriza bugs, seguridad, compatibilidad y casos de regresión
   ausentes. Traza datos, autoridad, propiedad, persistencia y
   concurrencia donde sea relevante; comprueba estados adversarios e
   interrumpidos, no solo el camino de éxito (`review-deep`).
3. Con el enfoque de arquitectura, inspecciona los límites y la
   dirección de dependencias; no sustituyas riesgos demostrados por
   puntuaciones estilísticas.
4. Devuelve hallazgos ordenados por severidad con ubicaciones de
   archivo, evidencia, impacto y una condición de aceptación concreta
   para la corrección (`references/definition-of-done`). Separa
   defectos confirmados de hipótesis y de comprobaciones no
   disponibles.
5. Si no se encuentra nada, decláralo y registra los huecos residuales.

No edites el cambio, y no apruebes como revisión independiente trabajo
que tú mismo escribiste — el contexto revisor (`reviewer`, o
`architect` para cuestiones de límites) debe diferir del autor; una
exención debe ser una decisión explícita del propietario, nunca un
revisor inventado.

## Enfoque: auditoría de arquitectura / clean-code (port de cleanCA)

Barrido de solo reporte del archivo/directorio nombrado, o un barrido
módulo por módulo de todo el repo cuando no se da ruta. Carga la lista
de comprobación de `references/clean-code-clean-architecture` antes de
auditar; los apéndices del proyecto ahí prevalecen sobre los ejemplos
genéricos.

### Lista de comprobación

Aplica la lista de comprobación y la escala de severidad de
`references/clean-code-clean-architecture` — §2 micro-arquitectura
(nomenclatura, SLAP, manejo de errores, catálogo de smells), §3 idiomas
del lenguaje, §4 SOLID y gobernanza de componentes, §5 fronteras de
arquitectura limpia, §10 escala de severidad (🔴/🟡/🟢). Etiqueta cada
hallazgo con la sección de la referencia que viola; no reportes
preferencias como defectos.

### Impacto por hallazgo (medium/high, obligatorio)

Para cada hallazgo mapea: **dependientes** (quién depende de
él), **dependencias** (de qué depende), **función** (una línea),
**qué se rompe si se cambia** (contratos, serialización, API pública,
código generado, consumidores dinámicos) y **mejora propuesta** (boceto
mínimo antes/después — nunca aplicado aquí). Usa herramientas de grafo
cuando esté indexado; en caso contrario, búsqueda de llamadores.

### Formato de salida

```markdown
# Clean-code/architecture audit — <scope> — <date>
## Summary: high X · medium Y · low Z (verdict: PASS / DEBT / BLOCKED)
## High findings
### [<rule>] `path:line` — title
- Evidence: `snippet`
- Violates: <rule + section>
- Dependents / Dependencies / Function / Risk / Proposal (before→after)
## Medium findings (same, grouped by rule)
## Low suggestions (one line each)
## Out of scope (files skipped and why)
```

## Autoridad y verificación

Ambos enfoques son de solo lectura sobre el cambio bajo revisión:
hallazgos, evidencia y propuestas — nunca ediciones, nunca una
corrección colada en el informe. La independencia es real o
explícitamente eximida por el propietario; un rol de autor renombrado
no es independencia.

## Contrato de salida

- Informe bajo la ruta de informes configurada
  (`review-<focus>-<YYYYMMDD>-<HHMMSS>.md`) e indexado; el lead puede
  persistir un informe delegado a través de operaciones de harness
  aprobadas.
- Cada hallazgo ≥ medium se registra según `prompts/finding-record` —
  `source` nombra este informe, esquema según
  `references/backlog-format`, deduplicado primero.
- La nueva deuda aceptada para corregir hallazgos sigue sujeta al
  balance de deuda declarado del proyecto; un hallazgo es un registro,
  no deuda silenciosa.

## Señales de alarma

- Puntuaciones estilísticas sustituyendo riesgo demostrado.
- Hipótesis reportadas como defectos confirmados; comprobaciones no
  disponibles reportadas como ejecutadas.
- Correcciones implementadas dentro de este comando — la corrección es
  una tarea separada, explícitamente solicitada.
- Confusión de solapamiento: `verify-work` ejecuta puertas mecánicas,
  `analyze-structure` mapea estructura/impacto, `simplify-code` aplica
  reducciones — este comando revisa, no los sustituye.

## Entrega

Detente tras reportar. Los hallazgos se convierten en elementos del
backlog; la implementación pasa por `implement-task`.
