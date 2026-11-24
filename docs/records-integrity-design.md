# Diseño: checkpoint firmado del journal (records integrity)

> **Estado:** DISEÑO — documento de decisión de la auditoría 2026-11-24.
> No hay implementación: ningún `.mjs` del repo contiene `ed25519`,
> `sign(` ni `checkpoint`. Las firmas, comandos y esquemas descritos
> abajo son propuestas, no código existente.

## 1. Estado real verificado (corrección de premisa)

El encargo describía «journal con hash-chain SHA-256 y `head.json` con
`lastSequence`/`lastHash`». La lectura del código muestra algo distinto
y hay que partir de lo que existe:

| Pieza | Realidad verificada | Referencia |
|---|---|---|
| `head.json` | `{schemaVersion:1, lastSequence, activeOperation:{operationId,intentDigest}\|null, pendingOperations?}` — **no existe `lastHash`** | `src/core/journal.mjs:239-269` |
| Cadena global evento→evento | **No existe.** Los eventos viven dentro de `operations/<uuid>/intent.json`; el orden global lo da `journalSequence` (contigüidad validada dentro de cada intent, `journal.mjs:325-326`) | `src/core/journal.mjs:306-363` |
| Cadena por registro | Sí: eventos `update` llevan `previousHash` (digest de la pre-imagen, CAS de bytes) + `sourceRevision` esperado. Coherencia de cadena comprobada por el modelo de lectura, no por el kernel | `src/core/record-history.mjs`, `docs/journal-recovery.md` (sección «Operaciones de actualización») |
| `sourceHash` por evento | SHA-256 del contenido del blob; snapshot content-addressed en `snapshots/<hash>.blob`, re-verificado en cada lectura | `src/core/journal.mjs:440-447, 794-808` |
| `intentDigest` | `canonicalDigest(intent)` = SHA-256 sobre `canonicalJSON` (serializador propio en `src/core/digests.mjs:6-72`); replicado en `head.activeOperation`, `outbox/<id>.json` y `commit.json` — triple comprobación | `src/core/journal.mjs:406, 500-520, 874-894` |
| Escrituras | `wx` exclusivo + fsync de fichero + `syncDir` + rename atómico de `head.json` vía temporal | `src/core/journal.mjs:164-207` |

Conclusión: hoy la integridad es **procedencia interna** (la auditoría
ya lo declaró: «cadena correcta como procedencia interna; NO
tamper-evident vs rollback/fabricación integral»). Un atacante con
escritura local puede borrar las últimas N operaciones, retroceder
`lastSequence`, reescribir `head.json` o fabricar intents completos sin
que ninguna comprobación lo detecte. Ese es el hueco que cubre este
diseño.

## 2. Modelo de amenaza

### Cubre

| Amenaza | Mecanismo de detección |
|---|---|
| **Truncation** (borrar operaciones/archivo de cola y bajar `lastSequence`) | El último checkpoint firmado declara un `headSequence` mayor que el observado + `headSha256`/`chainHead` que ya no coincide |
| **Rollback** (restaurar un head/intents antiguos) | `headSha256` del checkpoint no coincide con los bytes actuales de `head.json`; con `chainHead` la re-ejecución de la cadena diverge |
| **Fabricación** de eventos, intents o checkpoints sin la clave | Firma Ed25519 inválida o ausente; los checkpoints fabricados no pueden continuar `prevCheckpointDigest` de forma válida |
| **Modificación silenciosa** (bit-rot, edición manual de intents/snapshots) | La verificación offline re-ejecuta digests de events, snapshots e intents y los contrasta con la cadena |
| **Fork** de `checkpoints.jsonl` a mitad de cadena | `prevCheckpointDigest` enlaza cada checkpoint con el digest del anterior; un fork rompe el enlace en el punto de divergencia |

### NO cubre (declarado, no ocultado)

| Amenaza | Por qué queda fuera |
|---|---|
| **Compromiso de la clave privada** | Con la clave, el atacante firma cualquier cosa. La clave vive fuera del journal pero en la misma máquina; esto es tamper-evidence operativa, no HSM |
| **Rewrite atómico completo** (journal + checkpoints + nueva clave) | Indistinguible de un journal legítimo nuevo salvo que la clave pública se hubiera distribuido antes por otro canal |
| **Borrado de TODOS los checkpoints** sin copia externa | `checkpoints.jsonl` truncado a un punto anterior sólo se detecta si el verificador conoce `checkpointSeq`/`digest` del último por vía externa → ver `external-anchoring-eval.md` |
| **Adversario a nivel OS en vivo** | Fuera del threat model del repo (`docs/security.md`: locks cooperativos, sin aislamiento del SO) |
| **Denegación** (borrar el journal entero) | La firma no restaura datos; sólo los hace detectablemente ausentes |

