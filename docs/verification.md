# Verificacion

## Estado Actual

La ultima ejecucion integral (`npm test`, serial por archivo) termino con
1065 pruebas aprobadas, 0 fallidas, 0 omitidas y 0 canceladas en Windows,
Node.js v26.8.1 y npm 11.6.0. Las integrales anteriores de design/outcome
(813), CLI spec/UTF8 (770), ownership spec (699), capturas CLI (673) y
foundation (536) se conservan como referencias pasadas.
No sumar tandas acotadas ni resultados historicos.

| Bloque | Referencia | Evidencia observada |
| --- | --- | --- |
| Evidencia, relaciones formales y outcomes | `4a2f3e9` | 73 pass, 0 fail, 0 skipped |
| Gates, transiciones, acciones y sesiones | `9109755` | 111 pass, 0 fail, 0 skipped |
| Nueva interfaz CLI/MCP | Tanda focalizada | Exit 0: 31 pass, 0 fail, 0 skipped, 0 cancelled |
| Suite integral inicial | `npm test` | Exit 1: 520 pass, 1 fail, 0 skipped, 0 cancelled |
| Reparacion focalizada | `tests/review-corrections.test.mjs` | Exit 0: 12 pass, 0 fail, 0 skipped, 0 cancelled |
| Suite integral posterior | `npm test` | Exit 0: 522 pass, 0 fail, 0 skipped, 0 cancelled |
| Foundation focalizada manual | 18 archivos | Exit 0: 163 pass, 0 fail, 0 skipped, 0 cancelled |
| Foundation integral inicial | `npm test` | Exit 1: 505 tests reportados, 501 pass, 4 fail, 0 skipped, 0 cancelled |
| Foundation diagnostico | 4 archivos del intento fallido | Exit 0: 126 pass, 0 fail, 0 skipped, 0 cancelled |
| Foundation integral serial | `npm test`, un archivo a la vez | Exit 0: 536 pass, 0 fail, 0 skipped, 0 cancelled |
| Workspace compatibilidad inicial | 4 archivos, antes del endurecimiento final | Exit 0: 47 pass, 0 fail, 0 skipped, 0 cancelled |
| Workspace focalizada final | `tests/workspaces.test.mjs` | Exit 0: 25 pass, 0 fail, 0 skipped, 0 cancelled |
| Journal compatibilidad inicial | Journal, workspace y bootstrap | Exit 0: 66 pass, 0 fail, 0 skipped, 0 cancelled |
| Journal focalizada final | `tests/journal.test.mjs`, tras revision | Exit 0: 29 pass, 0 fail, 0 skipped, 0 cancelled |
| Proyeccion MCP interna | Proyeccion y MCP in-memory, 2026-11-16 | Exit 0: 28 pass, 0 fail, 0 skipped, 0 cancelled |
| Recuperacion explicita del journal | 5 archivos del plan, 2026-11-16 | Exit 0: 83 pass, 0 fail, 0 skipped, 0 cancelled |
| Seam estricto del journal (Task 1) | 3 archivos del plan, 2026-11-16 | Exit 0: 74 pass, 0 fail, 0 skipped, 0 cancelled |
| Contratos de datos de captura (Task 2) | 1 archivo del plan, 2026-11-16 | Exit 0: 9 pass, 0 fail, 0 skipped, 0 cancelled |
| Store de capturas tipado (Task 3) | 3 archivos del plan, 2026-11-16 | Exit 0: 60 pass, 0 fail, 0 skipped, 0 cancelled |
| CLI capture create/show (Task 4) | Gate enfocado de 8 archivos, 2026-11-16 | Exit 0: 121 pass, 0 fail, 0 skipped, 0 cancelled |
| Integral capturas CLI | `npm test` serial, 2026-11-16 | Exit 0: 673 pass, 0 fail, 0 skipped, 0 cancelled |
| Ownership spec V2 tras revision | Gate focalizado de 3 archivos, 2026-11-16 | Exit 0: 35 pass, 0 fail, 0 skipped, 0 cancelled |
| Integral ownership spec core | `npm test` serial, 2026-11-16 | Exit 0: 699 pass, 0 fail, 0 skipped, 0 cancelled |
| CLI spec owned y UTF8 | Gate focalizado de 4 archivos, 2026-11-16 | Exit 0: 97 pass, 0 fail, 0 skipped, 0 cancelled |
| Integral CLI spec/UTF8 | `npm test` serial, 2026-11-16 | Exit 0: 770 pass, 0 fail, 0 skipped, 0 cancelled |
| Ownership design/outcome, gate inicial | 10 archivos, 2026-11-17 | Exit 1: 195 tests, 191 pass, 4 fail, 0 skipped, 0 cancelled |
| Ownership design/outcome, fixtures corregidos | 2 archivos nuevos, 2026-11-17 | Exit 0: 43 pass, 0 fail, 0 skipped, 0 cancelled |
| Ownership design/outcome, snapshots tras rollback | 1 archivo, tras revision | Exit 0: 20 pass, 0 fail, 0 skipped, 0 cancelled |
| Integral ownership design/outcome | `npm test` serial, 2026-11-17 | Exit 0: 813 pass, 0 fail, 0 skipped, 0 cancelled |
| Ola de ampliacion Scopegrain | Gates focalizados por bloque, 2026-11-17 | Lifecycle 22; semantic 24; hosts 28+42; journal-update 131; productores 15; hardening 229 pass + 4 todo (luego wave-3: 501 pass); viewer API 9; owned plans 19; owned workspaces 53; owned tasks 60; owned sessions 19; owned approvals 32+135; CLI wave-2 152; minors-a 22; journal-wedge 178; utf8-wave3 501 |
| Integral actual | `npm test` serial, 2026-11-17 | Exit 0: 1065 pass, 0 fail, 0 skipped, 0 cancelled |
| Piloto MCP nativo aislado | Windows, servidor anunciado 0.9.0, 2026-11-16 | Exit 0: `passed-storage-only`; sin certificar embeddings ni anfitriones |
| Control nativo de embeddings | Modelo/runtime locales existentes, 2026-11-16 | Exit 1: `blocked-native-embedding-safety`; fase positiva aprobada, controles negativos fallidos |
| Piloto Devin Local (este repo) | Sesion fresca Devin, 2026-11-17 | 42 skills `scopegrain-*` + 15 subagentes auto-cargados; MCP `scopegrain` activo desde `.devin/mcp_config.json`; `scopegrain_status` invocado: doctor con 16 checks y catalogo de 130 entradas integro por hash |
| Pilotos en anfitriones restantes | Pendientes | Claude, Codex, OpenCode, Antigravity y Hermes no certificados |

