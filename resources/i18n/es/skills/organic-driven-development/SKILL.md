---
name: organic-driven-development
description: Usar para solicitudes de ingeniería a fin de establecer autoridad, inspeccionar el comportamiento existente, resolver incertidumbre y seleccionar trabajo ligero o SDD proporcionado.
---
# Organic Driven Development

ODD significa Organic Driven Development en Scopegrain. Los resultados
observables son criterios de aceptación; Observability-Driven es una
capacidad opcional separada.

Esta skill es dueña de la **admisión y selección de ruta**: establecer la
autoridad, verificar que la solicitud es real y elegir la ruta proporcionada:
una tarea ligera acotada o la cadena formal SDD. Canon descendente:
`outcome-driven-development` (el contrato de resultados),
`spec-driven-development` (la cadena formal de documentos),
`contract-execution` (el ciclo de vida por tarea), `plan-coordination`
(orquestación y delegación). Los prompts `plan-brief` y `plan-execution`
operacionalizan las secuencias de triaje y ejecución siguientes.

1. Establece la intención y la autoridad. Las explicaciones, investigaciones
   y propuestas permanecen en solo lectura. No reinterpretes una pregunta
   como permiso para implementar.
2. Inspecciona el comportamiento y las convenciones existentes antes de
   proponer un cambio. Acota el primer lote de exploración a lo que demuestra
   que el cambio está comprendido: unas pocas lecturas dirigidas o una ronda
   de búsqueda enfocada, y amplía solo ante una brecha nombrada. Extiende la
   costura existente; no dupliques una API ya implementada.
3. Resuelve la incertidumbre nombrada con evidencia de la fuente o
   investigación pública autorizada. Orden de decisión: continúa cuando no
   queda ninguna decisión humana; pregunta mediante una herramienta
   estructurada compatible cuando se requiere una decisión (el contrato de
   puerta es canónico en `decision-request`; el oficio de entrevista en
   `resolve-ambiguity`); usa texto plano solo para aclaraciones
   genuinamente abiertas; agrupa decisiones ordinarias independientes donde
   el host lo admita; espera la respuesta. Omitir, declinar o una respuesta
   personalizada no autoriza trabajo silenciosamente.
4. Clasifica usando comprensión, riesgo y reanudabilidad, no número de
   archivos o líneas. Aplica la prueba de reanudación: el trabajo ligero es
   lo que un contexto nuevo podría terminar solo a partir de la solicitud
   original más el diff actual (`diff-sufficient`); cualquier cosa cuya
   justificación se perdería al reiniciar es `record-required`. El riesgo
   desconocido o la incertidumbre sin resolver bloquea la implementación. El
   riesgo nombrado usa la ruta formal aunque el diff sea pequeño: (1) datos
   irreversibles o efectos externos → `data-integrity` /
   `external-effects`; (2) superficie de seguridad → `security`; (3)
   contratos públicos → `public-contract`; (4) concurrencia → `concurrency`;
   (5) entrega y entorno → `delivery`; (6) ninguna comprobación existente
   detectaría la regresión → `verification-gap`.
5. Registra antes de la primera escritura: abre el registro de tarea acotado
   antes de cambiar código fuente, no después. Preserva la solicitud original
   verbatim, el alcance, la justificación de la clasificación y la evidencia
   real. Para trabajo ligero no añadas documentos de
   especificación/diseño/aprobación solo para imitar la ruta formal. El
   trabajo sustancial o sensible usa SDD con bindings explícitos, propiedad
   de escenarios y aprobaciones.
6. Implementa la unidad autorizada coherente más pequeña en porciones de
   unidad de trabajo revisables. Reproduce el comportamiento con un test
   causal que falle cuando exista un runner determinista. Reporta las
   excepciones en lugar de inventar un RED, un runner, una herramienta o una
   prueba. Ejecuta comprobaciones solo con autorización real; no ejecutes
   scripts descubiertos en el proyecto implícitamente.
7. Revisa el diff completo y la evidencia cruda de forma proporcionada al
   riesgo; el límite de revisión es una porción de unidad de trabajo
   terminada, no la funcionalidad acumulada. Obtén una revisión independiente
   nueva o la exención explícita y acotada del dueño requerida por la política
   del proyecto. Cierra solo la tarea cubierta y reporta el resultado en
   cuatro partes: implementado, verificado, pendiente, siguiente paso,
   incluyendo fallos, impacto desconocido y continuación.

