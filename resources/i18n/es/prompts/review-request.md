---
name: review-request
description: Proveer a un revisor independiente el contrato y la evidencia real, y orquestar auditorías por fases.
---
# Review Request

Dos usos: (a) briefear a un revisor independiente sobre un cambio acotado;
(b) ejecutar un pipeline de auditoría por fases sobre una superficie de
proyecto acordada. Cargado cuando un comando u orquestador briefea a un
revisor (`review-change`, `implement-task`, `simplify-code`) o ejecuta una
auditoría por fases (`audit-project`, modos de `verify-work`). Ambos
devuelven hallazgos ordenados por severidad con ubicaciones; ninguno edita
el cambio bajo revisión ni fabrica un recibo de aprobado.

## Slots requeridos (revisión de cambio)

Slots requeridos: comportamiento y alcance aprobados; ubicación del diff
completo; límites/callers cambiados; tests exactos y logs crudos; lagunas
conocidas; hallazgos previos ya resueltos; independencia del revisor y
herramientas permitidas.

Solicitar defectos confirmados, regresiones, riesgos de
seguridad/compatibilidad y cobertura de aceptación faltante, ordenados por
severidad con ubicaciones. Exigir separación de evidencia, hipótesis y
comprobaciones no disponibles. No dar al autor un segundo nombre de rol y
llamar a eso revisión independiente. Los revisores de solo lectura devuelven
hallazgos; el lead persiste los reportes. La aprobación o renuncia debe
seguir a una revisión real, nunca a un recibo inventado. El vocabulario de
veredicto sigue `policy/workflow.json`:
`approve | reject | changes-requested` — solo `approve` satisface la puerta
de aceptación.

## Pipeline de auditoría (revisión por fases de una superficie)

Ejecutar UN modo cada vez; el modo selecciona las fases. Cada fase de
revisión puede correr en un contexto delegado fresco que devuelve hallazgos
estructurados — delegar solo a través de una capacidad de host autorizada
realmente disponible; si no, correr las fases secuencialmente en sesión.

| Modo | Fases | Uso |
|---|---|---|
| quick | 1 | solo comprobaciones mecánicas |
| certify | 0→1→2→3→4→8 | puerta pre-merge/pre-push |
| review | 0→4→5→6→7 | revisión profunda sin comprobaciones CLI |
| full | 0→1→2→3→4→5→6→7→8 | pipeline completo |

### Fase 0 — Pre-check (directa)

Inspeccionar el árbol de trabajo (`git diff --name-only`, `git status`). Sin
cambios → sugerir el modo full. Cambios unstaged → continuar. Cambios staged
→ sugerir certify. Registrar `{hasChanges, staged, unstaged, branch}`.

### Fase 1 — Comprobaciones mecánicas (directa)

Ejecutar la suite de comprobaciones declarada del proyecto para el modo —
bajo verificación manual, proponer los comandos exactos y los directorios de
trabajo; el propietario ejecuta y devuelve salida; registrar resultados
reales, nunca autorreportar. Capturar salidas y contar fallos.

**Si el formateador o la suite de tests falla → ABORTAR.** No proceder a la
Fase 2. Registrar `{passed, failed, results per check}`.

### Fase 2 — Revisión de seguridad (delegada o en sesión)

Skill `security-and-hardening`. Entrada: salida de auditoría de dependencias
de la Fase 1 más la política de amenazas/advisories declarada del proyecto.
Revisar validación de entrada, rutas unsafe/panic en superficies públicas,
límites de confianza, exposición de secretos. Entregable: hallazgos
`[{file, line, severity, description, recommendation}]`. Una fase puede
VETAR con razón — registrar el veto; no aborta el pipeline (solo la Fase 1
aborta).

### Fase 3 — Revisión de rendimiento

Skill `performance-optimization`. Entrada: salida de tamaño/perfil de la
Fase 1. Revisar rutas críticas declaradas, asignación/clonación innecesaria,
variantes grandes. Misma forma de hallazgos; puede VETAR con razón.

### Fase 4 — Revisión de código

