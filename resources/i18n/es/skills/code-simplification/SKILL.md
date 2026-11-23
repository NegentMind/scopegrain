---
name: code-simplification
description: Úsala para eliminar duplicación o complejidad demostrada de un alcance de cambio aprobado
---
# Simplificación de código

## Disciplina central

Inspecciona el comportamiento, los llamadores y los modismos del proyecto
antes de elegir un cambio.
Identifica qué es realmente redundante y por qué su eliminación es segura.
Protege el comportamiento observable con comprobaciones de regresión
acotadas.
Prefiere una representación coherente más pequeña sobre una nueva capa de
abstracción.
No persigas objetivos arbitrarios de recuento de líneas, no reescribas
código no relacionado ni debilites la validación para que un diseño parezca
más simple.
Reporta comportamiento preservado, límites cambiados e incertidumbre
residual.

Simplifica reduciendo complejidad mientras preservas el comportamiento
exacto. El objetivo no son menos líneas — es código más fácil de leer,
entender, modificar y depurar. Toda simplificación debe pasar una prueba:
"¿Un miembro nuevo del equipo entendería esto más rápido que el original?"

## Cuándo usar

- Una funcionalidad funciona y las comprobaciones pasan, pero la
  implementación es más pesada de lo necesario.
- La revisión señala problemas de legibilidad o complejidad.
- Se encuentra lógica muy anidada, funciones largas o nombres poco claros.
- Lógica relacionada dispersa, duplicada o inconsistente tras fusiones.

**No para:**

- Código ya limpio — no simplifiques por simplificar.
- Código aún no entendido — comprende antes de simplificar.
- Rutas críticas de rendimiento donde la versión "más simple" es
  mediblemente más lenta.
- Código a punto de reescribirse por completo.

## Los cinco principios

### 1. Preservar el comportamiento exactamente

Cambia solo cómo se expresa el código, nunca lo que hace. Entradas, salidas,
efectos laterales, comportamiento de error y casos límite permanecen
idénticos.

```
ASK BEFORE EVERY CHANGE:
→ Same output for every input?
→ Same error behavior and ordering of side effects?
→ Do all existing checks pass WITHOUT modification?
```

Si una simplificación no puede demostrarse que preserva el comportamiento,
no la hagas.

### 2. Seguir las convenciones del proyecto

La simplificación alinea el código con la base de código, no con la
preferencia personal. Antes de editar, lee las convenciones del proyecto y
estudia cómo el código vecino maneja los mismos patrones — nomenclatura,
estilo de módulo, manejo de errores, profundidad de anotaciones. Una
simplificación que rompe la consistencia del proyecto es ruido, no
simplificación.

### 3. Preferir claridad sobre ingenio

Lo explícito supera a lo compacto cuando la versión compacta exige una
pausa mental.

```
UNCLEAR: const label = a ? 'A' : b ? 'B' : c ? 'C' : 'D';
CLEAR:   a named function with early returns per case.

UNCLEAR: a chained reduce that rebuilds a map inline.
CLEAR:   a named accumulator filled by a plain loop.
```

### 4. Mantener el equilibrio — evitar la sobre-simplificación

- **Inlinear demasiado agresivamente** — un helper que nombra un concepto
  ayuda a la lectura.
- **Combinar lógica no relacionada** — dos funciones simples fusionadas en
  una compleja no es más simple.
- **Eliminar abstracción "innecesaria"** — algunas abstracciones existen
  por extensibilidad o testabilidad, no por complejidad.
- **Optimizar para el recuento de líneas** — la velocidad de comprensión es
  la métrica.

### 5. Acotar a lo que cambió

Simplifica por defecto el código dentro del alcance de cambio aprobado.
Evita refactors de paso sobre código no relacionado; la simplificación sin
alcance crea diffs ruidosos y arriesga regresiones que nadie pidió.

## El proceso de simplificación

### Paso 1: Entender antes de tocar (la valla de Chesterton)

