---
name: report-status
description: Reporta el progreso real, los huecos de verificación y la siguiente decisión.
---
# Reportar el estado

Panel de solo lectura de como máximo ~30 líneas. Si un archivo o
sección de estado está ausente, omítelo — degradación elegante, sin
salida de errores. Carga `session-handoff` solo si el paquete de inicio
de sesión no se ejecutó ya. Carga `context-engineering` para el
presupuesto de ~30 líneas; ejecútalo como `lead`. Regla rectora:
`rules/evidence`.

Los registros de continuación y checkpoint siguen
`prompts/session-recitation`; las elecciones guiadas de siguiente
acción usan `prompts/decision-request`.

## 1. Estado del repositorio

- Cambios sin commitear, commits recientes y rama actual vía las
  herramientas git del host (`git status --short`,
  `git log --oneline -5`, `git branch --show-current` donde un shell
  esté autorizado).

## 2. Trabajo activo

- Sesiones reanudables y estado de checkpoint en la ruta de estado
  configurada (formato de continuación `session-recitation`); si hay
  una tarea en curso registrada, nómbrala junto con el punto de
  reanudación.
- Plan más reciente bajo la ruta de planes configurada: conteos por
  estado (closed / active / ready / blocked / failed) y la siguiente
  tarea lista.
- Registros de tareas bajo la ruta de tareas configurada (semántica de
  `references/task-domain`): separa trabajo completado, activo,
  bloqueado, fallido, no ejecutado y desconocido. No infieras
  ejecución, publicación o ciclo de vida de pull-request a partir de un
  resumen en prosa.

## 3. Última verificación

- El estado de última verificación registrado o el informe más reciente
  bajo la ruta de informes configurada: modo, fecha, veredicto y
  hallazgos críticos abiertos.
- Un subconjunto que pasa no es una suite completa que pasa; un comando
  propuesto no es una comprobación ejecutada.

## 4. Última evaluación de release

- Estado ship registrado o informe ship más reciente: GO/NO-GO,
  revisión evaluada, si existe un plan de rollback y dónde reside.

## 5. Cobertura de especificación

- Si existe una especificación resuelta para el trabajo sustancial en
  curso; si no, anota `specify-change`.

## 6. Siguiente paso recomendado

Una línea, basada en evidencia:

| Situación | Recomendar |
|---|---|
| Cambios sin commitear | `implement-task` o commitea la unidad registrada |
| Plan con tareas listas | `coordinate-plan` |
| Última verificación fallida | `verify-work`, luego `review-change` |
| Todo en verde, falta la spec | `specify-change` |
| GO sin plan de rollback | prepara la evidencia de recuperación antes de continuar |
| NO-GO sin resolver | lee el informe ship antes de nuevo trabajo |

## Interacción guiada

Cuando se invoca interactivamente (sin contexto de tarea), explica la
etapa actual, aflora prioridades en conflicto y pregunta qué acción
consecuente quiere el propietario (formato `prompts/decision-request` —
opciones concretas, recomendación primero). No la elijas ni la ejecutes
implícitamente.

## Autoridad y verificación

Puramente consultivo y de solo lectura: reporta, no actúes. Las
afirmaciones de estado vienen de registros, no de inferencia — un
resumen en prosa no es una comprobación ejecutada, una publicación o
una pull request fusionada.

## Contrato de salida

- Un panel de como máximo ~30 líneas devuelto al propietario.
- Cualquier copia guardada es un artefacto explícito del harness bajo
  la ruta de informes configurada.

## Señales de alarma

- Emitir errores por archivos de estado ausentes — omite la sección en
  su lugar.
- Exceder ~30 líneas; esto es una ojeada, no una auditoría.
- Tratar un subconjunto que pasa, un comando propuesto o una afirmación
  en prosa como una suite que pasa.

## Entrega

Comando terminal — el panel nombra la siguiente puerta; nunca la
ejecuta.
