---
name: performance-optimization
description: Usar cuando una afirmación de rendimiento u optimización necesita evidencia medida específica de la carga de trabajo
---
# Optimización de rendimiento

## Disciplina central

Define primero la carga de trabajo, la métrica, el entorno y una línea base fiable.
Registra los comandos reales y los resultados crudos; no inventes conteos de
muestras, percentiles ni porcentajes de mejora.
Traza el cuello de botella antes de cambiar la implementación.
Compara la misma carga de trabajo y verifica la corrección tras el cambio.
Etiqueta las sospechas estáticas y los efectos no medidos.
No generalices una ejecución local a una población de producción sin evidencia.

Mide antes de optimizar. El trabajo de rendimiento sin medición es adivinar, y
adivinar produce optimización prematura que añade complejidad sin mejorar lo
que importa. Perfila, identifica el cuello de botella real, arréglalo, mide de
nuevo. Optimiza solo lo que las mediciones demuestran que importa.

## Cuándo usar

- Existen requisitos de rendimiento en la spec (presupuestos, SLAs).
- Usuarios o el monitoreo reportan comportamiento lento.
- Las métricas medidas superan umbrales (p. ej. web vitals).
- Se sospecha que un cambio introdujo una regresión.
- Las funcionalidades manejan grandes volúmenes de datos o tráfico alto.

**No aplica para:** optimizar antes de que exista evidencia de un problema.

**Límite de alcance.** Esta skill es dueña del bucle medir→arreglar→re-medir
para un cuello de botella sospechado o probado. La telemetría de producción
siempre activa (métricas RED/USE, tracing, alertas) que aporta la evidencia se
diseña en `observability-and-instrumentation`: instrumenta una vez allí, mide
para optimizar aquí.

## Objetivos de referencia de web vitals

Las tres Core Web Vitals (INP reemplazó a FID en 2024), evaluadas en el
**percentil 75 de cargas de página** a partir de datos de campo:

| Métrica | Bueno | Necesita mejora | Deficiente |
|---|---|---|---|
| LCP (largest contentful paint) | ≤ 2.5 s | ≤ 4.0 s | > 4.0 s |
| INP (interaction to next paint) | ≤ 200 ms | ≤ 500 ms | > 500 ms |
| CLS (cumulative layout shift) | ≤ 0.1 | ≤ 0.25 | > 0.25 |

FCP, TBT y TTFB son diagnósticos de apoyo: útiles para aislar causas, no
forman parte del conjunto Core Web Vitals.

## El flujo de trabajo

```
1. MEASURE  → establish a baseline with real data
2. IDENTIFY → find the actual bottleneck, not the assumed one
3. FIX      → address that specific bottleneck
4. VERIFY   → measure the same workload again, confirm improvement
5. GUARD    → add monitoring or checks to prevent regression
```

### Paso 1: Medir

Usa ambas familias de medición:

- **Sintética** (profilers, herramientas de laboratorio, trazas de CI):
  controlada y reproducible; la mejor para detectar regresiones y aislar
  problemas.
- **De usuarios reales** (telemetría de campo, RUM): requerida para probar
  que un arreglo mejoró la experiencia real del usuario.

Registra los comandos realmente ejecutados y los resultados crudos. Nunca
inventes conteos de muestras, percentiles o porcentajes de mejora. Un número
que no mediste es una afirmación, no evidencia.

**Parte del síntoma:**

```
What is slow?
├── First load
│   ├── Large payload?      → measure transfer sizes, check splitting
│   ├── Slow server?        → measure time-to-first-byte
│   │   ├── DNS long?       → prefetch/preconnect known origins
│   │   ├── TLS/connect long? → newer protocol, edge placement, keep-alive
│   │   └── waiting long?   → profile backend, queries, caching
│   └── Render-blocking?    → inspect the request waterfall
├── Sluggish interaction
│   ├── Freezes on input?   → profile the main thread; long tasks >50ms
│   ├── Input lag?          → check re-render or event overhead
│   └── Animation jank?     → layout thrashing, forced reflows
├── Post-navigation
│   ├── Data loading?       → measure response times, request waterfalls
│   └── Rendering?          → component render time, N+1 fetches
└── Backend / API
    ├── One endpoint?       → profile its queries, check indexes
    ├── All endpoints?      → connection pool, memory, CPU
    └── Intermittent?       → lock contention, GC pauses, external deps
```

### Paso 2: Identificar el cuello de botella

| Síntoma | Causa probable | Investigación |
|---|---|---|
| Primera pintura lenta | assets grandes, bloqueo de renderizado, servidor lento | waterfall, tamaños de assets |
| Desplazamiento de layout | medios sin dimensiones, contenido tardío, fuentes | atribución de desplazamiento |
| Entrada perezosa | trabajo pesado en el hilo principal, actualizaciones grandes del DOM | traza de tareas largas |
| Respuestas lentas | consultas N+1, índices faltantes, consultas no optimizadas | log de consultas |
| Crecimiento de memoria | referencias fugadas, cachés sin límite, payloads grandes | heap snapshot |
| Picos de CPU | trabajo síncrono pesado, backtracking de regex | perfil de CPU |
| Latencia alta | caché ausente, trabajo redundante, saltos de red | traza a través del stack |

