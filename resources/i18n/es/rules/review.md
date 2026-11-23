# Revisión independiente — Reglas

> **Ámbito:** requisitos de independencia, mecánica de exención y foco de
> revisión para la revisión de cambios.
> **No aquí:** fronteras de roles de orquestación (`workflow.md`),
> estándares de evidencia (`evidence.md`), mecánica general de preguntas al
> owner (`human-decisions.md`).
> **Estado:** Active

## Reglas

### 1 — Revisar el cambio y el contrato reales

- **Debe:** el revisor inspecciona el diff o artefacto real y el contrato
  que implementa.
- **No debe:** revisar a partir de un resumen, un plan o una intención
  recordada.
- **Por qué:** el hueco entre el cambio descrito y el cambio real es
  exactamente donde viven los defectos.

### 2 — El contexto que implementa no puede revisarse a sí mismo

- **Debe:** obtener revisión desde un contexto separado — o una exención
  explícita del owner bajo la regla 3.
- **No debe:** dejar que el contexto que escribió el cambio afirme una
  revisión fresca e independiente de él.
- **Por qué:** la revisión en el mismo contexto re-deriva los mismos puntos
  ciegos; es re-lectura, no revisión.

### 3 — Una exención es explícita, nombrada y registrada

- **Debe:** donde la independencia real no está disponible, obtener una
  exención del owner que nombre al owner, la referencia del cambio, la
  razón y la aprobación explícita (`→ see human-decisions.md`).
- **No debe:** proceder sobre una exención implícita o general.
- **Por qué:** la exención convierte una puerta ausente en un riesgo
  registrado y con dueño — una no registrada es solo una puerta omitida.

### 4 — Priorizar corrección, riesgo y pruebas ausentes sobre estilo

- **Debe:** enfocar los hallazgos en comportamiento, contratos, seguridad y
  vacíos de cobertura.
- **No debe:** bloquear un cambio correcto por estilo a nivel de
  preferencia.
- **Por qué:** el presupuesto de revisión gastado en gustos desplaza a los
  defectos que importan.

### 5 — El trabajo nuevo invalida la aprobación previa

- **Debe:** tratar la implementación o verificación realizada tras una
  aprobación como anulándola, según el ciclo de vida de la tarea.
- **No debe:** presentar una aprobación superada como vigente.
- **Por qué:** la aprobación se vincula al contenido revisado; el contenido
  cambiado es contenido sin revisar.
