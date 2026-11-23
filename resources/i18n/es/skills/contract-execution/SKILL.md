---
name: contract-execution
description: Úsala al ejecutar una tarea de ingeniería acotada a través del ciclo de vida registrado, con criterios de aceptación, evidencia de verificación, revisión y un traspaso reanudable.
---

# Ejecución de contrato

Ejecuta una tarea contra su contrato registrado: una condición verificable
comprobada por comandos reales, nunca por auto-reporte. El contrato es ley —
si no pasa con evidencia registrada, la tarea no está completa.

1. Lee la configuración aprobada, las reglas de proyecto relevantes y el
   contrato de la tarea.
2. Confirma que el comportamiento no existe ya e identifica los módulos
   afectados.
3. Registra alcance, exclusiones, criterios de aceptación, riesgos y
   estrategia de recuperación.
4. Usa PLAN para investigación y ACT para implementación autorizada.
5. Usa VERIFY para proponer comandos exactos. Espera autorización y
   registra referencias a la salida real; un comando propuesto no es una
   comprobación superada.
6. Diagnostica los fallos sin ocultarlos. Usa COLLATERAL o RESEARCH cuando
   haga falta, y STALL cuando estés bloqueado en una decisión.
7. Usa EVALUATE para auto-evaluación y REVIEW para un revisor separado.
8. Acepta solo verificación actual y una aprobación independiente o una
   exención explícita del propietario con propietario, referencia y razón.
9. Si la implementación cambia, invalida la evidencia vieja y obtén una
   nueva revisión.
10. Al completar o fallar registra el resultado:
    `memory add --log outcomes --input {taskId, outcome: ok|fail, skills:[...]}`.
    Los aprendizajes duraderos pertenecen a `memory add --log lessons`; el
    archivo de avance (`progress`) se escribe automáticamente cuando la
    tarea llega a CLOSE.
11. Guarda archivos cambiados, resultados, evidencia, riesgos sin resolver
    y siguiente acción. Para en el límite acordado. Nunca hagas push ni
    publiques implícitamente.

Los modos de workflow (PLAN, ACT, VERIFY, COLLATERAL, RESEARCH, EVALUATE,
REVIEW, ACCEPT, STALL) están definidos en `policy/workflow.json`.

Las comprobaciones de estado de Scopegrain no interceptan todas las
herramientas nativas del host. No describas el workflow como un sandbox ni
reclames identidad autenticada de revisor.

## Cuándo usar

- Ejecutando **una** tarea acotada y registrada de extremo a extremo —
  ruta ligera o SDD, en esta sesión o como delegado de una ejecución
  coordinada.

No la uses para decidir si la tarea merece un contrato (esa es la
clasificación de `organic-driven-development`), para escribir el plan
(`planning-and-task-breakdown`, `writing-plans`), o para planificar varias
tareas (`plan-coordination`). Esta skill posee el **ciclo de vida por
tarea**: descubrimiento, transiciones de estado, disciplina de verificación
y cierre. El prompt `plan-execution` (Parte B) lo operacionaliza;
`task-brief` contiene la plantilla de registro canónica.

## Fases

### Fase 1 — Descubrimiento (una vez por tarea, solo lectura)

Antes de la primera edición:

- **Auto-clasifica** el tipo de tarea a partir de las rutas afectadas
  (lógica núcleo, interfaz/binding, docs, mixta) y carga las skills y
  comprobaciones correspondientes. Emite el bloque `DECLARED CAPABILITIES`
  de `select-capabilities` antes de la primera edición — una selección no
  declarada es una selección no hecha, y permite al propietario corregir
  una ruta errónea antes de que cueste trabajo.
- **Confirma que la brecha es real:** los archivos y símbolos referenciados
  existen; el comportamiento descrito no está ya implementado; los docs
  coinciden con el código.
- **Mapea el radio de impacto:** llamadores, llamados, implicaciones —
  ¿algo se rompe, cambia el comportamiento público, se necesitan
  migraciones o reindexado, hay tests existentes afectados? Registra riesgo
  bajo/medio/alto.
- **Detecta feature-add:** si el plan añade nuevos símbolos públicos,
  contratos, endpoints o capacidades visibles al usuario, la tarea necesita
  una sección de spec válida según `spec-brief` / `decision-request`
  §valid-spec (tabla de decisión o evidencia por ítem). Una etiqueta de
  tipo como "wrapper" no exime una adición de contrato público.
