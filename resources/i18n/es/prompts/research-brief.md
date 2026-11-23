---
name: research-brief
description: Investigación de solo lectura — contrato de digest, procedimiento de investigación de módulo/producto y la síntesis de decisiones que convierte hallazgos en tareas.
---
# Research Brief

Tres contratos en un archivo: **§A — el delegado de digest de solo
lectura** usado para aislar lectura pesada; **§B — la investigación
profunda** de un módulo o superficie de producto; **§C — la sala de
decisiones** que convierte hallazgos de investigación en decisiones del
propietario y registros ejecutables. Cargado por `investigate`
(investigación por área), `compare-options` (síntesis/sala de decisiones)
y por orquestadores que aíslan lectura pesada (`plan-execution`,
`task-brief`). La investigación es de solo lectura: sin correcciones; los
hallazgos se convierten en reportes + decisiones materializadas por el
propietario.

Los principios de formato heredan de `decision-request`: opciones
concretas + default recomendado primero, nunca preguntas abiertas sin
opciones, cada decisión registrada en trace/continuación.

---

## §A — Delegado de digest (aislamiento de investigación)

Un delegado de investigación NO implementa NADA — lee y sintetiza.
Lanzarlo para mantener la lectura pesada fuera del contexto del ejecutor.

Objetivo: un digest conciso (≤500 palabras) del material solicitado.

Formato de salida obligatorio:

```
## Digest
### Key findings
- finding 1
- finding 2
### Structure / Architecture
- relevant point
### Risks / Watch-outs
- what the implementer must know
### References (material read)
- path/to/file:32-45 (important function)
```

Reglas:
- SIN generación de código, SIN implementación, SIN modificación de
  archivos del proyecto.
- Incluir números de línea para funciones clave al leer código.
- Si el material es confuso, decirlo — no inventar.
- Preferir la capacidad estructural sobre grep/read cuando esté
  disponible.

Criterios de investigación:
- **Saturación <20%:** cuando una nueva ronda añade <20% de fuentes
  nuevas, o ninguna por encima del umbral de relevancia → STOP y
  sintetizar.
- **Ampliar:** resultados insuficientes o de baja relevancia → ampliar
  alcance/palabras clave.
- **Estrechar:** relevancia suficiente → ajustar el alcance para
  profundizar.
- **Disciplina de reintentos:** backoff determinista según la política
  declarada es correcto para un pipeline de un solo operador; reintentar
  con jitter.
- **Registrar la decisión:** anotar cada parada/ampliación/estrechamiento
  en References con el material leído.

---

## §B — Investigación profunda de {{MODULE}} (módulo tipo API)

Producir un reporte de investigación profundo y amplio evaluando
`{{MODULE}}` contra (a) las necesidades reales de sus usuarios objetivo
({{USERS}}) y (b) el estado del arte de {{COMPETITOR_CATEGORY}} — para
determinar con evidencia: **qué tiene, qué le falta, qué es mejorable y qué
es optimizable**. Cargar los valores del módulo desde el registro de
áreas de investigación del proyecto (referencia `research-modules`).

### Alcance

- Objeto: `{{MODULE}}` completo — API pública, flujos, empaquetado, tests,
  docs.
- Límite: NO auditar el núcleo más allá de los contratos que {{MODULE}}
  consume.
- Modo solo lectura: sin correcciones durante la investigación.

### 1. Usuarios objetivo y su flujo diario

Para cada {{USERS}}: cómo descubren/instalan el paquete, qué esperan del
flujo diario, fricciones conocidas (install vs builds portables, tamaño,
versiones, timeouts) y evidencia real (issues/discusiones de competidores
Y nuestros propios issues).

### 2. Estándares del ecosistema {{ECOSYSTEM}}

Convenciones de empaquetado/distribución (registros, CI de release
multiplataforma, semver, typing/stubs), patrones de DX esperados
(quickstart <5min, manejo de errores tipado) y cambios recientes del
ecosistema que afectan al módulo.

### 3. Competidores — análisis mínimo obligatorio

{{COMPETITORS}}. Para cada uno: arquitectura y backend, API pública (lista
exacta), flujos principales, DX de instalación/config, rendimiento
publicado (**con una fuente reproducible o marcado "unverified claim"**),
licencia, actividad, adopción (stars/descargas). Competidor principal para
diferenciación: {{MAIN_COMPETITOR}}.

### 4. Estado actual de `{{MODULE}}` (interno, evidencia file:line)