Nunca elimines lo que no puedes explicar. Si una valla cruza el camino y su
propósito se desconoce, encuentra el propósito antes de derribarla.

```
BEFORE SIMPLIFYING, ANSWER:
- What is this code's responsibility?
- What calls it? What does it call?
- What are the edge cases and error paths?
- Do tests define the expected behavior?
- Why might it have been written this way?
  (performance? platform constraint? historical reason?)
- What does the change history say about its original context?
```

Si no puedes responderlas, lee más contexto primero.

### Paso 2: Identificar oportunidades concretas

Cada patrón de abajo es una señal, no un olor vago.

**Complejidad estructural**

| Patrón | Señal | Simplificación |
|---|---|---|
| Anidamiento profundo (3+ niveles) | Flujo de control difícil de seguir | Cláusulas de guarda o helpers extraídos |
| Funciones largas (~50+ líneas) | Múltiples responsabilidades | Dividir en funciones nombradas y enfocadas |
| Ternarios anidados | Requiere una pila mental | Cadena if/else, switch o tabla de búsqueda |
| Flags booleanos como parámetros | `doThing(true, false, true)` | Objeto de opciones o funciones separadas |
| Condicionales repetidos | La misma comprobación en muchos sitios | Un predicado bien nombrado |

**Nomenclatura y legibilidad**

| Patrón | Señal | Simplificación |
|---|---|---|
| Nombres genéricos | `data`, `result`, `temp`, `item` | Renombrar para describir el contenido |
| Abreviaturas | `usr`, `cfg`, `evt` | Palabras completas salvo universales (`id`, `url`) |
| Nombres engañosos | `getX` que muta estado | Renombrar al comportamiento real |
| Comentarios de "qué" | `// increment counter` sobre `count++` | Eliminar — el código ya es claro |
| Comentarios de "por qué" | `// retry: API is flaky under load` | Conservar — intención que el código no expresa |

**Redundancia**

| Patrón | Señal | Simplificación |
|---|---|---|
| Lógica duplicada | Las mismas 5+ líneas en varios sitios | Extraer una función compartida |
| Código muerto | Ramas inalcanzables, variables sin uso | Eliminar tras confirmar que está muerto |
| Wrappers sin valor | Indirección que no aporta nada | Inlinear la llamada |
| Sobreingeniería | Fábrica-de-una-fábrica, estrategia de una sola estrategia | Reemplazar por el enfoque directo |
| Aserciones redundantes | Cast de un tipo ya inferido | Eliminar la aserción |

### Paso 3: Aplicar cambios incrementalmente

Una simplificación cada vez, verificada tras cada una:

```
FOR EACH SIMPLIFICATION:
1. Make the change
2. Run the scoped checks the repository declares
3. Green → commit (or continue)
4. Red → revert and reconsider
```

Nunca agrupes simplificaciones en un solo cambio sin probar — cuando algo
se rompe, el culpable debe ser identificable. **Regla de 500:** si un
refactor tocaría más de ~500 líneas, invierte en automatización (codemods,
transformaciones scriptadas) en lugar de ediciones manuales.

### Paso 3b: Disciplina de dos sombreros

Separa cambios de comportamiento de cambios de estructura en **commits
distintos** con la suite en verde entre ellos — el sombrero de
comportamiento (funcionalidad/corrección; la salida cambia) o el sombrero
de estructura (refactor; la salida idéntica), nunca ambos.

```
REFACTOR CHECK — before committing the structure hat:
1. Checks green before (baseline, unmodified)
2. Make structure-only changes
3. Run the SAME checks — must be green WITHOUT touching tests
4. A test needing edits → the change was behavior; split it out
```

Un "refactor" que requiere editar tests para pasar es un cambio de
comportamiento disfrazado. Mantén cada sombrero revisable por separado.

### Paso 4: Verificar el resultado

