---
name: clarify-intent
description: Úsala para convertir una idea de producto inicial en una petición de ingeniería acotada y comprobable
---
# Clarificar la intención

Refina una idea en bruto en una petición de ingeniería afilada, acotada y
comprobable mediante pensamiento divergente y convergente estructurado. Eres
un socio de ideación, no una máquina de decir sí: empuja hacia la versión más
simple que resuelve el problema real, desafía supuestos y haz explícitos los
compromisos.

Establece el usuario objetivo, el dolor actual, el resultado buscado y las
restricciones reales.
Inspecciona las funcionalidades existentes antes de proponer componentes
nuevos.
Separa el resultado mínimo útil de las extensiones opcionales.
Compara alternativas e identifica la suposición sin respuesta más arriesgada.
Pide una decisión cuando se necesita autoridad de producto.
Produce un contrato conciso, no una hoja de ruta de implementación sin
límites.

Esta skill posee la pasada de **ideación** divergente→convergente que
convierte una idea en bruto en una petición acotada. La mecánica de
entrevista que usa — hipótesis con suposición, una pregunta cada vez, la
sonda "¿qué querrías realmente?" — es canónica en `resolve-ambiguity`; este
archivo conserva solo el formato, no el razonamiento. Las alternativas de
nivel de diseño y la resolución pertenecen a `brainstorming`; la salida
alimenta `spec-driven-development` o `planning-and-task-breakdown`.

## Cuándo usar

- Una idea de producto o petición de funcionalidad en bruto necesita
  tomar forma antes de que alguien pueda planificarla o especificarla.
- La petición nombra una solución ("construye X") y el problema subyacente
  no se ha enunciado.

No la uses cuando la petición ya está acotada y es comprobable (ve a
`planning-and-task-breakdown` o `spec-driven-development`), o cuando lo que
bloquea es un dato ausente o una premisa enunciada — `resolve-ambiguity` y
`discernment-nudge` respectivamente.

## Restricción de carga

Esta skill necesita un propietario en vivo y receptivo. En contextos no
interactivos, registra las preguntas de intención sin resolver como
bloqueadores en el registro de tarea en lugar de adivinar.

## Fase 1: Entender y expandir (divergente)

**Objetivo:** tomar la idea en bruto y abrirla.

1. **Reformula la idea** como un enunciado de problema "¿Cómo podríamos?"
   nítido. Esto fuerza claridad sobre lo que realmente se está resolviendo.
   Mantenlo lo bastante estrecho para actuar, lo bastante amplio para
   permitir soluciones creativas, y libre de una solución embebida.

2. **Haz 3-5 preguntas afinadoras — no más.** Enfócate en:
   - ¿Para quién es esto, específicamente?
   - ¿Cómo se ve el éxito?
   - ¿Cuáles son las restricciones reales (tiempo, tecnología, recursos)?
   - ¿Qué se ha intentado antes? ¿Por qué ahora?

   Haz una pregunta cada vez, cada una con tu mejor suposición adjunta —
   mecánica según `resolve-ambiguity` (por qué la suposición, por qué de una
   en una, cómo sondear respuestas que señalizan convención):

   ```
   Q:     <one focused question>
   GUESS: <your hypothesis, with the reasoning that produced it>
   ```

3. **Genera 5-8 variaciones de la idea** usando estas lentes — elige las que
   encajen; no ejecutes cada lente mecánicamente:
   - **Inversión:** ¿y si hiciéramos lo contrario?
   - **Eliminación de restricciones:** ¿y si presupuesto/tiempo/tecnología
     no fueran factores?
   - **Cambio de audiencia:** ¿y si fuera para un usuario distinto?
   - **Combinación:** ¿y si se fusionara con una idea adyacente?
   - **Simplificación:** ¿cuál es la versión 10x más simple?
   - **Versión 10x:** ¿cómo se ve esto a escala masiva?
   - **Lente experta:** ¿qué encontraría obvio un experto del dominio?
   - **SCAMPER:** sustituir, combinar, adaptar, modificar, dar otros usos,
     eliminar, invertir.
   - **Primeros principios:** ¿qué supuestos son convención, no física?
   - **Jobs-to-be-done:** "Cuando [situación], quiero [motivación], para
     poder [resultado]." El competidor real es el apaño actual.
   - **Pre-mortem:** se entregó y fracasó — ¿por qué?

   Empuja más allá de lo pedido. Si estás dentro de una base de código,
   fundamenta las variaciones en lo que existe — lee el código relevante y
   referencia archivos y patrones concretos.

## Fase 2: Evaluar y converger

Tras la reacción del propietario (qué resuena, resistencias, contexto
añadido):

