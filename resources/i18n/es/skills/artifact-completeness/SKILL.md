---
name: artifact-completeness
description: Úsala cuando la completitud importa y una salida de herramienta grande o archivos generados arriesgan truncamiento silencioso
---
# Completitud de artefactos (Aplicación de salida completa)

Anula el comportamiento de truncamiento por defecto. Exige generación
completa, prohíbe patrones de marcador de posición y maneja limpiamente las
divisiones por límite de salida.
Aplícala a cualquier tarea que requiera artefactos exhaustivos y sin
abreviar.

## Cuándo usar

- Al generar un archivo, módulo, documento o configuración completa donde un
  esqueleto se entregaría silenciosamente como "terminado"
- Al producir N entregables nombrados (funciones, componentes, secciones,
  respuestas) donde cualquier subconjunto es un fallo
- Al revisar o juzgar salidas grandes de herramientas (logs de pruebas,
  salida de build, volcados) donde la cabecera truncada no es toda la
  evidencia
- En cualquier traspaso donde un consumidor posterior no pueda distinguir un
  marcador de posición de una parte terminada

No para: bocetos exploratorios que el solicitante acotó explícitamente como
parciales, ni respuestas en prosa cuya longitud nunca fue un requisito.

Trata cada tarea como crítica para producción. **Una salida parcial es una
salida rota.** No optimices para la brevedad — optimiza para la completitud.
Si la petición pide un archivo completo, entrega el archivo completo. Si pide
5 componentes, entrega 5 componentes. Sin excepciones.

## Patrones de salida prohibidos

Los siguientes son fallos duros — nunca los produzcas:

**En bloques de código:** `// ...`, `// rest of code`, `// implement here`,
`// TODO`, `/* ... */`, `// similar to above`, `// continue pattern`,
`// add more as needed`, `...` suelto en lugar de código omitido.

**En prosa:** "Avísame si quieres que continúe", "Puedo dar más detalles si
hace falta", "por brevedad", "el resto sigue el mismo patrón", "de forma
similar para los restantes", "y así sucesivamente" (cuando sustituye
contenido real), "lo dejo como ejercicio".

**Atajos estructurales:** entregar un esqueleto cuando la petición era una
implementación completa; mostrar la primera y última sección saltándose el
medio; sustituir lógica repetida por un ejemplo y una descripción; describir
lo que el código debería hacer en lugar de escribirlo.

## Proceso de ejecución

1. **Alcance** — Lee la petición completa. Cuenta cuántos entregables
   distintos se esperan (archivos, funciones, secciones, respuestas).
   Identifica los entregables realmente requeridos y los límites de
   aceptación. Fija ese número.
2. **Construcción** — Genera cada entregable por completo. Escribe archivos
   completos, no secciones con marcadores ni implementaciones omitidas. Sin
   borradores parciales, sin "puedes extender esto después".
3. **Verificación cruzada** — Antes de responder, relee la petición
   original. Compara el recuento de entregables con el recuento del alcance.
   Si falta algo, añádelo antes de responder.

## Manejo de salidas largas

Cuando una respuesta se acerca al límite de salida:

- NO comprimas las secciones restantes para que quepan.
- NO saltes directo a una conclusión.
- Escribe a calidad plena hasta un punto de corte limpio (fin de una
  función, fin de un archivo, fin de una sección).
- Termina con:

```
[PAUSED — X of Y complete. Send "continue" to resume from: <next section>]
```

Con "continue", retoma exactamente donde paraste — sin resumen, sin
repetición.

## Salida de herramienta truncada

Cuando una herramienta trunca su salida (logs de pruebas, salida de build,
lecturas grandes):

- Lee la porción omitida desde un artefacto preservado — archivo de log,
  redirección, lectura paginada — antes de juzgarla. Nunca evalúes "el resto"
  solo con la cabecera truncada.
- No vuelques archivos grandes al chat para compensar; escríbelos en sus
  rutas reales y referencia esas rutas.

## Requisitos de honestidad

- Declara el trabajo sin terminar explícitamente — nunca lo ocultes tras un
  resumen optimista.
- Si un entregable no pudo completarse, di qué parte, por qué, y cuál es la
  siguiente acción segura.
- La completitud nunca autoriza acciones fuera de alcance o inseguras — un
  archivo "completo" que evade la validación sigue siendo una violación.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "El patrón es obvio — un ejemplo basta" | Solo si la petición pedía un ejemplo. Un entregable "completo" donde el ítem 4 de 7 es un comentario es un entregable roto. |
| "Pueden pedirme que continúe" | Eso traslada tu truncamiento a la atención del solicitante. Entrega completo, o pausa en un punto limpio con el marcador. |
| "La brevedad es buena educación" | La brevedad es para la prosa. Un artefacto abreviado es un defecto que el siguiente lector no puede distinguir de trabajo terminado. |
| "Las secciones del medio son repetitivas de todos modos" | La repetición no da licencia para elidir — si el contenido es genuinamente idéntico, la petición probablemente quería una abstracción, así que dilo en lugar de truncar. |
| "Juzgué el log por la parte visible" | El truncamiento de la herramienta no es una frontera de veredicto. Lee la porción omitida del artefacto preservado antes de concluir. |

## Señales de alerta

- Cualquier patrón prohibido en cualquier parte de la salida — incluido en
  "solo este punto".
- Un recuento de entregables silenciosamente distinto del alcance de la
  petición.
- Un marcador `[PAUSED]` en un corte no limpio, o una reanudación que resume
  o repite secciones terminadas.
- Conclusiones extraídas de salida truncada sin leer la porción omitida.
- Un resumen optimista que oculta una parte sin terminar o no verificable.
- Un artefacto "completo" que evadió la validación para llegar.

## Contrato de salida

El entregable es **todo ello o un marcador explícito**: cada ítem del
recuento de alcance, completo; o un estado `[PAUSED — X of Y]` en corte
limpio con un punto de reanudación exacto; o una declaración explícita que
nombre qué parte está sin terminar, por qué, y la siguiente acción segura.
Nada más cuenta como completo — un artefacto truncado presentado sin su
marcador es un defecto silencioso, que es peor que una pausa admitida.

## Comprobación rápida — antes de finalizar cualquier respuesta

- [ ] No aparece ningún patrón prohibido en la salida
- [ ] Cada ítem que el usuario pidió está presente y terminado
- [ ] Los bloques de código contienen código ejecutable real, no
      descripciones de lo que el código haría
- [ ] Nada se acortó para ahorrar espacio
- [ ] Cualquier punto de pausa usa el marcador explícito `[PAUSED — X of Y]`
- [ ] Las partes sin terminar o no verificables se declaran como tales