- **Investiga si hay ambigüedad:** preguntas sobre APIs/patrones externos
  se comprueban contra fuentes oficiales cuando la red está permitida,
  registradas como afirmación/evidencia/confianza en las notas de la tarea.
- **Descompón en pasos atómicos:** una acción por paso, lo bastante pequeña
  para ser individualmente revertible, cada una con una verificación
  mecánica.
- **Puerta de impacto:** cada archivo a modificar o eliminar se lee por
  completo y sus referencias entrantes/salientes se mapean **antes** de que
  se escriba el primer paso de edición. Sin mapa de impacto poblado → sin
  pasos de edición.

### Fase 2 — Ejecución (un paso por iteración)

Transiciones de estado válidas:

```
PLAN → ACT → VERIFY → PLAN        (verify failed → retry)
                ↘ → STALL        (2 same-error failures → owner gate)
                ↘ → COLLATERAL   (passed → handle side errors)
COLLATERAL → RESEARCH            (ambiguity → investigate)
RESEARCH → ACT                   (investigated → implement)
COLLATERAL → EVALUATE            (no errors → self-assess)
EVALUATE → REVIEW                (self-assessment passes → review)
EVALUATE → ACT                   (fails → re-implement)
REVIEW → VERIFY                  (issues found → re-verify)
REVIEW → ACCEPT → CLOSE          (review passes → accept → close)
STALL → ❌ FAILED                (budget/retries exhausted)
```

Escalera de reintento por paso: 1 reintento → contexto nuevo → estrategia
distinta → escalar. **Regla de estancamiento:** 2 fallos de verificación
con el mismo error (archivo+línea+mensaje) dispara la puerta del
propietario (`decision-request` Gate V); sin respuesta → para, no sigas
dando vueltas.

**Errores colaterales:** un bug encontrado mientras se trabajaba en otra
cosa — una corrección rápida (<~30 min) se maneja y registra; una lenta se
enruta a un registro de backlog **en el momento del descubrimiento** según
`finding-record`. Nunca ignorado, nunca corregido en silencio fuera de
alcance, y el alcance de la tarea actual no crece en silencio.

**Un paso, una acción:** cada paso es una única acción sobre un conjunto
acotado de archivos, individualmente revertible. No agrupes pasos en un
solo turno.

### Fase 3 — Cierre (verificación completa)

1. Todos los pasos completos.
2. Verificación completa del contrato: build, test, format, lint y
   cualquier comprobación específica de la tarea — registrada, no
   resumida.
3. Pivote de auto-revisión: relee el diff completo.
4. Evalúa en tres ejes: corrección, simplicidad, consistencia con las
   convenciones del proyecto.
5. Auto-puerta: propón el cambio → evalúa contra el contrato y los
   invariantes → acepta o rechaza.
6. REVIEW por un contexto distinto — los campos de la puerta de revisión
   están definidos en `task-brief` (revisor de contexto distinto, lista de
   verificación anti-hábito, veredicto registrado o exención del
   propietario según `decision-request` Gate C).
7. Registra el resultado, escribe el punto de guardado, cierra.

## Registro de tarea — campos obligatorios

La plantilla de registro canónica vive en el prompt `task-brief`; no la
redefinas. El ciclo de vida requiere que el registro lleve, como mínimo:

- **Metadatos** — referencia de plan, origen, tipo, esfuerzo/prioridad,
  estado, revisión, `last-synced`, y los contadores uphill/downhill de
  abajo.
- **Radio de impacto** — llamadores, llamados, implicaciones; registrado
  antes de las ediciones.
- **Mapa de impacto** — cada archivo a modificar leído por completo,
  referencias entrantes mapeadas, veredicto de impacto. Poblado **antes**
  del primer paso de edición; sin él ningún paso de edición corre.
- **Contrato** — la condición verificable según
  `outcome-driven-development`.
- **Spec** — para tareas feature-add, una tabla de decisión válida o
  justificación de evidencia por ítem según `spec-brief` /
  `decision-request` §valid-spec; `N/A` es inválido y bloquea ACT.
- **Invariantes de dominio** — qué no debe romperse, comandos de
  verificación, deuda pendiente; alimentan el bloque de continuación
  (`session-recitation`).
- **Evidencia de depuración** — solo tareas de bug: repro, hipótesis, una
  variable controlada, una comprobación RED verificada fallando antes de
  la corrección. Sin investigación de causa raíz, no hay corrección.
