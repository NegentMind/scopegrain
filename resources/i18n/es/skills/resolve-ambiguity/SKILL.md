---
name: resolve-ambiguity
description: Usar cuando una ambigüedad consecuente permanece tras inspeccionar el proyecto y las decisiones disponibles
---
# Resolver ambigüedad

Lo que la gente pide y lo que realmente quiere son cosas distintas. Piden
"un dashboard" porque es la respuesta convencional, no porque resuelva su
problema. El momento más barato para cerrar esta brecha es antes de que
exista cualquier plan, spec o código: una vez que empieza la construcción,
los costos de cambio son reales y el desajuste se racionaliza como
"suficientemente bueno".

Deriva lo que la evidencia local ya responde antes de interrogar al dueño.
Haz una pregunta consecuente cada vez, con alternativas concretas, tradeoffs
y una recomendación cuando esté justificada. No pidas al dueño que
redescubra hechos de la fuente. Trata las preguntas omitidas como una
petición de usar juicio seguro, no como aprobación para una acción
destructiva o externa. Registra las elecciones aprobadas sin convertir
preferencias en concesiones de seguridad.

## Restricción de carga

Esta skill necesita un dueño vivo y receptivo. En contextos no interactivos
(CI, ejecuciones programadas, bucles autónomos), registra la ambigüedad como
bloqueo en el registro de tarea en lugar de adivinar.

## Cuándo usar

- A la petición le falta al menos uno de: **para quién** es, **por qué**,
  cómo se ve el **éxito**, o la **restricción** vinculante.
- La solicitud es convencional en lugar de específica ("constrúyeme X",
  "hazlo más rápido") y desempaquetarla requiere adivinar.
- Estás tentado de empezar sobre supuestos que no has sacado a la luz.
- Dos valores razonables están en tensión (simplicidad vs flexibilidad,
  velocidad vs costo) y el dueño no ha dicho cuál optimizar.

**Cuándo no usarla:** peticiones auto-contenidas sin ambigüedad, operaciones
mecánicas, solicitudes puramente informativas, o cuando ya puedes predecir
las respuestas del dueño: relee la condición de parada más abajo antes de
asumir que no puedes.

## Posición canónica

Esta skill es dueña de la **mecánica de entrevista** de la familia: hipótesis
con un número de confianza, una pregunta cada vez con una suposición adjunta,
la sonda de querer-vs-debería-querer, la reformulación y el sí explícito.
`clarify-intent`, `brainstorming`, `constraint-driven-development` y la
admisión de especificación en `spec-driven-development` ejecutan estas
mecánicas; sus archivos mantienen sus propios procedimientos y referencian
este.

Dentro del pipeline con puertas cambia la forma, no la sustancia:
`decision-request` agrupa las preguntas en **una ronda estructurada por
puerta** (Gates P/D/V/C) en lugar de una entrevista abierta: síguelo cuando
una puerta registrada es la razón por la que preguntas. Una premisa declarada
que debería ser cuestionada en lugar de sondeada se enruta a
`discernment-nudge`.

## El proceso

### Paso 1: Hipotetiza, con un número de confianza

Antes de preguntar nada, escribe tu mejor lectura en una frase más un número
de confianza honesto (0-100%):

```
HYPOTHESIS: You want a way to answer "how are we doing?" in standup, and
            "dashboard" was the convention that came to mind.
CONFIDENCE: ~30% — missing: who it is for, what "metrics" means here, what
            success looks like
```

El número fuerza honestidad. Si escribiste un número alto pero no puedes
predecir las reacciones a las siguientes tres preguntas que harías, el
número está mal. Por debajo de ~70%, añade una razón de una línea (qué sigue
sin resolver) para que el dueño sepa exactamente qué debe sacar a la luz la
entrevista.

### Paso 2: Una pregunta cada vez, cada una con una suposición adjunta

```
Q:     <one focused question>
GUESS: <your hypothesis for the answer, with the reasoning behind it>
```

Espera la reacción antes de la siguiente pregunta. Por qué de una en una: los
dueños no pueden reaccionar a hipótesis enterradas; los lotes fomentan la
lectura por encima; la tercera pregunta a menudo depende de la primera
respuesta; la atención es finita: gástala de a una pregunta. Por qué una
suposición: reaccionar a una suposición equivocada es más rápido que generar
una respuesta; te compromete a una hipótesis sobre la que puedes estar
visiblemente equivocado; expone *tus* supuestos, que es el punto.

El riesgo es un dueño educado que asiente por ser agradable. Mitígalo
mostrándote visiblemente dispuesto a equivocarte: de vez en cuando supón en
una dirección en la que esperas resistencia.

### Paso 3: Escucha "quiere" vs "debería querer"

Las respuestas más peligrosas suenan a lo que una respuesta sensata
*debería* ser: discurso de buenas prácticas sin especificidad ("escalable",
"arquitectura limpia"), deferencia a la convención ("el enfoque estándar"),
"probablemente debería…", buzzwords como objetivos. Cuando las oigas,
pregunta:

> *"Si no tuvieras que justificar esto ante nadie, ¿qué querrías realmente?"*

