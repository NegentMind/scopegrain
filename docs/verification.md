# Verificacion

## Estado Actual

La suite integral del bloque foundation termino con 536 pruebas aprobadas,
0 fallidas, 0 omitidas y 0 canceladas en Windows, Node.js v26.8.1 y npm
11.6.0. Se ejecuto con concurrencia limitada a un archivo de test. No sumar
tandas acotadas ni resultados historicos.

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
| Pilotos en anfitriones | Pendientes | No certificados |

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

La ejecucion integral serial duro aproximadamente 19 minutos y 13 segundos.
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

No se ejecutaron sesiones reales de Claude Code, Codex, OpenCode o Devin.
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

Desde la raiz de TaskSystem:

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

Desde la raiz de TaskSystem:

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
node .\src\mcp\server.mjs --project .\tests\.tmp\humo-proyecto --config ".tasksystem/config.json"
```

Debe quedar a la espera por stdio (protocolo MCP); cerrar con Ctrl+C.
El log de arranque va a stderr.

## Que reportar

- Salida completa de `npm test` (o de cada archivo acotado).
- Cualquier `FAIL`, `ERR` o skip inesperado.
- Para el humo: el JSON emitido por stdout y cualquier error en stderr.