- **Evaluación de dominio** — seguridad y rendimiento evaluados antes de
  codificar (justifica N/A), según las fases de dominio obligatorias de la
  plantilla.
- **Pasos** — una acción cada uno, archivos, un comando de verificación
  exacto, estado.
- **Revisión** — un contexto distinto al del implementador, la lista de
  verificación anti-hábito, y un veredicto registrado o exención del
  propietario `{owner, reference, reason}` según `decision-request` Gate C.
- **Punto de guardado de contexto** — fecha, rama, CI pendiente,
  decisiones, problemas conocidos, siguiente tarea.

## Reporte de incertidumbre: uphill vs downhill

Reporta el progreso en dos ejes más porcentaje, en cada actualización de
estado:

| Eje | Cuenta |
|------|--------|
| ⬆ uphill | incógnitas abiertas — enfoque sin decidir, dependencia sin verificar, decisión abierta |
| ⬇ downhill | pasos de ejecución restantes — trabajo conocido |
| % | pasos completados |

Una incógnita resuelta pasa a Notas con su respuesta. **Una tarea con
incógnitas abiertas nunca se marca completa, ni siquiera al 100%.** Pasar a
IN PROGRESS sin un enfoque conocido es uphill hasta que el contrato esté
definido.

## Disciplina de refactor — dos sombreros

Un cambio estructural no cambia el comportamiento; un cambio de
comportamiento no viaja dentro de un refactor. Comportamiento y estructura
van en commits separados con comprobaciones en verde entre ellos. Si un
"refactor" necesita tests editados para pasar, cambió comportamiento —
divídelo.

## Definición de Terminado — puerta multinivel

| Nivel | Puerta |
|-------|------|
| Tarea | contrato verificable cumplido + comprobaciones deterministas (format, lint, tests) + las propias comprobaciones del cambio pasan |
| Commit | atómico, mensaje convencional, diff limpio, verificación mecánica (nunca auto-reporte) |
| Entrega | verificación completa, changelog, compatibilidad respetada, puerta de entrega según la política del proyecto |

La tarea cierra solo cuando todos los niveles aplicables pasan; justifica
los niveles no aplicables en Notas.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Lo comprobé, confía en el resumen" | El auto-reporte no es evidencia. El runner dice pass; la prosa del agente no. |
| "El registro es ceremonia" | El registro es lo que sobrevive a un reinicio — el registro acotado es lo que hace legítima la ruta ligera. |
| "El alcance creció un poco, sigo" | El crecimiento no registrado es alcance no autorizado. Registra el hallazgo y reconfirma, o para. |
| "Mismo error, un intento más" | Dos fallos de verificación con el mismo error son la puerta del propietario — pregunta, o para. |
| "Lo revisé yo mismo, está bien" | La revisión del mismo contexto comparte los puntos ciegos del autor; se requiere un veredicto registrado de contexto distinto o una exención del propietario para cerrar. |

## Señales de alerta

- Un paso de edición escrito antes de que el mapa de impacto esté poblado.
- Una comprobación en verde reclamada desde un comando propuesto pero no
  ejecutado.
- Pasos agrupados en un turno, o un paso que no es individualmente
  revertible.
- Evidencia vieja citada después de que la implementación cambiara.
- Un registro feature-add entrando a ACT con `N/A` en la sección de spec.
- Hallazgos colaterales guardados en notas en lugar de un registro de
  hallazgo.
- Una tarea cerrada al 100% de pasos con incógnitas abiertas aún uphill.
- Aceptar la propia revisión del implementador como el veredicto
  independiente.

## Verificación

- [ ] El descubrimiento fue de solo lectura y la brecha se confirmó real
      antes de cualquier edición
- [ ] Mapa de impacto poblado antes del primer paso de edición
- [ ] Cada paso ejecutó su verificación con salida registrada
- [ ] El contrato pasó por salida de comando registrada, no por
      auto-reporte
- [ ] Las incógnitas abiertas llegaron a cero; los hallazgos colaterales
      se registraron
- [ ] Revisión por un contexto distinto (o exención explícita acotada del
      propietario) registrada en el registro de tarea
- [ ] Punto de guardado escrito; resultado registrado en memoria
- [ ] Cerrado en el límite acordado — sin siguiente tarea, push o
      publicación implícitos
