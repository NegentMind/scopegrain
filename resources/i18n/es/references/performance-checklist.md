# Evidencia de rendimiento

Registra carga de trabajo, tamaño de entrada, entorno, comando, baseline y
resultado crudo. Compara en condiciones equivalentes y ten en cuenta el
ruido de medición. Distingue throughput, distribución de latencia, arranque,
CPU y memoria. Las comprobaciones de corrección siguen siendo necesarias
tras la optimización. Los efectos no medidos y las conclusiones a nivel de
población deben permanecer como desconocidos.

Checklist de referencia rápida para rendimiento de aplicaciones web.

## Tabla de contenidos

- [Objetivos de Core Web Vitals](#objetivos-de-core-web-vitals)
- [Diagnóstico de TTFB](#diagnóstico-de-ttfb)
- [Checklist de frontend](#checklist-de-frontend)
- [Checklist de backend](#checklist-de-backend)
- [Comandos de medición](#comandos-de-medición)
- [Anti-patrones comunes](#anti-patrones-comunes)

## Objetivos de Core Web Vitals

Los umbrales se miden en el **percentil 75** de las cargas de página,
segmentados móvil vs. escritorio — una página solo pasa si las tres
métricas alcanzan "bueno" en p75 (según
[web.dev — Web Vitals](https://web.dev/articles/vitals)).

| Métrica | Bueno | Necesita mejora | Pobre |
|--------|------|------------|------|
| LCP (Largest Contentful Paint) | ≤ 2.5s | ≤ 4.0s | > 4.0s |
| INP (Interaction to Next Paint) | ≤ 200ms | ≤ 500ms | > 500ms |
| CLS (Cumulative Layout Shift) | ≤ 0.1 | ≤ 0.25 | > 0.25 |

## Diagnóstico de TTFB

Cuando el TTFB es lento (> 800ms), comprueba cada componente en el
waterfall de Network de DevTools:

- [ ] **Resolución DNS** lenta → añade `<link rel="dns-prefetch">` o `<link rel="preconnect">` para orígenes conocidos
- [ ] **Handshake TCP/TLS** lento → habilita HTTP/2, considera despliegue en edge, verifica keep-alive
- [ ] **Procesamiento de servidor** lento → perfila el backend, revisa consultas lentas, añade caché

## Checklist de frontend

### Imágenes
- [ ] Las imágenes usan formatos modernos (WebP, AVIF)
- [ ] Las imágenes tienen tamaño responsive (`srcset` y `sizes`)
- [ ] Las imágenes y elementos `<source>` tienen `width` y `height` explícitos (previene CLS en art direction)
- [ ] Las imágenes bajo el fold usan `loading="lazy"` y `decoding="async"`
- [ ] Las imágenes hero/LCP usan `fetchpriority="high"` y sin lazy loading

### JavaScript
- [ ] Tamaño de bundle bajo 200KB gzippeado (carga inicial)
- [ ] Code splitting con `import()` dinámico para rutas y funcionalidades pesadas
- [ ] Tree shaking habilitado (verifica que la dependencia publica ESM y marca `sideEffects: false`)
- [ ] Sin JavaScript bloqueante en `<head>` (usa `defer` o `async`)
- [ ] Computación pesada delegada a Web Workers (si aplica)
- [ ] `React.memo()` en componentes caros que se re-renderizan con las mismas props
- [ ] `useMemo()` / `useCallback()` solo donde el profiling muestra beneficio
- [ ] Tareas largas (> 50ms) fragmentadas para mantener el hilo principal disponible — palanca principal de INP
- [ ] Patrón `yieldToMain` usado dentro de bucles largos para que los eventos de entrada puedan correr entre fragmentos
- [ ] APIs de scheduling modernas usadas donde estén disponibles: `scheduler.yield()` (preferida), `scheduler.postTask()` con prioridades, `isInputPending()` para ceder solo cuando haga falta
- [ ] `requestIdleCallback` para trabajo diferible no urgente (flush de analítica, prefetch, warmup)
- [ ] Trabajo no crítico diferido fuera de los event handlers (p. ej. analítica, logging) para no retrasar la respuesta a la interacción
- [ ] Scripts de terceros cargados con `async` / `defer`, auditados por tamaño, y tras una fachada cuando son pesados (widgets de chat, embeds)

### CSS
- [ ] CSS crítico inline o precargado
- [ ] Sin CSS bloqueante de renderizado para estilos no críticos
- [ ] Sin coste de runtime CSS-in-JS en producción (usa extracción)

### Fuentes
- [ ] Limitado a 2–3 familias tipográficas, 2–3 pesos cada una (cada peso adicional es otra petición)
- [ ] Solo formato WOFF2 (el más pequeño, soporte universal — omite WOFF/TTF/EOT)
- [ ] Auto-hospedadas cuando sea posible (los CDN de fuentes de terceros añaden round-trips DNS + TCP + TLS)
- [ ] Fuentes críticas para LCP precargadas: `<link rel="preload" as="font" type="font/woff2" crossorigin>`
- [ ] `font-display: swap` (u `optional` para no críticas) para evitar FOIT bloqueando el renderizado
- [ ] Subsetted vía `unicode-range` para servir solo los glifos que cada página necesita
- [ ] Fuentes variables consideradas cuando se requieren varios pesos/estilos (un archivo reemplaza a muchos)
- [ ] Métricas de fuente fallback ajustadas con `size-adjust`, `ascent-override`, `descent-override` para reducir CLS en el intercambio de fuente
- [ ] Stack de fuentes del sistema considerado antes de cualquier fuente personalizada

### Red
- [ ] Assets estáticos cacheados con `max-age` largo + content hashing
- [ ] Respuestas de API cacheadas donde proceda (`Cache-Control`)
- [ ] HTTP/2 o HTTP/3 habilitado
- [ ] Recursos preconectados (`<link rel="preconnect">`) para orígenes conocidos
- [ ] `fetchpriority` usado en recursos críticos que no sean imágenes (p. ej. `<link rel="preload">` clave, `<script>` sobre el fold) — no solo en `<img>`
- [ ] Sin redirecciones innecesarias

### Renderizado
- [ ] Sin layout thrashing (layouts síncronos forzados)
- [ ] Las animaciones usan `transform` y `opacity` (aceleradas por GPU)
- [ ] Las listas largas usan virtualización (p. ej. `react-window`)
- [ ] Sin re-renderizados de página completa innecesarios
- [ ] Las secciones fuera de pantalla usan `content-visibility: auto` con `contain-intrinsic-size` para omitir layout/paint de áreas no visibles
- [ ] Sin handlers de evento `unload` y sin `Cache-Control: no-store` en respuestas HTML — preserva la elegibilidad de back/forward cache (bfcache)

## Checklist de backend

### Base de datos
- [ ] Sin patrones de consulta N+1 (usa eager loading / joins)
- [ ] Las consultas tienen índices apropiados
- [ ] Endpoints de lista paginados (nunca `SELECT * FROM table`)
- [ ] Connection pooling configurado
- [ ] Logging de consultas lentas habilitado

### API
- [ ] Tiempos de respuesta < 200ms (p95)
- [ ] Sin computación pesada síncrona en los request handlers
- [ ] Operaciones bulk en lugar de bucles de llamadas individuales
- [ ] Compresión de respuesta (gzip/brotli)
- [ ] Caché apropiada (en memoria, Redis, CDN)

### Infraestructura
- [ ] CDN para assets estáticos
- [ ] Servidor ubicado cerca de los usuarios (o despliegue en edge)
- [ ] Escalado horizontal configurado (si hace falta)
- [ ] Endpoint de health check para el balanceador de carga

## Comandos de medición

### Datos de campo de INP y flujo de trabajo en DevTools

1. **Datos de campo primero** — consulta una fuente de real-user-monitoring
   ([CrUX](https://developer.chrome.com/docs/crux) / CrUX Vis o tu
   herramienta RUM) para el INP de usuarios reales antes de optimizar
2. **Identifica interacciones lentas** — DevTools → panel Performance →
   graba mientras interactúas; busca tareas largas disparadas por
   clics/pulsaciones de teclas
3. **Prueba en Android de gama media** — los problemas de INP a menudo solo
   afloran en hardware más lento; usa un dispositivo real o el CPU
   throttling de DevTools (ralentización 4×–6×)

```bash
# Lighthouse CLI
npx lighthouse https://localhost:3000 --output json --output-path ./report.json

# Bundle analysis
npx webpack-bundle-analyzer stats.json
# or framework-specific analyzer (e.g. @next/bundle-analyzer)

# Check bundle size
npx bundlesize

# Web Vitals in code
import { onLCP, onINP, onCLS } from 'web-vitals';
onLCP(console.log);
onINP(console.log);
onCLS(console.log);

# INP with interaction-level detail (attribution build)
import { onINP } from 'web-vitals/attribution';
onINP(({ value, attribution }) => {
  const { interactionTarget, inputDelay, processingDuration, presentationDelay } = attribution;
  console.log({ value, interactionTarget, inputDelay, processingDuration, presentationDelay });
});
```

## Anti-patrones comunes

| Anti-patrón | Impacto | Corrección |
|---|---|---|
| Consultas N+1 | Crecimiento lineal de la carga de DB | Usa joins, includes o batch loading |
| Consultas sin límite | Agotamiento de memoria, timeouts | Pagina siempre, añade LIMIT |
| Índices ausentes | Lecturas lentas al crecer los datos | Añade índices en columnas filtradas/ordenadas |
| Layout thrashing | Jank, frames perdidos | Agrupa lecturas del DOM, luego agrupa escrituras |
| Imágenes sin optimizar | LCP lento, ancho de banda desperdiciado | Usa WebP, tamaños responsive, lazy load |
| Bundles grandes | Time to Interactive lento | Code split, tree shake, audita deps |
| Hilo principal bloqueado | INP pobre, UI que no responde | Fragmenta tareas largas con `scheduler.yield()` / `yieldToMain`, delega a Web Workers |
| Fugas de memoria | Memoria creciente, crash eventual | Limpia listeners, intervals, refs |

## Disciplina de medición

- [ ] Registra carga de trabajo, tamaño de entrada, entorno, comando exacto,
      baseline y resultado crudo — un número sin contexto no es evidencia.
- [ ] Compara en condiciones equivalentes; ten en cuenta el ruido (ejecuta
      el benchmark suficientes veces para ver la varianza).
- [ ] Distingue throughput, distribución de latencia, arranque, CPU y
      memoria; se mueven de forma independiente.
- [ ] Las comprobaciones de corrección siguen corriendo tras cualquier
      optimización — una respuesta incorrecta más rápida es una regresión.

<!-- Cross-references: → see observability-checklist.md, frontend-web.md, accessibility-checklist.md, ship-runbook.md -->
