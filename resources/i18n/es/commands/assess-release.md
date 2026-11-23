---
name: assess-release
description: Evalúa la preparación de una release sin publicar ni desplegar.
---
# Evaluar la preparación de la release

Carga `shipping-and-launch` y sigue `references/ship-runbook`. La
evaluación es de solo lectura: produce un GO/NO-GO más un plan de
rollback — nunca publica. Las confirmaciones del propietario y el
consentimiento renovado sobre entradas cambiadas usan
`prompts/decision-request`. Reglas rectoras:
`rules/release-ci`, `rules/licensing-and-provenance`.

## Comprobaciones previas

`verify-work` (quick o certify) debe haber pasado recientemente sobre el
candidato de release. Una verificación fallida o ausente implica por
defecto **NO-GO**.

## Fase A — Fan-out (recolección de evidencia)

Despacha tres evaluaciones de solo lectura en paralelo a través de la
capacidad de delegación disponible (un turno; degrada a secuencial si no
está disponible):

- `security-auditor` — superficie de seguridad, manejo de secretos,
  exposición de dependencias y licencias del artefacto de release.
- `resilience-tester` — modos de fallo, durabilidad, riesgo de migración
  y downgrade; lo que la release no puede deshacer.
- `performance-engineer` — evidencia de rendimiento frente a baselines
  registrados; las afirmaciones sin medición se marcan, no se aceptan.

Cada una devuelve hallazgos con evidencia — no un resumen narrativo.

## Fase B — Fusión

El lead (`release-engineer`) sintetiza los tres informes (la síntesis
vive en el contexto principal, no en una persona): deduplicar
bloqueantes, resolver contradicciones, marcar explícitamente los
elementos no verificados.

Comprueba los prerrequisitos de la release contra
`references/definition-of-done`:

- La evidencia de verificación cubre la revisión candidata — una
  publicación no ejecutada no puede marcarse como verificada.
- Existe revisión independiente para los riesgos nombrados o una
  exención explícita del propietario.
- Los prerrequisitos de compatibilidad y procedencia están evidenciados.
- Los prerrequisitos de configuración/secretos se confirman **sin
  revelar los valores secretos** — presencia y no vacuidad, nunca
  contenidos.
- Distingue la evidencia de autenticación (una comprobación de
  identidad) de la evidencia de alcance de publicación (una publicación
  real aceptada). Un test superado no es una release aprobada; una rama
  preparada no es una pull request fusionada.

## Fase C — Decidir

Devuelve **GO**, **NO-GO** o **blocked** con razones, pasos autorizados
restantes y un **plan de rollback obligatorio**: acciones exactas de
reversión, efectos irreversibles (datos, registros, despliegues que una
reversión del código fuente no desharía) y verificación tras el
rollback. Ejecutar un GO requiere una decisión explícita separada del
propietario (`decision-request`) — un veredicto GO es una evaluación, no
una autorización.

## Autoridad y verificación

Evaluación de solo lectura. No hagas push, no etiquetes, no publiques,
no despliegues, no envíes notificaciones ni cambies producción. La
delegación se ejecuta a través de capacidades autorizadas realmente
disponibles; cada prerrequisito cita evidencia inspeccionada, no
intención.

## Contrato de salida

- Informe: `<reports path>/ship-<YYYYMMDD>-<HHMMSS>.md` + fila en el
  índice.
- Estado: un registro last-ship en la ruta de estado configurada
  `{timestamp, verdict, revision, rollback_plan}` — requerido por
  `plan-recovery` y `report-status`.

## Señales de alarma

- GO sobre una ejecución de `verify-work` ausente o fallida.
- Contenidos de secretos expuestos en lugar de presencia/no vacuidad.
- Evidencia de autenticación presentada como evidencia de alcance de
  publicación.
- Un plan de rollback ausente — la decisión está incompleta sin él.

## Entrega

GO entrega al propietario la decisión de la release; la ejecución es una
acción aparte explícitamente autorizada. Una release fallida o
comprometida va a `plan-recovery`; el estado posterior a la decisión es
visible en `report-status`.
