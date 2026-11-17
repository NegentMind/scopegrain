---
title: "Creacion con ownership probado"
kind: reference
---

# Creacion con ownership probado

Semantica compartida de ownership para registros inmutables. Un registro
tiene ownership cuando su documento fuente y su companion de ownership se
crearon en **una operacion de journal recuperable** y la prueba almacenada
sigue coincidiendo con los bytes actuales. El seam es interno y estricto:
`applyJournaledRecordCreation` genera la identidad de operacion una sola
vez y exige que cada fuente propuesta sea nueva: un archivo existente que
coincida es un conflicto, nunca adopcion.

El contrato admite cuatro clases de fuente, todas en
`sourceRevision: 0`: `capture` (notas tipadas), `spec` (especificaciones
V2 estructuradas), `design` (designs V2 vinculados) y `report` (informes
V2 de outcome). `outcome` es el nombre del DTO/store/CLI, no un quinto
`sourceKind`. Cada clase conserva sus codigos y etiquetas de dominio;
la maquinaria compartida vive en dos modulos del core:

- `src/core/record-ownership-data.mjs`: validadores puros, objetos
  cerrados, conjuntos densos de areas UUID, scope canonico y el sidecar de
  nueve campos `validateRecordOwnership(value, expectedKind, options)`.
  La clase debe coincidir exactamente con `expectedKind`: clases cruzadas,
  otras clases y cualquier revision distinta de 0 son malformed; no hay
  defaults ni normalizacion para documentos almacenados.
- `src/core/record-ownership.mjs`: la prueba de solo lectura
  `readOwnedCreation(bound, descriptor, inspectSource)`, en orden fijo:
  lectura acotada del sidecar con revalidacion del binding, checks de
  forma/clase esperada, autorizacion de scope **antes** de producir
  contenido, operacion con commit marker valido y exactamente dos eventos
  create, igualdad de snapshots inmutables para ambos archivos, record
  tipado construido desde copias del snapshot y una lectura revalidada de
  la fuente actual que debe igualar el snapshot. Sin listados, historial
  ni adopcion de archivos plausibles.

## Store de especificaciones con ownership

`createOwnedSpecificationStore(ctx, options)` vincula un contexto
resuelto a un enrolamiento de workspace y expone exactamente `prepare`,
`create` y `get`.

- **Opciones**: cerrado `{ areaIds }`, un array denso de UUIDs de areas
  del workspace sin repetidos. Intencionalmente no hay opcion `origin`:
  los esquemas de artefacto y sidecar no tienen donde almacenarla.
- **Entrada**: cerrado `{ areaIds, specification }`, ambas requeridas.
  El objeto externo se valida antes de cualquier IO y la especificacion
  anidada se clona a JSON plano antes de llamar a `prepareSpecification`,
  de modo que una mutacion posterior del caller no puede alterar el
  registro. Las areas del registro se normalizan a IDs ordenados unicos y
  se autorizan all-of contra los grants del binding.
- **Rutas**: fuente `<paths.plans>/specs/<uuid>.json`, sidecar
  `<paths.state>/record-ownership/spec/<uuid>.json`. Ambas son JSON
  formateado terminado en newline; `sourceHash` es el SHA-256 de los
  bytes exactos de la fuente. Las rutas `plans`/`state` configuradas se
  respetan; los directorios por defecto nunca se crean implicitamente.
- **`prepare(input)`**: dry-run de solo lectura con el ID/tiempo
  provisional que genera `prepareSpecification`; valida ambos destinos
  (links y ancestros archivo fallan) y ambos tamanos de documento.
  Devuelve `{ mode: 'dry-run', record, sourceRel, ownershipRel,
  reservesIds: false }`.
- **`create(input)`**: ejecuta `prepareSpecification` dentro del callback
  del seam estricto para que el ID del artefacto se genere una sola vez;
  solo el `createdAt` local se alinea a la identidad del kernel antes de
  serializar los bytes finales. Escribe exactamente dos eventos (`spec`,
  `record-ownership`) y devuelve `{ mode: 'applied', record, sourceRel,
  ownershipRel, ownershipConfirmed, journal }`. Los recibos inciertos se
  preservan: `ownershipConfirmed` solo es true cuando la operacion quedo
  committed y confirmed.
- **`get(id)`**: UUID canonico en minusculas y luego la prueba compartida.
  Los bytes probados del snapshot se validan via
  `validateArtifactDocument` (nunca releyendo por `getSpecification`,
  para evitar una carrera de lectura) y deben ser un artefacto V2
  estructurado cuyo ID y `createdAt` coinciden con el sidecar.

Scope logico y scope de rutas son conceptos distintos: las areas de grant
viven en el sidecar y en los eventos del journal, mientras que
`spec.data.scope` declara rutas de contencion del artefacto y nunca
deriva grants.

## Stores de designs y outcomes con ownership

Dos stores tipados separados reutilizan la misma prueba, sin introducir
un escritor generico:

