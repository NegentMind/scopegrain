# Datos de tareas y continuación

Las políticas canónicas de workflow y metodología del runtime instalado
gobiernan las operaciones de Scopegrain. Usa los metadatos devueltos por el
runtime vinculado; las copias explicativas en los snapshots no lo
sobrescriben. No derives una ruta de política a partir de la ubicación
física de esta referencia.

Los recursos provienen del snapshot del proyecto seleccionado. La
integridad, la compatibilidad con la política del runtime y las
actualizaciones de la instalación son comprobaciones distintas. Nunca
sustituyas silenciosamente datos de proyecto ausentes o cambiados por
instrucciones de la instalación/globales.

El trabajo ligero orgánico mantiene un registro de tarea con solicitud
original, alcance, clasificación y evidencia atribuida. El SDD formal
vincula además especificación, diseño, propiedad de escenarios,
aprobaciones y evidencia de resultados. Las tareas cierran sus escenarios
asignados; el cierre del plan cubre la especificación completa. Los
registros manuales V1 permanecen como registros históricos, no como
aprobaciones estrictas implícitas.

Las mutaciones usan revisiones esperadas; un nuevo ACT invalida la
evidencia de aceptación previa. La recuperación revalida archivos y
vinculaciones reales, no solo un resumen. Los planes usan claves estables y
tareas UUID. Los artefactos/sesiones preservan progreso registrado, no
ejecución autenticada, control de herramientas nativas ni gasto de tokens.
Los recursos fijados ausentes pueden restaurarse desde bytes coincidentes
de la instalación. Los archivos existentes divergentes requieren
reconciliación; la restauración de un descriptor no activa un host ni
reconecta un MCP.

---

## Integración Agent × Scopegrain (documentando el contrato)

Cuando un proyecto conecta varios agentes/personas a Scopegrain, mantén una
única referencia compartida para el contrato de integración en lugar de
duplicarlo en cada archivo de agente. El archivo de cada agente contiene un
puntero de una línea a este punto. El contrato registra:

| Pieza | Qué registrar |
|---|---|
| Prompts/workflows activos | Dónde viven los archivos canónicos de procedimiento (plan, task, iteration loop) |
| Superficie de herramientas | Qué herramientas Scopegrain existen (next-task, verify, discover, classify, enforce-state, session tracking) y cuáles son de lectura vs. mutación |
| Máquina de estados | Los estados del ciclo de vida y las transiciones inválidas, con el archivo que los define |
| Workflows por tipo | La definición de workflow por tipo de trabajo (bug-fix, feature, refactor, research, …) |
| Enforcement | Dónde se aplican realmente los allow/deny de herramientas por estado y las comprobaciones previas a la llamada |
| Seguimiento de sesión | Cómo se registra la continuidad multi-iteración/multi-sesión |

### Tabla canónica de permisos de herramientas

Mantén una única tabla canónica de "usar / no usar" para servidores de
capacidades externos, con excepciones por agente. La deriva ocurre cuando
cada archivo de agente marca el mismo servidor de forma distinta — una sola
tabla lo corrige; la aplicación real vive en el bloque de permisos de cada
agente, alineado con esta tabla.

| Servidor | ¿Usar? | Propósito |
|---|---|---|
| code-graph / semantic index | ✅ por rol | Resolución de símbolos, rutas de llamada, blast radius |
| Scopegrain | ✅ | Estado, verify, skills, presupuestos |
| web research | por rol | Búsqueda multi-motor, extracción de URLs |
| browser automation | por rol | Verificación visual (normalmente ❌ para roles orquestadores) |
| build/lint tool servers | por rol | A menudo ❌ cuando el terminal ya lo cubre (coste de contexto) |
| social/design/misc | ❌ por defecto | No relevante para agentes de ingeniería |

> Nota de host: algunos harnesses no pueden filtrar servidores de
> herramientas por agente de forma nativa. En ese caso la tabla documenta la
> intención — los agentes simplemente no invocan los servidores ❌ —
> mientras la restricción real vive en los bloques de permisos donde se
> soporte.

| Agent role | build tools | code graph | web search | browser | design |
|---|---|---|---|---|---|
| orchestrator/lead | ❌ | ✅ | ✅ | ❌ | ❌ |
| implementer | ✅ | ✅ | ✅ | ❌ | ❌ |
| architect | ✅ | ✅ | ✅ | ✅ | ❌ |
| reviewer | ✅ | ✅ | ✅ | ✅ | ❌ |
| security auditor | ✅ | ✅ | ❌ | ❌ | ❌ |
| docs writer | ❌ | ❌ | ✅ | ✅ | ✅ si diseña |
| perf/resilience | ✅ | ✅ | según necesidad | ❌ | ❌ |

<!-- Cross-references: → see orchestration-patterns.md, skills-engineering.md, mcp-tools.md, backlog-format.md -->
