---
name: review-deep
description: Usar cuando un cambio de alto riesgo necesita una revisión causal y de límites más profunda que una comprobación rápida
---
# Bucle de revisión profunda

Revisión profunda iterativa que recorre un codebase **módulo por módulo** en
lugar de producir un informe único. Para cada módulo realiza mapeo
estructural → análisis mecánico → revisión profunda de código → investigación
externa → comparación contra alternativas → triaje → informe de módulo, y
luego cede para que el bucle continúe con el siguiente módulo. Complementa a
`unified-review`: aquella actúa de puerta para un cambio; esta audita una
superficie a lo largo de muchas iteraciones.

## Cuándo usar

- Un cambio de alto riesgo necesita una revisión causal y de límites más
  profunda que una comprobación rápida
- Una auditoría profunda periódica de toda la superficie del proyecto,
  módulo por módulo
- Después de que `unified-review` marque un módulo que merece profundidad dedicada
- Antes de un release, cuando "la puerta pasó" no es garantía suficiente

## Arquitectura del bucle

```
Invoke the loop once per module: MODULE=<name>, DEPTH=full|quick
  │
  ├─ PHASE 0: Load the skills that fit the module type
  │
  ├─ PHASE 0b: Tool focus per phase (best-effort)
  │   ├─ F1–F3 (analysis): structural index/graph tools + read + shell
  │   ├─ F4–F5 (research): web search/fetch tools + read
  │   ├─ F6 (triage):      edit/write on the backlog + read
  │   └─ Explicit transitions: never jump F3→F6 without F4–F5
  │
  ├─ PHASE 1: Structural mapping
  │   └─ Map: callers, callees, API surface, tests, file sizes, complexity
  │
  ├─ PHASE 2: Static analysis (mechanical tools per language)
  │   └─ Record: warnings, errors, issues
  │
  ├─ 🟢 QUALITY GATE 1 (between F3→F4)
  │   ├─ Every finding has file:line?
  │   ├─ Every finding has type + severity?
  │   └─ If not → back to F3. Quality in the loop, not at the end.
  │
  ├─ PHASE 3: Deep code review (7 sub-axes, below)
  │
  ├─ PHASE 4: External research per non-trivial finding
  │   └─ Record: source URL, recommended solution, alternatives, decision
  │
  ├─ PHASE 5: Comparison vs relevant alternatives/competitors
  │   └─ Record: gap / advantage / parity per finding
  │
  ├─ 🟢 QUALITY GATE 2 (between F5→F6)
  │   ├─ Every Medium+ finding has ≥1 verified reference URL?
  │   ├─ URLs are real, not placeholders?
  │   └─ If not → back to F4. Quality over quantity: discard false positives.
  │
  ├─ PHASE 6: Triage → backlog
  │   └─ fix-now (<30 min) | backlog (tracked ID) | discard (with reason)
  │
  └─ PHASE 7: Module report + yield
      ├─ More modules → yield for the next invocation
      └─ Last module → consolidated report + complete
```

`DEPTH=quick` ejecuta solo F0–F3 + F6–F7 (sin investigación externa, sin
comparación con competidores); los hallazgos Medium+ van entonces al backlog
marcados `needs-research` en lugar de llevar URLs.

## Orden de iteración

Ordena los módulos por potencial de impacto descendente: el grafo de
dependencias propio del proyecto decide. Una forma genérica:

```
Wave 0 — Core critical      (entry points, engine, durability/persistence)
Wave 1 — Domain internals   (indexing, algorithms, data structures)
Wave 2 — Governance         (admission, consistency, conflict handling)
Wave 3 — SDKs and bindings  (foreign-language surfaces)
Wave 4 — Infrastructure     (server, integrations, packaging)
Wave 5 — Adapters/plugins   (parallelizable — usually independent)
Wave 6 — Utilities & misc
```

Las olas se ejecutan secuencialmente (dependencias naturales); los módulos
*dentro* de una ola pueden revisarse en paralelo cuando son independientes.
Con >30 módulos, deriva el orden de un DAG de dependencias en lugar de la
intuición.

### Preservación de contexto para módulos grandes

Las salidas de herramientas dominan el costo de contexto. Estrategia por
tamaño de módulo:

| Tamaño | Estrategia |
|------|----------|
| <500 líneas | Bucle normal, una iteración |
| 500–2000 | Compacta hallazgos intermedios a un archivo scratch bajo el workspace de revisión |
| >2000 | Divide en submódulos, ejecuta un sub-bucle por parte |
| >5000 | Delega cada submódulo a una sub-revisión independiente en paralelo |

Mantén los hallazgos intermedios en un archivo scratch por módulo
(p. ej. `<reviews>/review-deep/<module>-findings.json`) para que la pérdida
de contexto entre iteraciones nunca pierda evidencia.

### Tarjeta de puntuación por iteración

Cada iteración de módulo registra una tarjeta JSON para poder comparar
ejecuciones a lo largo del tiempo y detectar regresiones (hallazgos nuevos
vs previamente resueltos):

```json
{
  "module": "<name>",
  "wave": 0,
  "duration": "12m34s",
  "findings": {"critical": 2, "high": 5, "medium": 3, "low": 8, "info": 12},
  "fixed_now": 3,
  "to_backlog": 4,
  "discarded": 3,
  "research_urls": 7
}
```

## PHASE 0 — Skills a cargar, por tipo de módulo

| Tipo de módulo | Cargar |
|---|---|
| Implementación core | `code-review-and-quality`, `doubt-driven-development`, `code-simplification`, `security-and-hardening`, `performance-optimization`, `api-and-interface-design`, `source-driven-development` |
| SDK en lenguaje externo | `code-review-and-quality`, `security-and-hardening`, `source-driven-development` |
| Adapters/plugins | `code-review-and-quality`, `doubt-driven-development` |
| Superficie crítica de rendimiento | `performance-optimization`, `code-review-and-quality` |
| Cualquiera | seguimiento de progreso/sesión según convención del proyecto; `brainstorming` si un hallazgo necesita diseño; `writing-plans` si necesita un plan; `spec-driven-development` si es una funcionalidad nueva |

Carga solo lo que el módulo necesita: el punto es profundidad por iteración,
no una lista fija de skills.

## PHASE 1 — Mapeo estructural

Mapea el módulo antes de leerlo:

- **Superficie de API:** funciones/tipos exportados, puntos de entrada.
- **Llamantes:** qué módulos usan este.
- **Llamados:** de qué depende.
- **Cobertura de tests:** qué tests lo ejercitan.
- **Tamaños de archivo:** archivos >500 líneas → candidatos a división.
- **Complejidad:** módulos con demasiadas responsabilidades.

Usa el índice estructural / grafo de conocimiento del proyecto si existe;
en caso contrario derívalo de imports, manifiestos de paquetes y grep.
Registra el mapa en el archivo scratch del módulo.

## PHASE 2 — Análisis estático

Ejecuta el toolchain propio del proyecto (preferidos los wrappers
versionados):

- **Rust:** `cargo check -p <crate>` · `cargo clippy -p <crate>
  --all-targets --all-features -- -D warnings` · `cargo fmt --check` ·
  `cargo machete` · `cargo outdated` · `cargo audit` · `cargo deny check`
- **Python:** `pytest`, `mypy`, `ruff check` (entorno del proyecto)
- **TypeScript:** `npx tsc --noEmit` · `eslint` · `vitest run`
- **Web:** `npm ci --ignore-scripts` → `lint` → `tsc --noEmit` → `build`
- **Adapters:** la comprobación de compilación mínima para su ecosistema

Bajo el modelo de permisos del host, propón los comandos exactos cuando la
ejecución esté reservada al dueño; registra la salida honestamente, incluidas
las omisiones.

## PHASE 3 — Revisión profunda de código

### 3a. Escaneo de patrones

Cuenta y justifica cada ocurrencia en el módulo:

```
expect( unwrap( unsafe { todo!( unimplemented!( unreachable!(
#[allow(  as-casts  transmute  clone()  .lock()  .block()
catch {} / empty except  let _ = / ignored results
```

Cada `expect`/`unwrap` queda justificado o marcado como reemplazable; cada
`unsafe` requiere una justificación de seguridad completa; cada supresión
(`#[allow]`, `eslint-disable`, `# noqa`) necesita una razón declarada.

