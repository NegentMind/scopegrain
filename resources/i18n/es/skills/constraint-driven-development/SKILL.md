---
name: constraint-driven-development
description: Úsala cuando un cambio debe preservar invariantes explícitos de producto, seguridad, compatibilidad u operación
---
# Registro de restricciones

La prosa sobre cómo se ve "lo bueno" no sobrevive a la sesión y no es
comprobable. Esta skill produce un registro escrito del listón del proyecto
— con números, propietarios y los comandos que producen cada veredicto —
que sobrevive a la conversación y puede comprobarse mecánicamente. Un agente
escribe más en una tarde de lo que cualquiera lee en una semana; el juicio
se traslada a comprobaciones que corren en el bucle.

Identifica restricciones desde fuentes autoritativas del proyecto y
decisiones del propietario.
Separa invariantes duros, preferencias, supuestos e incógnitas.
Mapea cada restricción dura a las interfaces afectadas y a una comprobación
o brecha explícita.
Diseña el cambio más pequeño que las satisface sin excepciones ocultas.
Reporta requisitos en conflicto en lugar de debilitar uno en silencio.
Mantén el registro con la tarea, no disperso por la documentación de
producto.

La especificación dice qué construir; los tests prueban que funciona; el
registro de restricciones define qué significa "suficientemente bueno para
entregar" — antes de que nadie discuta sobre ello en revisión. División:
esta skill posee el listón **de todo el proyecto** y sus ratchets;
`outcome-driven-development` posee el contrato de resultado por unidad y las
clases de evidencia; `spec-driven-development` posee el contrato de cambio
para una funcionalidad concreta.

## Cuándo usar

- Un proyecto o funcionalidad significativa empieza sin un listón de calidad
  escrito.
- El propietario pide "configurar restricciones", "definir estándares" o
  "dejar de entregar basura".
- Se produce volumen más rápido de lo que cualquiera lee.
- Existen comprobaciones pero nadie sabe decir cuáles bloquean y cuáles son
  decoración.
- Los umbrales se rediscuten por cambio en lugar de decidirse una vez.
- Se planifica una ejecución autónoma y la única puerta es una suite que el
  propio agente escribió.

**Cuándo no usar:** ya existe un registro y no está cambiando (léelo y
síguelo); spikes de una sola vez y prototipos desechables; un cambio
necesario ahora mismo sin ninguna cuestión de listón adjunta. Un suelo
mínimo sigue valiendo la pena incluso para código efímero.

## Restricción de carga

La toma de datos necesita un propietario en vivo. En contextos no
interactivos, aplica el suelo de abajo, anota que lo hiciste, y señala el
resto para un humano.

## Paso 1: Detecta antes de preguntar

Nunca preguntes lo que puedes leer. Antes de la primera pregunta, recopila:

| Qué | Dónde mirar |
|------|---------------|
| Lenguaje y stack | archivos de paquete/manifiesto |
| Runner de tests | dependencias de desarrollo, scripts de test, tests existentes |
| Linters/formatters existentes | configuraciones de linter y formatter |
| Cobertura/calidad actual | informes existentes, o ejecuta la suite una vez |
| Pipeline de CI | archivos de configuración de CI |
| Reglas de agente/proyecto | AGENTS.md, CLAUDE.md, política del harness |

Reporta lo encontrado en dos líneas, luego pregunta solo lo que falte.

## Paso 2: Cuatro preguntas, cada una con un valor por defecto

Una pregunta cada vez, cada una llevando una suposición y un valor por
defecto para que "no sé" sea una respuesta completa — la mecánica de
preguntas es canónica en `resolve-ambiguity`:

```
Q1: Beyond the floor, which dimensions do you want enforced?
    (a) coverage on new code  (b) security scanning
    (c) performance budgets   (d) accessibility   (e) architecture boundaries
GUESS: (a) and (b) — there is a test runner and user input is handled.
DEFAULT: (a) and (b). State each pick's cost: (c)/(d) need a running URL;
         (e) needs a written rules file.
```

