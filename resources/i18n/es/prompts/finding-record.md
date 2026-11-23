---
name: finding-record
description: Enrutar defectos descubiertos durante la ejecución a registros de backlog en el momento del descubrimiento — nunca solo en notas.
---
# Finding Record

Enrutado canónico para bugs, errores y fallos descubiertos mientras se
ejecuta una tarea o un plan. Otros prompts REFERENCIAN este archivo; nunca
lo redefinen. Cargado en el momento del descubrimiento dentro de cualquier
ejecución de tarea o plan, y por flujos de revisión/auditoría que registran
hallazgos derivados; la salida es un registro de backlog creado en el
descubrimiento, referenciado — no copiado — por el registro de tarea.

## Qué cuenta como hallazgo

Cualquier defecto descubierto durante la ejecución que NO es el objetivo de
la tarea actual. El propio defecto de la tarea actual se corrige mediante
su flujo normal de depuración (`systematic-debugging`), no como un
hallazgo.

## Regla única

**Todo hallazgo no corregido inline nace como registro de backlog EN EL
MOMENTO DEL DESCUBRIMIENTO — no en el cierre.** El registro de plan/tarea
solo lo referencia. Registrar hallazgos solo en notas de plan, bloques de
continuación o mensajes de commit los pierde cuando el plan se archiva.

## Inline vs registro — decisión del agente

Decidir caso por caso si corregir ahora o registrar. Única restricción:
una corrección inline sigue el flujo completo de bug (causa raíz
obligatoria, sin refactor "ya que estoy") y aterriza en el mismo commit
`fix:`. Ante la duda → registrarlo: un registro es barato; un hallazgo
perdido no.

## Formato de registro

Usar el esquema de backlog declarado del proyecto. Para registros de tarea
del harness, crear un registro de tarea en el backlog por defecto con los
campos de la capa semántica:

- **Clave:** una clave de hallazgo según la taxonomía registrada del
  proyecto (convención portable: `FIND-<n>`, continuando el número
  existente más alto — localizarlo buscando en el backlog). UN esquema
  para TODOS los hallazgos derivados: hallazgos de auditoría, revisión,
  investigación y ejecución lo comparten. No crear prefijos nuevos por
  campaña o herramienta — la trazabilidad vive en el campo `source`, no en
  el prefijo.
- **Severity / Effort / Priority:** de la capa semántica (`critical|high|
  medium|low|info`, `hours|day|days|weeks`, `p0..p3|backlog`). La
  prioridad por defecto es la más baja; el siguiente triage de
  planificación la ajusta.
- **Type:** `bug` (o el kind correspondiente).
- **Location:** `file:line` del defecto.
- **Description:** qué se encontró + acción propuesta.
- **Source (obligatorio):** el id de plan, id de tarea y commit donde se
  descubrió (`source: "<plan>#<task> · commit <hash>"` o los enlaces
  `relations` equivalentes).
- **State / disposition:** pending, active.
- **Contract:** como todo ítem de backlog — una condición de done
  verificable.
