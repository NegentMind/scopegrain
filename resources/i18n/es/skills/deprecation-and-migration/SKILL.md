---
name: deprecation-and-migration
description: Úsala al reemplazar comportamiento, configuración o datos almacenados preservando una ruta de actualización recuperable
---
# Desaprobación y migración

## Disciplina central

Inventaria consumidores, versiones almacenadas y comportamiento real antes
de cambiarlos.
Define contratos origen/destino, periodo de compatibilidad y límite de
recuperación.
Distingue descubrimiento, dry-run, aprobación y mutación.
Prueba estados viejo, nuevo, parcial e interrumpido en fixtures propios.
Nunca borres datos viejos ni reescribas configuración de usuario sin
aprobación específica.
Documenta casos de ruptura y consumidores externos sin resolver
explícitamente.

El código es un pasivo, no un activo — cada línea conlleva coste continuo:
tests, documentación, parches de seguridad, actualizaciones de dependencias,
sobrecarga de onboarding. La desaprobación es la disciplina de retirar lo
que ya no se gana su lugar; la migración es mover consumidores de lo viejo
a lo nuevo de forma segura.

## Cuándo usar

- Reemplazar un sistema, API, biblioteca o formato almacenado por uno
  nuevo.
- Retirar una funcionalidad; consolidar implementaciones duplicadas.
- Eliminar código muerto que nadie posee pero del que todos dependen.
- Planificar el ciclo de vida de un sistema nuevo (la planificación de
  desaprobación empieza en el diseño).
- Decidir si mantener o migrar fuera de un sistema legacy.

## Principios centrales

- **El código es un pasivo.** El valor es la funcionalidad provista, no el
  código. Cuando la misma funcionalidad existe con menos código o mejores
  abstracciones, el código viejo debería irse.
- **La ley de Hyrum hace difícil la eliminación.** Todo comportamiento
  observable — bugs, rarezas de temporización, efectos laterales no
  documentados — puede tener dependientes. La eliminación requiere
  migración activa, no solo anuncio.
- **La planificación de desaprobación empieza en el diseño.** Pregunta
  "¿cómo retiraríamos esto en tres años?" Interfaces limpias, flags y
  superficie pequeña hacen barata la desaprobación futura.

## La decisión de desaprobar

```
1. Does this still provide unique value?        → yes: maintain; no: proceed
2. How many consumers depend on it?             → quantify migration scope
3. Does a replacement exist?                    → no: build it first — never
                                                  deprecate without an alternative
4. What is the migration cost per consumer?     → automatable: do it;
                                                  manual+heavy: weigh vs. maintenance
5. What does NOT deprecating cost?              → security risk, engineer
                                                  time, complexity drag
```

## Advisoria vs obligatoria

| Tipo | Cuándo | Mecanismo |
|---|---|---|
| **Advisoria** (por defecto) | migración opcional, sistema viejo estable | warnings, docs, empujes — los consumidores migran en su propio calendario |
| **Obligatoria** | problemas de seguridad, bloquea el progreso, coste insostenible | fecha límite dura + herramientas de migración provistas, docs y soporte |

Advisoria por defecto. La desaprobación obligatoria te obliga a proveer
herramientas y soporte — un anuncio de fecha límite a pelo no es un plan.

## El proceso de migración

### Paso 1: Construye primero el reemplazo

La alternativa debe cubrir todos los casos de uso críticos, llevar
documentación y guías de migración, y estar probada en producción — no
meramente "teóricamente mejor".

### Paso 2: Anuncia y documenta

```markdown
## Deprecation Notice: OldService
**Status:** Deprecated as of <date>
**Replacement:** NewService (migration guide below)
**Removal:** Advisory — no hard deadline | Hard deadline <date>
**Reason:** <why the replacement wins>
### Migration Guide
1. Replace <old import/call> with <new import/call>
2. Update configuration (examples below)
3. Run the verification script/check
```

Distingue **descubrimiento** (inventario de solo lectura), **dry-run**
(migración simulada, sin mutación), **aprobación** (decisión del
propietario) y **mutación** (cambio real). Nunca saltes de descubrimiento
a mutación.

