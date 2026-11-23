---
name: spec-driven-development
description: Usar para especificaciones formales explícitamente solicitadas o cambios sensibles y sustanciales que requieren un contrato de cambio falsable.
---
# Spec-Driven Development

Escribe una especificación estructurada antes de cualquier código. La spec
es la fuente de verdad compartida: define qué se está construyendo, por qué,
y cómo se prueba el completado. Código sin spec es adivinar.

Inspecciona el comportamiento actual, los llamantes, los tests, las
especificaciones existentes y las restricciones reales antes de añadir otro
contrato. Respeta el modo de proyecto seleccionado: no impongas documentos
formales a una tarea genuinamente ligera.

Preserva la solicitud original y los ejemplos exactos en la spec
estructurada. Si contiene secretos, obtén una solicitud redactada aprobada
antes de persistir; no alteres requisitos en silencio ni pongas credenciales
en artefactos. Da a los requisitos y escenarios identificadores estables.
Define comportamiento observable, compatibilidad, rutas de fallo,
recuperación, alcance y no-objetivos. No inventes una línea base, métrica o
umbral.

Las preguntas de producto sin resolver bloquean la implementación y la
aprobación de la especificación. Mantén la especificación, el diseño, el
plan, las decisiones y los informes en las rutas configuradas del harness.
Obtén aprobaciones actuales vinculadas al contenido antes del ACT formal.
Asigna escenarios a tareas; el plan cubre la especificación completa,
mientras cada tarea verifica su propia cobertura declarada.

Las comprobaciones superadas y un informe aprobado siguen siendo evidencia
atribuida, no prueba autenticada de resultados de negocio ni permiso para
publicar.

## Cuándo usar

- Se solicitó explícitamente una especificación formal.
- El cambio es sensible o sustancial y necesita un contrato de cambio
  falsable: según las clases de riesgo nombrado de
  `organic-driven-development` (`security`, `public-contract`,
  `data-integrity`, `external-effects`, `concurrency`, `delivery`,
  `verification-gap`).

No impongas la cadena completa de documentos a trabajo genuinamente ligero
(el registro acotado basta: `organic-driven-development`), y no escribas una
spec completa para un añadido de funcionalidad dentro de un plan: la puerta
mini-spec `spec-brief` cubre ese caso. Mecánica de rondas de preguntas: el
contrato de puerta canónico vive en `decision-request` (una ronda por
puerta, opciones + default recomendado); el oficio de entrevista vive en
`resolve-ambiguity`.

## El flujo con puertas

Cuatro fases, cada una con puerta en la aprobación del dueño del artefacto
tal como está escrito:

```
SPECIFY ──→ PLAN ──→ TASKS ──→ IMPLEMENT
   │          │        │          │
   ▼          ▼        ▼          ▼
 owner      owner    owner      owner
 approves   approves approves   verifies
```

No avances hasta que el artefacto actual esté aprobado. Una spec o plan
persistido no es autorización para implementar.

## Fase 1: Specify — deriva primero, pregunta después

Deriva todo lo que el repositorio ya responde (código, docs existentes,
decisiones, specs previas). Todo lo derivable se convierte en un ítem
decidido con evidencia citada (`ref: file:line`). No pidas al dueño que
redescubra hechos de la fuente.

Recoge las decisiones abiertas restantes en **una** ronda de preguntas
estructurada:

1. Agrupa todas las decisiones abiertas en una sola ronda: no gotees preguntas.
2. Cada pregunta lleva opciones concretas con el default recomendado
   primero. Nunca un "¿qué quieres?" abierto.
3. Usa el mecanismo estructurado de preguntas/aprobación del host cuando lo
   provea. Si no existe ninguno, emite una tabla de decisión acotada y
   **para**: nunca asumas las respuestas.
4. La negativa, las preguntas omitidas, las respuestas personalizadas y la
   incertidumbre no son aprobación.

```
| # | Decision              | Options (+ tradeoff)        | Recommended |
|---|-----------------------|-----------------------------|-------------|
| 1 | Auth mechanism        | session / token / both      | session     |
| 2 | Compatibility target  | current only / + legacy     | current     |
```

### Contenido de la spec

Cubre estas áreas; cada una recibe un identificador estable:

1. **Objetivo**: qué se está construyendo, para quién, por qué ahora, cómo
   se ve el éxito.
2. **Escenarios**: comportamiento observable como IDs estables (`S1`,
   `S2`, …) que las tareas poseerán después vía scenarioRefs.
3. **Interfaces y comandos**: firmas completas y comandos ejecutables, no
   nombres de herramientas.
4. **Restricciones y límites**: tres niveles:
   - *Siempre:* ejecutar comprobaciones antes de cerrar trabajo, seguir
     convenciones, validar entradas.
   - *Preguntar primero:* cambios de esquema, nuevas dependencias, cambios
     de pipeline/config.
   - *Nunca:* commitear secretos, editar código generado/vendor, eliminar
     comprobaciones fallidas sin aprobación.
5. **Rutas de fallo y recuperación**: qué puede salir mal y cómo se detecta
   y deshace.
