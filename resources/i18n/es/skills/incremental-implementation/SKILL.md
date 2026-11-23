---
name: incremental-implementation
description: Úsala para cambios que pueden entregarse como porciones verticales pequeñas sin ruido amplio no relacionado
---
# Implementación incremental

## Disciplina central

Elige el comportamiento de extremo a extremo más pequeño que avanza el
objetivo aprobado.
Identifica su interfaz, almacenamiento y límite de verificación.
Reproduce la brecha, implementa una porción coherente e inspecciona el diff.
Ejecuta las comprobaciones estrechas autorizadas, registrando limitaciones y
riesgo colateral.
No refactorices módulos no relacionados ni reejecutes jobs largos sin
cambios por defecto.
Lleva los resultados resueltos a la siguiente porción en lugar de
recomputarlos.

Construye en porciones verticales delgadas — implementa una pieza,
verifícala, luego expande. Nunca implementes una funcionalidad entera en una
pasada. Cada incremento deja el sistema en un estado funcional y
comprobable. Esta es la disciplina de ejecución que hace el trabajo grande
revisable y revertible.

## Cuándo usar

- Cualquier cambio multi-archivo o funcionalidad construida desde una
  descomposición en tareas.
- Refactorizar o migrar código existente.
- Siempre que se escribirían más de ~100 líneas antes de verificar.

**No para:** cambios de un solo archivo y una sola función cuyo alcance ya
es mínimo.

## El ciclo de incremento

```
Implement ──→ Verify ──→ Commit ──┐
   ▲                            │
   └──────── Next slice ◄───────┘
```

Por cada porción:

1. **Implementa** la pieza completa más pequeña de la unidad aprobada.
2. **Verifica** — ejecuta las comprobaciones que la tarea y el repositorio
   autorizan (test, build, type-check, lint — los comandos de verificación
   declarados del proyecto).
3. **Inspecciona el diff** — confirma que contiene solo esta porción.
4. **Commit** — una unidad atómica y revisable según `work-unit-commits`,
   cuando los commits estén autorizados.
5. **Lleva adelante** — reutiliza resultados verificados; no reinicies ni
   recomputes lo que una porción anterior ya resolvió.

## Estrategias de división

### Porciones verticales (por defecto)

Corta una ruta completa a través de cada capa que el comportamiento toca:

```
Slice 1: Create a record (storage + boundary + one consumer)
Slice 2: List records (query + boundary + consumer)
Slice 3: Update a record
Slice 4: Delete a record (with its authorization and confirmation path)
```

Cada porción entrega comportamiento funcional de extremo a extremo, no una
capa horizontal.

### División contract-first

Cuando dos lados de una interfaz evolucionan en paralelo:

```
Slice 0:  Fix the contract (types, schema, spec) — reviewed alone
Slice 1a: Implement side A against the contract + contract tests
Slice 1b: Implement side B against a fixture matching the contract
Slice 2:  Integrate and verify end-to-end
```

### División risk-first

Toma primero la pieza más arriesgada o menos segura:

```
Slice 1: Prove the uncertain mechanism works (spike-grade, verified)
Slice 2: Build the real behavior on the proven mechanism
Slice 3: Add the edge cases and failure modes
```

Si la porción 1 falla, la pérdida se descubre antes de invertir las
porciones 2 y 3.

## Reglas de implementación

### Simplicidad primero

Antes de escribir código, pregunta: "¿Qué es lo más simple que podría
funcionar?" Tras escribirlo, comprueba:

- ¿Puede hacerse en menos líneas?
- ¿Cada abstracción se gana su complejidad?
- ¿Estoy construyendo para la tarea actual o para requisitos hipotéticos?

```
SIMPLICITY CHECK:
✗ Generic event bus with middleware for one notification → ✓ a function call
✗ Abstract factory for two similar components           → ✓ two components + shared helper
✗ Config-driven form builder for three forms            → ✓ three form components
```

Tres líneas similares superan a una abstracción prematura. Implementa
primero la versión ingenua y obviamente correcta; optimiza solo tras probar
la corrección.

### Disciplina de alcance

Toca solo lo que la tarea requiere. NO:

- "Limpiar" código adyacente al cambio.
- Reformatear o modernizar archivos que solo se leen.
- Eliminar comentarios cuyo propósito no se entiende.
- Añadir funcionalidades fuera de alcance porque "parecen útiles".

Los problemas notados-pero-fuera-de-alcance se registran, no se arreglan:

```
NOTICED BUT NOT TOUCHING:
- <path>: unused import (unrelated to this task)
- <path>: error message could be clearer (separate task)
→ Recorded for the owner; not fixed here.
```

### Una cosa lógica por incremento

No mezcles un componente nuevo, un refactor y un cambio de config en una
porción. Separa los asuntos en commits separados — ver `work-unit-commits`.

### Manténlo en verde

Tras cada incremento el proyecto debe compilar y las comprobaciones
existentes deben pasar. Nunca dejes el árbol roto entre porciones.

### Feature flags para trabajo incompleto

Si los incrementos deben aterrizar antes de que una funcionalidad sea
visible al usuario, ponles puerta:

```
if (flags.isEnabled('new-behavior', context)) { /* new path */ }
```

Los flags permiten fusionar incrementos pequeños sin exponer trabajo sin
terminar. Pon por defecto el comportamiento nuevo en la opción segura y
conservadora (opt-in, desactivado, o que preserva el fallback).

### Amigable a rollback

Cada incremento es revertible independientemente:

- Prefiere cambios aditivos (archivos nuevos, funciones nuevas) —
  trivialmente revertidos.
- Mantén las modificaciones a código existente mínimas y enfocadas.
- Las migraciones de datos almacenados se entregan con una ruta inversa
  probada — ver `deprecation-and-migration` (expand/contract).
- No borres y reemplaces en el mismo commit; sepáralos.

## Dirigir a un delegado

Al pasar una porción a un sub-agente o compañero, declara el alcance
explícitamente — qué está dentro y qué NO:

```
"Implement task 3, database change plus the boundary endpoint only.
Do not touch the consumer yet — next slice.
After implementing, run the project's declared verification commands
and report raw results."
```

## Lista de verificación del incremento

Tras cada incremento, verifica con los comandos propios del repositorio:

- [ ] El cambio hace una cosa y la hace por completo.
- [ ] Los tests existentes siguen pasando; build, type-check y lint están
      limpios.
- [ ] El comportamiento nuevo funciona según lo especificado.
- [ ] El diff contiene solo esta porción — sin ruido no relacionado.
- [ ] Los resultados están registrados como evidencia (comando + resultado
      + limitaciones).
- [ ] El progreso se confirmó como unidad atómica, cuando está autorizado.

**No reejecutes comprobaciones sin cambios.** Tras una ejecución con
éxito, repite un comando de verificación solo tras cambiar código que
pudiera afectarlo; reejecutar sobre código sin cambios no aporta
información y quema tiempo.

## Contrato de salida

Cada porción produce un registro revisable:

- Un diff que contiene solo la unidad de esa porción — sin ruido no
  relacionado.
- Salida cruda de comprobaciones (comando + resultado + limitaciones) como
  evidencia.
- Un commit atómico según `work-unit-commits`, cuando los commits estén
  autorizados.
- Problemas notados-pero-fuera-de-alcance registrados para el propietario,
  no arreglados.

**Límite de alcance.** Esta skill gobierna el ciclo
implementar–verificar–commit *dentro* de un cambio. Cuando el pronóstico
total de líneas escritas excede el presupuesto de porción revisable, la
división de entrega y la mecánica de apilado de PRs pertenecen a
`chained-pr`; la disciplina por porción no cambia.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Lo probaré todo al final" | Los bugs se acumulan. Un bug en la porción 1 hace erróneas las porciones 2–5. Verifica cada porción. |
| "Es más rápido hacerlo todo de una vez" | Se siente más rápido hasta que algo se rompe y 500 líneas cambiadas ocultan la causa. |
| "Estos cambios son demasiado pequeños para commits separados" | Los commits pequeños son gratis. Los commits grandes ocultan bugs y hacen dolorosos los rollbacks. |
| "Añadiré el feature flag después" | El trabajo incompleto visible al usuario es un defecto. Añade el flag ahora. |
| "Este refactor es lo bastante pequeño para incluirlo" | Los refactors mezclados con cambios de comportamiento hacen ambos más difíciles de revisar y revertir. |
| "Déjame ejecutar la comprobación otra vez por si acaso" | Tras una ejecución en verde sobre código sin cambios, repetir no aporta nada. Reejecuta tras ediciones. |

## Señales de alerta

- Más de ~100 líneas escritas sin ejecutar ninguna comprobación.
- Múltiples asuntos no relacionados en un incremento o commit.
- Expansión de alcance tipo "déjame añadir esto también rápido".
- Saltarse la verificación para ir más rápido.
- Build o tests rotos entre incrementos.
- Cambios grandes sin commit acumulándose.
- Abstracciones construidas antes de que el tercer caso de uso las exija.
- Archivos tocados fuera del alcance de la tarea "ya que estoy aquí".
- Archivos de utilidad nuevos creados para una operación de una sola vez.
- El mismo comando de build/test ejecutado dos veces seguidas sin cambio
  intermedio.

## Verificación final

Tras todos los incrementos de una unidad:

- [ ] Cada incremento se verificó y confirmó individualmente.
- [ ] El conjunto de verificación completo del proyecto pasa (los comandos
      declarados, acotados o pesados según el contrato de verificación de
      la tarea).
- [ ] El comportamiento funciona de extremo a extremo según lo
      especificado.
- [ ] No quedan cambios sin commit; la evidencia referencia la identidad
      del commit.

## Ver también

- `work-unit-commits` — qué pertenece a cada commit.
- `chained-pr` — cuando el pronóstico total excede el presupuesto de
  porción revisable.
- `deprecation-and-migration` — porciones expand/contract para datos
  almacenados.
- `systematic-debugging` — cuando la verificación de una porción falla.
- `resources/references/definition-of-done.md` — la puerta permanente que
  todo incremento supera antes de declarar una tarea terminada.
