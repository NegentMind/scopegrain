---
name: plan-design-review
description: Usar para evaluar un diseño o plan de tareas propuesto antes de comprometer trabajo de implementación
---
# Revisión antes del trabajo

Actúa como puerta para un diseño o plan de tareas propuesto antes de
comprometer trabajo de implementación. El momento más barato para encontrar
un plan equivocado es antes de construir nada; una vez que existe el código,
el usuario racionaliza lo incorrecto como "suficientemente bueno" y el
desajuste se consolida.

Compara el plan con el código observado, las restricciones y el resultado
solicitado. Comprueba los límites de tareas, los ciclos de dependencias, los
contratos de interfaz y la verificación. Inspecciona fallos en cascada,
migración, rollback y requisitos de autoridad. Identifica supuestos no
declarados o complejidad innecesaria. Devuelve brechas concretas y bloqueos
de aceptación antes de sugerir pulido. No implementes un plan no resuelto
solo porque está escrito.

## Cuándo usar

- Un plan o diseño producido por `writing-plans`,
  `planning-and-task-breakdown`, `brainstorming`, o suministrado por el
  dueño, está a punto de comprometer esfuerzo de implementación.
- Un plan consecuente necesita un veredicto antes de que empiece la ejecución.

No la uses para planes triviales de un solo alcance, como auditoría a mitad de
ejecución (eso es trabajo de una skill de revisión durante
`contract-execution`), ni como sustituto de la puerta de aprobación de spec
en `spec-driven-development`: esta revisión cuestiona la mecánica y el
anclaje del plan, no la intención de producto.

## Procedimiento de revisión

Ejecuta las comprobaciones en orden; cada una puede bloquear la aceptación
independientemente.

1. **Premisa**: ¿el plan resuelve el problema declarado, o uno diferente y
   más conveniente? Cita el resultado solicitado y el objetivo del plan lado
   a lado. Un plan que responde una pregunta distinta se rechaza sin importar
   lo bien construido que esté.
2. **Anclaje**: verifica las afirmaciones del plan contra el código real:
   cada archivo, símbolo y convención nombrado en el plan existe; el
   comportamiento descrito como ausente realmente falta; nada de lo planeado
   está ya implementado.
3. **Límites**: los alcances de tarea son entregables coherentes; los
   alcances de escritura de tareas elegibles para paralelismo son disjuntos;
   ninguna pareja de tareas necesita las mismas líneas.
4. **Dependencias**: el DAG es acíclico; el orden propuesto es satisfacible;
   el acoplamiento oculto (estado compartido, archivos generados,
   migraciones) está nombrado.
5. **Contratos**: cada tarea lleva aceptación verificable vinculada a sus
   scenarioRefs; ningún contrato se reduce a "funciona" ni repite el título.
   La unión de escenarios cubre la especificación exactamente.
6. **Análisis de fallos**: los modos de fallo en cascada, las rutas de
   migración y rollback, los efectos irreversibles y la autoridad que cada
   uno requiere están declarados. Cualquier cosa irreversible sin una
   historia de recuperación es un bloqueo.
7. **Barrido de supuestos**: supuestos no declarados, líneas base o métricas
   inventadas, y complejidad que los requisitos no justifican (YAGNI).
   Nombra cada uno; no los repares en silencio.

## Puntuación (para planes consecuentes)

Puntúa cada dimensión de 0 a 10 y declara cómo se ve un 10. Cualquier
dimensión por debajo de ~7 sin una brecha nombrada y cerrable es un bloqueo
de aceptación:

| Dimensión | Cómo se ve un 10 |
|-----------|----------------------|
| Cobertura | La unión de tareas cubre la spec exactamente; nada fuera de ella |
| Verificabilidad | Cada tarea tiene evidencia de aceptación mecánica |
| Ordenamiento | DAG acíclico; unidades de alto riesgo temprano; checkpoints entre fases |
| Reversibilidad | Cada unidad individualmente reversible; recuperación declarada |
| Minimalismo | Nada en el plan que no necesite existir |
| Anclaje | Cada afirmación verificada contra el código o la spec |

## Señales de plan-basura

Los planes autogenerados fallan de formas características. Márcalas al verlas:

- Criterios de aceptación que repiten el título de la tarea ("X está implementado").
- Rutas de archivo o símbolos que no existen en el repositorio.
- Líneas base, métricas o umbrales inventados presentados como medidos.
- Tareas ordenadas por narrativa en lugar de dependencia.
- Una fase llamada "integración", "cableado" o "pulido" que oculta diseño no resuelto.
- Cada tarea puntuada con el mismo esfuerzo, o todas XL.
- Alcance que responde más de lo que la solicitud pidió (creep de funcionalidades silencioso).

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "El plan fue escrito con cuidado" | La autoría cuidadosa no es verificación. El anclaje comprueba el plan contra el código, no contra su propia prosa. |
| "Lo generó un modelo potente" | El plan-basura es característico de los planes generados, no hipotético: marca las señales al verlas. |
| "Los bloqueos se pueden arreglar durante la implementación" | Arreglar después de que existe el código cuesta múltiplos de arreglar en papel: esa asimetría es la razón de esta puerta. |
| "Está suficientemente cerca para aprobar" | Aprobado-con-condiciones sigue llevando condiciones: a los registros de tarea, no solo a esta revisión. |

## Formato de salida

```
VERDICT: approved | approved with conditions | blocked
BLOCKERS:  [acceptance blockers, ordered by severity — each with evidence]
GAPS:      [concrete gaps that need closing, not blocking]
POLISH:    [optional improvements — never before blockers]
ASSUMED:   [what the review could not verify — kept explicit]
```

Reporta los bloqueos primero y el pulido al final. Un plan aprobado con
condiciones lleva las condiciones a los registros de tarea, no solo a esta
revisión. Las preguntas no resueltas que afloran aquí se enrutan a
`resolve-ambiguity`; los defectos de contrato y evidencia se juzgan contra
el listón de falsabilidad de `outcome-driven-development`.

## Verificación

- [ ] El veredicto usó el formato de salida; los bloqueos preceden al pulido
- [ ] Las afirmaciones de anclaje se comprobaron contra el código, no contra el texto del plan
- [ ] Se verificó cada límite de alcance de tarea y la disjunción de alcances de escritura
- [ ] La unión de escenarios se comparó contra la especificación, no se asumió
- [ ] Las acciones irreversibles sin historia de recuperación se marcaron como bloqueos
- [ ] Las condiciones de una aprobación se propagaron a los registros de tarea
