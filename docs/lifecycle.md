# Ciclo de vida del producto

El bloque de ciclo de vida (`src/core/lifecycle.mjs`) completa la superficie
operativa del harness: `init` crea, `doctor` diagnostica, y este modulo
cubre adoptar, actualizar, respaldar, restaurar y desinstalar. Cada verbo
expone una vista previa de solo lectura (`prepare*`) y, cuando aplica, una
operacion mutante (`apply*`) de semantica create-only.

Reglas comunes:

- Las vistas previas no escriben, no crean directorios y no reservan
  identificadores. Un `prepare` nunca es prueba de que el estado siga igual.
- Cada `apply` vuelve a ejecutar su `prepare` internamente y reverifica
  bytes, destinos y hashes inmediatamente antes de mutar.
- Nada existente se sobrescribe ni se fusiona: los destinos ocupados son
  conflictos reportados, y toda escritura usa `wx` exclusivo via
  `applyPlan` (preflight completo y rollback de solo lo creado). Dos
  excepciones documentadas y acotadas: la accion `managed` de `update`
  reescribe in-place solo la region `SCOPEGRAIN:BEGIN..END` de un archivo
  que opto por ella, y `update --reconcile` reescribe archivos divergentes
  demostrablemente generados (unlink + `wx`, mismo preflight) — nunca
  contenido ajeno.
- Las rutas se validan con `assertDestination`/`resolveInside`: sin
  absolutas, unidades, UNC, `..`, prefijos reservados
  (`.git`/`node_modules`/`legacy`/`.opencode`) ni ancestros enlazados. Los
  enlaces simbolicos nunca se siguen; se reportan y se omiten.
- Las entradas son objetos cerrados; claves desconocidas producen
  `LIFECYCLE_INVALID_INPUT`. La config se clona antes de usarse.
- `ctx` es el resultado de `resolveContext`: `{projectRoot, configPath,
  configDir, config}`.

## adopt

`prepareAdopt(projectRoot, options?)` detecta un proyecto ya inicializado y
reporta lo que adoptar vincularia. No existe `applyAdopt`: la adopcion no
escribe nada.

```js
{
  mode: 'dry-run', projectRoot, configRel, config,
  workspace, journalState, status, issues
}
```

- `configRel` es la config resuelta (`.scopegrain/config.json`);
  `options.config` fuerza una ruta explicita.
  Sin config valida queda en `null` con un issue (`CONFIG_NOT_FOUND`,
  `MALFORMED_JSON`, `CONFIG_VERSION`, ...).
- `config` resume `{name, locale, hosts, methodology, paths}` cuando la
  config carga.
- `workspace` resume `{rel, workspaceId, revision, areas}` cuando existe
  enrolamiento valido; la ausencia es neutral (el enrolamiento es opt-in),
  un descriptor malformado es un issue.
- `journalState`: `absent` (sin directorio journal), `idle`, `active`
  (head con `activeOperation`), `attention` (head malformado, head
  ausente con historial, o el journal no es directorio) o `unknown` cuando
  la config no carga y las rutas son indeterminables.
- `status`: `adoptable` o `attention`. La adopcion nunca reinicializa:
  para inicializar un proyecto sin config se usa `init`.

## update

`prepareUpdate(ctx, {installRoot?}?)` reconstruye el plan de archivos
generados por el harness (plantillas, politicas, recursos del catalogo,
fragmentos de anfitriones) conservando los bytes en disco de
`config.json`/`discovery.json`, y clasifica cada archivo:

| accion | significado |
| --- | --- |
| `create` | destino ausente; puede crearse |
| `noop` | bytes identicos a los generados (o region administrada identica) |
| `managed` | destino divergente cuya region `SCOPEGRAIN:BEGIN..END` puede refrescarse in-place — la unica escritura no create-only del codebase, confinada a la region delimitada por marcadores que el archivo opto por llevar; jamas toca bytes de usuario fuera de ella |
| `conflict` | destino distinto, enlace, directorio o colision interna |

`applyUpdate(ctx, {installRoot?, reconcile?}?)` crea solo los `create` y
refresca las regiones `managed` (relee bajo el mismo lstat de
clasificacion, rechaza enlaces/no-regulares, aborta si los marcadores
desaparecieron a mitad del apply y escribe via temp exclusivo + rename);
los `conflict` se reportan y nunca se sobrescriben. `config.json` se
reporta pero queda fuera del conjunto de escritura: la configuracion es
del proyecto, no un recurso refrescable. Un destino que aparece entre la
vista previa y el apply aborta todo con `PLAN_CONFLICT`. A diferencia de
`applyActivation` en [hosts](native-hosts.md), que es todo-o-nada,
`update` aplica parcialmente: los `create` viables se escriben aunque
coexistan `conflict` reportados.

