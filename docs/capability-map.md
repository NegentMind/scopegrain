# Scopegrain — Mapa completo de capacidades

Catálogo detallado de superficies, subsistemas, comandos y garantías del harness.
Estado de referencia: rama `develop`, `scopegrain@0.1.1`, catálogo `140` entradas
(`manifest.json` v`0.1.2`); la cifra vigente de la suite de tests se registra en
[verification](verification.md) (cambia con cada ejecución).

> Convenciones: *(write)* = muta estado; *(preview/apply)* = dry-run por defecto,
> `--apply` confirma; lo demás es read-only. `--yes`/`--force` no existen: toda
> confirmación es explícita. Salida siempre JSON (stdout resultados, stderr errores).

---

## 1. Superficies de entrada

| Superficie | Inventario | Acceso |
|---|---|---|
| CLI `bin/scopegrain.mjs` (alias `bin/tasksystem.mjs`) | ~95 subcomandos, imports perezosos por comando | Humano y agente |
| MCP `src/mcp/server.mjs` | 34 tools `scopegrain_*`: 22 `READ_ONLY` + 6 `READ_BACKEND` (`openWorldHint`, spawn del binario VantaDB enrolado) + 6 de escritura (4 `WRITE_LOCAL` + 2 `WRITE_DISCARD`) | Hosts MCP (stdio) |
| API local `src/api/server.mjs` | 30 rutas GET `/api/*` | Loopback-only, GET-only |
| Visor `viewer/` (`scopegrain view`) | 15 vistas React 19 + TS + Vite + Tailwind | Read-only, humano |
| Catálogo `resources/manifest.json` | 140 entradas + 32 aliases | Proyectable al proyecto |

---

## 2. CLI — catálogo por dominio

### 2.1 Descubrimiento y onboarding

| Comando | Qué hace |
|---|---|
| `inspect` | Snapshot acotado de manifiestos (7 stacks `MANIFEST_STACK`: node, rust, python, go, java, php, ruby — más dotnet por extensión, lockfiles por presencia, scripts test/lint/build de package.json, AGENTS/CLAUDE/README, fingerprint sha256). Guarda `discovery.json` |
| `investigate [--save] [--diff]` | Análisis semántico: + dart/flutter/swift/gradle, topología monorepo, plataformas, frameworks de test, CI, hosts, i18n, layout. Sugiere respuestas de init con confianza+evidencia. `--save` persiste un research record. `--diff` compara la evidencia actual contra `discovery.json`+config: fingerprint, manifiestos/lockfiles ±/retenidos, contenido cambiado, stacks/comandos ±, señales de host nuevas, decisiones stale, notas |
| `assess --input DIFF` | Clasificación de riesgo solo-por-evidencia sobre un unified diff (paths, modos, contenido): tier `passive|medium|high`, razones, `review_due`. Fail-closed, solo lectura, sin git/child_process; `--assessment` reporta discrepancia vs riesgo declarado |
| `init` | Onboarding: investiga, pregunta nombre/locale/hosts/methodology, **7 rutas** (`plans tasks reports research decisions memory state`), **8 flags de versionado**, propone `.gitignore` acotado y siembra el índice estructural. `--defaults`/`--answers` para no interactivo |
| `adopt` | Determinista: reporta config, enrollment y journal de un proyecto con restos previos; `--apply` solo crea el enrollment si `adoptable` |
| `doctor` | ~35 checks: 27 familias con nombre + 7 `paths.*` siempre, más las condicionales `journal-internals` (con journal) y `upgrade` (ante divergencia de snapshot); instalación + salud operativa |
| `structure scan/status/show` | Índice estructural acotado del árbol: inventario, LOC/bytes por lenguaje, imports, aristas internas/externas, fan-in/fan-out, complejidad heurística, fingerprint determinista. `scan --apply` persiste en `<state>/cache/structure-index.json`; `status` reporta frescura sin re-escanear; `context` lo expone al agente |
| `update [--reconcile]` | Re-proyecta archivos generados desde la instalación actual; `--reconcile` reescribe solo los divergentes bajo raíces del harness y los destinos host aplicables demostrablemente generados (merge targets y archivos manuales siguen como `conflict`); la acción `managed` refresca in-place solo regiones `SCOPEGRAIN:BEGIN..END`; reporta `hostBridges` |
| `uninstall` | Borra solo lo demostrablemente creado por el harness; archivos divergentes quedan `leftBehind` |

