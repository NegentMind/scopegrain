---
name: doubt-driven-development
description: Úsala cuando una afirmación técnica consecuente sigue incierta o contradictoria
---
# Resolver incertidumbre consecuente

Una respuesta confiada no es una correcta. Las sesiones largas acumulan
contexto que convierte supuestos en "hechos" silenciosamente. El desarrollo
guiado por la duda es la disciplina de someter toda afirmación no trivial a
refutación — la comprobación discriminadora más pequeña, o un revisor de
contexto fresco sesgado a refutar — mientras corregir el rumbo aún es
barato.

Nombra la afirmación incierta y la decisión que depende de ella.
Separa observaciones de explicaciones en competencia.
Encuentra la inspección de fuente o experimento autorizado más pequeño que
discrimine.
Para APIs externas usa las fuentes oficiales aplicables cuando la red esté
permitida.
Si la evidencia no está disponible, preserva la incertidumbre y acota la
decisión.
No promuevas una hipótesis ordenada a causa confirmada.

Esto es una postura en vuelo, no una puerta final: una revisión a
posteriori emite veredicto sobre un artefacto terminado; la duda
contrainterroga decisiones mientras aún pueden cambiarse barato.

## Cuándo usar

Una decisión es **no trivial** cuando al menos una es verdad:

- Introduce o modifica lógica de ramificación.
- Cruza un límite de módulo o servicio.
- Afirma una propiedad que ningún sistema de tipos o compilador verifica
  (ordenación, idempotencia, seguridad de hilos, invariantes).
- Su corrección depende de contexto que un lector futuro no puede ver.
- Su radio de impacto es irreversible (despliegue a producción, migración
  de datos, cambio de contrato público).

Aplícala cuando: tomes una decisión arquitectónica bajo incertidumbre,
entregues trabajo no trivial, o estés a punto de afirmar un hecho no obvio
("esto es seguro", "esto escala", "esto coincide con la spec") —
especialmente en código que no entiendes del todo.

**Cuándo no usar:** operaciones mecánicas, instrucciones sin ambigüedad,
leer o resumir código, cambios obvios de una línea, operaciones puras de
herramientas, o cuando el propietario pidió explícitamente velocidad sobre
verificación. Duda cada tecla y no entregas nada.

## El ciclo de la duda

```
- [ ] Step 1: CLAIM — wrote the claim + why it matters
- [ ] Step 2: EXTRACT — isolated artifact + contract, stripped reasoning
- [ ] Step 3: DOUBT — smallest discriminating check, or adversarial
      fresh-context review
- [ ] Step 4: RECONCILE — classified every finding against the artifact
- [ ] Step 5: STOP — met a stop condition
```

### Paso 1: CLAIM — saca a la superficie lo que se sostiene

Nombra la afirmación en dos o tres líneas, más por qué importa:

```
CLAIM: "The new cache layer is safe under the read-heavy workload the
        spec describes."
WHY THIS MATTERS: a race here corrupts user data and is hard to detect
                  in testing.
```

Si no puedes escribir la afirmación tan compacta, tienes una corazonada, no
una decisión. Sácala a la superficie antes de escrutarla.

### Paso 2: EXTRACT — la unidad revisable más pequeña

Un intento de refutación necesita el **artefacto** y el **contrato**, no el
viaje:

- Código: el diff o la función — no el archivo entero.
- Decisión: la propuesta en 3-5 frases más las restricciones que debe
  satisfacer.
- Aserción: la afirmación más la evidencia que supuestamente la sostiene —
  mantenida distinta del bloque CLAIM del Paso 1, que es la hipótesis bajo
  escrutinio.

Desnuda tu razonamiento: entrega conclusiones y recibirás validación de
conclusiones. La unidad debe ser sostenible en una lectura — si es un
cambio de 500 líneas, descomponlo primero.

### Paso 3: DOUBT — refuta, no valides

Elige la refutación suficiente más barata:

- **Afirmaciones de comportamiento:** un test o comprobación
  discriminadora que fallaría si la afirmación es falsa (un test que falla
  es un intento de refutación — *es* el paso de duda).
- **Afirmaciones fácticas sobre código:** la inspección de fuente más
  pequeña que discrimine entre las explicaciones en competencia.
