# Scopegrain — Mapa completo de capacidades

Catálogo detallado de superficies, subsistemas, comandos y garantías del harness.
Estado de referencia: rama `develop`, `scopegrain@0.1.0`, suite `1228/1228` tests.

> Convenciones: *(write)* = muta estado; *(preview/apply)* = dry-run por defecto,
> `--apply` confirma; lo demás es read-only. `--yes`/`--force` no existen: toda
> confirmación es explícita. Salida siempre JSON (stdout resultados, stderr errores).

---

## 1. Superficies de entrada

| Superficie | Inventario | Acceso |
|---|---|---|
| CLI `bin/scopegrain.mjs` (alias `bin/tasksystem.mjs`) | ~95 subcomandos, imports perezosos por comando | Humano y agente |
| MCP `src/mcp/server.mjs` | 33 tools `scopegrain_*`: 27 `READ_ONLY` + 6 `WRITE_LOCAL` (incl. `mcp_inventory` auto-descriptivo) | Hosts MCP (stdio) |
| API local `src/api/server.mjs` | 29 rutas GET `/api/*` | Loopback-only, GET-only |
| Visor `viewer/` (`scopegrain view`) | 15 vistas React 19 + TS + Vite + Tailwind | Read-only, humano |
| Catálogo `resources/manifest.json` | 130 entradas + 32 aliases | Proyectable al proyecto |

---

## 2. CLI — catálogo por dominio

### 2.1 Descubrimiento y onboarding

| Comando | Qué hace |
|---|---|
| `inspect` | Snapshot acotado de manifiestos (8 stacks, lockfiles por presencia, scripts test/lint/build de package.json, AGENTS/CLAUDE/README, fingerprint sha256). Guarda `discovery.json` |
| `investigate [--save] [--diff]` | Análisis semántico: + dart/flutter/swift/gradle, topología monorepo, plataformas, frameworks de test, CI, hosts, i18n, layout. Sugiere respuestas de init con confianza+evidencia. `--save` persiste un research record. `--diff` compara la evidencia actual contra `discovery.json`+config: fingerprint, manifiestos/lockfiles ±/retenidos, contenido cambiado, stacks/comandos ±, señales de host nuevas, decisiones stale, notas |
| `assess --input DIFF` | Clasificación de riesgo solo-por-evidencia sobre un unified diff (paths, modos, contenido): tier `passive|medium|high`, razones, `review_due`. Fail-closed, solo lectura, sin git/child_process; `--assessment` reporta discrepancia vs riesgo declarado |
| `init` | Onboarding: investiga, pregunta nombre/locale/hosts/methodology, **7 rutas** (`plans tasks reports research decisions memory state`), **8 flags de versionado**, propone `.gitignore` acotado y siembra el índice estructural. `--defaults`/`--answers` para no interactivo |
| `adopt` | Determinista: reporta config, enrollment y journal de un proyecto con restos previos; `--apply` solo crea el enrollment si `adoptable` |
| `doctor` | ~21 checks: instalación + salud operativa (ver §7) |
| `structure scan/status/show` | Índice estructural acotado del árbol: inventario, LOC/bytes por lenguaje, imports, aristas internas/externas, fan-in/fan-out, complejidad heurística, fingerprint determinista. `scan --apply` persiste en `<state>/cache/structure-index.json`; `status` reporta frescura sin re-escanear; `context` lo expone al agente |
| `update [--reconcile]` | Re-proyecta archivos generados desde la instalación actual; `--reconcile` reescribe solo los divergentes bajo raíces del harness |
| `uninstall` | Borra solo lo demostrablemente creado por el harness; archivos divergentes quedan `leftBehind` |

### 2.2 Contexto y workflow

| Comando | Qué hace |
|---|---|
| `context [--tail N]` | Packet de arranque de sesión: instrucciones, `context.md` del usuario, workspace, tareas listas, goals, journal pendiente, worklog reciente (degradable, nunca aborta) |
| `workflow COMMAND` | Packet de un comando instalado: resources + modes + host + profile + interaction |
| `task check-action` | Gate: ¿puedo ejecutar ACTION sobre la tarea ahora? (acciones abstractas read/edit/propose/…; `interceptsNativeTools:false`) |
| `methodology check` | Readiness de tarea hacia `ACT`/`ACCEPT` según modo metodológico; `--outcome-evidence` simula el report |

