# Frontera de herramientas del harness

Las consultas MCP están vinculadas al proyecto seleccionado. El servidor
registra 37 herramientas `scopegrain_*` en cuatro clases de anotación:

- **Solo lectura local (23)** — `readOnlyHint:true, openWorldHint:false`:
  `approval_get`, `artifact_get`, `catalog_get`, `catalog_list`,
  `check_action`, `get_task`, `goal_list`, `inspect`, `list_tasks`,
  `mcp_inventory`, `memory_read`, `memory_status`, `methodology_check`,
  `metrics`, `plan_get`, `plan_next`, `resource_diagnose`,
  `resource_search`, `session_get`, `specification_get`, `status`,
  `task_suggest`, `workflow_packet`.
- **Solo lectura con backend (6)** — `readOnlyHint:true` PERO
  `openWorldHint:true`: `context`, `session_resume`, `memory_get`,
  `memory_search`, `memory_recall`, `memory_context`. Semántica de lectura,
  aunque el handler lanza el binario `vantadb-server` enrolado y envía
  datos (consultas, claves, IDs de registro) al backend de memoria
  configurado — la anotación anuncia honestamente el mundo externo que
  alcanzan.
  `memory_recall` usa por defecto un `memory_search` acotado al proyecto
  sobre `l1/sg-<projectHash>` (solo los registros de este proyecto); un
  `scope` explícito (`session`/`agent`/`team`) opta deliberadamente al
  pool `memory_recall` del engine, que es machine-global en
  `agent`/`team` y puede devolver memorias de otros proyectos — opt-in
  documentado, no una fuga.
- **Escritura local (6)** — `WRITE_LOCAL`: `next_task` (solo escribe cuando
  `claimBy` está fijado — si no, es una lectura), `task_meta` (parche de
  metadatos CAS), `task_transition` (transición CAS del FSM de tareas),
  `task_create` (creación de registros de tarea), `memory_add`,
  `goal_create`. Todas mutaciones acotadas registradas en journal.
- **Escritura de descarte (2)** — `WRITE_DISCARD`, `destructiveHint:true`:
  `task_disposition`, `goal_transition`. Semántica de descarte — una
  disposición `discarded`/`cancelled` o un goal `dropped` archiva trabajo —
  aunque la escritura en sí sea un parche CAS acotado.

La creación de tareas y las transiciones del ciclo de vida ahora están
disponibles vía MCP — revisiones anteriores las mantenían deliberadamente
solo en CLI para que un agente sin shell no pudiera conducir la FSM de
punta a punta; la decisión se revirtió para agentes solo-MCP. Ambas
mantienen la disciplina del CLI: `task_transition` y `task_create`
previsualizan por defecto (`mode:"dry-run"`, el registro exacto que la
escritura almacenaría, gates metodológicos incluidos) y solo `apply:true`
confirma; un `CLOSE` aplicado archiva el resultado en el log de progreso
(best-effort), igual que `task transition --apply`. `task_create` acepta
el documento `input` completo (claves de `task create --input`) o la
forma de campos planos; ambas son mutuamente excluyentes. Otras
mutaciones permanecen explícitas a través de operaciones CLI de apply.

Cada resultado de herramienta lleva `structuredContent` junto al bloque
de texto JSON (los payloads no-objeto se envuelven como `{result: ...}`),
y cada herramienta anuncia un `outputSchema`: un esquema de objeto
superficial tipado en las herramientas de alto tráfico (`context`,
`task_*`, `next_task`, `memory_*`, `catalog_*`, `goal_*`, `metrics`,
`check_action`, `plan_next`) y un objeto permisivo con
`additionalProperties` en el resto.

Las lecturas de catálogo (`catalog_list`, `catalog_get`,
`workflow_packet`, `resource_search`, `resource_diagnose`) aún realizan
una escritura deliberada: `loadWorkspaceCatalog` persiste un registro
solo-fingerprint bajo `<paths.state>/cache/` para no re-hashear un
catálogo verificado en cada llamada. El registro no almacena contenido
del catálogo y la escritura es best-effort — un state dir no escribible
nunca falla la lectura. `readOnlyHint` es honesto sobre la semántica de
dominio, no sobre esta contabilidad de caché derivada.

