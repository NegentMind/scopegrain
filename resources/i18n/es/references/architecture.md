# Evidencia de arquitectura

La evidencia útil incluye puntos de entrada, fronteras de módulos,
interfaces públicas, propiedad de datos, dependencias, persistencia,
concurrencia y disposición de despliegue. Compara la documentación con el
código en ejecución y las pruebas. Distingue una frontera propuesta de una
frontera aplicada. Registra incertidumbres y tradeoffs en lugar de imponer
la arquitectura de otro repositorio.

Esta referencia guía cómo producir y mantener un mapa de arquitectura de un
repositorio. El inventario concreto de módulos de cualquier producto
específico es documentación del owner — registra la *estructura* de ese
mapa, no una disposición prestada.

## Qué debe capturar un mapa de arquitectura

Para cada unidad de nivel superior (paquete, crate, módulo, servicio,
directorio):

| Campo | Pregunta que responde |
|---|---|
| Identity | Nombre y ruta tal como existen hoy en el árbol |
| Role | Qué posee: regla de negocio, puerto, adaptador, composition root, tooling |
| Public surface | Puntos de entrada, API exportada, feature flags que la condicionan |
| Dependencies | Qué importa y qué tiene permitido importarla |
| Data ownership | Estado que muta, backend de persistencia, esquema que define |
| Concurrency | Fronteras de hilos/actores/async que introduce |
| Deployment | Cómo se compila, empaqueta, publica o se excluye del release |

Ejemplo del estilo de anotación (no una plantilla para copiar — las flechas
registran un hecho cada una):

```
core/                    ← primary library
  api/                   ← embedded public API (connect(), top-level types)
  engine.*               ← in-memory engine
  storage/               ← persistent backends (default + fallback)
  wal.*                  ← write-ahead log
cli/                     ← feature-gated binary
bindings-python/         ← native bindings for the Python SDK
server/                  ← standalone network server
integrations/            ← thin per-framework adapters
fuzz/                    ← fuzz targets (nightly only, excluded from workspace)
benches/                 ← benchmark suite
```

## Preguntas de verificación

- [ ] ¿Cada frontera documentada se sostiene en el grafo de
      imports/build, o solo en prosa? Una frontera que nada aplica es una
      propuesta, no una regla.
- [ ] ¿Qué unidades son internas estilo `publish = false` frente a
      artefactos publicados?
- [ ] ¿Qué módulos están excluidos de builds/pruebas por defecto
      (solo-nocturnos, tras feature flag, por plataforma)? Iterar contra
      ellos a ciegas falla.
- [ ] ¿Por dónde entran los datos externos y qué capa los valida?
- [ ] ¿Qué unidades son el composition root (cableado DI/arranque) frente a
      lógica?
- [ ] ¿Existen árboles generados o vendored que no deben editarse a mano?

## Disciplina de registro

- Deriva el mapa de los archivos de manifest/build y del grafo de imports,
  y luego anota — no al revés.
- Cuando el árbol real es plano por módulo técnico pero la arquitectura
  pretendida está orientada a dominio, dilo explícitamente; no reorganices
  carpetas sin un registro de decisión aprobado.
- Actualiza el mapa en el mismo cambio que mueve una frontera. Un documento
  de arquitectura que va por detrás del código es un defecto de evidencia,
  no deuda de documentación.

<!-- Cross-references: → see clean-code-clean-architecture.md, graph-investigation.md, mcp-tools.md -->
