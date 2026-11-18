# Procedencia y atestacion de recursos

Registro de atestacion por ID para el catalogo canonico
(`resources/manifest.json`). Complementa y detalla la auditoria de
procedencia de 2026-11-17 (`.tasksystem/research/2026-11-17-provenance-audit.md`)
con una inspeccion cuerpo a cuerpo de los 65 recursos que reutilizan un
identificador del archivo heredado.

Este documento registra evidencia verificable. No otorga licencias ni
sustituye la atestacion de autoria del propietario. Lo que no se pudo
verificar se declara explicitamente como desconocido.

## 1. Alcance y fuentes de evidencia

| Fuente | Contenido |
| --- | --- |
| `resources/manifest.json` | 130 entradas + 32 aliases; catalogo canonico activo |
| `provenance/legacy-inventory.json` | 268 entradas heredadas con sha256, indicadores y bloqueos; cuerpos no incluidos |
| `provenance/legacy-classification.json` | Triage por identificador de las 197 skills heredadas |
| `provenance/legacy-source-manifest.json` | Catalogo de primera generacion (retirado en `5021a5c`) |
| `provenance/retired-resources/` | 17 cuerpos de primera generacion, escritos en este repositorio |
| Historia git | Sin commit de importacion masiva; cuerpos introducidos en `973318d`, migrados a `resources/` en `5021a5c` |
| `docs/migration.md`, `docs/component-migration.md` | Registro declarado de procedencia y destino de cada componente |

**Restriccion respetada:** los cuerpos heredados en `legacy/opencode/` no
se leyeron ni copiaron (archivo bloqueado por politica y `.gitignore`).
Toda comparacion usa hashes congelados y metadatos del inventario, no un
diff semantico contra los originales.

## 2. Metodologia de clasificacion

Cada recurso que reutiliza un ID heredado se clasifico como:

- **(a) Copia literal:** bytes identicos o casi identicos al original.
- **(b) Adaptado/derivado:** cuerpo que conserva estructura o redaccion
  del original con cambios parciales (incluye parafasis).
- **(c) Reescrito/nuevo:** cuerpo de nueva autoria; solo se conserva el
  identificador y la intencion del recurso.

Senales aplicadas, en orden de fuerza:

1. **Hash:** sha256 del cuerpo actual contra los 267 hashes congelados del
   inventario heredado. Resultado: 0 coincidencias en los 65 archivos.
2. **Ratio de tamano:** bytes del cuerpo nuevo frente a bytes del original
   inventariado. Una parafasis conserva magnitud; una reescritura a
   procedimiento compacto no.
3. **Terminos de dominio heredado:** busqueda de `vanta`, `opencode`,
   `metasearch`, `argus`, `ponytail`, `ness-e`, rutas personales y
   nombres de host en los cuerpos nuevos. Resultado: 0 coincidencias en
   los 65 archivos (en esa inspeccion solo aparecia `tasksystem`, como
   autorreferencia legitima del producto, en `backlog-format` y
   `task-system`; esos terminos se renombraron a `scopegrain` con el
   cambio de nombre del producto).
4. **Vocabulario de la arquitectura nueva:** los cuerpos describen
   conceptos posteriores al harness heredado (clasificacion Organic/SDD,
   `scenarioRefs`, revisiones esperadas, rutas del harness configuradas,
   aprobaciones vinculadas a contenido). El archivo heredado no podia
   contener estos conceptos.
5. **Historia git:** todos los cuerpos entran por commits del propio
   repositorio (`973318d` catalogo de primera generacion, `5021a5c`
   migracion a `resources/`), sin importacion de archivos ajenos.
6. **Uniformidad de voz:** los 65 cuerpos comparten un estilo imperativo
   compacto consistente con una unica pasada de reautoria, no con 65
   originales heterogeneos de 660 a 52.877 bytes.
7. **Significado declarado:** el inventario congelado registra cada
   reemplazo como `fresh-portable-procedure-not-verbatim-equivalence`.
8. **Comparacion con cuerpos de primera generacion legibles:** el diff de
   `provenance/retired-resources/references/task-system.md` contra
   `resources/references/task-system.md` muestra reescritura del propio
   proyecto (vocabulario de instalacion, snapshots y recuperacion nuevo),
   no adaptacion del original heredado.

**Limite honesto:** ninguna senal mecanica excluye una parafasis de
contorno (misma secuencia de ideas con otras palabras). Sin leer los
cuerpos heredados — o sin atestacion de autoria del propietario — el
residuo (b) a nivel de parafasis no puede cerrarse. La columna *residuo*
gradua cuan concebible es esa parafasis dado el ratio de tamano; no mide
copia detectada, porque no se detecto ninguna.

## 3. Tabla de atestacion: 65 recursos con ID heredado