Logs locales conservados en `.tasksystem/verification/organic-sdd/`:
`c2d1-green-final.log`, `c2d2-green-final.log`, sus RED causales y diffs
completos. Estan ignorados por Git; no acompanan automaticamente un clon.
La salida completa de la tanda CLI/MCP esta en
`.tasksystem/verification/publication-cli-mcp-1794188607.log`, tambien
ignorada y no incluida automaticamente en un clon publico.
La integral inicial, la reparacion focalizada y la integral posterior estan,
respectivamente, en `.tasksystem/verification/publication-full-suite-1794189732.log`,
`.tasksystem/verification/publication-review-corrections-1794190234.log` y
`.tasksystem/verification/publication-full-suite-recheck-1794190295.log`.
Estos logs tambien permanecen ignorados y no acompanan un clon publico.

La tanda focalizada foundation fue ejecutada manualmente por el propietario;
su resumen esta en `.tasksystem/verification/scopegrain-foundation-owner-results.md`
y no registra versiones de Node/npm. La integral inicial y la reproduccion
de cuatro archivos estan en
`.tasksystem/verification/scopegrain-foundation-full-suite-1794250002.log` y
`.tasksystem/verification/scopegrain-foundation-four-file-repro-1794250596.log`.
La integral serial autorizada esta en
`.tasksystem/verification/scopegrain-foundation-serial-full-suite-1794255293.log`.
Estos archivos son locales, ignorados y no acompanan un clon publico.

La identidad de workspace se verifico por separado de foundation. La tanda
inicial cubrio workspace, CLI, foundation y config. La revision posterior
agrego invalidacion permanente de bindings obsoletos y comparaciones
`dev`/`ino` con BigInt. Sus cuatro regresiones fallaron antes del cambio;
la focalizada final aprobo 25 pruebas. Un filtro de help C2-E aprobo una
prueba en una ejecucion separada; no se suma a las otras tandas.
Los logs son `.tasksystem/verification/scopegrain-workspaces-green-final-1794257535.log`,
`scopegrain-workspaces-rework-red-1794258058.log`,
`scopegrain-workspaces-rework-green-final-1794258101.log` y
`scopegrain-workspaces-help-1794257497.log` bajo la misma carpeta.
No se repitio la integral de foundation ni se valido VantaDB con este bloque.

El kernel de journal se verifico con snapshots, reserva activa, carreras
create-to-noop, fallos de fuente/marcador, ACK idempotente y scopes all-of.
La revision encontro que una reserva activa sin indice podia parecer una
cola vacia. Tres regresiones de lectura fallaron antes de la correccion;
la focalizada final aprobo 29 pruebas. La tanda previa de compatibilidad
aprobo 66 pruebas y no se suma a la final. Los logs locales son
`.tasksystem/verification/scopegrain-journal-green-complete-1794262437.log`,
`scopegrain-journal-listing-red-1794263030.log` y
`scopegrain-journal-listing-green-1794263051.log` bajo la misma carpeta.
El RED inicial por modulo ausente se conserva separadamente en
`scopegrain-journal-red-1794261393.log`; no prueba fallos de comportamiento.
Este kernel sigue siendo interno y create-only: no activa escritores
publicos, recuperacion automatica, captura, CLI/MCP ni VantaDB. La reserva
incompleta se conserva hasta una reconciliacion explicita futura.
No se repitio la integral ni se ejecutaron pilotos nativos con este bloque.

El puente interno de proyeccion del commit `d5a23a5` se reviso y verifico
por separado mediante
`node --test --test-concurrency=1 tests/vantadb-projection.test.mjs tests/mcp.test.mjs`.
La ejecucion aprobo 28 pruebas sin fallos, omisiones ni cancelaciones,
con salida 0 y duracion de 19369.9938 ms. El log local es
`.tasksystem/verification/2026-11-16-vantadb-projection-green-1794801914.log`;
el RED inicial por modulo ausente permanece en
`.tasksystem/verification/scopegrain-vantadb-projection-red-1794264898.log`.
Estos logs estan ignorados y no acompanan automaticamente un clon.
Se verificaron scopes all-of, snapshots y chunks, respuestas MCP tipadas,
conflictos, respuestas perdidas, readback, lease y ACK local recuperable.
El transporte in-memory no certifica el ejecutable VantaDB, sus proveedores
de embeddings ni una base real. No se inicio un motor ni se repitio la
suite integral. Este bloque no activa escritores publicos ni captura.

