# Arquitectura

Scopegrain es un paquete Node.js ESM privado (Node >=22). El nucleo es
sincronico, sin dependencias externas y sin `child_process`, sockets ni
escritura fuera del proyecto explicitamente indicado. El servidor MCP es
opcional y carga sus dependencias (`@modelcontextprotocol/sdk`, `zod`) de
forma perezosa al arrancar. La API HTTP local del visor es opt-in:
`node:http` puro, bind exclusivo a loopback y solo GET; `viewer/` es un
paquete separado con toolchain propio.

## Modulos

```text
bin/scopegrain.mjs        Entrada del binario; delega en src/cli.mjs
bin/tasksystem.mjs        Alias compatible; delega en src/cli.mjs
src/cli.mjs               Parser de comandos (incl. ciclo de vida, investigate, host activate, capture proposals/review, view) y flujos interactivos; IO inyectable
src/core/errors.mjs       Errores {code, message} (TaskError)
src/core/fsx.mjs          Helpers sincronicos de filesystem
src/core/paths.mjs        Rutas relativas seguras, contencion, anti-symlink
src/core/config.mjs       Contrato de config.json, answers y colisiones
src/core/context.mjs      Vincula project root explicito + config cargada
src/core/workspaces.mjs   Identidad por proyecto, areas, autorizacion interna de scope y descriptor owned mutable
src/core/journal.mjs      Journal interno create/update con CAS bajo lock y outbox acotado
src/core/record-history.mjs Validadores puros de update changes y coherencia de cadena create/update
src/core/capture-data.mjs Contratos puros de notas/ownership de captura
src/core/captures.mjs     Store tipado de capturas con prueba journal
src/core/capture-proposals.mjs Propuestas deterministicas de captura desde journal e init answers
src/core/record-ownership-data.mjs Primitivas puras del sidecar (capture/spec/design/report rev0)
src/core/record-ownership.mjs Prueba compartida de creacion committed de dos eventos
src/core/owned-specifications.mjs Store tipado de specs V2 con ownership probado
src/core/owned-designs.mjs Store tipado de designs V2 con ownership y binding de spec
src/core/owned-outcomes.mjs Store tipado de outcomes/report V2 con ownership probado
src/integrations/vantadb.mjs  Proyeccion MCP interna de eventos confirmados
src/core/policy.mjs       Carga las politicas canonicas del runtime instalado
src/core/tasks.mjs        Documentos de tarea, createTask, getTask, listTasks
src/core/catalog.mjs      Catalogo activo validado y proyeccion de recursos
src/core/resource-recovery.mjs Busqueda, diagnostico y restauracion por hash
src/core/workflows.mjs    Paquetes de procedimiento/contexto, sin ejecucion LLM
src/core/plans.mjs        Planes DAG, readiness desde tareas actuales y store owned mutable
src/core/artifacts.mjs    Artefactos operativos inmutables por UUID
src/core/specification-data.mjs Forma y tipos de especificacion/design
src/core/outcome-data.mjs  Forma del informe vinculado de resultado
src/core/specifications.mjs Especificaciones estructuradas y design vinculado
src/core/approvals.mjs    Aprobaciones por contenido, pregunta/respuesta CAS y store owned mutable
src/core/digests.mjs      JSON canonico y proyecciones estaticas
src/core/methodology-data.mjs Clasificacion pura y referencias de escenarios
src/core/formal-bindings.mjs Lecturas independientes y digests de relaciones
src/core/outcomes.mjs     Preparacion de informe vinculado al REVIEW actual
src/core/methodology.mjs  Gates ACT/ACCEPT y acciones efectivas compartidas
src/core/sessions.mjs     Operaciones registradas, CAS, presupuesto, resume y store owned mutable
src/core/versioning.mjs   Ignore propio y propuestas externas por categoria
src/core/evidence.mjs     Validacion de verification/review (attestations)
src/core/transition.mjs   Transiciones CAS con lock por tarea, checkAction y store owned mutable
src/core/bootstrap.mjs    Plan de init, preflight, apply con rollback
src/core/doctor.mjs       Chequeo de salud de solo lectura
src/core/docs-cli-drift.mjs Deriva docs<->CLI: verbos documentados vs superficie real
src/core/lifecycle.mjs    adopt/update/backup/restore/uninstall: previews y applies create-only
src/discovery/inspect.mjs Escaneo acotado de manifiestos
src/discovery/semantic.mjs Investigacion semantica acotada de solo lectura
src/hosts/render.mjs      Fragmentos de integracion por anfitrion
src/hosts/native.mjs      Propuestas nativas versionadas para siete hosts (generic = scaffold)
src/hosts/activation.mjs  Activacion opt-in create-only de propuestas locales al proyecto
src/hosts/host-manifest.mjs Manifesto por host: sha256 + ownership (whole/partial/shared)
src/adapters/            Entradas compatibles hacia src/hosts
src/core/managed-section.mjs Secciones SCOPEGRAIN:BEGIN/END en AGENTS.md/CLAUDE.md
src/core/host-cli.mjs     Deteccion de CLIs de host por filesystem (sin child_process)
src/core/mcp-inventory.mjs Inventario MCP auto-descriptivo derivado de los descriptors
src/core/operations.mjs   Descriptors de operacion compartidos (CLI/MCP parity)
src/core/active.mjs       Puntero de tarea activa: env SCOPEGRAIN_TASK sobre state
src/core/activity.mjs     Registro retroactivo de actividad: worklog, nunca tasks imposibles de cerrar
src/core/worklog.mjs      Logs JSONL acotados (lessons/outcomes/progress/goals/activity) con rotacion
src/core/converge.mjs     Findings tipados spec/plan/tasks vs codigo + veredicto
src/core/checklists.mjs   Checklists CHK### reviewer-owned con CAS
src/core/analyze.mjs      Analisis cross-artifact de cobertura y drift
src/core/clarify.mjs      Sesiones de aclaracion fechadas create-only
src/core/constitution.mjs Semver de constitucion + reglas de bump + history
src/core/story-tasks.mjs  Render tasks.md por user-story (T###, [P], fases USn)
src/core/placeholders.mjs Tokens {SCRIPT}/$ARGUMENTS/handoffs fail-closed en commands
src/core/hooks-policy.mjs Carga de policy/hooks.json declarativa (before_/after_)
src/core/jsonc.mjs        JSONC comment stripping + deep merge recursivo
src/core/distribution.mjs Catalog stack file://, composicion, bundles, extensiones, presets, mounted layer
src/core/workflow-runner.mjs Runner declarativo: ops whitelisted, checkpoints atomicos, resume
src/core/identifiers.mjs  Validador unificado de ids (slugs + reservados Windows)
src/core/locks.mjs        Locks verificados por token (acquire/release con {dev,ino})
src/core/helpers.mjs      Instalacion de helper scripts: JSON-stdio, copia acotada, tamper check
src/mcp/server.mjs        Servidor MCP stdio: lectura + mutaciones journaled acotadas
src/api/server.mjs        API JSON local read-only: loopback unico, solo GET
src/api/queries.mjs       Fachada de consulta con cotas duras para la API local
viewer/                   Visor local read-only (Vite/React/TS/Tailwind/shadcn), paquete aparte
assets/                   Recursos graficos SVG del proyecto
```

