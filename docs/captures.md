---
title: "Capturas selectivas (core)"
kind: reference
---

# Capturas selectivas (core)

`src/core/captures.mjs` expone un store tipado de notas de captura inmutables
con ownership probado por el journal. Es groundwork para captura selectiva:
no activa coleccion automatica, no recolecta archivos arbitrarios (lee solo
los archivos gestionados que el propio contrato nombra), no lee
conversaciones, y no integra backends nativos ni procesos.

## Store (core)

```js
import { createCaptureStore } from '../src/core/captures.mjs';

const store = createCaptureStore(ctx, { areaIds: [areaId], origin: 'local-cli' });
const preview = store.prepare({ category: 'decision', title: 'T',
  summary: 'S', areaIds: [areaId] });
const result = store.create({ category: 'decision', title: 'T',
  summary: 'S', areaIds: [areaId] });
const current = store.get(result.record.id);
```

- `ctx` es el contexto resuelto del proyecto; `options` es un objeto cerrado
  `{areaIds, origin}` validado en construccion. El store queda congelado con
  exactamente `prepare`, `create` y `get`.
- `areaIds` del input exigen grants all-of del binding; `origin` queda fijo
  en la factoria, no por nota.

## Registro y ownership

Cada creacion genera `crypto.randomUUID()` y una operacion journal estricta
de dos eventos: la nota en `<paths.memory>/captures/<id>.json` y el sidecar
de ownership en `<paths.state>/record-ownership/capture/<id>.json`. Los dos
eventos del journal comparten `operationId`, `createdAt` y scope; la nota
no lleva `operationId`: `note.capturedAt` y `ownership.createdAt` igualan el
`createdAt` de los eventos, y el hash del sidecar cubre los bytes UTF-8
exactos de la nota.

`create` devuelve `{mode:'applied', record, sourceRel, ownershipRel,
ownershipConfirmed, journal}`. `ownershipConfirmed` solo es `true` si el
journal quedo `committed` y `confirmed`; un resultado incierto conserva los
recibos del journal y no convierte fuentes duraderas en un fallo total que
invite a reintentar a ciegas.

## Lectura actual

`get(recordId)` devuelve `{record, ownership, locator:{operationId,eventId},
isCurrentSource:true, memoryConsulted:false}` unicamente si el sidecar
canonico existe, su scope esta autorizado por el binding, la operacion
nombrada esta `committed` con exactamente dos eventos `create` revision 0
del mismo record, los snapshots inmutables coinciden byte a byte con los
archivos actuales, la nota tipada coincide con el evento y el source actual
iguala el snapshot. Deriva, ausencia o archivos no regulares fallan cerrado
(`CAPTURE_SOURCE_CHANGED`, `CAPTURE_NOT_FOUND`, `CAPTURE_MALFORMED`,
`CAPTURE_NOT_COMMITTED`); nunca se devuelve contenido historico como actual
ni se adoptan archivos plausibles. El historial explicito queda disponible
por las APIs conocidas del journal, sin escaneo.

## Campos y limites

- Categorias: `decision`, `event`, `attempt`, `discard`, `preference`,
  `tool`, `skill`, `stack`, `lesson`. Son notas de memoria, no aprobaciones
  formales ni ADRs.
- `basis: declared` es una afirmacion aportada por quien llama, NO entrada
  humana autenticada. `basis: inferred` nunca se promueve a preferencia
  confirmada. `subjectId` es una etiqueta local de atribucion, requerida y
  no vacia solo en `preference`; no es identidad autenticada.
- `supersedes` enlaza con un predecessor del mismo `category`, `subjectId`
  y conjunto exacto de areas, validado por `get` antes de escribir. Una
  preferencia `inferred` no puede reemplazar una `declared`
  (`CAPTURE_SUPERSESSION_CONFLICT`). No hay puntero mutable ni ganador
  automatico entre ramas; los bytes anteriores nunca se alteran.
- Los esquemas exactos viven en `schemas/capture.schema.json` y
  `schemas/record-ownership.schema.json`; los validadores puros en
  `src/core/capture-data.mjs`.
- Errores propios: `INVALID_CAPTURE_INPUT`, `CAPTURE_MALFORMED`,
  `CAPTURE_NOT_FOUND`, `CAPTURE_SOURCE_CHANGED`, `CAPTURE_NOT_COMMITTED`,
  `CAPTURE_SUPERSESSION_CONFLICT`. Los codigos `SCOPE_DENIED`,
  `WORKSPACE_STALE`, `SYMLINK_REJECTED`, `DOCUMENT_TOO_LARGE` y `JOURNAL_*`
  se conservan del kernel.

## CLI

El CLI expone cuatro comandos agrupados: `capture create` y `capture show`
sobre el store, mas `capture proposals` y `capture review` sobre los
productores de propuestas. El
proyecto ya debe estar enrolado: config creada y
`node ./bin/scopegrain.mjs workspace init --project "C:\ruta\mi-proyecto" --apply`
(sin `--apply` el enrolamiento es solo vista previa). Los grants de area
se derivan del workspace registrado; `workspace show` devuelve los IDs de
sus areas:

