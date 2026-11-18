# Scopegrain

> Traduccion al espanol del README canonico en ingles (`README.md`). La
> version en ingles prevalece.

Harness portable de ingenieria proporcional para agentes de IA.

Scopegrain ayuda a equipos y operadores que usan agentes de codigo a
organizar trabajo entre proyectos y sesiones sin depender de un unico
anfitrion. Separa el contexto y los contratos de trabajo de las
convenciones de cada herramienta, y ofrece una ruta ligera o formal segun
los hechos y riesgos declarados.

El producto se llama Scopegrain. `scopegrain` es la entrada CLI y el
nombre del servidor MCP (tools `scopegrain_*`). El alias de binario
`tasksystem` y las rutas legadas `.tasksystem` se mantienen por
compatibilidad. Esto no implica publicacion de un paquete.

## Flujo de trabajo

1. **Descubrimiento de solo lectura.** Inspeccionar manifiestos e
   instrucciones con limites de lectura; los comandos encontrados se
   presentan como propuestas y no se ejecutan automaticamente.
2. **Incorporacion y aprobacion.** Elegir anfitriones, metodologia, rutas y
   preferencias de versionado. Revisar la vista previa y confirmar antes de
   crear archivos. La aprobacion de archivos no autoriza otras operaciones.
3. **Contexto y snapshots.** Consultar el catalogo de procedimientos, roles,
   skills, reglas y perfiles. El proyecto conserva un snapshot de recursos
   para construir paquetes de contexto sin activar agentes.
4. **Tareas y planes proporcionales.** Registrar contratos, alcance y estado;
   organizar dependencias en un DAG. Organic Driven Development (ODD) usa
   una ruta ligera o SDD formal segun los hechos declarados.
5. **Evidencia, revision y aceptacion.** Registrar verificaciones y review
   o waiver. La ruta formal vincula especificacion, design, asignaciones,
   aprobaciones e informe vigente antes de aceptar una tarea.
6. **Continuidad y recuperacion.** Consultar el estado, reanudar sesiones
   registradas y diagnosticar recursos del snapshot sin repetir comandos ni
   activar trabajo automaticamente.

El descubrimiento no demuestra comprension semantica del codigo. La persona
o el agente debe investigar y decidir que verificaciones son apropiadas.
Las reglas del proyecto y los permisos del propietario prevalecen sobre las
sugerencias del harness.

## Inicio

Se requiere Node.js 22 o posterior. El CLI usa modulos nativos; el servidor
MCP opcional requiere las dependencias declaradas en `package.json`.

Desde la raiz del repositorio:

```powershell
node ./bin/scopegrain.mjs inspect --project "C:\ruta\mi-proyecto"
node ./bin/scopegrain.mjs init --project "C:\ruta\mi-proyecto"
node ./bin/scopegrain.mjs doctor --project "C:\ruta\mi-proyecto"
```

`inspect` no escribe ni ejecuta los comandos que descubre: es la
instantanea acotada de manifiestos que `init` guarda como
`discovery.json`. `investigate` es el analisis semantico profundo
(topologia, plataformas, pruebas, senales de anfitrion) que ademas
propone respuestas de init. `init` interactivo
pregunta por la configuracion, muestra los archivos propuestos y solicita
confirmacion explicita; la respuesta por defecto es no. `doctor` revisa el
estado de la configuracion y los archivos generados.

Tambien se puede usar un archivo de respuestas:

```powershell
node ./bin/tasksystem.mjs init --project "C:\ruta\mi-proyecto" --answers "C:\ruta\respuestas.json"
```

Con `--answers` y sin `--apply`, `init` solo presenta el plan. Agregar
`--apply` autoriza la creacion de los archivos propuestos, no la ejecucion
de comandos ni el reemplazo de contenido existente. `--yes` y `--force` no
son opciones de bypass. Las rutas de artefactos deben permanecer dentro del
proyecto; una configuracion alternativa se indica con `--config`.
La config predeterminada es `.scopegrain/config.json`; si solo existe
`.tasksystem/config.json`, se usa sin migrarla. Si existen ambas entradas,
se requiere `--config` explicito; una ruta explicita no tiene fallback.
Consultar el [ejemplo de respuestas](examples/answers.json) y su
[esquema](schemas/answers.schema.json).

