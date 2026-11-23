# Workflow — Reglas

> **Ámbito:** workflow de tareas registradas, dispatch de comandos, carga
> de recursos, orquestación, análisis de impacto, control de proliferación,
> higiene de sesión, registros de decisión, idioma de documentación,
> comprobaciones pre-acción y trazabilidad.
> **No aquí:** selección de modo y fidelidad a la petición
> (`methodology.md`), estándares de evidencia (`evidence.md`), cuándo
> preguntar al owner (`human-decisions.md`), fronteras de autorización y
> secretos (`safety.md`), presupuestos de reintento
> (`research-escalation.md`), independencia de revisión (`review.md`),
> confianza en recursos (`resource-integrity.md`), puertas de
> publicación/versión (`release-ci.md`).
> **Estado:** Active

## Workflow registrado

### 1 — Comprobar el comportamiento existente antes de planificar

- **Debe:** verificar si el comportamiento solicitado ya existe antes de
  proponer o planificar cambios.
- **No debe:** planificar sobre suposiciones o estado recordado.
- **Por qué:** re-implementar comportamiento existente duplica código y
  rompe la línea base que la inspección habría establecido.

### 2 — Leer el estado real de la tarea antes de mutarlo

- **Debe:** leer el estado y la revisión actuales de la tarea antes de
  cualquier mutación; respetar la preparación de dependencias; tratar el
  éxito no registrado como no CLOSE.
- **No debe:** mutar contra un estado recordado ni cerrar trabajo cuyo
  éxito nunca fue registrado.
- **Por qué:** el estado deriva entre sesiones y actores; la revisión
  almacenada es la única guarda contra actualizaciones perdidas y cierre
  prematuro.

### 3 — Las ediciones requieren ACT; el trabajo cambiado necesita evidencia fresca

- **Debe:** mantener un estado de ejecución autorizado antes de editar, y
  re-ejecutar verificación y revisión tras cualquier cambio.
- **No debe:** reutilizar verificación previa al cambio como prueba del
  trabajo cambiado (`→ see evidence.md`).
- **Por qué:** un resultado aprobado obsoleto prueba solo la revisión que
  lo produjo.

### 4 — Preservar trabajo parcial y evidencia a través de interrupciones

- **Debe:** mantener reanudables los artefactos y la evidencia en vuelo
  cuando el trabajo se interrumpe.
- **No debe:** descartar silenciosamente el progreso parcial.
- **Por qué:** el estado parcial perdido fuerza retrabajo y oculta hasta
  dónde llegó realmente la verificación.

### 5 — Escribir artefactos solo tras un plan mostrado y consentimiento explícito

- **Debe:** mostrar el plan y obtener apply/consent explícito antes de
  producir artefactos (`→ see human-decisions.md`).
- **No debe:** tratar el silencio o un mensaje ambiguo como
  consentimiento.
- **Por qué:** el consentimiento vinculado a entradas revisadas es lo que
  hace autorizada la salida.

### 6 — Parar en la frontera acordada

- **Debe:** terminar en el alcance declarado; reportar hallazgos adyacentes
  en lugar de actuar sobre ellos.
- **No debe:** lanzar tareas no relacionadas porque quede capacidad.
- **Por qué:** la expansión no solicitada destruye la contabilidad de
  alcance y la integridad de la revisión.

## Dispatch de comandos

### 7 — Cargar el recurso de comando coincidente antes de actuar

- **Debe:** tratar un mensaje de usuario con forma de comando como una
  petición de cargar el recurso de comando coincidente, e interpretar su
  modo a partir del argumento.
- **No debe:** improvisar el comportamiento de un comando de memoria.
- **Por qué:** el archivo de comando es el contrato; una versión recordada
  puede estar obsoleta o ser errónea.

### 8 — Resolver referencias a través del catálogo y todas las ubicaciones de estado

- **Debe:** resolver cada referencia relativa dentro de comandos y prompts
  a través del catálogo configurado y las rutas de estado, buscando en las
  ubicaciones activas, completadas y cerradas antes de declarar un elemento
  ausente.
- **No debe:** reportar un elemento ausente tras comprobar una sola
  ubicación.
- **Por qué:** las rutas de ciclo de vida existen precisamente para que los
  registros completados y cerrados sigan siendo encontrables; una búsqueda
  superficial fabrica ausencia.

### 9 — Seguir las fases declaradas en orden; nunca saltarse pasos

