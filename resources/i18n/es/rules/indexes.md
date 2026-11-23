# Semántica de índices y búsqueda — Reglas

> **Ámbito:** implementaciones de indexación y búsqueda: semántica de ciclo
> de vida, trade-offs de corrección frente a rendimiento e integridad de
> benchmarks publicados.
> **No aquí:** primitivas de concurrencia (`concurrency-async.md`),
> residencia en memoria (`memory-budget.md`), semántica del lenguaje de
> consulta (`query-dsl.md`).
> **Estado:** Active
> **Fuentes:** auditoría de contrato de benchmark (números ilustrativos en
> riesgo de publicación); política de afirmaciones de rendimiento.

Aplicar solo a implementaciones de indexación/búsqueda. Especificar el
comportamiento de inserción, actualización, borrado, reconstrucción y fallo
junto con la semántica de consulta; probar casos vacíos, duplicados, de
frontera y concurrentes según corresponda. No asumir índices vectoriales,
una métrica de distancia ni un backend concreto — derivar el contrato del
índice del almacenamiento real del proyecto.

## Reglas

### 1 — Las métricas competitivas y de benchmark provienen de ejecuciones reales del harness

- **Debe:** publicar solo números producidos por ejecutar realmente el
  harness de benchmark del proyecto, con hardware, versiones y fecha de
  ejecución declarados junto a los resultados (p. ej., en un contrato de
  resultados o archivo de esquema).
- **No debe:** publicar números inventados o de relleno en sitios, docs o
  PRs, ni comparar ejecuciones recogidas en hardware distinto.
- **Por qué:** la credibilidad del benchmark depende enteramente de la
  reproducibilidad y la transparencia; los números fabricados además rompen
  a los consumidores que renderizan desde el contrato de resultados
  (`→ see evidence.md`).

### 2 — La corrección nunca se cambia por un speedup declarado sin un contrato registrado

- **Debe:** mantener intacta la semántica del índice (recall, ordenación,
  visibilidad de borrados, corrección de reconstrucción) bajo optimización,
  o registrar el trade-off aceptado explícitamente con su medición
  (`→ see durability.md` para los registros de decisión de trade-offs).
- **No debe:** debilitar la corrección en base a un speedup declarado, sin
  medir o sin registrar.
- **Por qué:** un índice más rápido que devuelve resultados incorrectos es
  un defecto entregado a mayor velocidad; el contrato es lo que separa un
  trade-off aceptado de una regresión accidental.