Para operaciones del journal, consulte la
[guia de recuperacion explicita](docs/journal-recovery.md). Para notas de
captura tipadas con ownership probado, consulte
[capturas selectivas](docs/captures.md). Para la prueba de ownership
compartida de creaciones (`capture`, `spec`, `design` y `report`, todos
revision 0), consulte
[creacion con ownership probado](docs/record-ownership.md).
El CLI `specification create|show --owned` es opt-in explicito y conserva
el modo legacy por defecto. `design create` y `outcome create` tambien
aceptan `--owned` opcional; `design show` y `outcome show` lo requieren.
Sin ese flag, las creaciones conservan sus entradas y resultados legacy,
sin autodeteccion ni enrolamiento implicito. Las lecturas genericas
`artifact show design UUID` y `artifact show report UUID` siguen siendo
estructurales, no pruebas de ownership.

Los stores tipados `createOwnedDesignStore(ctx, { areaIds })` y
`createOwnedOutcomeStore(ctx, { areaIds })` reciben respectivamente
`{ areaIds, design }` y `{ areaIds, outcome }` y exponen `prepare`, `create`
y `get`. Requieren workspace enrolado y areas solicitadas explicitamente;
los grants locales para todas las areas no sustituyen la autorizacion
all-of. El design exige una spec V2 estructurada con binding de hash
valido, no ownership del padre. Crear un outcome exige una tarea formal
real en REVIEW, verification y bindings sanos; leer su report probado no
revalida la elegibilidad actual para ACCEPT. Los gates siguen evaluando
vigencia. No se activan productores, hooks ni integraciones nativas.

## Organic y SDD

La metodologia se selecciona al incorporar el proyecto:

| Modo | Uso |
| --- | --- |
| `manual` | Compatibilidad con tareas V1, sin migracion implicita. |
| `organic-sdd` | Ruta ligera o formal segun los hechos declarados. |
| `sdd` | Referencias formales para trabajo de cambio. |

Una configuracion antigua sin metodologia se interpreta como `manual` sin
reescribir sus bytes. En un proyecto interactivo nuevo se propone
`organic-sdd`, sujeto a confirmacion. Los controles de una tarea V2 no se
desactivan por cambiar el modo del proyecto a `manual`.

La clasificacion considera intencion, autorizacion, comprension,
incertidumbre, riesgo y continuidad declarados; no se basa en el numero de
lineas del diff. Una consulta de solo lectura no autoriza cambios. La
autorizacion ausente o rechazada, la comprension insuficiente, la
incertidumbre pendiente o el riesgo desconocido bloquean la ruta de cambio.
Una tarea ligera no requiere inventar artefactos formales.

En SDD, cada tarea formal, incluidas las preparatorias, necesita al menos un
escenario asignado. Un plan debe cubrir todos los escenarios de su
especificacion; las tareas comprueban sus propias asignaciones y sus
dependencias. ACT y ACCEPT revalidan las condiciones y aprobaciones
aplicables. Una consulta metodologica no sustituye permisos humanos ni
permisos del anfitrion. Ver [Organic y SDD](docs/methodology.md).

## Comandos y continuidad

```powershell
node ./bin/tasksystem.mjs catalog list command
node ./bin/tasksystem.mjs pipeline --project "C:\ruta\mi-proyecto" --mode plan
node ./bin/tasksystem.mjs plan create --project "C:\ruta\mi-proyecto" --input plan.json
node ./bin/tasksystem.mjs plan next entrega --project "C:\ruta\mi-proyecto"
```

Los aliases de workflow, como `pipeline`, `spec`, `audit` o `research`,
entregan procedimientos y contexto; no ejecutan modelos, agentes ni scripts.
Los planes guardan dependencias; los artefactos conservan especificaciones,
designs, informes y otros registros. Las sesiones registran operaciones y
presupuesto explicito; reanudarlas recupera contexto, no repite acciones.
Las creaciones JSON usan vista previa por defecto y requieren `--apply`;
las operaciones historicas de tarea mantienen su comportamiento previo.

La superficie CLI completa de un vistazo — cada verbo usa vista previa
por defecto y solo escribe con `--apply` (detalle: [referencia CLI](docs/cli-reference.md)):

| Area | Verbos |
|---|---|
| Descubrimiento y ciclo de vida | `inspect`, `investigate`, `init`, `adopt`, `update`, `backup`, `restore`, `uninstall`, `doctor` |
| Registros owned | `task *`, `plan *`, `session *`, `approval *`, `capture *`, `specification *`, `design *`, `outcome *`, `artifact *`, `workspace *`, `journal *` |
| Verificacion | `verify list`, `add`, `approve`, `approve-discovered`, `discover` (`--approve`), `run` (`--fail-on-error`) |
| Catalogo y recursos | `catalog list|show|check|legacy`, `resource search|diagnose|restore-plan|restore`, `methodology check`, `workflow` |
| Anfitriones y superficie | `host activate`, `view`, `mcp` |
| Aliases de catalogo | `pipeline`, `spec`, `audit`, `research`, `status`, `backlog`, `ship`, `rollback`, `harness`, `webperf`, `cleanCA`, `codeGraph`, `code-simplify` |