La recuperacion explicita del journal se verifico por separado en Node.js
v26.8.1 mediante el gate acotado del plan:
`node --test --test-concurrency=1 tests/journal-recovery.test.mjs tests/cli-journal.test.mjs tests/journal.test.mjs tests/vantadb-projection.test.mjs tests/cli.test.mjs`.
La ejecucion aprobo 83 pruebas sin fallos, omisiones ni cancelaciones,
con salida 0 y duracion de 59222.3097 ms. El log local es
`.tasksystem/verification/2026-11-16-journal-recovery-rework-green-1794803352.log`.
El RED de la revision reprodujo cuatro fallos antes de la correccion en
`.tasksystem/verification/2026-11-16-journal-recovery-rework-red-1794803301.log`
y el RED inicial por exports ausentes esta en
`2026-11-16-journal-recovery-red-1794802852.log`; el gate intermedio de
79 pruebas y estas ejecuciones no se suman entre si ni a otras tandas.
La revision detecto dos defectos corregidos con regresiones: un lock
reemplazado por otro archivo con el mismo token (identidad `dev`/`ino`
distinta, comprobada ademas de token antes de unlink) y una restauracion
de indice que podia exceder `maxPendingOperations` sin un conteo acotado
de nombres del outbox antes de cualquier escritura.
La recuperacion aprobada preserva fuentes ausentes, parciales, coincidentes
o ajenas sin adoptarlas ni modificarlas; nunca crea un marcador de commit
a partir de bytes coincidentes. Limites: el lock sigue siendo cooperativo
y las comprobaciones de identidad/token no constituyen un unlink atomico
del sistema operativo; con puntero activo nulo el listado acotado no
detecta indices historicos ausentes, por lo que una pagina vacia no prueba
sincronizacion global. No se ejecuto la suite integral ni ningun proceso
nativo con este bloque.

El seam interno estricto `applyJournaledRecordCreation` (Task 1 del plan de
captura) se verifico por separado en Node.js v26.8.1 mediante
`node --test --test-concurrency=1 tests/journal.test.mjs tests/journal-recovery.test.mjs tests/vantadb-projection.test.mjs`.
La ejecucion aprobo 74 pruebas sin fallos, omisiones ni cancelaciones,
con salida 0 y duracion de 18901.9009 ms. El log local es
`.tasksystem/verification/2026-11-16-record-seam-green-1794804847.log`
y el RED por export ausente esta en
`2026-11-16-record-seam-red-1794804797.log`. Las regresiones cubren la
identidad congelada compartida, callbacks invalidos, noop inicial y noop
inyectado antes del preflight bajo lock, sin fuentes ni reserva. No se
suma al gate 83 ni a otras tandas; sigue siendo un seam interno sin
captura activada.

Los contratos puros de datos de captura (`src/core/capture-data.mjs` y los
schemas `capture`/`record-ownership`, Task 2 del plan) se verificaron por
separado en Node.js v26.8.1 mediante
`node --test --test-concurrency=1 tests/capture-data.test.mjs`.
La ejecucion aprobo 9 pruebas sin fallos, omisiones ni cancelaciones,
con salida 0 y duracion de 140.4566 ms. El log local es
`.tasksystem/verification/2026-11-16-capture-data-green-1794805218.log`
y el RED por modulo ausente esta en
`2026-11-16-capture-data-red-1794805181.log`. Son validadores puros: no
afirman persistencia, captura activada ni ownership probado. No se suma
al gate 74 ni a otras tandas.

El store tipado de capturas (`src/core/captures.mjs`, Task 3 del plan) se
verifico por separado en Node.js v26.8.1 mediante
`node --test --test-concurrency=1 tests/captures.test.mjs tests/capture-data.test.mjs tests/journal.test.mjs`.
La ejecucion aprobo 60 pruebas sin fallos, omisiones ni cancelaciones,
con salida 0 y duracion de 6693.1538 ms. El log local es
`.tasksystem/verification/2026-11-16-captures-rework-green-1794806444.log`
y el RED de rework con 16 aprobadas y exactamente 2 regresiones esta en
`2026-11-16-captures-rework-red-1794806425.log`. Esas regresiones
reprodujeron dos defectos antes del arreglo: `prepare` devolvia previews
sin validar destinos inseguros (ancestro archivo o junction) y `get`
podia leer la fuente actual con un binding ya revocado tras la ultima
lectura de snapshot. La ejecucion intermedia de 55 pruebas no se suma.
El store crea la nota y su sidecar en una operacion journal recuperable y
`get` exige prueba committed de dos eventos; a esa fecha no habia CLI,
captura automatica, recoleccion por anfitriones ni resolucion de
preferencia activa o verdad actual.

La superficie CLI `capture create|show` (Task 4 del plan) se verifico en
Node.js v26.8.1 con el gate enfocado final de 8 archivos:
`node --test --test-concurrency=1 tests/capture-data.test.mjs tests/captures.test.mjs tests/cli-captures.test.mjs tests/journal.test.mjs tests/journal-recovery.test.mjs tests/vantadb-projection.test.mjs tests/cli-journal.test.mjs tests/cli.test.mjs`.
La ejecucion aprobo 121 pruebas sin fallos, omisiones ni cancelaciones,
con salida 0 y duracion de 22355.7746 ms. El log local es
`.tasksystem/verification/2026-11-16-final8-green-1794807260.log` y el
RED previo (0 aprobadas, 7 fallos por comando desconocido) esta en
`2026-11-16-cli-captures-red-1794807224.log`. El gate incluye las pruebas
MCP existentes de proyeccion en memoria; no certifica conformidad nativa
ni global. `capture` es escritura manual tipada (vista previa por defecto,
`--apply` explicito, grants all-of del workspace); los productores
automaticos, la recoleccion por anfitriones y el backend nativo siguen
sin estar conectados. Los conteos de tandas previas (9, 60, 74, 83) no se
suman a este gate ni entre si.

