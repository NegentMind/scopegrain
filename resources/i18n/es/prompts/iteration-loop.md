---
name: iteration-loop
description: Ejecutar exactamente una iteración del ciclo de vida de tarea — máquina de estados, acciones por estado y parada dura para depuración paso a paso.
---
# Iteration Loop

Modo avanzado/depuración: procesar EXACTAMENTE UNA iteración del ciclo de
vida por invocación — no una tarea completa. Para el flujo normal usar los
comandos de tarea única o ejecución de plan (`plan-execution`). Este prompt
existe para depurar un pipeline un paso cada vez. Al final: registro de
continuación + STOP.

Las lecturas de estado, transiciones, registros de verificación y contadores
de presupuesto pasan por el runtime de tareas del harness cuando está
vinculado; si no, por los registros bajo `.scopegrain/`. Bajo verificación
manual, proponer comandos exactos y registrar la salida real del
propietario — nunca autorreportar una comprobación.

## Paso 0 — Cargar capacidades

1. Leer la siguiente tarea/activa a través del runtime.
2. Ejecutar el pase de descubrimiento de skills (`select-capabilities`):
   archivos clave de la tarea + fase del ciclo de vida (`BUILD`, o `DEFINE`
   cuando es spec-first) + palabras clave del contrato. Cargar cada skill
   devuelta; registrar `SKILLS_LOADED` en el registro de tarea y en el
   bloque RESULT de la iteración.
3. Bug → `systematic-debugging`. Lógica nueva/compleja →
   `test-driven-development`. Sensible a seguridad →
   `doubt-driven-development`.
4. Leer el perfil de workflow declarado para el tipo detectado, si existe —
   los perfiles de workflow son guía sobre qué fases aplicar y en qué
   orden; el enforcement siempre usa la máquina de estados genérica en
   `policy/workflow.json`. No confundir los dos conjuntos de estados.

## Paso 1 — Leer el estado actual

Leer la tarea activa + su registro de continuación. Una continuación
legible declara la posición exacta; sin continuación o tarea nueva → el
estado es pending.

## Paso 2 — Enrutar por estado

| Estado del registro de tarea | Acción |
|---|---|
| Sin registro / pending | Modo DISCOVERY — investigar, escribir el registro, arrancar el primer paso |
| Existe registro con pasos pendientes | Modo EXECUTION — siguiente paso por la máquina de estados |
| Existe registro, todos los pasos hechos | Modo CLOSURE — verify completo, review, commit, handoff |
| Failed | Documentar, registrar, parar |

## Máquina de estados (policy/workflow.json — sin saltarse estados)

```
PLAN      → ACT | RESEARCH | STALL | ABANDON
ACT       → VERIFY | STALL | ABANDON
VERIFY    → COLLATERAL | EVALUATE | ACT | STALL | ABANDON
COLLATERAL→ RESEARCH | ACT | EVALUATE | STALL | ABANDON
RESEARCH  → PLAN | ACT | STALL | ABANDON
EVALUATE  → REVIEW | ACT | STALL | ABANDON
REVIEW    → ACCEPT | ACT | STALL | ABANDON
ACCEPT    → CLOSE | ACT | STALL | ABANDON
STALL     → PLAN | ABANDON
CLOSE/ABANDON → terminal

Invalid examples: PLAN→EVALUATE (not implemented), ACT→ACCEPT (not
verified), ACT→CLOSE (not reviewed), ACT→REVIEW (not evaluated).
```

### Acciones permitidas por estado

Antes de cada acción, comprobar que está permitida en el estado actual
según `policy/workflow.json` (PLAN: read/research/propose · ACT:
read/edit/propose · VERIFY: read/verify/propose · COLLATERAL/RESEARCH:
read/research/propose · EVALUATE: read/evaluate · REVIEW: read/review ·
ACCEPT/CLOSE/STALL/ABANDON: read).
Una acción denegada significa que el estado es incorrecto — transitar
primero vía una actualización de estado registrada; no realizarla de todos
modos.

### PLAN

- Leer el siguiente paso del registro de tarea.
- Consultar los logs de memoria (`lessons`, registros de decisiones) en
  busca de contexto previo; añadir entradas en el formato declarado, nunca
  editar la historia a mano.
