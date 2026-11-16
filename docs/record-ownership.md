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

## Limites

- Solo `capture` y `spec` revision 0 estan soportados. Los documentos
  mutables necesitan un futuro protocolo CAS/historial, no creates falsos.
- El ownership prueba una creacion scoped del kernel; no identidad
  autenticada, autenticidad de la peticion original, verdad activa ni
  permiso de borrado.
- No hay listado/escaneo, puntero al ultimo, supersesion de specs,
  productor automatico, superficie CLI para este store todavia ni
  activacion nativa de VantaDB (bloqueada independientemente).
- Los archivos sin ownership nunca se adoptan: un artefacto plausible con
  sidecar sin la operacion committed de dos eventos no tiene ownership, y
  los artefactos legacy V1 fallan el requisito estructurado V2. Los
  getters estructurales legacy (getArtifact/getSpecification) validan
  forma y bindings pero no implican ownership.
