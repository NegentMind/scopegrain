---
name: analyze-structure
description: Analiza el impacto estructural con la evidencia disponible del grafo y del código fuente.
---
# Analizar la estructura

Auditoría estructural/semántica: arquitectura, acoplamiento, código muerto,
complejidad, impacto de cambios, API pública, fronteras unsafe/FFI, deriva
de la documentación. Solo lectura — los hallazgos se corrigen mediante
elementos del backlog e `implement-task`. Carga `context-engineering` para
el presupuesto de contexto en barridos de todo el espacio de trabajo.
Reglas rectoras: `rules/evidence`, `rules/api-contract`.

Argumento de ámbito (opcional): un nombre de módulo/crate, un directorio o
nada = todo el espacio de trabajo. Pasa el ámbito a cada consulta de abajo.

Este comando complementa, nunca sustituye: `verify-work` (puerta
mecánica), `audit-web-performance` (rendimiento web) y `architect`
(decisiones de diseño). Un flag estilo `--apply` no hace nada: la
aplicación es una tarea separada.

## Fase 0 — Comprobación de sanidad (antes de auditar)

1. Define la pregunta e inspecciona la disponibilidad real de herramientas
   de grafo, el ámbito y la frescura del índice
   (`references/graph-investigation`). No reindexar ni instalar nada sin
   permiso aparte — declara la garantía más débil y recurre a búsqueda en
   el código fuente + inspección de llamadores.
2. Confirma la cobertura del ámbito objetivo; donde el índice informe de
   archivos parciales u omitidos, busca en esos archivos directamente
   antes de afirmar una ausencia.
3. Captura el diff de trabajo para la fase de impacto; si está vacío, usa
   el diff del último commit como ámbito e indícalo.

## Fases de auditoría (ejecutar en orden; registrar archivo:línea + evidencia por hallazgo)

| # | Fase | Método | Acción típica |
|---|-------|--------|----------------|
| 1 | Arquitectura y capas | Mapear clústeres de módulos de facto frente a límites declarados (`references/architecture`); detectar ciclos; leer el código de clústeres sospechosos | FIX / REFACTOR |
| 2 | Acoplamiento entre módulos | Aristas de dependencia entre módulos; módulos-dios con exceso de aristas entrantes; dependencias reales frente a transitivas | REFACTOR / INVESTIGATE |
| 3 | Código muerto / huérfanos | Símbolos sin aristas entrantes; confirmar que no son API pública, exclusivos de tests o registrados dinámicamente antes de señalarlos | REFACTOR / INVESTIGATE |
| 4 | Duplicación semántica | Implementaciones conceptualmente idénticas en distintos dominios; comparar firmas | REFACTOR / INVESTIGATE |
| 5 | Puntos calientes de complejidad | Bucles anidados profundos, búsquedas dentro de bucles, asignaciones dentro de bucles, recursión sin salvaguarda, alta complejidad ciclomática | OPTIMIZE (requiere un benchmark antes de afirmar mejoras) / REFACTOR |
| 6 | API pública / superficie de ruptura | Superficie exportada por módulo; llamadores externos incl. consumidores de bindings/FFI; contrastar con la puerta de compatibilidad de API registrada del proyecto | MODIFY / FIX / INVESTIGATE |
| 7 | Radio de impacto del cambio | Qué toca el diff capturado: llamadores entrantes de los símbolos cambiados; leer el código impactado | INVESTIGATE / FIX |
| 8 | Fronteras unsafe / FFI | Bloques unsafe, exportaciones/importaciones FFI (donde la pila los tiene); cada una necesita un invariante de seguridad documentado y su test registrado | FIX / INVESTIGATE |
| 9 | Fragilidad | Patrones de fallo sin salvaguarda tipo panic/unwrap/todo; comprobar recuperabilidad y contexto de logging | FIX / MODIFY |
| 10 | Huecos de cobertura de tests | Símbolos de producción nunca referenciados por tests | MODIFY / INVESTIGATE |
| 11 | Deriva de la documentación | API/comportamiento documentado frente a firmas y comportamiento actuales | MODIFY |
| 12 | Registros de decisiones | Decisiones de arquitectura registradas frente a la arquitectura realmente presente; proponer ADR para los huecos | INVESTIGATE |

Reglas por hallazgo: un llamador estático ausente **no** es prueba de
código muerto (registro dinámico, código generado, consumidores
externos). Distingue el riesgo semántico de la preferencia de estilo. No
inventes símbolos de grafo, estadísticas de índice ni herramientas.

## Fase final — Consolidar e informar (contrato de salida)

1. **Clasifica cada hallazgo** en una de cinco acciones:
   - **FIX** — bugs, contratos rotos, código unsafe sin un invariante de
     seguridad.
   - **MODIFY** — superficie de API, docs, config, tests ausentes.
   - **OPTIMIZE** — puntos calientes (la ejecución requiere primero un
     benchmark reproducible).
   - **REFACTOR** — duplicación, código muerto, acoplamiento indebido.
   - **INVESTIGATE** — riesgos, semántica por confirmar, ADR pendientes.
2. **Severidad:** Critical / High / Medium / Low según impacto + alcance.
3. **Informe:** `<reports path>/structure-<YYYYMMDD>-<HHMMSS>.md` —
   resumen ejecutivo (conteos por categoría + severidad), hallazgos por
   fase con archivo:línea y evidencia (herramienta + consulta usada), y
   una tabla consolidada
   `| ID | Title | Action | Severity | Location | Recommendation |`.
4. **Backlog:** cada hallazgo ≥ Medium se registra según
   `prompts/finding-record` — `source` nombra este informe, esquema según
   `references/backlog-format`, deduplicado primero.
5. **Índice:** una fila en el índice de informes.
6. **Mensaje final:** conteos por categoría, ruta del informe y
   «Ejecuta `plan-work` para hacer el triaje de los nuevos hallazgos.»

## Autoridad y verificación

Solo auditoría: nada de reindexación, instalación, borrado o
refactorización dentro de este comando — cada uno necesita su propio
permiso aplicable. Los hallazgos citan la herramienta y la consulta que
los produjo; un índice ausente significa una garantía más débil
declarada, no una falsa afirmación de ausencia.

## Señales de alarma

- Código muerto declarado sin comprobar el registro dinámico, el código
  generado y los consumidores externos.
- Una fase omitida silenciosamente en lugar de reportada como no
  ejecutada.
- Símbolos de grafo, estadísticas de índice o herramientas inventadas.
- Un flag `--apply` aceptado — la aplicación es una tarea separada.

## Entrega

Los hallazgos registrados fluyen a `plan-work` para su triaje; las
correcciones individuales pasan por `implement-task`.
