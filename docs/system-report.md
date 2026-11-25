# Informe del sistema Scopegrain

## 1. Identidad y proposito

Scopegrain es un harness portable de ingenieria proporcional para trabajo
con agentes de IA. Vincula contexto, solicitud, autorizacion declarada,
tareas, evidencia y continuidad en un proyecto. No inventa Organic ni SDD:
aplica estas metodologias como procedimientos y controles al trabajo
registrado. No es un ejecutor autonomo de agentes ni de modelos.

El producto incorpora la entrada `scopegrain` (CLI y servidor MCP, tools
`scopegrain_*`) y la configuracion canonica `.scopegrain/config.json`
como identificadores tecnicos. El nombre de
producto no implica una migracion automatica de comandos o registros.
El [README](../README.es.md) contiene el inicio rapido.

## 2. Destinatarios y problemas

Esta dirigido a equipos, propietarios y operadores que trabajan con agentes
de codigo y necesitan continuidad entre proyectos, sesiones y anfitriones.
Busca reducir la deriva de contexto, evitar una burocracia uniforme para
todo cambio y hacer explicitos alcance, aprobacion y evidencia.

El harness no demuestra comprension del codigo ni elimina alucinaciones.
Sus controles no sustituyen investigacion, juicio humano ni permisos reales
del entorno. Un resultado permitido por metodologia no concede por si solo
autorizacion para operar herramientas.

## 3. Flujo operativo

1. `inspect` examina manifiestos de forma acotada y de solo lectura;
   presenta comandos detectados como propuestas, sin ejecutarlos.
2. `init` pregunta identidad, idioma, anfitriones, metodologia, ruta de
   configuracion, siete destinos y ocho preferencias de versionado Git.
3. El operador revisa el plan de archivos y confirma su creacion. Las
   instrucciones nuevas en la raiz se crean sin sobrescribir existentes.
4. El proyecto recibe configuracion, catalogo y snapshot de recursos;
   las propuestas de integracion se mantienen para revision manual.
5. Un workflow packet reune procedimiento, contexto y, cuando corresponde,
   estado y acciones efectivas de una tarea, sin ejecutar un agente.
6. Tareas y planes DAG registran alcance, dependencias, gates, verificacion,
   revision y aceptacion conforme al workflow y la metodologia aplicables.
7. Sesiones, recuperacion y `doctor` permiten consultar continuidad,
   diagnosticar recursos y detectar problemas sin repetir efectos.

La configuracion alternativa se selecciona mediante `--config`. Los cambios
de configuracion o rutas requieren resolver de nuevo el contexto; no hay
un observador que actualice silenciosamente procesos ya vinculados.
Ver [incorporacion](onboarding.md) y [workflows](workflows.md).

## 4. Arquitectura

- `bin/` y `src/cli.mjs`: entrada, parser, interfaz interactiva y JSON.
- `src/discovery/`: inspeccion local acotada de manifiestos.
- `paths`, `config`, `context`, `fsx` y `bootstrap`: limites de rutas,
  configuracion, contexto vinculado, archivos y planes de incorporacion.
- `catalog`, `workflows` y `resource-recovery`: catalogo, snapshots,
  paquetes de procedimiento, diagnostico y restauracion controlada.
- `tasks`, `plans` y `transition`: tareas, DAG, estado y transiciones.
- `artifacts`, `specifications`, `formal-bindings`, `digests`, `outcomes`,
  `approvals` y `methodology`: registros tipados, relaciones, digests,
  consentimiento e informes vinculados con gates metodologicos.
- `evidence`, `sessions`, `versioning` y `doctor`: evidencia declarada,
  continuidad, preferencias de versionado y diagnostico.
- `hosts` y `adapters`: proyecciones para revision y fachadas compatibles.
- `mcp`: servidor opcional de consultas, vinculado a un proyecto.

El mapa completo de modulos y responsabilidades esta en
[arquitectura](architecture.md). `policy/workflow.json` conserva el
contrato canonico de estados y acciones; la metodologia agrega gates, no
otra maquina de estados.

## 5. Inventario del catalogo

El inventario congelado del manifest activo al 2026-11-24
(`resources/manifest.json` v`0.1.2`) contiene
**140 entradas**:

| Tipo | Cantidad |
| --- | ---: |
| `agent` | 15 |
| `command` | 18 |
| `mcp` | 1 |
| `profile` | 5 |
| `prompt` | 11 |
| `reference` | 24 |
| `rule` | 22 |
| `skill` | 44 |