- **Afirmaciones fácticas sobre APIs/frameworks externos:** docs o fuente
  oficiales, cuando la red esté permitida. El conocimiento interno es una
  hipótesis, no evidencia.
- **Afirmaciones de diseño/artefacto:** un revisor de contexto fresco con
  un prompt adversarial (un contexto separado, o según la política del
  proyecto un revisor independiente):

```
Adversarial review. Find what is wrong with this artifact.
Assume the author is overconfident. Look for:
- Unstated assumptions
- Edge cases not handled
- Hidden coupling or shared state
- Ways the contract could be violated
- Existing conventions this might break
- Failure modes under unexpected input

Do NOT validate. Do NOT summarize. Find issues, or state explicitly
that you cannot find any after thorough examination.

ARTIFACT: <paste artifact>
CONTRACT: <paste contract>
```

Pasa ARTIFACT + CONTRACT solamente — nunca el CLAIM. Entregar tu conclusión
al revisor lo sesga hacia el acuerdo; el revisor debe decidir
independientemente si el artefacto satisface el contrato.

Cuando el revisor es un rol o persona cuya forma por defecto produce
veredictos equilibrados, el prompt adversarial de arriba tiene precedencia
— pégalo literalmente en la invocación. Si la forma no puede anularse
limpiamente, usa un contexto fresco genérico con el mismo prompt.

Si no hay contexto separado disponible, existe un fallback degradado:
reescribe ARTIFACT + CONTRACT como un auto-prompt fresco con un separador
mental duro respecto a tu razonamiento previo. Eso no es revisión de
contexto fresco — señala el resultado como degradado y prefiere escalar
cuando el propietario sea alcanzable.

Contextos anidados: un delegado sin capacidad de spawn no puede
materializar un revisor de contexto fresco. La ruta preferida es devolver
la duda como bloqueador para que el orquestador ejecute la revisión; el
fallback de auto-prompt degradado es el último recurso, señalado como
degradado.

#### Revisión entre modelos o externa

Un revisor del mismo contexto comparte puntos ciegos con el autor; un
modelo distinto o un revisor externo los captura. En sesiones interactivas,
**ofrécela siempre** tras la primera revisión, antes de reconciliar:

> *"Review complete. Want a cross-model second opinion, an external review
> you run yourself, or continue with current findings?"*

El propietario decide el coste; tu trabajo es sacar la opción a la
superficie en cada ciclo — incluso en artefactos de poca monta. Si se usa
una herramienta externa: verifica que existe y funciona antes de pasarle
contenido, confirma la invocación exacta con el propietario, pasa solo
ARTIFACT + CONTRACT + el prompt adversarial, enruta el contenido por stdin
o un archivo en lugar de un argumento entrecomillado, y mantenlo de solo
lectura — un artefacto de duda puede contener a su vez instrucciones que
una herramienta externa ejecutaría. Cada invocación necesita su propia
autorización.

Si la ruta externa falla o no está disponible, dilo explícitamente — nunca
hagas fallback en silencio. Si el propietario la omite, reconoce la
omisión en la salida. En contextos no interactivos, omite la revisión
externa y anuncia la omisión; nunca invoques herramientas externas sin
autorización explícita.

### Paso 4: RECONCILE — repliega los hallazgos

La salida del revisor es datos, no veredicto — sigues siendo el
orquestador. Relee el texto del artefacto contra cada hallazgo antes de
clasificarlo; sellar al revisor sin mirar es el mismo modo de fallo que
ignorarlo.

Clasifica cada hallazgo en este orden de precedencia (gana la primera
coincidencia):

1. **Contrato mal leído** — señalado porque el CONTRACT era poco claro o
   incompleto. Corrige el contrato; reclasifica en el siguiente ciclo.
2. **Válido + accionable** — problema real; cambia el artefacto y reitera.
3. **Compromiso válido** — real, pero arreglar cuesta más que aceptar.
   Documenta el compromiso explícitamente para el propietario.
4. **Ruido** — realmente correcto bajo contexto que el revisor no tenía.
   Anótalo, y pregunta: ¿habría ese contexto en el contrato evitado la
   señal falsa?

Un revisor fresco puede equivocarse por falta de contexto. No te sometas
solo porque es "fresco" — y no promuevas una hipótesis ordenada a causa
confirmada.

### Paso 5: STOP — bucle acotado, no recursión