Leyenda de residuo: **bajo** = ratio nuevo/original <15%;
**bajo-medio** = 15-40%; **medio** = >40% u original pequeno comparable.
Disposicion propuesta en todos los casos: **attest-as-ours condicionado**
a la atestacion de autoria del propietario (ver §6).

### 3.1 Skills (30)

| ID | Bytes nuevo/legacy | Indicadores del original | Clasif. | Residuo | Disposicion |
| --- | --- | --- | --- | --- | --- |
| api-and-interface-design | 565 / 10307 | — | (c) | bajo | attest-as-ours* |
| api-design-principles | 538 / 13722 | — | (c) | bajo | attest-as-ours* |
| brainstorming | 553 / 2509 | — | (c) | bajo-medio | attest-as-ours* |
| ci-cd-and-automation | 571 / 11324 | machine-path | (c) | bajo | attest-as-ours* |
| code-review-and-quality | 650 / 23309 | project-domain, opencode-path | (c) | bajo | attest-as-ours* |
| code-simplification | 602 / 15097 | machine-path, external-link | (c) | bajo | attest-as-ours* |
| constraint-driven-development | 615 / 20880 | — | (c) | bajo | attest-as-ours* |
| context-engineering | 604 / 11070 | — | (c) | bajo | attest-as-ours* |
| debugging-and-error-recovery | 663 / 1598 | global-dependency | (c) | medio | attest-as-ours* |
| deprecation-and-migration | 603 / 14616 | project-domain, opencode-path | (c) | bajo | attest-as-ours* |
| discernment-nudge | 560 / 10592 | — | (c) | bajo | attest-as-ours* |
| documentation-and-adrs | 647 / 9791 | — | (c) | bajo | attest-as-ours* |
| doubt-driven-development | 568 / 16521 | — | (c) | bajo | attest-as-ours* |
| git-workflow-and-versioning | 630 / 14000 | — | (c) | bajo | attest-as-ours* |
| incremental-implementation | 603 / 11965 | project-domain, opencode-path | (c) | bajo | attest-as-ours* |
| observability-and-instrumentation | 571 / 11053 | — | (c) | bajo | attest-as-ours* |
| performance-optimization | 591 / 11593 | — | (c) | bajo | attest-as-ours* |
| plan-design-review | 576 / 1256 | machine-path, external-link | (c) | medio | attest-as-ours* |
| planning-and-task-breakdown | 1244 / 14007 | project-domain, opencode-path | (c) | bajo | attest-as-ours* |
| release-notes-one-pager | 562 / 3750 | — | (c) | bajo-medio | attest-as-ours* |
| review-deep | 602 / 16879 | project-domain, opencode-path, execution-api | (c) | bajo | attest-as-ours* |
| security-and-hardening | 643 / 18878 | machine-path, execution-api, external-link | (c) | bajo | attest-as-ours* |
| shipping-and-launch | 632 / 10449 | project-domain, opencode-path | (c) | bajo | attest-as-ours* |
| source-driven-development | 655 / 11993 | project-domain, machine-path, external-link | (c) | bajo | attest-as-ours* |
| spec-driven-development | 1310 / 9418 | opencode-path | (c) | bajo | attest-as-ours* |
| systematic-debugging | 622 / 10994 | — | (c) | bajo | attest-as-ours* |
| test-driven-development | 613 / 19322 | project-domain, opencode-path | (c) | bajo | attest-as-ours* |
| unified-review | 632 / 50444 | project-domain, opencode-path, machine-path, native-agent-format, external-link | (c) | bajo | attest-as-ours* |
| web-research | 631 / 3685 | — | (c) | bajo-medio | attest-as-ours* |
| writing-plans | 932 / 3272 | — | (c) | bajo-medio | attest-as-ours* |

### 3.2 Reglas (13)

| ID | Bytes nuevo/legacy | Indicadores del original | Clasif. | Residuo | Disposicion |
| --- | --- | --- | --- | --- | --- |
| api-contract | 476 / 7266 | project-domain | (c) | bajo | attest-as-ours* |
| concurrency-async | 473 / 6336 | project-domain | (c) | bajo | attest-as-ours* |
| core-engine | 381 / 3792 | project-domain | (c) | bajo | attest-as-ours* |
| durability | 419 / 2246 | project-domain | (c) | bajo-medio | attest-as-ours* |
| frontend-web | 397 / 2337+5128 | project-domain, opencode-path | (c) | bajo-medio | attest-as-ours* |
| indexes | 382 / 1386 | project-domain | (c) | bajo-medio | attest-as-ours* |
| js-ecosystem | 353 / 3113 | project-domain | (c) | bajo | attest-as-ours* |
| mcp-integration | 385 / 1664 | project-domain | (c) | bajo-medio | attest-as-ours* |
| memory-budget | 446 / 4890 | — | (c) | bajo | attest-as-ours* |
| python-bindings | 375 / 1609 | project-domain | (c) | bajo-medio | attest-as-ours* |
| query-dsl | 375 / 2529 | — | (c) | bajo-medio | attest-as-ours* |
| release-ci | 399 / 4569 | project-domain, opencode-path | (c) | bajo | attest-as-ours* |
| server-mcp | 407 / 2405 | project-domain, machine-path | (c) | bajo-medio | attest-as-ours* |

