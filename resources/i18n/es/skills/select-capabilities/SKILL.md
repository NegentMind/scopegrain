---
name: select-capabilities
description: Usar al elegir capacidades para una tarea o inspeccionar el catálogo y la disponibilidad de dependencias
---
# Seleccionar capacidades

Inspecciona el catálogo y selecciona solo los procedimientos relevantes para
esta tarea. Comprueba las herramientas requeridas, el alcance, la procedencia
y el estado de activación. Lee los cuerpos de las skills seleccionadas y las
referencias necesarias, no todos los recursos. Una entrada archivada no está
aprobada para activación por existir en disco. Reporta dependencias no
disponibles y degrada explícitamente; no fabriques una herramienta, no
cargues historial privado ni instales una integración sin consentimiento.

Antes de finalizar la selección consulta el log de resultados
(`memory list --log outcomes` o las tasas `skillOutcomes` en `metrics`):
las tasas históricas ok/fail por skill son una señal real: prefiere skills
con un historial de éxito registrado y trata las no probadas como de mayor
riesgo, no inferiores. Registra lo que elegiste en `task.skills` para que el
bucle siga alimentado.

## Descubrimiento: tarea → fase → skills

Enruta la tarea a la fase en la que está, luego elige el conjunto de skills
más pequeño:

```
Task arrives
    │
    ├── Intent unclear? ────────────────→ clarify-intent
    ├── Rough concept, need variants? ──→ brainstorming
    ├── Conflict/ambiguity in scope? ───→ resolve-ambiguity
    ├── New/unfamiliar repository? ─────→ project-onboarding
    ├── New feature/change, no spec? ───→ spec-driven-development
    │     └── organic mode? ────────────→ organic-driven-development
    ├── Spec exists, need tasks? ───────→ planning-and-task-breakdown
    │     └── need the plan written? ───→ writing-plans
    │     └── plan review before build? → plan-design-review
    ├── Implementing code? ─────────────→ incremental-implementation
    │     ├── commits per slice? ───────→ work-unit-commits
    │     ├── forecast > slice budget? ─→ chained-pr
    │     ├── API/interface work? ──────→ api-and-interface-design
    │     ├── need better context? ─────→ context-engineering
    │     ├── doc-verified code? ───────→ source-driven-development
    │     ├── high stakes/unfamiliar? ──→ doubt-driven-development
    │     └── hard constraints? ────────→ constraint-driven-development
    ├── Writing/running tests? ─────────→ test-driven-development
    ├── Something broke? ───────────────→ systematic-debugging
    │     └── error-path handling? ─────→ debugging-and-error-recovery
    ├── Reviewing code? ────────────────→ code-review-and-quality
    │     ├── mode undecided? ──────────→ unified-review
    │     ├── too complex? ─────────────→ code-simplification
    │     ├── security concerns? ───────→ security-and-hardening
    │     ├── performance concerns? ────→ performance-optimization
    │     ├── deep/focused review? ─────→ review-deep
    │     └── named-risk unit? ─────────→ independent-review
    ├── Committing/versioning? ─────────→ git-workflow-and-versioning
    ├── CI/CD pipeline work? ───────────→ ci-cd-and-automation
    ├── Deprecating/migrating? ─────────→ deprecation-and-migration
    ├── Writing docs/ADRs? ─────────────→ documentation-and-adrs
    ├── Logs/metrics/alerts? ───────────→ observability-and-instrumentation
    ├── External research needed? ──────→ web-research
    ├── Release notes? ─────────────────→ release-notes-one-pager
    ├── Session boundary/progress? ─────→ session-handoff
    └── Deploying/launching? ───────────→ shipping-and-launch
```

## Declaración de capacidades (obligatoria, una por fase)

Elegir capacidades en silencio no es selección: es adivinar. Antes de la
primera acción mutante de una tarea (y de nuevo en cada cambio de fase),
emite este bloque para que la elección sea auditable y corregible:

```
DECLARED CAPABILITIES
task-type:   <core-logic|interface|docs|research|ops|release|mixed>
phase:       <clarify|spec|plan|implement|test|review|ship|debug|handoff>
skills:      [<id>, ...]          — bodies read before acting
references:  [<id>, ...]          — consulted as needed
mcps/tools:  [<id>, ...]          — only entries actually available
unavailable: [<id> — reason]      — degraded explicitly, never fabricated
rationale:   one line per non-obvious pick
```

Reglas:

1. Emítelo antes de la primera edición/comando, no después: una declaración
   hecha a posteriori no puede corregirse a tiempo.
2. Mantenlo como el conjunto más pequeño que cubre la fase actual. Cargar
   todo el catálogo es un fallo de esta skill, no exhaustividad.
3. En una transición de fase (plan → implement → test → review), reemítelo
   con el delta: no arrastres selecciones obsoletas en silencio.
4. Registra el conjunto final en `task.skills` al cerrar; alimenta el bucle
   de resultados usado para enrutar tareas futuras.
5. Cuando el runtime eventualmente suministre bindings automáticamente, este
   bloque se convierte en la verificación de que la autoselección fue
   correcta: la declaración se mantiene de cualquier modo.

## Comportamientos operativos centrales

Estos aplican en todo momento, a través de todas las skills. Innegociables.

### 1. Saca a la luz los supuestos

Antes de implementar cualquier cosa no trivial, declara los supuestos
explícitamente:

```
ASSUMPTIONS I'M MAKING:
1. [assumption about requirements]
2. [assumption about architecture]
3. [assumption about scope]
→ Correct me now or I'll proceed with these.
```

