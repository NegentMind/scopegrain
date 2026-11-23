# Organic y SDD

ODD significa **Organic Driven Development** en Scopegrain. Los resultados
observables son criterios de aceptacion, no otra definicion de ODD.
Observability-Driven Development es una capacidad distinta y optativa.

El runtime clasifica hechos declarados; no deduce automaticamente que el
agente comprendio el codigo ni que un propietario autentico autorizo el
cambio. La inspeccion de manifiestos tampoco demuestra comprension semantica.

## Estado de implementacion

La clasificacion, tareas/planes V2, configuracion, aprobaciones, evidencia y
gates ACT/ACCEPT estan implementados. Los bloques de evidencia y gates tienen
pruebas acotadas registradas en [verificacion](verification.md).
La suite integral local de foundation se completo con un archivo de test a
la vez; el alcance y las ejecuciones separadas figuran en
[verificacion](verification.md). El piloto nativo de Devin Local quedo
certificado en una sesion real el 2026-11-17 y el de Antigravity App/CLI
el 2026-11-19; Claude, Codex, OpenCode, la superficie IDE de Antigravity
y Hermes siguen sin piloto nativo. Esta guia no acredita
comportamiento dentro de un anfitrion no certificado.

## Modos

| Configuracion `methodology` | Comportamiento |
| --- | --- |
| `manual` | Compatibilidad V1; no impone una migracion de registros antiguos |
| `organic-sdd` | Registro ligero o cadena SDD segun los hechos declarados |
| `sdd` | Exige referencias formales para trabajo de cambio |

Una configuracion antigua sin el campo se normaliza a `manual` en memoria,
sin reescribir sus bytes. El onboarding interactivo nuevo propone
`organic-sdd` y pide confirmacion; no lo aplica silenciosamente.

Un registro V2 mantiene sus controles aunque se seleccione `manual`.
Cambiar un proyecto a un modo estricto no convierte sus tareas V1 en V2:
siguen siendo consultables, pero necesitan metadatos apropiados para pasar
los gates. No hay una actualizacion implicita del historial.

`intake.mode` es una configuracion aparte (`off` por defecto): controla
si el agente clasifica cada solicitud en un registro (capture, task o
plan) siguiendo el recurso `intake` del catalogo. No cambia la
metodologia ni relaja ningun gate.

## Clasificacion proporcional

La evaluacion usa intencion, autorizacion, comprension, incertidumbre,
riesgo y necesidad de continuidad. No usa el numero de lineas o archivos.

- Una pregunta o propuesta de solo lectura no autoriza ACT ni ACCEPT.
- Autorizacion ausente/rechazada, comprension insuficiente, incertidumbre
  pendiente o riesgo desconocido bloquean el cambio.
- Riesgos nombrados, continuidad que exige registro formal o eleccion
  explicita de SDD requieren la ruta formal.
- Trabajo acotado y comprendido puede usar la ruta ligera: una tarea con
  solicitud original, alcance, clasificacion, verificaciones y review.
  No necesita documentos formales ficticios.

MCP no registra ni reclasifica hechos; `scopegrain_methodology_check`
consulta gates sobre registros existentes y no autoriza herramientas.
El agente debe investigar y presentar las decisiones reales; no inventar
autorizacion ni reducir un riesgo para conseguir un resultado permitido.
La solicitud con secretos debe redactarse con aprobacion antes de guardarse.

## Cadena formal

1. Crear una especificacion estructurada con solicitud, resultado,
   requisitos, escenarios, alcance y preguntas pendientes.
2. Crear un design ligado al digest actual de esa especificacion.
3. Crear una tarea o plan con referencias reales y escenarios asignados.
4. Obtener aprobaciones actuales de especificacion, design y plan; sin
   plan, la aprobacion de la tarea representa su mini-plan.
5. Comprobar ACT, implementar dentro del alcance y recorrer el workflow.
6. Registrar checks y cobertura de los escenarios asignados.
7. En REVIEW, preparar un informe con evidencia aportada por el operador,
   aprobar ese informe y aportar review independiente o waiver explicito.
8. Comprobar ACCEPT y despues CLOSE conforme al workflow canonico.

Toda tarea formal tiene al menos un escenario, incluidas las preparatorias.
Si no hay uno verificable, se debe acordar un escenario tecnico o reagrupar
el trabajo; el sistema no inventa requisitos ni acepta una lista vacia.
El plan cubre la union completa de escenarios de la especificacion.
Cada tarea verifica solamente sus asignaciones: no debe esperar por el
trabajo de una sucesora para poder cerrar su propia contribucion.

Las dependencias transitivas deben estar en CLOSE. Aprobar un plan no
convierte sus tareas en ejecutadas ni inicia agentes.

## Gates y permisos

ACT revalida referencias, digests, pertenencia al plan, escenarios,
contencion de alcance, ausencia de preguntas abiertas, aprobaciones actuales
y cierre de dependencias. ACCEPT repite esos controles y exige cobertura
exacta de esta tarea, verificacion, informe vigente aprobado y review/waiver.

Las rutas de alcance se comparan con su escritura canonica exacta y limites
de segmento, sin confundir `src/a` con `src/ab` o `SRC/a`. Los UUID se
resuelven sin distinguir mayusculas. Los enlaces y junctions se rechazan en
las comprobaciones de contencion.

