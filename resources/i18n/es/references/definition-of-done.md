# Niveles de done

La aceptación de una tarea necesita el comportamiento acordado, el alcance,
las comprobaciones relevantes pasando y una revisión independiente o una
exención explícita del owner.
La preparación para commit además necesita un diff pretendido revisado y
coherente. La preparación para release incluye además el entorno objetivo,
la compatibilidad, la autoridad de publicación y una recuperación viable.
Pasar un nivel no autoriza ni establece el siguiente.

Una barra permanente, a nivel de proyecto, que todo cambio debe superar
antes de contar como hecho. A diferencia de los criterios de aceptación,
que varían por tarea y responden "¿construimos lo correcto?", la Definition
of Done es la misma siempre y responde "¿está esto terminado según nuestro
estándar?"

## Definition of Done vs. Criterios de aceptación

| | Criterios de aceptación | Definition of Done |
|---|---|---|
| Alcance | Específicos de una tarea o spec | Se aplica a cada incremento |
| Cambios | Diferentes para cada ítem | Fijos y reutilizados |
| Responde | "¿Construimos *esta cosa*?" | "¿Está *lista*?" |
| Owner | Definidos al planificar la tarea | Definida una vez para el proyecto |
| Ejemplo | "El usuario puede restablecer la contraseña vía enlace de email" | "Las pruebas pasan, sin regresiones, docs actualizadas" |

Ambos son complementarios. Una tarea está hecha solo cuando se cumplen
**sus** criterios de aceptación **y** se satisface la Definition of Done
permanente. Omitir cualquiera deja trabajo que parece terminado pero no lo
está.

## La checklist permanente

Aplica esto a cada cambio antes de declararlo hecho.

### Corrección
- [ ] Se cumplen todos los criterios de aceptación de la tarea
- [ ] El código corre y se comporta como se pretendía, verificado en runtime, no solo compilado o typechecked
- [ ] El comportamiento nuevo está cubierto por pruebas que fallan sin el cambio y pasan con él
- [ ] Las pruebas existentes siguen pasando; sin regresiones introducidas
- [ ] Los casos límite y las rutas de error están manejados, no solo el camino feliz

### Calidad
- [ ] El código revela intención mediante naming y estructura; no hacen falta comentarios para explicar *qué* hace
- [ ] Sin lógica de negocio duplicada
- [ ] Sin código muerto, salida de debug ni bloques comentados olvidados
- [ ] Los cambios están acotados a la tarea; sin refactors ajenos colados
- [ ] Lint y formato pasan

### Integración
- [ ] El cambio funciona con el resto del sistema, no solo aislado
- [ ] Migraciones de base de datos, cambios de config y feature flags están contemplados
- [ ] Compatibilidad hacia atrás considerada para cualquier cambio de interfaz pública o API

### Documentación
- [ ] Las interfaces públicas, APIs y comportamiento visible al usuario están documentados
- [ ] Las decisiones arquitectónicas que vale la pena preservar están registradas como decision records
- [ ] La documentación describe el estado actual en lenguaje atemporal, no el historial del cambio

### Preparación para ship
- [ ] Implicaciones de seguridad revisadas para cualquier entrada no confiable, auth o manejo de datos
- [ ] Observabilidad en su lugar para las nuevas rutas críticas (logs, métricas, trazas)
- [ ] Existe ruta de rollback para cualquier cosa arriesgada
- [ ] Plan de rollback declarado explícitamente en el archivo de la tarea para features que tocan producción o rutas arriesgadas (pasos concretos de revert o un flag-off), con feature flags en su lugar cuando se requiere despliegue gradual
- [ ] El humano ha revisado y aprobado antes del merge o deploy

## Cómo aplicarla

- **Por tarea**: confirma las secciones Corrección y Calidad antes de marcar la tarea.
- **Por feature**: confirma Integración y Documentación antes de considerar la feature completa.
- **Por release**: la checklist completa es el suelo; la puerta de ship añade comprobaciones específicas de deploy encima.
- **Por release — post-release**: verifica en producción que el release no rompió nada antes de cerrar la iteración.
- **Por release — monitorización**: monitoriza logs, métricas y tasas de error como parte de la verificación post-release.

Adapta la lista al proyecto una vez, luego reutilízala sin cambios. Una
Definition of Done que se renegocia cada sprint no es una Definition of
Done.

## Red flags

- "Está hecho, solo que aún no lo he ejecutado": el trabajo no verificado no está hecho.
- "Las pruebas pasan" usado como sinónimo de hecho mientras se omiten docs, regresiones o verificación en runtime.
- Una barra distinta aplicada según la presión de deadline.
- Criterios de aceptación tratados como toda la barra, sin suelo de calidad permanente.
- "Hecho" declarado antes de la revisión humana en cambios que la necesitan.

---

## Contratos compañeros que un proyecto también debería definir

### Definition of Ready (DoR)