Nota: el ID `frontend-web` existia en el archivo heredado como regla y
como referencia (dos entradas); ambos cuerpos nuevos se clasifican (c).

### 3.3 Referencias (21)

| ID | Bytes nuevo/legacy | Indicadores del original | Clasif. | Residuo | Disposicion |
| --- | --- | --- | --- | --- | --- |
| accessibility-checklist | 354 / 5206 | — | (c) | bajo | attest-as-ours* |
| architecture | 386 / 1314 | project-domain, opencode-path | (c) | bajo-medio | attest-as-ours* |
| backlog-format | 364 / 6262 | project-domain, opencode-path | (c) | bajo | attest-as-ours* |
| build-system | 354 / 2495 | project-domain, opencode-path | (c) | bajo | attest-as-ours* |
| clean-code-clean-architecture | 436 / 52877 | project-domain, opencode-path, machine-path, external-link | (c) | bajo | attest-as-ours* |
| definition-of-done | 385 / 11763 | project-domain, opencode-path | (c) | bajo | attest-as-ours* |
| dev-tools | 367 / 5118 | project-domain, opencode-path, global-dependency | (c) | bajo | attest-as-ours* |
| frontend-web | 357 / 2337+5128 | project-domain, opencode-path | (c) | bajo-medio | attest-as-ours* |
| mcp-tools | 392 / 11910 | project-domain, opencode-path | (c) | bajo | attest-as-ours* |
| observability-checklist | 369 / 4931 | — | (c) | bajo | attest-as-ours* |
| ocr-review | 353 / 3206 | project-domain, machine-path, external-link | (c) | bajo | attest-as-ours* |
| orchestration-patterns | 393 / 18292 | project-domain, opencode-path, global-dependency | (c) | bajo | attest-as-ours* |
| performance-checklist | 367 / 7447 | machine-path, external-link | (c) | bajo | attest-as-ours* |
| python-sdk | 376 / 660 | project-domain, opencode-path | (c) | medio | attest-as-ours* + revision semantica puntual recomendada |
| research-modules | 350 / 6267 | project-domain, machine-path, external-link | (c) | bajo | attest-as-ours* |
| security-checklist | 368 / 7318 | machine-path, execution-api, external-link | (c) | bajo | attest-as-ours* |
| ship-runbook | 439 / 4056 | project-domain, opencode-path | (c) | bajo | attest-as-ours* |
| skills-engineering | 383 / 18438 | project-domain, opencode-path | (c) | bajo | attest-as-ours* |
| task-system | 1393 / 3772 | project-domain, opencode-path | (c) | medio | attest-as-ours* |
| test-suite | 366 / 1817 | project-domain, opencode-path | (c) | bajo-medio | attest-as-ours* |
| testing-patterns | 394 / 7094 | — | (c) | bajo | attest-as-ours* |

### 3.4 Perfiles (1)

| ID | Bytes nuevo/legacy | Indicadores del original | Clasif. | Residuo | Disposicion |
| --- | --- | --- | --- | --- | --- |
| core | 551 / 214 | — | (c) | n/a — colision de ID entre kinds distintos | attest-as-ours* |

Nota: `core` heredado era un **mcp-profile** (214 B); el actual es un
**perfil de recursos** con esquema nuevo (`skills`/`rules`/`references`/
`activation`). Mismo identificador, semantica distinta.

\* `attest-as-ours*` = disposicion propuesta, condicionada a que el
propietario atestigue la autoria en este repositorio (§6, punto 2). El
auditor verifica evidencia mecanica y de inspeccion; no atestigua autoria.

## 4. Recursos sin ID heredado (65)

El resto del catalogo no reutiliza ningun identificador del archivo
heredado. Cuerpos nuevos sin vinculo de procedencia conocido:

- **Comandos (17):** `plan-work`, `implement-task`, `coordinate-plan`,
  `specify-change`, `triage-work`, `report-status`, `verify-work`,
  `review-change`, `audit-project`, `audit-harness`, `investigate`,
  `compare-options`, `assess-release`, `plan-recovery`, `simplify-code`,
  `analyze-structure`, `audit-web-performance`.
- **Agentes (15):** `lead`, `architect`, `implementer`,
  `algorithm-specialist`, `security-auditor`, `resilience-tester`,
  `performance-engineer`, `documentation`, `researcher`, `reviewer`,
  `harness-maintainer`, `requirements-analyst`, `verification-engineer`,
  `integration-engineer`, `release-engineer`.