### 3b. Manejo de errores

- [ ] Todos los retornos `Result`/error manejados: sin `ok()`/tragado silencioso
- [ ] Mensajes de `expect()` descriptivos y que declaran la precondición
- [ ] `unwrap()` probadamente infalible
- [ ] Nada tragado vía `let _ =` / catch vacío
- [ ] Errores propagados (`?`/errores tipados) o envueltos con contexto
- [ ] Mensajes de error accionables

### 3c. Rendimiento

- [ ] Asignaciones evitables en rutas calientes
- [ ] Contención de locks (locking global vs granular)
- [ ] O(n²) donde O(n log n) es posible
- [ ] Formato de serialización eficiente para el caso de uso
- [ ] Operaciones por lote vs una por una
- [ ] Política de durabilidad/sync razonable en I/O

### 3d. Concurrencia

- [ ] Orden de locks consistente: sin potencial de deadlock
- [ ] Tipo de lock acorde al patrón de acceso (lectura pesada vs escritura)
- [ ] Ciclos de referencias en propiedad compartida
- [ ] Ordenamientos atómicos correctos (Acquire/Release/SeqCst)
- [ ] Garantías de threading Send/Sync o equivalentes se mantienen

### 3e. Seguridad

- [ ] Validación de entrada en cada límite público
- [ ] Path traversal en operaciones de archivos
- [ ] Secretos vía env/config, nunca hardcodeados
- [ ] Primitivas cripto actuales y correctamente compuestas
- [ ] Invariantes de código unsafe documentados

### 3f. Arquitectura

- [ ] Responsabilidad única
- [ ] Sin dependencias circulares
- [ ] Feature gating correcto: sin fugas entre features
- [ ] API pública consciente de semver
- [ ] Archivos >500 líneas marcados como candidatos a división

### 3g. Testing

- [ ] Tests unitarios por función pública
- [ ] Casos límite cubiertos (vacío, null, fronteras)
- [ ] Tests de integración para flujos completos
- [ ] Tests basados en propiedades donde aplique
- [ ] Benchmarks para rutas calientes

## PHASE 4 — Investigación externa por hallazgo

Para cada hallazgo no trivial (nunca typos/formato: solo hallazgos que
necesitan una decisión técnica), investiga con las herramientas de
búsqueda/fetch web que el host provea:

- Busca el problema específico (p. ej. "rust RwLock poisoned recover best
  practice", "HNSW ef_search auto-tuning").
- Obtén fuentes autorizadas: docs oficiales, RFCs, issue trackers,
  implementaciones de referencia.
- Registra por hallazgo: **URL de fuente · solución recomendada (citada) ·
  alternativas consideradas · decisión final y por qué.**

Si no existe tooling de investigación, marca los hallazgos Medium+ como
`needs-research` y continúa: nunca fabriques fuentes.

## PHASE 5 — Comparación vs alternativas

Para cada módulo, compara contra las alternativas relevantes del dominio
(productos competidores, bibliotecas estándar, implementaciones
establecidas):

- ¿Las alternativas tienen esta capacidad? → **brecha de funcionalidad**
- ¿Lo hacen mejor? → **oportunidad de mejora**
- ¿Les falta? → **ventaja: mantenerla**
- ¿Existen benchmarks públicos? → registra la comparación

Registra por hallazgo: brecha / ventaja / paridad, con evidencia.

## PHASE 6 — Puerta de triaje

Cada hallazgo pasa esta puerta antes de tocar el backlog:

```
Finding: [concrete issue]
Location: path/to/file:42
Type: LOGIC|PATTERN|ARCH|CODE|ERROR|MISSING|FEATURE|ALGO|SECURITY|PERF
        (module-local triage labels — when a finding enters the shared
        registry it folds into `unified-review`'s canonical categories
        and severity scale so cross-module dedupe works)

[ ] 1. Real issue? (reproducible, not a false positive)
[ ] 2. Honest severity? (not inflated)
      critical — data loss, security, broken build
      high     — broken feature, major perf regression
      medium   — degraded UX, CI warning, missing docs
      low      — code smell, minor improvement
      info     — observation, suggestion
[ ] 3. Real user impact? (not theoretical)
[ ] 4. Effort estimate? (XS/S/M/L/XL)
[ ] 5. Known workaround?
[ ] 6. Relation to other findings? (duplicate, shared root cause)
[ ] 7. Needs a feature flag or migration?

Output: ✅ BACKLOG | 🟢 FIX NOW | ❌ DISCARD
```

- **🟢 FIX NOW**: esfuerzo XS–S, <30 min, mismo módulo → arregla
  inmediatamente (con un test de regresión según `test-driven-development`).
- **✅ BACKLOG**: añade al backlog/registro declarado del proyecto con un ID
  de hallazgo único en el esquema canónico del proyecto; registra
  `Origin: <module/report>` en la fila.
- **❌ DISCARD**: registra la razón; no añadas.

## PHASE 7 — Informe de módulo + cesión (contrato de salida)

El entregable por módulo: el mapa estructural, la lista de hallazgos con
`file:line` + tipo + severidad, el registro de investigación (URL, solución
citada, decisión) para cada hallazgo no trivial, el resultado de triaje por
hallazgo, la tarjeta JSON y este informe:

```markdown
## Module: <name> — Report

**Analyzed:** files N, lines N, public API N, tests N
**Findings:** critical N · high N · medium N · low N · info N
**Fixed immediately:** N   **To backlog:** <IDs>   **Discarded:** N
**Comparison gaps:** N     **Research URLs:** N
**Next module:** <name>
```

Cede con una nota de progreso para el driver del bucle; en el último módulo
emite el informe consolidado y completa.

## Racionalizaciones comunes

|| Racionalización | Realidad |
|||---|---|
|| "La puerta pasó, así que la profundidad es innecesaria" | Una puerta muestrea; el bucle agota una superficie. Responden preguntas distintas: véase la división del trabajo en `unified-review`. |
|| "Ojearé la investigación: ya conozco el arreglo" | Los arreglos no verificados de memoria son como se propagan patrones plausibles pero erróneos. Los hallazgos Medium+ necesitan una fuente real o una marca `needs-research`. |
|| "Los hallazgos sin file:line igualmente son útiles" | No son accionables y no pueden deduplicarse. La Quality Gate 1 existe para devolverlos al análisis. |
|| "Triaje rápido: todo al backlog" | Un backlog sin triar es un vertedero. Descarta con razón, arregla los pequeños ahora, rastrea solo lo que sobrevive a la puerta. |
|| "Depth=quick es igual de bueno para este módulo" | Solo cuando el contexto externo genuinamente no puede cambiar la decisión: nombra por qué en el triaje. |

## Señales de alerta

- Hallazgos en Quality Gate 1 sin `file:line`, tipo o severidad.
- Un hallazgo Medium+ en Quality Gate 2 sin fuente verificada, o con una URL
  de marcador/inventada. Nunca fabriques referencias.
- `FIX NOW` aplicado a un cambio sin caso de regresión según
  `test-driven-development`.
- Triaje que infla la severidad para parecer exhaustivo, o la desinfla para
  encoger el informe.
- Comparar solo contra alternativas que confirman el diseño actual.
- Omitir las fases de investigación y comparación por hallazgos "obvios":
  exactamente ahí se esconde el sesgo de familiaridad.
- El bucle ejecutado dentro del contexto de implementación para una unidad
  con riesgo nombrado, presentado como independiente: eso requiere
  `independent-review` en un contexto genuinamente distinto, o una exención
  declarada.

## Límites

- Inspecciona el diff relevante completo, los contratos públicos, los
  llamantes y las rutas de fallo. Traza datos, autoridad, propiedad,
  persistencia y concurrencia donde sea relevante; comprueba estados
  adversarios e interrumpidos, no solo el éxito ordinario.
- Compara cada afirmación de aceptación con la evidencia de verificación
  real: reporta primero los hallazgos con evidencia y lista las superficies
  no ejercitadas.
- No fabriques puntuaciones de calidad, URLs ni comparaciones. No confundas
  tu propio contexto de implementación con un revisor independiente: para
  unidades con riesgo nombrado, la revisión profunda se ejecuta bajo
  `independent-review` en un contexto nuevo o lleva una degradación
  declarada más exención del dueño.
- Los hallazgos son atestaciones: no autorizan nada por sí mismos.
