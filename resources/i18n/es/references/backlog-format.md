# Backlog portable

Un ítem útil declara identidad, objetivo, alcance, aceptación,
dependencias y estado. El backlog del owner puede usar una representación
distinta. Los planes de Scopegrain usan claves de tarea estables mapeadas a
registros de tarea UUID. La disponibilidad se deriva de las dependencias
actuales; CLOSE no se infiere de un resumen en prosa. La prioridad y la
disponibilidad por dependencias son cosas distintas.

## Capa semántica de tareas (schemaVersion 3)

Los registros de tarea pueden llevar una capa semántica opcional.
Cualquier campo semántico en la creación, o cualquier escritura de
`task meta`/`task disposition`/`task note`/`task step`, actualiza el
registro almacenado a `schemaVersion: 3`. Los registros V1/V2 siguen
válidos para siempre; la capa es ortogonal al ciclo de vida
(`PLAN -> ACT -> VERIFY -> REVIEW -> CLOSE`) y nunca cambia `state`.

| Campo | Tipo | Significado |
|---|---|---|
| `backlog` | slug o null | Backlog nombrado (`[a-z0-9][a-z0-9-]{0,63}`); `null` = `default`. Un proyecto puede tener varios backlogs nombrados. |
| `disposition` | object o null | Estado fuera del ciclo de vida: `{kind: deferred|icebox|future|discarded|cancelled, reason, at, by}`; `null` = activo. Se fija vía `task disposition` (o `active` para limpiar). |
| `priority` | `p0|p1|p2|p3|backlog` o null | Prioridad declarada por el owner. |
| `severity` | `critical|high|medium|low|info` o null | Gradación de impacto. |
| `type` | `bug|feature|refactor|research|docs|ops|mixed` o null | Tipo de trabajo. |
| `effort` | `hours|day|days|weeks` o null | Bucket de esfuerzo dimensionado. |
| `estimate` | `{turns: int>=0, appetite: <effort>}` o null | Turnos estimados más bucket de appetite. |
| `source` | string o null | Procedencia (id de hallazgo, auditoría, plan). |
| `dependsOn` | `[id]` o null | Otros registros de tarea de los que este depende. |
| `relations` | `{see?: [id], supersedes?: [id], duplicateOf?: [id], blocks?: [id]}` o null | Aristas tipadas hacia otras tareas o refs externas. |
| `goalIds` | `[UUID]` o null | Enlaces al log de goals (`goal *`). |
| `analysis` | `{blastRadius?, impact?, invariants?, debt?, debugEvidence?, security?, performance?}` o null | Contexto profundo, cada uno un string. |
| `steps` | `[{name, status: pending|done|skipped, verify?, files?, action?}]` o null | Descomposición atómica; `task step` muta una entrada por índice. |
| `notes` | `[string]` o null | Narrativa append-only (`task note`). |
| `skills` | `[string]` o null | Nombres de capacidades ejercitadas. |
| `uncertainty` | `{uphill: int, downhill: int}` o null | División entre trabajo known-unknown y trabajo resuelto. |

## Capa semántica de planes (schemaVersion 3)

Los registros de plan pueden llevar la semántica heredada del archivo de
plan. Cualquier clave semántica en `plan create` actualiza el plan
almacenado a `schemaVersion: 3`; `specId`/`designId` pasan a ser
presentes-pero-anulables (ambos null o ambos UUIDs). Cada entrada de tarea
del plan puede llevar además `triage` (`do|defer|skip|blocked`) +
`triageReason`, y cualquier campo semántico de tarea excepto `dependsOn`
(que dentro de un plan nombra claves del plan, el DAG).

| Campo | Tipo | Significado |
|---|---|---|
| `triage` | `{taskKey: {decision: do|defer|skip|blocked, reason?}}` o null | Puerta por ítem; las claves deben ser claves de tarea del plan. |
| `appetite` | `hours|day|days|weeks` o null | Presupuesto de tiempo estilo Shape-Up. |
| `cynefin` | `clear|complicated|complex|chaotic|confused` o null | Clasificación de dominio para elegir el enfoque. |
| `riskRegister` | `[{risk, likelihood?, impact?, mitigation?}]` o null | likelihood/impact: `low|medium|high`. |
| `premortem` | string o null | Análisis pre-mortem registrado. |
| `stopConditions` | `[string]` o null | Condiciones que detienen la ejecución. |
| `budget` | `{turns?: int>=0, notes?: string}` o null | Techo de turnos + notas. |

`plan next` es consciente del triage: las entradas triadas
`defer|skip|blocked` reportan estado `triaged` en lugar de
`ready`/`blocked`.

## Memoria operacional (`.scopegrain/memory/*.jsonl`)

Logs JSONL acotados append-only; `memory add --log X --input FILE`,
`memory list --log X [--tail N]`.

- `lessons.jsonl` — `{topic?, text, ref?, taskId?}` aprendizajes duraderos.
- `outcomes.jsonl` — `{taskId, outcome: ok|fail, skills[]}`; alimenta las
  tasas de éxito `skillOutcomes` en `metrics`.
