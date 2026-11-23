---
name: session-handoff
description: Usar en los límites de sesión y al completar tareas para reportar progreso respaldado por evidencia y el trabajo siguiente
---
# Handoff de sesión

Lee los registros de tarea y plan actuales en lugar de confiar en la
conversación. Reporta trabajo completado, trabajo activo, bloqueos y la
siguiente acción segura. Identifica comprobaciones ejecutadas vs pendientes
y cualquier supuesto cambiado. Preserva el trabajo parcial útil y menciona
los cambios no relacionados. Destila los aprendizajes duraderos en el log de
lecciones (`memory add --log lessons`) para que la siguiente sesión los
herede, y anota cualquier cambio de afirmación o disposición a nivel de
tarea mediante los meta verbos, no en prosa. Guarda un handoff conciso en el
workspace configurado del harness. No inventes porcentajes de completado ni
avances estados de tarea en silencio.

El progreso se rastrea en dos lugares que nunca deben discrepar: el registro
de trabajo activo del proyecto (registros de backlog/plan/tarea) y el
registro de trabajo completado bajo `.scopegrain/` (worklog/state,
`reports/`, `decisions/`, `memory/`). **Invariante:** ningún ítem existe en
ambos registros a la vez, y ningún ítem se descarta silenciosamente: la
eliminación sin completado se archiva con su razón.

Esta skill es dueña del *registro escrito*: registros, entradas de worklog y
el formato de handoff siguiente. Recurar el contexto cargado en sí —qué
recargar, qué revalidar— pertenece a `context-engineering`.

## Disparador 1 — Una tarea se completa

Se ejecuta cuando una tarea alcanza su estado de hecho en esta sesión, en
este orden:

### A. Análisis de impacto en docs

Para cada archivo modificado, verifica que la documentación correspondiente
esté actualizada. Mantén el mapeo archivo→doc del proyecto; si un archivo
tocado no tiene doc mapeada, anota la brecha en lugar de adivinar una.

### B. Extraer datos de la tarea

ID, nombre, fecha, objetivo, archivos modificados, resultado, sha(s) de commit.

### C. Actualizar el registro activo

- Marca o elimina la fila completada en el registro de backlog/plan según la
  convención del proyecto: sin acumular filas tachadas.
- Actualiza el rastreador de estado y la recitación del plan.
- Un ítem eliminado *sin* completar va al registro de archivo del proyecto
  con su razón: nunca descartado en silencio.

### D. Registrar el completado

1. Enruta la entrada al archivo de dominio que el proyecto usa para trabajo
   completado (por subsistema/dominio: engine, bindings, frontend, ci-cd,
   ops, security/audit, decisions, research, process changes).
2. Comprueba que el ID no esté ya registrado: actualiza, no dupliques.
3. Registra: `### <ID>: Description` + fecha, objetivo de una línea,
   resultado, sha de commit.
4. Hito significativo → anótalo en el registro de proceso/meta.
5. Resultado de investigación o descubrimiento → enrútalo al registro de
   research.
6. Solo los cambios visibles al usuario (funcionalidades, breaking changes,
   arreglos públicos, superficie CLI) reciben una entrada de changelog: no
   cada tarea.

### D2. Archivar planes completados

Cuando las tareas de un plan están todas hechas o abortadas:

1. Ejecuta una retrospectiva corta (start/stop/continue + una acción
   medible); si un paso anterior ya la produjo, cópiala hacia adelante.
2. Mueve el archivo de plan **y sus archivos de estado sidecar**
   (presupuesto, estado de sesión) al archivo de planes: mover el plan sin
   sus sidecars corrompe el registro histórico.
3. Verifica que no queden archivos sidecar huérfanos en el directorio de
   planes activos.
4. Añade una nota de archivo (fecha, N/M completados, resultado de la
   retrospectiva) al registro de proceso.

### E. Validar cobertura

Ejecuta las comprobaciones de cobertura de docs / registro del proyecto si
existen; reporta el resultado en lugar de afirmarlo. El listón permanente
que una tarea completada aún debe satisfacer es
`resources/references/definition-of-done.md`.

### F. Reportar

Declara qué se actualizó: registro activo, archivo de plan, registro de
trabajo completado, changelog (si aplica), resultado de validación. Política
de commits: independiente → sin commit sin instrucción; dentro de una
ejecución orquestada → el orquestador posee los commits. Una decisión
significativa se registra en el log de decisions, no se deja en prosa.

## Disparador 2 — Empezar una tarea

1. Busca en el registro de trabajo completado arte previo sobre este ID o
   tema: nunca rehagas trabajo registrado.
