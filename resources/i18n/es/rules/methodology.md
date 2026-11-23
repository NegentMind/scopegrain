# Metodología — Reglas

> **Ámbito:** cómo se selecciona, dimensiona y ejecuta el trabajo bajo
> Organic Driven Development (ODD): proporcionalidad de modos, fidelidad a
> la petición, intents de solo lectura y precedencia entre texto de
> metodología y puertas de runtime.
> **No aquí:** carga de reglas y mecánica de workflow (`workflow.md`), qué
> cuenta como prueba (`evidence.md`), cuándo preguntar al owner
> (`human-decisions.md`), fronteras de autorización (`safety.md`), política
> de reintentos y escalado (`research-escalation.md`).
> **Estado:** Active
> **Fuentes:** contrato de workflow de scopegrain (`policy/workflow.json`).

ODD significa Organic Driven Development. Inspeccionar el comportamiento
existente, establecer autoridad, resolver incertidumbre y seleccionar
trabajo proporcionado.

## Reglas

### 1 — Honrar el modo de proyecto seleccionado

- **Debe:** mantener el trabajo ligero en un único registro de tarea
  acotado, alcance autorizado y evidencia real de verificación/revisión;
  enrutar el trabajo sensible o sustancial por SDD con aprobaciones
  vigentes vinculadas a contenido y trazabilidad de escenarios.
- **No debe:** imponer la cadena formal de
  especificación/diseño/aprobación al trabajo ligero, ni ejecutar trabajo
  sustancial sin ella.
- **Por qué:** la proporcionalidad es el trueque central de la metodología
  — el trabajo sustancial infra-formalizado pierde trazabilidad; el
  trabajo ligero sobre-formalizado la desperdicia.

### 2 — El riesgo desconocido no es riesgo bajo

- **Debe:** clasificar el trabajo por lo que se sabe sobre seguridad,
  datos, contratos compartidos, concurrencia y efectos externos — nunca por
  tamaño del diff.
- **No debe:** justificar un trato más débil de un cambio porque el diff
  sea pequeño.
- **Por qué:** un cambio de una línea en un contrato compartido o una
  frontera de seguridad puede romper a todos los consumidores; el tamaño no
  es un proxy de riesgo.

### 3 — Las preguntas y las peticiones de solo propuesta permanecen de solo lectura

- **Debe:** tratar una pregunta o una petición de solo propuesta como solo
  lectura: inspeccionar, analizar y responder sin mutar nada.
- **No debe:** implementar, migrar ni "corregir" en respuesta a una
  pregunta.
- **Por qué:** la petición define el alcance autorizado; una pregunta no
  concede ninguno.

### 4 — Preservar la petición original; no inventar nada

- **Debe:** mantener la intención declarada, restricciones y hechos de la
  petición tal como se dieron; exponer al owner las ambigüedades
  consecuentes (`→ see human-decisions.md`) y revelar toda comprobación
  ausente o capacidad de runtime no disponible (`→ see evidence.md`).
- **No debe:** inventar decisiones, métricas, aprobaciones, investigación,
  herramientas, resultados de pruebas ni identidad autenticada.
- **Por qué:** las aprobaciones o resultados fabricados corrompen el
  registro en el que el owner confía; una ambigüedad resuelta en silencio
  es una decisión robada.

### 5 — Las reglas del host y las puertas de runtime prevalecen sobre el texto de metodología

- **Debe:** ceder ante las instrucciones existentes del host/repositorio y
  las puertas reales de runtime cuando entren en conflicto con este
  documento; tratar la evidencia de clasificación y resultado como
  atestaciones atribuidas, no prueba de verdad semántica
  (`→ see evidence.md`).
- **No debe:** tratar el texto de metodología como un sandbox ni como un
  interceptor universal de herramientas.
- **Por qué:** la metodología describe juicio, no aplicación; fingir lo
  contrario produce falsa confianza sobre lo que realmente se bloqueó.

## Reglas para las reglas (autoría)

- Un área por archivo. Declarar el ámbito en la cabecera y no solapar con
  otro archivo; hacer referencia cruzada en su lugar (`→ see <file>.md`).
  Consultar el catálogo antes de crear un nuevo archivo de reglas.
- Formato de cabecera: `# <Area> — Rules`, luego `> **Scope:**`,
  `> **Not here:**` (áreas que pertenecen a otros archivos),
  `> **Status:**` (Active | In review | Obsolete), `> **Sources:**`
  (decisiones/investigación de soporte, si las hay).
- Reglas imperativas numeradas: `### <N> — <short imperative title>` con
  `Must:`, `Must not:` y `Why:`. El `Why:` es obligatorio — una regla sin
  razón se ignora. Opcionalmente `Exceptions:` y `Fixes:`.
- Ser específico e imperativo: "envuelve X en Y", no "sería bueno
  considerar". Al citar código, nombrar el símbolo — los números de línea
  derivan.
- No duplicar contenido entre reglas, referencias y skills: las reglas son
  restricciones duras, las referencias material de consulta, las skills
  procedimientos. Cada afirmación vive exactamente en un lugar.
- Una regla cargada para un área tocada es obligatoria: no puede omitirse
  ni relajarse sin una excepción explícita y registrada
  (`→ see workflow.md`).
- Ciclo de vida de una regla: añadir reglas nuevas al final de su archivo,
  numeradas secuencialmente, empezando en estado `In review` hasta que el
  owner apruebe; editar reglas existentes en su lugar y anotar cambios
  materiales con `<!-- Changed YYYY-MM-DD: reason -->`; marcar una regla
  `Obsolete` con su razón en lugar de borrarla — el owner decide el borrado.
- El texto de las reglas se crea en inglés como fuente de verdad
  (`→ see workflow.md` idioma de la documentación).
- Antes de fusionar un cambio de reglas, verificar que el archivo parsea,
  el ámbito no colisiona y el índice/catálogo está actualizado.