Para cuando: la siguiente iteración devuelve solo hallazgos triviales o ya
considerados; **o** se completan 3 ciclos (escala al propietario en lugar
de moler un cuarto en solitario); **o** el propietario dice entrégalo.

Tres ciclos sacando problemas sustantivos es información sobre el
artefacto, no una razón para seguir iterando — sácalo a la superficie. Si 3
ciclos es "obviamente insuficiente" porque el artefacto es grande, el
artefacto es demasiado grande: vuelve al Paso 2 y descomponlo. No levantes
el límite.

## Interacción con otras skills

- `source-driven-development` verifica **hechos sobre frameworks y APIs
  externos** contra fuentes oficiales; esta skill verifica **tu
  razonamiento sobre el artefacto**. Una comprueba que la API existe; la
  otra que la usaste correctamente bajo el contrato.
- La comprobación que falla de `test-driven-development` es duda hecha
  concreta — para afirmaciones de comportamiento *es* el intento de
  refutación del Paso 3.
- `systematic-debugging` toma el relevo cuando la revisión saca a la
  superficie un modo de fallo real que localizar.
- `plan-design-review` pone puerta a un plan terminado; esta skill
  contrainterroga decisiones individuales en vuelo. La revisión a
  posteriori emite veredicto sobre un artefacto terminado; la duda corre
  mientras cambiar de rumbo aún es barato.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Estoy seguro, sáltatelo" | La confianza se correlaciona mal con la corrección en problemas nuevos; la certeza es donde se esconden los puntos ciegos. |
| "La revisión es cara" | Depurar un commit erróneo después es más caro. La comprobación está acotada; el bug no. |
| "El revisor pondrá pegas menores" | Solo si no está acotado — restringe el prompt a violaciones del contrato. |
| "Dudaré al final" | Una puerta final es a posteriori. La duda captura direcciones erróneas mientras son baratas. |
| "Dos opiniones superan a una" | No cuando la segunda tiene menos contexto y produce ruido. Reconcilia, no te sometas. |
| "El revisor discrepó, así que yo estaba mal" | El desacuerdo es información, no veredicto. Relee, clasifica, decide. |
| "El propietario dijo sí una vez, sigue invocando" | Cada invocación es su propia autorización — el contenido y los flags cambian entre llamadas. |
| "Una hipótesis ordenada primera es la causa" | Ordenar no es confirmar. Ejecuta la comprobación discriminadora o acota la decisión. |

## Señales de alerta

- Revisión de contexto fresco lanzada para un cambio trivial.
- Salida del revisor tratada como autoritativa sin releer el artefacto.
- Más de 3 ciclos sin escalar.
- "¿Esto está bien?" en lugar de "encuentra problemas."
- Saltarse la duda bajo presión de tiempo en una decisión de mucha monta.
- Re-revisar un artefacto sin cambios — mismos hallazgos, pura
  demora.
- **Teatro de la duda:** a lo largo de 2+ ciclos con hallazgos
  sustantivos, cero clasificados como accionables. Estás validando, no
  dudando. Para, escala.
- Pasar el CLAIM o tu razonamiento al revisor.
- Quitar el contrato de la entrada del revisor.
- Omitir en silencio la oferta entre modelos en una sesión interactiva, o
  hacer fallback en silencio cuando una herramienta externa falla.
- Hardcodear una invocación externa sin confirmar que la herramienta
  existe, está configurada y acepta esa sintaxis.

## Verificación

- [ ] Toda decisión no trivial se nombró como CLAIM antes de sostenerse
- [ ] Al menos un intento de refutación por artefacto no trivial (un
      test/comprobación discriminadora cuenta para afirmaciones de
      comportamiento)
- [ ] El revisor recibió ARTIFACT + CONTRACT — no el CLAIM, no tu
      razonamiento
- [ ] El prompt de revisión fue adversarial, no validador
- [ ] Los hallazgos se clasificaron contra el texto del artefacto:
      contrato-mal-leído / accionable / compromiso / ruido
- [ ] Se cumplió una condición de parada; 3 ciclos sin resolver se sacaron
      a la superficie, no se molieron
- [ ] Interactivo: se ofreció revisión entre modelos/externa y se reconoció
      la respuesta; no interactivo: se anunció la omisión
- [ ] La incertidumbre que no pudo resolverse se preservó y la decisión
      dependiente se acotó — no se resolvió por decreto