### 2.2 Contexto y workflow

| Comando | Qué hace |
|---|---|
| `context [--tail N] [--no-vantadb] [--no-structure]` | Packet de arranque de sesión: instrucciones, `context.md` del usuario, `locale`, workspace, tareas listas, goals, journal pendiente, worklog reciente (degradable, nunca aborta). `--no-structure` sirve el índice persistido sin re-escanear (`structureDebounceMs` existe a nivel API); `tokenEstimate` declara `excludesSelf:true` y la cifra auto-inclusiva `wire`; `warnings[]` avisa cuando el wire supera el presupuesto advisory `packetBudgetTokens` (16000, `policy/operation-limits.json`) |
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
| `session create/show/record/resume` | Sesiones con presupuesto explícito de operaciones (límite `maxSessionEvents`), CAS, lock propio, eventos ACT; presupuesto de tokens auto-reportados opcional (`tokenLimit`, `self-reported-unverified`) |

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
| `host activate` | Fragmentos nativos por host+surface; hosts: claude, codex, opencode, devin, antigravity, hermes, generic (provisional). Cada destino declara `activationMode: apply\|merge\|manual` (el campo legado `manualMerge` se conserva deprecado); los merge targets (`.mcp.json`, `.codex/config.toml`, `opencode.jsonc`, `.devin/config.json`, `.agents/mcp_config.json`, `.devin/mcp_config.json`) son machine-local, gitignored y auditados por el check `host-merge-targets` de `doctor`. Proponer ≠ activar; solo destinos project-local |
| `hooks install/uninstall` | Bloque administrado en `post-commit`, idempotente, nunca toca hooks del usuario |
| `helper install/list` | Helper scripts project-local con manifiesto declarativo (el harness nunca los ejecuta) |
| `specification clarify` | Sesiones de clarificación fechadas, create-only, sobre la spec |
| `constitution show/set` | Constitución versionada semver + complexity tracking |

### 2.7b Distribución declarativa (familia `dist`)

| Comando | Qué hace |
|---|---|
| `dist run` | Runner de workflows declarativos: solo primitivas whitelisted del harness (`task.transition`, `methodology.check`, `converge.*`, `analyze.task`, `checklist.*`, `noop`), args cerrados por op — `task.transition` acepta `verification`/`review` (`evidence` como alias, ambos juntos se rechazan); checkpoints atómicos en `<state>/workflow-runs/`, resume sin re-ejecución |
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
— proyección L1 del journal/worklogs al motor de memoria externo; `binarySha256`
obligatorio en `vantadb.json` (verificado antes de cada spawn), spawn con
allowlist de env (sin herencia de `process.env`), `secretEgressCheck` bloquea
nombres/patrones de secretos en la proyección; solo drena eventos
committed+acked.

### 2.11 Otros

| Comando | Qué hace |
|---|---|
| `mcp` | Arranca el servidor MCP (stdio) |
| `workspace show/init` | Enrollment con binding opaco |

---

## 3. MCP — 34 tools `scopegrain_*`

### Read-only locales (22) — `readOnlyHint`, `openWorldHint:false`

`approval_get`, `artifact_get`, `catalog_get`, `catalog_list`, `check_action`,
`get_task`, `goal_list`, `inspect`, `list_tasks`, `mcp_inventory`, `memory_read`,
`memory_status`, `methodology_check`, `metrics`, `plan_get`, `plan_next`,
`resource_diagnose`, `resource_search`, `session_get`, `specification_get`,
`status`, `workflow_packet`