Delega solo trabajo resuelto y acotado cuando sea útil y el host lo admita:
los disparadores de delegación, el contenido del brief y el contrato de
retorno son canónicos en `plan-coordination`. Pasa localizadores inmutables de
solicitud/spec y estado de ejecución en lugar de resúmenes que alteren los
requisitos. Un rol o una etiqueta de contexto distinta no es autenticación.
Ni la ruta ligera ni un test exitoso autorizan instalación, publicación,
modelos de pago, efectos destructivos o la siguiente tarea.

Si las puertas de ejecución requeridas no están disponibles, declara ese
límite y pide la capacidad faltante. Nunca presentes una instrucción como
intercepción nativa de herramientas.

## Verificación de realidad (antes de aceptar trabajo)

Antes de clasificar o planificar una tarea, verifica que es real contra el
código: no confíes en una descripción escrita:

1. **Extrae referencias**: rutas de archivo, símbolos, endpoints, contratos
   públicos nombrados en la solicitud.
2. **Verifica en el código**: ¿existen? ¿La brecha descrita es real, o el
   comportamiento ya está implementado? ¿Qué lo llama (radio de impacto)?
   ¿Los documentos referenciados coinciden con el código?
3. **Clasifica la puerta:**

| Evidencia | Puerta |
|----------|------|
| Referencias existen + brecha de comportamiento real + cambio acotado | DO |
| Referencias existen pero brecha ambigua, o esfuerzo ≫ impacto | DEFER |
| Referencias ausentes, comportamiento ya implementado, o hecho en otro lugar | SKIP |
| Depende de trabajo que no está listo o está bloqueado | BLOCKED |
| No se puede verificar sin investigación | registra la incertidumbre; DO solo si el impacto lo justifica |

4. **Escribe la evidencia en el registro**: la verificación es parte del
   contrato: "el símbolo X existe en `path:line`, brecha confirmada en
   `func`, llamantes: `a`, `b`."

### Pre-mortem (antes de comprometer esfuerzo)

Para cada DO candidato, lista los 2-3 modos de fallo más probables: la ruta
caliente equivocada asumida, una dependencia externa no verificable, un
llamante fuera del radio de impacto mapeado. Un modo de fallo de alta
probabilidad y alto impacto degrada la puerta a DEFER o aterriza en el
registro de riesgos como riesgo vivo.

### Condiciones de parada (declaradas antes de empezar)

El **apetito** es el tiempo deliberadamente invertido en este trabajo,
declarado antes del diseño: tiempo fijo, alcance variable (Shape Up). No es
una estimación: una estimación parte de un diseño y produce un número; un
apetito parte de un número y restringe el diseño. El alcance que no quepa en
el apetito se reduce o se re-triaje, nunca se sobrepasa silenciosamente.

| Condición de parada | Disparador | Acción |
|---|---|---|
| Apetito excedido | tiempo invertido > apetito declarado | abortar → reclasificar DEFER |
| Madriguera de conejo | N iteraciones sin progreso verificable | abortar → replantear el enfoque |
| Presupuesto agotado | presupuesto de iteración/herramientas/tiempo gastado | abortar → registrar en notas |
| Premisa invalidada | nueva evidencia contradice la verificación de realidad | abortar → reevaluar la puerta |

Una condición de parada disparada marca la tarea como CANCELLED (no skipped)
con la razón registrada.

### "¿Es ahora?": la comprobación de oportunidad

El triaje clasifica; no decide si el trabajo corresponde **ahora**. Antes de
confirmar DO, responde sí a las tres:

1. ¿Es el problema correcto? ¿Encaja con el objetivo actual, o es ruido del
   backlog?
2. ¿Es correcto el apetito/alcance? ¿Cabe el trabajo en el apetito declarado?
   Un apetito que se sabe insuficiente es DEFER, no un DO programado para fallar.
3. ¿Es ahora? ¿La urgencia lo justifica sobre el resto del trabajo listo?

Cualquier "no" → DEFER con la razón en el registro.

### Clasificación de complejidad (Cynefin)

Clasifica antes de fijar el esfuerzo; el dominio decide el enfoque:

| Dominio | Señal | Implicación para el enfoque |
|--------|--------|----------------------|
| Claro (antes Obvio) | causa-efecto evidente para cualquier observador razonable, práctica conocida | ejecutar directamente, esfuerzo pequeño |
| Complicado | causa-efecto analizable con experiencia | analizar primero; documentar la elección entre enfoques válidos |
| Complejo | la causa-efecto solo emerge por experimento | no planificar todo por adelantado; pasos cortos, verificación frecuente |
| Caótico | sin causalidad visible (crisis) | actuar para estabilizar primero; mucha cuesta arriba → DEFER si no es emergencia |

