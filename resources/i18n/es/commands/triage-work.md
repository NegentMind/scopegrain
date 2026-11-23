---
name: triage-work
description: Recomienda prioridades del backlog a partir de la evidencia actual sin aplicarlas.
---
# Triar el trabajo

Solo lectura — no modifiques ningún archivo. Carga
`planning-and-task-breakdown`; ejecútalo como `lead`. Semántica del
backlog: `references/backlog-format`; regla rectora: `rules/evidence`.
Cuando la recomendación necesita una elección consecuente del
propietario, pregunta con `prompts/decision-request`.

## 1. Leer el backlog

1. Lee completamente la fuente de backlog registrada del proyecto
   (lecturas paginadas si es larga) más los registros de tareas
   persistidos, incluidas las ubicaciones completadas/cerradas donde
   sea relevante.
2. Conserva solo los elementos **activos**. El estado/disposición
   registrado es la fuente de verdad:
   - Excluye: deferred, icebox, future, discarded, cancelled.
   - Incluye: elementos pending e in-progress; incluye elementos
     blocked listando su razón, pero nunca los recomiendes como #1.
3. Comprueba la ruta de planes configurada — si el plan más reciente
   tiene tareas en curso, marca qué elementos del backlog ya están
   ejecutándose y baja su prioridad de recomendación.
4. Si no existe fuente de backlog, repórtalo y detente.

## 2. Listar los elementos activos

Agrupa por las secciones/fases propias del backlog. Para cada elemento
activo emite una fila:

| ID | Qué es (una línea explicativa) | Esfuerzo | Prio |

- **Qué es** — la esencia en lenguaje llano: qué problema resuelve, qué
  riesgo mitiga o qué desbloquea. No copies la descripción completa.
- **Esfuerzo** y **Prio** — los buckets registrados (p. ej. esfuerzo
  hours/day/days/weeks; prioridad p0–p3/backlog, o la escala propia del
  proyecto).
- Si una sección tiene más de 10 activos, muestra los primeros 10 y
  colapsa el resto en `+N more (<IDs>) — see backlog`.
- Termina con `**Total: N active items across M sections.**`

## 3. Puntuar y recomendar

Puntúa cada elemento activo con esta heurística (simple, no perfecta):

| Señal | Puntos |
|--------|--------|
| Banda de prioridad registrada más alta | +3 |
| Segunda banda de prioridad | +2 |
| Tercera banda | +1 |
| Bandas más bajas | 0 |
| El texto dice "blocks release" / "blocker" | +3 |
| Categoría de riesgo nombrado (security, data-integrity, public-contract) | +2 |
| Otros elementos declaran una dependencia sobre él | +2 |
| Esfuerzo pequeño (quick win de alto valor) | +1 |
| Esfuerzo muy grande | −1 |
| Ya ejecutándose en el plan activo | −2 |

Muestra el **Top 3** con puntuación y una justificación de una línea
cada uno.

**Recomendación final:** el elemento #1, con el «por qué ahora»
explícito (riesgo mitigado, release desbloqueada, dependencia liberada)
y el comando exacto para iniciarlo — `implement-task <ID>`
independientemente del tipo; el enrutamiento a un rol especialista es
asunto de ese comando.

### Degradación elegante

Omite las secciones sin elementos activos; no menciones una ruta de
planes vacía; no muestres errores.

## Autoridad y verificación

Puramente consultivo: devuelve solo recomendaciones y referencias. No
crees tareas, edites prioridades, reabras trabajo cerrado ni inicies la
implementación. Recomendar no es autorizar — el propietario elige.

## Contrato de salida

Markdown conciso — idealmente una página, máximo dos:

- Sección 2: tablas por sección con descripciones.
- Sección 3: Top 3 con puntuaciones más la recomendación final en
  negrita.

## Señales de alarma

- Recomendar un elemento `blocked` como #1.
- Repuntuar desde prosa sin comprobar lo que el plan activo ya ejecuta.
- Emitir errores por estado ausente en lugar de degradar con elegancia.

## Entrega

La recomendación nombra la invocación exacta `implement-task <ID>`; el
triaje por lotes a un grafo formal pasa por `plan-work`.
