---
name: decision-request
description: Formular una pregunta con consecuencias con alternativas y autoridad explícitas; contrato de puerta canónico para el pipeline.
---
# Decision Request

Contrato canónico para puertas human-in-the-loop. Otros prompts REFERENCIAN
las puertas definidas aquí (P, D, V, C, H); nunca las redefinen. Cargado por
el lead o un delegado cuando se alcanza una decisión con consecuencias, un
contrato ambiguo o un disparador de puerta declarado. La salida es una
pregunta/respuesta registrada con su alcance — o, sin interfaz de preguntas,
un reporte estructurado más STOP; una pregunta sin responder bloquea, nunca
implica GO.

## Slots requeridos

Slots requeridos: la única pregunta sin resolver; hechos observados e
incógnitas; por qué la investigación no puede zanjar la intención/autoridad
de producto; opciones viables con compromisos; recomendación; alcance exacto,
rutas, efectos, costos y riesgos; identidad/digest de la entrada revisada;
qué queda bloqueado.

Usar la interfaz de preguntas nativa disponible cuando se conozca su esquema;
si no, preguntar claramente en texto. Preferir un conjunto pequeño de
alternativas completas. Permitir rechazo, cancelación y otra respuesta. Una
pregunta omitida no es aprobación; no convertir una recomendación en opción
seleccionada. Registrar la respuesta real y su alcance. Efectos nuevos o
entradas revisadas cambiadas requieren consentimiento renovado; un registro
de aprobación no es autenticación.

## Principios

1. Cada pregunta porta opciones concretas más un default recomendado,
   listado primero y marcado `(Recommended)`. Nunca una pregunta abierta
   sin contexto.
2. Registrar el resultado de cada puerta en el registro de continuación y,
   cuando cambia la dirección, como entrada de decisión/journal con la
   razón.
3. Como máximo UNA ronda de preguntas por puerta por tarea: el propietario
   ya decidió; no repreguntar salvo que el código contradiga la decisión.
4. Si el host no expone interfaz de preguntas, recurrir a un reporte
   estructurado y STOP esperando la entrada del propietario — nunca asumir
   GO.

## Quién pregunta

| Contexto | Cómo |
|---|---|
| Orquestador / lead | Directamente vía la interfaz de preguntas |
| Delegado CON capacidad de preguntas | Directamente |
| Delegado SIN capacidad de preguntas | Devuelve `BLOCKER: <gate + options>` en su bloque RESULT — el orquestador pregunta al recibirlo y reanuda al delegado con la respuesta. El delegado NUNCA asume GO. |

## Gate P — Plan/triage

Durante el triage del backlog, ANTES de fijar la decisión de puerta final:

| Disparador | Pregunta |
|---|---|
| Tarea de prioridad crítica | Confirmar inclusión/alcance: GO tal cual / ajustar alcance / aplazar / omitir |
| Contrato ambiguo (≥2 interpretaciones que cambian el resultado) | Mostrar las interpretaciones, solicitar una elección |
| El plan añade nuevos símbolos/contratos públicos (función pública, endpoint, herramienta, método de binding, componente consumible) — incluso cuando el tipo detectado dice fix/wrapper/refactor | Tratar como feature-add: mini-spec por `spec-brief` → decisiones abiertas al propietario (una ronda, opciones + default recomendado) ANTES de aprobar `do`. Las etiquetas de tipo no anulan este disparador. |
| Feature-add o lógica nueva | Spec guiada: generar la mini-spec `spec-brief` → preguntar sus decisiones abiertas (una ronda) ANTES de `do`. La spec confirmada viaja al registro de tarea — sin ella, no hay ACT. |
| Resumen de triage final | Confirmar el conjunto completo de defer/skip antes de persistir el plan |

## Gate D — Discovery

Tras la planificación sin código, ANTES de escribir el registro de tarea /
entrar en ACT:

| Disparador | Pregunta |
|---|---|
| Radio de impacto >10 archivos, o toca una ruta crítica declarada / API pública / límite de persistencia | Mostrar radio de impacto resumido + enfoque propuesto → GO / ajustar / dividir en tareas |
| El plan de solución añade nuevos símbolos/contratos públicos (misma detección que Gate P — detectar en planificación, no desde la etiqueta de tipo) | Confirmar el diseño de superficie pública (nombres, firmas, semántica de error) → GO / ajustar |
| Ambigüedad de contrato descubierta en el código que el triage no vio | Parar; elegir entre rutas válidas |
| Feature-add/lógica nueva sin mini-spec | Generar la spec; confirmar criterios de aceptación con el propietario |

### Contenido válido de `## Spec` (puerta mecánica spec-first)

La sección spec de una tarea cuenta como RELLENA solo si satisface UNA de:

1. **Tabla de decisiones** (`spec-brief` §5): ≥1 fila con ≥2 alternativas
   REALES (enfoques materialmente distintos, no variantes cosméticas) +
   compromiso de una línea por opción + default recomendado (+ columna
   `Resolved` cuando pasó por una pregunta), O
2. **Justificación por evidencia por ítem:** cada decisión técnica marcada
   `decided-by-evidence (ref: file:line | official doc)` — una única ruta
   viable igualmente se registra, nunca se omite.

INVÁLIDO: `N/A`, vacío, o solo "contrato mecánico" sin las decisiones.
Única excepción: una tarea 100% docs sin decisiones técnicas → escribir
`no technical decisions` + la lista de archivos tocados (verificable).