- Inventario completo de la superficie pública exportada.
- Flujos implementados y su calidad (tests que los cubren, lagunas).
- Empaquetado/distribución: qué se entrega, dónde, CI de release.
- Docs: docs de API, README, ejemplos — existencia y frescura.
- Historia: tareas/hallazgos previos de este módulo en backlog/tasks.
- Rendimiento: números medidos existentes o su ausencia.

### 5. Marco de evaluación (puntuación 0-10 por dimensión, con evidencia)

DX de incorporación · completitud funcional · rendimiento/overhead ·
robustez · seguridad · docs y ejemplos · observabilidad · testabilidad ·
paridad con superficies hermanas (misma feature en otra parte del
proyecto) · **diferenciación** (¿por qué elegir esto sobre
{{MAIN_COMPETITOR}}?).

### Entregables → `<research path>/research-{{MODULE}}-<YYYYMMDD>.md`

1. Matriz de competencia: features × productos (incluyendo `{{MODULE}}`).
2. Análisis de lagunas priorizado: faltante (P0/P1/P2) · mejorable ·
   optimizable.
3. Quick wins (<1 día) vs apuestas estratégicas (>1 semana).
4. **Apéndice obligatorio de hallazgos:** TODO hallazgo — incluso los
   menores — con id secuencial `H-NN`, categoría sugerida
   (APPLY/IMPROVE/ADD/OPTIMIZE/STRATEGY/DISCARD), severidad, esfuerzo
   estimado y `file:line`. Este apéndice alimenta §C (decisiones por
   hallazgo) — sin él, se pierden datos.
5. Recomendaciones → finding records por decisión del propietario (§C).
6. Afirmaciones de rendimiento solo con un benchmark reproducible citado.

### Método y fuentes

- Internet (con autorización del propietario): repos/issues/releases de
  competidores, estadísticas de registro, changelogs del ecosistema —
  skill `web-research`.
- Interno: investigación estructural de {{MODULE}}, sus tests, historia de
  backlog, logs de memoria del harness (`lessons`, registros de
  decisiones).
- Capacidades: `source-driven-development`, `web-research`; formato de
  reporte por módulo: `review-deep`.
- Bloque RESULT final con SKILLS_LOADED y GATES_EVALUATED.

### §B′ — Variante: módulo de producto/superficie

Cuando {{MODULE}} es una superficie de producto (web/desktop/front-end),
la unidad de análisis es la EXPERIENCIA y el PRODUCTO, no una API pública.
Mismo esqueleto con estas sustituciones:

- Objeto: páginas/rutas, componentes, flujos de usuario, sistema de
  diseño, i18n, rendimiento, empaquetado (si hay), tests. Límite: no
  auditar el núcleo.
- Evidencia visual permitida y recomendada: capturas vía la herramienta de
  navegador disponible contra un dev server local
  (open/screenshot/console).
- §1 → FLUJOS críticos de usuario: paso a paso esperado, dónde se rompe
  hoy, fricciones (copy confuso, estados vacíos/cargando sin diseño,
  errores sin salida).
- §3 → PRODUCTOS de referencia: primera impresión (hero/mensajería), los
  2–3 flujos núcleo, onboarding, estados de error/vacío, rendimiento
  percibido (fuente reproducible o "unverified claim"), qué copiar
  abiertamente.
- §4 → inventario de rutas/pantallas, componentes, sistema de diseño en
  uso; auditorías previas aplicables; deuda conocida (referenciarla, no
  redescubrirla); perf/i18n/a11y medido o su ausencia.
- §5 → dimensiones de producto: primera impresión y mensajería · flujos
  núcleo sin fricción · accesibilidad (nivel WCAG objetivo) · rendimiento
  (web-vitals/latencia de interacción declarados) · i18n · coherencia del
  sistema de diseño · robustez (errores, vacío, cargando, offline) ·
  seguridad (CSP/secretos/validación) · testabilidad (E2E) ·
  **diferenciación**.
- Nombre de reporte: `research-{{MODULE}}-prod-<YYYYMMDD>.md`.
- Capacidades: las skills de front-end/diseño del proyecto, herramienta de
  revisión visual/navegador, `web-research`.

---

## §C — Sala de decisiones (síntesis → decisiones del propietario)

Disparador: ejecutar solo DESPUÉS de que existan los reportes de módulo y
la síntesis entre módulos bajo la ruta de investigación. Convierte
hallazgos en decisiones del propietario — qué aplicar, mejorar, añadir,
optimizar o descartar — y materializa cada decisión en registros
ejecutables.

