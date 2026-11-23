# Mantenimiento de referencias

Estas son guías de inspección frescas y neutras respecto al proyecto, no
copias literales ni endosos de todos los enlaces del archivo local original.
Mantén los procedimientos accionables en commands/skills, las obligaciones
en rules y los temas de fondo aquí. Inspecciona las fuentes autoritativas
antes de hacer una afirmación específica de versión. Preserva la
incertidumbre y la procedencia.

## Mantener un documento de síntesis/índice

Cuando varios documentos fuente informan el diseño del harness, mantén UN
documento de síntesis en lugar de notas dispersas. Su estructura:

1. **Cabecera** — fecha, lista de fuentes, propósito.
2. **Digest por fuente** — ubicación, definición, archivos analizados
   (tabla), patrones extraídos (tabla: patrón → descripción → aplicación).
3. **Digests por checklist** — estructura a nivel de sección de cada
   referencia accionable (secciones × conteos de checks), más los 3–5
   principios estructurales que aporta cada una.
4. **Registro de mejoras priorizado** — qué sugieren añadir las fuentes, en
   buckets de severidad con columnas de esfuerzo/valor/qué-existe/
   qué-falta/patrón/aplicación.
5. **Mapa patrón → código** — en qué archivo del harness vive cada patrón
   adoptado (mantiene honesta la síntesis: un patrón sin ubicación es
   aspiración, no implementación).
6. **Glosario** — términos que el harness usa y los lectores pueden no
   compartir.

### Forma de fila del registro de mejoras

| Campo | Contenido |
|---|---|
| # / Mejora | Nombre y explicación de una línea |
| Procedencia | Qué referencia la motiva |
| Esfuerzo / Valor | Bajo·Medio·Alto |
| Ya cubierto | Qué existe hoy |
| Qué falta | El vacío concreto |
| Patrón | Patrón nombrado que instancia |
| Aplicación | Dónde/cómo aterrizaría |

Agrupa por prioridad (🔴 alta / 🟡 media / 🟢 baja) y mantén un conteo de
resumen. Mantén también una lista de "no aplica" con razones — evita
re-litigar ideas rechazadas.

## Catálogo de patrones de ingeniería de harness

Patrones extraídos de la literatura industrial sobre harnesses (agent
harness = todo lo que rodea al modelo: prompts, herramientas, estado,
contexto, guardarraíles, verificación, observabilidad, orquestación):

| Patrón | Descripción |
|---|---|
| CAR decomposition | Documenta el harness en las dimensiones Control-Agency-Runtime |
| Initializer agent | Agente separado que prepara contexto + lista de tareas y luego entrega a los workers |
| init script | Script que hace bootstrap del entorno del agente al inicio de sesión |
| Self-verification | El agente verifica su propia salida antes de declarar done |
| Handoff artifacts | Estado estructurado transportado entre ventanas de contexto |
| While-loop harness | `while :; do cat PROMPT.md \| agent; done` — minimalista, determinista |
| Bounded conversation memory | Preservar solo: objetivos, progreso, archivos críticos, pruebas que fallan |
| Filesystem memory | El filesystem como memoria persistente entre turnos |
| Tool masking | Mostrar solo las herramientas relevantes al paso actual |
| Layered verification | Múltiples capas: pruebas unitarias, críticos, ejecución en sandbox |
| Ratcheted gates | Hooks de calidad que solo se endurecen, nunca se aflojan |
| Self-repair loop | Plan → Execute → Validate → Diagnose → Fix → Retry → Report → Escalate |
| N-factor agents | Prompts explícitos, propiedad del estado, pause-resume limpio, logs de event-stream |
| Spec-driven development | Ejecutar agentes contra specs explícitas para resultados predecibles |
| Static capability scanning | Escaneo en CI de capacidades ocultas, credenciales en contexto, endpoints de herramientas no verificados, eval/subprocess en herramientas, interpolación directa de prompts |
| HarnessCard | Descripción del harness en una página (formato CAR) |
| Rehearsal/score-movement | Probar un cambio de pipeline en modo ensayo antes de hacerlo default |
| Evolutionary selection | Elegir versiones de pipeline/agente por `σ(α·performance + β·novelty)` |
| gen_sm → llm_solve | Un modelo planificador genera una máquina de estados específica de la tarea una vez (baja temperatura, cacheable); un modelo ejecutor más barato corre dentro de sus restricciones |
| MoM escalation | Escalera Mixture-of-Models: nivel barato → nivel medio → nivel frontera, cada uno con sus rasgos; escalar ante fallo |
| Per-state model routing | Estados baratos → modelos pequeños, estados caros → modelos frontera |
| Fork/join | Sub-pasos independientes (lint/test/docs) en paralelo, join all/any |
| Conversation retention by model size | Limpiar contexto por ciclo para modelos pequeños, por fase para medianos, conservar todo para grandes |

### Principios de gestión de contexto

1. La ventana de contexto = presupuesto de memoria de trabajo, no un
   vertedero.
2. Los fallos útiles permanecen en contexto — conserva qué salió mal para
   el diagnóstico.
3. Prevenir la deriva de contexto — la reanudabilidad necesita una
   estructura de contexto estable.
4. Backpressure sobre trabajo de bajo valor — no quemes contexto en ruido.
5. Memoria acotada — preserva solo objetivos, progreso, archivos críticos,
   pruebas que fallan.