Skills `code-review-and-quality` más `code-simplification`
(sobre-ingeniería: violaciones YAGNI, abstracciones innecesarias, stdlib
reimplementada). Entrada: el diff del cambio o commits recientes. Ejes:
corrección, seguridad, rendimiento, mantenibilidad, coherencia. Cada
capacidad puede VETAR independientemente.

### Fase 5 — Análisis de causa raíz (condicional)

Solo si las Fases 1-4 produjeron fallos. Skill `systematic-debugging`. Por
cada fallo: identificar causa raíz (no síntoma), proponer una corrección
específica con file:line, estimar esfuerzo. Entregable:
`[{failure, rootCause, fix, estimatedEffort}]`.

### Fase 6 — Revisión profunda de módulo (solo review/full)

Skill `review-deep`. Iterar por módulo acordado: investigación estructural,
comparación contra alternativas, puntuación 0-10 con evidencia. Entregable:
`[{module, score, issues, recommendations}]`.

### Fase 7 — Revisión de modelo de calidad (solo full)

Skill `unified-review`. Aplicar el modelo de calidad acordado (p. ej., ISO
25010: adecuación funcional, fiabilidad, usabilidad, eficiencia,
mantenibilidad, portabilidad). Cruzar todos los hallazgos previos; puntuar
cada dimensión con evidencia — nunca puntuaciones inventadas.

### Fase 8 — Puerta de certificación (solo certify/full)

Ejecutar la suite de certificación pesada declarada del proyecto (proponer
comandos; el propietario ejecuta bajo verificación manual), luego
recomprobar con `unified-review` en postura certify: todos los hallazgos de
fases previas resueltos o dispensados, sin problema bloqueante abierto.
Devolver PASS/FAIL con evidencia.

## Olas paralelas

- Ola 1: Fase 0 + Fase 1 (las comprobaciones mecánicas gobiernan el resto)
- Ola 2: Fase 2 + 3 + 4 (mutuamente independientes)
- Ola 3: Fase 5 (depende de fallos de la Ola 2)
- Ola 4: Fase 6 + 7 (independientes entre sí)
- Ola 5: Fase 8

## Reporte

Escribir el reporte bajo la ruta de reportes configurada
(`.scopegrain/reports`), con timestamp ISO-8601, cubriendo TODAS las fases
sin importar pass/fail:

```markdown
# Audit Report: <mode>
**Date:** <timestamp>  **Mode:** <mode>  **Duration:** <elapsed>

## Summary
- Phases completed: X/Y · Blocking issues: N · Recommendations: N
- Verdict: PASS / FAIL

## Per-phase results
| Phase | Status | Wave | Details |
| 0..8  | pass/fail/skipped/subagent-error | direct/delegated | N findings |

## Findings by phase
- `file:line` — defect (severity)

## Scoreboard (only when a quality model ran)
| Category | Score (0-10) | Evidence |

## Recommendations (prioritized)
1. (severity) `file:line` — action
```

## Post-reporte

- review/full: registrar hallazgos sin resolver como finding records por
  `finding-record` — en el momento del descubrimiento, no diferido a notas.
- certify: todas las fases pasan → "CERTIFY PASSED — safe to push" (el push
  en sí sigue requiriendo autorización explícita del propietario);
  cualquier fallo → "CERTIFY FAILED".
- Terminar con la skill `session-handoff` para el registro de estado.

## Reglas

- **Fallo de Fase 1 = STOP.** Nunca proceder con formateador/suite de tests
  en rojo.
- **Límites de delegado:** llamadas de herramienta acotadas y un timeout
  declarado por contexto delegado (por `policy/operation-limits.json` o los
  presupuestos del runtime). Un delegado con timeout/error se registra como
  `SUBAGENT_ERROR`; continuar las fases restantes.
- **Los vetos se registran**, no se anulan silenciosamente.
- **Hallazgos ≠ correcciones:** este pipeline reporta; las correcciones son
  tareas aparte.
- **Sin evidencia inventada:** una comprobación no ejecutada se reporta como
  no disponible, no como pasada.
