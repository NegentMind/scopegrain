---
name: audit-web-performance
description: Evalúa una carga de trabajo web autorizada con evidencia de rendimiento reproducible.
---
# Auditar el rendimiento web

Dirigido específicamente a aplicaciones web. No lo uses para bibliotecas
de utilidades, CLI o código solo de servidor sin salida orientada al
navegador.

Checklists: `references/performance-checklist`,
`references/observability-checklist`. Reglas rectoras:
`rules/frontend-web`, `rules/evidence`.

## Modos

| Modo | Activación | Clase de evidencia |
|---|---|---|
| `deep` | Existe alguna entrada medida | Solo valores con fuente |
| `quick` | Por defecto — sin entradas medidas | Cada hallazgo etiquetado `potential impact` — sospecha estática, no una medición |

**deep** se activa cuando cualquiera de estas entradas está disponible:

- Un informe JSON de herramienta de laboratorio (p. ej. archivo de
  salida de Lighthouse/PSI o JSON pegado).
- Una respuesta de API de datos de campo (p. ej. CrUX), donde el
  proyecto posee una clave autorizada.
- Un artefacto de traza de rendimiento del navegador.
- Una URL en vivo más herramientas de navegador autorizadas para
  capturar métricas directamente.
- Equivalentes CLI locales cuya salida JSON suministra el propietario.

### Patrones del modo quick

- Bundles JS grandes: sin code splitting, sin lazy loading.
- Imágenes sin optimizar: dimensiones ausentes, sin lazy loading.
- Recursos que bloquean el renderizado: scripts sin defer/async.
- Cabeceras de caché ausentes: sin política `Cache-Control`/`ETag`.
- Riesgos de layout shift: embeds sin dimensiones, fuentes de carga
  tardía.
- Tareas largas del hilo principal (>50ms) visibles en la estructura del
  código.

## Paso 1 — Confirmar ámbito y permiso

Confirma la superficie web, la carga de trabajo, los dispositivos, el
resultado de usuario relevante y el permiso para arrancar un
servidor/navegador o contactar una URL externa. Ningún modo implica
permiso para instalar herramientas. Quick apunta a la ruta crítica
acordada; deep se expande a los escenarios representativos acordados.

## Paso 2 — Ejecutar la auditoría

Delega en `performance-engineer` a través de la capacidad de delegación
disponible (en caso contrario, ejecuta en línea e indícalo). Carga
`performance-optimization`, `observability-and-instrumentation` y la
capacidad de captura de navegador cuando una página en vivo esté
autorizada. Pasa explícitamente:

- Los archivos, componentes o diff bajo revisión.
- Rutas de artefactos o JSON pegado (informe de laboratorio, datos de
  campo, traza).
- La URL o nombre de página objetivo cuando se conozca.
- El modo esperado (quick/deep) para que las entradas de deep ausentes
  afloren pronto.

Alternativa más ligera: `verify-work quick` cuando solo se necesitan
las comprobaciones mecánicas registradas, no una pasada de perfilado.

## Paso 3 — Informar

El auditor devuelve una scorecard poblada **solo con valores con
fuente**, una lista de hallazgos ordenada, observaciones positivas y
recomendaciones proactivas. Registra entorno, comando, entrada,
resultados en bruto, varianza y cobertura ausente. Usa baselines
existentes; nunca inventes umbrales, puntuaciones o mejoras.

## Autoridad y verificación

Los permisos son por efecto: arrancar un servidor, controlar un
navegador y contactar una URL externa se confirman cada uno, ninguno
está implícito en el modo. No afirmes rendimiento de usuarios reales ni
conformidad de accesibilidad a partir de una ejecución sintética, una
captura de pantalla o una revisión estática. No modifiques el producto
aquí; las correcciones pasan por el backlog e `implement-task`.

## Contrato de salida

- Informe: `<reports path>/webperf-<mode>-<YYYYMMDD>-<HHMMSS>.md` bajo
  la ruta de informes configurada más una fila en el índice de
  informes.
- Cada hallazgo ≥ medium se registra según `prompts/finding-record` —
  `source` nombra este informe, esquema según
  `references/backlog-format`.
- Devuelve el informe completo — comando de una sola persona, sin paso
  de fusión.

## Señales de alarma

- Umbrales, puntuaciones o mejoras inventadas sin baseline.
- Hallazgos `potential impact` presentados como regresiones medidas.
- Afirmaciones de usuarios reales o de conformidad a partir de evidencia
  sintética.
- Herramientas instaladas porque el modo parecía necesitarlas.

## Entrega

Los hallazgos fluyen a `implement-task` a través del backlog; una
recomprobación mecánica usa `verify-work quick`.