```
Q2: When a check fails mid-task, block or warn?
GUESS: Block — an unread warning is a warning nobody reads.
DEFAULT: Block on the floor; warn on the rest for the first two weeks.
```

```
Q3: Target numbers in mind, or measure today and hold that line?
GUESS: Measure — an invented number gets ignored.
DEFAULT: Measure and hold (see Ratchets).
```

```
Q4: Slowest check tolerated before work is handed back?
GUESS: ~90 seconds — longer and it stops being run.
DEFAULT: 90s at task end; unlimited in CI.
```

Para en cuatro. Una toma de datos de doce preguntas produce un registro que
nadie entiende.

## Paso 3: Escribe el registro

Un archivo en un destino aprobado — un archivo de restricciones del
proyecto cuando el proyecto quiere el listón en espacio de producto
revisable, si no, bajo la ruta de decisiones configurada de `.scopegrain/`
o adjunto al registro de tarea que lo gobierna. Dondequiera que viva, un
cambio en él debe ser visible y revisable.

```markdown
# Constraints

Last reviewed: <date> by <owner>

## Floor (always enforced, no setup required)
- No new suppression comments (ignore/disable pragmas of any ecosystem)
- No unimplemented stubs: throws "not implemented", empty catch blocks
- No skipped or deleted tests without a reason in the commit message
- No secrets in source
- This file does not get weakened to make a change pass

## Enforced with numbers
| Dimension | Rule | Checked by | Runs at |
|-----------|------|-----------|---------|
| Types | zero type errors | `<typecheck cmd>` | every edit |
| Lint | zero errors from project config | `<lint cmd>` | every edit |
| Secrets | none in source | `<scanner> --redact` | every edit |
| Coverage | changed lines ≥ 80% | `<test cmd> --coverage` + diff | task end |
| Security: deps | nothing high or above | `<dep scanner>` | CI |

## Measured, not yet enforced
| Metric | Today | Direction |
|--------|-------|-----------|
| Project coverage | 62.4% | must not fall |

## Exceptions
| ID | Rule | Path | Reason | Owner | Expires |
|----|------|------|--------|-------|---------|
| W1 | <rule> | <path> | <tracked fix> | <owner> | <date> |
```

Cada fila de "Checked by" nombra el comando que produce el veredicto. Una
dimensión con un número y sin comando es una aspiración, no una restricción.
Luego añade una línea a los archivos de instrucciones de agente del proyecto
apuntando al registro: "Read the constraints before writing code. Do not
weaken them to make a change pass."

## Paso 4: Instala lo que cada dimensión necesita

Elegir una dimensión significa instalar un mecanismo — no entregues al
propietario un número sin comprobador, y no inventes un comprobador cuando
existe uno de facto (los formatos de reglas y umbrales del ecosistema son lo
que otras herramientas apuntan):

| Dimensión | Mecanismo típico | Puerta sobre |
|-----------|-------------------|---------|
| Tipos | el typechecker del stack | cualquier error |
| Lint | configuración de proyecto existente | cualquier error |
| Cobertura | runner de tests existente + intersección con el diff | líneas cambiadas |
| Seguridad: código | un escáner de conjuntos de reglas | cualquier hallazgo alto |
| Seguridad: secretos | un escáner de secretos con redacción | cualquier hallazgo |
| Seguridad: deps | un escáner de base de datos de vulnerabilidades | alto o superior |
| Rendimiento: página | una herramienta de métricas de laboratorio sobre una URL en ejecución | presupuestos acordados |
| Rendimiento: bundle | una herramienta de límite de tamaño | presupuesto de bytes por entrada |
| Accesibilidad | un comprobador axe/WCAG sobre una URL en ejecución | cero críticos/graves |
| Arquitectura | un comprobador de límites de dependencia | cualquier violación |
| Calidad de aserciones | mutation testing, acotado al diff | puntuación de mutación |

Cinco cosas que muerden si se omiten:

1. **La redacción no es opcional** en el escaneo de secretos — reporta la
   regla y la ubicación, nunca el valor; un secreto filtrado en una
   transcripción se propaga.
