---
name: plan-execution
description: Ejecutar un plan aprobado de extremo a extremo — bucle orquestador, protocolo por tarea, puertas, recuperación y cierre.
---
# Plan Execution

Dos capas, un archivo: **Parte A — el bucle orquestador** que recorre un
plan aprobado despachando una tarea cada vez a contextos delegados frescos;
**Parte B — el protocolo de tarea única** que todo delegado (o un fallback
inline) ejecuta a profundidad completa. Cargado por `coordinate-plan` para
una ejecución de plan completo e incrustado en cada brief de worker que
despacha. Toda tarea pasa DISCOVERY → EXECUTION → CLOSURE; nunca prompts de
tarea inline de siete líneas.

Las puertas de preguntas D/V/C aplican dentro de cada delegado por
`decision-request`; el orquestador no repregunta lo decidido. La
recuperación de cualquier resultado no-DONE sigue `recovery-brief`. Los
bloques de handoff siguen `session-recitation`.

Las mutaciones de estado, registros de verificación, lecturas de plan,
escrituras de memoria, seguimiento de sesión, presupuestos y eventos de
journal pasan por el runtime de tareas del harness cuando está vinculado;
si no, persistir los registros equivalentes bajo `.scopegrain/` a través de
operaciones de harness aprobadas. Bajo verificación manual, proponer
comandos + directorios exactos; el propietario los ejecuta y devuelve la
salida — nunca afirmar que una comprobación no ejecutada pasó.

## PARTE A — Bucle orquestador

Parámetros: `FAIL_MODE = stop | skip | parallel` (declarado por ejecución).
`stop`: detenerse en el primer fallo. `skip`: registrar y continuar.
`parallel`: ejecutar tareas independientes en olas de dependencias.

1. **Leer el plan** a través del runtime: identidad del plan, resumen
   (completadas/fallidas/pendientes), bloque de continuación, siguiente
   tarea lista. Sin plan → reportar y parar.
2. **Seguimiento de sesión:** abrir un registro de sesión al inicio;
   actualizarlo por tarea completada; escribir el estado final al terminar.
3. **Sondas de integridad antes de empezar:** (a) el plan existe y tiene
   tareas; (b) el bloque de continuación es legible; (c) la misma tarea no
   se repite sin progreso; (d) `git status` está limpio o los cambios
   pertenecen a esta ejecución; (e) cualquier capacidad de índice/grafo
   declarada está lo bastante sana para los archivos clave de la tarea —
   reindexar solo si la comprobación dice que las rutas necesarias están
   obsoletas. Una sonda fallida → preguntar al propietario antes de
   continuar.
4. **Reclamar la siguiente tarea lista atómicamente** a través del
   runtime: una segunda instancia no debe arrancar discovery sobre la
   misma tarea. Si el reclamo está bloqueado, tomar la siguiente tarea
   pendiente o esperar. Sin tareas pendientes → campaña completa (§A.7).