### Paso 3: Migra incrementalmente

Un consumidor cada vez:

```
1. Identify all touchpoints with the deprecated system
2. Update to the replacement
3. Verify behavior matches (tests, integration checks)
4. Remove references to the old system
5. Confirm no regressions
```

**La regla del churn:** si posees la infraestructura que se desaprueba,
posees migrar a sus usuarios — o provees actualizaciones retrocompatibles
que no necesitan migración. No anuncies y abandones.

### Paso 4: Elimina el sistema viejo

Solo después de que los consumidores hayan migrado:

```
1. Verify zero active usage (metrics, logs, dependency analysis)
2. Remove the code — and only with specific approval, any stored old data
3. Remove associated tests, docs and configuration
4. Remove the deprecation notices
```

## Patrones de migración

### Patrón Strangler

Ejecuta viejo y nuevo en paralelo; enruta el tráfico incrementalmente:

```
0% → 10% (canary) → 50% → 100%; old idle → remove
```

### Patrón adaptador

Traduce la interfaz vieja sobre la implementación nueva; los consumidores
mantienen el contrato viejo mientras el backend cambia por debajo.

### Migración con feature flag

Cambia consumidores de viejo→nuevo de uno en uno tras un flag; revierte por
consumidor sin redesplegar.

### Migraciones de datos almacenados: expand/contract (parallel change)

Un cambio de esquema es la migración más arriesgada — los datos son lo
único que un despliegue revertido no puede deshacer. El modo de fallo es
acoplar el cambio de esquema al cambio de código: renombra una columna en
la misma entrega que empieza a usarla, y durante la ventana de despliegue
el código viejo y el nuevo corren a la vez — uno de ellos consulta una
columna que no existe. **Nunca cambies un campo en el sitio.** Migra en
fases aditivas para que ambas versiones de código sigan válidas:

```
EXPAND ──────────────→ MIGRATE ──────────────→ CONTRACT
add new field,        backfill existing       once no code reads the old
nullable, alongside   rows; dual-write        shape, drop it in a later,
the old               old+new                 separate deploy
```

Ejemplo desarrollado — renombrar `name` a `full_name`:

1. **Expand.** Añade `full_name` nullable. Despliega (el código viejo lo
   ignora).
2. **Dual-write.** Escribe ambos campos en cada mutación. Despliega.
3. **Backfill.** Copia `name → full_name` en lotes, con regulación, fuera
   de la ruta crítica.
4. **Cambia las lecturas.** Lee `full_name`, sigue escribiendo ambos.
   Despliega y deja hornear.
5. **Contract.** Deja de escribir `name`; en un despliegue *separado y
   posterior*, elimínalo.

Cada paso es desplegable y reversible independientemente — si el paso 4 se
comporta mal, revertir sigue dejando `full_name` poblado. Cada fase es una
porción vertical delgada (`incremental-implementation`).

**Reglas:**

- **Aditivo primero, destructivo último y solo.** Los adds son seguros en
  cualquier despliegue; los drops/renames tienen su propio despliegue
  después de que ningún código referencie la forma vieja.
- **Toda migración tiene una ruta de bajada probada.** Una migración
  irreversible es un despliegue que no puede revertirse — escribe y
  ejecuta el `down` antes de fusionar.
- **Backfill en lotes, fuera de la ruta crítica.** Una única actualización
  masiva bloquea el almacenamiento; fragmenta y regula.
- **Construye índices grandes sin bloqueo** donde el motor lo soporte.
- **Desacopla del código mediante flag** cuando el corte es arriesgado.
- **Prueba estados viejo, nuevo, parcial e interrumpido** en fixtures
  propios — incluido un crash a mitad de backfill y una migración
  reanudada.
- **Nunca borres datos viejos ni reescribas configuración de usuario sin
  aprobación específica del propietario.**

## Código zombi

Código que nadie posee pero del que todos dependen — sin mantenimiento, sin
propietario, acumulando vulnerabilidades. Señales: sin cambios en meses con
consumidores activos; sin mantenedor; comprobaciones fallando que nadie
arregla; dependencias con problemas conocidos que nadie actualiza; docs
referenciando sistemas muertos.