### 2.3 Tareas, planes, sesiones

| Comando | Qué hace |
|---|---|
| `task create/list/show` | Records V3 con dependencias, scope, metodología |
| `task meta` | Actualiza campos (patch controlado, bump de revisión) |
| `task disposition` | `deferred\|icebox\|future\|discarded\|cancelled`; discarded/cancelled bloquean todo salvo ABANDON |
| `task note` / `task step` | Notas y estado por paso (pending/done/skipped) |
| `task transition` | CAS + evidencia + gate metodológico + disposiciones terminales |
| `task doc` | Render del documento de contrato de la tarea |
| `task activate/active/deactivate` | Puntero de tarea activa (`SCOPEGRAIN_TASK` > `<state>/active-task`); slugs `NNN-` monotónicos por tarea |
| `task converge` | Compara implementación vs spec/plan/tasks → findings tipados + veredicto; `--record` persiste create-only |
| `task analyze` | Reporte cross-artifact con severidades y cobertura spec↔plan↔tasks |
| `task checklist` | Artefactos `CHK###` reviewer-owned (create-only, CAS, gate en converge) |
| `plan create/list/show/next` | Planes con tasks y dependencias |
| `plan stories` | Render `tasks.md` por user-story (`T###`, `[P]`, fases) |
| `plan run` | Scheduling por olas respetando el DAG de dependencias |
| `session create/show/record/resume` | Sesiones con presupuesto explícito de operaciones (límite `maxSessionEvents`), CAS, lock propio, eventos ACT |

### 2.4 Journal (integridad transaccional)

| Comando | Qué hace |
|---|---|
| `journal list/show` | Operaciones y eventos; resuelve `operations/` + `archive/operations/` |
| `journal recover` | Finaliza o abandona una operación interrumpida (crash recovery, nunca replay) |
| `journal compact` | Archiva ops terminales a `archive/operations/` (rename atómico, idempotente, procedencia intacta) |

### 2.5 Records owned (cadena de propiedad criptográfica)

Cada tipo es una cadena hash: genesis + updates encadenados, binding de scope
(UUIDs), snapshot verificable, sidecar de ownership en `<state>/record-ownership/`.
Implementados sobre `owned-store.mjs` (factory) + `owned-chain.mjs` (primitivas).

| Dominio | Comandos |
|---|---|
| Specifications | `specification create/show [--owned]` |
| Designs | `design create/show --owned` (vinculados a spec por digest) |
| Outcomes | `outcome create/show --owned` (report V2 con 9 campos computados) |
| Captures | `capture create/show`, `capture proposals` (desde journal), `capture review` (HITL) |
| Artifacts | `artifact add/list/show KIND` |
| Approvals | `approval target/create/show/answer` (pendientes/respondidas/revocadas) |

### 2.6 Memoria, goals, métricas, actividad

| Comando | Qué hace |
|---|---|
| `memory add/list --log lessons\|outcomes\|progress` | Worklogs JSONL; rotación a `memory/archive/` >1 MiB (best-effort); lectura por ventana de cola acotada |
| `goal create/list/transition` | Goals vinculados a tareas, progreso agregado |
| `metrics` | Agregados de store + tasas de outcome |
| `report save/list` | Reports persistidos |
| `activity record` | Actividad que enlaza tarea + progreso |

### 2.7 Catálogo, recursos, hosts, hooks

| Comando | Qué hace |
|---|---|
| `catalog list/show/check` | Manifiesto canónico, snapshots SHA-pinned, drift |
| `catalog legacy/legacy-show` | Procedencia congelada de recursos legacy (solo metadata) |
| `resource search/diagnose` | Recursos instalados vs snapshot; tamper-evidence |
| `resource restore-plan/restore` | Restore CAS con re-verificación TOCTOU |
| `host activate` | Fragmentos nativos por host+surface; hosts: claude, codex, opencode, devin, antigravity, hermes, generic (provisional). Proponer ≠ activar; solo destinos project-local |
| `hooks install/uninstall` | Bloque administrado en `post-commit`, idempotente, nunca toca hooks del usuario |
| `helper install/list` | Helper scripts project-local con manifiesto declarativo (el harness nunca los ejecuta) |
| `specification clarify` | Sesiones de clarificación fechadas, create-only, sobre la spec |
| `constitution show/set` | Constitución versionada semver + complexity tracking |