Revocar consentimiento o cambiar registros invalida el siguiente gate.
Un bloqueo ocurre antes de crear el temporal de la transicion o reemplazar
la tarea; los locks propios se limpian sin recuperar locks ajenos.

Una consulta de metodologia es **solo un control metodologico**. No sustituye
la arista del workflow, `checkAction`, permisos nativos ni autorizacion para
red, instalaciones, publicacion o efectos destructivos.
Una tarea V2 con alcance vacio puede entrar en ACT, pero no recibe `edit`
en `checkAction` ni en el paquete de workflow.

## Evidencia e informe

`verification` conserva `checks` y puede incluir `coverage` y
`outcomeEvidenceId`. Cada cobertura contiene `requirementId`, `scenarioId`
y una lista no vacia de `checkIndexes` validos. Los pares no pueden repetirse
ignorando mayusculas. Los indices remiten a checks declarados, no ejecutados
por este validador.

El informe es un artefacto `report` V2, no un tipo adicional. Su `data` tiene
nueve campos: `schemaVersion`, `taskId`, `taskRevision`, `taskDigest`,
`specId`, `specDigest`, `designDigest`, `planDigest`, `verificationDigest`.
La version de `data` es 1; la version del artefacto es 2.
Sin plan, `planDigest` es null.

El digest de verificacion incluye checks y cobertura, excluyendo el
identificador del propio informe para evitar autorreferencia.
El informe vincula la revision REVIEW anterior a la transicion ACCEPT.
Una nueva ronda de implementacion requiere un informe vigente, aunque los
checks textuales coincidan con los de la ronda anterior.

Volver a ACT borra verificacion y review. Adjuntar una nueva verificacion
invalida la review anterior salvo que se aporte otra explicitamente en la
misma llamada. Incluir `outcomeEvidenceId` dentro de una nueva verificacion
en ACCEPT tampoco evita esta regla.

### Orden operativo para un ACCEPT formal

1. `REVIEW` (o `REVIEW -> REVIEW`): adjuntar la `verification`{checks,
   coverage} completa junto a un `review` valido en una sola llamada.
2. `outcome create`: el informe vincula la revision REVIEW vigente y
   `canonicalDigest({checks, coverage})` de la verificacion almacenada.
3. `approval create` + `approval answer` para el artefacto report
   (ligado por contenido a su digest).
4. `task transition ACCEPT --evidence` con `verification`{los mismos
   checks+coverage, `outcomeEvidenceId`: id del report} y `review`{...}.
   La atestacion se evalua sobre el candidato a `previousRevision` — la
   revision que el report vinculo — asi que el locator pertenece a la
   evidencia del propio ACCEPT.

Trampa a evitar: un `REVIEW -> REVIEW` posterior a `outcome create`
incrementa la revision; el report queda stale
(`OUTCOME_BINDING_MISMATCH`) y hay que recrearlo con una aprobacion
nueva. Nunca adjuntar `outcomeEvidenceId` mediante un auto-bucle.

## Interfaz y continuidad

La interfaz nueva distingue procedimientos de trabajo (`plan-work`,
`implement-task`) de operaciones de datos (`specification create`,
`design create`, `approval`, `outcome create`, `methodology check`).
Crear un registro PLAN o previsualizar una aprobacion no autoriza producto.
Las creaciones JSON tienen vista previa por defecto; `--apply` es explicito.
Los identificadores de una vista previa no quedan reservados.

Las respuestas de aprobacion usan revision y digest esperados bajo CAS;
no se aplican como una sustitucion generica de archivo.
Los ejemplos antiguos de tareas/planes sin referencias formales requieren
modo `manual`. El artefacto generico `spec` V1 no es una especificacion formal.

El contexto del runtime queda vinculado al cargar la configuracion o iniciar
el MCP. Tras cambiar configuracion/rutas hay que resolverlo de nuevo o
reiniciar el proceso; no hay watcher. Los snapshots del proyecto no
reemplazan las politicas del runtime instalado ni se actualizan en silencio.
No hay una operacion de reevaluacion de borradores bloqueados: no se deben
editar registros ocultamente para hacerlos pasar. Puede ser necesario crear
un registro explicito nuevo y conservar el anterior como historial.

## Limites de confianza

Los hashes vinculan registros validados y payloads declarados, no el
worktree completo, bytes mutables de logs o la verdad de una afirmacion.
Autor, revisor y aprobador son identidades atribuidas, no autenticadas.
Un informe historico puede consultarse aunque ya no permita aceptar trabajo.

No existe transaccion serializable entre todos los archivos ni bloqueo
continuo de permisos. Las comprobaciones de rutas no son un sandbox del
sistema operativo contra sustituciones concurrentes hostiles del filesystem.
Scopegrain no intercepta herramientas nativas ni convierte una cadena de
prompts en garantia de seguridad o ausencia universal de alucinaciones.

La escalada de investigacion es una politica y procedimiento: registrar la
hipotesis causal, revisar fallos repetidos y pedir acceso a red cuando haga
falta. No es un ejecutor oculto de busquedas, modelos o agentes.
