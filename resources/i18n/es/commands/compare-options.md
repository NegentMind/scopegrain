---
name: compare-options
description: Compara evidencia existente y recomienda una decisión explícita del propietario.
---
# Comparar opciones

Sala de decisiones global sobre la investigación completada — el paso
de síntesis tras las ejecuciones de `investigate` por área. Carga
`source-driven-development`, `discernment-nudge`,
`outcome-driven-development`, `doubt-driven-development`,
`resolve-ambiguity` según necesidad. Las decisiones usan
`prompts/decision-request`; la mecánica de rondas y la materialización
siguen `prompts/research-brief` §C. Reglas rectoras: `rules/evidence`,
`rules/human-decisions`. Roles: `researcher` consolida, `lead`
materializa decisiones.

## Paso 1 — Reunir evidencia

- Lee cada informe de investigación bajo la ruta de investigación
  configurada más las restricciones reales de la decisión (presupuesto,
  compatibilidad, plazos, preferencias registradas del propietario).
- Preserva las mediciones y entradas congeladas; no reejecutes
  derivaciones solo para formatear o clasificar sus resultados.
  Investiga un hueco genuinamente nuevo como una acción `investigate`
  separada, no dentro de la síntesis.
- Recopila los apéndices de hallazgos H-NN de todos los informes;
  fusiona duplicados y hallazgos entre áreas en una lista canónica con
  sus orígenes (semántica de áreas: `references/research-modules`).

## Paso 2 — Comparar

Compara las alternativas viables en: modos de fallo, reversibilidad,
coste de mantenimiento, privacidad, permisos requeridos y entornos
soportados. Declara las suposiciones inciertas y nombra la evidencia que
podría cambiar la recomendación. No inventes puntuaciones, costes,
autorización de licencias ni superioridad.

## Paso 3 — Decidir (HITL)

La mecánica de rondas — la tabla maestra consolidada, las rondas de
preguntas temáticas, la preselección de >25 elementos y la regla de
corte — sigue `research-brief` §C.

- Presenta la recomendación con las consecuencias completas y pide al
  propietario que decida dondequiera que se requiera autoridad o
  intención de producto — una ronda de decisión por tema, opciones
  concretas, recomendación primero.
- Registra cada decisión vinculada a las entradas revisadas (identidad
  del informe + ids de hallazgos) en la ruta de decisiones configurada;
  una recomendación por sí sola no autoriza la ejecución.
- Materializa las decisiones exactamente como el flujo por área:
  acciones aprobadas → elementos del backlog con `source` nombrando
  esta síntesis; descartadas → registro wontfix; quick wins → un plan
  bajo la ruta de planes; estrategia → registro de decisión + ADR
  sugerido (`documentation-and-adrs`).
- Ningún hallazgo puede quedar sin destino; barre los restantes en una
  pregunta final o en un valor por defecto explícito registrado.
- Registra un evento de journal (`compare-options.completed`) con los
  conteos de decisiones.

## Autoridad y verificación

La síntesis es de solo lectura: produce decisiones del propietario
registradas y destinos materializados — no ejecuta nada. Las entradas
congeladas permanecen congeladas; una recomendación está vinculada a
evidencia y nunca se ejecuta silenciosamente.

## Contrato de salida

- Registros de decisión por tema en la ruta de decisiones configurada,
  cada uno vinculado a las entradas revisadas.
- Destinos materializados: elementos del backlog, registros wontfix, un
  plan de quick wins o sugerencias de ADR.
- Evento de journal con los conteos de decisiones.

## Señales de alarma

- Puntuaciones, costes o autorización de licencias inventados para
  clasificar opciones.
- Nueva investigación colada en la síntesis — abre una ejecución
  `investigate` separada.
- Hallazgos sin destino tras las rondas.
- Ejecución iniciada sobre una recomendación que el propietario nunca
  confirmó.

## Entrega

Reporta las decisiones por tema, sus destinos y la siguiente puerta:
`coordinate-plan` para el trabajo aprobado, `implement-task` para un
elemento único, o `assess-release` cuando la decisión condiciona una
release.