## 3. Decisiones de diseño

### 3.1 Firma: Ed25519 nativo (`node:crypto`)

Verificado ejecutándolo en este repo:

- `crypto.generateKeyPairSync('ed25519')` → par PKCS8/SPKI.
- `crypto.sign(null, payload, privateKey)` → firma de **64 bytes**;
  `crypto.verify(null, payload, publicKey, sig)` → `true`.
- `publicKey.export({format:'der',type:'spki'})` → 44 bytes.

Se elige Ed25519 nativo sobre **minisign** (dependencia externa,
segundo formato que auditar) y sobre HMAC (la verificación offline
exigiría compartir el secreto). Cero dependencias nuevas.

### 3.2 Lo que se firma

Cada checkpoint firma un objeto `checkpoint` autocontenido:

```json
{
  "schemaVersion": 1,
  "checkpointSeq": 7,
  "createdAt": "2026-11-24T12:00:00.000Z",
  "headSequence": 512,
  "headSha256": "<sha256 hex de los bytes exactos de head.json>",
  "chainHead": "<sha256 hex | null>",
  "prevCheckpointDigest": "<sha256 hex del checkpoint anterior | null>"
}
```

- `headSha256` ancla los bytes exactos de `head.json` en ese instante
  (incluye `activeOperation`/`pendingOperations` transitorios — es
  deliberado: cualquier reescritura posterior del head diverge).
- `chainHead` es el campo nuevo propuesto en §3.4. Hasta implementarse
  puede serializarse como `null`; el resto del esquema no cambia.
- `prevCheckpointDigest` enlaza la cadena de checkpoints
  (`= sha256(JCS(checkpoint))` de la línea anterior; `null` en la génesis).
- `checkpointSeq` es un contador monótono estricto (anterior + 1).

### 3.3 Sobre la premisa original `{headSequence, headHash, ts, prevCheckpointHash}`

La propuesta del encargo se mantiene en espíritu con dos correcciones
derivadas del código real:

1. `headHash` se materializa como dos campos: `headSha256` (bytes del
   head actual) y `chainHead` (acumulador de cadena de eventos, §3.4).
   Firmar sólo `lastSequence` sin digest no detecta fabricación.
2. `ts` se nombra `createdAt` y usa el mismo validador ISO estricto que
   el resto del journal (`journal.mjs:75-78`).

### 3.4 `chainHead`: cadena real de eventos (gap detectado)

Como **no existe** cadena global evento→evento, el diseño propone
introducirla en `head.json`:

```
chainHead_0   = sha256("scopegrain-journal-v1")
chainHead_n   = sha256(chainHead_{n-1} || ":" || canonicalDigest(event_n))
```

- Se actualiza dentro de `atomicHead` en el mismo write que ya mueve
  `lastSequence` (integración: `persistIntent`, `journal.mjs:874-894`).
- Cada evento consume su `canonicalDigest` (ya calculado para acks,
  `journal.mjs:457`), así que el coste es O(1) por evento.
- Verificación offline: re-ejecutar la cadena sobre todos los intents
  (live + `archive/operations/`, ordenados por `journalSequence`) y
  comparar con `chainHead` del head o del último checkpoint. O(N) una
  vez por auditoría, no por lectura.
- Retro-compatibilidad: heads sin `chainHead` se tratan como
  `schemaVersion` anterior — migración: primer checkpoint calcula la
  cadena completa y la sella (equivalente a una «foto» inicial).

Alternativa considerada y descartada: firmar `headSha256` solo. Detecta
reescritura del head pero **no** fabricación de historia a igual
`lastSequence` ni permite verificar contenido sin recomputar todos los
snapshots. El acumulador resuelve ambas con coste marginal.

### 3.5 Fichero de checkpoints: `checkpoints.jsonl`

Ubicación: `<paths.state>/journal/checkpoints.jsonl` (mismo árbol del
journal; `paths.state` es configurable por el owner — en este repo
`.scopegrain/state`).

Formato byte a byte — **una línea JSON canónica por checkpoint**:

```json
{"checkpoint":{...objeto de §3.2...},"signature":{"alg":"ed25519","keyId":"<fingerprint>","sig":"<base64>"}}
```