### 2.7b Distribución declarativa (familia `dist`)

| Comando | Qué hace |
|---|---|
| `dist run` | Runner de workflows declarativos: solo primitivas whitelisted del harness, checkpoints atómicos en `<state>/workflow-runs/`, resume sin re-ejecución |
| `dist stack` | Fusiona catálogos `file://` por prioridad; URIs remotas = `REMOTE_CATALOG_UNSUPPORTED` (nunca descarga) |
| `dist compose` | Composición en capas `replace/prepend/append/wrap` de recursos |
| `dist validate` / `dist bundle-validate` | Validación de submissions: id slug, semver, `source.uri`, sha256 obligatorio en fuentes remotas; bundles con pins + detección de missing |
| `dist bundle-install` | Copia fuentes `file://` requeridas bajo `<configDir>/bundles/<id>/` (256 archivos / 16 MiB max, create-only, idempotente, provenance content-addressed) |
| `dist extension-register/list/activate/deactivate` | Registro create-only + lifecycle `registered→active⇄disabled`; activate valida `contributes` contra el catálogo del workspace |
| `dist preset-register/list` | Registro create-only de presets; `overrides` con `target` (`*`, `kind/*`, `kind/id`) se consumen en `buildWorkflowPacket` con traza en `packet.presets.applied` |

### 2.8 Verificación acotada

| Comando | Qué hace |
|---|---|
| `verify discover` | Infiere candidatos desde manifests reales (nunca inventados; pm ambiguo → skipped) |
| `verify add/approve/approve-discovered` | Whitelist explícita, tamper-evident, preview+apply |
| `verify run ID` | Ejecuta solo comandos aprobados como argv literal (nunca shell): timeout acotado, output capado, `--fail-on-error` opcional |

### 2.9 Ciclo de vida de la instalación

| Comando | Qué hace |
|---|---|
| `backup --to REL` | Bundle auto-descriptivo con hash por entrada; streaming, create-only |
| `restore --from REL` | Restore con re-verificación TOCTOU y rollback por `createdAbs` |
| `view` | Sirve API loopback read-only + visor estático |

### 2.10 Integración VantaDB (opcional, nunca autoritativa)

`vantadb setup/status/sync/get/search/list/reinforce/recall/context/distill/sync-memory`
— proyección L1 del journal/worklogs al motor de memoria externo; binario con
sha256 + cache, spawn con env pinned; solo drena eventos committed+acked.

### 2.11 Otros

| Comando | Qué hace |
|---|---|
| `mcp` | Arranca el servidor MCP (stdio) |
| `workspace show/init` | Enrollment con binding opaco |

---

## 3. MCP — 32 tools `scopegrain_*`

### Read-only (26)

`artifact_get`, `approval_get`, `catalog_get`, `catalog_list`, `check_action`,
`get_task`, `goal_list`, `inspect`, `list_tasks`, `memory_context`, `memory_get`,
`memory_read`, `memory_recall`, `memory_search`, `memory_status`,
`methodology_check`, `metrics`, `plan_get`, `plan_next`,
`resource_diagnose`, `resource_search`, `session_get`, `session_resume`,
`specification_get`, `status`, `workflow_packet`

### Write-local (6)

| Tool | Mutación |
|---|---|
| `scopegrain_next_task` | Reclama la siguiente tarea cuando se pasa `claimBy` (read si se omite) |
| `scopegrain_task_meta` | Aplica un patch controlado de metadatos con CAS de revisión |
| `scopegrain_task_disposition` | Fija/limpia la disposición de una tarea |
| `scopegrain_memory_add` | Append a un worklog `lessons\|outcomes\|progress` |
| `scopegrain_goal_create` | Crea un goal |
| `scopegrain_goal_transition` | Transición de goal (`open\|achieved\|dropped`) |

