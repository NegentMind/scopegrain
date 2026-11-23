---
name: review-feedback
description: Usar al evaluar feedback de revisión y preparar una respuesta coherente y un lote de correcciones
---
# Puerta de calidad de feedback de revisión

Rastrea de forma segura el feedback de solicitud de cambios: resuelve
comentarios de revisión o conflictos de merge, valida los arreglos y pasa una
revisión cruzada de solo lectura antes de commitear o pushear cambios de
seguimiento.

## Cuándo usar

- Un PR/changeset tiene comentarios de revisión por resolver
- Conflictos de merge o comprobaciones pendientes necesitan trabajo
- Se necesita un seguimiento monitorizado tras una ronda de arreglos
- Estás preparando una respuesta coherente + lote de correcciones

## Procedimiento

1. **Inspecciona el estado primero.** Lee cada comentario de revisión, los
   veredictos de revisión, la mergeabilidad, el estado de checks, la rama
   destino y el estado del worktree local. Mantén los cambios locales no
   relacionados fuera del cambio.
2. **Aísla cuando haga falta.** Usa un worktree/rama aislada para arreglos
   de revisión o resolución de conflictos cuando el checkout principal esté
   sucio, por detrás del remoto u ocupado por otro agente.
3. **El arreglo seguro más pequeño.** Preserva el invariante del bug
   original y cualquier estructura upstream más nueva que la rama destino
   introdujo: resuelve conflictos conservando *ambas* intenciones, no
   aplanando un lado.
4. **Validación estrecha primero, luego las puertas requeridas.** Ejecuta la
   comprobación más estrecha que cubra el arreglo, luego las puertas
   declaradas del repositorio (`verify-work` quick → certify según exija el
   alcance). Bajo una política de ejecución manual, propón los comandos
   exactos y espera la salida: nunca declares comprobaciones no ejecutadas.
5. **Revisión cruzada de solo lectura antes de commit/push.** Envía el diff
   preparado o propuesto a un revisor con contexto nuevo mediante el
   mecanismo que el host provea: `independent-review` define el contrato del
   lado del revisor. A la revisión cruzada le están prohibidas las ediciones
   de archivos y los comandos git de escritura/coordinación: emite un
   veredicto, nada más.
6. **La revisión cruzada es evidencia, no autoridad.** Acepta solo hallazgos
   anclados en el diff, las reglas del proyecto, el objetivo del usuario o
   los resultados de validación. Degrada o rechaza preferencias de estilo,
   expansiones amplias de alcance y sugerencias que conflictúen con límites
   de seguridad o propiedad: registra brevemente la razón por cada hallazgo
   rechazado.
7. **Cierra el bucle honestamente.** Si quedan bloqueos aceptados: arregla,
   revalida, repite la revisión cruzada. Commitea y pushea solo después de
   que la validación pase y ningún bloqueo aceptado esté abierto; y el push
   en sí requiere autoridad explícita según la política del proyecto.

## Clasificación del feedback entrante

Separa cada comentario en:

- **Defecto verificado**: reprodúcelo o trázalo hasta un fallo ejecutable;
  arréglalo con un caso de regresión (según el patrón Prove-It de
  `test-driven-development`).
- **Riesgo válido**: no puede descartarse; arréglalo o conviértelo en un
  hallazgo rastreado con una aceptación explícita.
- **Preferencia sin respaldo**: sin mecanismo de defecto ni cita de regla;
  responde con una razón técnica para discrepar, o pregunta al revisor qué
  escenario de fallo la motiva.

Mapea el vocabulario de severidad entrante a los prefijos de
`code-review-and-quality` (Critical / Required / Optional / Nit / FYI) para
que el lote de respuesta conserve la escala propia del revisor.

Agrupa correcciones coherentes: arreglos del mismo archivo o mismo mecanismo
en un lote, cada uno con su caso de regresión exacto, preservando el alcance
aprobado. No expandas el alcance en silencio por "ya que estoy aquí".

## Responder a los revisores

Responde a cada comentario con uno de: **evidencia** (qué cambió, qué
comprobación lo prueba), una **pregunta sin resolver**, o una **razón
técnica para discrepar**. Nunca respondas "done" sin la comprobación que lo
prueba.

Mantén la discusión en la superficie de revisión. Las decisiones tomadas en
canales laterales (chat, llamadas, mensajes privados) se escriben de vuelta
al hilo de revisión: una resolución que solo vive en un medio privado no
existe para el siguiente revisor.

Enviar respuestas, pushear o cambiar el estado del PR requieren autoridad
explícita: ninguna está implícita en este procedimiento.

## Cadencia de monitoreo

- **Revisión activa o checks fallando:** comprueba con la frecuencia
  necesaria para desbloquear rápido.
- **Cambio limpio/aprobado esperando merge:** aproximadamente cada 12 horas.
- **Mergeado:** reduce a observación ligera diaria (CI, release, señales de
  regresión); deja de hacer cambios de código salvo petición.

## Racionalizaciones comunes

|| Racionalización | Realidad |
|||---|---|
|| "Aceptar cada comentario: es más rápido que discutir" | Las preferencias no verificadas se mergean como iguales a los defectos. Clasificación primero; el desacuerdo con una razón técnica es una resolución válida. |
|| "Este arreglo extra es pequeño, lo incluyo" | "Ya que estoy aquí" es cómo un arreglo de revisión se convierte en un cambio no revisado. Agrupa solo correcciones del mismo mecanismo dentro del alcance aprobado. |
|| "La revisión cruzada es una formalidad" | Es el último pase de ojos frescos antes de que el diff se entregue. Tratar sus hallazgos como sellables anula el paso: evalúa cada uno con evidencia. |
|| "La resolución del conflicto solo conserva nuestro lado" | Aplanar un lado borra la intención del otro. Conserva ambas intenciones; si realmente conflictúan, eso es una pregunta, no una edición. |
|| "Respondí a todos los comentarios: el trabajo está hecho" | Las respuestas sin validación ejecutada son afirmaciones. El bucle se cierra cuando los checks pasan y ningún bloqueo aceptado está abierto. |

## Señales de alerta

- Responder "done" sin el comando + salida que lo prueba.
- Resolver un conflicto de merge conservando solo la intención de un lado.
- Un lote de arreglos que expande silenciosamente el alcance más allá del
  cambio revisado.
- Revisión cruzada realizada por el mismo contexto que escribió el arreglo,
  reetiquetada como independiente: véase la regla de exención de
  `independent-review`.
- Aceptar hallazgos de revisión cruzada que no citan ninguna línea del diff,
  regla del proyecto o mecanismo de fallo: degrada y registra por qué.
- Pushear cambios de seguimiento mientras un bloqueo aceptado sigue abierto.
- Decisiones negociadas en canales laterales y nunca escritas de vuelta al
  hilo de revisión.

## Contrato de salida

Reporta siempre: estado actual del cambio, acciones realizadas, veredicto de
la revisión cruzada, hallazgos aceptados vs rechazados (con razones),
validación ejecutada, commits pusheados, comprobaciones omitidas con
razones, riesgos restantes y el siguiente paso.