- La línea se serializa con `canonicalJSON` (una línea, sin pretty
  print — ver §4) terminada en `\n`.
- `sig` firma exactamente los bytes UTF-8 de `JCS(checkpoint)` (el
  objeto interno, sin el envoltorio).
- `keyId` = `sha256(publicKey DER spki)` en hex truncado a 16 chars —
  etiqueta de conveniencia, no autenticación (la autenticación es la
  firma verificada contra la clave pública distribuida).
- Append bajo el lock del journal existente (`acquireVerifiedLock`,
  `journal.mjs:213-221`): el checkpoint se emite en
  `finalizeOperation` **después** de limpiar `activeOperation`, o por
  el comando explícito `journal checkpoint`.
- Límite: las líneas son O(200 B); `readDirBounded`/límite de documento
  existentes no aplican a JSONL — se propone tope de política
  `maxCheckpoints` (rotación: truncar líneas anteriores a la última
  sellada externamente sólo bajo flag explícito; por defecto nunca se
  rota).

### 3.6 Claves

- Keyfile separado, **fuera** del árbol journaled:
  `<projectRoot>/.scopegrain/integrity/journal-ed25519.key` (PKCS8 PEM)
  + `.pub` (SPKI PEM). `.scopegrain/` ya está fuera de Git en este repo.
- Permisos 0600 donde el FS lo soporte; en Windows la ACL equivalente
  es responsabilidad del operador (igual que el resto del estado).
- Config: puntero opcional `integrity.signingKey` en `config.json`
  (ruta relativa al proyecto, validada por `resolveInside`); si no hay
  clave, el journaling funciona igual — los checkpoints simplemente
  no se emiten (opt-in, fail-visible, nunca fail-silent: el comando
  `journal verify` reporta «sin firma» explícitamente).
- Rotación: nuevo par → primer checkpoint con `keyId` nuevo incluye
  campo `supersedesKeyId` firmado por la clave NUEVA; la cadena de
  checkpoints continúa (no se reinicia `checkpointSeq`). La confianza
  en la nueva clave se distribuye por el mismo canal que la anterior
  (commit firmado de git, publicación de la pubkey en el repo).

## 4. Canonicalización: `canonicalJSON` ≡ JCS (RFC 8785)

La firma exige bytes estables. `canonicalJSON` (`src/core/digests.mjs`)
ya implementa: claves ordenadas por UTF-16 (`Object.keys(v).sort()`),
serialización de números vía `JSON.stringify` (exactamente el algoritmo
ECMAScript que RFC 8785 §3.2.2.3 adopta) y escapes mínimos de string.

Sobre el **dominio admitido por el journal** (objetos planos, UTF-8
estricto — `decodeUtf8Strict` rechaza pares sustitutos sueltos en la
lectura —, números finitos, sin símbolos ni accessors), la salida es
idéntica a JCS. Divergencias a declarar:

1. Entrada programática con *lone surrogates* en strings produciría
   salida no-JCS; el journal nunca persiste esos bytes (fail-closed en
   lectura), pero un serializador JCS formal rechazaría la entrada.
2. `canonicalJSON` acepta `null` prototype objects; irrelevante para
   JCS (mismo resultado).
3. JCS no define `undefined`/`bigint`/`NaN` — `canonicalJSON` los
   rechaza con `INVALID_JSON_VALUE`, más estricto, compatible.

Vectores de prueba (calculados con el código real, `digests.mjs`):

| Entrada JS | `canonicalJSON` | `canonicalDigest` (SHA-256) |
|---|---|---|
| `{b:"x",a:1}` | `{"a":1,"b":"x"}` | `ecf9e98ec0641e23113ff3ce8bdc78d0ddd249886517fd4a7f68cc83d4e65667` |
| `{n:1e21,m:-0,s:"€"}` | `{"m":0,"n":1e+21,"s":"€"}` | `1f89e64f1c7fe76427a3470dfeaffbd0f946ad4f29c37d14270ba51925d8fd20` |
| Checkpoint génesis de §3.2 (seq 0, `headSha256`=64 ceros, `chainHead`/`prevCheckpointDigest` null, `createdAt` `2026-11-24T00:00:00.000Z`) | `{"chainHead":null,"checkpointSeq":0,"createdAt":"2026-11-24T00:00:00.000Z","headSequence":0,"headSha256":"0000000000000000000000000000000000000000000000000000000000000000","prevCheckpointDigest":null,"schemaVersion":1}` | `1a0d29b90e1807e1b795298172e40c3a5d50469bc694f2eee1481091cf24baec` |