Las anotaciones de herramientas no crean control de acceso ni autorizan
acciones nativas. Stdout pertenece a los mensajes del protocolo; el
logging de diagnóstico usa stderr. Las pruebas del SDK instalado y la
interoperabilidad con host real son evidencias separadas.

## Mantener un inventario de herramientas (cualquier harness)

Cuando un host expone herramientas MCP o de plugins, mantén un archivo de
inventario canónico y trátalo como un artefacto mantenido:

- **Fuente de verdad:** los archivos de config del host (a nivel proyecto +
  global) y el comando `list` en vivo — no este documento. Verifica el
  estado con llamadas reales, no solo con declaraciones de config.
- **Modos de acceso:** registra cómo se alcanza cada servidor. Algunos hosts
  exponen herramientas nativamente en el toolset del agente; otros solo a
  través de una llamada indirecta execute/sandbox. La exposición nativa
  cuesta contexto de prompt — gástalo en las pocas herramientas de alto
  valor. Regla general: si una herramienta aparece en tu toolset, llámala
  directamente; si no, vive detrás de la llamada indirecta.
- **Actualiza en el mismo commit** que cambia la config del servidor.
  Regenera la lista desde la herramienta en vivo en lugar de editarla a
  mano.
- **Desactivados por defecto:** registra qué servidores están
  deliberadamente apagados y por qué (coste de contexto, clave ausente,
  proveedor degradado). Un servidor deshabilitado es una decisión, no un
  accidente.
- **Proveedores tras agregadores:** no actives un proveedor como servidor
  suelto cuando un agregador ya lo envuelve con seguimiento de presupuesto
  y fusión; habilítalo en la config propia del agregador.

## Orden de búsqueda de código (cuando existen herramientas de grafo)

Si el host ofrece una herramienta de code-graph / índice semántico, úsala
antes que la búsqueda de texto:

| # | Capacidad | Uso |
|---|---|---|
| 1 | Explore (símbolo → fuente + rutas de llamada + blast radius en una llamada) | Primera opción; confía en el resultado, no lo re-verifiques con grep |
| 2 | Búsqueda en grafo (BM25/semántica sobre todo el repo) | Puente de vocabulario para encontrar símbolos |
| 3 | Trace path (callers/callees transitivos, flujo de datos) | Análisis de impacto |
| 4 | Get snippet (fuente exacta de un símbolo) | Tras la búsqueda, lectura precisa |
| 5 | Query graph (multi-hop, complejidad, rutas calientes, ciclos) | Preguntas estructurales |
| 6 | Vista de arquitectura (clusters, hotspots, fronteras) | Orientación |
| 7 | Detect changes (blast radius de un diff vs. una base) | Pre-commit / revisión de PR |
| 8 | Búsqueda de texto aumentada (grep ordenado por estructura) | Patrones textuales |
| 9 | Estado/cobertura del índice | Antes de confiar en el grafo |
| 10 | `grep` / `read` | Solo fallback: configs, docs, archivos no indexados, confirmar un detalle |

Si el grafo reporta un aviso de pending-sync, lee el archivo directamente;
si no existe índice, las herramientas normales son la respuesta.

## Cuándo usar cada grupo

| Necesidad | Primer recurso |
|---|---|
| Estructura/símbolos del código del repositorio | Las herramientas de code-graph de arriba |
| Investigación web | La cascada de búsqueda documentada del proyecto (primero sin clave, luego multi-motor, luego extracción profunda) |
| Estado de tareas/workflow | Las herramientas de tareas del harness vinculado |
| Verificación de navegador/visual | Una herramienta de navegador real (capturas, auditorías, red) |
| Documentos compartidos del equipo | La integración de docs del proyecto |
| Gestión de sesión/modelo | Las propias herramientas de sesión del host |

Un servidor marcado "no usar" para un rol dado es una decisión de ahorro de
contexto: la herramienta existe pero su coste supera su valor para ese rol.

<!-- Cross-references: → see graph-investigation.md, task-domain.md, skills-engineering.md -->