5. **Mientras existan tareas pendientes — por tarea, a profundidad
   completa:**

   a. Identificar `id`, descripción, contrato, archivos clave y su ruta
      declarada (rol destino). Si ya existe un registro de tarea, leerlo
      para saber dónde paró (pasos hechos/pendientes, punto de guardado
      de contexto).
   b. Si `FAIL_MODE=parallel` y ≥2 tareas independientes → ir a §A.6
      (olas).
   c. **Sin carga de skills del orquestador:** el pase real de
      descubrimiento de skills corre dentro del delegado (Parte B, paso
      0b). El orquestador solo detecta el tipo para enrutar — nunca doble
      carga.
   d. **Aislamiento de investigación:** si la tarea necesita muchos
      archivos (3+) o docs pesadas, lanzar PRIMERO un delegado de
      investigación de solo lectura (formato digest `research-brief`),
      conservar el digest, pasarlo al brief de ejecución — no debe
      consumir el contexto del ejecutor.
   e. **Enrutado — nunca delegados genéricos.** Mapear la ruta declarada
      de la tarea a un rol autorizado disponible (implementer por
      defecto; security-auditor para superficies de seguridad/entrega;
      researcher para investigación; documentation para docs;
      performance-engineer para perf; lead para release/coordinación).
      Tomar solo el primer token si la ruta porta un parentético como
      "(with review by X)" — la revisión secundaria es tu comprobación
      posterior (paso i).
      Sin ruta, enrutar por tipo detectado. Sin ninguna capacidad de
      delegado autorizada, proponer ejecución secuencial supervisada — no
      afirmar fan-out.
   f. **Lanzar UN delegado de ejecución** cuyo prompt referencia la Parte
      B y porta los DIEZ bloques obligatorios:

      1. TASK: objetivo + contrato exacto + criterios de aceptación del
         plan.
      2. FILES: clave (con :line) + relacionados (callers/callees) +
         prohibidos (WIP de otras sesiones que NO debe tocarse).
      3. DEPENDENCIES: ola + tareas bloqueantes + tarea
         anterior/siguiente.
      4. REFERENCES: docs/reglas relevantes del área + la tabla de
         decisiones de la spec (o justificaciones por evidencia) si hay
         superficie pública nueva.
      5. SKILLS: la lista del pase de descubrimiento (≤8) con una línea de
         aplicabilidad cada una — o instruir al delegado a ejecutar el
         pase él mismo.
      6. TOOLS+CHECKS: comandos exactos propuestos (build/lint/test/verify)
         + qué capacidades usar — sin bucles de grep cuando la capacidad
         estructural responde.
      7. CODE INVESTIGATION: radio de impacto resumido (callers →
         callees, implicaciones, riesgo) copiado del registro de tarea.
      8. PROBLEM INVESTIGATION: hipótesis de causa raíz o decisión de spec
         con compromiso.
      9. EXTERNAL RESEARCH: digest ≤500 palabras + URLs verificadas
         (inverificable → marcar `[UNVERIFIED citation]` + registrar como
         deuda del contrato).
      10. VALIDATION+CLOSURE: verify del contrato + verify completo +
          comprobaciones deterministas + DoD por nivel + revisión en
          contexto distinto + puertas activas D/V/C + bloque RESULT
          obligatorio.
      Más: contexto de plan verificado (justificación de puerta,
      pre-mortem, apetito, rama/commit, ola) copiado — NO rederivado — y
      estado del registro de tarea cuando existe (pasos hechos, siguiente
      paso pendiente, resumen de radio de impacto, decisiones de spec,
      deuda/WIP prohibido).

      **Checklist pre-lanzamiento (todo marcado antes de despachar):**
      - [ ] Registro de tarea leído o declarado ausente (→ discovery
            completo dentro)
      - [ ] Los 10 bloques poblados — cero placeholders `{...}`, cero "see
            the plan"
      - [ ] WIP ajeno listado como FORBIDDEN (el orquestador corrió
            `git status` y separó cambios propios vs de otras sesiones)
      - [ ] `file:line` exacto en FILES y REFERENCES
      - [ ] Contrato mecánico copiado verbatim, no parafraseado
      - [ ] Skills listadas con una línea de aplicabilidad cada una
      - [ ] Fallback sin delegados: no improvisar ejecución sin puertas —
            correr la Parte B inline manteniendo los 10 bloques + puertas
            D/V/C + revisión registrada

   g. Esperar el resultado del delegado.
   h. **Validar el registro de puertas** (`decision-request` §registro
      obligatorio): una puerta `fired` debe portar un `BLOCKER:`
      correspondiente; un `BLOCKER:` sin capacidad de preguntas de tu lado
      → escalar. Faltante/inválido → MALFORMED → peldaño de recuperación
      1.
   i. **Clasificar por `recovery-brief`:** COMPLETE → paso j. INCOMPLETE /
      FAILED / MALFORMED / vacío / autodetenido → la escalera de
      recuperación (RESUME misma sesión → RETRY fresco → STRATEGY →
      ESCALATE). Cada recuperación consume el presupuesto de fallos; 3
      no-DONE consecutivos en una tarea → pausar y preguntar al
      propietario.
   j. **Al completar (post-recuperación):**
      - Registrar la transición a través del runtime — la puerta ACCEPT
        está mecanizada: se requiere un payload de revisión válido (revisión
        fresh con contexto revisor ≠ contexto autor + veredicto approve, o
        degraded + renuncia del propietario `{owner, reference, reason}`).
        Reutilizar el propio payload de cierre del delegado si ya cerró la
        tarea; sin un payload válido el registro se rechaza — nunca
        fabricar uno.
      - Reejecutar la comprobación de contrato (doble verificación — sin
        verify, no hay done). Un verify fallido → tratar como INCOMPLETE →
        paso h.
      - Revisión secundaria según el parentético de la ruta (p. ej. "with
        review by the auditor") → hacer fork de ese revisor sobre el diff
        antes de cerrar.
      - **Revisión de coherencia cada 5 completadas:** releer el plan
        completo; verificar estados coherentes, continuación legible, sin
        progreso duplicado. Anotar `Review N/5: OK` en el plan.
   k. **Al agotar la escalera:** registrar failed; incrementar contadores
      de fallos; `stop` detiene la ejecución; `skip` registra y continúa;
      3+ fallos consecutivos fuerzan `stop` sin importar el modo
      declarado.
   l. **Estancamiento:** 3 delegados fallidos consecutivos (incluso
      post-recuperación) → límite de sin-progreso; consultar tareas
      estancadas; pausar y preguntar al propietario.
   m. **Techos de presupuesto:** los presupuestos de operación declarados
      (`policy/operation-limits.json` / contadores del runtime) son
      paradas duras; cada peldaño de la escalera cuenta.
   n. **Checkpoint:** actualizar el registro de estado de ejecución bajo
      `.scopegrain/state` (plan, totales, fallos consecutivos, modo de
      fallo, timestamp ISO).
   o. Releer el plan; tomar la siguiente tarea pendiente.

6. **Olas paralelas (FAIL_MODE=parallel):**
   a. Construir el DAG de dependencias sobre las tareas pendientes
      (aristas `dependsOn` más conflictos por solapamiento de archivos
      detectados por la capacidad estructural).
   b. Agrupar en olas (ola 0 = sin dependencias, ola N = deps en olas
      anteriores).
   c. `MAX_CONCURRENT = min(3, tasks_in_wave)` salvo que el presupuesto
      declarado diga lo contrario.
   d. Reclamar cada miembro atómicamente ANTES de lanzarlo; reclamo
      bloqueado → omitirlo y reportarlo. Lanzar los delegados de la ola
      en paralelo con el mismo brief a profundidad completa (§A.5.f);
      hacer join de todos, clasificar cada resultado individualmente
      (§A.5.i).
   e. Una tarea fallida dentro de una ola no detiene a sus hermanas; las
      olas siguientes NO arrancan. Reporte parcial; la recuperación
      aplica por delegado.
   f. Tras el último commit secuencial, comprobar conflictos en las ramas
      paralelas (`git log --oneline`).

7. **Cuando no quedan tareas pendientes:**
   - Reportar campaña completa: N/M hechas, K fallidas, S estancadas.
   - Registrar progreso para todas las tareas completadas
     (`session-handoff`).
   - Producir la **retrospectiva de cierre** (obligatoria antes de
     parar): Start (seguir haciendo — qué funcionó) / Stop (dejar — qué
     falló) / Continue (sin cambios) + UNA acción de mejora de proceso
     medible con una métrica contra la línea base (p. ej. "reintentos de
     verify por tarea 3→1"). Registrarla en el plan y en registros de
     progreso/decisiones para que se archive con el plan, no solo con las
     tareas movidas.
   - Cerrar el registro de sesión (borrar/cerrar) para evitar sesiones
     obsoletas.
   - Parar.

## PARTE B — Protocolo de tarea única (por invocación: UNA tarea completa)

Seguir esto tanto si se invoca como delegado como si se corre inline.
Procesar exactamente UNA tarea por invocación, luego parar; el bucle
externo maneja la continuación. Si no puedes terminar, devolver el bloque
RESULT con el trabajo hecho — nunca parar silenciosamente; el orquestador
reanuda vía `recovery-brief`.

### B.0 — Configuración de capacidades

- Leer la tarea activa a través del runtime.
- Ejecutar el pase de descubrimiento de skills (`select-capabilities`):
  archivos clave + fase del ciclo de vida (`BUILD`, o `DEFINE` cuando es
  spec-first) + palabras clave del contrato → ≤8 skills con
  justificaciones. Cargar cada una; registrar `SKILLS_LOADED` en el
  registro de tarea y el bloque RESULT; `base-only` cuando no haya ninguna
  más allá de la base. Cargar siempre los pins de política declarados
  cuando existan.
- Bug → añadir `systematic-debugging`. Lógica nueva/compleja →
  `test-driven-development`. Sensible a seguridad →
  `doubt-driven-development` / `security-and-hardening`.
- Leer completamente las reglas/referencias aplicables del área tocada
  antes de discovery. Reejecutar el pase de descubrimiento si la
  investigación revela que el tipo de tarea cambió (p. ej. fix →
  feature-add).

### B.1 — Leer el plan / la tarea

Localizar la tarea por id. Pending o in-progress → ejecutarla. Ya hecha o
fallida → reportar y parar. Si su registro de tarea ya existe, LEERLO y
continuar desde el primer paso pendiente — nunca rehacer pasos hechos ni
sobrescribir trabajo previo; el trabajo parcial vive en el worktree y el
registro.

### B.2 — Por estado

#### Pending → DISCOVERY

- Investigación estructural: callers/callees, radio de impacto transitivo,
  contexto de arquitectura, cobertura de índice — vía la capacidad
  estructural disponible antes que grep/read.
- **Planificación sin código:** antes de escribir código o el registro,
  describir la solución en ≤3 bullets de pseudocódigo: qué archivos
  cambian, qué funciones, qué firma, qué tests. Ambigüedad → investigar
  primero (delegar por `research-brief` cuando sea pesado).
- **Gate D** (`decision-request`): radio de impacto >10 / ruta crítica /
  API pública / contrato ambiguo / feature-add sin spec / **el plan añade
  nuevos símbolos públicos** → preguntar al propietario (GO / ajustar /
  dividir) ANTES de escribir el registro.
- **Puerta mecánica spec-first:** los registros feature-add/lógica-nueva
  necesitan un `## Spec` válido (tabla de decisiones o evidencia por ítem
  — `decision-request` §valid-spec). Inválido → volver a discovery; no hay
  ACT.
- Registrar el discovery en el registro de tarea (`analysis.*`, contrato,
  steps[]) — plantilla completa en `task-brief`. Crear el registro solo si
  está ausente.
- Implementar el primer paso (~100 líneas) y verificarlo.

#### Implementation → bucle ACT

- **Puerta pre-edición (obligatoria):** antes de la PRIMERA edición de
  cualquier archivo, el bloque "Mapped impact" del registro debe estar
  relleno (archivos leídos completamente, referencias entrantes, veredicto
  de impacto). Faltante → volver a discovery.
- Por paso: PLAN → ACT → VERIFY según `policy/workflow.json`; solo las
  acciones permitidas en el estado actual. Antes de un comando
  arriesgado/destructivo usar el mecanismo de aislamiento declarado si
  existe — es contención, no una garantía de seguridad.
- Cada paso ~100 líneas, verificado mecánicamente. Bajo verificación
  manual, proponer el comando exacto; registrar la salida devuelta por el
  propietario.
- **Fallo de verify → escalera de reintentos:** (1) corregir con el error
  procesado — diagnosticar la causa raíz y devolver una instrucción
  precisa, no el error crudo; (2) contexto fresco (digest de ~200 tokens).
  En el umbral único — 2 fallos con el mismo error
  (archivo+línea+mensaje) → **Gate V**: preguntar al propietario
  (reintento fresco / cambio de estrategia / FAILED). Sin respuesta →
  STOP.
- Evaluador-optimizador tras cada verify: corrección, simplicidad,
  coherencia (máx. 2 iteraciones).
- **Fase de seguridad** al tocar límites de confianza (entrada de usuario,
  auth, cambios de dependencias, persistencia, FFI, red): checklist
  `security-and-hardening` + la auditoría de dependencias declarada del
  proyecto.
- **Fase de rendimiento** en rutas críticas declaradas:
  `performance-optimization`; comparar contra una línea base medida; sin
  regresión no documentada.
- **Fork/join dentro de la ejecución:** pasos pendientes consecutivos
  sobre archivos disjuntos sin dependencia mutua pueden correr en
  paralelo (máx. 2 delegados, prompt reducido = paso + contrato); hacer
  join de ambos antes de continuar; un delegado fallido → su propio
  RESUME, hermanos no afectados.
- **Presupuesto:** si el presupuesto declarado se agota sin terminar →
  devolver `RESULT: INCOMPLETE` con el siguiente paso pendiente — NO
  marcar FAILED por presupuesto; el orquestador decide RESUME/RETRY.

#### Closure → VERIFY→EVALUATE→REVIEW→ACCEPT→CLOSE

1. **Puerta de citas (tareas de investigación/evidencia):** resolver cada
   URL citada mecánicamente. No resoluble → la evidencia es inválida:
   reemplazar la fuente o retirar la afirmación. Sin red → marcar cada una
   `[UNVERIFIED citation — no network]` y registrar la comprobación
   pendiente como deuda del contrato; nunca presentarla como verificada.
2. **Verify completo:** la suite de comprobaciones declarada del proyecto
   (format, lint, tests, cobertura de docs), más — cuando el cambio tiene
   código unsafe/concurrente — las opciones de UB/sanitizer/fuzz del
   toolchain si están disponibles; los componentes críticos (parsers,
   serializadores, persistencia) reciben un property test.
3. **Pivote cognitivo (autorevisión):** dejar de implementar; encontrar
   1–3 problemas de seguridad/memoria/ineficiencia/lógica en lo que
   acabas de escribir; corregirlos.
4. **Revisión determinista:** ejecutar las comprobaciones de reglas/lint
   declaradas del proyecto sobre las rutas tocadas; bloqueantes
   corregidos ahora, medios → finding records por `finding-record`, bajos
   descartados.
5. **Evaluador-optimizador — 3 ejes:** (a) corrección — casos límite,
   entrada vacía, límites, nulos, colecciones vacías, acceso concurrente;
   (b) simplicidad — escalera de reutilización (existente > stdlib >
   dependencia existente > código nuevo mínimo); (c) coherencia — mismos
   patrones/nombrado/manejo de errores que el código circundante.
   Recomprobar el radio de impacto completo tras el cambio.
6. **Errores colaterales:** cada uno — pequeño+mismo-archivo → corregir y
   commitear juntos; mayor/otro-módulo → finding record en el momento del
   descubrimiento, nunca solo en notas. No perder el foco en la tarea
   principal.
7. **Puerta self-harness (propose → evaluate → accept):** PROPOSE: leer el
   diff completo, resumir en 3 líneas (qué cambió, por qué, qué contrato
   satisface). EVALUATE booleanos: ¿satisface el contrato? ¿salidas
   generadas validadas? ¿nada fuera del radio de impacto roto? ¿nueva
   deuda técnica? ¿API pública documentada? Todo sí → continuar;
   cualquier no → volver a ACT con la lista de problemas; 2 rechazos
   consecutivos → bloquear y escalar al propietario.
8. **Revisión escalonada por riesgo — contexto distinto (obligatoria):**
   clasificar las rutas tocadas contra la lista de alto riesgo declarada
   del proyecto (contratos de API pública, formatos de
   almacenamiento/wire, parsers, límites de auth/seguridad): coincidente →
   revisión adversarial por un contexto distinto (fallback: autorevisión
   adversarial degradada, marcada degraded + escalada al propietario);
   otras → verify mecánico + veredicto registrado. Un diff mixto es
   adversarial. Sin veredicto registrado la tarea NO está completa.
9. **ACCEPT mecanizado:** registrar la finalización requiere el payload
   de revisión (`decision-request` Gate C): `fresh` — contexto revisor ≠
   contexto autor + veredicto approve; o `degraded` + renuncia del
   propietario `{owner, reference, reason}` registrada en
   decisions/trace. Sin payload → transición rechazada.
10. **Checklist pre-commit:** DoD aplicado · checklist de seguridad
    (datos/auth) · checklist de rendimiento (ruta crítica) · tests pasan ·
    docs afectados actualizados · escalera de reutilización aplicada.
11. **Commit:** staged SOLO de las rutas tocadas por esta tarea — nunca
    `add -A` — mensaje según la convención declarada del proyecto (estilo
    conventional-commits: `type(scope): <ID> — <desc>` + radio de
    impacto / skills / contrato / colaterales en el cuerpo). SOLO LOCAL:
    nunca `git push` — el push requiere autorización explícita del
    propietario.
12. **Aprendizajes:** registrar 1–2 aprendizajes en el log de memoria del
    harness (`lessons`); no editar docs permanentes a mano.
13. **Progreso + punto de guardado de contexto:** `session-handoff`;
    registrar fecha, rama, CI pendiente, decisiones, problemas conocidos,
    siguiente tarea en el registro.
14. **Nota de automejora:** qué fue más difícil de lo esperado, y por qué.

#### In progress → reanudar

Leer el registro de continuación para la posición exacta; continuar desde
el siguiente paso pendiente. Aplican la misma escalera de reintentos y
Gate V. Los hallazgos colaterales se enrutan por `finding-record`
(registrados en el descubrimiento, nunca solo en notas). Archivos fuera
del radio de impacto declarado en `git status` → confirmar el alcance del
commit antes de staged. 2 stalls consecutivos → FAILED (límite de
sin-progreso). Verify excedido por presupuesto → reiniciar el contador
con la razón registrada; no es un fallo.

#### Failed

Registrar por qué falló y qué se intentó (los peldaños de la escalera),
marcar failed a través del runtime, registrar progreso, STOP. No continuar
a la siguiente tarea.

### B.3 — Registro de continuación y bloque RESULT

Tras cada acción, actualizar el registro de continuación por
`session-recitation` (objetivo activo, última acción, resultado, siguiente
acción, contrato + evidencia + invariantes + deuda, siguiente tarea, más el
payload `review` al cerrar). El siguiente contexto debe poder continuar
SIN preguntar al anterior.

Al final de TODA invocación devolver el bloque RESULT verbatim —
definición canónica en `session-recitation`. Semántica de estado aquí:

- COMPLETE: todos los pasos hechos + verify del contrato pasa + commit
  hecho.
- INCOMPLETE: trabajo parcial; actualizar siempre el registro de tarea
  (pasos hechos + punto de guardado de contexto) ANTES de devolver — eso
  es lo que permite la reanudación sin pérdida. Agotamiento de
  presupuesto, parada por aclaración o interrupción aterrizan aquí, no en
  silencio.
- FAILED: escalera interna de reintentos agotada en VERIFY.
- MALFORMED: sin bloque parseable, o una línea GATES_EVALUATED
  faltante/sin razones — el orquestador reinvocará por ella.

Nunca devolver salida vacía, "hecho", ni silencio.

## Reglas de ejecución

- Profundidad unificada: todo delegado sigue la Parte B; el registro de
  tarea es el estado durable — continuarlo, nunca recrearlo.
- El contrato es ley — si no se cumple, la tarea no está completa.
- Verificación mecánica, nunca autorreporte.
- ~100 líneas por paso, un paso por turno, cada paso independientemente
  reversible.
- Sin cambio de alcance: colaterales rápidos corregidos inline; lentos →
  finding records (`finding-record`).
- Regla única de estancamiento: 2 fallos de verify con el mismo error →
  Gate V; sin respuesta → STOP.
- Un delegado solo ve su propia tarea, no el plan completo.
- Tras completar una tarea, STOP — no avanzar a la siguiente.