Hay 24 identificadores de alias distintos y 32 correspondencias de alias,
incluidas sus variantes de modo. Estos conteos no son equivalentes.
Las 44 skills activas no certifican las skills del archivo original.
La fuente del catalogo es `resources/manifest.json`; las propuestas y
snapshots no constituyen autorizacion para activar herramientas.

### Procedimientos

Los 18 comandos del catalogo se agrupan por responsabilidad:

- Planificacion y ejecucion: `plan-work`, `implement-task`,
  `coordinate-plan`, `specify-change`, `triage-work`.
- Estado y calidad: `report-status`, `verify-work`, `review-change`,
  `audit-project`, `audit-harness`.
- Investigacion y decisiones: `investigate`, `compare-options`,
  `assess-release`, `plan-recovery`.
- Mejora tecnica: `simplify-code`, `analyze-structure`,
  `audit-web-performance`.
- Clasificacion de solicitudes: `intake`.

Cada procedimiento aporta instrucciones y contexto; no crea un proceso,
ejecuta un modelo ni delega por si mismo.

### Roles y perfiles

Los 15 roles son `requirements-analyst`, `verification-engineer`,
`integration-engineer`, `release-engineer`, `lead`, `architect`,
`implementer`, `algorithm-specialist`, `security-auditor`,
`resilience-tester`, `performance-engineer`, `documentation`, `researcher`,
`reviewer` y `harness-maintainer`. Son responsabilidades, no identidades
autenticadas ni elecciones de modelo.

Los cinco perfiles son `core`, `web`, `rust`, `python` y `database`.
Los perfiles optativos no instalan stacks ni autorizan herramientas.

## 6. Datos y ubicaciones

Por defecto, el proyecto coloca bajo `.scopegrain/`:

| Datos | Ubicacion habitual |
| --- | --- |
| Configuracion, descubrimiento, catalogo y recursos | `config.json`, `discovery.json`, `catalog.json` y carpetas de recursos |
| Propuestas de anfitriones | `integrations/` |
| Planes, especificaciones y designs | `plans/`, `plans/specs/`, `plans/designs/` |
| Tareas | `tasks/` |
| Informes y revisiones | `reports/`, `reports/reviews/` |
| Investigacion | `research/` |
| Decisiones y aprobaciones | `decisions/`, `decisions/approvals/` |
| Lecciones y handoffs | `memory/lessons/`, `memory/handoffs/` |
| Estado y sesiones | `state/`, `state/sessions/` |

Las ubicaciones dependen de las rutas configuradas, no son destinos
universales fijos. Los documentos operativos no sustituyen ni se mezclan
por defecto con la documentacion del producto gestionado. Ver
[workflows](workflows.md) y [versionado en onboarding](onboarding.md).

## 7. Metodologia proporcional

`manual` conserva compatibilidad V1; `organic-sdd` elige ruta ligera o
formal segun hechos declarados; `sdd` exige referencias formales para
cambios. Una configuracion antigua sin campo se interpreta como `manual`
en memoria sin reescribir el archivo. Una tarea V2 conserva sus controles
aunque la configuracion posterior sea `manual`.

ODD significa Organic Driven Development. Intencion, autorizacion,
comprension, incertidumbre, riesgo y continuidad son declaraciones: el
tamano del cambio no demuestra seguridad. Riesgo desconocido, incertidumbre
no resuelta, comprension insuficiente o falta de autorizacion bloquean el
cambio. La ruta ligera conserva una tarea sin inventar la cadena de
artefactos formales; sigue requiriendo autorizacion declarada.

La ruta formal exige especificacion estructurada y design vinculados,
aprobaciones, alcance contenido y escenarios asignados. Cada tarea SDD,
incluso preparatoria, tiene al menos un escenario; el plan debe cubrir la
union completa de la especificacion. Ver [metodologia](methodology.md).

## 8. Ciclo de vida y consistencia

La progresion habitual es:

```text
PLAN -> ACT -> VERIFY -> [COLLATERAL] -> EVALUATE -> REVIEW -> ACCEPT -> CLOSE
```

`RESEARCH` y `STALL` son desvios previstos, no atajos arbitrarios, y
`ABANDON` es la salida terminal sin evidencia. Las
aristas exactas y retornos permitidos estan en
[flujo de tareas](task-workflow.md) y `policy/workflow.json`. Para el avance
formal, las dependencias transitivas deben estar en `CLOSE`.

