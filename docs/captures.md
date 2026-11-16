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

El CLI expone exactamente dos comandos agrupados sobre el store; el
proyecto ya debe estar enrolado: config creada y
`node ./bin/scopegrain.mjs workspace init --project "C:\ruta\mi-proyecto" --apply`
(sin `--apply` el enrolamiento es solo vista previa). Los grants de area
se derivan del workspace registrado; `workspace show` devuelve los IDs de
sus areas:

```powershell
node ./bin/scopegrain.mjs capture create --project "C:\ruta\mi-proyecto" --input capture.json
node ./bin/scopegrain.mjs capture create --project "C:\ruta\mi-proyecto" --input capture.json --apply
node ./bin/scopegrain.mjs capture show "66666666-6666-6666-6666-666666666666" --project "C:\ruta\mi-proyecto"
```

Los placeholders (`<area-id-del-workspace>`, el UUID del ejemplo) deben
reemplazarse por IDs reales devueltos por `workspace show` y por
`capture create --apply`/`capture show`.

(`tasksystem` sigue siendo un alias compatible.) `--input` es una ruta del
directorio de trabajo actual, no relativa al proyecto. `--config REL`
selecciona una configuracion explicita; las rutas de memoria y estado se
heredan de esa configuracion, nunca se escriben por defecto. Sin `--apply`,
`create` es una vista previa de solo lectura con identidad provisional;
`--apply` devuelve el valor completo del core, incluido el resultado del
journal con sus recibos e incertidumbre preservados. En `create` no hay
`--force`, `--yes` ni seleccion de destino, namespace, hash o ID propio
por linea de comandos; `show` acepta el UUID del registro y `supersedes`
referencia una nota previa.

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