Ver `resources/references/mcp-tools.md` para la clasificación canónica por tool.

Reglas: argumentos acotados y schemas estrictos; importar `server.mjs` nunca
arranca transporte ni exige deps extra; errores core pasan sin traducir.

---

## 4. API local — 29 rutas GET

`/api/health` · `workspace` · `tasks` · `tasks/:id` · `tasks/:id/doc` ·
`plans` · `plan-docs` · `plan-docs/:name` · `plans/:key` · `artifact-docs` ·
`artifact-docs/:kind/:name` · `artifacts` · `artifacts/:kind/:id` ·
`journal/operations` · `journal/operations/:id` · `captures` · `memory` ·
`goals` · `metrics` · `reports` · `reports/:name` · `sessions` · `sessions/:id` ·
`approvals` · `approvals/:id` · `catalog` · `verify` · `vantadb` · `workflow`

Seguridad: loopback únicamente, solo GET, anti-DNS-rebinding (Host/Origin),
`Cache-Control: no-store`, `nosniff`, `no-referrer`.

## 5. Visor — 15 vistas

Tasks · Plans · Goals · Sessions · Journal · Captures · Artifacts · Catalog ·
Memory · Reports · Approvals · Metrics · Workspace · System · Graph
(DAG de dependencias + funnel de lifecycle).

Producto: Markdown renderizado (react-markdown+GFM), i18n EN/ES, `ErrorBoundary`
por pestaña con retry y detalles colapsables, a11y (teclado en filas, `aria-*`,
SVGs etiquetados), toolchain completo (vitest+RTL, eslint flat, typecheck, CI lane).

---

## 6. Máquina de estados (`policy/workflow.json`)

Estados (11): `PLAN → ACT → VERIFY → [COLLATERAL] → EVALUATE → REVIEW → ACCEPT → CLOSE`,
más `RESEARCH`, `STALL`, `ABANDON` (terminal). Reglas:

- CAS obligatorio (`expectedRevision`); evidencia prohibida en `→ACT` (la anula).
- `REVIEW→REVIEW` solo para adjuntar evidencia verification/review.
- Gate universal de ACCEPT: todos los checks `pass` + review `approve`
  (`fresh`: reviewerContext ≠ authorContext; `waived`: owner+reference+reason).
- Gate metodológico re-evaluado en `→ACT`, `→ACCEPT` y `→CLOSE`.
- Dispositions `discarded`/`cancelled` → solo `→ABANDON`.
- Origen legacy C0: espina fiel; divergencias deliberadas — COLLATERAL opcional
  (`VERIFY→EVALUATE` directo), `VERIFY→ACT`/`REVIEW→ACT` en re-trabajo,
  STALL recuperable, ABANDON nuevo, guardas cuantitativas legacy
  (Gate V, budgets, WIP) declaradas pero sin enforcement.

## 7. Metodologías (`policy/methodology.json`)

| Modo | ACT exige | ACCEPT adicional |
|---|---|---|
| `manual` | Nada (V1 sin gates) | Gate universal |
| `organic-sdd` ruta `light` | Assessment válido clasificado `light` + scope | + shapes de verification/review |
| `organic-sdd` ruta `sdd` / `sdd` | Par `specId`+`designId`, bindings sanos, spec sin open questions, approvals vigentes, deps en CLOSE, ≥1 scenario | + cobertura exacta de `scenarioRefs` + `OUTCOME_REQUIRED` (report V2 aprobado) |

- **ODD = Organic-Driven Development** (`oddDefinition:"organic-driven"`, enforceado).
- "Outcome-Driven" NO es modo: los outcome records son evidencia de aceptación.
- Rutas internas: `manual`, `read-only`, `blocked`, `light`, `sdd`.
- `researchEscalation` (2 fallos → investigar, 3 → revisar diseño): declarada, sin enforcement.

## 8. Garantías estructurales