## Flujo de datos

```text
CLI (--project) -> resolveProjectRoot -> inspectProject -> answers
  -> createConfig -> buildInitPlan -> preflightPlan -> applyPlan
CLI task/doctor/mcp -> resolveContext -> loadConfig -> operaciones
```

- Toda ruta de proyecto viene de `--project` o de la configuracion cargada;
  nada se deriva ascendiendo desde la instalacion.
- Sin `--config`, la seleccion reconoce `.scopegrain/config.json` y la
  config legacy `.tasksystem/config.json`; dos entradas producen
  `CONFIG_AMBIGUOUS`. Una seleccion explicita no hace fallback.
- Un descriptor en `paths.state/workspace.json` identifica un unico
  `projectRoot`, proyecto, repositorio logico y areas. Se crea solo mediante
  enrolamiento explicito, independiente de bootstrap y config V1. Un binding
  interno conserva grants por area y exige todos los IDs de un scope;
  revalida la raiz y el digest antes de autorizar o resolver el repositorio.
  Una metadata ausente produce `WORKSPACE_NOT_FOUND`; si desaparece o cambia
  al revalidarlo, ese binding queda invalidado permanentemente con
  `WORKSPACE_STALE`; se requiere un nuevo binding explicito.
- Las areas son scopes logicos, no ACL del sistema operativo ni sandbox.
  La capa de workspace no conecta VantaDB ni implementa sincronizacion o
  autorizacion MCP; no autentica identidades ni aisla actores con acceso al
  mismo filesystem.
