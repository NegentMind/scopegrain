---
name: plan-recovery
description: Prepara un plan de recuperación a partir del estado observado sin aplicarlo.
---
# Planificar la recuperación

Carga `shipping-and-launch` (sección de rollback) y
`debugging-and-error-recovery` con `references/ship-runbook`;
estructura el contexto de reanudación con `prompts/recovery-brief` y
los registros de continuación con `prompts/session-recitation`. Este
comando solo prepara un plan — la ejecución, el borrado y el rollback
externo requieren autorización separada específica por acción. Las
confirmaciones del propietario para pasos de clase de permiso e
irreversibles usan `prompts/decision-request`. Reglas rectoras:
`rules/durability`, `rules/human-decisions`.

Prerrequisito: un registro ship previo de `assess-release` (fallback:
historial git y recibos de release en la ruta de estado).

## Paso 1 — Descubrir

- Identifica el incidente, el estado seguro deseado, los efectos
  realmente completados y los recibos/backups disponibles. Lee el
  estado ship registrado y el plan de rollback del informe ship — **el
  plan exacto registrado para ese envío prevalece sobre cualquier
  procedimiento genérico.** Una superficie de efectos amplia o incierta
  puede delegarse en solo lectura a `resilience-tester` bajo
  coordinación de `release-engineer`.
- No infieras el estado externo del progreso local: inspecciona qué
  datos, registros, despliegues o notificaciones una reversión del
  código fuente no desharía.

## Paso 2 — Precondiciones

- Confirma los prerrequisitos de cada paso y la clase de permiso que
  necesita (reversión local, acción de registro, operación de datos,
  servicio externo).
- Señala las operaciones irreversibles — pérdida de datos, migraciones
  destructivas, artefactos inmutables publicados: estas abortan con una
  advertencia salvo que el propietario confirme explícitamente esa
  operación específica (`prompts/decision-request`).
- Nunca borres un lock obsoleto ni restaures sobre contenido existente
  solo porque su antigüedad parezca sospechosa; reconcilia los efectos
  inciertos antes de reintentar.

## Paso 3 — Proponer el plan de reversión

Pasos acotados en orden seguro: cada uno con la acción exacta, el
efecto esperado, la comprobación de verificación y la condición de
aborto. Preserva backups de todo lo que se sobrescriba. Marca los pasos
que necesitan permiso explícito.

## Paso 4 — Finalizar el contrato

- Presenta los destinos exactos y las consecuencias para aprobación.
- Ante un fallo sin aprobación dentro de una ejecución posterior:
  detente inmediatamente y reporta hecho-vs-pendiente — nunca
  improvices más allá de un paso de reversión fallido.
- Registra el plan bajo la ruta de informes configurada
  (`<reports path>/rollback-<YYYYMMDD>-<HHMMSS>.md`) para que una
  ejecución autorizada posterior y `report-status` puedan recogerlo;
  registra el estado de continuación según
  `prompts/session-recitation`.

## Autoridad y verificación

Solo plan: ningún paso de reversión se ejecuta dentro de este comando.
Cada clase de permiso y cada efecto irreversible se nombra
explícitamente para decisión del propietario; el estado observado viene
de recibos y registros, nunca de inferencia.

## Contrato de salida

- Informe del plan de rollback:
  `rollback-<YYYYMMDD>-<HHMMSS>.md` bajo la ruta de informes
  configurada, con acción/efecto/verificación/aborto por paso.
- Registro de continuación que permite a una ejecución autorizada
  posterior reanudar sin rederivar el estado.

## Señales de alarma

- Un lock obsoleto borrado o contenido sobrescrito por sospecha de
  antigüedad.
- Un paso irreversible ejecutado sin esa confirmación específica.
- Recuperación improvisada más allá de un paso de reversión fallido —
  detente y reporta hecho-vs-pendiente.
- Progreso local tratado como prueba del estado externo.

## Entrega

Cierra entregando al propietario la siguiente puerta: ejecutar el plan
aprobado, o `report-status` para el panel posterior a la recuperación.