- **Fail-closed**: malformación/tampering/binding stale/scope insuficiente → error tipado antes de escribir.
- **Create-only + CAS**: nunca se sobrescriben bytes ajenos; foreign files siempre preservados.
- **Journal transaccional**: committed + ACK; recovery via receipt; locks `{t,pid,at}` (pid muerto reclamable, vivo jamás, legacy por TTL, anti-carrera dev/ino).
- **Symlinks/junctions rechazados** en journal, scopes, restore, metadata.
- **Determinismo**: misma entrada → mismos bytes; timestamps por caller.
- **Acotado**: budgets de tamaño/profundidad en toda lectura de estado no confiable.
- **Sin efectos implícitos**: MCP import no arranca server; CLI lazy; ejecución `manual`, network `ask`, push `ask`.
- **Privacidad**: material secreto-adyacente nunca se lee ni lista en discovery.

## 9. Recursos canónicos (proyectables)

`resources/` — 44 skills · 22 rules · 17 commands · 15 agents · 24 references ·
4 prompts · profiles · mcps. `manifest.json` es el catálogo con snapshots SHA
(`catalog check` verifica drift); instalación via `init`/`update`, versionado
opt-in por categoría.

## 10. Estado y rutas

| Clave | Default | Contenido |
|---|---|---|
| `state` | `.scopegrain/state/` | journal, sessions, workspace, verify-commands, record-ownership, init-session, `cache/structure-index.json` |
| `plans` | `.scopegrain/plans/` | planes + `specs/` |
| `tasks` | `.scopegrain/tasks/` | records de tarea |
| `reports` | `.scopegrain/reports/` | reports + `reviews/` (fijo) |
| `research` | `.scopegrain/research/` | research records |
| `decisions` | `.scopegrain/decisions/` | `approvals/` |
| `memory` | `.scopegrain/memory/` | worklogs JSONL, `archive/`, `captures/`, goals |
| config dir | `.scopegrain/` | config.json, instructions.md, discovery.json, catalog.json, resources instalados, policy, context.md |

Legacy `.tasksystem/` sigue siendo honrado como ruta de estado alternativa.

## 11. Deuda y gaps conocidos (auditoría 2026-11-20)

1. **Discovery**: resuelto parcialmente — `structure` (índice estructural: LOC, imports, aristas, complejidad heurística, fingerprint) implementado 2026-11-21. Siguen sin: AST real/símbolos (delegado al agente host por diseño), Deno/Makefile/Docker/devcontainer/versiones de runtime, contenido de workflows CI.
2. **Research agentic**: los 5 workflows legacy (`bug-fix`, `feature-add`, `refactor`, `research`, `nine-second-saloon`) tienen `replacement: null`; sobreviven como recursos proyectables, no como capacidad del core.
3. ~~**`diffInvestigation`**~~: resuelto — expuesta como `investigate --diff` (2026-11-21) y embebida en el warning de fingerprint de `doctor`.
4. **Doctor**: resuelto parcialmente — añadidos checks de runtime Node, parseo de policy, journal internals (outbox/archive), verify store, sessions, worklogs, ownership sidecars, `vantadb.json` (shape-only, sin runtime) y hooks gestionados (2026-11-21). Siguen sin: deps MCP instaladas, build del visor, artefactos de usuario. Locks stale y drift de fragmentos en hosts añadidos después (warning auto-recuperable y divergencia como fallo, respectivamente).
5. **Guards cuantitativas legacy**: resuelto parcialmente — `researchEscalation` enforceado 2026-11-21 (3 reworks `VERIFY→ACT` sin visita a `RESEARCH` bloquean `→ACT`). Siguen sin: budgets de iteración/duración, WIP, y la mitad "similar failures" de la escalada (requeriría hipótesis como campo de record).
6. **Tests**: coste dominado por fixture de instalación completa (~230 archivos+fsync × ~119 llamadas) y `--test-concurrency=1` (pinneado tras evento de memoria Windows). Palancas: smoke subset, concurrencia 2, mini-fixtures, parametrización owned-*.
7. **Init**: subestructuras internas (journal, verify, sessions, reviews, captures, approvals, vantadb storage) no configurables por answers — fijas por diseño.
8. ~~**Rehidratación de contexto**~~: resuelto 2026-11-21 — `context` inyecta `memory_recall` L1 automático y `session resume` + MCP `scopegrain_session_resume` inyectan `memory_context` por `recordId`; degradable y fail-closed (`--no-vantadb`/`--timeout`).
