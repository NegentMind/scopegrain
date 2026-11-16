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

Actualmente hay dos clases de fuente soportadas, ambas en
`sourceRevision: 0`: `capture` (notas tipadas) y `spec` (especificaciones
V2 estructuradas). Cada una conserva sus codigos y etiquetas de dominio;
la maquinaria compartida vive en dos modulos del core:

- `src/core/record-ownership-data.mjs`: validadores puros, objetos
  cerrados, conjuntos densos de areas UUID, scope canonico y el sidecar de
  nueve campos `validateRecordOwnership(value, expectedKind, options)`.
  Las clases fuera de `capture`/`spec` y cualquier revision distinta de 0
  son malformed; no hay defaults ni normalizacion para documentos
  almacenados.
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

## CLI

El flag booleano `--owned`, sin valor, selecciona este store solamente en
`specification create` y `specification show`. Usos de ayuda:

```text
specification create --project PATH --input FILE [--owned] [--apply]
specification show --project PATH UUID [--owned]
```

`--config REL` sigue seleccionando una configuracion explicita en ambos
comandos; las rutas `plans` y `state` son las de esa configuracion. La
seleccion de config conserva las reglas del [inicio](../README.md#inicio):
dos configs requieren seleccion explicita y una ruta explicita no tiene
fallback. `--input FILE` se resuelve desde el directorio de trabajo actual,
no desde el proyecto. No hay `--yes`, `--force`, override de destino ni
posicionales adicionales; `show` no acepta `--apply` ni `--input`.
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
`specification.scope`.

### Entrada owned

El JSON externo es cerrado y contiene solo `{ areaIds, specification }`.
`specification` es la entrada estructurada raw existente de
`prepareSpecification`, no un artefacto almacenado ni su objeto `data`.
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
conserva su alcance exclusivo de capture, no valida sidecars de specs.

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

Sin `--owned`, los flujos validos legacy siguen siendo el valor por
defecto incluso si existe un workspace; no requieren enrolamiento.
`create` recibe directamente la especificacion raw, sin envoltura
`areaIds`/`specification`, y conserva la forma legacy de resultado
(`artifact`, `applied`, `files`), sin crear ownership ni journal. No se
autodetecta el modo por la entrada. `show` legacy es una lectura
estructural: puede leer un V2 owned, pero no verifica ni implica su prueba
de ownership.

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
- Los errores de dominio existentes conservan su significado:
  `SCOPE_DENIED`, `WORKSPACE_STALE`, `SYMLINK_REJECTED`, `FILE_ANCESTOR`,
  `DOCUMENT_TOO_LARGE`, `JOURNAL_*`, `ARTIFACT_MALFORMED`,
  `SPEC_STRUCTURED_REQUIRED` y la familia de entrada de specs.
- En el CLI, `MALFORMED_JSON` cubre sintaxis y UTF8 invalidos;
  `INPUT_TOO_LARGE` se comprueba antes de decodificar. El modo owned
  requiere enrolamiento existente (`WORKSPACE_NOT_FOUND` si falta).

## Limites

- Solo `capture` y `spec` revision 0 estan soportados. Los documentos
  mutables necesitan un futuro protocolo CAS/historial, no creates falsos.
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