| Contrato | Design | Outcome |
| --- | --- | --- |
| Factoria | `createOwnedDesignStore(ctx, { areaIds })` | `createOwnedOutcomeStore(ctx, { areaIds })` |
| Entrada cerrada | `{ areaIds, design }` | `{ areaIds, outcome }` |
| Preparador | `prepareDesign` | `prepareOutcomeEvidence` |
| `sourceKind` | `design` | `report` |
| Fuente | `<paths.plans>/designs/<uuid>.json` | `<paths.reports>/<uuid>.json` |
| Companion | `<paths.state>/record-ownership/design/<uuid>.json` | `<paths.state>/record-ownership/report/<uuid>.json` |

Ambos exigen un contexto resuelto y workspace enrolado. Las opciones son
el objeto cerrado `{ areaIds }`, sin `origin`; config y grants quedan
copiados privadamente. El store congelado expone exactamente `prepare`,
`create` y `get`. La envoltura se valida antes de IO, se clona el DTO
anidado a JSON plano y las areas se validan como array denso no vacio de
UUIDs canonicos sin repetidos, se ordenan y se autorizan all-of.
No se aceptan IDs de registro/operacion, revision, destinos ni hashes del
caller. `specId` y `taskId` si son referencias de dominio permitidas.

- **`design`** es la entrada raw cerrada de `prepareDesign`:
  `{ specId, title, body, references? }`. `specId` debe resolver una
  especificacion V2 estructurada; el core deriva `specDigest` y comprueba
  el binding de hash antes de serializar. El padre **no necesita
  ownership**: una spec estructurada creada por el flujo ordinario es
  valida. No se acepta una spec V1 ni ausente.
- **`outcome`** es la entrada raw cerrada de `prepareOutcomeEvidence`:
  `{ taskId, title, body, references? }`. Exige una tarea formal V2 real
  en `REVIEW`, verification valida y bindings sanos de spec/design/plan.
  Deriva revision y digests de tarea, spec, design, plan y verification;
  no acepta hashes declarados por el caller. Conserva `body` literal y
  agrega las referencias reales de tarea/spec segun el preparador
  existente. La preparacion no exige una aprobacion de ACCEPT; ese gate
  sigue siendo posterior.

Los metodos mantienen las mismas formas de resultado y recibos del store
de especificaciones:

- **`prepare(input)`** es solo lectura. Ejecuta el preparador del dominio,
  comprueba destinos seguros y limites de ambos documentos, y devuelve
  `{ mode: 'dry-run', record, sourceRel, ownershipRel, reservesIds: false }`.
  ID y tiempo son provisionales: cada preview puede generar otra identidad
  y no reserva ni reutiliza el ID al aplicar.
- **`create(input)`** vuelve a ejecutar el preparador dentro del callback
  estricto; no aplica un preview guardado. Asi deriva el binding actual
  del padre o el REVIEW real al crear y genera una sola vez el ID final.
  Alinea el `createdAt` local con la identidad del kernel, serializa JSON
  formateado con newline y calcula `sourceHash` sobre los bytes exactos.
  Crea exactamente dos eventos `create` revision0, uno `design` o
  `report` y otro `record-ownership`, con el mismo scope. Devuelve
  `{ mode: 'applied', record, sourceRel, ownershipRel, ownershipConfirmed,
  journal }`; conserva el recibo completo e incierto. `ownershipConfirmed`
  solo es true si `journal.status` es `committed` y `journal.journalState`
  es `confirmed`.

  El rollback de fuentes es best-effort y solo intenta retirar archivos
  creados por esa aplicacion. Un resultado incierto puede conservar fuentes
  parciales ademas del intent y los snapshots; ni la presencia ni la ausencia
  de fuentes prueba un commit ni autoriza adopcion o reintento automaticos.
- **`get(id)`** exige UUID canonico en minusculas y aplica la prueba
  compartida sin fallback. Valida las copias de bytes probados mediante
  `validateArtifactDocument`; exige el tipo V2 estructurado esperado e
  igualdad de ID y `createdAt` con el sidecar. Devuelve
  `{ record, ownership, locator: { operationId, eventId },
  isCurrentSource: true, memoryConsulted: false }`.

El getter de design comprueba ademas el binding de la spec mediante
`validateArtifactBindings`, sobre el design ya probado, **sin releer el
design por `getArtifact`**. Si el padre cambia de digest, falta o deja de
ser valido, la lectura falla con los errores de dominio existentes; la
prueba propia de ownership no exime ese binding. El check de binding se
ejecuta sobre el registro derivado del snapshot antes de la comparacion
final de bytes de la fuente actual: un fallo combinado (padre en drift y
fuente cambiada a la vez) puede revelar primero el error del padre; ambos
casos fallan cerrados.