Esa única pregunta a menudo hace más trabajo que las cinco anteriores.

### Paso 4: Reformula la intención con las palabras del dueño

Cuando la confianza es alta, devuelve escrito lo que ahora crees que
quieren: 5-8 líneas, su lenguaje, estructurado para confirmar o corregir
línea por línea:

```
Here's what I now think you want:

- Outcome:      <one line>
- User:         <one line — who benefits>
- Why now:      <one line — what changed>
- Success:      <one line — how we know it worked>
- Constraint:   <one line — the binding limit>
- Out of scope: <one line — what we are explicitly not doing>

Yes / no / refine?
```

"Out of scope" es innegociable: la mitad del desalineamiento es desacuerdo
silencioso sobre lo que no se está construyendo.

### Paso 5: Confirma: sí explícito, no "lo que tú veas"

La puerta es un sí explícito. Estos **no** son un sí:

- "Lo que tú creas mejor." → Delegación, no decisión. Repregunta con dos
  opciones concretas planteadas como elección.
- "Suena bien." → Ambiguo. Pregunta "¿algo que ajustarías?" El silencio no
  es confirmación.
- "Claro, adelante." → A menudo una salida educada, no un respaldo. Mismo
  seguimiento.
- Silencio y luego "vale, empecemos." → El dueño abandonó la entrevista, no
  convergió. Para y pregunta qué se te escapó.

Integra las correcciones y reformula. Itera hasta un sí explícito.

### La condición de parada

Has terminado cuando puedes responder sí a:

> *¿Puedo predecir la reacción del dueño a las siguientes tres preguntas que haría?*

Esto es una prueba comprobable, no una corazonada, y tiene un piso: tras
varias rondas sin poder predecir, eso es información sobre la petición.
Para y dilo: "He hecho X preguntas y aún no puedo predecir tus reacciones.
Falta algo fundamental. ¿Damos un paso atrás?"

## Salida

El entregable es una **declaración de intención confirmada**: la
reformulación más un sí explícito. Las specs, los planes y los registros de
tarea son consumidores descendentes. Si la intención debe persistir entre
sesiones, ofrece guardarla bajo el destino `.scopegrain/` configurado;
guarda solo tras confirmación.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "La petición es suficientemente clara" | Si no puedes escribir el resultado deseado en una frase, no es clara. Ejecuta el Paso 1 primero. |
| "Las preguntas les hacen perder tiempo" | 4-6 preguntas dirigidas cuestan minutos; construir lo incorrecto cuesta días, que paga el dueño. |
| "Lo iré resolviendo mientras construyo" | Los costos de cambio tras existir código son 10x. El descubrimiento durante la implementación es retrabajo. |
| "Dijeron 'lo que tú veas', así que yo decido" | Delegación, no decisión. Repregunta con dos opciones concretas. |
| "Ofrecer opciones es mejor que preguntar" | Las opciones funcionan cuando el dueño sabe lo que quiere y elige trade-offs. Aquí aún no lo sabe: preguntar estrecha; las opciones ensanchan. |
| "Adjuntar mi suposición les sesga" | Sesgar es el punto: reaccionar supera a generar. El riesgo es la sycophancy; mitígalo mostrándote dispuesto a equivocarte. |
| "Ya hemos hablado bastante, lo tengo" | Pruébalo: ¿puedes predecir las próximas tres reacciones? Si no, no lo tienes. |
| "Dijeron sí, listo" | Un sí tras una reformulación vaga o un "suena bien" es hueco. Reformula concretamente y reconfirma. |

## Señales de alerta

- Tres o más preguntas en un mensaje: eso es loteo, no preguntar.
- Una pregunta sin tu hipótesis adjunta: sondeo, no compromiso.
- Aceptar "lo que tú creas mejor" como respuesta terminal.
- Producir una spec, plan o lista de tareas antes de la confirmación explícita.
- Aceptar respuestas que señalizan sofisticación ("escalable", "moderno") sin
  sondear lo que el dueño realmente quiere.
- Varias rondas con la confianza sin subir visiblemente: preguntas
  equivocadas; replantea.
- Un número de confianza bajo ~70% sin razón adjunta.
- Guardar el registro de intención antes de la confirmación.
- Omitir la línea "out of scope" en la reformulación.
- Convertir una preferencia declarada en autorización para una acción
  destructiva o externa.

## Verificación

- [ ] Una hipótesis explícita con un número de confianza abrió la entrevista
- [ ] Toda confianza sub-70% llevó una razón de una línea
- [ ] Las preguntas se hicieron de una en una, cada una con una suposición adjunta
- [ ] Al menos una sonda "¿qué querrías realmente?" se ejecutó cuando las
      respuestas señalizaron convención o sofisticación
- [ ] Se escribió una reformulación concreta (resultado / usuario / por qué
      ahora / éxito / restricción / fuera de alcance)
- [ ] El dueño confirmó con un sí explícito
- [ ] En el punto de parada, las siguientes tres reacciones eran predecibles
- [ ] Cualquier handoff descendente está enmarcado en la intención
      confirmada, no en la petición original subespecificada
