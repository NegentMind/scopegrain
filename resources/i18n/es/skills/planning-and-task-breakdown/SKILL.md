---
name: planning-and-task-breakdown
description: Usar cuando trabajo sustancial y resuelto necesita tareas conscientes de dependencias y propiedad de escenarios explícita.
---
# Planificación y descomposición de tareas

Descompón trabajo aprobado y resuelto en tareas pequeñas y verificables con
criterios de aceptación explícitos y propiedad de escenarios. Una buena
descomposición es la diferencia entre trabajo que se completa con fiabilidad
y trabajo que produce un desastre enredado e inverificable. Cada tarea debe
ser lo bastante pequeña para implementarse, verificarse y revisarse en una
única sesión enfocada.

Inspecciona primero la implementación, los planes y las decisiones
existentes. Declara la brecha real, el alcance, las comprobaciones de
aceptación, los riesgos y las necesidades de recuperación. Usa Organic para
evitar un pipeline de planificación multitarea en trabajo genuinamente ligero.

## Cuándo usar

- Existe una especificación o diseño aprobado y necesita unidades implementables.
- Una tarea parece demasiado grande o vaga para empezar.
- El trabajo debe paralelizarse entre agentes o sesiones.
- El alcance debe comunicarse a un humano para aprobación.
- El orden de implementación no es obvio.

No descompongas cambios de un solo alcance con aceptación obvia, y no
replanifiques trabajo ya implementado: verifica contra el código primero.

## División del trabajo

Esta skill decide **cuáles son las unidades**: descomposición, orden de
dependencias, propiedad de escenarios y dimensionado. Canon vecino:

- `writing-plans`: cómo se lee cada unidad para un ejecutor sin contexto:
  archivos exactos, pasos de una acción, comandos propuestos con salida esperada.
- `outcome-driven-development`: qué hace falsables a los criterios de
  aceptación y su evidencia.
- `plan-design-review`: la puerta que cuestiona el plan terminado.
- `plan-coordination`: orquesta las tareas aprobadas durante la ejecución.
- El prompt `plan-brief` operacionaliza el triaje del backlog en un registro
  de plan; `task-brief` contiene la plantilla de registro de tarea en
  ejecución que estos campos de planificación pueblan.

## El proceso de planificación

### Paso 1: Descubrimiento en solo lectura

Antes de escribir cualquier tarea, opera en solo lectura:

- Lee la especificación, el diseño aprobado y el código relevante.
- Identifica patrones, convenciones y costuras reutilizables existentes.
- Mapea dependencias entre componentes y registros de tarea existentes.
- Anota riesgos, incógnitas y todo lo que la spec dejó sin decidir.
- Confirma que la brecha es real: los archivos y símbolos referenciados
  existen, el comportamiento descrito no está ya implementado, y ningún otro
  plan o tarea completada lo cubre. Una tarea cuya premisa está obsoleta se
  marca, no se planifica.

No implementes durante la planificación. Los productos son un registro de
plan y registros de tarea bajo las rutas configuradas del harness
(`.scopegrain/plans` y `.scopegrain/tasks` por defecto), no código.

### Paso 2: Mapea el grafo de dependencias

Mapea qué depende de qué. Los cimientos se construyen primero; los
dependientes después:

```
Storage / schema
    |
    +-- Domain models / types
    |       |
    |       +-- Interface endpoints
    |       |       |
    |       |       +-- Consumers (clients, UI, integrations)
    |       |
    |       +-- Validation logic
    |
    +-- Seed data / migrations
```

El orden de implementación sigue el grafo de abajo arriba. Registra el grafo
en el plan para que el ordenamiento sea auditable, no implícito.

### Paso 3: Corta verticalmente

Entrega una ruta de funcionalidad completa cada vez en lugar de construir
toda una capa y luego la siguiente:

**Corte horizontal (evitar):**
```
Task 1: entire storage schema
Task 2: all interface endpoints
Task 3: all UI components
Task 4: connect everything
```

**Corte vertical (preferir):**
```
Task 1: user can register (schema + endpoint + UI for registration)
Task 2: user can log in (auth + endpoint + UI for login)
Task 3: user can create a record (model + endpoint + UI)
Task 4: user can list records (query + endpoint + UI)
```