Quien ejecuta ACT y quien revisa DEBEN validar esto antes de entrar en
ACT; inválido → volver a discovery (spec + preguntas). Un `N/A` en una
tarea con nuevos símbolos públicos es un hallazgo de revisión bloqueante.

## Gate V — Verify-failure ×2

En el umbral único de **2 fallos de verify con el mismo error**
(archivo+línea+mensaje). Reemplaza la escalación humana silenciosa.

Pregunta obligatoria CON evidencia: los 2 errores, qué intentos corrieron,
opciones:
1. Reintentar con contexto fresco (consume presupuesto)
2. Cambiar estrategia (describir la alternativa propuesta)
3. Marcar FAILED y pasar a la siguiente tarea (se aplica la política de
   fallo declarada)

Sin respuesta → STOP (no marcar FAILED unilateralmente salvo que se haya
declarado una política de parada explícita).

## Gate C — Closure

Durante el cierre, antes del commit final:

| Disparador | Pregunta |
|---|---|
| Errores colaterales encontrados | Corregir ahora (pequeño, mismo archivo) / incluir en este commit — el registro de hallazgo derivado ya existe por `finding-record` si no se corrige inline |
| `git status` muestra archivos FUERA del radio de impacto declarado | Incluir en el commit / dejar sin commit (staged aparte) / investigar origen |
| Plan completado (cierre de campaña) | Confirmar archivado del plan y migración del trabajo completado a registros de progreso |
| Cierre de tarea → ACCEPT | NO es una pregunta: es enforcement. Registrar `CLOSE`/`ACCEPT` requiere un payload de revisión válido — modo `fresh` con contexto revisor ≠ contexto autor + veredicto `approve`, o modo `degraded` + renuncia del propietario `{owner, reference, reason}` registrada en trace/decisions. Sin ello la transición se rechaza; una renuncia degradada es una decisión registrada del propietario, nunca autoconcedida. |

## Gate H — Autocambio del harness

Cuando el diff toca recursos del harness (comandos, agentes, skills,
prompts, reglas, referencias, descriptores de host, perfiles MCP):

| Disparador | Acción |
|---|---|
| Cualquier cambio en los árboles de recursos del harness | Ejecutar el comando `audit-harness` en verde antes del commit del harness |
| Auditoría del harness en rojo con hallazgos ≥medium | Registrar finding records + corregir en el mismo PR del harness — no "después" |
| Regresión declarada de evaluación de agentes | NO-GO: no fusionar ni entregar hasta restaurar la línea base |
| Nuevos hallazgos de herramientas sobre la línea base | Bloquear: triage (falso positivo → baseline con justificación, real → corregir) |

El cambio del harness lo audita un contexto que no lo autoró; su
aceptación también pasa el payload de revisión mecanizado (Gate C).

## Anti-abuso

- Las puertas NO aplican a tareas triviales con un contrato mecánico claro.
- Una familia explícitamente aprobada por el propietario esta sesión (mismo
  plan, mismo objetivo) suprime Gate P/D individual SOLO para tareas de
  fix/test/docs/refactor sin nueva superficie pública. Las tareas
  feature-add o de nuevos símbolos públicos dentro de una familia aprobada
  igualmente disparan UNA ronda empaquetada de confirmación de spec (todas
  las decisiones abiertas juntas, opciones + default recomendado) antes de
  ACT. Justificación: la aprobación del plan cubre el QUÉ de cada tarea;
  la spec de una feature nueva define el CÓMO técnico, que el plan no
  detalla.
- Si el plan declara autonomía (`autonomous: true`), solo operan Gate V y
  los casos de seguridad de Gate C (archivos fuera del radio de impacto).
  Sin el flag, todas las puertas operan.

## Defaults de ejecución sin parada

Una ejecución de plan completo opera sin parada con defaults seguros + log
estructurado:
- **Gate D crítico → pregunta** (radio de impacto >10 / ruta crítica / API
  pública / contrato ambiguo / nuevos símbolos públicos →
  GO/ajustar/dividir). D no crítico (trivial, contrato mecánico) no
  pregunta.
- **Gate V → pregunta obligatoria** (2 fallos de verify con el mismo error
  → reintento fresco / cambio de estrategia / FAILED; sin respuesta →
  STOP).
- **Gate C → auto+log** (colaterales pequeños del mismo archivo corregidos
  inline, el resto recibe finding records; archivos fuera del radio de
  impacto quedan sin commit ante ausencia de decisión; el cierre de
  campaña pregunta por archivado). Preguntas solo en casos de seguridad o
  cierre de campaña.
- Cada default aplicado aterriza en el registro de continuación + pista de
  auditoría `GATES_EVALUATED`; el orquestador nunca repregunta lo
  decidido.

## Registro obligatorio de evaluación de puertas

Todo bloque RESULT incluye:

```
GATES_EVALUATED: P:<no|fired> D:<no|fired> V:<no|fired> C:<no|fired> | <reason per gate, ≤6 words>
```

Reglas del orquestador al recibirlo:
1. Campo ausente, o un `no` sin razón → tratar como MALFORMED y reinvocar
   por el campo (peldaño de recuperación 1).
2. Una puerta marcada `fired` debe corresponder a un `BLOCKER:` reportado
   o a una pregunta/respuesta registrada. Discrepancia → reinvocar con
   feedback.
3. Persistir el campo en el registro de continuación — la pista de
   auditoría de que las puertas fueron EVALUADAS, no solo ejecutadas.

Esto convierte las puertas de "juicio del delegado" en una checklist
verificable: el delegado debe probar que las evaluó aunque ninguna se
disparara.