**Respuesta:** asigna un propietario y mantenlo, o desapruébalo con un plan
concreto. El código zombi no puede quedarse en el limbo — inversión o
eliminación.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Sigue funcionando, ¿por qué quitarlo?" | El código sin mantenimiento que funciona acumula deuda silenciosa de seguridad y complejidad. |
| "Alguien podría necesitarlo después" | Reconstruible después; mantenerlo "por si acaso" cuesta más cada mes. |
| "La migración es demasiado cara" | Compara contra 2–3 años de mantenimiento; la migración suele ganar. |
| "Desaprobaremos cuando el sistema nuevo esté listo" | La planificación empieza en el diseño; tras la entrega siempre hay prioridades nuevas. |
| "Los usuarios migrarán por su cuenta" | No lo harán. Provee herramientas, docs e incentivos — o migra tú mismo. |
| "Mantener ambos indefinidamente" | Dos sistemas haciendo un trabajo duplican cada coste. |
| "Solo renombra la columna, es una línea" | Durante el despliegue el código viejo y el nuevo coexisten; uno consultará un campo ausente. |
| "Añade y elimina en la misma migración" | Eso acopla un add seguro a un drop destructivo; los drops tienen su propio despliegue. |
| "Escribiremos el rollback si hace falta" | Una migración sin ruta de bajada es un despliegue que no puedes revertir. |

## Señales de alerta

- Desaprobación sin reemplazo, o anuncio sin herramientas/docs.
- Desaprobación advisoria "blanda" durante años sin progreso.
- Código zombi sin propietario y con consumidores activos.
- Funcionalidades nuevas añadidas a un sistema desaprobado.
- Eliminación sin verificar cero consumidores activos.
- Cambio de esquema y código dependiente entregados en el mismo despliegue.
- Campo renombrado/eliminado en el sitio en lugar de expand/contract.
- Migración fusionada sin ruta de bajada probada; un backfill que bloquea
  el almacenamiento.
- Datos viejos borrados o configuración de usuario reescrita sin aprobación
  explícita.
- Evidencia de descubrimiento/dry-run presentada como mutación completada.

## Contrato de salida

Una desaprobación o migración produce:

- El inventario de consumidores y la evidencia de uso (métricas/logs) que
  lo acotó.
- El aviso de desaprobación y la guía de migración con pasos concretos.
- Resultados de verificación por fase — estados viejo, nuevo, parcial e
  interrumpido todos ejercitados en fixtures propios.
- El rastro de aprobación: descubrimiento → dry-run → aprobación →
  mutación, cada uno distinguible; pasos destructivos y borrado de datos
  solo bajo aprobación específica del propietario.
- Casos de ruptura y consumidores externos sin resolver documentados
  explícitamente.

## Verificación

Tras una desaprobación:

- [ ] El reemplazo está probado en producción y cubre todos los casos de
      uso críticos.
- [ ] Existe guía de migración con pasos y ejemplos concretos.
- [ ] Todos los consumidores activos migrados — verificado por
      métricas/logs, no por suposición.
- [ ] Código viejo, tests, docs y config completamente eliminados; avisos
      eliminados.
- [ ] Casos de ruptura y consumidores externos sin resolver documentados
      explícitamente.

Tras una migración de datos almacenados:

- [ ] Fases aditivas (expand → backfill → contract), no una única edición.
- [ ] Código viejo y nuevo ambos válidos contra el esquema en cada paso.
- [ ] Cada migración tiene una ruta de bajada probada; los backfills
      corrieron en lotes regulados.
- [ ] Los pasos destructivos se entregaron en su propio despliegue, después
      de que la forma vieja no tuviera lectores.
- [ ] Estados viejo, nuevo, parcial e interrumpido todos ejercitados en
      fixtures.

## Ver también

- `incremental-implementation` — porciones verticales delgadas por fase de
  migración.
- `chained-pr` — división de entrega cuando el diff de una migración excede
  el presupuesto revisable.
- `api-and-interface-design` — el contrato de reemplazo.
- `systematic-debugging` — traza regresiones a través de rutas
  viejas/nuevas.
