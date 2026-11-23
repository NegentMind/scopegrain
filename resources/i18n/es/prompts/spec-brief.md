---
name: spec-brief
description: Mini-especificación guiada para feature-adds y lógica nueva — decisiones abiertas resueltas con el propietario antes de la implementación.
---
# Spec Brief

Plantilla y procedimiento para la mini-spec guiada requerida por cada tarea
feature-add o de lógica nueva (Gate P/Gate D en `decision-request`) ANTES
de aprobar `do` y ANTES de la fase ACT del registro de tarea. Las
decisiones abiertas (⚠️) se resuelven con el propietario vía la interfaz de
preguntas — una ronda, opciones concretas + default recomendado. Sin spec
completa → no hay ACT.

# Spec: <ID> — <title>

- **Type:** feature-add | new-logic | behavioral-refactor
- **Origin:** backlog | owner | discovery
- **Date:**

## 1. Problema

El problema real resuelto, en ≤5 líneas. Evidencia (issue, queja,
benchmark, caso de uso).

## 2. Criterios de aceptación

Comandos/comportamientos observables que prueban que está resuelto — se
convierten en el `Contract` del registro de tarea:

1. `<mechanical check>` pasa
2. <comportamiento verificable específico>

## 3. Alcance

- **Incluye:** ...
- **NO incluye:** ... (explícito — el anti-ampliación-de-alcance se
  define aquí)

## 4. Diseño propuesto

≤10 líneas: archivos a tocar, nuevas firmas/cambios de firma, flujo de
datos.

## 5. Decisiones abiertas (⚠️ → pregunta al propietario)

> **Profundidad mínima por fila:** ≥2 alternativas REALES (enfoques
> materialmente distintos, no variantes cosméticas) + un compromiso de
> costo de una línea por opción. Si solo existe una ruta viable, NO
> inventar opciones de relleno: registrar la única ruta con su evidencia
> (`ref: file:line` o doc oficial) y marcarla `decided-by-evidence`.

| # | Decisión | Opciones (+compromiso) | Default recomendado | Resolved |
|---|----------|---------------------|---------------------|----------|
| 1 | p. ej. API sync o async | sync (simple, bloquea al llamante) / async (throughput, complejidad) | sync | |

> Cada fila se pregunta antes de cerrar la spec. La respuesta se registra
> aquí (columna `Resolved`) y en el registro de continuación.

## 6. Riesgos y radio de impacto esperado

Top-3 riesgos (siembran el registro de riesgos del plan) + archivos
estimados.

---
**Estado de la spec:** ⬜ draft → 🔄 questions sent → ✅ owner-confirmed

Una vez confirmada: la spec aterriza en la sección `## Spec` del registro
de tarea y el `Contract` se copia de §2. Puerta mecánica: un registro de
tarea feature-add sin un `## Spec` RELLENO (tabla de decisiones o
evidencia por ítem — ver `decision-request` §valid-spec) NO entra en ACT.