- El journal interno guarda snapshots, intent y outbox antes de mutar
  fuentes; solo una aplicacion completa permite el marcador committed,
  tanto en creates (`wx` exclusivo) como en updates CAS (dos fases:
  temporales fsync junto al destino, re-check de `previousHash` y rename).
  Un resultado incierto conserva la reserva activa y bloquea nuevas
  escrituras hasta una reconciliacion explicita futura. Un fallo al limpiar
  la reserva tras el marcador tambien bloquea escrituras, sin repetir la
  operacion. La paginacion del outbox no es una frontera de sincronizacion.
- El seam interno `applyJournaledRecordCreation` es para adaptadores tipados
  de confianza: el kernel genera una vez operationId/createdAt, entrega una
  copia congelada al callback sincrono y valida el resultado como cualquier
  cambio. Todas las fuentes propuestas deben ser creaciones nuevas; un noop
  es conflicto, nunca adopcion. No es API JSON, CLI ni captura activada.
- El seam mutable `applyJournaledRecordUpdate` es el gemelo estricto: cada
  change declara `previousHash` y la `sourceRevision` esperada; el CAS de
  bytes se comprueba antes del lock, bajo el lock antes de reservar
  secuencias y otra vez tras el staging de temporales. Las pre-imagenes
  quedan como snapshots content-addressed de auditoria sin restauracion
  automatica; no hay operaciones mixtas create/update.
  `record-history.mjs` aporta los validadores puros de cadena
  (`validateUpdateChange`, `resultingSourceRevision`,
  `validateRecordTransition`); el journal no indexa por record y la
  coherencia es un check del modelo de lectura.
- `createCaptureStore(ctx, options)` ata un binding autentico y una copia
  privada de config; solo crea la forma capture bajo `paths.memory` y la de
  ownership bajo `paths.state`, ambas en una unica operacion journal
  estricta de dos eventos. `get` exige sidecar canonico, scope autorizado,
  operacion committed de exactamente dos eventos, snapshots que coincidan
  con los bytes actuales y fuente actual igual al snapshot; no adopta
  archivos plausibles ni devuelve historial como actual. Una nota es una
  afirmacion aportada, no identidad autenticada, verdad activa ni
  autorizacion. Sin listados, escritor generico ni captura automatica; el
  CLI `capture create|show` solo aplica este contrato.
- La prueba de ownership de creacion es compartida entre stores tipados:
  `record-ownership.mjs` exige sidecar canonico, scope autorizado,
  operacion committed de exactamente dos eventos create, snapshots
  iguales a los bytes actuales y fuente actual igual al snapshot;
  `record-ownership-data.mjs` cierra la forma del sidecar para `capture`,
  `spec`, `design` y `report`, todos revision0. El JSON Schema estatico
  `schemas/record-ownership.schema.json` sigue siendo exclusivo de capture:
  no valida sidecars de spec, design ni report.
