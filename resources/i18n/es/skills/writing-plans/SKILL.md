---
name: writing-plans
description: Usar tras resolver requisitos y diseño sustanciales para escribir un plan ejecutable acotado.
---
# Escribir planes

Escribe el plan de implementación asumiendo que el ejecutor tiene cero
contexto del proyecto: archivos exactos, interfaces exactas, comandos
exactos con salida esperada, y los tests y docs a consultar. Asume un
ingeniero competente que no sabe nada de las convenciones ni del diseño de
tests de este codebase. Documenta todo lo necesario para ejecutar sin
adivinar. DRY. YAGNI. Commits pequeños y atómicos.

Declara el comportamiento existente verificado, el comportamiento faltante
y el diseño aprobado. No crees otro plan para trabajo ya implementado ni una
cadena de documentos formales para una tarea ligera que solo necesita su
registro acotado.

## Cuándo usar

- Una especificación o diseño aprobado está resuelto y trabajo sustancial
  necesita un plan ejecutable.
- El ejecutor no compartirá tu contexto de sesión: el plan debe llevarlo todo.
- El trabajo debe pausarse y reanudarse entre sesiones sin reexplicar.

No la uses para una tarea genuinamente ligera (su registro acotado basta,
según `organic-driven-development`), y no la uses para decidir cuáles son
las unidades: eso es `planning-and-task-breakdown`. Esta skill es dueña de
**cómo se especifica cada unidad para la ejecución**; `plan-design-review`
actúa de puerta sobre el resultado, y `organic-driven-development` decide si
un plan es proporcionado en absoluto.

## Granularidad: una acción por paso

Cada paso es una única acción, completable en minutos:

- "Escribe la comprobación que falla": paso
- "Ejecútala; confirma que falla por la razón declarada": paso
- "Implementa el mínimo que la hace pasar": paso
- "Ejecútala; confirma que pasa": paso
- "Commitea la unidad": paso

## Cabecera del registro de plan

Todo registro de plan empieza con:

```markdown
# [Feature name] Implementation Plan

**Goal:** [one sentence describing what this builds]
**Approach:** [2-3 sentences — architecture and why]
**Stack and conventions:** [key technologies + the project's actual
build/test/lint commands]
**Executor note:** implement task-by-task per the coordination skill;
each unit ends in a verification and a commit boundary.
```

## Estructura de unidad de tarea

Para cada tarea formal especifica entradas, archivos reales, interfaz
exacta, escenarios asignados, comprobaciones de aceptación, dependencias,
alcance de escritura y autoridad.

```markdown
### Task [key]: [unit name]

**scenarioRefs:** [S1, S3]
**Files:**
- Create: `exact/path/to/file`
- Modify: `exact/path/to/existing` — which symbol/section
- Test: `tests/exact/path`

**Step 1: write the failing check**

<concrete check code or exact command, not "add a test">

**Step 2: run to confirm it fails**

Run: `<exact command>` in `<directory>`
Expected: FAIL with <named reason>

**Step 3: minimal implementation**

<the actual interface/signature and approach — not "add validation">

**Step 4: run to confirm it passes**

Run: `<exact command>`
Expected: PASS

**Step 5: commit**

`<exact commit boundary>` — atomic, conventional message
```

## Reglas

- Rutas exactas siempre; interfaces y firmas completas, nunca "add
  validation" ni "handle errors".
- Comandos exactos con salida esperada, marcados como propuestos hasta
  autorizarse y ejecutarse. Nombra el directorio de trabajo.
- Declara comandos y directorios de trabajo como propuestos hasta
  autorizarse y ejecutarse realmente. Nombra las decisiones sin resolver
  como bloqueos, no como parámetros adivinados.
- Mantén el comportamiento coherente con sus tests y docs; los conteos de
  archivos o líneas por sí solos no deciden el riesgo de una tarea ni
  fuerzan divisiones artificiales.
- Un límite de commit por unidad de tarea; una unidad debe ser
  individualmente reversible.
- Referencia el escenario de spec que cada unidad cierra.

## Almacena y haz handoff

Almacena el plan en las rutas configuradas del harness (`.scopegrain/plans`
por defecto) y haz dry-run antes de aplicar. No delegues una elección sin
resolver ni declares que la persistencia es aprobación.

Tras aprobarse el plan, presenta las opciones de ejecución y espera la
elección: nunca arranques automáticamente:

1. **Esta sesión, paso a paso**: ejecuta unidades en orden con verificación
   y revisión entre cada una, según `contract-execution`.
2. **Ejecución coordinada**: programa unidades con dependencias resueltas
   (paralelo solo donde los alcances de escritura sean disjuntos), según
   `plan-coordination`; el prompt `plan-execution` operacionaliza esa
   ejecución.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "El ejecutor lo resolverá" | El plan existe porque el ejecutor tiene cero contexto. La ambigüedad delegada a un plan se convierte en una decisión improvisada en un diff. |
| "Los detalles van en el código" | Una elección sin resolver rodeada al escribir es una decisión tomada en silencio. Nómbrala como bloqueo, no como parámetro. |
| "Un paso más grande ahorra ceremonia" | Los pasos agrupados rompen el verificar-por-paso y la reversibilidad por unidad: las dos propiedades que hacen un plan reanudable. |
| "Las rutas exactas me frenan" | Una ruta que el plan nunca verificó es un hallazgo esperando al ejecutor. Compruébala ahora o márcala como no verificada. |

## Señales de alerta

- Pasos que empaquetan varias acciones ("write tests and implement").
- Comandos sin salida esperada, o rutas que el plan nunca verificó que existen.
- Criterios de aceptación que repiten el título de la tarea.
- Un plan que deja una decisión abierta al juicio del ejecutor.
- Tratar un archivo de plan persistido como autorización para implementar.

## Verificación

Antes del handoff, confirma:

- [ ] Cada paso es una única acción con un comando propuesto, directorio de
      trabajo y salida esperada
- [ ] Cada ruta e interfaz nombrada en el plan fue verificada como existente
- [ ] Cada unidad cierra scenarioRefs nombrados y termina en un límite de commit
- [ ] Ninguna decisión abierta se delega al ejecutor: los bloqueos se nombran
- [ ] El plan está almacenado bajo la ruta de planes configurada y se hizo dry-run
- [ ] El dueño aprobó el plan y eligió un modo de ejecución: sin auto-arranque