No rellenes silenciosamente requisitos ambiguos: sacar la incertidumbre a la
luz temprano es más barato que rehacer.

### 2. Gestiona la confusión activamente

Ante inconsistencias, requisitos en conflicto o specs poco claras:

1. **PARA.** No continúes sobre una suposición.
2. Nombra la confusión específica.
3. Presenta el tradeoff o la pregunta aclaratoria.
4. Espera la resolución.

### 3. Rebate cuando corresponda

No seas una máquina de síes. Cuando un enfoque tiene problemas claros:
señálalo, cuantifica el costo ("añade ~200ms de latencia", no "podría ser
más lento"), propón una alternativa, y acepta la decisión del dueño una vez
que anule con información completa. La sycophancy es un modo de fallo.

### 4. Impón simplicidad

Antes de terminar cualquier implementación, pregunta:

- ¿Puede hacerse en menos líneas?
- ¿Estas abstracciones se ganan su complejidad?
- ¿Diría un ingeniero senior "¿por qué no simplemente..."?

Prefiere la solución aburrida y obvia. La astucia es cara.

### 5. Mantén disciplina de alcance

Toca solo lo que la tarea requiere. No elimines comentarios que no
entiendes, no "limpies" código ortogonal, no refactorices sistemas
adyacentes, no borres código aparentemente sin uso sin aprobación, ni añadas
funcionalidades no solicitadas. Precisión quirúrgica, no renovación no
solicitada.

### 6. Verifica, no asumas

Una tarea no está completa hasta que la verificación pasa. "Parece correcto"
nunca es suficiente: exige evidencia: tests pasando, salida de build, datos
de ejecución. La verificación por skill es la comprobación local; la
Definition of Done de todo el proyecto
(`resources/references/definition-of-done.md`) aplica a cada cambio sin
importar qué skills estén activas.

## Modos de fallo a evitar

1. Supuestos erróneos sin comprobar
2. Avanzar a ciegas estando confundido
3. Notar inconsistencias y no sacarlas a la luz
4. Ocultar tradeoffs en decisiones no obvias
5. Acuerdo sycophantic con enfoques defectuosos
6. Código y APIs sobrecomplicados
7. Modificar código o comentarios fuera de la tarea
8. Eliminar lo que no comprendes completamente
9. Construir sin spec porque "es obvio"
10. Omitir la verificación porque "parece correcto"

## Reglas de skills

1. **Comprueba si existe una skill aplicable antes de empezar el trabajo**:
   las skills codifican procesos que previenen errores comunes.
2. **Las skills son flujos de trabajo, no sugerencias.** Sigue los pasos en
   orden; no omitas pasos de verificación.
3. **Varias skills pueden aplicar en secuencia.** Una funcionalidad puede
   ejecutar spec → plan → implement → test → review → ship de extremo a
   extremo.
4. **En caso de duda, empieza con una spec.** El trabajo no trivial sin spec
   comienza en `spec-driven-development`.
5. **Selección no es activación.** Una entrada archivada o no provisionada
   no está disponible; comprueba estado de activación, alcance y procedencia
   primero.
6. **Degrada explícitamente.** Una dependencia faltante se reporta y se
   trabaja alrededor: nunca fabricada, nunca sustituida en silencio.

## Secuencia del ciclo de vida

Para una funcionalidad completa, la secuencia típica es:

```
1.  clarify-intent                 → what the owner actually wants
2.  brainstorming                  → variants for vague ideas
3.  spec-driven-development        → what we are building
4.  planning-and-task-breakdown    → verifiable chunks
5.  writing-plans                  → the plan artifact
6.  context-engineering            → right context loaded
7.  source-driven-development      → verify against official docs
8.  incremental-implementation     → build slice by slice
9.  observability-and-instrumentation → instrument as you build (parallel)
10. doubt-driven-development       → cross-examine decisions in-flight
11. test-driven-development        → prove each slice
12. work-unit-commits              → reviewable commit per unit
13. code-review-and-quality        → review before merge
14. code-simplification            → reduce accidental complexity
15. git-workflow-and-versioning    → clean history
16. documentation-and-adrs         → document the why
17. shipping-and-launch            → deploy safely
18. release-notes-one-pager        → communicate the release
19. session-handoff                → persist progress and learnings
```

No toda tarea necesita cada skill. Un arreglo de bug puede solo necesitar
`systematic-debugging` → `test-driven-development` →
`code-review-and-quality` → `work-unit-commits`.

## Anti-racionalización (DEBE)

Las siguientes excusas son erróneas: ignóralas:

- "Esto es demasiado pequeño para una skill"
- "Lo implementaré rápido, no hace falta spec/test/review"
- "Conozco el código, no hace falta cargar skills"
- "Añadiré los tests después"

Comportamiento correcto: evalúa siempre qué skills aplican y cárgalas antes
de actuar; luego verifica según sus propios procedimientos.

## Verificación

- [ ] Se emitió un bloque `DECLARED CAPABILITIES` antes de la primera acción
      mutante y se reemitió en cada cambio de fase.
- [ ] El conjunto seleccionado es el más pequeño que cubre las fases de la
      tarea: no todo el catálogo.
- [ ] Cada entrada seleccionada fue comprobada en estado de activación,
      alcance y procedencia antes de usarla.
- [ ] Las herramientas/dependencias faltantes se reportaron y degradaron
      explícitamente: nada fabricado ni sustituido en silencio.
- [ ] La selección se registró en `task.skills` para que el bucle de
      resultados siga alimentado.
- [ ] Los cuerpos de las skills se leyeron realmente, no se infirieron de
      sus nombres.