```powershell
node ./bin/scopegrain.mjs capture create --project "C:\ruta\mi-proyecto" --input capture.json
node ./bin/scopegrain.mjs capture create --project "C:\ruta\mi-proyecto" --input capture.json --apply
node ./bin/scopegrain.mjs capture show "66666666-6666-6666-6666-666666666666" --project "C:\ruta\mi-proyecto"
node ./bin/scopegrain.mjs capture proposals --project "C:\ruta\mi-proyecto" --since-sequence 12
node ./bin/scopegrain.mjs capture review --project "C:\ruta\mi-proyecto" --input review.json
node ./bin/scopegrain.mjs capture review --project "C:\ruta\mi-proyecto" --input review.json --apply
```

Los placeholders (`<area-id-del-workspace>`, el UUID del ejemplo) deben
reemplazarse por IDs reales devueltos por `workspace show` y por
`capture create --apply`/`capture show`.

`--input` es una ruta del
directorio de trabajo actual, no relativa al proyecto. `--config REL`
selecciona una configuracion explicita; las rutas de memoria y estado se
heredan de esa configuracion, nunca se escriben por defecto. Sin `--apply`,
`create` es una vista previa de solo lectura con identidad provisional;
`--apply` devuelve el valor completo del core, incluido el resultado del
journal con sus recibos e incertidumbre preservados. En `create` no hay
`--force`, `--yes` ni seleccion de destino, namespace, hash o ID propio
por linea de comandos; `show` acepta el UUID del registro y `supersedes`
referencia una nota previa.

`capture proposals` es solo lectura: lista propuestas de revision derivadas
de las operaciones committed del journal (cursor opcional
`--since-sequence N`) y de las respuestas de init persistidas. `capture
review --input review.json` evalua una decision cerrada `{proposal, action,
reason?, changes?}` con `reviewProposal`; sin `--apply` devuelve la
revision en modo dry-run y con `--apply` crea una captura con ownership
solo si la decision quedo `approved`. Una decision rechazada o una
propuesta incompleta nunca escribe.

Entrada minima (`capture.json`):

```json
{"category": "decision", "title": "Elegir X", "summary": "Razon breve",
  "areaIds": ["<area-id-del-workspace>"], "basis": "declared",
  "subjectId": null, "supersedes": null}
```

Para corregir una nota, se crea una nueva con `supersedes` apuntando al ID
anterior; exige la misma `category`, `subjectId` y conjunto exacto de
areas, y una preferencia `inferred` nunca reemplaza una `declared`. Las
versiones anteriores se conservan intactas: no hay borrado ni puntero
mutable, y el historial queda disponible por las APIs conocidas del
journal.

Esta superficie es escritura manual tipada: los productores automaticos de
capturas, hooks de anfitrion y la recoleccion de conversaciones siguen sin
estar conectados. Las notas de captura son registros propios, no migran
tareas ni aprobaciones formales, y el texto libre no se declara libre de
secretos ni clasificado automaticamente.

## Productores selectivos de propuestas (core)

`src/core/capture-proposals.mjs` genera **propuestas** de captura a partir
de actividad ya registrada del harness; nunca crea capturas por si mismo.
Es una superficie pura y opt-in: no intercepta conversaciones, no escribe
en el store ni en disco, no consulta backends de memoria y no promueve
inferencias a hechos. El cableado hacia `store.create` queda para la capa
CLI; aqui solo se produce el DTO revisado.

Una propuesta es un objeto cerrado `{schemaVersion:1, proposalId, category,
statement, provenance, suggestedAreaIds, suggestedSubjectId, evidence}`.
`statement` es `{kind, title, text, inference}`: `kind:'declared'` solo
cuando el texto deriva de hechos registrados; todo lo derivado de valores
ausentes o por defecto queda `kind:'inferred'` con `inference` nombrando la
derivacion (`harness-default`). `proposalId` es un digest sha256 con forma
de UUID (version 5, semilla con nombre), determinista a partir de
`operationId`/campo — repetir la llamada produce los mismos IDs, lo que
permite deduplicar sin persistencia. No es un UUID aleatorio ni identidad
de un registro almacenado.

```js
import { proposeFromJournal, proposeFromInitAnswers, reviewProposal,
  validateProposal } from '../src/core/capture-proposals.mjs';

const proposals = proposeFromJournal(bound, { sinceSequence: 12 });
const prefs = proposeFromInitAnswers(answers, { areaIds: [areaId],
  subjectId: 'owner' });
const reviewed = reviewProposal(proposals[0], { action: 'approve' });
// reviewed.input === { areaIds, capture: { category, title, summary,
//   basis, subjectId, supersedes } } — DTO listo para el store.
```

### proposeFromJournal(target, options)