Al volver a `ACT` se invalidan verification y review anteriores. Una nueva
verification tambien invalida la review previa salvo que se aporte otra en
la misma operacion. Las transiciones usan revision esperada, lock propio y
temporal exclusivo con rename; esto no es una transaccion global entre
todos los registros ni un bloqueo continuo de herramientas externas.

## 9. Aprobaciones y evidencia

`approval target/create/show/answer` separa descripcion del contenido,
solicitud, consulta y respuesta. Las respuestas incluyen opciones custom,
rechazo y revocacion segun el contrato; cambiar el contenido vinculado o
revocar una aprobacion puede impedir el siguiente gate. La respuesta usa
revision y digest esperados, revalidados bajo lock.

Los checks, la review y las identidades aportadas son attestations:
declaraciones registradas, no identidad autenticada ni observacion de una
ejecucion real. Los hashes vinculan registros y payloads declarados; no
prueban el worktree completo ni los bytes cambiantes de un log citado.
El informe formal liga la revision y los digests vigentes, sin convertir
el cuerpo aportado por el operador en prueba de verdad.

## 10. CLI

Ejemplos de sintaxis desde la raiz del repositorio:

```powershell
node ./bin/scopegrain.mjs inspect --project "C:\ruta\proyecto"
node ./bin/scopegrain.mjs init --project "C:\ruta\proyecto"
node ./bin/scopegrain.mjs doctor --project "C:\ruta\proyecto"
node ./bin/scopegrain.mjs catalog list command
node ./bin/scopegrain.mjs pipeline --project "C:\ruta\proyecto" --mode plan
node ./bin/scopegrain.mjs specification create --project "C:\ruta\proyecto" --input spec.json
node ./bin/scopegrain.mjs design create --project "C:\ruta\proyecto" --input design.json
node ./bin/scopegrain.mjs approval target --project "C:\ruta\proyecto" --input target.json
node ./bin/scopegrain.mjs approval create --project "C:\ruta\proyecto" --input approval.json
node ./bin/scopegrain.mjs outcome create --project "C:\ruta\proyecto" --input outcome.json
node ./bin/scopegrain.mjs methodology check --project "C:\ruta\proyecto" UUID --to ACT
```

Son ejemplos, no evidencia de ejecucion. Las creaciones JSON se previsualizan
por defecto y usan `--apply` explicito para escribir; los IDs previsualizados
no quedan reservados. Los verbos mutantes previsualizan en seco salvo
`--apply` — incluye `task create` (ambas formas), meta/disposition/note/
step/transition, goal create/transition, memory add, journal compact,
constitution set y los verbos VantaDB. El descubrimiento nunca ejecuta
los comandos encontrados.
Ver [onboarding](onboarding.md) y [workflows](workflows.md).

## 11. MCP opcional

El servidor MCP ofrece 38 herramientas estrictamente vinculadas al
proyecto y configuracion seleccionados al iniciar: 23 de solo lectura
(`READ_ONLY`), 4 que escriben estado local bajo la misma disciplina
CAS/lock que el CLI (`WRITE_LOCAL`: `scopegrain_next_task` con
`claimBy`, `scopegrain_task_meta`, `scopegrain_memory_add`,
`scopegrain_goal_create`), 2 de descarte (`WRITE_DISCARD`:
`scopegrain_task_disposition`, `scopegrain_goal_transition`, ambas con
`destructiveHint: true` por sus semanticas de descarte) y 6 de lectura
de backend (`READ_BACKEND`) que lanzan el binario `vantadb-server`
enrolado y llevan `openWorldHint: true`. Entre las de
lectura estan `scopegrain_specification_get`, `scopegrain_approval_get`,
`scopegrain_methodology_check`, `scopegrain_memory_read`,
`scopegrain_goal_list`, `scopegrain_context`, `scopegrain_metrics` y
`scopegrain_task_suggest` (sugerencia declarativa de skills por
metadatos de tarea; nunca escribe `task.skills`).

El transporte opcional es stdio. La carga del SDK es perezosa; las
dependencias declaradas son `@modelcontextprotocol/sdk` 1.27.1 y `zod`
4.5.4. Las herramientas no ejecutan shell ni inician red autonoma; los
argumentos van acotados en dos capas (esquema anunciado + techo de bytes
serializados) y los contenidos los valida el nucleo. La existencia de la
interfaz no implica arrancar un servidor ni certificar una integracion
nativa.