Tras el gate enfocado se ejecuto una unica vez la suite integral autorizada
mediante `npm test`, que invoca
`node --test --test-concurrency=1 tests/*.test.mjs` en Node.js v26.8.1 y
npm 11.6.0. Aprobo 673 pruebas sin fallos, omisiones ni cancelaciones, con
salida 0 y duracion de 322695.5689 ms; el log completo esta en
`.tasksystem/verification/2026-11-16-integral-npmtest-1794807643.log`. Es
la referencia integral del bloque CLI de capturas, no un rerun del gate 121 ni una
certificacion de CI, ejecucion nativa o conformidad en anfitriones; los
conteos anteriores no se suman a ella.

El bloque de ownership de especificaciones V2 comparte validadores puros
y prueba de creacion con las capturas, sin alterar los escritores legacy.
La revision detecto la perdida de la guardia de tipo string de
`sourceHash`: el RED reprodujo la aceptacion indebida de un array antes
de restaurarla. El control causal esta en
`.tasksystem/verification/2026-11-16-ownedspec-hashguard-red-1794812682.log`
(8 pass, 1 fail); la tanda posterior a la revision aprobo 35 pruebas
sin fallos, omisiones ni cancelaciones, salida 0 y 4441.2723 ms, mediante
`node --test --test-concurrency=1 tests/record-ownership-data.test.mjs tests/capture-data.test.mjs tests/owned-specifications.test.mjs`.
Su log es
`.tasksystem/verification/2026-11-16-ownedspec-rework-green-1794812910.log`.
El gate inicial de 79 pruebas es anterior a esa correccion; los conjuntos
son distintos y sus conteos no se suman.

Tras la revision completa se ejecuto una unica integral con `npm test`
serial, Node.js v26.8.1 y npm 11.6.0: 699 pass, 0 fail, 0 skipped,
0 cancelled, salida 0 y 1354533.5285 ms. Es la referencia de ese bloque core.
El log completo, incluidas versiones y salida real, esta en
`.tasksystem/verification/2026-11-16-integral-npmtest-1794813511.log`.
Son 26 casos nuevos en los dos archivos de ownership, incluidos en las
699 pruebas, no adicionales a ellas. No hubo reintentos de la integral.
En ese bloque el store era opt-in y core-only; no habia CLI de specs con ownership,
protocolo mutable, productor automatico ni activacion nativa.
Esta integral no sustituye el gate nativo de embeddings bloqueado.

La ampliacion CLI posterior incorpora `specification create|show --owned`
sin cambiar el modo legacy por defecto. Un repro aislado previo confirmo
que `readInputFile` aceptaba un byte `0xff` dentro de `originalRequest`
y persistia U+FFFD en un artefacto legacy. Se corrigio el lector comun:
limite de bytes, roundtrip UTF8 exacto y luego parseo, sin prohibir U+FFFD
valido ni normalizar el texto. El repro esta en
`.tasksystem/verification/2026-11-16-cli-utf8-repro-1794815485.log`.
El RED inicial se conserva en
`.tasksystem/verification/2026-11-16-cli-owned-task1-red.log`: incluyo
un fallo de fixture por ruta reservada, corregido antes de GREEN, ademas
de los fallos de modo aun ausente y perdida UTF8. La expectativa de error
de un UUID desconocido se reconcilio con `OWNED_SPEC_NOT_FOUND` del core;
no se cambio el core para satisfacer el shorthand erroneo del plan.

El gate focalizado aprobo 97 pruebas, 0 fallos, omisiones o cancelaciones,
salida 0 y 60057.2735 ms:
`node --test --test-concurrency=1 tests/cli-utf8.test.mjs tests/cli-owned-specifications.test.mjs tests/cli-captures.test.mjs tests/cli-methodology.test.mjs`.
Su log completo esta en
`.tasksystem/verification/2026-11-16-owned-spec-cli-green-1794816091.log`.

Tras revisar todos los tests, fuente y documentacion, y una segunda
revision en contexto separado sin hallazgos que requirieran cambios,
se congelo el codigo y se ejecuto una unica integral `npm test` serial:
770 pass, 0 fail, 0 skipped, 0 cancelled, salida 0 y 510701.96 ms,
Node.js v26.8.1 y npm 11.6.0. El log crudo con versiones, comando, salidas
y codigo real es
`.tasksystem/verification/2026-11-16-owned-spec-cli-integral-1794816546.log`.
El chequeo de whitespace con `cr-at-eol` acotado al proceso termino
tambien con salida 0, sin escribir configuracion Git. No hubo reintentos,
filtros ni omisiones de la integral; la focalizada no se suma al total.
Estos logs son locales e ignorados, no acompanan automaticamente un clon.
Este bloque no activa productores automaticos, hooks, protocolo mutable
ni VantaDB nativo; tampoco repite ni sustituye el control de embeddings.

