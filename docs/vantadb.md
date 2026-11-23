# VantaDB como backend de memoria

Scopegrain puede proyectar los eventos `committed` del journal interno a una
instancia de VantaDB compartida por maquina. La integracion es opt-in:
nada descarga, instala ni sincroniza sin un comando explicito.

## Componentes

- `src/integrations/vantadb.mjs` — proyector interno (lease cooperativo,
  readback, fail-closed `BRAIN_*`). No spawnea procesos: recibe `invoke`.
- `src/integrations/vantadb-runtime.mjs` — runtime: descarga verificada del
  binario, cliente MCP stdio (JSON-RPC NDJSON), enrolamiento y sync.
- `.scopegrain/vantadb.json` (o el dir de config elegido) — enrolamiento del
  backend: `{schemaVersion, backendId, version, binaryPath, binarySha256,
  storagePath}`. Documento cerrado; rutas absolutas obligatorias.
  `binarySha256` es obligatorio: el digest 64-hex pineado en el
  enrolamiento se verifica contra el binario antes de cada spawn, asi
  que un binario sustituido tras el enrolamiento falla
  (`VANTADB_HASH_MISMATCH`/`VANTADB_CONFIG_MALFORMED`) en vez de
  ejecutarse.

## Modelo de despliegue

- **Instancia compartida por maquina**: un unico storage (por defecto
  `~/.vantadb/data`). Cada proyecto escribe en namespaces derivados de su
  scope (`sg-formal-v1-<scopeHash>`, `sg-snapshot-v1-<scopeHash>`), por lo
  que la separacion es por namespace, no por proceso.
- **Auto-spawn por operacion**: `sync`/`get` lanzan `vantadb-server --mcp`
  con `VANTADB_STORAGE_PATH`, hablan JSON-RPC por stdio y el proceso muere
  al cerrar. El writer-discovery de VantaDB (`.vanta.server.json`) cubre
  clientes concurrentes sobre el mismo storage. El entorno del spawn es
  una allowlist explicita — el hijo solo recibe las claves pineadas
  (`VANTADB_STORAGE_PATH`, `VANTADB_QUIET`, `VANTADB_MCP_PROFILE=brain`
  para que los perfiles restringidos rechacen tools no listadas,
  `VANTADB_MCP_INJECT_NAMESPACES=l1/` como ACL de inyeccion): nada mas se
  hereda del padre, asi ni `VANTADB_MCP_*` externos ni variables con
  credenciales pueden filtrarse al proceso.
- **Egreso sin secretos**: antes de proyectar o sincronizar cualquier
  payload hacia el backend, `secretEgressCheck` lo criba contra nombres
  de fichero sensibles (`.pem`, `id_rsa`, `credentials`, ...) y patrones
  de contenido credencial de alta confianza (claves privadas PEM, tokens
  GitHub/Slack/Google, `password=`/`"apiKey":` con valor largo, ...). Un
  hit bloquea la proyeccion devolviendo solo una etiqueta de patron —
  los bytes coincidentes nunca se copian a reportes ni logs.
- **Distribucion**: assets oficiales de GitHub releases (`ness-e/Vantadb`),
  verificados contra el sidecar `.sha256` antes de adoptarse. Un mismatch
  produce `VANTADB_HASH_MISMATCH` y no adopta nada.

## Comandos

```bash
# Vista previa (no descarga ni escribe nada)
scopegrain vantadb setup --project PATH

# Enrolamiento: descarga/verifica el binario y persiste la config
scopegrain vantadb setup --project PATH --version 0.9.0 --apply

# Binario local explicito (sin descarga)
scopegrain vantadb setup --project PATH --binary /abs/vantadb-server --apply

# Estado: enrolamiento, presencia del binario, eventos pendientes
scopegrain vantadb status --project PATH

# Estado + sonda de capacidades (un spawn; reporta el provider de
# embeddings: fallback, model_present, status y notice del backend)
scopegrain vantadb status --project PATH --probe [--timeout MS]

# Drenar eventos committed pendientes hacia VantaDB (auto-spawn)
scopegrain vantadb sync --project PATH [--limit N] [--timeout MS]

# Lectura puntual contra el backend (memory_get)
scopegrain vantadb get --project PATH --namespace NS --key K

# Listar claves de un namespace (memory_list; --cursor pagina via next_cursor)
scopegrain vantadb list --project PATH --namespace NS [--cursor N]

# Busqueda hibrida en un namespace (memory_search;
# --mode keyword|vector|hybrid fuerza el search_profile del engine)
scopegrain vantadb search --project PATH --namespace NS --query TEXT [--top-k N] [--mode keyword|vector|hybrid]

# Recall de memoria L1 con RRF dual-pool (memory_recall)
scopegrain vantadb recall --project PATH --query TEXT [--scope session|agent|team] [--top-k N]

# Refuerzo de confianza declarado por el host (memory_reinforce;
# used +0.05, corrected/unused -0.10 — los registros derived se rechazan)
scopegrain vantadb reinforce --project PATH --namespace NS --key K --outcome used|corrected|unused

# Rehidratacion por record: busca su recordId en todos los
# namespaces sg-formal-v1-* proyectados (una sesion stdio)
scopegrain vantadb context --project PATH --record-id ID [--top-k N] [--limit N]

# Dual-write L1: un MemoryRecord episodico curado por evento
# remoto-verificado (acked) — hace los eventos visibles a memory_recall
scopegrain vantadb distill --project PATH [--limit N] [--timeout MS]

# Worklogs operativos (lessons/outcomes/progress/goals de paths.memory)
# como MemoryRecords L1 — clave por digest del contenido (idempotente)
scopegrain vantadb sync-memory --project PATH [--limit N] [--timeout MS]
```