- `progress.jsonl` — `{taskId, title, result, summary?, domain?, ref?}`
  escrito automáticamente cuando una tarea alcanza `CLOSE`.
- `goals.jsonl` — meta/objetivos; `goal create|list|transition`, gana la
  última entrada por `id`; las tareas enlazan vía `goalIds`.

## Métricas derivadas

`metrics --project P` agrega el almacén en lectura: conteos por estado,
backlog, tipo, prioridad y disposición; tasas de pass/first-try de
verificación; p50/p95/p99 de tiempo de cierre; tasas de resultado por
skill.

## Esquema de backlog en tabla markdown (cuando el proyecto mantiene un backlog en tabla)

Si el owner mantiene backlogs como tablas markdown (un archivo o varios
backlogs nombrados), usa un único esquema de fila canónico para toda tabla
de tareas. Diez columnas, en este orden:

`| ID | Severity | Finding | File:line | Effort | Priority | Status | Description | Relations | Dependencies |`

| Columna | Contenido | Vocabulario |
|---|---|---|
| **ID** | `` `PREFIX-NN` `` en backticks en la primera celda | Los backticks permiten al tooling parsear filas de forma determinista. Los prefijos provienen de la taxonomía registrada del proyecto (p. ej. `FIND-*` para hallazgos derivados); los prefijos ad-hoc están prohibidos — regístralos primero |
| **Severity** | Impacto si NO se resuelve | `🔴 Critical` · `🟠 High` · `🟡 Medium` · `🟢 Low` · `ℹ️ Info` · `—` (n/a: features, decisiones, deuda menor) |
| **Finding** | Título corto en negrita, una línea | — |
| **File:line** | Ubicación exacta | `path:line`; varias separadas por ` · `; `—` si n/a |
| **Effort** | Estimación de trabajo | `🟢 1h` · `🟡 1d` · `🟠 2-3d` · `🔴 1-2wk` (o rangos explícitos) |
| **Priority** | Orden de ataque | `🔴 High` · `🟠 Medium` · `🟡 Low` · `🟢 Nice-to-have` · `🔵 Future` · `⬜ Unprioritized` (o un nivel `P0..P3` donde se use) |
| **Status** | Situación actual | `🆕 Pending` (opcional `(YYYY-MM-DD)`) · `⏳ In progress` · `⏸️ Blocked: <reason>` · `🧊 Icebox` · `🔮 Future: <trigger>` · `❌ Discarded: <reason>`. **`✅` no existe en tablas activas**: una fila completada se ELIMINA (queda registrada en el log de progreso; las filas eliminadas sin resolver van a un archivo de historia) |
| **Description** | Contexto: problema → acción → resultado; absorbe las antiguas columnas extra como fragmentos etiquetados (`Type: … · Source: …`) | — |
| **Relations** | Trazabilidad y enlaces | `Origin: <plan#task · commit · report · audit>` · `Source: <research/report>` · `See: <IDs>` · `Supersedes: <ID>` · `Duplicate of: <ID>` · `Owner: <agent/human>` |
| **Dependencies** | Bloqueos / prerequisitos | `Dep: <ID>` · `Requires: <condition>` · `—` |

### Reglas de fila

1. Una fila = una tarea/hallazgo, en UN solo backlog (sin duplicación entre
   archivos; referencia cruzada con `See:`).
2. Una columna sin datos → `—`, nunca una celda vacía (renderizado y parseo
   deterministas).
3. Los pipes dentro del contenido de celda se escapan `\|`.
4. Las tablas de resumen (exec summaries, notas de cierre, logs de
   migración completada) NO son tablas de tareas — fuera de este esquema.

### Filas de ejemplo

**Hallazgo:**
``| `FIND-213` | 🟠 High | **Thread-local pool grows unbounded** | `src/index/search/pool.rs` | 🟡 1d | 🟠 Medium | 🆕 Pending | The pool grows without limit under many search threads; drop doesn't reclaim retained buffers. | Origin: audit 2026-09-30 | — |``

**Tarea de fase:**
``| `SCH-09` | — | **Confidence: scheduled revalidation** | `src/sdk/…` | 🟠 2-3d | 🔴 High | 🆕 Pending | 🎯 OP: … · OS: … | Origin: external audit | Dep: SCH-04 |``

**Fila futura:**
``| `FUT-24` | — | **Deterministic seed in index build** | `src/index/ivf.rs` | 🟡 1d | 🔵 Future | 🔮 Future: use case | Randomized init without a fixed seed → non-reproducible indexes. | Origin: audit | — |``

**Fila de negocio (humana):**
``| `BIZ-16` | — | **Sign binaries (code-signing cert)** | — | 🟠 2-3d + cost | 🟠 Medium | 🆕 Pending | Cert + signing step in release + checksums. | Owner: owner | Dep: certificate |``

<!-- Cross-references: → see definition-of-done.md, task-domain.md, research-modules.md -->