La ampliacion de ownership a designs V2 y reports de outcome incorpora
dos stores tipados y CLI opt-in, sin convertir los escritores legacy.
El getter de design valida el binding de spec desde los bytes probados;
el getter de outcome prueba el report presente, no su vigencia respecto
de la tarea mutable ni elegibilidad para ACCEPT. Los gates conservan esa
responsabilidad. La revision completa se realizo tambien en un contexto
separado, incluido el diff literal y los cuatro archivos nuevos.

El RED conductual de CLI termino con 23 tests, 4 pass y 19 fail, salida 1:
`.tasksystem/verification/owned-formal-task1-cli-red-20261117-041450-4162.log`.
El RED core de
`.tasksystem/verification/owned-formal-task1-core-red-20261117-041534-2777.log`
incluye rechazo de los nuevos kinds y fallo de carga por modulos ausentes;
ese fallo de carga no demuestra comportamiento de un store aun inexistente.

La primera tanda dirigida de diez archivos termino con 195 tests,
191 pass y 4 fail, sin omisiones ni cancelaciones, salida 1:
`.tasksystem/verification/2026-11-17-owned-formal-green-1794903811.log`.
Las cuatro expectativas de los fixtures suponian una fuente presente tras
un fallo de companion, pero el rollback existente retiro los archivos
creados en ese escenario. Corregir la expectativa de presencia no cambio
el kernel ni debilito la prueba de ownership. Una primera repeticion de
los dos archivos nuevos aun tuvo 41 pass y 2 fail por expectativas
estructurales restantes:
`.tasksystem/verification/2026-11-17-owned-formal-rerun-1794904101.log`.
Tras corregirlas, esos dos archivos aprobaron 43 pruebas sin fallos,
omisiones ni cancelaciones, salida 0:
`.tasksystem/verification/2026-11-17-owned-formal-rerun2-1794904138.log`.
Los otros ocho archivos no cambiaron ni se repitieron; no se presenta
la combinacion de esas ejecuciones como una unica tanda verde de 195.

La revision posterior preciso que el rollback es best-effort y que la
prueba no depende de su exito. Se agrego la comprobacion de ambos snapshots
y sus hashes tras el rollback del fixture. El unico archivo con aserciones
nuevas se repitio: 20 pass, 0 fail, 0 skipped, 0 cancelled y salida 0:
`.tasksystem/verification/2026-11-17-owned-formal-rework-1794904550.log`.

Con fuente y tests congelados, la unica integral final `npm test` termino
con 813 pass, 0 fail, 0 skipped y 0 cancelled, salida 0,
620603.4447 ms, Node.js v26.8.1 y npm 11.6.0:
`.tasksystem/verification/2026-11-17-owned-formal-integral-1794904701.log`.
El log conserva versiones, comando, stdout/stderr y `NPM_TEST_EXIT=0`.
La integral no tuvo reintentos, filtros ni omisiones; las tandas anteriores
no se suman a su total. Estos logs y los diffs privados estan ignorados
por Git y no acompanan automaticamente un clon. No se activaron
productores, hooks, anfitriones ni VantaDB nativo. La evidencia no
certifica otros sistemas operativos ni la version minima Node.js 22.

La ola de ampliacion siguiente (journal CAS mutable, cinco stores owned
mutables, lifecycle, descubrimiento semantico, activacion de anfitriones y
Hermes provisional, productores de capturas, endurecimiento UTF8 y MCP,
API local y visor React, empaquetado `scopegrain` y documentacion en
ingles) se verifico por bloques con gates focalizados y una revision
independiente del arbol combinado. La revision encontro dos defectos
mayores, ambos corregidos antes de la integral: el store owned de tareas
reconstruia su cadena escaneando `journal/operations` acotado por
`maxPendingOperations` (ahora sidecar mutable con `chain`, ops de dos
eventos); y una reserva de head seguida de un crash antes de escribir el
intent dejaba el journal sin via de recuperacion (`abandon-prepared` ahora
tolera el intent ausente verificando el digest del head). Doce hallazgos
menores se corrigieron o documentaron como limites aceptados.

Con el arbol combinado congelado se ejecuto una unica integral `npm test`
serial, Node.js v26.8.1 y npm 11.6.0: 1065 pass, 0 fail, 0 skipped,
0 cancelled, salida 0 y 6700935.6741 ms:
`.tasksystem/verification/2026-11-17-integral-npmtest-1794931090.log`.
Los gates focalizados por bloque no se suman al total. Hermes queda
provisional sin formato verificado; ningun piloto real de anfitrion se
ejecuto; VantaDB nativo sigue bloqueado por el control negativo de
embeddings. La evidencia no certifica Node.js 22 ni otros sistemas
operativos; el workflow manual sigue sin ejecucion remota registrada.

Antes de este bloque de ownership se ejecuto una vez la receta privada de
piloto MCP nativo, con una
base nueva y datos sinteticos. El ejecutable instalado anuncio `vantadb
0.9.0`; el resultado fue `passed-storage-only`, salida 0. Cuatro eventos
inmutables y sus snapshots UTF8/BOM, binarios y vacios conservaron sus bytes
tras reiniciar el proceso. El proxy rechazo solicitudes sin credenciales
con 401 en ambas sesiones. Los registros observados no contienen vectores.
La ruta de modelo ausente fue deliberada: `StrictUnavailable` no prueba
que falten modelos en el equipo ni certifica recuperacion semantica.
El log es `.tasksystem/verification/2026-11-16-native-probe-1794808334.log`;
las respuestas crudas estan en
`.tasksystem/verification/2026-11-16-native-mcp-5a2e5113-1b51-41f7-a7b9-86a19526e666.json`.
La receta, base y evidencia son privadas e ignoradas; no acompanan un clon.
No se activo una integracion publica ni se modifico VantaDB; tampoco se uso
contenido real. Este piloto no se suma a las 673 pruebas de la suite.