2. **Las comprobaciones de runtime necesitan un objetivo en ejecución.** Si
   el proyecto no tiene URL — un CLI, una biblioteca — dilo y descarta la
   dimensión en lugar de inventar una comprobación que no puede correr.
3. **Acota las comprobaciones caras al diff.** Horas sobre el repo completo
   se desactivan; menos de un minuto sobre archivos tocados sobrevive.
4. **La cobertura no necesita una segunda ejecución** — intersecta el
   informe que la suite ya escribe con el diff.
5. **Comprueba licencias antes de redistribuir paquetes de reglas**;
   prefiere el formato que el ecosistema ya usa.

Cablea los comandos en la superficie de scripts propia del proyecto para
que sean reproducibles sin un agente: un `check:fast` (tras una edición),
`check:task` (cuando el trabajo se cree terminado), `check:full` (CI). El
registro es canónico — los scripts lo reflejan, y si divergen, el archivo
gana.

## Paso 5: Cablea al ciclo de vida

El mayor error es ejecutar todo en todas partes — una comprobación que
frena al agente se desactiva, y una puerta desactivada es peor que ninguna
porque el listón sigue pareciendo existir.

| Fase | Qué corre | Presupuesto |
|-------|-----------|--------|
| Edición | tipos, lint, secretos, el suelo | segundos, solo archivos cambiados |
| Fin de tarea | tests relacionados, cobertura sobre líneas cambiadas | ~90s |
| Revisión | todo, más las guardas de debilitamiento de abajo | minutos |
| Entrega | comprobaciones de dirección, sin regresiones | CI |

Dos reglas lo mantienen tolerable: **acota al diff** (las líneas cambiadas
son un número que el agente puede mover; los números del proyecto se
heredan) y **el coste decide la ubicación** (cualquier cosa por encima de
unos segundos sale del bucle de edición).

## Paso 6: Guarda el propio listón

Si el agente escribe el código y las comprobaciones, las comprobaciones
pueden manipularse — no con ingenio, sino por el camino más barato al
verde. Vigila el diff en busca de cinco movimientos:

1. **El umbral se movió** — un presupuesto bajado, una gravedad rebajada,
   una comprobación eliminada de la fase rápida. Diff del registro contra
   su punto de rama.
2. **Un test se hizo más fácil** — un skip añadido, un archivo de test
   eliminado, aserciones retiradas de tests que se quedaron.
3. **Un comprobador se silenció** — nuevos comentarios de supresión,
   incluidos los silenciosos: pragmas de exclusión de cobertura,
   mutation-disable, comentarios scanner-ignore.
4. **El trabajo está sin terminar** — un stub que lanza, un `catch` vacío,
   un `TODO` donde pertenece una implementación.
5. **Apareció una excepción** — una fila nueva de Exceptions que nadie
   discutió.

Nada de esto necesita más que un diff. Endurecer el listón debería ser
silencioso; aflojarlo debería ser ruidoso. Como el suelo no tiene
herramienta de facto, usa una guarda de suelo de referencia (acotada al
diff, códigos de salida `0` limpio / `1` violación / `2` no-pudo-ejecutar —
nunca dejes que un `2` se lea como `0`; extiende solo las listas de patrones
por ecosistema) en lugar de fabricar una nueva cada vez.

**No todas las comprobaciones son igual de circulares.** Ordena por: ¿puede
el agente pasarla escribiendo código que no funciona?

- **Externa** — un comprobador que codifica un estándar o base de datos
  externa; el agente no puede discutir con él.
- **De proyecto** — tus reglas de lint, tus límites; un humano posee el
  archivo.
- **De suite** — tus propios tests; la más útil y la única genuinamente
  circular.

Un listón hecho enteramente del tercer tipo vale menos. Exige al menos una
restricción externa.

## Paso 7: Ratchets, cuando no hay número

Fijar 80% de cobertura en una base de código al 62% produce un build rojo
eterno y un equipo que aprende a ignorar el rojo. En su lugar: registra el
valor de hoy con una dirección ("must not fall") en "Measured, not yet
enforced." Cada comprobación compara contra el valor registrado; los
números que mejoran se actualizan, las caídas son el hallazgo. Una
tolerancia de ratchet de ~0.5% absorbe deriva de archivos no relacionados.