2. Localiza la tarea en el registro activo; un ítem previamente descartado
   que se reanuda vuelve a pendiente explícitamente.
3. Procede. Si reanudas tras una interrupción, revalida el estado registrado
   contra el repositorio según `context-engineering` antes de actuar sobre él.

## Disparador 3 — Mantenimiento periódico

1. Registro: los ítems inactivos más allá del umbral del proyecto se mueven
   al icebox o se descartan (los descartes se archivan con razón).
2. Registro de trabajo completado: deduplica entradas, repara referencias
   cruzadas obsoletas.
3. Comprobación cruzada del invariante: nada está en ambos registros a la vez.

## Disparador 4 — Sincronizar informes de revisión

Los nuevos informes de revisión/auditoría reciben una fila en el índice de
informes (`.scopegrain/reports/`); los hallazgos en o por encima de la
severidad acordada derivan al registro activo como filas de hallazgos con su
origen registrado. Nunca silencies un informe más nuevo que su fila de índice.

## Disparador 5 — Postmortem

Ante señales de fallo (una tarea abandonada, el mismo error dos veces, un
incidente, un estancamiento más allá del apetito, un arreglo que toma 3+
intentos), escribe un postmortem corto y persístelo:

```
memory add --log lessons
entry: "YYYY-MM-DD | POSTMORTEM <ID> | <context> | <lesson> | <action>"
```

Sin persistencia no hay cierre: una lección no persistida se reaprenderá a
precio completo.

## Disparador 6 — Reconciliación de memoria

Reconcilia la memoria del lado del agente (logs `lessons`, `decisions`)
contra los registros del proyecto: las entradas que afirman trabajo que el
proyecto no registra son divergencias: sácalas a la luz como hallazgos o
notas pendientes. Nunca descartes silenciosamente una entrada de memoria
cuya tarea referenciada no existe en el proyecto.

## Formato de handoff

Al final de la sesión o en un límite de tarea, registra en el workspace
configurado:

```
COMPLETED:    <units done, with commit shas / evidence paths>
ACTIVE:       <unit in flight, current state, next safe action>
BLOCKERS:     <what blocks, what unblocks>
CHECKS:       <executed (with outcome) vs pending>
CHANGES:      <files touched; unrelated foreign changes left alone>
ASSUMPTIONS:  <anything that changed or remains unverified>
```

## Límites

- Reporta solo comprobaciones ejecutadas: nunca declares una comprobación
  que no se ejecutó.
- No inventes porcentajes de completado ni avances estados de tarea en
  silencio; los cambios de estado pasan por los meta verbos/comandos del
  proyecto.
- Destila aprendizajes duraderos en el log de lecciones; afirmaciones y
  disposiciones a nivel de tarea en los registros apropiados: no en prosa.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "La conversación ya dice qué pasó" | La memoria de la conversación es el registro menos fiable; los registros son evidencia. |
| "Registraré la tarea después" | Los completados sin registrar se rehacen o se pierden; registra antes de resumir. |
| "Las filas tachadas muestran historial" | El tachado acumula ruido y rompe el invariante del registro: los completados se mueven al registro de trabajo completado. |
| "La lección es obvia, no hace falta persistirla" | Una lección no persistida se reaprende a precio completo en la siguiente sesión. |
| "La comprobación probablemente pasa" | Reporta comprobaciones ejecutadas con resultados; una comprobación pendiente queda pendiente. |

## Señales de alerta

- La misma tarea registrada tanto en el registro activo como en el de
  trabajo completado.
- Un handoff que reinicia desde la memoria de la conversación en lugar de
  los registros.
- Un resumen de completado sin sha de commit ni ruta de evidencia.
- Un ítem eliminado del registro activo sin registro de archivo ni razón.
- Un informe más nuevo que su fila de índice: deriva silenciosa en el índice
  de informes.
- Archivos sidecar huérfanos tras mover un plan al archivo.
- Entradas de memoria que afirman trabajo que el proyecto nunca registró,
  dejadas sin reconciliar.

## Verificación

- [ ] El trabajo completado salió del registro activo al registro de
      completados: nunca en ambos, nunca descartado.
- [ ] La entrada lleva fecha, objetivo, resultado y sha de commit donde aplique.
- [ ] Las comprobaciones ejecutadas se reportan con resultados; las
      pendientes quedan pendientes.
- [ ] Los cambios ajenos/no relacionados se reportan, no se absorben.
- [ ] El registro de handoff se guardó en el workspace configurado con los
      seis campos (COMPLETED/ACTIVE/BLOCKERS/CHECKS/CHANGES/ASSUMPTIONS).
- [ ] Los aprendizajes que valen la pena llegaron al log de lecciones vía
      `memory add`.