### Paso 3: Arreglar antipatrones comunes

**Acceso N+1 (backend)**

```
BAD:  rows = findMany(); for each row → findUnique(related)   // N+1
GOOD: findMany({ include: related })                          // one query
```

**Obtención sin límite**

```
BAD:  findMany()                       // all rows
GOOD: findMany({ take, skip, order })  // paginated, bounded
```

**Medios no optimizados (frontend)**

- Medios LCP/hero: variantes responsive (formatos modernos, `srcset`/`sizes`
  para resolución y dirección de arte), dimensiones declaradas,
  `fetchpriority="high"`.
- Medios bajo el fold: `loading="lazy"`, `decoding="async"`, dimensiones
  declaradas (evita desplazamiento de layout).

**Re-renderizados innecesarios (frameworks de componentes)**

- Mantén estables las referencias de props; extrae constantes fuera de la ruta
  de renderizado.
- Memoriza solo componentes y cálculos probadamente costosos: la memorización
  indiscriminada tiene su propio costo.

**Bundles sobredimensionados**

- Los bundlers modernos hacen tree-shaking de imports nombrados ESM cuando los
  paquetes marcan `sideEffects: false`; perfila antes de cambiar el estilo de
  imports.
- Las ganancias reales vienen del splitting: carga diferida de
  funcionalidades pesadas y poco usadas y chunks por ruta tras un límite de
  carga.

**Caché ausente**

- Cachea datos leídos frecuentemente y raramente modificados con un TTL explícito.
- Assets estáticos inmutables: `max-age` largo + nombres de archivo con hash de contenido.
- Respuestas de API: `Cache-Control` apropiado a la mutabilidad.

### Paso 4: Verificar

Re-mide la **misma** carga de trabajo bajo las **mismas** condiciones que la
línea base, luego verifica la corrección: una optimización que cambia el
comportamiento es un bug. Reporta números antes/después con el comando y el
entorno que los produjo. Etiqueta cualquier efecto esperado pero no medido
como tal.

### Paso 5: Proteger

Establece presupuestos y aplícalos en CI donde el proyecto lo admita:

```
Example budgets:
  JS bundle < 200KB gzipped (initial)   CSS < 50KB gzipped
  image < 200KB above the fold          API p95 < 200ms
  interaction readiness < 3.5s on mid-tier networks
```

Aplicación: comprobaciones de tamaño de bundle, auditorías automatizadas
(p. ej. ejecuciones de lab-score en CI) o la puerta de rendimiento declarada
del proyecto.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Optimizaremos después" | La deuda de rendimiento se acumula; arregla los antipatrones probados ahora, difiere las microoptimizaciones. |
| "En mi máquina es rápido" | Tu máquina no es la del usuario. Perfila en hardware y redes representativos. |
| "Esta optimización es obvia" | Sin medición no lo sabes. Perfila primero. |
| "Los usuarios no notarán 100ms" | Las pequeñas demoras afectan el comportamiento de forma medible; los usuarios notan más de lo asumido. |
| "El framework lo maneja" | Los frameworks previenen algunos problemas; no pueden arreglar consultas N+1 ni bundles sobredimensionados. |

## Señales de alerta

- Optimización sin datos de perfilado que la justifiquen.
- Patrones N+1 en acceso a datos.
- Endpoints de listado sin paginación.
- Medios sin dimensiones, carga diferida o variantes responsive.
- Tamaño de bundle/payload creciendo sin revisión.
- Ninguna señal de rendimiento en producción.
- Memorización por todas partes: el abuso es tan dañino como el desuso.
- Una ejecución local generalizada a una población de producción sin evidencia.

## Contrato de salida

Una optimización produce evidencia, no adjetivos:

- La carga de trabajo, métrica, entorno y línea base definidos (comandos +
  resultados crudos).
- El cuello de botella identificado: trazado, no asumido.
- Mediciones antes/después sobre la misma carga de trabajo y condiciones.
- Confirmación de corrección: las comprobaciones declaradas del proyecto
  siguen pasando.
- Efectos esperados pero no medidos etiquetados como no medidos.

## Verificación

- [ ] Carga de trabajo, métrica, entorno y línea base registrados antes de los cambios.
- [ ] Comandos reales y resultados crudos preservados; sin números inventados.
- [ ] El cuello de botella específico identificado y abordado.
- [ ] Medición posterior tomada sobre la misma carga de trabajo; números reportados.
- [ ] Corrección verificada: las comprobaciones declaradas del proyecto siguen pasando.
- [ ] Presupuestos aplicados donde estén configurados; efectos no medidos etiquetados.
- [ ] Sospechas estáticas separadas explícitamente de hallazgos medidos.

## Véase también

- `resources/references/performance-checklist.md`: listas de verificación
  detalladas, comandos y referencia de antipatrones.
- `observability-and-instrumentation`: la telemetría que prueba que el arreglo
  se mantuvo en producción.