## 12. Propuestas para anfitriones

Las rutas siguientes son destinos propuestos, no archivos activados por
`init`. Los formatos y permisos deben revisarse para la version instalada.

| Superficie | Propuesta y limite |
| --- | --- |
| Claude Code | Skills y agentes bajo `.claude/`; lista de lectura solicitada para roles restringidos. |
| Codex | Skills bajo `.agents/skills/`; roles `.codex/agents/` y declaracion TOML para fusion manual. |
| OpenCode V2 | Puentes bajo `.opencode/`; V2 usa `permissions` y `mcp.servers`. Archivos V1 anteriores se conservan. |
| Devin Local/CLI | Skills y agentes bajo `.devin/`; allowlist propuesta para subagentes personalizados. Cloud no es equivalente certificado. |
| Antigravity App/CLI | Skills y agentes propuestos bajo `.agents/`; MCP propuesto deshabilitado hasta revision. |
| Antigravity IDE | Propuesta de skills; no se asume soporte de agentes personalizados. |

En Devin, `allowed-tools` inline significa autoaprobacion, no una allowlist
de disponibilidad; las skills inline generadas lo omiten. `.agents/` es una
convencion compartida y no aisla productos. Ninguna propuesta certifica
permisos, descubrimiento o comportamiento real en un anfitrion. Consultar
[formatos nativos](native-hosts.md).

## 13. Recuperacion y continuidad

La busqueda y el diagnostico de recursos comparan el snapshot y sus fuentes.
La restauracion solo recupera archivos ausentes con bytes compatibles y hash
correspondiente; no sobrescribe archivos divergentes. `session resume`
consulta estado, eventos y presupuesto registrado; no repite efectos.

Los fragmentos MCP contienen rutas machine-local: una reubicacion requiere
revision y rebind manual. Un lock existente ajeno o posiblemente obsoleto no
se rompe automaticamente. No se infiere autorizacion de recuperacion por la
mera presencia de una propuesta.

## 14. Temporales y rollback

Las escrituras relevantes usan apertura exclusiva `wx`; solo se limpian
locks y temporales cuya propiedad adquirio la operacion. El rollback de
archivos create-only retira archivos creados por esa operacion, no borra
directorios ni contenido preexistente. Los registros y evidencia existentes
no se eliminan como mecanismo general de recuperacion.

No se promete un recolector general, TTL, recuperacion automatica de locks,
ni durabilidad universal ante fallos de hardware o corte de energia.

## 15. Permisos, seguridad y FMEA

| Riesgo | Control y limite residual |
| --- | --- |
| Sustitucion local de rutas | Contencion y rechazo de enlaces en puntos de validacion; persiste una ventana TOCTOU. |
| Deriva entre archivos | Digests, CAS y locks locales; no hay transaccion serializable multiarquivo. |
| Confundir instrucciones con permisos | Gates y propuestas son controles del harness; Markdown no es sandbox ni intercepta todas las herramientas. |
| Evidencia o identidad falsa | Checks, actores, review y riesgo son declaraciones; no se autentican ni se observa toda la ejecucion. |
| Datos sensibles | Los cuerpos libres requieren revision y redaccion; no hay detector universal de secretos. |
| Rutas o versiones de host | MCP usa rutas absolutas locales y formatos dependientes del anfitrion; revisar y rebind manualmente. |
| Dependencias transitivas | Sin lockfile no se garantiza resolucion transitiva identica en cada instalacion. |

La inspeccion, las reglas y la evidencia no conceden permisos para red,
instalaciones, publicacion, escritura fuera de alcance u otros efectos.
Ver [seguridad](security.md) y [compatibilidad](compatibility.md).

## 16. Estado de verificacion

La suite cuenta actualmente **1703 pruebas** (conteo verificado en la
auditoria del 2026-11-24). La ultima ejecucion integral registrada
(`npm test` serial, 2026-11-23) reporto 1440 pruebas: 1435 pass, 5 fail
(4 inestables de la tanda larga que pasan aisladas y 1 fallo
pre-existente de `host-variants` reproducible en un worktree limpio de
`HEAD`), exit 1, en Windows con Node.js v26.8.1 y npm 11.6.0; los
commits posteriores ampliaron la suite sin una nueva integral
registrada. Las integrales intermedias (673, 699, 770, 813, 1152 y
1411) y las tandas anteriores de cada bloque son ejecuciones separadas,
no cifras sumables; su alcance y resultados historicos estan en
[verificacion](verification.md). No se deben sumar tandas historicas
como si fueran una sola suite del estado actual.

