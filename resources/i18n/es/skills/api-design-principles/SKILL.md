---
name: api-design-principles
description: Úsala para revisar una API HTTP o GraphQL existente en busca de consistencia, límites de autoridad y evolución
---
# Principios de diseño de API

## Disciplina central

Lee las rutas o el esquema reales y los consumidores. Comprueba identidad,
autorización, validación de entrada, semántica de error y compatibilidad.
Para colecciones define paginación y límites de recursos donde corresponda.
Para actualizaciones parciales distingue omisión, null y eliminación explícita.
Prueba ejemplos de éxito y de fallo contra la implementación.
No impongas convenciones REST sobre un protocolo no relacionado.

Aplica estos principios para diseñar o revisar APIs HTTP y GraphQL que sean
intuitivas, consistentes y seguras de evolucionar. Revisa la superficie real —
las rutas declaradas, el esquema, los consumidores reales — no una descripción
de ella.

**Límite de alcance.** Esta skill cubre la mecánica de protocolo: métodos,
códigos de estado, estrategias de paginación, patrones de esquema. La
disciplina de contrato neutral al lenguaje que hay detrás — qué promete una
superficie, obligaciones de compatibilidad, validación en límites — pertenece
a `api-and-interface-design`.

## Cuándo usar

- Al diseñar nuevas APIs HTTP o GraphQL.
- Al revisar una especificación o implementación de API en busca de
  consistencia.
- Al establecer estándares de diseño para un equipo.
- Al migrar entre paradigmas o versiones.
- Al optimizar una API para consumidores específicos (móvil, terceros).

## Semántica HTTP

Los recursos son sustantivos; los métodos llevan la acción:

| Método | Semántica | Propiedades |
|---|---|---|
| `GET` | Recuperar | seguro, idempotente |
| `POST` | Crear (o acción no idempotente) | — |
| `PUT` | Reemplazar el recurso completo | idempotente |
| `PATCH` | Actualización parcial | — |
| `DELETE` | Eliminar | idempotente |

**Códigos de estado — un vocabulario:**

```
200 OK (read/update)   201 Created (+ Location)   204 No Content (delete)
400 malformed          401 unauthenticated        403 unauthorized
404 not found          409 state conflict         422 validation failed
429 rate limited       500 server error           503 unavailable
```

**Formato de error — una forma en todas partes:**

```json
{ "error": { "code": "VALIDATION_ERROR",
             "message": "Request validation failed",
             "details": [{"field": "email", "message": "Invalid format"}],
             "timestamp": "...", "path": "/api/users" } }
```

## Patrones REST

### Diseño de recursos

```
GOOD:  GET /api/users          GET /api/users/{id}/orders
BAD:   POST /api/createUser    POST /api/getUserById

Shallow nesting (preferred):   /users/{id}/orders → then /orders/{id}
Avoid deep chains:             /users/{id}/orders/{o}/items/{i}/reviews
Better:                        /order-items/{id}/reviews
```

### Filtrado, ordenación y conjuntos de campos dispersos

```
GET /api/users?status=active&role=admin
GET /api/users?sort=-created_at        # '-' = descending
GET /api/users?search=john
GET /api/users?fields=id,name,email    # sparse fieldsets
```

### Paginación

- **Offset** (simple): `?page=2&page_size=20` → devuelve
  `items, page, page_size, total, pages`. Limita siempre `page_size`.
- **Cursor** (conjuntos grandes/volátiles): `?limit=20&cursor=...` → devuelve
  `items, next_cursor, has_more`. Estable ante escrituras concurrentes.
- **Cabeceras Link** (hipermedia): `Link: <...?page=3>; rel="next"`.

### Actualizaciones parciales

Para `PATCH`, define la semántica explícitamente: un campo ausente significa
"dejar sin cambios", un `null` explícito significa "borrar" — o la API declara
`null` inválido. Nunca dejes ambigua la omisión frente a null frente a
eliminación. `PUT` requiere el objeto completo en cada llamada. Existen dos
formatos de cuerpo estandarizados si se necesita una convención en lugar de
inventarla: JSON Merge Patch (RFC 7386 — literal de objeto parcial, `null`
elimina) y JSON Patch (RFC 6902 — lista explícita de operaciones
`add`/`remove`/`replace`).

### Limitación de tasa

Devuelve cabeceras de límite y un reintento acotado:

```
X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset
429 Too Many Requests + Retry-After: <seconds>
```

### Idempotencia

Las escrituras no seguras reintentadas necesitan una clave de idempotencia:
`Idempotency-Key: <unique>` — una petición duplicada devuelve la respuesta
almacenada en lugar de reejecutarse.

### Caché y CORS

- `Cache-Control` según la mutabilidad del recurso; `ETag`/`If-None-Match` →
  `304`.
- CORS restringido a orígenes conocidos — nunca comodín `*` con credenciales.

### Versionado

| Estrategia | Forma | Compromiso |
|---|---|---|
| URL | `/api/v1/users` | clara, enrutable; múltiples URLs por recurso |
| Cabecera | `Accept: application/vnd.api+json; version=2` | URLs limpias; menos visible, más difícil de probar |
| Query | `?version=2` | fácil de probar; parámetro opcional olvidable |

Elige una; documenta la política de desaprobación junto a ella.

### Opcional: HATEOAS

Cuando la detectabilidad importa, las respuestas pueden llevar `_links`
(`self`, recursos relacionados, acciones permitidas con pistas de método).
Adóptalo deliberadamente — no lo injertes en una API cuyos consumidores nunca
siguen enlaces.

## Patrones GraphQL

### Esquema primero

Los tipos modelan el dominio; las consultas leen, las mutaciones escriben, las
suscripciones empujan. Decisiones de estructura:

- **Nulabilidad:** empieza nullable, endurece a `!` solo cuando esté
  garantizado — non-null es un compromiso incompatible.
- **Interfaces** para entidades polimórficas (`Node` con `id`, `createdAt`);
  **uniones** para resultados heterogéneos (`SearchResult = User | Post`).
- **Escalares personalizados** para tipos de dominio (`DateTime`, `Email`,
  `Money`).
- **Campos camelCase, tipos PascalCase.**

### Paginación — cursores estilo Relay

```graphql
type UserConnection { edges: [UserEdge!]!  pageInfo: PageInfo!  totalCount: Int! }
type UserEdge       { node: User!  cursor: String! }
type PageInfo       { hasNextPage: Boolean!  hasPreviousPage: Boolean!
                      startCursor: String  endCursor: String }
type Query          { users(first: Int = 20, after: String, search: String): UserConnection! }
```

Obtén `first + 1` filas para calcular `hasNextPage`. Usa paginación por offset
solo para listas simples y acotadas.

### Mutaciones — patrón input/payload

```graphql
input CreateUserInput { email: String!  name: String! }
type CreateUserPayload { user: User  errors: [Error!]  success: Boolean! }
type Error { field: String  message: String!  code: ErrorCode! }
```

Devuelve errores estructurados en el payload (o tipos de resultado unión como
`UserResult = User | ValidationError | NotFoundError | AuthorizationError`)
para que los clientes manejen los fallos en banda. Soporta `clientMutationId`
cuando las respuestas optimistas importen.

### Prevención de N+1 y coste de consulta

- **Carga por lotes (patrón DataLoader)** para cada campo de relación:
  recolecta claves por petición, carga en una consulta, devuelve en el orden
  de entrada.
- **Límite de profundidad** y **análisis de complejidad** rechazan consultas
  abusivas — los campos de lista multiplican el coste; impón topes.
- **Registra el coste de consulta** — monitoriza complejidad y tiempo de
  ejecución.

### Evolución

Desaprueba con `@deprecated(reason: "Use X")` en lugar de eliminar campos;
evoluciona de forma aditiva (añade campos opcionales, nunca endurezcas la
nulabilidad de campos publicados).

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Las convenciones REST son universales" | Son mecánica HTTP. Imponerlas sobre RPC, flujos de eventos o GraphQL produce diseño cargo-cult. |
| "Cualquier código de estado parecido sirve" | Los clientes ramifican según el código. Un 200 que envuelve un error o un 500 por entrada inválida rompe el manejo de errores de todos los consumidores. |
| "GraphQL resuelve el over-fetching gratis" | Traslada el coste a los resolvers — sin carga por lotes cambias over-fetching por N+1. |
| "Añadiremos paginación cuando haga falta" | Añadir paginación a posteriori cambia la forma de la respuesta — un cambio incompatible para cada consumidor existente. |
| "El versionado es prematuro" | Decidir el versionado tras el primer cambio incompatible es demasiado tarde; elige la estrategia en el diseño. |
| "Los límites de tasa perjudican a usuarios legítimos" | Las APIs sin límite invitan al abuso y a fallos en cascada; los límites con cabeceras claras protegen a ambas partes. |