Los vectores 1 y 2 reproducen los casos clásicos de RFC 8785
(ordenación de claves, `1e+21`, `-0`→`0`, euro sin escapar) y confirman
la equivalencia sobre el dominio admitido.

## 5. Esquemas (propuesta, `schemas/`)

- `schemas/journal-checkpoint.schema.json` — forma cerrada de la línea
  de §3.5 (`checkpoint` requerido, `signature` requerido, claves
  cerradas igual que `plain()` en `journal.mjs:35-50`).
- `schemas/journal-head.schema.json` — ampliar cuando exista
  `chainHead` (hoy no hay schema publicado de head; los schemas del
  journal cubren intent/commit/recovery).
- **Sidecars mutables**: los stores opt-in (tasks, approvals, sessions,
  plans, workspaces) mantienen sidecars mutables
  (`record-ownership/`, `session-ownership/`) cuyas revisiones ya son
  eventos `update` journaled con `previousHash` CAS. El checkpoint no
  firma sidecars directamente: quedan cubiertos vía la cadena del
  journal + el re-proof por prefijo que ya hace `owned-chain.mjs`
  (cada snapshot de sidecar re-prueba el prefijo de su cadena,
  `transition.mjs:573-609`). El schema existente
  `schemas/record-ownership.schema.json` no cambia.

## 6. Puntos de integración (concretos, no implementados)

| Punto | Cambio propuesto | Referencia actual |
|---|---|---|
| `persistIntent` | Calcular `chainHead` incremental por evento y escribirlo en el head reservado | `src/core/journal.mjs:874-894` |
| `atomicHead` | Sin cambio de mecanismo (temp+rename ya es atómico); el objeto head gana `chainHead` | `journal.mjs:196-207` |
| `validateHead` | Admitir `chainHead` opcional (hash regex `HASH` ya existe) | `journal.mjs:239-257` |
| `finalizeOperation` | Punto de emisión de checkpoint post-commit (cadencia: cada commit o N commits — recomendado cada commit, coste ~0.2 ms) | `journal.mjs:898-924` |
| `compactJournal` | Nada: archiving no altera eventos ni cadena; `checkpoints.jsonl` no se compacta | `journal.mjs:658-699` |
| `recoverJournalOperation` | Nada: los recibos `recovery.json` no son eventos; la cadena no cambia | `journal.mjs:1374-1402` |
| CLI | `journal checkpoint [--project P]` (emite) y `journal verify [--project P] [--export DIR]` (verifica cadena + firmas + checkpoints, todo offline) | `src/cli.mjs` |
| Verificador standalone | `scripts/verify-checkpoints.mjs` autocontenido (~150 LOC: `node:crypto` + copia del algoritmo `canonicalJSON` + lectores JSONL). Exportable: la carpeta `{head.json, checkpoints.jsonl, operations/, archive/, snapshots/, journal-ed25519.pub}` es un bundle verificable fuera del repo | nuevo |

## 7. Qué NO se propone

- Firmar eventos individuales (sobre-ingeniería: el checkpoint + la
  cadena ya los cubre; los intents ya son inmutables por convención `wx`).
- Transparency log obligatorio (evaluado aparte en
  `external-anchoring-eval.md`; aquí queda como export opcional).
- Autenticar actores (`authorContext`/`reviewerContext` siguen siendo
  declaraciones — registrado en `known-limitations.md`).
- HMAC ni dependencia de librería de firmas.

## 8. FMEA residual de la propuesta

| Fallo | Efecto | Mitigación |
|---|---|---|
| `checkpoints.jsonl` truncado a línea k | Detectable sólo con copia externa del último digest | Anclaje externo opcional; `journal verify --expect-digest` |
| Clave legible por otro proceso del usuario | Firma forjada bajo el mismo perfil OS | Documentado: mismo límite que locks cooperativos |
| Head migrado a `chainHead` con un evento corrompido a la vez | Cadena sella el byte corrupto | Migración exige re-verificación completa previa (fail-closed) |
| Reloj del sistema hacia atrás | `createdAt` no monótono; firma sigue siendo válida | `createdAt` es declarativo; el orden lo garantizan `checkpointSeq` y `prevCheckpointDigest`, no el reloj |
| Clave pública nunca distribuida | Rewrite total indetectable | Publicar pubkey en repo/tag firmado (ver runbook de release) |