- **Skills (12):** `outcome-driven-development`, `project-onboarding`,
  `contract-execution`, `independent-review`, `plan-coordination`,
  `session-handoff`, `select-capabilities`, `resolve-ambiguity`,
  `artifact-completeness`, `clarify-intent`, `review-feedback`,
  `organic-driven-development`.
- **Reglas (9):** `safety`, `workflow`, `evidence`, `review`,
  `human-decisions`, `resource-integrity`, `research-escalation`,
  `methodology`, `licensing-and-provenance`.
- **Referencias (3):** `quality-floor`, `graph-investigation`,
  `reference-maintenance`.
- **Prompts (4):** `task-brief`, `decision-request`, `review-request`,
  `recovery-brief`.
- **Perfiles (4):** `web`, `rust`, `python`, `database`.
- **MCP (1):** `scopegrain`.

Clasificacion: **(c) reescrito/nuevo** para los 65, con residuo
equivalente al del §3 — la misma limitacion de parafasis aplica aunque no
haya ID compartido que sugiera correspondencia directa.

## 5. Aliases (32)

Los 32 aliases del manifiesto reutilizan deliberadamente IDs heredados de
comandos, skills, reglas y referencias (`pipeline`, `spec`, `audit`,
`progreso`, `campaign-executor`, `floor-guard`, `understand-anything`,
etc.) como superficie de compatibilidad que resuelve a los comandos
canonicos nuevos. Son entradas de enrutamiento sin cuerpo propio: la
superficie de interfaz, no contenido redistribuible. No requieren
atestacion de cuerpo; si requieren decision consciente sobre mantener la
nomenclatura heredada como API publica.

## 6. Lo que debe resolverse antes de publicar el paquete

1. **Decision de licencia.** No existe `LICENSE`; `package.json` declara
   `UNLICENSED` + `private: true`. Esa postura es valida para uso
   privado/source-available y equivale hoy a "no redistribuir". Elegir
   licencia es decision del propietario; una vez elegida, aplicar
   cabeceras de licencia por archivo (`needs-license-header` aplica a
   todo el paquete, no a IDs concretos).
2. **Atestacion de autoria de los 65 IDs reutilizados.** Evidencia
   disponible: 0/267 coincidencias de hash, ratio de tamano medio ~10%,
   cero terminos de dominio heredado, vocabulario de arquitectura
   posterior al original, historia git limpia y significado declarado
   `fresh-portable-procedure-not-verbatim-equivalence`. Residuo abierto:
   derivacion a nivel de parafasis, mecanicamente no excluible. Para
   cerrarlo: (a) atestacion de autoria del propietario, o (b) revision
   semantica muestreada contra los cuerpos congelados, que exige levantar
   la restriccion de no-lectura bajo alcance controlado. Prioridad de
   muestreo: `python-sdk` (57%), `plan-design-review` (46%),
   `debugging-and-error-recovery` (41%), `task-system` (37%).
3. **Material de terceros dentro de `legacy/opencode/` nunca auditado.**
   IDs como `gsap-*`, `figma-*`, `a11y-*`, `awesome-claude-design`
   sugieren skills de terceros sin licencia registrada. No bloquea el
   paquete actual (excluido por `.gitignore`, descubrimiento y allowlist
   `files`), pero es politica permanente: ninguna pieza sale del archivo
   sin evidencia de licencia individual.
4. **Mantener la exclusion en capas.** `legacy/`, `.tasksystem/`,
   `tests/`, `scripts/`, `provenance/` y duplicados top-level deben
   seguir fuera del allowlist `files` de `package.json`.
5. **Verificacion del nombre `scopegrain` en npm** antes de cualquier
   intento de publicacion (no verificada; `private: true` lo hace
   irrelevante hasta entonces).

## 7. Veredicto

| Clasificacion | IDs | Residuo |
| --- | --- | --- |
| (a) Copia literal | 0 | — |
| (b) Adaptado/derivado | 0 detectados; parafasis no excluible mecanicamente en los 65 | abierto hasta atestacion del owner |
| (c) Reescrito/nuevo | 130 (65 con ID heredado + 65 sin el) | en los 65 con ID heredado: bajo en 46, bajo-medio en 14, medio en 4 (`python-sdk`, `plan-design-review`, `debugging-and-error-recovery`, `task-system`), n/a en `core` |

**Sin evidencia positiva de copia ni adaptacion en ninguno de los 130
recursos.** La pregunta residual — parafasis de contorno en los 65 IDs
reutilizados — es una atestacion del propietario o una revision semantica
controlada, no un hallazgo. Este documento no atestigua lo no verificado;
registra exactamente lo que la evidencia mecanica y la inspeccion de
cuerpos nuevos sostienen.