6. **No-objetivos**: exclusiones explícitas. La mitad del desalineamiento es
   desacuerdo silencioso sobre lo que no se está construyendo.
7. **Criterios de éxito**: condiciones falsables y comprobables.
8. **Preguntas abiertas**: cualquier cosa sin resolver; bloquean la aprobación.

### Plantilla de spec

```markdown
# Spec: [project/feature name]

## Objective
[What and why. Original request preserved verbatim.]

## Scenarios
| ID  | Scenario | Observable behavior | Failure path |
|-----|----------|--------------------|--------------|
| S1  | ...      | ...                | ...          |

## Interfaces and commands
[Signatures; full commands with working directories]

## Constraints
- Always: [...]
- Ask first: [...]
- Never: [...]

## Failure paths and recovery
[Detection, rollback, authority required]

## Non-goals
- [Explicit exclusion — and why]

## Success criteria
[Specific, falsifiable conditions]

## Open questions
[Unresolved — blocks approval]
```

### Reformula requisitos vagos como criterios falsables

Traduce instrucciones a condiciones concretas:

```
REQUIREMENT: "Make the dashboard faster"

REFRAMED:
- First meaningful render < 2.5s on the reference environment
- Initial data load completes < 500ms
- No visible layout shift during load
→ Are these the right targets? (open question until approved)
```

Esto te permite iterar hacia un objetivo claro en lugar de adivinar qué
significa "más rápido". Si no existe línea base, propón una medición
autorizada en lugar de inventar un número. El contrato de resultados
falsables —actores, clases de evidencia, líneas base y trinquetes— es
canónico en `outcome-driven-development`.

## Fase 2: Plan

Con la spec aprobada, produce un plan técnico según `writing-plans` y
`planning-and-task-breakdown`: ellas poseen la mecánica de grafo de
dependencias, corte, ordenamiento y dimensionado; esta fase solo añade las
reglas específicas de SDD:

- Asigna cada escenario a exactamente una tarea; la unión cubre la spec.
- El plan debe ser revisable: el dueño puede decir "sí, ese enfoque" o "no,
  cambia X" sin ejecutar nada. Para planes consecuentes, ejecuta
  `plan-design-review` antes de presentar para aprobación.

## Fase 3: Tasks

Descompón el plan en registros de tarea discretos según
`planning-and-task-breakdown`: cada uno completable en una sesión enfocada,
cada uno con criterios de aceptación, un comando de verificación propuesto,
alcance de escritura declarado, y al menos un escenario poseído.

## Fase 4: Implement

Ejecuta una tarea cada vez bajo el ciclo de vida `contract-execution`
(PLAN → ACT → VERIFY → …). Carga solo las secciones de spec y los archivos
que la unidad actual necesita en lugar de toda la spec de una vez.

## Mantener la spec viva

La spec es un contrato vivo, no un artefacto de un solo uso:

- Los cambios de decisión actualizan primero la spec, luego el código.
- Los cambios de alcance (añadidos o cortados) se reflejan con su justificación.
- La spec vive en las rutas configuradas del harness junto a los registros de tarea.
- Los registros de tarea y las revisiones referencian IDs de escenario de
  vuelta a la spec.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Esto es simple, no hace falta spec" | Las tareas simples necesitan specs cortas, no ninguna. Una spec de dos líneas con criterios de aceptación está bien: la ruta ligera es una decisión, no un default. |
| "Escribiré la spec después de codificar" | Eso es documentación, no especificación. El valor es la claridad forzada antes del código. |
| "La spec nos frena" | Una spec de 15 minutos previene horas de retrabajo. |
| "Los requisitos cambiarán de todos modos" | Por eso la spec es viva. Una spec desactualizada supera a ninguna. |
| "El usuario sabe lo que quiere" | Las solicitudes claras llevan supuestos implícitos. La spec los saca a la luz. |

## Señales de alerta

- Escribir código sin requisitos escritos.
- Preguntar "¿empiezo a construir?" antes de que "hecho" esté definido.
- Implementar funcionalidades ausentes de cualquier spec o registro de tarea.
- Decisiones arquitectónicas tomadas y nunca registradas.
- Escenarios asignados a ninguna tarea, o tareas reclamando escenarios que
  no están en la spec.
- `N/A` escrito en una sección de spec que contiene decisiones técnicas reales.

## Verificación

Antes de proceder a la implementación:

- [ ] La spec cubre objetivo, escenarios, interfaces, restricciones,
      fallo/recuperación, no-objetivos, criterios de éxito, preguntas abiertas
- [ ] Cada requisito y escenario lleva un identificador estable
- [ ] Los criterios de éxito son falsables y comprobables
- [ ] Los límites (siempre / preguntar primero / nunca) están definidos
- [ ] La solicitud original está preservada verbatim; los secretos fueron
      redactados con aprobación
- [ ] El dueño aprobó la spec tal como está escrita; las preguntas abiertas
      están resueltas o explícitamente diferidas
- [ ] La spec está persistida bajo las rutas configuradas del harness