En cambio, el getter de outcome prueba los bytes presentes del report y
su procedencia: **no relee la tarea ni reevalua sus bindings actuales**.
Un cambio posterior de tarea, estado o verification no invalida por si
solo la prueba de bytes del report ni demuestra su vigencia. `isCurrentSource`
significa fuente actual igual al snapshot, no elegibilidad actual para
ACCEPT. Los gates metodologicos siguen juzgando esa vigencia. Ni preparar
dentro del callback ni leer la prueba agrega serializabilidad entre todos
los archivos o una afirmacion de verdad activa.

Los errores de version siguen siendo del dominio existente y difieren por
familia: un design V1 es imposible, porque `validateArtifactShape` lo
rechaza como `ARTIFACT_MALFORMED` durante la validacion del snapshot
dentro de la prueba de ownership; en
cambio un report V1 estructuralmente valido bajo una prueba committed
genuina falla como `OWNED_OUTCOME_MALFORMED`, porque el store exige el
report V2 con typed data.

## CLI

El flag booleano `--owned`, sin valor, selecciona los stores de ownership.
En `specification create|show` conserva su comportamiento opt-in
existente. En `design create` y `outcome create` es opcional; los nuevos
`design show` y `outcome show` lo **requieren**. Usos de ayuda:

```text
specification create --project PATH --input FILE [--owned] [--apply]
specification show --project PATH UUID [--owned]
design create --project PATH --input FILE [--owned] [--apply]
design show --project PATH UUID --owned
outcome create --project PATH --input FILE [--owned] [--apply]
outcome show --project PATH UUID --owned
```

Se conserva la nota de ayuda de specification y se agrega una separada:

```text
--owned opts specification create/show into journal ownership; legacy behavior stays unchanged without it
--owned opts design/outcome create/show into journal ownership; new show commands require it
```