- **Debe:** cargar los prompts, skills y reglas referenciados en su orden
  declarado y seguir sus fases.
- **No debe:** saltarse pasos, reordenar fases ni tratarlas como
  consultivas.
- **Por qué:** las fases codifican comprobaciones; cada paso saltado es una
  puerta silenciosamente eliminada.

### 10 — Terminar un comando en su salida declarada

- **Debe:** parar cuando la salida declarada del comando se produce y el
  handoff está escrito.
- **No debe:** continuar hacia una siguiente tarea implícita.
- **Por qué:** la continuación nunca fue autorizada; el handoff es la
  frontera.

## Carga de recursos

### 11 — Evaluar y cargar las skills y reglas aplicables antes de actuar

- **Debe:** evaluar qué skills y reglas aplican antes de cualquier acción;
  ante la duda, cargar el recurso.
- **No debe:** omitir la carga por una excusa de tamaño o familiaridad —
  "demasiado pequeño para el proceso", "tests luego", "ya conozco este
  código" o "no hace falta cargar el procedimiento".
- **Por qué:** esas racionalizaciones son precisamente cómo se eluden las
  puertas; la excusa es el síntoma para el que la regla existe.

### 12 — Una regla cargada es obligatoria; nunca debilitarla para pasar

- **Debe:** cargar solo los recursos del área que se cambia; una regla
  cargada es obligatoria, no consultiva (`→ see methodology.md`).
- **No debe:** debilitar o borrar una regla para que un cambio pase; si una
  regla no aplica a la sub-tarea exacta, dejarla sin modificar.
- **Por qué:** editar la restricción para ajustarla al cambio convierte la
  gobernanza en decoración.

### 13 — Registrar los hallazgos no documentados en su formato establecido

- **Debe:** cuando una referencia consultada resuelve un problema no
  documentado, añadir la entrada ausente en su formato establecido.
- **No debe:** corregir un vacío de conocimiento solo en el contexto de
  trabajo.
- **Por qué:** las correcciones no documentadas recurren; el registro es lo
  que hace barata la siguiente ocurrencia.

## Orquestación

### 14 — Respetar la división de roles: comandos cuándo, skills cómo, agentes quién

- **Debe:** dejar que el usuario o un comando orqueste; los comandos son
  puntos de entrada, las skills procedimientos, los agentes perspectivas.
- **No debe:** dejar que un procedimiento o un rol se auto-orqueste más
  allá de su alcance declarado.
- **Por qué:** confundir las capas oculta quién autorizó qué.

### 15 — Desplegar en paralelo solo trabajo independiente; las hojas no delegan

- **Debe:** paralelizar solo a través de trabajo independiente y fusionar
  los artefactos realmente producidos; los roles especialistas son nodos
  hoja.
- **No debe:** dejar que un rol hoja delegue más.
- **Por qué:** la delegación delegada pierde responsabilidad y produce
  resultados parciales infusibles.

### 16 — Un rol de revisión o auditoría verifica e informa; nunca implementa

- **Debe:** mantener los roles de revisión/auditoría de solo lectura sobre
  el artefacto bajo revisión (`→ see review.md`).
- **No debe:** dejar que el revisor aplique la corrección.
- **Por qué:** un revisor que corrige destruye la independencia para la que
  la revisión existe.

## Análisis de impacto

### 17 — Mapear referencias entrantes y salientes antes de modificar o borrar

- **Debe:** antes de modificar o borrar un archivo, leerlo por completo,
  mapear sus referencias entrantes a través del workspace y sus
  dependencias salientes, e informar qué se rompe.
- **No debe:** borrar sobre una impresión de "sin uso" o "duplicado" sin
  una búsqueda real.
- **Por qué:** las impresiones pierden referencias dinámicas, basadas en
  strings y a través de fronteras; el informe es lo que permite al owner
  valorar el cambio.

## Control de proliferación

### 18 — Los comandos, modos y prefijos de ID nuevos deben nombrar lo que reemplazan

- **Debe:** declarar, para cada comando, modo o prefijo de identificador
  nuevo, qué recurso existente reemplaza o por qué ninguno cubre la
  necesidad; registrar los esquemas de ID nuevos en la taxonomía del
  proyecto.
- **No debe:** inventar prefijos ad hoc ni comandos paralelos por campaña o
  herramienta.
- **Por qué:** la proliferación fragmenta la tabla de enrutado hasta que
  nada es descubrible.

## Higiene de sesión

### 19 — Inspeccionar antes de planificar, re-inspeccionar antes de cerrar