- Decidir el cambio atómico (~100 líneas máx.).
- Escalera de reutilización: implementación existente > biblioteca
  estándar > dependencia existente > código nuevo mínimo.

### ACT

- **Comprobación de alcance (obligatoria):** antes de cualquier edición,
  validar que cada archivo tocado está dentro del radio de impacto
  declarado del registro de tarea. Fuera → no editar; reportar la
  violación.
- **Comprobación de salida (obligatoria):** antes de cualquier
  edición/escritura/comando que GENERE contenido (comandos shell,
  consultas, código generado, rutas de archivo), validar la salida contra
  la política de seguridad declarada. Fallida → corregir la salida
  primero.
- Preferir ediciones quirúrgicas (old/new string) sobre reescrituras de
  archivo completas.
- Los comandos arriesgados/destructivos (rm, format, scripts generados)
  corren a través del mecanismo de aislamiento declarado si existe —
  contención, no una garantía de seguridad. Los efectos destructivos
  necesitan autorización del propietario.

### VERIFY

- Una comprobación mecánica real — nunca autorreporte. El comando
  declarado para el stack (build, typecheck, lint, test).
- Registrar el resultado a través del runtime, o proponer el comando al
  propietario y registrar la salida devuelta bajo verificación manual.

**Pase de diagnóstico ante fallo de verify:** no devolver el error crudo al
implementador. Procesar el error de compilador/test/lint, identificar la
causa raíz (archivo, línea, mensaje) y sintetizar una instrucción técnica
precisa: "el compilador falló en la línea 45: error de lifetime —
reestructurar la función para no devolver una referencia local". Solo
entonces reintentar.

### Escalera de reintentos + Gate V

Umbral único de mismo error = **2**. Cada reintento escala un nivel de
estrategia según la capacidad declarada del harness; no reintentar con el
mismo enfoque más de una vez.

| Fallo | Acción |
|---|---|
| 1º | corregir con feedback de diagnóstico procesado + subir nivel |
| 2º, mismo error (archivo+línea+mensaje) | **Gate V** (`decision-request`): preguntar al propietario — reintento fresco / cambiar estrategia / FAILED |

Nunca marcar FAILED unilateralmente en el umbral: sin respuesta del
propietario → STOP.

### Detección de estancamiento

Un umbral en todo el sistema: **2 fallos de verify con el mismo error →
Gate V**; sin respuesta → STOP. Consultar tareas estancadas a través del
runtime como sonda de apoyo. 2 stalls consecutivos → FAILED (límite de
sin-progreso).

### Fork/join

El trabajo independiente se paraleliza vía contextos delegados frescos —
solo a través de una capacidad autorizada realmente disponible. Las
comprobaciones de cierre que no dependen entre sí (p. ej. format/unused-deps
vs tests post-build) pueden correr como grupos paralelos; hacer join de
todos antes de avanzar. Respetar el techo de concurrencia declarado (por
defecto máx. 3 simultáneos). Un delegado fork INCOMPLETE/vacío/detenido →
`recovery-brief` (RESUME misma sesión → RETRY → STRATEGY → ESCALATE).

## Modo DISCOVERY

1. Detectar el tipo de tarea desde sus archivos clave (implementation /
   bindings / docs / research / mixed) → tipo, skills, comprobaciones,
   estimación de esfuerzo.
2. Ejecutar el pase de descubrimiento de skills si no se hizo en el Paso
   0 — no repetirlo; verificar que `SKILLS_LOADED` está registrado.
3. Investigación estructural: radio de impacto (callers/callees), impacto
   transitivo, contexto de arquitectura, cobertura — vía la capacidad
   estructural disponible antes que grep/read.
4. Planificación sin código: ≤3 bullets de pseudocódigo (archivos,
   funciones, firma, tests) antes de tocar nada; ambigüedad →
   investigación.
5. Gate D (`decision-request`) sobre los disparadores declarados ANTES de
   escribir el registro.
6. Registrar en el registro de tarea: callers/callees/implicaciones/riesgo,
   contrato verificable, herramientas necesarias, solución planeada, pasos
   atómicos.