Con `reconcile:true` (`update --reconcile`), el preview marca cada
`conflict` con `reconcile:true|false` y el apply reescribe SOLO los
archivos divergentes bajo una raiz generada por el harness. Las raices
no son una lista copiada a mano: se derivan del propio plan, como los
directorios de primer nivel de todo archivo generado anidado (el
directorio de la config —`.scopegrain/` o el configurado— y cualquier
subdirectorio proyectado que el generador emita). La reescritura replica
el flujo manual: unlink del archivo divergente y recreacion con `wx`
exclusivo via `applyPlan`, con su preflight completo y rollback de solo
lo creado.

Reconcile nunca toca: `config.json` (aunque viva bajo la raiz generada),
archivos de nivel raiz (`AGENTS.md`, `CLAUDE.md` y cualquier destino sin
directorio padre), destinos que son enlaces o directorios, colisiones
internas del plan y cualquier cosa no producida por el generador. Cuando
la config vive en la raiz del proyecto, los archivos generados de nivel
raiz (`instructions.md`, `discovery.json`, `task-contract.md`) tampoco
son reconciliables: en la raiz no hay forma de distinguir lo generado de
lo ajeno. El resultado del apply reporta `reconciled` (con el motivo
original del conflicto) junto a los `conflict` restantes.

Con `reconcile:true` el preview y el apply incluyen ademas una seccion
`hostBridges`: los destinos host *aplicables* (`.claude/`, `.devin/`,
`.agents/`, `.opencode/`, `.codex/`...) viven fuera de las raices
generadas que posee el plan de init, asi que el reconcile los evalua en
una segunda pasada — re-deriva el conjunto que `host activate` escribiria
para cada host configurado y cada surface declarada, y juzga cada destino
contra disco con el mismo modelo de seguridad. Solo un archivo regular
divergente cuyos bytes nuevos son demostrablemente generados se reescribe
(unlink + `wx`): los merge targets (`kind` en `MERGE_KINDS` —
agent-declaration, mcp), los destinos globales o reservados y los
archivos mantenidos a mano siempre quedan `conflict`. Los destinos
`pending` (ausentes) se reportan pero nunca se crean: la primera
activacion sigue siendo una decision explicita de `host activate`. Cuando
varias surfaces generan bytes distintos para un destino, la reescritura
exige un unico mejor candidato con evidencia de bytes en otros destinos;
un empate o cero evidencia se reporta como divergente-no-reconciliable
para `host activate --surface` o revision manual. El reporte
`hostBridges` expone `{files, counts, conflicts, errors}` (mas
`reconciled` en el apply).

## backup

`prepareBackup(ctx, {destination})` produce el manifiesto de exportacion:
el archivo de config mas cada archivo regular bajo los siete `paths.*`
declarados (incluye `state/` con `workspace.json`, `journal/` y los
sidecars de ownership). Cada entrada lleva `{rel, sha256, bytes}`. Los
enlaces y archivos no regulares se omiten y se listan en `issues[]`;
nunca se siguen.

`destination` es obligatorio, relativo al proyecto y no puede solapar
(ancestro en cualquier direccion) la config ni ningun `paths.*` -- un
paquete dentro de una fuente escaneada se incluiria a si mismo
(`BACKUP_DESTINATION_OVERLAP`). Prefijos reservados, absolutas, unidades y
`..` se rechazan en el limite.

`applyBackup(ctx, {destination})` relee y rehashea cada fuente; una fuente
que cambio desde la vista previa se omite (`skipped`) antes que exportar
bytes bajo un hash obsoleto. Escribe create-only:

```text
<destination>/manifest.json        {schemaVersion:1, kind:'scopegrain-backup',
                                    createdAt, source:{configRel}, entries:[]}
<destination>/files/<rel>          arbol de contenido con rutas relativas
```

Un paquete previo o cualquier byte existente en el destino produce
`PLAN_CONFLICT` antes de escribir nada. El limite de entradas del arbol es
`MAX_MANIFEST_ENTRIES` (10000); excederlo produce `BACKUP_CAPACITY`.

## restore

`prepareRestore(projectRoot, bundleRel)` lee `manifest.json` del paquete
(esquema cerrado: `RESTORE_MANIFEST_MISSING`,
`RESTORE_MANIFEST_MALFORMED`, `RESTORE_ENTRY_INVALID`), verifica cada
payload `<bundle>/files/<rel>` contra su sha256 y clasifica:

