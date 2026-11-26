# Perfiles de workflow por tipo de tarea

Guías de fases por `type` de tarea, recuperadas a partir de las máquinas de
estado legacy por tipo (`task-system/workflows/*.json`) y adaptadas al ciclo
de vida genérico. **Solo guía**: el enforcement corresponde siempre a la
máquina C0 en `policy/workflow.json`
(`PLAN→ACT→VERIFY→EVALUATE→REVIEW→ACCEPT→CLOSE`). Los perfiles indican qué
fases aplican y en qué orden; nunca autorizan saltarse un estado del ciclo
de vida.

## Detección

La clave de perfil es el campo declarativo `type` del registro
(`bug|feature|refactor|research|docs|ops|mixed`) — fijado en la creación o
vía `task meta`. No existe un clasificador de tipo: una tarea sin `type`
declarado no recibe perfil. `docs|ops|mixed` siguen el bucle genérico sin
una guía por tipo.

## Vocabulario de fases

Cada perfil lista fases en orden. Una fase nombra el foco del trabajo, el
estado del ciclo de vida en el que vive, orientación de iteraciones no
vinculante (un tope blando — excederlo significa reevaluar, no forzar un
fallo) y la señal de salida que hace avanzar el trabajo. Un fallo en
cualquier fase retorna según la tabla o a `STALL` para atención del
propietario.

## bug-fix (`type: bug`)

| Fase | Ciclo de vida | Iter. orientativas | Señal de salida |
|---|---|---|---|
| localización | PLAN/RESEARCH | ≤3 | Alcance del bug capturado: file:line y evidencia de reproducción en el registro |
| planificación | PLAN | ≤5 | Plan de corrección declarado; aún sin ediciones |
| implementación | ACT | ≤8 | Ediciones dirigidas completadas |
| pruebas | VERIFY | ≤3 | Comprobaciones propuestas ejecutadas por propietario/host; evidencia registrada |
| revisión | EVALUATE→REVIEW | ≤2 | Autocomprobación de corrección/simplicidad/coherencia + radio de impacto |
| aceptación | ACCEPT | ≤2 | Evidencia de aceptación satisfecha |
| cierre | CLOSE | ≤2 | Resultado archivado en el log de progreso |

Fallos: `TESTS_FAIL`/`ISSUES_FOUND`/`REJECTED` vuelven a implementación.

## feature-add (`type: feature`)

| Fase | Ciclo de vida | Iter. orientativas | Señal de salida |
|---|---|---|---|
| especificación | PLAN | ≤3 | Frontera resuelta: firmas, tipos, callers; aún sin código |
| implementación | ACT | ≤10 | Slices incrementales (~100 líneas cada uno), compilando por slice |
| verificación | VERIFY | ≤3 | Evidencia de compilación+pruebas registrada; los fallos vuelven a implementación |
| revisión | EVALUATE→REVIEW | ≤2 | Autorrevisión en tres ejes + radio de impacto |
| aceptación | ACCEPT | ≤2 | DoD: contrato, salidas, radio de impacto, deuda, documentación |
| cierre | CLOSE | ≤2 | Commit (convencional) + log de progreso |

## refactor (`type: refactor`)

| Fase | Ciclo de vida | Iter. orientativas | Señal de salida |
|---|---|---|---|
| auditoría | PLAN/RESEARCH | ≤3 | Objetivos e invariantes enumerados; plan de movimiento declarado |
| migración | ACT | ≤15 | Cambio estructural aplicado |
| limpieza | ACT | ≤3 | Residuos eliminados; los estados sucios vuelven a migración |
| verificación | VERIFY | ≤3 | Comportamiento preservado: mismas comprobaciones en verde que antes del cambio |
| revisión | EVALUATE→REVIEW | ≤2 | Revisión; los problemas vuelven a migración |
| aceptación | ACCEPT | ≤2 | Evidencia de aceptación |
| cierre | CLOSE | ≤2 | Commit + log |

## research (`type: research`)

| Fase | Ciclo de vida | Iter. orientativas | Señal de salida |
|---|---|---|---|
| delimitación | PLAN/RESEARCH | ≤3 | Preguntas y lista de fuentes declaradas |
| búsqueda | RESEARCH | ≤15 | Fuentes recopiladas |
| extracción | RESEARCH | ≤12 | Hallazgos extraídos por fuente |
| síntesis | RESEARCH | ≤5 | Borrador de respuesta redactado |
| verificación | VERIFY/EVALUATE | ≤3 | Afirmaciones comprobadas contra las fuentes; las lagunas vuelven a búsqueda |
| revisión | REVIEW | ≤2 | Revisión; los problemas vuelven a síntesis |
| aceptación | ACCEPT | ≤2 | Evidencia de aceptación |
| cierre | CLOSE | ≤2 | Registro + log |

## Uso

El paso 0d de `iteration-loop` lee este perfil después del pase de
descubrimiento de skills y aplica las fases en orden. Los números de
iteración por fase son presupuestos orientativos (comparar con
`budgetDefaults.maxIterations` para el equivalente en operaciones
registradas); la máquina del ciclo de vida es la única autoridad sobre qué
transiciones son legales.