1. **Agrupa** las ideas que resuenan en 2-3 direcciones significativamente
   diferentes.

2. **Somete a prueba de estrés** cada dirección con tres criterios:
   - **Valor de usuario:** ¿quién se beneficia y cuánto? ¿Analgésico (agudo,
     frecuente, los usuarios cambian por él) o vitamina (agradable, no
     cambia comportamiento)? ¿Puedes nombrar 3 personas concretas con este
     problema — y qué hacen hoy?
   - **Viabilidad:** ¿cuál es la parte más difícil? ¿Dependencias que no
     controlas? ¿Hay una versión que aporte valor en días, no meses?
   - **Diferenciación:** ¿qué hace esto que nada más hace, en el orden:
     nueva capacidad > mejora 10x > nueva audiencia > nuevo contexto >
     mejor UX > más barato?

   Ordena las direcciones: alto valor + alta viabilidad primero; alto valor +
   baja viabilidad es un riesgo calculado; bajo valor + baja viabilidad se
   rechaza; la diferenciación desempata.

3. **Saca a la superficie supuestos ocultos — no omitas esto.** Para cada
   dirección, nombra explícitamente:
   - **Debe ser verdad** (rompedores de trato — valida antes de construir)
   - **Debería ser verdad** (importante — ajusta el enfoque si es falso)
   - **Podría ser verdad** (deseable — valida tras probar el núcleo)
   - Qué podría matar la idea; qué eliges ignorar y por qué.

**Sé honesto, no complaciente.** Si una idea es débil, dilo con
especificidad. Replica a la complejidad, cuestiona el valor real, señala
cuando el emperador va desnudo.

## Fase 3: Afilar y entregar

Produce un artefacto concreto — un documento de una página acotado que haga
avanzar el trabajo:

```markdown
# [Idea name]

## Problem statement
[One-sentence "How might we" framing]

## Recommended direction
[Chosen direction and why — 2-3 paragraphs max]

## Key assumptions to validate
- [ ] [Assumption — and how to test it]

## MVP scope
[Minimum version that tests the core assumption. In / out.]

## Not doing (and why)
- [Thing] — [reason]

## Open questions
[Unresolved — needs a decision before building]
```

**La lista de "No se hace" es la parte más valiosa.** El foco es decir no a
buenas ideas; haz explícitos los compromisos. Principios de MVP: un trabajo
bien hecho; la suposición más arriesgada probada primero; límite de tiempo,
no lista de funcionalidades; si la primera versión no se siente incompleta,
construiste de más.

Pregunta al propietario si persiste el documento en el destino configurado
del harness (ruta de research o decisiones de `.scopegrain/`). Guarda solo
con confirmación. El artefacto es un contrato para trabajo posterior —
aliméntalo a `spec-driven-development` o `planning-and-task-breakdown`, no
directamente a implementación.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "La idea ya está clara" | Si no puedes nombrar el usuario, el dolor y la restricción vinculante, no está clara — es plausible. Ejecuta la Fase 1. |
| "La divergencia pierde tiempo" | Veinte minutos de lentes evitan construir la cosa equivocada elegante — el modo de fallo más caro que existe. |
| "El propietario pidió X, así que X es" | La gente pide la respuesta convencional a su problema. El documento de una página prueba el problema, no solo la petición. |
| "Apoya la idea, están entusiasmados" | El entusiasmo no es evidencia. Una dirección débil nombrada ahora cuesta un párrafo; nombrada tras la construcción cuesta la construcción. |

## Señales de alerta

- Generar 20+ variaciones superficiales en lugar de 5-8 consideradas.
- Decir sí a ideas débiles en lugar de replicar con especificidad.
- Saltarse "¿para quién es esto?" — toda buena idea empieza con una persona
  y un dolor.
- Producir una dirección sin sacar supuestos — los supuestos no probados
  matan más ideas que la mala ejecución.
- Sobreingeniería del proceso — tres fases, cada una haciendo una cosa.
- Ignorar la base de código existente — su arquitectura es restricción y
  oportunidad.
- Saltar al documento de una página sin ejecutar divergencia y convergencia.

## Verificación

- [ ] Existe un enunciado de problema "¿Cómo podríamos?"
- [ ] Usuario objetivo y criterios de éxito definidos
- [ ] Se exploraron múltiples direcciones, no solo la primera idea
- [ ] Los supuestos están listados por clase (debe/debería/podría ser
      verdad) con estrategias de validación
- [ ] Una lista de "No se hace" hace explícitos los compromisos
- [ ] La salida es un artefacto persistido o explícitamente declinado, no
      solo conversación
- [ ] El propietario confirmó la dirección antes de cualquier trabajo
      posterior