- `createOwnedSpecificationStore(ctx, { areaIds })`,
  `createOwnedDesignStore(ctx, { areaIds })` y
  `createOwnedOutcomeStore(ctx, { areaIds })` son stores opt-in congelados
  con exactamente `prepare`, `create` y `get`. Sus entradas cerradas son
  `{ areaIds, specification }`, `{ areaIds, design }` y
  `{ areaIds, outcome }`. Copian config/grants y clonan el DTO anidado a
  JSON plano; autorizan las areas explicitas all-of antes de preparar.
  Las areas logicas del grant viven en el sidecar/eventos, no se derivan
  de las rutas declaradas en `spec.data.scope`.
- Cada store usa su preparador tipado dentro del seam estricto:
  `prepareSpecification`, `prepareDesign` o `prepareOutcomeEvidence`.
  Las fuentes van a `<paths.plans>/specs/<uuid>.json`,
  `<paths.plans>/designs/<uuid>.json` o `<paths.reports>/<uuid>.json`;
  los sidecars a `<paths.state>/record-ownership/<sourceKind>/<uuid>.json`.
  Se conservan dos eventos create/revision0, hash de bytes exactos y
  recibos completos, incluso inciertos. `prepare` no escribe ni reserva
  IDs: el ID de preview no se reutiliza al crear. `get` valida los bytes
  probados del snapshot, no relee la fuente por el getter legacy.
- El design requiere una spec V2 estructurada cuyo digest coincida,
  aunque el padre no tenga ownership. `validateArtifactBindings` conserva
  esa comprobacion tanto en preparacion como en el getter owned, sin
  releer el design por `getArtifact`. Un outcome se prepara desde la tarea
  formal real en REVIEW, su verification y bindings sanos; sus digests
  son derivados, nunca aportados por el caller. El getter owned del
  report prueba bytes presentes y procedencia, sin volver a leer la tarea
  ni reevaluar sus bindings actuales. Los gates metodologicos siguen
  juzgando vigencia y elegibilidad para ACCEPT.
