# Limitaciones conocidas (registro consolidado)

> Registro de los residuales **declarados** del harness: lo que el
> sistema no garantiza a sabiendas. Naturaleza de cada entrada:
> `diseño` (invariante o decisión deliberada), `declarado` (límite
> documentado honestamente en el contrato) o `deuda` (inconsistencia
> conocida pendiente de resolución). Los defectos corregibles
> catalogados en la auditoría (P0/P1) no se repiten aquí — esto cubre
> lo residual, no los bugs.

| # | Limitación | Naturaleza | Referencia |
|---|---|---|---|
| 1 | **El `task gate` cubre sólo herramientas edit-class** (`Edit/Write/MultiEdit/NotebookEdit` → acción abstracta `edit`); Bash y el resto de herramientas nativas quedan fuera del gate | `declarado` (con deuda: la cobertura de Bash es el hueco P1 latente de la auditoría) | `src/hosts/gate-proposal.mjs` (matcher, `actionMapping`), `docs/security.md` («Markdown no es enforcement») |
| 2 | **`VERIFY→STALL→PLAN→ACT` no acumula rework.** `FORWARD_SOURCES = {STALL, PLAN, RESEARCH}`: entrar a `ACT` desde esos estados se cuenta como progreso hacia delante o escape sancionado de investigación, nunca como rework — decisión semántica deliberada del contador de escalación | `diseño` | `src/core/methodology.mjs:19` y comentario de política `~:213-227` |
| 3 | **La evidencia es attestada, no ejecutada.** Un check `pass` registrado no prueba ejecución; `classificationBasis:'operator-attestation'`, `authenticatesEvidence:false`. La confianza la aporta el proceso humano | `declarado` | `src/core/methodology.mjs:178-179`, `docs/security.md` («Scope y evidencia declarados») |
| 4 | **`authorContext`/`reviewerContext` son declaraciones, no identidades autenticadas.** No hay autenticación criptográfica de quién escribió o revisó | `declarado` | `docs/security.md` («Attestations, no identidad»), `src/core/methodology.mjs:179` |
| 5 | **`writeHostRoots:false` es invariante de seguridad deliberada**: el estado vive project-local; el harness no escribe en los roots de los hosts | `diseño` | `policy/native-adapters.json:5`, `src/hosts/native.mjs:910`, auditoría §1 («decisión de diseño — documentar, no arreglar») |
| 6 | **`session resume` restaura estado operativo (contador `used`, CAS, bindings), no la conversación del agente.** El naming es engañoso: no hay replay de contexto conversacional | `declarado` | `src/core/sessions.mjs` (store de sesiones owned), auditoría §3 |
| 7 | **`interceptsNativeTools:false`**: el harness no intercepta herramientas nativas del host; los gates son disciplina de registro consultable (`checkAction`), no enforcement de runtime | `declarado` | `policy/operation-limits.json:12`, `src/core/methodology.mjs:179`, `src/hosts/gate-proposal.mjs:96` |
| 8 | **Ventana TOCTOU residual**: la validación se repite justo antes de escribir, pero un proceso local con escritura puede intercalarse entre la comprobación y la escritura (enlaces, ficheros, mkdir post-symlink-check) | `declarado` | `docs/architecture.md` (límites TOCTOU ~:400-415), `docs/security.md` («Contención vs escritura in-situ»), `src/api/queries.mjs:1174` |
| 9 | **`scopegrain_context` puede escribir caché bajo `readOnlyHint`**: `structureDebounceMs` refresca un registro en `<state>/cache` (escritura derivada pequeña) aunque la tool se anota `readOnlyHint:true` — declarado en la propia descripción de la tool | `declarado` | `src/mcp/server.mjs:213-219` (descripción `structureDebounceMs`, anotación `READ_BACKEND`) |
| 10 | **Mutaciones `dist` sin `--apply` ni vista previa**: `bundle-mount`/`unmount`, `extension-register`/`activate`/`deactivate`/`remove`, `preset-register`/`remove`, `helper install`, `report save`, `task doc`/`activate` mutan directamente (journaled, pero sin vista previa) — asimetría sistémica frente a `bundle-install` | `deuda` (registrada como P1-12 en auditoría) | `docs/distribution.md` (tabla de verbos), auditoría §2 |
| 11 | **Registros/journal sin firma: rollback/fabricación integral indetectables** (truncation de cola, reescritura de `head.json`, intents fabricados). La integridad actual es procedencia interna | `declarado` → **resolución en diseño**: [records-integrity-design.md](records-integrity-design.md) | auditoría §3, `src/core/journal.mjs` (sin firma; `head.json` sin `lastHash`) |
| 12 | **Los tokens son declarados, no medidos**: `tokens` por evento y `tokenLimit` son attestations del llamador (`tokenMeasures:self-reported-unverified`); el harness no observa el consumo real del host | `declarado` | `docs/security.md` («Tokens declarados, no medidos») |
| 13 | **El CAS del journal es cooperativo, no aislamiento OS**: escritores que no pasan por el journal pueden intercalarse en la ventana verificación→rename; los locks no detienen a procesos ajenos | `declarado` | `docs/journal-recovery.md` (sección CAS), `src/core/journal.mjs:1201-1207` |
| 14 | **`memory_recall` con scope explícito sale del aislamiento por proyecto** (`agent`/`team` son pools machine-global): los hits pueden incluir memorias de OTROS proyectos — marcado como `untrusted` en la tool | `declarado` | `src/mcp/server.mjs:534-560` (descripción con WARNING explícito), auditoría P1-17 |
| 15 | **No existe evaluación de producto sobre mejora de outputs de agentes.** Las verificaciones actuales cubren mecanismos internos del harness; no miden calidad de outputs, productividad, corrección ni resultados de usuario final | `declarado` | `README.es.md`/`README.md` («Verificación»), `docs/verification.md` |

## Notas de mantenimiento

- Entrada 11 queda **cubierta por decisión de diseño** una vez
  implementado `records-integrity-design.md`; hasta entonces sigue
  abierta.
- Nada aquí es un bug: son los límites que el contrato declara
  (`docs/security.md` §«Lo que el código NO garantiza» es la fuente
  canónica de la clase `declarado`). Cualquier cambio de naturaleza
  (de `declarado` a `diseño`, o cierre) se registra aquí con la
  referencia que lo resuelve.