- **Debe:** inspeccionar el estado del árbol de trabajo y el historial
  reciente antes de planificar cambios; antes de cerrar, re-inspeccionar el
  diff por sobre-ingeniería residual y reportarla.
- **No debe:** expandir silenciosamente el alcance dentro de un diff.
- **Por qué:** el estado sin inspeccionar y los diffs sin inspeccionar son
  donde se esconden los cambios no relacionados y la expansión del alcance.

## Decisiones y afirmaciones

### 20 — Registrar las decisiones de trade-off consecuentes en la ruta de decisiones

- **Debe:** registrar los trade-offs consecuentes en la ruta de decisiones
  configurada: el owner articula contexto, elección y consecuencias; el
  agente aporta evidencia (`→ see human-decisions.md`).
- **No debe:** dejar que las elecciones consecuentes existan solo en
  conversación.
- **Por qué:** los trade-offs no registrados son re-litigados por cada
  sesión futura sin el contexto original.

### 21 — Nada de código generado sin explicación

- **Debe:** poder explicar las decisiones no triviales dentro del código
  generado antes de fusionarlo.
- **No debe:** fusionar código generado con la justificación de que "la
  herramienta lo escribió".
- **Por qué:** el código que nadie puede explicar es irrevisable e
  inmantenible; quien lo fusiona lo posee.

### 22 — Nunca ocultar una comprobación fallida

- **Debe:** corregir una comprobación fallida o registrarla como un issue
  rastreado y justificado (`→ see evidence.md`).
- **No debe:** ocultar el fallo tras verificación omitida, diagnósticos
  suprimidos o un continue silencioso.
- **Por qué:** los fallos suprimidos convierten defectos conocidos en
  invisibles.

## Idioma de la documentación

### 23 — Un único idioma fuente de verdad para el contenido técnico

- **Debe:** mantener la documentación técnica en un único idioma declarado
  como fuente de verdad; los artefactos operativos y de planificación
  siguen el locale de proyecto configurado.
- **No debe:** mantener el mismo contenido técnico en dos idiomas.
- **Por qué:** las traducciones paralelas derivan en un solo ciclo de
  edición; el lector nunca puede saber qué copia está vigente.

## Comprobaciones pre-acción

### 24 — Mantener acotado cada paso de edición

- **Debe:** mantener cada paso de edición en aproximadamente ≤100 líneas
  escritas o ≤5 archivos; dividir los cambios mayores o registrarlos como
  excepciones deliberadas y justificadas.
- **No debe:** colar un cambio sobredimensionado en silencio.
- **Por qué:** los pasos acotados mantienen tratables la revisión, el
  rollback y el blame; el registro de excepciones mantiene honesto el
  trabajo honesto.

### 25 — Verificar solo a través de canales declarados

- **Debe:** ejecutar la verificación a través de los comandos
  declarados/registrados, o la ruta manual: proponer el comando, el owner
  lo ejecuta y devuelve la salida.
- **No debe:** improvisar trabajo de shell fuera de estados autorizados.
- **Por qué:** la ejecución no declarada es ejecución no auditada — el
  registro no puede mostrar lo que nunca vio.

### 26 — Los secretos quedan fuera de todo canal

- **Debe:** aplicar la regla de secretos en todas las lecturas, comandos y
  artefactos (`→ see safety.md`).
- **No debe:** leer ni hacer eco de valores de secretos o de entorno;
  referenciar nombres de variable, nunca contenidos.
- **Por qué:** ver `safety.md` — un valor filtrado no puede des-filtrarse.

### 27 — Dos fallos idénticos disparan escalado, no reintento

- **Debe:** aplicar el presupuesto de reintento/escalado cuando la
  verificación falla (`→ see research-escalation.md`).
- **No debe:** reintentar el mismo enfoque tras una firma de fallo
  idéntica repetida.
- **Por qué:** regla canónica en `research-escalation.md`; enunciada aquí
  como punto de entrada del workflow.

## Trazabilidad

### 28 — Propagar el identificador de tarea a los artefactos de larga vida

- **Debe:** referenciar el identificador de tarea/sesión propietario en
  mensajes de commit, informes, registros de hallazgos y bloques de handoff
  — al escribir, no después.
- **No debe:** dejar un hallazgo, decisión o lección sin su enlace de
  tarea.
- **Por qué:** un registro sin enlace es un huérfano; la procedencia
  añadida después es reconstruida, no registrada.