La prueba funcional posterior uso pesos y runtime ONNX ya existentes,
copias propias y textos sinteticos. Con DLL valida pasaron generacion y
persistencia; el gate completo fallo con salida 1 porque, con DLL
deliberadamente ausente y modelos presentes, `capabilities` anuncio
`StrictUnavailable` pero `embed_texts` por defecto y el auto-embed de
`memory_put` devolvieron `fallback:false`, y se persistio un vector384.
La llamada con modelo explicito rechazo correctamente ese runtime ausente.
La activacion nativa automatica permanece bloqueada; no se aplico un
workaround ni se modifico VantaDB. Log privado:
`.tasksystem/verification/2026-11-16-embedding-probe-1794810035.log`;
respuestas:
`.tasksystem/verification/2026-11-16-native-embedding-46c95621-1f91-4eab-99bb-31839b70a884.json`.
Esta prueba no es un benchmark de recuperacion ni se suma a la integral.

El intento integral foundation reporto errores `UNKNOWN` en operaciones de
E/S y archivos de prueba abortados. El diagnostico registro un evento System
2004 de memoria virtual baja durante ese intento; no demuestra la causa
concreta de cada error ni una fuga de memoria. Se acoto el runner a un
archivo de test a la vez, sin omitir casos ni relajar controles. La
[documentacion de Node](https://raw.githubusercontent.com/nodejs/node/v26.8.1/doc/api/cli.md)
describe `--test-concurrency`, y la
[documentacion de Microsoft](https://learn.microsoft.com/en-us/troubleshoot/windows-server/performance/troubleshoot-application-service-memory-leaks)
describe el evento 2004 y sus limites de diagnostico.

La regresion filtrada del script fallo antes de cambiarlo, como se registra en
`.tasksystem/verification/scopegrain-foundation-concurrency-red-1794255277.log`;
ese filtro no es una suite completa. El script actual es
`node --test --test-concurrency=1 tests/*.test.mjs`.

La ejecucion integral serial de foundation duro aproximadamente 19 minutos
y 13 segundos.
El workflow manual reserva 45 minutos por job para dejar margen a la
preparacion y a diferencias entre runners; no se ha ejecutado en CI y ese
presupuesto no demuestra su duracion en Linux, Windows ni otras versiones
de Node.

La integral inicial del bloque anterior fallo porque una prueba obsoleta
esperaba `INVALID_ARGS` para `catalog list --project`, opcion ya admitida;
el contexto sin configuracion devolvio `CONFIG_NOT_FOUND`. Se corrigio la
prueba y se anadio una regresion del snapshot del proyecto, sin cambiar el
runtime. La tanda focalizada y la integral posterior son ejecuciones
separadas.

Los checks y reviews sinteticos de fixtures prueban el mecanismo, no una
ejecucion nativa, identidad autenticada o un resultado real del producto.

Las siguientes tandas de pruebas/arranques se proponen al propietario para
ejecucion manual o autorizacion explicita. Las ejecuciones documentadas
arriba no autorizan automaticamente repetirlas.

## Entorno De Los Gates Historicos

Se ejecutaron las verificaciones con autorizacion expresa del propietario,
sin instalaciones, red, push ni cambios al proyecto de origen.
Entorno observado: Windows, Node.js v26.8.1 y npm 11.6.0. No se ha probado
todavia la version minima declarada (Node.js 22) ni otros sistemas operativos.

## Gate Historico De La Ampliacion Portable

Ejecucion registrada el 2026-11-07 (UTC). Evidencia local:
`.tasksystem/verification/final-gate/`.

| Comprobacion | Resultado observado |
| --- | --- |
| `npm test`, suite completa | Exit 0: 145 pass, 0 fail, 0 skipped, 0 cancelled |
| Smoke end-to-end del CLI y MCP | Exit 0: 41 comprobaciones correctas, 0 fallidas |
| Inicializacion en seco | Plan de 385 archivos; no se crea el workspace |
| Inicializacion aplicada, cuatro anfitriones | 385 archivos proyectados; no se activan raices nativas |
| Doctor y reinicializacion | `ready`; despues created 0, bytes de config/discovery preservados |
| DAG con dos tareas | Sucesora bloqueada hasta que su dependencia llega a CLOSE |
| Implementacion y verificacion del fixture | `node --test sum.test.mjs` ejecutado realmente, exit 0 |
| Evidencia y review | Verificacion con log real; review sintetica declarada, solo para probar el esquema |
| CAS y presupuesto | Revision obsoleta y operacion excedida rechazadas; resume con estado y uso reales |
| Siete tipos de artefactos | Bajo `.tasksystem/`, reviews en reports/reviews; no se crea docs/ |
| Catalogo y proyecciones | 111 recursos y fuentes de propuestas existentes en disco |
| Preferencias Git del fixture | Ignore anidado segun seleccion; `.gitignore` de raiz intacto |
| MCP con transporte real stdio | 13 herramientas read-only; consultas de catalogo, workflow, plan, artefacto y sesion |

Archivos de evidencia:

- `npm-test-final-gate.log`: salida completa de la suite.
- `smoke-report.json` y `smoke.log`: comprobaciones del fixture.
- `smoke.mjs`: script de verificacion puntual, no parte del runtime.
- `node-version.txt` y `npm-version.txt`: versiones observadas.
- `project/.tasksystem/reports/sum-test-runner.log`: salida del test real
  del fixture; la ejecucion fue autorizada explicitamente, no iniciada por
  descubrir el script en el manifiesto.

El smoke registra una review con identificadores sinteticos. Valida
transiciones y dependencias, **no** demuestra revision independiente
automatica, identidad autenticada ni delegacion real dentro de un anfitrion.
El transporte in-memory tambien se comprueba en la suite; stdio se
comprueba adicionalmente en el fixture.

El gate de whitespace detecto terminadores/espacios finales en archivos
editados. Se normalizaron sin cambios de comportamiento y se comprueba
por separado; ese ajuste no se presenta como otra ejecucion de la suite.

El piloto Devin Local quedo certificado en sesion real (skills + MCP +
invocacion read-only); no se ejecutaron sesiones reales de Claude Code,
Codex, OpenCode, Antigravity u Hermes.
No se certifican las 197 skills originales archivadas, plugins externos,
aislamiento nativo, Node.js 22 ni otros sistemas operativos.
Los logs, fixtures y reviews operativos permanecen privados e ignorados;
no acompanan automaticamente a un clon.

## Historico de la primera base

La siguiente tabla corresponde a los commits iniciales, no al conteo actual.

| Comprobacion | Resultado observado |
| --- | --- |
| Primera corrida `npm test` | Exit 1: 72 pass, 1 fail, 0 skipped |
| Causa del fallo | La prueba de rechazo de flags omitio pasar `io` a `run`; no se cambiaron los controles del CLI |
| `node --test tests/cli.test.mjs` despues de corregir la llamada | Exit 0: 9 pass, 0 fail |
| Gate final `npm test` | Exit 0: 73 pass, 0 fail, 0 skipped |
| `--help` e `inspect --project .` | Exit 0; inspect informa gestor no confirmado sin asumir npm |
| `init --answers` sobre fixture vacio | Dry-run, sin escrituras del inicializador |
| `init --answers --apply` | Exit 0; 13 archivos nuevos |
| `doctor` del fixture | Exit 0, status ready, sin warnings |
| Repetir init con las mismas respuestas | Exit 0; created 0 |
| Crear, listar, consultar y transicionar tarea | Exit 0; PLAN revision 0 pasa a ACT revision 1 |
| Transicionar con revision antigua | Exit 1 esperado: REVISION_MISMATCH |

Evidencia local conservada en `tests/.tmp/verification/`: baseline
`npm-test.tap.log`, correccion `cli-tests-fixed.log`, gate
`npm-test-final.log` y logs `smoke-*.log`. El fixture se conserva en
`tests/.tmp/smoke-proyecto/`. Ambos destinos estan ignorados por Git:
la evidencia local no acompana automaticamente a un clon.

En esa primera base las pruebas MCP no conectaban un transporte.
La ampliacion incorpora las comprobaciones in-memory y stdio indicadas
en el gate historico descrito.

## Reproduccion

Los comandos siguientes permiten repetir las comprobaciones manualmente
o autorizar su ejecucion por un agente; la autorizacion no se infiere de
la mera presencia de esta guia.

## Requisito

```powershell
node --version   # se espera >= 22
```

El CLI no requiere dependencias. La suite completa necesita las dependencias
MCP declaradas: `@modelcontextprotocol/sdk` 1.27.1 y `zod` 4.5.4.
Sin ellas, `mcp.test.mjs` puede omitir sus casos opcionales con razon
documentada, pero `mcp-methodology.test.mjs` requiere esas dependencias;
no se promete una ejecucion completa de `npm test` sin ellas.

## Suite completa

Desde la raiz de Scopegrain:

```powershell
npm test
# equivalente:
node --test --test-concurrency=1 tests/*.test.mjs
```

## Verificacion por area (mas acotada)

Tandas Organic/SDD reproducibles. La tercera corresponde a la ejecucion
CLI/MCP focalizada indicada arriba; las demas son resultados por bloque,
no una nueva suite integral:

```powershell
node --test tests/evidence.test.mjs tests/formal-bindings.test.mjs tests/outcomes.test.mjs tests/structured-boundaries.test.mjs
node --test tests/methodology-gates.test.mjs tests/transition-methodology.test.mjs tests/workflows.test.mjs tests/sessions.test.mjs
node --test tests/cli-methodology.test.mjs tests/mcp-methodology.test.mjs tests/mcp.test.mjs
```

```powershell
node --test tests/paths.test.mjs      # contencion, traversal, symlinks
node --test tests/discovery.test.mjs  # stacks, limites, fingerprint
node --test tests/config.test.mjs     # contrato de config y respuestas
node --test tests/bootstrap.test.mjs  # plan, preflight, create-only
node --test tests/adapters.test.mjs   # fragmentos por anfitrion
node --test tests/tasks.test.mjs      # transiciones, CAS, evidencias
node --test tests/cli.test.mjs        # superficie CLI, JSON, exit codes
node --test tests/doctor.test.mjs     # doctor: contenido, templates, warnings
node --test tests/mcp.test.mjs        # opcional; requiere dependencias
node --test tests/catalog.test.mjs    # manifest, recursos y dependencias
node --test tests/workflows.test.mjs  # paquetes, perfiles y contexto
node --test tests/plans.test.mjs      # DAG y readiness
node --test tests/artifacts.test.mjs  # destinos y registros tipados
node --test tests/sessions.test.mjs   # CAS, politica y continuidad
node --test tests/versioning.test.mjs # defaults e ignores por categoria
node --test tests/native-adapters.test.mjs # puentes nativos propuestos
node --test tests/cli-workflows.test.mjs # grupos y trece aliases
node --test tests/review-corrections.test.mjs # registros y limites
node --test tests/final-review.test.mjs # temporales, reloj y catalogo
```

Las pruebas de symlink se omiten con mensaje si Windows no permite crear
enlaces sin privilegio.

## Humo de solo lectura (no escribe nada)

Desde la raiz de Scopegrain:

```powershell
node .\bin\tasksystem.mjs --help
node .\bin\tasksystem.mjs inspect --project .
```

Para el plan dry-run de `init` usar un fixture vacio pre-creado (sobre este
repo `init` terminaria en `PLAN_CONFLICT`, porque los `AGENTS.md`/`CLAUDE.md`
existentes difieren deliberadamente del contenido generado):

```powershell
mkdir .\tests\.tmp\humo-vacio
node .\bin\tasksystem.mjs init --project .\tests\.tmp\humo-vacio --answers .\examples\answers.json
```

Imprime el plan sin escribir nada.

## Humo con escritura (mutante, solo en fixture desechable)

Crear un proyecto vacio dentro de `tests/.tmp` y aplicar ahi, nunca sobre
un proyecto real ni sobre este repo:

```powershell
mkdir .\tests\.tmp\humo-proyecto
node .\bin\tasksystem.mjs init --project .\tests\.tmp\humo-proyecto --answers .\examples\answers.json --apply
node .\bin\tasksystem.mjs doctor --project .\tests\.tmp\humo-proyecto
node .\bin\tasksystem.mjs task list --project .\tests\.tmp\humo-proyecto
```

`examples/answers.json` selecciona `organic-sdd`. No usar creaciones V1
sin metadatos como si fueran validas en ese modo. Crear tareas con el
contrato apropiado o elegir `manual` explicitamente en respuestas de un
fixture nuevo; no modificar silenciosamente una configuracion existente.

Tambien se puede ejecutar `init` interactivo sobre el fixture (en una
terminal real): pregunta nombre, idioma, anfitriones, ruta de config y las
siete rutas y ocho preferencias de versionado; muestra el plan y solo
escribe tras `yes` explicito.

## Humo del MCP (opcional, con dependencias instaladas)

```powershell
node .\src\mcp\server.mjs --project .\tests\.tmp\humo-proyecto --config ".scopegrain/config.json"
```

Debe quedar a la espera por stdio (protocolo MCP); cerrar con Ctrl+C.
El log de arranque va a stderr.

## Que reportar

- Salida completa de `npm test` (o de cada archivo acotado).
- Cualquier `FAIL`, `ERR` o skip inesperado.
- Para el humo: el JSON emitido por stdout y cualquier error en stderr.

## Comandos de verificacion supervisados (deuda B6)

Superficie `verify` con registros cerrados persistidos en
`<paths.state>/verify-commands.json`:

- `verify list` — lectura; un almacen ausente equivale a lista vacia.
- `verify add --command CMD [--apply]` — declara un comando; vista previa
  por defecto, `--apply` persiste con `approved:false`.
- `verify discover [--apply]` — convierte los candidatos de la capa de
  descubrimiento semantico en registros `source:'inferred'`, nunca
  aprobados automaticamente. Los comandos no resueltos se reportan como
  `skipped` con `reason:'unresolved-command'`, el codigo de causa
  (`unresolved`: `PACKAGE_MANAGER_UNCONFIRMED`, `CONTRADICTORY_PM` o
  `UNKNOWN_PACKAGE_MANAGER`) y un `hint` con la remediacion exacta:
  declarar `packageManager` en el package.json de ese cwd, cometer un
  unico lockfile o declarar el comando literal con `verify add`.
- `verify approve ID [--apply]` — aprobacion explicita por registro;
  la via CLI para que un comando (declarado o inferido) pase
  a `approved:true`. Vias masivas: `verify discover --approve` importa
  los candidatos literales y los aprueba en una sola escritura
  bloqueada (los no resueltos quedan en `skipped`, nunca se guardan);
  `verify approve-discovered [--apply]` aprueba los registros
  `inferred` ya almacenados. Ambas vistas previas por defecto.
- `verify run ID [--timeout MS] [--fail-on-error]` — ejecuta un unico
  registro aprobado. Por defecto imprime el JSON del resultado y sale
  con codigo 0; `--fail-on-error` propaga el codigo de salida del
  comando cuando no es 0 (o 1 en timeout/senal) para uso en CI.

Modelo de seguridad: nada se auto-aprueba ni se auto-ejecuta;
`verify run` rechaza registros no aprobados con
`VERIFY_COMMAND_NOT_APPROVED`. El comando se almacena como argv literal
(sin comillas, sin metacaracteres de shell, sin rutas absolutas ni
segmentos `..`); la ejecucion usa `spawn` con array de argumentos —
nunca una cadena de shell ni `shell:true` — con timeout (120 s por
defecto, tope 600 s), salida acotada y `cwd` contenido en el proyecto.
La capacidad declarada `executesProjectCommands:false` se mantiene: el
arnes no ejecuta comandos por iniciativa propia; `verify run` es una
orden explicita del operador. Verificado con
`node --test tests/verify-commands.test.mjs` (21 pass, 0 fail).