### Conjunto de guardarraíles de máquina de estados (12)

Guardarraíles que un harness de máquina de estados puede aplicar ("los
agentes son sugerencias, los estados son leyes"):

| Guardarraíl | Efecto |
|---|---|
| Per-state tool enforcement | El agente ve/puede llamar solo a `allowed_tools` del estado actual |
| Shell discernment | Bloquear `echo > file`, `rm -rf`, editores in-place, intérpretes de scripts |
| Edit guards | Rechazar diffs > `max_edit_lines`; techo de archivos tocados por estado |
| Command allow-lists | Solo comandos que coincidan por prefijo (p. ej. el test runner) |
| Conditional transitions | Guards programáticos: `test_result eq pass` |
| Approval gates | `requires_approval` pausa para revisión humana |
| Interrupts | Tocar un archivo auto-transiciona a un estado de validación |
| Fork/join | Ramas secuenciales o paralelas; `join: all|any` |
| Environment scoping | Ocultar env sensible (`blocked_env`), sustituir vía `env_overrides` |
| Session isolation | Estado clavado por id de sesión |
| Per-state model routing | Elección de modelo a nivel de estado |
| Thinking-level control | Esfuerzo de razonamiento por estado (high/medium/low/off) |
| Escalation detection | Avisar cuando un estado salta ≥2 niveles de privilegio sin aprobación |

### Registro de rasgos de modelo (forma)

Registro conductual por modelo para que el harness adapte prompts/límites:

| Campo | Significado |
|---|---|
| `tool_mode` | native / raw / auto |
| `reasoning` | bool — emite un campo de razonamiento |
| `response_field` | qué campo lleva la respuesta |
| `history_window` | turnos retenidos (menor para modelos pequeños) |
| `max_full_read_lines` | límite de lectura sin rangos |
| `max_diff_lines` | umbral de diff sobredimensionado |
| `unescape_tool_args` | el modelo doble-escapa JSON |
| `single_quote_json` | el modelo usa JSON con comillas simples |
| `num_ctx` | override de la ventana de contexto |

Orden de resolución: defaults → familia → tamaño → tag. Hallazgos
empíricos que vale la pena recordar: los tamaños de contexto por defecto en
runners locales suelen ser peligrosamente pequeños (elévalos
deliberadamente); los modelos de razonamiento emiten formatos no estándar
(JSON+texto mezclados, campos de razonamiento, tokens especiales); el modo
de herramientas raw-JSON es el default portable — los modos nativos son
optimizaciones; la minimización de contexto por estado es el mayor factor
individual para que los modelos pequeños funcionen en tareas no triviales.

## Digest por checklist (qué aporta cada referencia)

| Referencia | Estructura | Principios estructurales |
|---|---|---|
| definition-of-done | 5 ejes (corrección, calidad, integración, docs, ship-readiness) + red flags | El trabajo no verificado no está hecho; runtime-verified es obligatorio; DoD y criterios de aceptación son puertas complementarias |
| security-checklist | threat model → pre-commit → authn/authz → validación de entrada → headers/CORS → datos → deps → LLM → errores → OWASP×2 | La salida del modelo no es confiable; los permisos se aplican en código, no en prompts; acota los permisos de herramientas; acota el consumo |
| observability-checklist | preguntas de guardia → logs → métricas → trazas → alertas → paneles → verificar → puerta de lanzamiento | La telemetría sin pregunta es ruido; métricas=que, trazas=dónde, logs=por qué; sin etiquetas no acotadas; verifica la telemetría de extremo a extremo |
| orchestration-patterns | 5 endosados + 4 anti-patrones + flujo de decisión | El usuario/comando es el orquestador; las personas nunca llaman a personas |
| testing-patterns | AAA, naming, aserciones, mocks, componente, API, E2E, anti-patrones | Mockea solo en las fronteras |
| performance-checklist | objetivos CWV → TTFB → frontend → backend → medición → anti-patrones | Datos de campo primero; prueba en hardware de gama media |
| accessibility-checklist | teclado, lector de pantalla, visual, formularios, contenido + patrones/herramientas/ARIA/anti-patrones | La automatización solo cubre una parte; no probado ≠ aprobado |

## Glosario

| Término | Significado |
|---|---|
| Harness | Todo lo que rodea al agente: prompts, herramientas, estado, guardarraíles, orquestación |
| CAR | Control-Agency-Runtime — 3 dimensiones para documentar un harness |
| gen_sm / llm_solve | El planificador genera una máquina de estados una vez; el ejecutor corre dentro de ella |
| MoM | Mixture of Models — escalar entre niveles de modelo por dificultad |
| Model traits | Capacidades por modelo (modo de herramientas, contexto, campo de respuesta) |
| RED / USE | Conjuntos de métricas Rate·Errors·Duration / Utilization·Saturation·Errors |
| Handoff artifact | Estado estructurado entre ventanas de contexto |
| Bounded memory | Preservar solo objetivos, progreso, archivos críticos, pruebas que fallan |
| Ratchet | Mecanismo unidireccional: la calidad sube, nunca se relaja |
| Rehearsal | Probar un cambio de pipeline antes de hacerlo default |
| Capability scanning | Escaneo estático en CI de riesgos de herramientas del agente |
| Fork/join | Ramas paralelas que se reúnen al completarse all/any |

<!-- Cross-references: → see skills-engineering.md, orchestration-patterns.md, task-domain.md, quality-floor.md -->
