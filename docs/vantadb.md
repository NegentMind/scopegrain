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
  backend: `{schemaVersion, backendId, version, binaryPath, storagePath}`.
  Documento cerrado; rutas absolutas obligatorias.

## Modelo de despliegue

- **Instancia compartida por maquina**: un unico storage (por defecto
  `~/.vantadb/data`). Cada proyecto escribe en namespaces derivados de su
  scope (`sg-formal-v1-<scopeHash>`, `sg-snapshot-v1-<scopeHash>`), por lo
  que la separacion es por namespace, no por proceso.
- **Auto-spawn por operacion**: `sync`/`get` lanzan `vantadb-server --mcp`
  con `VANTADB_STORAGE_PATH`, hablan JSON-RPC por stdio y el proceso muere
  al cerrar. El writer-discovery de VantaDB (`.vanta.server.json`) cubre
  clientes concurrentes sobre el mismo storage.
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

# Drenar eventos committed pendientes hacia VantaDB (auto-spawn)
scopegrain vantadb sync --project PATH [--limit N] [--timeout MS]

# Lectura puntual contra el backend (memory_get)
scopegrain vantadb get --project PATH --namespace NS --key K
```

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
