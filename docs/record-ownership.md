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

## Limites

- Solo `capture`, `spec`, `design` y `report` revision 0 estan soportados.
  Los documentos mutables necesitan un futuro protocolo CAS/historial,
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