Cada corte vertical deja el sistema en un estado funcional y comprobable.

### Paso 4: Escribe los registros de tarea

Cada registro de tarea declara los campos de planificación siguientes; en
tiempo de ejecución pueblan el registro de ejecución cuya plantilla canónica
vive en el prompt `task-brief`:

```markdown
## Task [key]: [short descriptive title]

**Scope:** one paragraph — what this task delivers and what it excludes.
**scenarioRefs:** [S1, S3] — scenarios this task closes.
**Acceptance criteria:**
- [ ] Specific, testable condition
- [ ] Specific, testable condition
**Verification:**
- [ ] Proposed command: <exact command + working directory> — expected result
- [ ] Manual check: what to verify and how
**Depends on:** [task keys, or "none"]
**Files likely touched:** `path/to/file`, `tests/path/to/test`
**Write scope:** [paths this task may modify — everything else is out of bounds]
**Recovery:** [how to roll back this unit if verification fails]
**Estimated scope:** Small (1-2 files) | Medium (3-5) | Large (5+)
```

Los comandos de verificación son propuestas hasta que se autorizan y
ejecutan; registra el comando real y la referencia de salida tras la
ejecución. Prefiere los comandos propios de build/test/lint del proyecto
sobre los inventados.

Si el proyecto designa un tracker externo (issue tracker, tablero, sistema de
trabajo externo), mapea estos campos a sus ítems: aceptación y verificación
en el cuerpo del ítem, dependencias vía su mecanismo de enlazado, y anota el
tracker en el registro de plan en lugar de duplicar la lista de tareas.

### Paso 5: Ordena, checkpoint, aprueba

Organiza las tareas de modo que:

1. Las dependencias estén satisfechas: cimientos primero.
2. Cada tarea deje el sistema en un estado funcional.
3. Haya checkpoints de verificación cada 2-3 tareas.
4. Las tareas de alto riesgo estén temprano: falla rápido mientras corregir
   el rumbo es barato.

Añade checkpoints explícitos al plan:

```markdown
## Checkpoint: after Tasks 1-3
- [ ] All proposed checks pass with recorded output
- [ ] The project builds without errors
- [ ] Core flow works end-to-end
- [ ] Review with the owner before proceeding
```

Mantén el DAG acíclico y las escrituras paralelas disjuntas: ninguna pareja
de tareas ejecutables concurrentemente puede escribir las mismas rutas.
Presenta el plan completo y sus destinos para aprobación. Dry-run antes de
aplicar; un PLAN persistido no es autorización para implementar. Elige el
siguiente trabajo desde los registros de tarea actuales, no desde un resumen
obsoleto. Un scheduler no demuestra ejecución real del agente.

## Propiedad de escenarios

Para trabajo formal, referencia la especificación estructurada y el diseño
aprobado. Divide en entregables coherentes con claves estables, alcances
acotados, claves de prerrequisito y scenarioRefs.

- Cada escenario asignado pertenece a esa especificación; la unión de todas
  las tareas la cubre completamente: nada fuera de ella, nada faltante.
- Cada tarea formal debe poseer al menos un escenario verificable. Si la
  preparación no tiene ninguno, pide acordar un escenario técnico o reagrupa
  la tarea; no inventes requisitos ni aceptes una asignación vacía.
- No exijas que escenarios futuros no relacionados pasen antes de que la
  primera tarea con dependencias resueltas pueda cerrarse. Cada tarea cierra
  sus propios escenarios.

## Dimensionado de tareas

| Tamaño | Archivos | Alcance | Ejemplo |
|------|-------|-------|---------|
| XS | 1 | Una función o cambio de configuración | Añadir una regla de validación |
| S | 1-2 | Un componente o endpoint | Añadir un endpoint nuevo |
| M | 3-5 | Una porción de funcionalidad | Flujo de registro |
| L | 5-8 | Funcionalidad multicomponente | Búsqueda con filtrado y paginación |
| XL | 8+ | **Demasiado grande: descompón más** | — |

Un agente rinde mejor en tareas S y M. Descompón más una tarea cuando:

- Tomaría más de una sesión enfocada.
- No puedes declarar sus criterios de aceptación en tres viñetas o menos.
- Toca dos o más subsistemas independientes.
- El título contiene "y": señal de que son dos tareas.

Mantén el comportamiento coherente con sus tests y docs en la misma unidad;
los conteos de archivos o líneas por sí solos no deciden el riesgo de una
tarea ni fuerzan divisiones artificiales.

## Plantilla de registro de plan

```markdown
# Implementation Plan: [feature/project name]

## Overview
[One paragraph — what is being built and why]

## Design decisions
- [Key decision and rationale, or reference to the approved design]

## Task list

### Phase 1: Foundation
- [ ] Task A: ... (scenarioRefs: S1)
- [ ] Task B: ... (scenarioRefs: S2)

### Checkpoint: foundation
- [ ] Checks pass, builds clean

### Phase 2: Core
- [ ] Task C: ... (scenarioRefs: S3, S4)

### Checkpoint: complete
- [ ] All assigned scenarios verified
- [ ] Ready for review

## Risks and mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| ...  | H/M/L  | ...        |

## Open questions
- [Decision needing owner input — a blocker, not a guessed parameter]
```

## Protección contra sobrescritura

Nunca sobrescribas un plan incompleto. Antes de escribir en un destino de
registro de plan o tarea, comprueba si ya existe y aún contiene tareas
abiertas:

- El mismo trabajo siendo replanteado (el dueño pidió revisar o extender este
  plan) → actualiza los registros existentes en el sitio.
- Trabajo diferente → para y pregunta. Las tareas abiertas pueden estar a
  mitad de construcción en otra sesión. No las borres, sobrescribas ni
  renombres por tu cuenta; presenta el conflicto y deja que el dueño decida.

La misma regla aplica a cualquier tracker externo: nunca cierres en masa los
ítems abiertos de otro plan para hacer sitio a nuevos.

## Paralelización

- **Seguro paralelizar:** porciones de funcionalidad independientes con
  alcances de escritura disjuntos, tests de comportamiento ya implementado,
  documentación.
- **Debe ser secuencial:** migraciones, cambios de estado compartido, cadenas
  de dependencias.
- **Necesita coordinación:** unidades que comparten un contrato: resuelve el
  contrato primero, luego paraleliza.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Lo iré resolviendo sobre la marcha" | Así es como ocurre el retrabajo enredado. Diez minutos de planificación ahorran horas. |
| "Las tareas son obvias" | Escríbelas de todos modos. Las tareas explícitas sacan a la luz dependencias ocultas y casos límite olvidados. |
| "Planificar es sobrecarga" | Planificar es la tarea. Implementar sin plan es teclear. |
| "Puedo mantenerlo en la cabeza" | El contexto es finito. Los registros escritos sobreviven a los límites de sesión. |
| "El plan viejo está obsoleto, lo reemplazaré" | Las tareas abiertas pueden estar a mitad de construcción en otro lugar. Sobrescribir destruye estado que no existe en ningún otro sitio. Para y pregunta. |

## Señales de alerta

- Empezar la implementación sin una lista de tareas escrita.
- Sobrescribir un plan o registro de tarea con ítems abiertos para trabajo diferente.
- Tareas que dicen "implementar la funcionalidad" sin criterios de aceptación.
- Ningún paso de verificación en todo el plan.
- Cada tarea puntuada XL, o cada tarea puntuada con el mismo esfuerzo.
- Sin checkpoints entre fases; orden de dependencias sin examinar.
- Una fase llamada "integración" o "pulido" que oculta diseño no resuelto.

## Verificación

Antes de empezar la implementación, confirma:

- [ ] Cada tarea tiene criterios de aceptación vinculados a sus scenarioRefs
- [ ] Cada tarea tiene un paso de verificación con un comando real propuesto
- [ ] Las dependencias están identificadas, son acíclicas y están ordenadas correctamente
- [ ] Los alcances de escritura de tareas elegibles para paralelismo son disjuntos
- [ ] Ningún plan incompleto preexistente fue sobrescrito sin confirmación
- [ ] La unión de scenarioRefs cubre la especificación exactamente
- [ ] Existen checkpoints entre fases principales
- [ ] El dueño revisó y aprobó el plan y sus destinos