### Fase C.1 — Consolidación (sin preguntas aún)

Consolidar en UNA tabla maestra cada hallazgo de: los apéndices `H-NN` de
los reportes por módulo, el reporte de síntesis, y los finding records ya
derivados al backlog.

Clasificar cada hallazgo en UNA categoría de acción:

| Categoría | Significado | Ejemplo |
|---|---|---|
| APPLY | Quick win <1 día, listo ahora | "add engines field to manifest" |
| IMPROVE | Existe pero deficiente (puntuación ≤6 en una dimensión) | "docs lack per-runtime examples" |
| ADD | Feature/capacidad faltante (laguna P0/P1) | "feature X exists in no binding" |
| OPTIMIZE | Funciona pero a costo medible (perf/tamaño/memoria) | "bundle 2.3MB without lazy-load" |
| STRATEGY | Decisión de dirección, no una tarea | "compete in browser-only or concede?" |
| DISCARD/WONTFIX | No vale el costo — proponer archivar | "support platform <1.0" |

Por ítem calcular **impacto** (alto/medio/bajo) × **esfuerzo** (buckets
declarados) × **dimensión de calidad afectada**, usando lo que dicen los
reportes — no inventar.

Si hay >25 ítems: preseleccionar TODOS los P0/P1, el top-10 por ratio
impacto/esfuerzo, y todos los STRATEGY. El resto va a un anexo "sin
pregunta — directo al backlog como prioridad baja salvo objeción".

### Fase C.2 — Rondas de preguntas (empaquetadas, máx. 4 rondas)

Usar la interfaz de preguntas con MÚLTIPLES preguntas por llamada. Cada
pregunta: agrupada por tema (no una por hallazgo); alternativas
mutuamente excluyentes fusionadas ("opción A vs B vs ambas");
`(Recommended)` primero, derivado de las puntuaciones de la síntesis;
multi-selección donde las opciones no son excluyentes.

- **Ronda 1 — Veredicto y estrategia (la más importante):** presentar
  primero el veredicto consolidado (puntuaciones por módulo, ranking de
  competidores, posición relativa). Preguntar: ¿apuesta estratégica
  prioritaria? ¿dimensión global inaceptable (multi)? ¿hallazgos que
  contradicen el roadmap actual → repriorizar?
- **Ronda 2 — Quick wins:** ¿qué ítems APPLY ahora (multi)? ¿vía un plan
  por lotes o tareas sueltas?
- **Ronda 3 — Features faltantes:** ¿qué lagunas P0 entran como fase
  nueva? P1s: ¿entran, se aplazan o WONTFIX? ¿política de paridad entre
  superficies: total o caso por caso?
- **Ronda 4 — Mejorar/optimizar + descartes:** ¿qué mejorables suben de
  prioridad? ¿qué optimizaciones exigen un benchmark antes/después antes
  de decidir (sin afirmaciones de perf no medidas) y cuáles se aprueban
  directamente? ¿confirmar los WONTFIX propuestos?

**Regla de corte:** si tras la Ronda 2 el propietario dice "todo lo
recomendado", saltar las rondas restantes, aplicar los defaults
recomendados y listarlos como decisiones explícitas-por-defecto
(registradas igual).

### Fase C.3 — Materializar decisiones

Por CADA decisión del propietario:

1. **Registro ejecutable** en el backlog: clave canónica según la
   taxonomía registrada (hallazgos genéricos → el esquema de hallazgos,
   `finding-record`), fila con esquema declarado, contrato verificable
   ("done = el comando que lo prueba"), esfuerzo, prioridad resultante,
   archivos clave.
2. **WONTFIX/descartes** → un registro de decisión bajo
   `.scopegrain/decisions` con la razón.
3. **Estrategia** → el log de memoria/decisiones del harness; un
   compromiso arquitectónico → proponer un ADR (lo autoría el propietario
   humano).
4. **Quick wins aprobados** → un nuevo registro de plan listo para
   plan-execution, con olas (ítems independientes en la ola 0).
5. Registrar un evento de journal (`<command>.completed`) con los conteos
   de decisiones.

### Salida final

```markdown
## Recorded decisions
| # | Decision | Category | Destination | Task/plan id |

## Explicit-by-default (applied without asking)
...

## Rejected / WONTFIX
... (with reason)

## Recommended next step
<plan-execution command for the new plan, if quick wins were approved>
```

Bloque RESULT final con SKILLS_LOADED y GATES_EVALUATED.