## Señales de alerta

- Over/under-fetching en REST (resuelto por GraphQL, que entonces requiere
  carga por lotes).
- Cambios incompatibles sin versionado ni ventana de desaprobación.
- Formatos de error inconsistentes entre operaciones.
- Límites de tasa ausentes — una API sin límite es una API abusable.
- Estructura de API que refleja el esquema de almacenamiento en lugar del
  dominio.
- POST usado para operaciones idempotentes — rompe la semántica HTTP.
- Imponer convenciones REST sobre un protocolo que no es REST.
- Semántica ambigua de actualización parcial (omisión vs `null` vs
  eliminación).
- Un grafo de resolvers sin límite de profundidad/complejidad ni carga por
  lotes.

## Lista de verificación previa a la implementación

Puerta condensada antes de que una API salga o de que concluya una revisión:

**Diseño**
- [ ] Los recursos son sustantivos; las colecciones en plural; la
      nomenclatura es consistente.
- [ ] Anidamiento ≤ 2 niveles; CRUD mapeado a los métodos correctos.
- [ ] Versionado y política de desaprobación definidos.

**Comportamiento**
- [ ] Códigos de estado correctos; una forma de error; errores de validación
      a nivel de campo.
- [ ] Toda colección pagina con un tamaño de página máximo.
- [ ] Filtrado, ordenación y (donde haga falta) búsqueda definidos.
- [ ] Semántica de actualización parcial (omisión vs null vs eliminación)
      especificada.
- [ ] Las escrituras no seguras reintentadas son idempotentes.

**Autoridad y seguridad**
- [ ] Método de autenticación definido; autorización comprobada por
      operación; 401 vs 403 usados correctamente.
- [ ] Límites de tasa definidos con cabeceras de límite y `Retry-After`.
- [ ] Validación de entrada en cada campo; sin datos sensibles en URLs; sin
      secretos en respuestas.
- [ ] CORS restringido a orígenes conocidos; cifrado de transporte aplicado.

**Operaciones**
- [ ] Documentación generada (OpenAPI o introspección de esquema) con
      ejemplos de petición/respuesta y de error.
- [ ] N+1 prevenido; estrategia de caché y cabeceras establecidas; endpoints
      pesados acotados.
- [ ] Existe endpoint de salud; errores y latencia son observables.

**Adicionalmente en GraphQL**
- [ ] Esquema primero; nulabilidad decidida deliberadamente; tipos de entrada
      en cada mutación; errores en payloads o uniones.
- [ ] Límites de profundidad/complejidad; DataLoaders en las relaciones;
      desaprobaciones vía `@deprecated`, nunca eliminación silenciosa.

## Contrato de salida

Un diseño o revisión produce:

- Una especificación de superficie versionada (documento OpenAPI o esquema
  GraphQL) con ejemplos de petición/respuesta y de error para cada operación.
- Semántica explícita para actualizaciones parciales, paginación, filtrado y
  reintentos idempotentes — comprobable, no prosa.
- Obligaciones de compatibilidad por contrato cambiado y la política de
  desaprobación que las gobierna.
- Hallazgos con localizadores de ruta/campo y evidencia — no preferencias de
  estilo.

## Verificación

- [ ] Se leyeron las rutas/esquema reales y los consumidores reales — no se
      asumieron.
- [ ] Ejemplos de éxito Y de fallo probados contra la implementación.
- [ ] Obligaciones de compatibilidad identificadas para cada contrato
      cambiado.
- [ ] Hallazgos reportados con localizadores de ruta/campo y evidencia, no
      preferencias de estilo.

## Ver también

- `api-and-interface-design` — la disciplina de contrato neutral al lenguaje
  (ley de Hyrum, regla de una versión, validación en límites) que la mecánica
  de este archivo implementa.
- `deprecation-and-migration` — la ventana de desaprobación y la ruta
  expand/contract para cambios incompatibles.
- `security-and-hardening` — autenticación, autorización, SSRF y aplicación
  de la validación de entrada.
- `observability-and-instrumentation` — métricas RED, telemetría de límites
  de tasa y errores para la superficie entregada.