### Read-only con backend (6) — `readOnlyHint` + `openWorldHint:true`

Semántica de lectura, pero el handler lanza el binario `vantadb-server`
enrolado y envía datos al backend de memoria configurado:

`context`, `memory_context`, `memory_get`, `memory_recall`, `memory_search`,
`session_resume`

### Escritura local (6)

| Tool | Mutación | Anotación |
|---|---|---|
| `scopegrain_next_task` | Reclama la siguiente tarea cuando se pasa `claimBy` (read si se omite) | `WRITE_LOCAL` |
| `scopegrain_task_meta` | Aplica un patch controlado de metadatos con CAS de revisión | `WRITE_LOCAL` |
| `scopegrain_memory_add` | Append a un worklog `lessons\|outcomes\|progress` | `WRITE_LOCAL` |
| `scopegrain_goal_create` | Crea un goal | `WRITE_LOCAL` |
| `scopegrain_task_disposition` | Fija/limpia la disposición de una tarea | `WRITE_DISCARD` (`destructiveHint`: semántica de descarte) |
| `scopegrain_goal_transition` | Transición de goal (`open\|achieved\|dropped`) | `WRITE_DISCARD` (`destructiveHint`: `dropped` descarta el goal) |

Ver `resources/references/mcp-tools.md` para la clasificación canónica por tool.

Reglas: argumentos acotados y schemas estrictos; importar `server.mjs` nunca
arranca transporte ni exige deps extra; errores core pasan sin traducir.

---

## 4. API local — 30 rutas GET

`/api/health` · `workspace` · `tasks` · `tasks/:id` · `tasks/:id/doc` ·
`plans` · `plan-docs` · `plan-docs/:name` · `plans/:key` · `artifact-docs` ·
`artifact-docs/:kind/:name` · `artifacts` · `artifacts/:kind/:id` ·
`journal/operations` · `journal/operations/:id` · `captures` · `memory` ·
`goals` · `metrics` · `reports` · `reports/:name` · `sessions` · `sessions/:id` ·
`approvals` · `approvals/:id` · `catalog` · `catalog/:kind/:id` · `verify` ·
`vantadb` · `workflow`

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
- El bloque `constraints` del contrato canónico declara estos gates de runtime
  que las aristas no pueden expresar — `terminalDispositions`
  (`discarded`/`cancelled` → `ABANDON`) y `methodologyRevalidatedTargets`
  (`ACT`, `ACCEPT`, `CLOSE`) — y `transition.mjs` los pinea: divergencia entre
  política y runtime produce `POLICY_INVALID`.
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
- `researchEscalation`: mitad enforceada — `revisitDesignAfterAttemptsWithoutProgress` (3 reworks `VERIFY→ACT` sin visita a `RESEARCH` bloquea `→ACT`); `investigateAfterSimilarFailures` (2 fallos causalmente similares → investigar) es declarada y NO mecanizada — la similitud causal es obligación del agente (`causalGrouping: explicitly-recorded-hypothesis-not-inferred-from-counts`), ver `rules/research-escalation.md`.

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

`resources/` — 44 skills · 22 rules · 18 commands · 15 agents · 24 references ·
11 prompts · 5 profiles · 1 mcp = **140 entradas** + 32 aliases. `manifest.json`
es el catálogo con snapshots SHA (`catalog check` verifica drift; byte-determinista,
sin `generatedAt`); instalación via `init`/`update`, versionado
opt-in por categoría. Las claves de perfil requeridas son `skills`/`rules`/
`references`; `mcps` es opcional (gating de descriptores MCP por perfil —
`core` declara `mcp/scopegrain`, que suplementa todo packet).

## 10. Estado y rutas