| accion | motivo |
| --- | --- |
| `create` | destino ausente y payload verificado |
| `skip` | `payload-missing`, `payload-hash-mismatch`, `identical`, `self-referential` (entrada dentro del paquete) |
| `conflict` | destino existente con bytes distintos, enlace o no regular |

`applyRestore(projectRoot, bundleRel)` crea solo los `create`, escribiendo
los bytes verificados del payload. Los conflictos se reportan, nunca se
fusionan ni sobrescriben. Un destino que aparece entre la clasificacion y
la escritura aborta todo el lote con `PLAN_CONFLICT`.

## uninstall

`prepareUninstall(ctx, {installRoot?}?)` enumera solo archivos
demostrablemente creados por el harness:

- la config (`reason:'config'`),
- cada archivo generado cuyos bytes en disco son identicos a lo que la
  instalacion actual produciria (`reason:'generated'`), o cuyo sha256
  coincide con la entrada del snapshot del proyecto (`reason:
  'snapshot-pinned'` -- archivos sin modificar de una instalacion anterior
  que la actual ya no reproduce),
- cada archivo regular bajo `paths.state` (`reason:'state'`).

Todo candidato lleva `{rel, sha256, bytes, reason}`. Los generados que
difieren quedan en `leftBehind` con motivo `diverged`; enlaces y no
regulares tambien quedan atras. Las rutas de artefactos
(`plans`/`tasks`/`reports`/`research`/`decisions`/`memory`) contienen
trabajo del usuario y del agente: nunca se enumeran.

`applyUninstall(ctx, {installRoot?}?)` reenumera, vuelve a leer y rehashea
cada candidato y borra solo archivos regulares cuyos bytes siguen
coincidiendo con el hash de la vista previa. Un archivo que cambio queda en
`leftBehind` con `changed-since-preview`; un enlace o no regular con
`not-regular`. Despues elimina directorios del harness vaciados de abajo
hacia arriba (ancestros de archivos borrados dentro del directorio de
config, `paths.state` o los directorios generados de primer nivel); la
raiz del proyecto nunca se elimina y no se escribe nada mas.

## Diagnostico en doctor

`doctor` anade chequeos de solo lectura, entre ellos:

- `workspace-enrollment`: informa `not enrolled`, `enrolled` o falla si el
  descriptor existe pero no es un archivo regular valido.
- `journal`: informa `no journal`, `no recorded operations`, `journal
  idle`, o falla ante head malformado/no regular o una
  `activeOperation` pendiente (la recuperacion explicita sigue siendo del
  journal; ver [recuperacion del journal](journal-recovery.md)).
- `host-merge-targets`: inspecciona los merge targets machine-local
  declarados en el plan de activacion (`.mcp.json`,
  `.codex/config.toml`, `opencode.jsonc`, `.devin/config.json`,
  `.agents/mcp_config.json`, `.devin/mcp_config.json`) — justo los
  archivos fusionados a mano que llevan rutas absolutas del equipo.
  Reporta `pending` (destino ausente), `stale` (no regular, ilegible o
  con ruta absoluta fuera de la raiz del proyecto) y `diverged` (bytes
  distintos del fragmento generado actual); ausencia de merge targets
  declarados tambien se reporta.
- `docs-cli-drift` (nivel aviso, nunca cuenta como fallo): compara los
  verbos que la documentacion del proyecto presenta como comandos
  ejecutables (`README*.md`, `docs/*.md`, `docs/en/*.md`) con la
  superficie real del CLI (tabla `COMMANDS` mas ids y alias `command`
  del catalogo). Lista los verbos documentados inexistentes (`stale`) y
  los reales nunca referenciados (`undocumented`); sin documentacion el
  chequeo se omite.

El informe ademas incluye `summary` con el recuento `{ok, warnings,
failures}`: separa las advertencias puras de los chequeos fallidos, de
modo que un consumidor distingue "todo paso con avisos" de "algo fallo"
sin interpretar `status` (`needs-attention` sigue aplicandose siempre que
existan warnings).

## Limites

- Nada de esto es una transaccion serializable: las reverificaciones en
  `apply` acotan la ventana, no la eliminan. La coordinacion de escritores
  concurrentes sigue siendo responsabilidad del operador.
- Los hashes prueban bytes, no procedencia ni identidad; un archivo con
  contenido identico al generado se considera del harness.
- Los respaldos no cifran ni autentican el paquete: el manifesto permite
  verificar integridad interna, no autoria.
- La desinstalacion no toca el Git del proyecto, ramas, tags ni historial;
  tampoco archivos fuera del conjunto enumerado.