## Valores por defecto sensatos

| Restricción | Valor por defecto | Por qué |
|------------|---------|-----|
| Cobertura de líneas cambiadas | ≥ 80% | Fuerza un test, permite líneas de config |
| Cobertura del proyecto | valor de hoy, must not fall | Adoptable sin discusión |
| Puntuación de mutación (si se usa) | ≥ 60% al inicio | Típico para una suite sin mutar |
| Vulnerabilidades de dependencias | nada alto o superior | Por debajo es mayormente ruido |
| Vida de una excepción | 90 días | Bastante para arreglar, bastante corto para recordar |
| Tolerancia de ratchet | 0.5% | Absorbe deriva no relacionada |

Declara el número y la razón juntos — un umbral sin justificación lo borra
la siguiente persona que lo encuentra.

## Ruta de escalado

1. **Solo escrito** — el registro existe y se lee. Captura errores
   honestos.
2. **Scriptado** — un script `check` cableado al bucle de edición y CI.
3. **Respaldado por herramienta** — un runner dedicado manejando el
   alcance al diff, presupuestos, ratchets y las guardas de debilitamiento.

La mayoría de los proyectos se paran en 2. Una primera ejecución puede ser
solo de suelo: la guarda de suelo está acotada al diff y no necesita
instalaciones, así que el suelo puede aplicarse desde el primer día
mientras las dimensiones numeradas se añaden por herramienta instalada.

## Racionalizaciones comunes

| Excusa | Realidad |
|--------|---------|
| "Añadir restricciones cuando el código se asiente" | El código se asienta alrededor de lo que se le permitió mientras se movía. |
| "Los tests son las restricciones" | Los tests que escribiste prueban que estás de acuerdo contigo mismo — nada sobre cobertura de código nuevo, riesgo de dependencias o crecimiento. |
| "No podemos llegar al 80%" | Entonces no fijes 80%. Fija el número de hoy y mantenlo. |
| "Esto frena al agente" | Solo si las comprobaciones lentas están en el bucle rápido — un error de ubicación, no un argumento. |
| "Recordaré nuestros estándares" | El agente no lo hará, y es quien escribe la mayoría del código. |
| "Las restricciones bloquean la entrega" | Una excepción con propietario y fecha te desbloquea; borrar la restricción desbloquea a todos para siempre. |

## Señales de alerta

- La toma de datos pasó de cuatro preguntas o produjo un registro que el
  propietario no puede explicar.
- Un presupuesto fijado que la base de código falla hoy, sin plan para
  alcanzarlo.
- Una dimensión escrita con un número y sin herramienta detrás.
- Un comprobador fabricado a mano donde existe uno de facto.
- Toda restricción juzgada por la suite propia del proyecto — ninguna
  opinión externa.
- El registro cambiado en el mismo commit que la funcionalidad que estaba
  fallando.
- Una excepción sin propietario, o con caducidad a un año vista.
- Una relajación de umbral propuesta en lugar de una corrección.
- Comprobaciones lentas en el bucle de edición y `--no-verify` apareciendo.
- Nadie ha abierto el registro desde que se escribió.
- Un invariante duro y una preferencia tratados silenciosamente como lo
  mismo, o un conflicto entre requisitos resuelto debilitando uno en
  silencio.

## Verificación

- [ ] El registro existe; cada número tiene una razón declarada
- [ ] El suelo se aplica y pasa sobre el código actual sin cambios
- [ ] Cada dimensión elegida tiene una herramienta y un comando que corre
      hoy
- [ ] Cada restricción dice dónde corre; la fase rápida se mantiene bajo
      unos segundos
- [ ] Al menos una restricción es externa
- [ ] Las métricas solo-medidas registran el valor de hoy y una dirección
- [ ] Las excepciones tienen propietario y caducidad
- [ ] Las instrucciones de agente del proyecto apuntan al registro
- [ ] Una ejecución de prueba no produjo fallos con los que el propietario
      discrepe