| Clave | Default | Contenido |
|---|---|---|
| `state` | `.scopegrain/state/` | journal, sessions, workspace, verify-commands, record-ownership, init-session, `cache/structure-index.json`, `cache/catalog-fingerprint.json` (cache verify-then-pin del fingerprint del catálogo; el re-hash por recurso sigue enforceado al servir) |
| `plans` | `.scopegrain/plans/` | planes + `specs/` |
| `tasks` | `.scopegrain/tasks/` | records de tarea |
| `reports` | `.scopegrain/reports/` | reports + `reviews/` (fijo) |
| `research` | `.scopegrain/research/` | research records |
| `decisions` | `.scopegrain/decisions/` | `approvals/` |
| `memory` | `.scopegrain/memory/` | worklogs JSONL, `archive/`, `captures/`, goals |
| config dir | `.scopegrain/` | config.json, instructions.md, discovery.json, catalog.json, resources instalados, policy, context.md |

Legacy `.tasksystem/` sigue siendo honrado como ruta de estado alternativa.

## 11. Deuda y gaps conocidos (auditoría 2026-11-20, actualizada 2026-11-22)

1. **Discovery / Índice estructural**: resuelto en lo accionable — `structure scan|status|show|refresh` implementado (2026-11-21..22); `context` se mantiene estrictamente read-only reportando `refreshPolicy: "explicit"`. Siguen fuera del core por diseño: AST real/símbolos (delegado al host), Deno/Makefile/Docker/devcontainer y contenido de workflows CI.
2. ~~**Research agentic legacy**~~: resuelto (2026-11-22) — `resources/commands/investigate.md` formaliza las 6 fases de investigación estructurada, los 5 workflows legacy en `provenance/legacy-inventory.json` mapean a sus comandos portables canónicos (`manifest.json` v`0.1.1`), y `examples/preset-yagni.json` provee el equivalente agnóstico de host al modo `ponytail`.
3. ~~**`diffInvestigation`**~~: resuelto — expuesta como `investigate --diff` (2026-11-21) y embebida en el warning de fingerprint de `doctor`.
4. ~~**Doctor**~~: resuelto (2026-11-22) — ~35 checks: 27 familias con nombre + 7 `paths.*` siempre activos, incluyendo `mcp-deps`, `viewer-build`, `user-artifacts`, `user-config`, `stale-locks`, `host-fragments`, `host-merge-targets` (merge targets machine-local: `.mcp.json`, `.codex/config.toml`, `opencode.jsonc`, `.devin/config.json`), `host-cli` y `docs-cli-drift`; más las condicionales `journal-internals` y `upgrade`.
5. **Guards cuantitativas legacy**: resuelto parcialmente — `researchEscalation` enforceado 2026-11-21 (3 reworks `VERIFY→ACT` sin visita a `RESEARCH` bloquean `→ACT`). Siguen sin: budgets de iteración/duración, WIP, y la mitad "similar failures" de la escalada (requeriría hipótesis como campo de record).
6. ~~**Tests**~~: resuelto (2026-11-22) — añadido `bootstrappedMiniCtx`, scripts `test:smoke` y `test:fast` (`--test-concurrency=2`), migración de suites unitarias y `methodology-fixtures.mjs`, y `assertOwnedStoreContract` parametrizado sin eliminar cobertura adversarial.
7. **Init y config global**: resuelto (2026-11-22) — soporte de configuración global de usuario (`~/.config/scopegrain/config.json`, `config path|show|set`) solo para defaults de onboarding con precedencia absoluta del workspace; las subestructuras internas del store siguen fijas por diseño.
8. ~~**Rehidratación de contexto y VantaDB L3**~~: resuelto (2026-11-21..22) — `context` inyecta `memory_recall` L1, `session resume` + MCP inyectan `memory_context` por `recordId`, y `vantadb sync-persona` proyecta capturas `preference`/`decision` probadas a `l3/sg-persona-*`.
9. ~~**Persistencia de olas de plan y visor**~~: resuelto (2026-11-22) — `plan run --apply` persiste checkpoints atómicos en `<state>/plan-runs/<key>.json`, expuestos en `/api/plans/:key` y `PlansView`; `/api/sessions/:id` y `SessionsView` exponen `resumeContext`.