- Cinco stores owned mutables opt-in reutilizan ambos seams:
  `createOwnedTaskStore` (transition.mjs), `createOwnedApprovalStore`
  (approvals.mjs), `createOwnedSessionStore` (sessions.mjs),
  `createOwnedPlanStore` (plans.mjs) y `createOwnedWorkspaceStore`
  (workspaces.mjs). Cada uno define su sidecar mutable: tarea y
  aprobacion llevan una `chain` densa bajo `record-ownership/`; sesion y
  plan usan cabezas de cadena por dominio; el workspace usa un puntero
  con enrolamiento journal perezoso. El `get` es fail-closed y reprueba la cadena committed hasta
  el create; no hay adopcion, listados ni `prepareAnswer`; los gates de
  dominio corren dentro del callback del kernel. Son factorias del core:
  nada esta cableado a CLI ni MCP. Contrato completo en la
  [guia de ownership](record-ownership.md#ownership-mutable-con-historial-journal).
- El CLI `specification create|show --owned` adapta el store sin cambiar el
  modo legacy por defecto ni su nota de ayuda. `design create` y
  `outcome create` aceptan `--owned` opcional; los nuevos `design show` y
  `outcome show` lo exigen y fallan con `INVALID_ARGS` antes de acceder al
  contexto si falta. `artifact show design UUID` y
  `artifact show report UUID` conservan la lectura estructural sin afirmar
  ownership. El CLI local usa grants de todas las areas enroladas, pero
  cada entrada sigue pidiendo sus areas explicitas all-of. Sin
  autodeteccion de envolturas, enrolamiento/adopcion implicitos,
  productores automaticos ni hooks; la activacion nativa solo existe como
  comando explicito (`host activate`) y la de VantaDB solo via el enrolamiento
  explicito de `vantadb setup`.
  Contrato de resultados, errores y limites en la
  [guia de ownership](record-ownership.md#cli).
- Un ack local es una declaracion del adaptador, no prueba de ejecucion remota.
  Antes de exponer el journal a herramientas no confiables hacen falta
  adaptadores tipados y ownership de registros. El lock es cooperativo; no
  garantiza transacciones OS ni detecta toda manipulacion de head o historial
  sin una auditoria integral separada.
- La recuperacion explicita valida la operacion y sus scopes bajo el lock,
  conserva un recibo inmutable y nunca adopta ni modifica las fuentes.
  Solo un marcador existente permite finalizar como committed; el abandono
  conserva un resultado no confirmado. Sin reserva activa el listado no
  detecta indices historicos ausentes; una pagina vacia no prueba sincronizacion.
- La proyeccion VantaDB es un puente interno, inyectado y sin proceso nativo:
  envia solo eventos historicos confirmados y snapshots verificados por
  `memory_get`/`memory_put`, con claves inmutables y readback. Permite
  reconciliacion al reintentar explicitamente, sin prometer CAS ni una sola
  escritura fisica. El ack local
  declara lo verificado por el adaptador, no autentica el backend. La entrega
  del estado actual requiere ownership y comprobaciones de hash posteriores;
  no hay activacion de escritores, captura automatica, gateway ni motor.
  Un lease cooperativo limita el trabajador sin retener el lock del journal
  durante llamadas remotas; el timeout es contrato del cliente, no
  garantia para callbacks arbitrarios. El cliente concreto vive en
  `src/integrations/vantadb-runtime.mjs`: descarga el binario oficial
  verificado por sha256 solo dentro de `vantadb setup --apply`, spawnea
  `vantadb-server --mcp` por operacion con `VANTADB_STORAGE_PATH` sobre una
  instancia compartida por maquina, y cierra el proceso al terminar. Ver
  [vantadb.md](vantadb.md).
- `policy/workflow.json` define estados, aristas, acciones y aceptacion
  base. `policy/methodology.json` define el contrato metodologico.
  Los gates agregan controles; no crean otra maquina de estados.
- Las plantillas en `templates/` se renderizan con sustitucion de
  placeholders; despues del render se exige que no quede ningun `{{`.
- Los comandos descubiertos son propuestas (`approved:false`), jamas
  ejecutados por el harness.
- `resources/manifest.json` indexa las fuentes canonicas y sus aliases.
  El catalogo generado fija el snapshot del proyecto y hashes; los paquetes
  no sustituyen silenciosamente sus bytes por los de otra instalacion.
- Los procedimientos los interpreta el anfitrion. Scopegrain no crea
  clientes LLM ni ejecuta subagentes por tener una definicion de rol.
- La politica de onboarding propone todos los artefactos dentro de
  `.scopegrain/`; las ocho preferencias de versionado no autorizan
  modificar el Git del proyecto ni publicar datos privados.

## Decisiones relevantes

- **Contencion real:** contencion lexica mas rechazo de symlinks/junctions en
  cada ancestro existente; el root elegido debe existir y ser directorio
  real. `project.root` queda fijado a `"."` para mantener la config
  reubicable; el root real se pasa siempre en runtime.
- **Escrituras:** solo despues de preflight completo, con flag exclusivo
  `wx`. Un destino identico es no-op; distinto, enlace o directorio bloquea
  todo el plan antes de escribir nada. El rollback retira unicamente los
  archivos creados por esa operacion; no borra directorios.
- **Re-init:** si la config existe y coincide con las respuestas, y el
  fingerprint de descubrimiento no cambio, se preserva el objeto config
  completo y los bytes originales de `config.json` y `discovery.json`
  (formato, orden, comandos de verificacion aprobados, evidencia original);
  la reejecucion es un no-op cuando tambien coinciden los demas contenidos
  generados. Un snapshot antiguo OpenCode V1/V2 puede producir
  `PLAN_CONFLICT` con el generador V2, sin modificar los archivos anteriores.
  Si `discovery.json` fue borrado, se
  replantea como archivo nuevo con la serializacion actual. Si cambio el
  fingerprint, los contenidos difieren y el preflight bloquea con
  conflicto explicito (reconciliacion manual).
- **Tareas:** lock por archivo `<id>.json.lock` abierto con `wx`; un lock
  existente es conflicto y nunca se recupera automaticamente. Escritura
  atomica via temporal exclusivo + rename; `finally` solo limpia el lock y
  el temporal propios.
- **Evidencia:** verification y review son attestations declaradas; `ACT`
  las invalida y una verificacion nueva invalida la review previa.
- **Metodologia:** el clasificador puro no importa almacenamiento ni gates.
  Los getters validan la forma de registros historicos; los gates resuelven
  sus referencias actuales sin convertir una perdida ajena en TypeError.
  La preparacion de un outcome usa el REVIEW real, no hashes del caller.
- **Consistencia local:** la transicion revalida su candidato bajo lock y
  comprueba metodologia antes del temporal/rename. `checkAction` y paquetes
  usan la misma evaluacion de acciones, evitando un `edit` paralelo sin gate.
  Esto no es una transaccion serializable entre todos los archivos.
- **Configuracion vinculada:** el contexto conserva la configuracion
  cargada al resolverlo o iniciar MCP; cambios requieren nueva resolucion
  o reinicio. Las copias de politicas en el proyecto son referencias,
  no overrides de las politicas del runtime instalado.
- **Ciclo de vida:** adopt/update/backup/restore/uninstall re-ejecutan su
  preview dentro del apply antes de mutar (create-only: nada existente se
  sobrescribe ni se fusiona); uninstall borra solo archivos que siguen
  byte-identicos al preview.
- **Descubrimiento:** profundidad <=4, <=1000 entradas, manifiestos <=128
  KiB de una lista permitida; sin seguir enlaces; carpetas puntuales
  excluidas (`.git`, `node_modules`, `vendor`, `.venv`, `venv`, `target`,
  `dist`, `build`, `coverage`, `legacy`, `.tasksystem`, `.scopegrain`, y todo
  nombre que comience por punto salvo `.github`).
- **Fingerprint:** sha256 sobre el arreglo ordenado de
  `JSON.stringify([ruta, tamano, contenido])` por manifiesto admitido, mas
  `JSON.stringify([ruta, 'lockfile'])` por cada lockfile reconocido
  (solo presencia; su contenido nunca se lee). No incluye fecha ni ruta
  absoluta; los manifiestos omitidos por tamano aportan `null` como
  contenido pero conservan ruta y tamano. Anadir o quitar un lockfile
  cambia el fingerprint, porque cambia las propuestas de comandos.

## Esquemas publicados

`schemas/` es la superficie de contratos legible por maquina: cada JSON
Schema (draft 2020-12) describe una forma cerrada que el runtime produce,
persiste o acepta. Son contratos descriptivos, no validadores: la
validacion efectiva ocurre siempre en los validadores del runtime, el
codigo es la autoridad y un esquema que diverge se corrige para describir
la realidad, nunca al reves. Los limites que JSON Schema no puede expresar
(cronologia, coherencia entre campos, CAS) quedan anotados en el
`description` de cada esquema.

| Esquema | Contrato |
|---|---|
| `answers.schema.json` | Respuestas del init interactivo; fingerprint por bytes en sesiones de init |
| `capture.schema.json` | Nota de captura selectiva |
| `record-ownership.schema.json` | Sidecar de ownership (exclusivo de capture) |
| `specification-data.schema.json` | Datos `data` de spec V2 estructurada |
| `design-data.schema.json` | Datos `data` de design V2 vinculado a spec |
| `outcome-data.schema.json` | Datos `data` de report V2 (outcome) |
| `workspace.schema.json` | Descriptor de identidad de workspace (`paths.state/workspace.json`) |
| `journal-intent.schema.json` | Intent de journal (eventos create/update homogeneos) |
| `journal-commit.schema.json` | Marcador de commit de operacion |
| `journal-recovery.schema.json` | Recibo de recuperacion (`finalize-committed`/`abandon-prepared`) |
| `approval.schema.json` | Registro de aprobacion por contenido con historial |
| `organic-assessment.schema.json` | Assessment metodologico persistido en tareas V2 |

La conformidad es un gate real: `tests/schemas.test.mjs` persiste o deriva
registros con las APIs reales (workspace, intents create/update, commit,
ambos recibos de recovery, aprobaciones pending/answered/revoked y
assessments normalizados) y exige que satisfagan cada esquema con un
comprobador acotado del subconjunto draft-2020-12 usado — sin dependencia
de ajv. Un cambio de forma que rompa el contrato hace fallar el test;
un esquema editado con keywords fuera del subconjunto falla en voz alta.

## Limites estructurales

- La deteccion de stack se basa en manifiestos, no en `src/`; un stack sin
  manifiesto reconocido permanece desconocido.
- `src/discovery/semantic.mjs` agrega una capa semantica acotada de solo
  lectura (probes fijos, allowlist de manifiestos, senales con evidencia y
  confianza, records de investigacion); aun asi el escaneo no comprende el
  proyecto: la investigacion real sigue siendo labor del agente, exigida
  por las instrucciones generadas.
- Las propuestas MCP son fragmentos machine-local; no se fusionan con la
  configuracion activa del anfitrion ni se registran automaticamente.
  `src/hosts/activation.mjs` aplica opt-in solo propuestas de archivo
  completo con destino dentro del proyecto (create-only, mismas reglas de
  bootstrap); los merges en config compartida y las rutas globales (`~/`)
  son siempre manuales.
- La API local (`src/api/`) es una comodidad read-only sin auth mas alla
  del bind loopback: no es un host de produccion y el puerto no debe
  exponerse.
- La proyeccion nativa usa formatos de permisos documentados por host,
  sin instalarlos. Sus alcances no son equivalentes ni constituyen
  aislamiento universal del harness; no se generan hooks ejecutables.
- El estado se controla solo para operaciones que pasan por Scopegrain; no
  se interceptan herramientas nativas.
- Las comprobaciones de contencion rechazan enlaces en los puntos de
  validacion, pero no constituyen aislamiento del sistema operativo contra
  sustituciones concurrentes hostiles de ancestros del filesystem.
- Los digests vinculan registros/payloads, no el worktree ni los bytes de
  un archivo citado. Identidades, riesgo y resultados son declaraciones.
  Ver [Organic y SDD](methodology.md) para los contratos y limites.
- Los updates journalizados declaran `previousHash` y `sourceRevision`
  como procedencia CAS: el kernel rechecka bytes bajo lock pero no
  verifica la revision contra operaciones previas (no hay indice por
  record). Escritores ajenos al journal pueden intercalar y la prueba
  owned falla cerrado ante la deriva, sin prevenirla ni revertirla.
- Limites TOCTOU declarados: las verificaciones `lstat`/`readFileLimited`
  y la escritura `temp+rename` estan separadas por una ventana en la que
  un proceso concurrente con acceso al directorio puede sustituir el
  destino. El diseno reduce la ventana (re-preflight en apply, create
  exclusivo `wx`) pero no la elimina: la garantia es deteccion
  (conflict/drift), no exclusion mutua con actores ajenos al lock.
  En Windows la comparacion de identidad de rutas sigue la semantica
  case-insensitive del filesystem; un atacante que pueda alternar el
  case de un componente dentro de la ventana queda fuera del modelo.
- Modelo de persistencia de artefactos: flow-forward. Los artefactos
  formales (specs, designs, outcomes, checklists, clarifications,
  convergence records) son inmutables una vez creados: una nueva
  iteracion produce un nuevo record encadenado (o un nuevo archivo
  create-only), nunca una reescritura in-place del historial. El estado
  mutable deliberado queda confinado a punteros explicitos
  (`active-task`, `head` del journal) y a indices derivados, siempre
  con CAS.