Registra el dominio más los 3 riesgos principales (más probable / mayor
impacto / rompedor de contrato): alimentan el registro de riesgos de la tarea.

## Reporte de incertidumbre: cuesta arriba vs cuesta abajo

El contrato de reporte completo (contadores, campos del registro y la regla
de finalización) es canónico en `contract-execution`. Lo que la admisión debe
respetar: mover una tarea a in-progress sin un enfoque conocido es cuesta
arriba hasta que el contrato esté definido, y una tarea con incógnitas
abiertas nunca reporta completa, ni siquiera al 100%.

## Principios invariantes

- **El contrato es ley**: una condición booleana verificable por tarea; si
  no pasa con evidencia registrada, la tarea no está completa.
- **Comprender antes de tocar**: el descubrimiento no es opcional; mapea el
  radio de impacto antes de la primera edición.
- **Verificación mecánica, nunca autoinforme**: el build, el runner de tests
  y el linter dicen "pass"; el resumen del agente no.
- **Un paso a la vez**: commits pequeños, cada uno individualmente reversible.
- **Camino suficiente más corto**: antes de escribir código sube la escalera:
  ya existe > biblioteca estándar > característica de plataforma > dependencia
  instalada > una línea > código nuevo mínimo.
- **Lo colateral se captura, no se ignora**: un bug encontrado a mitad de
  tarea: arreglo rápido gestionado y registrado; uno lento, anotado para
  después. Nunca se pasa en silencio.
- **El progreso siempre es visible**: actualiza el registro y el handoff tras
  cada acción; nunca más de ~3-5 iteraciones sin reportar.
- **El estancamiento significa preguntar**: 2 fallos de verificación con el
  mismo error (archivo+línea+mensaje) → pregunta al dueño; sin respuesta → para.
- **Presupuesto finito**: los límites de iteración/herramientas/tiempo se
  declaran; excederlos es FAILED, no "seguir intentando".
- **Preservar el progreso válido**: los pasos completados y los puntos de
  guardado son estado duradero; la interrupción reanuda, nunca rehace.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Demasiado pequeño para un registro" | El registro acotado es lo que hace legítima la ruta ligera: toma un minuto y sobrevive al reinicio. |
| "Sé lo que quisieron decir" | Confirmar la intención antes de escribir es más barato que rehacer después. |
| "Compila, funciona" | Compilar no es el contrato. Ejecuta la verificación declarada o di que no se ejecutó. |
| "Solo esta vez, salta la comprobación" | La comprobación existe exactamente para el cambio que quiere saltársela. |
| "Un test verde prueba el arreglo" | Un test verde prueba que un test pasa. La causa raíz se prueba con investigación; el resultado se prueba con el contrato. |
| "Diff pequeño significa trabajo ligero" | La clasificación trata de riesgo y reanudabilidad, no de número de líneas. Los riesgos nombrados son formales a cualquier tamaño. |

## Señales de alerta

- Escribir en el código fuente antes de que exista el registro acotado.
- Reinterpretar una petición ambigua como autorización para implementar.
- Declarar "hecho" sobre una verificación propuesta pero no ejecutada.
- Una comprobación fallida re-ejecutada sin cambios en bucle en lugar de diagnosticada.
- Clasificación de ruta ligera elegida para esquivar las puertas formales en
  un riesgo nombrado.
- Alcance ampliado a mitad de tarea sobre hallazgos no registrados.
- Evidencia antigua citada después de que la implementación cambió.
- Cerrar más allá del límite acordado: siguiente tarea, push o publicación asumidos.

## Verificación

- [ ] La autoridad se estableció antes de la primera escritura; la
      investigación y las propuestas permanecieron en solo lectura hasta entonces
- [ ] El registro de tarea acotado se abrió antes de cambiar código fuente,
      con la solicitud original preservada verbatim
- [ ] La clasificación (`diff-sufficient` / `record-required`, más cualquier
      clase de riesgo nombrado) se registró con su justificación
- [ ] El trabajo con riesgo nombrado tomó la ruta formal sin importar el
      tamaño del diff
- [ ] La evidencia de verificación de realidad (referencias existen, brecha
      confirmada, radio de impacto) se escribió en el registro
- [ ] Las condiciones de parada y el apetito se declararon antes de empezar;
      una condición disparada marcó la tarea CANCELLED con su razón
- [ ] El cierre reportó el resultado en cuatro partes: implementado,
      verificado, pendiente, siguiente paso, incluyendo fallos e impacto desconocido
