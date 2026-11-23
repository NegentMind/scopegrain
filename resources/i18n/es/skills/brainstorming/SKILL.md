---
name: brainstorming
description: Úsala antes de elegir un diseño de funcionalidad cuando los requisitos o compromisos siguen sin resolver
---
# Exploración de diseño

Convierte una idea en un diseño resuelto mediante diálogo colaborativo antes
de cualquier implementación. Parte del contexto del proyecto, haz preguntas
de una en una para refinar la idea, y presenta el diseño en secciones
pequeñas validadas.

Inspecciona si el comportamiento pedido ya existe y por qué se queda corto.
Enuncia el problema, las restricciones, los no-objetivos y los casos de
éxito.
Compara un conjunto pequeño de enfoques concretos incluido el más simple
viable.
Haz preguntas enfocadas solo para decisiones pendientes que sean
consecuentes.
Resuelve límites y aceptación antes de asignar la implementación.
Preserva la decisión aprobada en el espacio de trabajo del harness.

## Cuándo usar

- El problema se entiende pero el **diseño** no está resuelto — existen
  varios enfoques viables y hay que elegir uno antes de planificar.

No la uses cuando la idea de producto en bruto aún está sin formar (eso es
`clarify-intent` — ideación antes que diseño), cuando lo que bloquea es un
dato ausente y no una elección de diseño (eso es `resolve-ambiguity`), o
cuando el diseño ya está resuelto (ve directo a `writing-plans`).

Esta skill posee el diálogo de resolución de diseño: alternativas comparadas
y secciones validadas incrementalmente. La mecánica de entrevista sobre la
que funciona — hipótesis con suposición, una pregunta cada vez, confirmación
explícita — es canónica en `resolve-ambiguity`.

## El proceso

### Entender la idea

- Revisa primero el estado actual del proyecto — archivos, docs, decisiones
  recientes.
- Haz preguntas **de una en una**. Los lotes fomentan la lectura superficial
  y respuestas a nivel de superficie; la tercera pregunta suele depender de
  la primera respuesta.
- Prefiere preguntas de opción múltiple con una opción recomendada; la
  pregunta abierta es aceptable cuando las opciones genuinamente no se
  pueden enumerar.
- Enfócate en: propósito, restricciones, criterios de éxito, no-objetivos.

### Explorar enfoques

- Propón 2-3 enfoques significativamente diferentes con compromisos — no
  variaciones sobre un mismo tema.
- Encabeza con tu recomendación y el razonamiento detrás de ella.
- Incluye siempre el enfoque más simple viable; la complejidad debe ganarse
  su lugar.

### Presentar el diseño incrementalmente

- Divide el diseño en secciones de ~200-300 palabras.
- Tras cada sección, pregunta si se ve bien hasta ahí. No vuelques todo el
  diseño de golpe — un "no" tardío desperdicia todo lo posterior al punto
  de divergencia.
- Cubre: arquitectura, componentes, flujo de datos, manejo de errores,
  enfoque de verificación.
- Vuelve atrás y aclara siempre que una sección no aterrice. Iterar una
  sección es normal, no un fallo.

## Después del diseño

- Escribe el diseño validado en el destino configurado del harness
  (ruta de planes o decisiones de `.scopegrain/` según la configuración del
  proyecto), solo después de que el propietario lo confirme.
- Para la implementación, pasa a `writing-plans` para el plan ejecutable y a
  `planning-and-task-breakdown` para la descomposición en tareas. Pregunta
  antes de continuar — un diseño aprobado no es autorización para construir.

## Principios clave

- **Una pregunta cada vez** — nunca abrumes con un cuestionario.
- **YAGNI sin piedad** — elimina funcionalidades innecesarias de cada
  diseño.
- **Explora alternativas** — siempre 2-3 enfoques antes de decidir.
- **Validación incremental** — secciones, no documentos.
- **Sé flexible** — revisita secciones anteriores cuando respuestas
  posteriores las contradigan.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Ir directo a planificar" | Un diseño sin resolver dentro de un plan se convierte en retrabajo dentro de un diff. Resuelve el enfoque mientras cambiarlo es gratis. |
| "Preguntar todo por adelantado" | Los lotes se leen por encima y se responden superficialmente; la tercera pregunta suele depender de la primera respuesta. |
| "Presentar el diseño entero de una vez" | Un "no" tardío desperdicia cada sección tras el punto de divergencia. La validación incremental acota la pérdida. |
| "Un enfoque, bien contado" | Una sola opción oculta los compromisos que el propietario tiene derecho a sopesar — compara siempre, incluye siempre el más simple viable. |

## Señales de alerta

- Hacer varias preguntas en un mismo mensaje.
- Presentar un diseño completo sin validación sección por sección.
- Un enfoque ofrecido como única opción.
- Diseño guardado antes de que el propietario lo confirme.
- Pasar a implementación sobre la sola fuerza de un diseño escrito.

## Verificación

- [ ] El comportamiento existente y sus carencias se inspeccionaron antes de
      proponer
- [ ] Se compararon dos o tres enfoques significativamente diferentes —
      incluido el más simple viable — con una recomendación declarada
- [ ] El diseño se presentó y confirmó sección por sección, no se volcó
- [ ] Límites, no-objetivos y aceptación se resolvieron en el diálogo
- [ ] El registro del diseño se persistió solo tras la confirmación del
      propietario
- [ ] El traspaso a implementación se preguntó, no se asumió