Los ejemplos antiguos de tareas y planes sin referencias formales
corresponden a `manual`; el ejemplo de respuestas incluido selecciona
`organic-sdd`. Consultar [workflows y continuidad](docs/workflows.md) y
[flujo de tareas](docs/task-workflow.md) antes de aplicar operaciones.

## Anfitriones y limites de confianza

Se generan propuestas para Claude Code, Codex, OpenCode V2, Devin Local/CLI,
Google Antigravity y Hermes Agent (provisional, formato sin verificar). Los
puentes nativos
y fragmentos MCP son propuestas para revision y activacion manual, no
integraciones certificadas — salvo el piloto real de Devin Local
(2026-11-17) — ni una garantia de equivalencia de permisos o
comportamiento. Devin Cloud no se considera equivalente a Local/CLI. Ver
[formatos nativos](docs/native-hosts.md).

- No hay ejecutor de modelos ni ejecucion automatica de agentes o SDK de
  anfitriones. Las instrucciones no son un sandbox ni interceptan todas las
  herramientas nativas.
- El MCP opcional ofrece consultas de solo lectura; no ejecuta shell ni
  modifica tareas. Los presupuestos cuentan operaciones registradas, no
  todas las llamadas del anfitrion, tokens ni gasto.
- Los hashes vinculan registros y evidencia declarada; no prueban ejecucion
  real, identidad de actores o revisores, ni el contenido completo del
  worktree. Una review independiente o waiver es una declaracion del proceso.
- Las comprobaciones de rutas y locks no constituyen una transaccion
  serializable entre todos los archivos ni aislamiento del sistema operativo.
  Los cuerpos libres pueden contener datos sensibles y deben revisarse antes
  de persistirse o compartirse.
- No se ejecutan automaticamente comandos descubiertos, instalaciones,
  publicaciones u operaciones Git. Ver el
  [modelo de seguridad](docs/security.md).

## Verificacion

La ultima ejecucion integral local (`npm test`, serial por archivo,
2026-11-17) termino con 1065 pruebas aprobadas, ninguna fallida y ninguna
omitida en Windows, Node.js v26.8.1 y npm 11.6.0. Las integrales
intermedias y las tandas anteriores son ejecuciones separadas; su alcance
y resultados historicos estan en [verificacion](docs/verification.md).
El piloto nativo de Devin Local quedo certificado en una sesion fresca
real el 2026-11-17 (42 skills `scopegrain-*` y 15 subagentes auto-cargados,
MCP `scopegrain` activo desde `.devin/mcp_config.json`); los otros cinco
anfitriones documentados siguen sin piloto nativo. Las pruebas no
certifican los seis anfitriones ni una ejecucion real del trabajo
declarado.
El [workflow de GitHub Actions](.github/workflows/verify.yml) se activa solo
manualmente y aun no se ha ejecutado.

## Codigo y licencia

El repositorio puede estar disponible para lectura de su codigo fuente, pero
esa disponibilidad no concede una licencia de codigo abierto ni de
redistribucion. `package.json` conserva `private: true` y `UNLICENSED`;
no se publica un paquete npm. El material heredado permanece fuera del
circuito activo y sujeto a revision de procedencia y derechos.

## Documentacion

- [Arquitectura](docs/architecture.md)
- [Incorporacion y personalizacion](docs/onboarding.md)
- [Compatibilidad y fuentes oficiales](docs/compatibility.md)
- [Seguridad y modelo de confianza](docs/security.md)
- [Migracion y limitaciones conocidas](docs/migration.md)
- [Destino de comandos, agentes, skills, reglas y referencias](docs/component-migration.md)
- [Flujo de tareas y evidencias](docs/task-workflow.md)
- [Organic, SDD, aprobaciones y limites de evidencia](docs/methodology.md)
- [Workflows y continuidad](docs/workflows.md)
- [Verificacion y reproduccion](docs/verification.md)
- [Capturas selectivas tipadas](docs/captures.md)
- [Creacion con ownership probado](docs/record-ownership.md)
- [Informe completo del sistema](docs/system-report.md)
- [Contrato del producto](docs/product-contract.md)
- [Contrato de implementacion](docs/implementation.md)
- [Ciclo de vida: adopt, update, backup, restore, uninstall](docs/lifecycle.md)
- [Referencia de la superficie CLI](docs/cli-reference.md)
- [Investigacion semantica acotada](docs/semantic-discovery.md)
- [Visor y API de solo lectura](docs/en/viewer.md)
- [Procedencia y atestacion del catalogo](docs/provenance.md)