`distill` escribe en `l1/sg-<scopeHash>` (prefijo `l1/*` = pool de recall
cross-session) un `MemoryRecord` valido (`type: episodic`,
`agent_id/team_id: default`, `session_key: scopegrain`) con un resumen
determinista por linea. Clave `sg-event-<eventId>` — re-ejecuciones son
upserts idempotentes. La verdad formal sigue en `sg-formal-v1-*`; los
registros L1 son derivados y su metadata apunta al registro formal.

`sync-memory` proyecta los worklogs operativos locales
(`.scopegrain/memory/{lessons,outcomes,progress,goals}.jsonl` — el almacen
autoritativo, sin cambios) al mismo namespace `l1/sg-<scopeHash>` del
proyecto, clave `sg-worklog-<log>-<digest16>` derivada del contenido:
entradas sin cambios se reportan como `skipped` y las re-ejecuciones no
generan duplicados. Cada registro lleva `metadata.record_type:
'sg-worklog'` (filtrable por `memory_list.filters`), `log`, `entryDigest`,
`taskId` y `kind`, y la entrada completa en el payload.

Los verbos de lectura (`get`/`list`/`search`/`recall`) son proxies acotados
sobre el mismo canal stdio: auto-spawn del servidor, validacion de
argumentos antes de tocar config, sin escrituras locales.

Las superficies de rehidratacion (la seccion `vantadb.recall` del paquete
`context` y `vantadb.context` de `session resume`) adjuntan
`prependContextEstimate` (`{estimatedTokens, estimator, bytes}`) cuando la
respuesta incluye un `prepend_context` en texto, medido tras el cap de
caracteres aplicado por el harness. Es una estimacion heuristica local
`utf8-bytes/4`, nunca el conteo del tokenizer del anfitrion; un
`prepend_context` ausente o no texto no produce el campo.

## Tools MCP `scopegrain_memory_*`

El servidor MCP expone herramientas `memory_*` adicionales. Cinco son de
solo lectura:

| Tool | Equivale a |
|---|---|
| `scopegrain_memory_status` | `vantadb status` (enrolamiento, binario, pendientes) |
| `scopegrain_memory_get` | `vantadb get` (`memory_get`) |
| `scopegrain_memory_search` | `vantadb search` (`memory_search`; `query` opcional, `topK` 1..100) |
| `scopegrain_memory_recall` | `vantadb recall` (`memory_recall`; `scope` session/agent/team, `topK`) |
| `scopegrain_memory_context` | `vantadb context` (rehidratacion por `recordId` sobre namespaces `sg-formal-v1-*`) |

Sin enrolamiento devuelven `VANTADB_NOT_CONFIGURED` como error estructurado;
los argumentos se validan por el bound del ctx, sin redireccion a otras rutas.

Dos tools `memory_*` adicionales operan sobre el worklog operativo local
(no sobre VantaDB; no requieren enrolamiento):

| Tool | Equivale a | Anotacion |
|---|---|---|
| `scopegrain_memory_add` | `worklog append` (`log` = lessons\|outcomes\|progress) | mutante |
| `scopegrain_memory_read` | `worklog read --tail N` | read-only |

## Errores y limites

- `VANTADB_NOT_CONFIGURED` — sync/get sin enrolamiento previo.
- `VANTADB_BINARY_MISSING` — el binario enrolado desaparecio; re-run setup.
- `VANTADB_UNSUPPORTED_PLATFORM` — sin asset upstream para la plataforma.
- `VANTADB_DOWNLOAD_FAILED` / `VANTADB_HASH_MISMATCH` /
  `VANTADB_EXTRACT_FAILED` — cadena de suministro fail-closed.
- `VANTADB_TIMEOUT` / `VANTADB_PROCESS_EXIT` / `VANTADB_PROTOCOL` /
  `VANTADB_RPC_ERROR` — fallos del canal stdio.
- `VANTADB_INVALID_INPUT` — namespace/key fuera de cota.
- `VANTADB_CONFIG_MALFORMED` — `.scopegrain/vantadb.json` invalido.

## Limites deliberados

- La red solo se toca dentro de `setup --apply` (o de un `sync`/`get`
  explicito, que solo abre el proceso local). El preview no descarga.
- El cache de binarios vive en `~/.scopegrain/vantadb/<version>/`;
  reinstalar reutiliza sin nueva descarga.
- `memory_put` remoto se considera *uncertain* si el canal muere a mitad
  (`BRAIN_REMOTE_UNCERTAIN`); el ack local solo se emite tras readback.
- Windows ARM64 no tiene asset upstream todavia.