El piloto nativo de Devin Local quedo certificado en una sesion fresca real
el 2026-11-17: 42 skills `scopegrain-*` y 15 subagentes auto-cargados, MCP
`scopegrain` activo desde `.devin/mcp_config.json` y `scopegrain_status`
invocado (doctor con 16 checks y catalogo de 130 entradas integro por
hash). Antigravity se piloto primero el 2026-11-18 (activacion `.agents/`
aplicada y consumida por su sesion de agente) y su superficie App/CLI
completo el piloto nativo certificado en una sesion fresca real el
2026-11-19: 72 skills `scopegrain-*` y 15 subagentes auto-descubiertos,
MCP `scopegrain` activo desde `.agents/mcp_config.json` e invocaciones
en vivo de `scopegrain_status` y `scopegrain_catalog_list`. El piloto
nativo de OpenCode V2 quedo certificado en una sesion fresca real el
2026-11-23 contra `opencode v2.3.2`: 15/15 subagentes `scopegrain-*`
resueltos, 74 IDs de skill deduplicados con `.opencode/skills` ganando
precedencia sobre `.agents/skills`, el MCP `scopegrain` activo con
invocaciones en vivo de `scopegrain_status`, `scopegrain_catalog_list`
y `scopegrain_list_tasks`, y limpieza sin rastros en la configuracion
global. Los demas
anfitriones y superficies (Claude, Codex, la IDE de
Antigravity y Hermes) no tienen piloto nativo.
CI ya se despacho con exito (2026-11-18). Estas pruebas no
certifican anfitriones, versiones o sistemas operativos no probados.

## 17. Integracion continua

El [workflow de verificacion](../.github/workflows/verify.yml) se activa
por `workflow_dispatch` manual, por `push` a `develop`/`main` y por
`pull_request` hacia `develop`. Ya se ejecuto: la primera corrida remota
(run `44391417084` sobre `develop`, 2026-11-18) termino en verde en
todas las celdas de la matriz. El job `test` declara Node 22 y 24 sobre
`ubuntu-latest` y `windows-latest`, con `contents: read`, acciones
oficiales fijadas por SHA, checkout sin credenciales persistentes,
guarda de version de manifest en PRs que tocan `resources/` y limite de
180 minutos. Un segundo job `viewer` (ubuntu, 30 minutos) ejecuta
lint, typecheck, tests y build del visor.

Solo en runners, instala dependencias con `npm ci --ignore-scripts`,
`--no-package-lock`, `--no-audit` y `--no-fund`, y ejecuta `npm test`.
No hay despliegue o release en ese
workflow. No hay lockfile que garantice reproducibilidad exacta de las
dependencias transitivas.

## 18. Limitaciones y prioridades

1. Realizar pilotos aislados y autorizados por version y superficie nativa;
   los fixtures no sustituyen pruebas reales de permisos y recuperacion.
   Devin Local, Antigravity App/CLI y OpenCode V2 ya tienen su piloto
   certificado (sesiones reales, 2026-11-17, 2026-11-19 y 2026-11-23);
   quedan pendientes Claude, Codex, la superficie IDE de Antigravity y
   Hermes.
2. Resolver licencia y procedencia antes de conceder redistribucion.
   `package.json` ya declara licencia Apache-2.0, binario `scopegrain`,
   lista acotada de `files` y metadatos de repositorio; la publicacion
   en un registro externo sigue requiriendo autorizacion explicita del
   propietario y el material de `legacy/` permanece fuera de la
   distribucion a la espera de revision por pieza.
3. Decidir una estrategia de lockfile para mejorar reproducibilidad sin
   confundir versiones directas fijadas con transitivas fijadas.
4. Evaluar cualquier renombre tecnico como cambio independiente de
   compatibilidad; los identificadores existentes siguen vigentes.
5. Mantener explicitos los limites: no hay ejecutor global, sandbox de
   anfitrion ni garantia universal sobre permisos, ejecucion o resultados.

Repositorio de codigo: [ness-e/scopegrain](https://github.com/ness-e/scopegrain).
La estrategia de primera publicacion usa el mismo commit inicial en `main`
y `develop`: `main` como entrada publica y rama predeterminada, `develop`
para continuar el trabajo. El resultado de cada push se comprueba
separadamente en las referencias remotas; no se infiere del contenido de
este documento.