```
COMPARE BEFORE AND AFTER:
- Is the result genuinely easier to understand?
- Any new patterns inconsistent with the codebase?
- Is the diff clean and reviewable?
- Would a reviewer approve this as a net improvement?
```

Si la versión "simplificada" es más difícil de leer o revisar, reviértela.
No todo intento de simplificación tiene éxito.

## Sustituciones comunes

Victorias mecánicas que preservan comportamiento en cualquier lenguaje:

```
redundant boolean return:
  if (x) return true; return false;   →   return x;

manual filter loop:
  out = []; for i in items { if p(i) out.push(i) }
                                      →   items.filter(p)  // or comprehension

nested validation:
  if (a) { if (b) { work } else err } else err
                                      →   guard clauses + early errors, then work

unnecessary async wrapper:
  async f(x) { return await g(x) }    →   f(x) { return g(x) }

inline literal config:
  options = { sort: 'date' } each call →  hoist to a named constant
```

La forma difiere por lenguaje y framework — la prueba es siempre la misma:
comportamiento observable idéntico, comprensión más rápida.

## Contrato de salida

Una pasada de simplificación reporta:

- Qué patrones se encontraron y cuáles se aplicaron (con ubicaciones de
  archivo).
- Comportamiento preservado — las mismas comprobaciones, sin modificar, en
  verde antes y después.
- Límites cambiados, si los hay (helper nuevo, responsabilidad movida).
- Incertidumbre residual — cualquier cosa simplificada sin plena confianza
  en la intención del original (una valla de Chesterton dejada en pie se
  declara, no se oculta).

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Funciona, no hace falta tocarlo" | El código que funciona pero es difícil de leer es difícil de arreglar cuando se rompe. |
| "Menos líneas es siempre más simple" | Un ternario anidado de 1 línea no es más simple que un if/else de 5 líneas. |
| "Simplifico rápido también este código no relacionado" | Las ediciones sin alcance crean diffs ruidosos y arriesgan regresiones en otro lugar. |
| "Los tipos lo hacen autodocumentado" | Los tipos documentan estructura, no intención. Los nombres llevan el por qué. |
| "Esta abstracción podría ser útil después" | La abstracción especulativa es complejidad sin valor; elimínala. |
| "El autor original tendría una razón" | Quizá — revisa el historial. La complejidad acumulada suele ser solo residuo. |
| "Refactorizo mientras añado esta funcionalidad" | Los cambios mezclados son más difíciles de revisar, revertir y entender. Sepáralos. |

## Señales de alerta

- Una "simplificación" que requiere modificar tests para pasar (cambió el
  comportamiento).
- Salida más larga o más difícil de seguir que el original.
- Renombrados según preferencia personal en lugar de convenciones del
  proyecto.
- Manejo de errores eliminado "para dejar el código más limpio".
- Simplificar código no completamente entendido.
- Muchas simplificaciones agrupadas en un commit difícil de revisar.
- Validación debilitada o eliminada para que un diseño parezca más simple.
- Ediciones fuera del alcance aprobado sin petición del propietario.

## Verificación

- [ ] Todas las comprobaciones existentes pasan sin modificación.
- [ ] Build limpio, sin warnings nuevos; lint/format pasan.
- [ ] Cada simplificación es un cambio revisable e incremental.
- [ ] El diff está limpio — sin cambios no relacionados mezclados.
- [ ] El resultado sigue las convenciones del proyecto.
- [ ] Ningún manejo de errores eliminado o debilitado; sin código muerto
      dejado atrás.
- [ ] El informe declara comportamiento preservado, límites cambiados e
      incertidumbre residual — un revisor lo llamaría una mejora neta.

## Ver también

- `incremental-implementation` — una simplificación por porción verificada.
- `work-unit-commits` — cambios de comportamiento y de estructura se
  entregan como commits separados (disciplina de dos sombreros).
- `deprecation-and-migration` — cuando lo redundante es un sistema entero,
  no una función.
- `code-review-and-quality` — donde los hallazgos de complejidad suelen
  aparecer.