Un ítem está listo para entrar al backlog activo solo cuando:

- [ ] La fila/registro usa el esquema canónico de backlog
- [ ] ID único asignado
- [ ] Prioridad definida
- [ ] Archivos involucrados conocidos (`file:line`)
- [ ] Esfuerzo estimado
- [ ] Relaciones / dependencias declaradas
- [ ] Verificado contra el código real (no asumido)

### Comandos concretos de DoD

Más allá de la checklist permanente, nombra los comandos exactos que deben
pasar — el equivalente de "el script verify del proyecto":

- [ ] Compila/typechecka limpio
- [ ] La suite de pruebas pasa
- [ ] El linter pasa con cero warnings
- [ ] Revisión delegada/independiente sin Critical/High abiertos
- [ ] Docs actualizadas si aplica; changelog si es visible al usuario
- [ ] Registro de progreso/tarea actualizado
- [ ] El cambio es publicable: PR abierto con CI verde, o mergeado — la
      tarea termina cuando el trabajo puede publicarse, no cuando se
      commitea

### Puerta de feature publicable (merge a rama de release)

Una feature es **publicable** solo si todo lo siguiente:

- [ ] **(a) Pruebas** — pruebas unitarias que fallan sin la feature y pasan con ella; pruebas de integración donde aplique
- [ ] **(b) Docs** — API/uso actualizado en el mismo cambio; existe un decision record para las decisiones arquitectónicas
- [ ] **(c) Monitorización/observabilidad** — un log o métrica que evidencia que la feature funciona en producción; las rutas críticas tienen logs estructurados o métricas
- [ ] **(d) Rollback viable** — revert limpio del cambio, o flag-off vía feature flag; ninguna migración irreversible bloqueando el revert
- [ ] **(e) Sin cabos sueltos** — toda deuda conocida (stub, atajo, caso límite diferido) está documentada con un ID de backlog; deuda silenciosa = no publicable

**Red flag:** "publica y mira" sin (c) o (d) — si no puede observarse ni
revertirse, no es publicable, es un experimento.

### Capa determinista (puertas mecánicas imposibles de eludir)

Las comprobaciones que deben cumplirse independientemente del tipo de
tarea; aplicadas por tooling, no por juicio. Miembros típicos:

- [ ] Validación de salida: cualquier cosa que el agente generó y vaya a
      ejecutarse (shell, SQL, código, rutas) se valida antes de escribirse
- [ ] Linter con cero warnings; comprobación de formato limpia
- [ ] La suite de pruebas pasa
- [ ] Los diffs unsafe/FFI llevan un invariante de seguridad documentado y
      la verificación extra que el proyecto requiere (p. ej. comprobaciones
      clase Miri)
- [ ] Los componentes críticos (parser, serializador, WAL, protocolo de
      red) están marcados para fuzzing/pruebas de propiedades
- [ ] Reglas de seguridad del lenguaje: sin primitivas de estado mutable
      compartido que no sean thread-safe en código concurrente; sin
      constructos de panic-path sobre entrada no confiable o I/O

### DoD versionada (ratchet)

Umbrales que solo suben, nunca bajan; no puedes saltarte una versión. Una
escalera típica:

| Versión | Añade sobre la anterior |
|---|---|
| v1 baseline | Capa determinista + una checklist de puerta pre-commit (DoD aplicada, checklists de dominio donde sea relevante, pruebas pasan, docs afectadas actualizadas) |
| v2 coverage | Cobertura mínima en módulos nuevos, cero dependencias sin usar injustificadas, un segundo escáner de vulnerabilidades junto al primero, checklist de seguridad obligatoria (no condicional) |
| v3 hardening | Fuzzing obligatorio en cada parser/serializador; cero warnings de auditoría; verificación extendida de código unsafe |
| v4 enterprise | Cero advisories en deny-checks; suelo de cobertura más alto; revisión externa antes del merge |

Regla del ratchet: promoción a la versión siguiente solo tras N tareas
limpias consecutivas en la actual; la versión queda registrada donde la
puerta la lee.

### Checklist de cierre (qué significa "tarea cerrada")

- [ ] Por cada archivo modificado, se comprobó su documento canónico por si necesitaba actualización
- [ ] Datos de la tarea extraídos: ID, nombre, fecha, objetivo, archivos, resultado
- [ ] Fila de backlog manejada según el esquema (las filas completadas se eliminan; las filas descartadas se eliminan + archivan en historia)
- [ ] Entrada de log de progreso/dominio escrita
- [ ] Changelog actualizado solo para cambios visibles al usuario
- [ ] Las comprobaciones de cobertura de docs pasan
- [ ] Decisiones relevantes registradas en la memoria de decisiones con una referencia
- [ ] El código compila y la puerta de pruebas acordada pasa

<!-- Cross-references: → see quality-floor.md, ship-runbook.md, backlog-format.md, test-suite.md -->
