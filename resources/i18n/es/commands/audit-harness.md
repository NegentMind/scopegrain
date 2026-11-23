---
name: audit-harness
description: Inspecciona contratos, recursos y afirmaciones de capacidad del harness.
---
# Auditar el harness

Cierra el bucle de «quién vigila al harness»: audita los recursos del
harness (comandos, agentes, skills, prompts, reglas, referencias,
perfiles, descriptores MCP, catálogo) sin tocar el producto. Este
comando es la puerta de autocambio del harness
(`prompts/decision-request`, Gate H): un diff que toca recursos del
harness requiere esta auditoría en verde antes de su commit.

Carga `select-capabilities` y `context-engineering` (presupuesto de
contexto para barridos grandes de recursos). Reglas rectoras:
`rules/resource-integrity`, `rules/mcp-integration`.

## Procedimiento

1. Determina el ámbito: el diff actual dentro del directorio de recursos
   del harness (`git diff --name-only` restringido a él; como fallback,
   el último commit). Sin diff → auditoría completa del árbol de
   recursos y del catálogo.
2. Delega en `harness-maintainer` a través de la capacidad de delegación
   disponible (brief acotado según `prompts/task-brief`: ámbito, solo
   lectura, devolver hallazgos + veredicto). Sin delegación, audita en
   línea e indícalo.
3. Aplica las comprobaciones siguientes; devuelve un veredicto PASS/FAIL
   con evidencia.

## Comprobaciones

- **Integridad del catálogo** — cada entrada del manifiesto/catálogo
  resuelve a un archivo existente; cada destino de alias y modo existe;
  no hay recursos huérfanos ausentes del catálogo; no hay ids
  duplicados.
- **Integridad de enlaces y referencias** — los enlaces internos y las
  referencias entre recursos resuelven; los ids de recursos citados
  dentro de comandos/skills existen en el catálogo. Convenciones de
  skills: `references/skills-engineering`; afirmaciones de descriptores
  MCP: `references/mcp-tools`.
- **Contratos de rutas** — las rutas fuente/proyección, las rutas de
  estado configuradas y los destinos de informes son consistentes y
  están dentro de la raíz de proyecto aprobada; nada escribe fuera de
  ella.
- **Límites de bytes y formato** — los archivos orientados al modelo
  respetan los límites de tamaño declarados y el esquema de frontmatter
  (`name`, `description`).
- **Validación de afirmaciones** — las instrucciones orientadas al
  modelo y las afirmaciones sobre herramientas coinciden con los
  esquemas y capacidades realmente disponibles; las anotaciones de solo
  lectura y el texto de roles no imponen control de acceso; una
  configuración generada, una compatibilidad documentada y un piloto
  nativo son cosas distintas.
- **Consistencia del ciclo de vida** — los límites de responsabilidad de
  comandos/roles, las puertas de aprobación, el comportamiento de
  locks/fallos y las reglas de propiedad temporal son coherentes entre
  recursos.
- **Lint de workflows** — cuando el proyecto registra herramientas de
  lint/typecheck para workflows o archivos de configuración (p. ej. un
  linter de workflows), ejecútalas donde esté autorizado; en caso
  contrario, inspección estática.

## Autoridad y verificación

Solo lectura sobre los recursos del harness: reporta deriva, capacidades
no soportadas y correcciones con evidencia. Un veredicto cita lo que se
comprobó realmente — un recurso no inspeccionado se reporta como no
inspeccionado, no como superado.

## Contrato de salida

1. **Informe:** `<reports path>/harness-<YYYYMMDD>-<HHMMSS>.md` más una
   fila en el índice de informes.
2. **Backlog:** cada hallazgo ≥ medium se registra según
   `prompts/finding-record` — `source` nombra este informe, esquema
   según `references/backlog-format`.

## Señales de alarma

- Autorreparar recursos, activar integraciones o importar reglas
  archivadas dentro de la auditoría.
- Cambios de interfaz sin un mapa de renombrado publicado primero.
- Hallazgos corregidos in situ — las correcciones pasan por
  `implement-task`, nunca dentro de esta auditoría.
- Una auditoría en rojo committeada de todos modos — Gate H bloquea el
  commit del harness y los hallazgos ≥medium se registran como
  registros de hallazgo corregidos en el mismo cambio del harness.

## Entrega

Los hallazgos registrados fluyen a `implement-task`; el triaje de los
nuevos elementos del backlog pasa por `plan-work`.