- `target` es un binding autentico de `bindWorkspace` o un contexto
  resuelto `{projectRoot, config}`; con contexto se conceden todas las
  areas enroladas, igual que el CLI local.
- Opciones cerradas `{sinceOperationId, sinceSequence, limit}`; los dos
  `since*` son mutuamente excluyentes (`INVALID_PROPOSAL`).
  `sinceOperationId` se resuelve via `getJournalOperation` al ultimo
  `journalSequence` de esa operacion; `sinceSequence` actua como cursor
  `afterSequence`; `limit` esta acotado por `journal.maxPageSize`.
- La enumeracion usa `listJournalPending` paginado, la unica lectura de
  operaciones committed que expone el journal. **Limite estructural:** el
  outbox solo contiene operaciones con eventos aun no reconocidos; las
  operaciones committed totalmente reconocidas o sin indice no producen
  propuestas. Las propuestas son material de revision, no una pista de
  auditoria. Un journal con operacion abandonada o activa inconsistente
  propaga `JOURNAL_RECOVERY_REQUIRED` — no se propone sobre un journal que
  requiere recuperacion.
- Solo los items `committed` producen propuestas; los eventos
  `record-ownership` (companeros) nunca proponen por separado.
- Mapeo: cada evento `create` committed produce una propuesta `event`
  `declared` (es un hecho registrado). Para `sourceKind:'capture'` se lee
  el snapshot verificado por hash via `readJournalSnapshot`; si parsea como
  nota de captura, su titulo/categoria registrados enriquecen el texto
  (sigue `declared`). Un snapshot ilegible degrada a texto de metadatos,
  nunca un fallo por un solo evento. Un recibo de recovery en la operacion
  produce una propuesta `decision` `declared` con `eventId`/`sourceKind`/
  `recordId` en null. Un `SCOPE_DENIED` al leer la operacion solo omite la
  propuesta de recovery: los eventos ya autorizados siguen proponiendo.

### proposeFromInitAnswers(answers, options)

- `answers` se valida con `validateAnswers` (sus codigos de dominio se
  propagan). Opciones cerradas `{areaIds, subjectId}`, ambas opcionales;
  `suggestedAreaIds` puede quedar `[]` porque las respuestas pueden ser
  anteriores al enrolamiento. Sin `subjectId` explicito,
  `suggestedSubjectId` es la clave del ajuste respondido (`locale`,
  `hosts`, `methodology`, `versioning.<key>`) — una etiqueta de sujeto
  estable: la propuesta generada se aprueba tal cual y una preferencia
  posterior sobre el mismo ajuste puede reemplazarla.
- Emite propuestas `preference` en orden fijo: locale, hosts, methodology
  y una por clave de versionado — todas `declared` por ser respuestas
  explicitas. Si `methodology` o `versioning` no estaban en las respuestas
  crudas, la propuesta emitida es `inferred` con
  `inference:'harness-default'`: los defaults del validador son una
  derivacion, no una respuesta.

### reviewProposal(proposal, decision)

- Pura. `decision` es cerrada `{action, reason?, changes?}` con `action`
  en `approve|reject|edit`; `changes` es obligatoria solo en `edit` y
  prohibida en las demas — nunca se ignora silenciosamente.
- `reject` devuelve `{status:'rejected'}` y nada mas.
- `approve`/`edit` devuelven `{status:'approved', input:{areaIds,
  capture:{...}}}` — el DTO envuelto que la capa CLI entregara al store
  (el store consume la forma plana; la adaptacion es responsabilidad del
  CLI). El DTO compuesto se valida con `normalizeCaptureInput`: aprobar
  una propuesta incompleta (preferencia sin `subjectId`, areas vacias)
  falla cerrado con `INVALID_CAPTURE_INPUT`.
- `approve` conserva el `kind` del statement como `basis` — una propuesta
  `inferred` aprobada queda `inferred` (sin promocion). `edit` remarca
  `basis:'declared'` porque el texto pasa a ser del operador; `changes`
  admite `title`, `summary`, `category`, `subjectId`, `areaIds` y
  `supersedes` (`basis` no es editable).

### Errores y limites de los productores

- `INVALID_PROPOSAL` cubre validacion de propuestas, decisiones, opciones
  y el target. Los codigos de dominio se conservan: `INVALID_CAPTURE_INPUT`,
  `INVALID_ANSWERS`, `SCOPE_DENIED`, `WORKSPACE_*`, `JOURNAL_*`,
  `INVALID_JSON_VALUE`.
- Sin captura de conversaciones: no existe entrada de mensajes,
  transcripciones ni canales en la API. Sin auto-escritura: productores y
  `reviewProposal` hacen cero escrituras en filesystem. Sin promocion de
  inferencia: solo un `edit` explicito del operador produce `declared`.
  Sin escaneo de archivos del proyecto: las fuentes son el journal
  (incluidos sus snapshots verificados) y el objeto de respuestas
  aportado; nada mas se lee.
- `validateProposal` queda exportada para reutilizar el contrato cerrado
  en la capa de revision.
