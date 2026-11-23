# Investigación asistida por grafo

Las herramientas de grafo pueden acelerar la investigación de símbolos y
dependencias cuando su alcance y frescura son conocidos. Son capacidades
externas opcionales. La búsqueda en la fuente y la inspección de callers
proporcionan un fallback, no una garantía idéntica. El registro dinámico,
el código generado y los consumidores externos pueden invalidar una
conclusión simple de "sin callers". Registra la superficie inspeccionada.

Pueden existir dos capacidades de grafo distintas en un proyecto — no las
confundas:

- **Índice de símbolos** — índice determinista pre-construido del codebase
  (símbolos, rutas de llamada, blast radius). Respuestas en milisegundos,
  sin coste de LLM.
- **Grafo narrativo de conocimiento** — un grafo construido por LLM con
  capas descriptivas y un tour guiado del codebase. Complementa al índice
  para arquitectura, onboarding y storytelling.

## Guía de decisión: índice de símbolos vs. grafo narrativo

| Situación | Herramienta | Por qué |
|---|---|---|
| "¿Dónde se define la función X?" | Índice de símbolos | Índice pre-construido, respuesta en ms |
| "¿Qué llama a esta función?" | Explore del índice de símbolos | Rutas de llamada precisas incl. dispatch dinámico |
| "¿Qué se rompe si cambio X?" | Explore del índice de símbolos | Blast radius desde la fuente |
| "¿Cómo se estructura la arquitectura?" | Grafo narrativo | Capas con descripciones narrativas |
| "Dame un tour del codebase" | Grafo narrativo | Tour guiado desde el entrypoint |
| "Explica este módulo en detalle" | Skill/herramienta explain del grafo narrativo | Análisis narrativo contextual |
| "¿Qué pruebas debería ejecutar?" | `git diff` + índice de símbolos | Exploración conectada al diff |
| "Onboardea a un dev nuevo" | Onboard del grafo narrativo | Guía interactiva generada |
| "¿Cuál es el dominio de negocio?" | Domain del grafo narrativo | Flujos de dominio extraídos del grafo |
| "¿Qué cambió en este PR?" | Diff del grafo narrativo | Diff analizado contra el grafo |

**Regla general:** índice de símbolos primero para cualquier cosa precisa a
nivel símbolo/código; grafo narrativo para contexto arquitectónico,
narrativa, onboarding y visualización.

## Operaciones del grafo narrativo (genéricas)

Una herramienta de grafo narrativo suele exponer, como comandos o skills:

| Operación | Efecto |
|---|---|
| scan / build | Escanea el repo, construye el grafo en un directorio de estado |
| auto-update | Hook post-commit para actualizaciones incrementales |
| full rebuild | Regeneración completa (costosa — solo cuando cambió la estructura) |
| chat | Q&A contextualizado en arquitectura |
| dashboard | Panel visual interactivo |
| explain `<path>` | Análisis aislado de un archivo/módulo |
| diff | Cambios staged/unstaged → impacto predicho |
| onboard | Tours guiados para recién llegados |
| domain | Agrupa el código por entidades de negocio |
| knowledge `<path>` | Ingiere docs markdown externos en el grafo |

## Flujo de trabajo recomendado

1. **Navegación diaria** → índice de símbolos. Más rápido, determinista, sin
   tokens de LLM gastados re-analizando.
2. **Comprender la arquitectura** → chat/explain del grafo narrativo contra
   el grafo *existente*; no hace falta regeneración.
3. **Onboarding/revisión** → explain/onboard sobre el grafo existente.
4. **Regenera solo cuando** la estructura del proyecto cambie
   materialmente (módulos nuevos grandes) o se requiera un análisis más
   fresco.
5. **Nunca** ejecutes un full rebuild a la ligera — un grafo a escala de
   repo cuesta tiempo de agente sustancial; las actualizaciones
   incrementales cubren el caso diario.

## Referencia de esquema de grafo (típico)

```json
{
  "nodes": [{"id": "file:src/engine.rs", "type": "file", "name": "engine.rs",
             "summary": "In-memory storage engine", "tags": ["storage", "core"]}],
  "edges": [{"source": "file:src/engine.rs", "target": "file:src/storage/mod.rs",
             "type": "imports", "direction": "directed", "weight": 0.7}],
  "layers": [{"id": "layer:core-engine", "name": "Core Engine",
              "description": "In-memory engine and storage backends",
              "nodeIds": ["file:src/engine.rs", "..."]}],
  "tour": [{"order": 1, "title": "Project Overview",
            "description": "Start with README", "nodeIds": ["document:README.md"]}]
}
```

Las capas son estratos arquitectónicos nombrados (engine, storage, index,
bindings, integrations, frontend, tests, docs, CI, …) que agrupan nodos
para narrativa y navegación.

## Reglas de frescura y confianza

- [ ] Registra el alcance del grafo y la hora de última construcción antes
      de confiar en un resultado.
- [ ] Una respuesta "sin callers" queda invalidada por: dispatch
      dinámico/reflexivo, código generado, consumidores externos, puntos de
      entrada FFI, archivos no indexados.
- [ ] Ante un aviso de pending-sync, lee el archivo directamente en lugar
      del grafo.
- [ ] Cuando no existe índice, la búsqueda en la fuente + inspección de
      callers es el fallback — una garantía más débil, dilo.

<!-- Cross-references: → see architecture.md, mcp-tools.md, task-domain.md -->
