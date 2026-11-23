# Áreas de investigación

Deriva las áreas de las interfaces y riesgos del repositorio seleccionado,
no de una lista fija de módulos de otro proyecto.
Cada pregunta necesita una decisión, alcance, fuentes, observaciones,
alternativas e incertidumbre no resuelta. Mantén los hallazgos separados de
las elecciones aprobadas. Los informes de investigación y las decisiones
viven en las rutas configuradas del harness.

## Esquema del registro de módulos

Cuando un proyecto ejecuta investigación por módulo (un comando estilo
`/research <module>` que rellena placeholders en una plantilla compartida),
mantén una tabla de registro canónica. Una fila por módulo — **añadida solo
a través del propio flujo de investigación** (el comando pide al owner los
campos ausentes cuando existe un directorio de módulo sin fila). Nunca
edites una fila existente excepto como resultado de una investigación.

| Campo | Contenido |
|---|---|
| Module | Identificador de directorio/paquete |
| Type | Qué tipo de artefacto es (binding nativo, SDK, wrapper de servidor, conjunto de adaptadores, app de producto, sitio) |
| Ecosystem | Dónde vive el paquete (npm, PyPI, binarios de release, interno al repo) |
| Target users | Quién evalúa/adopta este módulo |
| Minimum competitors | Alternativas nombradas con las que comparar (productos, no categorías vagas) |
| Specific note | Deudas/checkpoints propios del módulo: hallazgos abiertos, preocupaciones de paridad, cobertura de plataformas, vacíos de documentación — con IDs y fechas |

Forma de ejemplo (solo ilustrativa — cada proyecto rellena sus propias
filas):

| Module | Type | Ecosystem | Target users | Minimum competitors | Specific note |
|---|---|---|---|---|---|
| `sdk-python` | PyO3 SDK | PyPI | Python/AI devs, agent frameworks | named SDKs + local engines | stub .pyi drift check, error-hierarchy parity, wheels matrix |

## Tablas de apoyo que un registro suele necesitar

- **Plantilla por clase de módulo** — mapear módulo → variante de plantilla
  de investigación (p. ej. los módulos orientados a API usan la plantilla de
  biblioteca; las apps orientadas a usuario usan una variante de producto
  que cubre UX/a11y/rendimiento en lugar de API pública).
- **Competidor primario por defecto por módulo** — el único objetivo de
  comparación para la dimensión de diferenciación.
- **Documento canónico por módulo** — el documento que *debería* existir
  para la superficie de API de ese módulo. "Verifica su existencia; si
  falta, es un hallazgo."

## Disciplina del informe de investigación

- [ ] Cada investigación tiene: decisión a informar, alcance, fuentes,
      observaciones, alternativas consideradas, incertidumbre no resuelta.
- [ ] Los hallazgos se mantienen separados de las elecciones aprobadas por
      el owner — un informe recomienda, no decide.
- [ ] Las celdas del registro corregidas por una investigación llevan el ID
      del hallazgo y la fecha en línea, de modo que la corrección es
      trazable.
- [ ] Los informes y decisiones se almacenan bajo las rutas de estado
      configuradas del harness, no mezclados con la documentación del
      producto.

<!-- Cross-references: → see backlog-format.md, task-domain.md, definition-of-done.md -->
