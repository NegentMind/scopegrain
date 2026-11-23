---
name: outcome-driven-development
description: Usar al acordar criterios de aceptación observables y evidencia de resultados, independientemente de la metodología de ingeniería seleccionada.
---
# Resultados observables

Esta capacidad concierne a resultados y evidencia; NO es la definición de
ODD en Scopegrain. ODD significa Organic Driven Development.

Acuerda qué resultado observable debe producir el trabajo, quién lo observa
y qué evidencia establecería que ocurrió, antes de decidir cómo construirlo.
El contrato de resultados es independiente de la metodología: se aplica tanto
a una tarea ligera acotada como a un escenario SDD completo.

Inspecciona lo que ya está implementado. Acuerda el resultado observable
previsto, los actores, las restricciones, los no-objetivos y la evidencia que
establecería el éxito. Preserva el comportamiento solicitado y los ejemplos
exactos. Si una línea base o métrica es desconocida, propón una recopilación
autorizada en lugar de inventar un número.

Para trabajo ligero, mantén la aceptación y la evidencia real en su registro
de tarea acotado. Para SDD, enlaza escenarios, alcance de tarea,
comprobaciones, revisión y el informe de resultados vinculado. Distingue
archivos producidos, comprobaciones superadas y resultados de producto
demostrados. El impacto desconocido permanece desconocido; una atestación de
operador no es prueba autenticada de que un resultado externo ocurrió.

## Cuándo usar

- Al acordar qué significa "hecho" para cualquier unidad de trabajo, antes o
  mientras se escribe un registro de tarea, un escenario de spec o un plan.
- Al juzgar si un criterio de aceptación o una afirmación de "hecho" es falsable.

Esta skill es dueña del **contrato de resultados y la semántica de evidencia**
de la familia: las tablas de contratos verificables que `plan-coordination` y
`task-brief` referencian viven aquí. `organic-driven-development` aporta las
rutas a las que el contrato se vincula; `spec-driven-development` lo expresa
como escenarios; `constraint-driven-development` es dueña del listón global
del proyecto y sus trinquetes; esta skill es dueña de las líneas base por
resultado.

## El contrato de resultados

Para cada unidad de trabajo, registra:

```markdown
## Outcome contract
- **Actors:** who/what observes the result
- **Observable result:** what is true in the world when done
- **Constraints:** what must not change while achieving it
- **Non-goals:** what is explicitly out of scope
- **Evidence:** what would establish success — exact check, observation,
  or measurement, and who/what produces it
- **Baseline:** today's measured value, or "unknown — collection proposed"
```

## Reformula peticiones vagas en resultados falsables

Traduce adjetivos a condiciones:

| Vago | Falsable |
|-------|-------------|
| "hazlo más rápido" | "la operación X se completa en < N ms bajo carga Y, medido por Z" |
| "arregla el bug" | "los pasos de reproducción producen el resultado correcto R; comprobación de regresión T añadida" |
| "mejora la fiabilidad" | "el modo de fallo F ya no es observable bajo el escenario S" |
| "funciona bien" | "el comportamiento nombrado B es demostrable mediante la comprobación C" |

Si los criterios reformulados no son los objetivos correctos, eso aflora
**antes** del código: ese es el punto.

## Contratos: vagos vs verificables

| ❌ Vago | ✅ Verificable |
|---------|----------------|
| "Arregla el bug de memoria" | "leak-check limpio; suite en verde; la reproducción de memoria pasa" |
| "Mejora la UI" | "typecheck 0 errores; lint 0 errores; el flujo nombrado se completa" |
| "Refactoriza el módulo" | "el workspace compila; sin warnings nuevos; tests existentes sin modificar y en verde" |
| "Funciona bien" | "build + suite pasan, y <comportamiento específico> se observa" |

## Líneas base y trinquetes

- Una línea base desconocida es desconocida: propón una medición autorizada y
  registra el resultado. Nunca escribas un número que no mediste.
- Donde no existe un objetivo, adopta un trinquete: registra el valor de hoy
  con una dirección ("no debe caer"), aplica contra el valor registrado. Los
  trinquetes de todo el proyecto pertenecen al libro mayor de restricciones
  en `constraint-driven-development`; un trinquete por resultado permanece en
  el contrato de la unidad.
- Un umbral lleva su justificación junto a él: un número desnudo lo borra la
  siguiente persona que lo encuentre.

## Clases de evidencia: distínguelas

| Clase | Qué prueba | Qué no prueba |
|-------|----------------|------------------------|
| Artefacto producido | el archivo existe | que funciona, que alguien lo usa |
| Comprobación superada | la comprobación observó la condición contratada | que el resultado de producto ocurrió en el mundo |
| Resultado demostrado | una observación autorizada del resultado real | — (la clase más fuerte) |
| Atestación de operador | un identificador afirma un resultado | nada por sí misma: es una declaración, no prueba autenticada |

Reporta en qué clase descansa cada afirmación. Las comprobaciones superadas y
un informe aprobado son evidencia atribuida, no prueba de resultados de
negocio ni permiso para publicar.

## Vinculación a las rutas

- **Trabajo ligero:** el contrato de resultados y su evidencia viven dentro
  del registro de tarea acotado: sin documentos extra para imitar la ruta formal.
- **SDD:** cada escenario vincula su resultado observable, la tarea que lo
  posee vía scenarioRefs verifica su cobertura declarada, y el informe de
  resultados enlaza escenario → tarea → comprobación → revisión.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "El diff es el resultado" | Un artefacto producido prueba existencia, no el resultado. Nombra en qué clase de evidencia descansa la afirmación. |
| "Tests en verde significa hecho" | Una comprobación superada prueba que la condición contratada fue observada, no que el resultado de producto ocurrió en el mundo. |
| "Añadiremos la métrica después de entregar" | Los criterios escritos tras la implementación se ajustan a lo construido. La reformulación ocurre antes del código: ese es el punto. |
| "Una atestación confirma que ocurrió" | Un identificador que declara un resultado es una afirmación, no una prueba: es evidencia atribuida y no autoriza nada por sí misma. |

## Señales de alerta

- Criterios de aceptación que repiten el título de la tarea.
- Una métrica o línea base afirmada sin una medición registrada.
- "Hecho" declarado sobre producción de artefactos sin comprobación observable.
- Un resultado externo afirmado solo con atestación.
- Criterios de éxito añadidos tras la implementación para coincidir con lo construido.
- No-objetivos ausentes del contrato: desacuerdo de alcance silencioso.

## Verificación

- [ ] Cada resultado nombra actores, resultado observable, restricciones,
      no-objetivos, evidencia y línea base (o recopilación propuesta)
- [ ] Todo criterio de éxito es falsable tal como está escrito
- [ ] La clase de evidencia se declara por afirmación; las afirmaciones no
      atribuidas se marcan
- [ ] El trabajo ligero mantiene el contrato en su registro acotado; SDD
      vincula escenarios a tareas e informes
- [ ] El impacto desconocido se reporta como desconocido: nunca resuelto por decreto
