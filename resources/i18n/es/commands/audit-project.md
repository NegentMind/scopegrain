---
name: audit-project
description: Evalúa una superficie de proyecto acordada y reporta riesgos basados en evidencia.
---
# Auditar un proyecto

Router sobre `unified-review` (modo full) — carga esa skill y ejecuta su
pipeline completo; este archivo posee el acuerdo de ámbito y el contrato
de salida. Una pasada más pesada y profunda que `verify-work`:
superficies completas con hallazgos priorizados, no solo el diff
cambiado.

El pipeline de auditoría por fases — fases, oleadas, entregables por
fase, manejo de vetos y el formato del informe — vive en
`prompts/review-request` §Audit pipeline. Carga `review-deep` y
`security-and-hardening` para las fases de revisión de módulos y de
seguridad. Los hallazgos se registran según `prompts/finding-record`.
Reglas rectoras: `rules/safety`, `rules/evidence`.

## Paso 1 — Acordar el ámbito

- Acuerda con el propietario: superficies (módulos, crates, paquetes,
  servicios), categorías de riesgo relevantes, entornos, comprobaciones
  permitidas y el destino del informe. Ámbito por defecto: todo el
  proyecto.
- Confirma qué comandos de verificación registrados pueden ejecutarse y
  qué superficies son solo de inspección. Si la ejecución está
  reservada al propietario, propón comandos exactos y registra la salida
  real.
- Lee `references/quality-floor` y `references/security-checklist`
  antes de evaluar; el suelo de calidad no se debilita para que una
  ejecución pase.

## Paso 2 — Ejecutar el pipeline completo

Ejecuta las fases del pipeline según `prompts/review-request` §Audit
pipeline — el conjunto de fases, la agrupación en oleadas y la forma de
los hallazgos por fase vienen de ahí. Superficies típicas:

1. Puertas mecánicas — las comprobaciones de formato/lint/type/test/
   política registradas del proyecto (`references/test-suite`; nunca
   hardcodees una pila).
2. Inspección de límites y dependencias — puntos de entrada, dirección
   de capas, contratos externos (`references/architecture`, `architect`
   delegado).
3. Superficie de seguridad — fronteras de confianza, manejo de
   secretos, bloques unsafe/FFI, política de dependencias
   (`security-and-hardening`, `security-auditor` delegado).
4. Adecuación de tests — cobertura de regresión ausente para riesgos
   nombrados.
5. Deriva de la documentación — comportamiento público frente a
   comportamiento documentado.

Muestrea explícitamente cuando la inspección exhaustiva sea inviable;
nombra cada omisión.

## Paso 3 — Clasificar los hallazgos

Separa defectos reproducidos, hallazgos estáticos, hipótesis y evidencia
no disponible. Para cada problema indica ubicación, prerrequisitos,
impacto y una comprobación discriminante o caso de regresión. Usa FMEA
cualitativo salvo que las probabilidades y la puntuación hayan sido
justificadas y aprobadas de forma independiente.

## Autoridad y verificación

Solo lectura sobre el producto: la auditoría no modifica código, no
instala escáneres, no escanea sistemas externos ni publica detalles de
seguridad. Cada afirmación lleva evidencia; una comprobación no
disponible se reporta como no disponible, no como superada. Las fases
delegadas solo se ejecutan a través de capacidades autorizadas
realmente disponibles — `SUBAGENT_ERROR` se registra, no se oculta.

## Contrato de salida (obligatorio)

1. **Informe:** `<reports path>/audit-full-<YYYYMMDD>-<HHMMSS>.md` con
   un marcador por fase, hallazgos priorizados (Critical/Important/
   Suggestion, archivo:línea + corrección), un resumen de
   fortalezas/debilidades y el veredicto.
2. **Estado:** un registro de última auditoría en la ruta de estado
   configurada:
   `{timestamp, mode: full, verdict, findings_critical, report_file}`.
3. **Índice:** una fila en el índice de informes; marca las auditorías
   anteriores superadas.
4. **Backlog:** cada hallazgo ≥ medium se registra según
   `prompts/finding-record` — `source` nombra este informe, esquema
   según `references/backlog-format`, deduplicado contra elementos
   existentes.

## Mensaje final

- `AUDIT PASSED (full)` + resumen de hallazgos, o
- `AUDIT FAILED — fix the findings above before shipping.`

## Señales de alarma

- Una fase omitida silenciosamente o su veto anulado en lugar de
  registrado.
- Hipótesis puntuadas como defectos reproducidos; puntuaciones de
  calidad inventadas.
- El suelo de calidad debilitado para que una ejecución pase.
- Correcciones aplicadas dentro de la auditoría — el lead registra el
  informe en el espacio de trabajo aprobado del harness; las
  correcciones son tareas separadas.

## Entrega

Los hallazgos fluyen a `implement-task` a través del backlog; el triaje
masivo pasa por `plan-work`; la evaluación de preparación de release es
`assess-release`.