7. Escribir el registro de tarea bajo la ruta de tareas configurada;
   sincronizar last-updated en plan + tarea.
8. Ejecutar el primer paso (~100 líneas); verificarlo.

## Modo EXECUTION — flujo de pasos

1. Reanudar desde el registro de continuación.
2. PLAN → ACT → VERIFY según la máquina de estados; ejecutar las
   comprobaciones por estado anteriores en cada transición.
3. Fallo de verify → escalera de reintentos con Gate V en el umbral.
4. Errores colaterales: rápidos (pequeños, mismo archivo) → corregir
   inline; lentos → finding record por `finding-record`.
5. Evaluador-optimizador: corrección, simplicidad, coherencia.
6. Puerta self-harness: proponer → evaluar → aceptar.
7. Puerta pre-commit: DoD por nivel + checklists por tipo.
8. Verify registrado del contrato.
9. Presupuestos: límites declarados (`policy/operation-limits.json` /
   contadores del runtime); 2 stalls consecutivos → FAILED.

## Modo CLOSURE

Secuencia completa en `plan-execution` Parte B §Closure — una iteración
cubre UNO de sus pasos: verify completo (grupos paralelos donde sean
independientes) → pivote cognitivo → comprobaciones deterministas →
evaluador-optimizador (3 ejes, máx. 2 iteraciones) → enrutado de
colaterales → puerta self-harness (propose / evaluate de 5 booleanos /
accept; 2 rechazos → escalar) → revisión en contexto distinto escalonada
por riesgo → payload de revisión ACCEPT mecanizado → checklist pre-commit
→ commit selectivo (solo rutas tocadas, convención declarada, LOCAL
solamente — push requiere autorización explícita del propietario) →
`session-handoff` → punto de guardado de contexto (fecha, rama, CI
pendiente, decisiones, problemas conocidos, siguiente tarea) → nota de
automejora.

## Modo FAILED

Registrar por qué falló y qué se intentó (los peldaños de la escalera),
marcar failed a través del runtime, registrar progreso, STOP. No
continuar.

## Paso 3 — Verificar

Solo verificación registrada — el compilador/test runner/linter decide.
Ante fallo → escalera de reintentos. Al pasar → continuar.

## Paso 4 — Actualizar estado

Tras la acción, registrar SIEMPRE la transición + continuación a través
del runtime: in-progress al empezar un paso (continuación apuntando al
siguiente), completed cuando está verificado + commiteado, failed cuando
la escalera se agota. Sincronizar el registro de tarea (paso
done/failed, last-updated). Nunca editar el registro de plan al margen del
runtime — usar sus operaciones.

## Paso 5 — Continuación (handoff entre iteraciones)

Tras cada acción escribir la continuación estructurada por
`session-recitation`: objetivo activo, última acción, resultado, siguiente
acción (archivo + comando), contrato, siguiente tarea. Sin ella la
siguiente iteración arranca perdida.

## Paso 6 — STOP

No proceder a la siguiente tarea ni iteración.

## Apéndice — contratos

La tabla de contrato vago-vs-verificable es canónica en `task-brief`
(apéndice); escribir los contratos de paso contra ella, nunca una
condición vaga.

## Reglas

- Leer la siguiente tarea a través del runtime o del registro de plan
  directamente.
- Capacidad estructural para preguntas de fuente antes que grep/read;
  prosa no indexada vía lecturas acotadas o delegados de solo lectura.
- Presupuesto de contexto: mantener bajo el uso inicial; delegar lecturas
  pesadas en lugar de absorberlas.
- Preferir ediciones quirúrgicas; no cargar capacidades que esta tarea no
  usa.
- Sin prosa defensiva — expresar los problemas cambiando código.
- Sin ampliación de alcance: registrar hallazgos extra por
  `finding-record`, no implementarlos.
- El contrato es ley; la verificación es mecánica; ~100 líneas por paso;
  un paso por turno; cada paso reversible.
- 2 fallos de verify con el mismo error → Gate V; sin respuesta → STOP.
- El registro de continuación ES el handoff — ser específico.
- Tras actualizar el estado, STOP — nunca avanzar a la siguiente tarea ni
  iteración.