`--config REL` sigue seleccionando una configuracion explicita en estos
comandos; las rutas `plans`, `reports` y `state` son las configuradas. La
seleccion de config conserva las reglas del [inicio](../README.md#inicio):
dos configs requieren seleccion explicita y una ruta explicita no tiene
fallback. `--input FILE` se resuelve desde el directorio de trabajo actual,
no desde el proyecto. No hay `--yes`, `--force`, override de destino ni
posicionales adicionales. Las flags de `create` son exactamente
`--project`, `--config`, `--input`, `--apply`, `--owned`, sin posicionales;
las de `show` son `--project`, `--config`, `--owned`, con un UUID
posicional. `show` no acepta `--apply` ni `--input`. Los nuevos
`design show` y `outcome show` sin `--owned` fallan con `INVALID_ARGS`
antes de acceder al contexto o leer entradas. Para lectura estructural
se conservan `artifact show design UUID` y `artifact show report UUID`:
no verifican ni implican ownership.
`--owned` no se admite en otras familias de comandos.

### Enrolamiento y areas

La config debe existir y el workspace debe estar enrolado explicitamente.
Para un proyecto configurado aun no enrolado:

```powershell
node ./bin/scopegrain.mjs workspace init --project "C:\ruta\mi-proyecto"
node ./bin/scopegrain.mjs workspace init --project "C:\ruta\mi-proyecto" --apply
node ./bin/scopegrain.mjs workspace show --project "C:\ruta\mi-proyecto"
```

El primer comando solo muestra la propuesta; `--apply` confirma el
enrolamiento. Si ya existe, consultar `workspace show` y usar sus IDs.
Las operaciones owned no crean ni adoptan un workspace implicitamente;
sin enrolamiento fallan con `WORKSPACE_NOT_FOUND`.

Como en `capture`, el CLI local toma de la metadata del workspace
enrolado grants para **todas** sus areas. Esto no autentica un actor ni
implementa ACL o aislamiento del sistema operativo. Cada registro debe
pedir sus propias `areaIds` explicitamente y satisfacer autorizacion
all-of: todas las areas solicitadas deben estar concedidas. Los grants
locales no amplian las areas del registro ni infieren un scope desde
`specification.scope`, el padre del design o la tarea del outcome.

### Entrada owned

Cada comando owned recibe su envoltura cerrada: `{ areaIds, specification }`,
`{ areaIds, design }` o `{ areaIds, outcome }`, sin autodeteccion.
`specification` es la entrada estructurada raw existente de
`prepareSpecification`, no un artefacto almacenado ni su objeto `data`.
`design` y `outcome` son las entradas raw de sus preparadores descritas
arriba; tampoco aceptan un artefacto almacenado ni su objeto `data`.
No se aceptan `origin`, IDs de registro/operacion, revision, destinos de
almacenamiento ni hashes aportados por el caller. Los IDs de requisitos y
escenarios si pertenecen al contrato de la especificacion.

Ejemplo completo de `owned-spec.json`: el UUID
`11111111-1111-4111-8111-111111111111` es **solo un valor de ejemplo**,
sintacticamente valido. **SUSTITUIR por un UUID REAL de area devuelto por
`workspace show`** antes de usarlo; el ejemplo no funciona literalmente
por el mero hecho de tener un UUID valido.

```json
{
  "areaIds": ["11111111-1111-4111-8111-111111111111"],
  "specification": {
    "title": "Validar solicitudes",
    "originalRequest": "Rechazar solicitudes sin titulo.",
    "outcome": {
      "statement": "Las solicitudes sin titulo se rechazan.",
      "evidencePlan": "Comprobar casos con titulo presente y ausente."
    },
    "requirements": [
      {
        "id": "REQ-1",
        "statement": "El titulo debe estar presente.",
        "scenarios": [
          {
            "id": "SC-1",
            "given": "Una solicitud sin titulo",
            "when": "Se valida la solicitud",
            "then": "Se rechaza por titulo ausente"
          }
        ]
      }
    ],
    "scope": ["src"],
    "constraints": [],
    "nonGoals": [],
    "openQuestions": [],
    "references": []
  }
}
```

Tras sustituir el area y revisar el contenido:

```powershell
node ./bin/scopegrain.mjs specification create --project "C:\ruta\mi-proyecto" --input owned-spec.json --owned
node ./bin/scopegrain.mjs specification create --project "C:\ruta\mi-proyecto" --input owned-spec.json --owned --apply
```

No hay un JSON Schema estatico nuevo para esta envoltura. Los validadores
del core definen el contrato owned; `schemas/record-ownership.schema.json`
conserva su alcance exclusivo de capture: no valida sidecars de spec,
design ni report.

### Resultados y compatibilidad

El CLI devuelve literalmente los valores del core: `prepare` sin
`--apply`, `create` con `--apply` y `get` en `show`; no agrega un wrapper
ni afirmaciones de ownership propias. Las formas de creacion son las
descritas arriba para el store.

- La vista previa no escribe ni reserva IDs (`reservesIds: false`); su
  identidad es provisional y no se reutiliza al aplicar.
- `--apply` autoriza las escrituras tipadas, nunca ejecutar comandos,
  productores o hooks. El resultado conserva el recibo `journal` completo
  y su incertidumbre; `ownershipConfirmed` solo es true con operacion
  committed y confirmed. No reintentar a ciegas un resultado incierto.
- `show --owned` recibe el UUID real de `record.id` devuelto al crear,
  canonico en minusculas. Devuelve `{ record, ownership,
  locator: { operationId, eventId }, isCurrentSource: true,
  memoryConsulted: false }` solo tras probar commit y bytes actuales.
  Si falta la prueba o hay deriva, falla cerrado: no consulta el getter
  legacy, historial ni memoria, ni adopta archivos o sidecars plausibles.

Sin `--owned`, las creaciones validas legacy siguen siendo el valor por
defecto incluso si existe un workspace; no requieren enrolamiento.
Cada `create` recibe directamente la entrada raw del preparador, sin
envoltura `areaIds`/`specification`, `areaIds`/`design` o
`areaIds`/`outcome`, y conserva bytes, forma de entrada y resultado legacy
(`artifact`, `applied`, `files`), sin crear ownership ni journal. No se
autodetecta el modo por la entrada. `specification show` sin `--owned`
conserva su lectura estructural; para design/report se usa el comando
`artifact show` generico existente. Esas lecturas pueden leer un V2 owned,
pero no verifican ni implican su prueba de ownership. Los nuevos
`design show` y `outcome show` no introducen un segundo getter estructural.

### Entrada JSON UTF8

El lector JSON comun del CLI, no solo el modo owned, limita primero los
bytes: `INPUT_TOO_LARGE` prevalece sobre cualquier error de codificacion.
Dentro del limite, UTF8 invalido se rechaza con `MALFORMED_JSON` antes del
parseo JSON, con la misma forma de mensaje que un error de sintaxis; no se
sustituyen bytes invalidos silenciosamente por U+FFFD.

U+FFFD literal valido, acentos precompuestos o combinados, emojis, escapes
de surrogates y finales CRLF siguen admitidos sin normalizar el texto.
El BOM no se elimina: conserva el rechazo de `JSON.parse` con
`MALFORMED_JSON`. Los controles existentes de seguridad de archivos no
cambian.

## Errores

- `INVALID_OWNED_SPEC_INPUT`: constructor, DTO externo, areas y UUID.
- `OWNED_SPEC_NOT_FOUND`, `OWNED_SPEC_MALFORMED`,
  `OWNED_SPEC_NOT_COMMITTED`, `OWNED_SPEC_SOURCE_CHANGED`: las fases de
  la prueba en orden: archivos ausentes o no regulares, registros
  forjados o que no coinciden, operaciones sin commit y fuentes alteradas.
- Design conserva las familias propias `INVALID_OWNED_DESIGN_INPUT`,
  `OWNED_DESIGN_NOT_FOUND`, `OWNED_DESIGN_MALFORMED`,
  `OWNED_DESIGN_NOT_COMMITTED` y `OWNED_DESIGN_SOURCE_CHANGED`.
- Outcome usa `INVALID_OWNED_OUTCOME_INPUT`, `OWNED_OUTCOME_NOT_FOUND`,
  `OWNED_OUTCOME_MALFORMED`, `OWNED_OUTCOME_NOT_COMMITTED` y
  `OWNED_OUTCOME_SOURCE_CHANGED`, aunque su `sourceKind` sea `report`.
  Un report V1 no satisface el contrato de outcome owned.
- Los errores de dominio existentes conservan su significado:
  `SCOPE_DENIED`, `WORKSPACE_STALE`, `SYMLINK_REJECTED`, `FILE_ANCESTOR`,
  `DOCUMENT_TOO_LARGE`, `JOURNAL_*`, `ARTIFACT_MALFORMED`,
  `SPEC_STRUCTURED_REQUIRED` y las familias de entrada tipadas. Un padre
  de design con otro digest produce `ARTIFACT_DRIFT`; si falta,
  `ARTIFACT_NOT_FOUND`; si es V1, `SPEC_STRUCTURED_REQUIRED`; si es
  malformado, conserva su error existente. Tarea no formal/fuera de
  REVIEW, verification ausente o bindings insanos fallan en preparacion
  de outcome con `OUTCOME_INVALID`; verification malformada conserva
  `INVALID_EVIDENCE`. No se traducen esos errores a una prueba exitosa.
- En el CLI, `MALFORMED_JSON` cubre sintaxis y UTF8 invalidos;
  `INPUT_TOO_LARGE` se comprueba antes de decodificar. El modo owned
  requiere enrolamiento existente (`WORKSPACE_NOT_FOUND` si falta).
  Omitir `--owned` en los nuevos `design show`/`outcome show` es
  `INVALID_ARGS`, no una seleccion automatica de modo.
- Las familias mutables usan el mismo esquema por dominio:
  `INVALID_OWNED_<X>_INPUT` mas `OWNED_<X>_NOT_FOUND`,
  `OWNED_<X>_MALFORMED`, `OWNED_<X>_NOT_COMMITTED` y
  `OWNED_<X>_SOURCE_CHANGED`, con las excepciones especificas listadas
  en [Ownership mutable con historial journal](#ownership-mutable-con-historial-journal).

## Ownership mutable con historial journal

Cinco stores opt-in extienden la misma prueba a registros que cambian.
El seam nuevo es `applyJournaledRecordUpdate(bound, callback)` en
`src/core/journal.mjs`, gemelo estricto de
`applyJournaledRecordCreation`: el kernel genera la identidad de la
operacion una sola vez, entrega una copia congelada al callback sincrono
de confianza y valida lo devuelto como update changes de forma cerrada.
Cada change declara `previousHash` (SHA-256 de los bytes actuales
esperados) y `sourceRevision` (la revision actual esperada); el CAS de
bytes se comprueba antes del lock, de nuevo bajo el lock antes de
reservar secuencias y otra vez tras el staging de temporales y antes de
los renames (aplicacion en dos fases: temp fsync junto al destino,
re-check CAS de todos los targets, rename de todos y post-verificacion
de bytes). Un destino ausente, no regular o con bytes distintos es
`JOURNAL_SOURCE_CONFLICT` antes de consumir estado del journal. Un
change cuyo contenido iguala los bytes actuales se filtra; si todos lo
son, el resultado es `unchanged` sin operacion. Las pre-imagenes se
persisten como snapshots content-addressed adicionales bajo el hash del
`previousHash` (auditoria; no hay restauracion automatica) y los recibos
inciertos se conservan como en create. No hay operaciones mixtas:
`create` solo acepta fuentes nuevas y `update` solo destinos
CAS-existentes.

`src/core/record-history.mjs` aporta los validadores puros del modelo:
`validateUpdateChange` (forma cerrada del change: `sourceRevision`
entero obligatorio y `previousHash` sha256), `resultingSourceRevision`
(create conserva la declarada; update produce la esperada + 1) y
`validateRecordTransition` (un evento update debe nombrar el mismo
record, esperar la revision que produjo el evento previo y encadenar
`previousHash` a su `sourceHash`). El journal no mantiene un indice por
record: la `sourceRevision` declarada es metadato de procedencia que el
kernel no verifica contra operaciones previas; la coherencia de la
cadena es un check del modelo de lectura.

Las invariantes compartidas de los cinco stores: opciones cerradas
`{ areaIds }`, binding autentico y copia privada de config, scope
autorizado antes de producir contenido, gates de dominio dentro del
callback del kernel (antes de reservar estado del journal), stores
congelados, `get` fail-closed que reprueba la cadena committed completa,
y nunca listados, fallback de historial como actual ni adopcion de
archivos plausibles. Genesis y mutaciones son operaciones de uno o dos
eventos segun el store: dos create rev0 para el par fuente+sidecar; dos
update cuando el sidecar es mutable. Solo el enrolamiento perezoso del
workspace usa un create de un solo evento (el puntero). Todos conservan
el recibo `journal` completo, incluido el incierto.

| Store | Factoria y API | Sidecar | Operaciones |
| --- | --- | --- | --- |
| Tarea | `createOwnedTaskStore(ctx, { areaIds })` (`src/core/transition.mjs`): `prepare`, `create`, `get`, `transition` | `<paths.state>/record-ownership/task/<uuid>.json`, mutable con `chain` | create: 2 create rev0 (`task` + `record-ownership`); transition: 2 update |
| Aprobacion | `createOwnedApprovalStore` (`src/core/approvals.mjs`): `prepare`, `create`, `get`, `answer` | `<paths.state>/record-ownership/approval/<sha256>.json`, mutable con `chain` | create: 2 create rev0; answer: 2 update (`approval` + `record-ownership`) |
| Sesion | `createOwnedSessionStore` (`src/core/sessions.mjs`): `prepare`, `create`, `prepareRecord`, `record`, `get`, `resume` | `<paths.state>/session-ownership/<uuid>.json`, cabeza de cadena mutable | open: 2 create rev0 (`session` + `session-ownership`); record: 2 update |
| Plan | `createOwnedPlanStore` (`src/core/plans.mjs`): `prepare`, `create`, `get`, `update` | `<paths.state>/plan-ownership/<key>.json`, mutable con `operations` | create: 2 create rev0 (`plan` + `plan-ownership`); update: 2 update |
| Workspace | `createOwnedWorkspaceStore` (`src/core/workspaces.mjs`): `prepare`, `update`, `get` | `<paths.state>/workspace-ownership.json`, puntero mutable | genesis: 1 create del puntero; update: 2 update (`workspace` + `workspace-ownership`) |

### Tareas owned

La fuente es el mismo `<paths.tasks>/<uuid>.json` del dominio, byte
identico; el sidecar usa el layout `record-ownership/task/` con un
validador local de diez campos porque `OWNERSHIP_KINDS` sigue cerrado
a los kinds inmutables. El sidecar es mutable y lleva `chain`: lista
densa de operationIds donde `chain[k]` produjo la revision k,
`chain.at(-1) === operationId` y `chain.length === sourceRevision + 1`
(misma convencion que aprobaciones, acotada por `maxSessionEvents`).

- **`create`** emite dos eventos create rev0 (`task` y
  `record-ownership`) en una operacion; `prepare` es el dry-run de
  siempre, sin reservar IDs.
- **`transition`** recibe `{ areaIds, transition }` con la misma entrada
  de `transitionTask`, exige que las areas sean exactamente el scope
  probado del registro (`SCOPE_DENIED` ante cualquier diferencia) y toma
  el lock `<id>.json.lock` para bloquear escritores legacy cooperativos
  durante toda la ventana. Bajo ese lock prueba el ownership vigente y
  corre `evaluateTaskTransition` (CAS de revision, arista de workflow,
  evidencia, ACCEPT y gate metodologico) dentro del callback del kernel;
  emite una operacion de dos eventos update (`task` y sidecar)
  encadenada a la punta probada.
- **`get`** recorre la `chain` del sidecar hacia adelante: cada
  operacion referida debe estar committed con exactamente dos eventos y
  ambas series (fuente y sidecar) validan con
  `validateRecordTransition` desde el create; el snapshot del sidecar
  de cada revision reprueba el prefijo de `chain`. No enumera
  `journal/operations`. Ademas exige `record.revision ===`
  `sourceRevision` y bytes actuales iguales a la punta probada.
- Errores: `INVALID_OWNED_TASK_INPUT`, `OWNED_TASK_NOT_FOUND`,
  `OWNED_TASK_MALFORMED`, `OWNED_TASK_NOT_COMMITTED` y
  `OWNED_TASK_SOURCE_CHANGED`; los codigos de dominio
  (`REVISION_MISMATCH`, `INVALID_TRANSITION`, `METHODOLOGY_BLOCKED`,
  `TASK_LOCKED`, ...) conservan su significado.

### Aprobaciones owned

El recordId es el digest sha256 de la aprobacion, no un UUID; la fuente
vive en `<paths.decisions>/approvals/<sha256>.json`. El sidecar mutable
de diez campos lleva `chain`: lista ordenada de operationIds donde
`chain[k]` produjo la revision k, `chain.at(-1) === operationId` y
`chain.length === sourceRevision + 1`.

- **`answer`** exige `{ id, answer, expectedRevision,
  expectedTargetDigest, actor }` (`comment` opcional) y resuelve
  `expectedRevision` al
  `sourceHash` del evento que produjo esa revision dentro de la cadena
  probada, declarado como `previousHash`: una doble respuesta desde la
  misma revision declara bytes viejos y el kernel la rechaza con
  `JOURNAL_SOURCE_CONFLICT` antes de reservar estado. El evento de la
  fuente declara la `expectedRevision` del caller; el del sidecar, la
  revision de punta probada. El store owned no ofrece `prepareAnswer`;
  `prepareApprovalAnswer` legacy sigue existiendo fuera de el.
- **`get`** recorre la cadena completa: cada operacion committed con
  exactamente dos eventos (`approval` + `record-ownership`), encadenados
  por `validateRecordTransition` en ambos streams, y el snapshot del
  sidecar de cada revision reprueba su prefijo de `chain`. El record de
  la punta debe declarar `revision === sourceRevision` del sidecar y los
  bytes actuales deben igualar la punta.
- Errores: `INVALID_OWNED_APPROVAL_INPUT` y la familia
  `OWNED_APPROVAL_*` (`NOT_FOUND`, `MALFORMED`, `NOT_COMMITTED`,
  `SOURCE_CHANGED`); los codigos de dominio (`APPROVAL_INVALID`,
  `REVISION_MISMATCH`, ...) conservan su significado.

### Sesiones owned

La fuente es el documento legacy byte identico
`<paths.state>/sessions/<uuid>.json`. El sidecar vive bajo
`session-ownership/` — no en `record-ownership/`, reservado a companions
rev0 inmutables — y es la cabeza mutable de la cadena con doce claves
cerradas, incluidas `previousOperationId` y `createOperationId`. Un
sidecar rev0 exige `operationId === createOperationId`,
`previousOperationId === null` y `createdAt === updatedAt`.

- **`create`** (open) es una operacion con dos eventos create rev0
  (`session` + `session-ownership`).
- **`record`** emite una operacion con dos eventos update sobre ambos
  archivos. Todos los gates de dominio — CAS de `expectedRevision`,
  `checkAction` contra la tarea viva, presupuesto `used < limit` y forma
  prospectiva completa — corren dentro del callback del kernel, antes de
  reservar estado del journal. El scope grabado debe igualar
  exactamente el scope enrolado (`INVALID_OWNED_SESSION_INPUT` si
  difiere). **`prepareRecord`** es el dry-run: prueba solo la punta
  (escrituras O(1); las lecturas recorren la cadena, deliberado).
- **`get`** hace el recorrido backward completo por
  `previousOperationId` hasta la operacion create rev0: cada operacion
  committed con exactamente dos eventos, el snapshot del sidecar
  reproduce el documento enlazado y ambos streams pasan
  `validateRecordTransition`. **`resume`** devuelve el record probado
  mas el estado vivo de la tarea.
- Errores: `INVALID_OWNED_SESSION_INPUT` y `OWNED_SESSION_*`
  (`NOT_FOUND`, `MALFORMED`, `NOT_COMMITTED`, `SOURCE_CHANGED`).

### Planes owned

La fuente es `<paths.plans>/<key>.json` y el recordId es la `key` del
plan. El sidecar mutable de once campos lleva `operations`, la lista
append-only de operationIds: `operations.length === sourceRevision + 1`
y el ultimo es `operationId`.

- **`create`** emite dos eventos create rev0 (`plan` +
  `plan-ownership`). Los archivos de tareas miembro se crean antes de la
  operacion journal por el escritor legacy todo-o-nada, asi que un
  recibo incierto puede dejar tareas inertes sin referencia (ventana
  documentada; el orden inverso dejaria un plan committed sin sus
  tareas, estrictamente peor). Un destino owned existente falla antes
  con `OWNED_PLAN_CONFLICT`.
- **`update`** recibe `{ key, expectedRevision, plan }` — sin
  redeclarar areas: los eventos usan el scope probado del sidecar. La
  revision debe igualar la punta probada (`OWNED_PLAN_REVISION_CONFLICT`)
  y el documento completo se revalida: forma y DAG, campos de
  procedencia inmutables (`schemaVersion`, `authorContext`,
  `inputDigest`, `createdAt`, `specId`, `designId`), ids de miembros
  estables por key, miembros nuevos ya existentes en disco y, en planes
  V2, refs formales coherentes y cobertura total de escenarios
  (`PLAN_MEMBERSHIP_INVALID`, `INVALID_PLAN`). Bytes identicos
  devuelven `{ mode: 'unchanged' }` sin consumir journal; si difieren,
  una operacion de dos eventos update CAS.
- **`get`** reprueba la cadena entera: cada operacion committed, dos
  eventos encadenados y snapshot del sidecar byte-reconstruible por
  prefijo. El readiness (`nextPlanTasks`) es una lectura derivada sobre
  tareas vivas y no forma parte de la prueba.
- Errores: `INVALID_OWNED_PLAN_INPUT`, `OWNED_PLAN_NOT_FOUND`,
  `OWNED_PLAN_MALFORMED`, `OWNED_PLAN_NOT_COMMITTED`,
  `OWNED_PLAN_SOURCE_CHANGED`, `OWNED_PLAN_CONFLICT` y
  `OWNED_PLAN_REVISION_CONFLICT`, mas los codigos de dominio legacy.

### Workspace owned

Sin `create`: el descriptor `workspace.json` lo produce el enrolamiento
explicito. La prueba se ancla en el puntero
`<paths.state>/workspace-ownership.json`, de seis claves cerradas
(`schemaVersion`, `workspaceId`, `revision`, `sourceHash`,
`operationId`, `updatedAt`).

- **Enrolamiento journal perezoso**, no migracion: el primer `update`
  sin puntero crea la operacion genesis — un unico evento create sobre
  el puntero cuya `sourceRevision` es la revision vigente del descriptor
  y cuyo `sourceHash` cubre sus bytes actuales CAS-verificados — y
  despues aplica el update homogeneo de dos eventos (`workspace` +
  `workspace-ownership`). Un descriptor nunca journalizado no se
  adopta: `get` falla con `OWNED_WORKSPACE_NOT_FOUND`. Un recibo de
  genesis incierto se devuelve como `{ updateApplied: false,
  updateConfirmed: false }` en vez de chocar con la barrera de operacion
  pendiente.
- **`update`** recibe `{ areaIds, workspace }` con `workspace.areas`
  como reemplazo total emparejado por `key`: una key existente conserva
  su area id, una nueva recibe UUID fresco. Quitar un area esta
  deliberadamente rechazado (`INVALID_OWNED_WORKSPACE_INPUT`): los
  scopes de los eventos se autorizan contra los grants vigentes, y un
  area eliminada podria dejar permanentemente inautorizables operaciones
  pendientes o historicas, incluida su recuperacion.
- Los campos de identidad (`schemaVersion`, `workspaceId`, `projectId`,
  `repositoryId`, `createdAt`) quedan congelados por construccion; las
  `sourceRevision` y `previousHash` declarados se derivan de bytes que
  el propio store leyo, nunca del caller.
- Cada update committed cambia el digest canonico del descriptor e
  invalida permanentemente todos los bindings vivos (`WORKSPACE_STALE`
  latched); el store se re-vincula por llamada para sobrevivir a sus
  propios updates.
- **`get`** no enumera operaciones: el puntero nombra la ultima, la
  forma es estricta (genesis = exactamente un evento create; update =
  exactamente dos eventos update coherentes) y ambos snapshots deben
  igualar los bytes presentes.
- Errores: `INVALID_OWNED_WORKSPACE_INPUT`, `OWNED_WORKSPACE_NOT_FOUND`,
  `OWNED_WORKSPACE_MALFORMED`, `OWNED_WORKSPACE_NOT_COMMITTED` y
  `OWNED_WORKSPACE_SOURCE_CHANGED`.

### Limites del ownership mutable

- No hay transacciones entre records: una operacion update cubre los
  archivos de un mismo record (fuente y, cuando aplica, sidecar), nada
  mas.
- El CAS es cooperativo: escritores fuera del journal pueden intercalar.
  Los escritores legacy producen formatos byte identicos y siguen
  pudiendo escribir; una escritura externa no corrompe el journal pero
  invalida la prueba — el siguiente `get` o escritura owned falla
  cerrado con `*_SOURCE_CHANGED` o `JOURNAL_SOURCE_CONFLICT`. La prueba
  detecta el cambio; no lo impide ni lo revierte.
- La `sourceRevision` declarada es procedencia: el kernel no la
  verifica contra operaciones previas; la coherencia de cadena se
  comprueba en lectura.
- Los stores owned mutables son factorias del core opt-in: no estan
  cableados al CLI ni a MCP.
- La respuesta de aprobacion owned no tiene `prepareAnswer`; el preview
  legacy `prepareApprovalAnswer` no produce ni consume ownership.
- Quitar areas del workspace no es expresable por diseno (riesgo de
  `SCOPE_DENIED` permanente sobre operaciones pendientes e historicas).
- El ownership de workspace es perezoso: sin puntero journal no hay
  prueba.
- `plan` create puede dejar tareas miembro inertes ante un recibo
  incierto; no hay compensacion automatica.
- Las pre-imagenes de update son snapshots de auditoria; ninguna
  recuperacion las restaura automaticamente.

## Limites

- Los companions inmutables de `record-ownership/` siguen limitados a
  `capture`, `spec`, `design` y `report` revision 0. Los documentos
  mutables usan el protocolo CAS/historial descrito en
  [Ownership mutable con historial journal](#ownership-mutable-con-historial-journal),
  no creates falsos.
- El ownership prueba una creacion scoped del kernel; no identidad
  autenticada, autenticidad de la peticion original, verdad activa ni
  permiso de borrado.
- No hay listado/escaneo, puntero al ultimo, supersesion de specs,
  productor automatico ni hooks conectados. La activacion nativa y
  embeddings de VantaDB siguen bloqueados por `7c2c8be`, independientemente
  de esta superficie CLI.
- Los archivos sin ownership nunca se adoptan: un artefacto plausible con
  sidecar sin la operacion committed de dos eventos no tiene ownership, y
  los artefactos legacy V1 fallan el requisito estructurado V2. Los
  getters estructurales legacy (getArtifact/getSpecification) validan
  forma y bindings pero no implican ownership.
