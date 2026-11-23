---
name: web-research
description: Usar para una pregunta explícita de investigación externa tras autorizar el acceso a la red
---
# Investigación externa

Declara la decisión y la pregunta precisa antes de buscar. Prefiere
documentación primaria aplicable y evidencia reciente relevante. Abre e
inspecciona una fuente citada; un resumen de búsqueda no es su contenido
completo. Verifica cruzadamente las afirmaciones consecuentes y registra la
evidencia contradictoria. Si las fuentes son inaccesibles, reporta la brecha
en lugar de inventar respaldo. No filtres secretos del proyecto en consultas
ni realices acciones de escritura externas. Guarda los hallazgos y la
incertidumbre dentro del workspace del harness.

## Cuándo usar

- Una pregunta de investigación explícita cuya respuesta afecta una decisión.
- Verificar una afirmación sobre herramientas, bibliotecas, APIs o hechos
  cambiantes contra documentación oficial o una fuente primaria.
- Leer una URL específica, recuperar un enlace muerto, o validar un hecho
  contra fuentes independientes.

No para: preguntas respondibles desde el propio repositorio: la evidencia
local es más rápida y más autoritativa para hechos locales.

## El router en cascada

Nunca dependas de una sola herramienta. Enruta cada consulta primero por el
nivel capaz más barato y escala ante fallo o profundidad insuficiente:

```
Research request
    │
    ▼
[0] WHICH TIER can answer this?
    │
    ├── 1. KEYLESS SEARCH (zero config, fastest)
    │      Free search endpoints / built-in web search /
    │      direct fetch of a known URL
    │
    ├── 2. MULTI-ENGINE / SPECIALIZED SEARCH
    │      Aggregators covering code, packages, academic,
    │      news, repos; cross-engine comparison =
    │      URLs consistent in ≥2 engines are more trustworthy
    │
    ├── 3. DEEP EXTRACTION
    │      Page → clean text/markdown extractors
    │      Archive lookups for dead URLs
    │      Real-browser rendering for JS-heavy pages
    │
    └── 4. FALLBACKS (escalate, never stall)
           alternate fetch path → text-extraction proxy →
           scripted browser → report the gap explicitly
```

**Reglas de oro:**

- **Nunca dependas de un solo motor.** Cada nivel recae al siguiente; si un
  nivel gratuito falla, continúa con la siguiente opción sin clave antes de
  rendirte.
- **Cita cada afirmación con su URL de fuente.** Si ningún nivel responde,
  dilo explícitamente: nunca rellenes la brecha con conocimiento interno
  presentado como investigación.
- **Ajusta el nivel al tipo de consulta**: no quemes un extractor profundo en
  una pregunta que una búsqueda gratuita responde.

## Flujo por tipo de consulta

### Búsqueda general ("encuentra X en internet")

1. Búsqueda web gratuita/sin clave primero.
2. Insuficiente o sesgada → búsqueda multi-motor.
3. Validar → compara motores; las URLs que aparecen en ≥2 motores pesan más.
4. Lee la fuente primaria → fetch/extracción de la página, cita desde la
   página misma, no el snippet.

### Contenido de página ("lee esta URL")

1. Extracción rápida de texto de la URL.
2. Extractor más profundo cuando la primera devuelve contenido escaso o con
   puerta de JS.
3. Paywall/fallo → endpoints proxy de extracción de texto o un navegador real.
4. Aún inaccesible → reporta la brecha; no parafrasees contenido no visto.

### URL muerta / enlace roto

1. Búsqueda en archivo (web archives/mirrors).
2. Nada → encuentra el mismo contenido en una fuente viva vía búsqueda general.

### Código / paquetes / repositorios

1. Búsqueda consciente de código y paquetes (repos, registros: índices de
   paquetes, hosts de fuentes).
2. Fallback → fetch de URLs de archivo crudo directamente.
3. Para APIs y bibliotecas, la documentación oficial y el propio repo del
   proyecto superan a cualquier artículo de terceros.

### Papers / academia

1. Búsqueda académica en fuentes de preprints e índices.
2. Fallback → fetch de la página de abstract o el PDF directamente.
3. Cita el paper, no un post de blog sobre el paper.

### Validación de hechos ("¿es verdad que...?")

1. Consulta al menos dos niveles independientes.
2. Prefiere fuentes corroboradas entre motores.
3. Extrae el texto original de las fuentes coincidentes y cita cada una.
4. Registra la evidencia contradictoria explícitamente: una afirmación con
   fuentes disidentes se reporta como disputada, no aplanada.

### Investigación profunda (multi-paso)

1. Descubre fuentes candidatas (búsqueda general).
2. Extrae las 3-5 más relevantes en paralelo.
3. Sintetiza con citas por URL y una nota de incertidumbre.
4. Guarda el resumen bajo el workspace del harness (`research/` o la ruta
   de estado configurada), no solo en el chat.

## Matriz de decisión

| Tipo de consulta | Primer nivel | Escalar a |
|---|---|---|
| Web general / docs / Q&A | búsqueda sin clave | multi-motor → extracción |
| Contenido de URL conocida | extracción rápida | extractor profundo → proxy → navegador |
| URL muerta | búsqueda en archivo | búsqueda general de copias vivas |
| Repos / código / paquetes | búsqueda de código/paquetes | fetch de archivo crudo |
| Académico | búsqueda académica | fetch directo de abstract/PDF |
| Noticias recientes | búsqueda sin clave (noticias) | motores especializados en noticias |
| Comprobación de credibilidad | 2+ niveles | fuentes originales corroboradas |
| Lote / multi-consulta | búsqueda sin clave | extracción paralela |

## Diagnóstico de fallos

| Síntoma | Causa probable | Acción |
|---|---|---|
| Un motor da timeout / error | proveedor o corte de red | siguiente nivel; no reintentes en bucle la misma llamada |
| El extractor devuelve contenido escaso | página renderizada por JS o con puerta anti-bots | extractor más profundo o navegador real |
| "Missing key" / proveedor deshabilitado | la capacidad necesita una credencial | usa un nivel sin clave; reporta la limitación |
| Todo falla | sin ruta de red | reporta la brecha explícitamente; marca las afirmaciones como no verificadas |

## Límites

- Declara la decisión que alimenta la investigación antes de buscar: una
  pregunta sin decisión es una expedición de pesca.
- Prefiere documentación primaria y fuentes recientes (de años recientes) en
  temas cambiantes; anota las fechas de publicación cuando la recencia importa.
- Un snippet de búsqueda es una pista, no evidencia: abre la fuente antes de citar.
- Nunca pongas secretos, credenciales, identificadores privados o detalles
  internos no publicados en consultas.
- Solo lectura por defecto: sin cuentas, posts, comentarios ni otras
  acciones de escritura externas.
- Registra fuentes, contradicciones e incertidumbre residual en el hallazgo
  guardado.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "El snippet dice suficiente" | Un snippet es una pista, no evidencia: abre la fuente antes de citarla. |
| "Esto ya lo sé" | Los temas cambiantes envejecen; una afirmación interna no verificada no es investigación. |
| "Una fuente coincide, eso es confirmación" | El índice de un motor es una vista; las afirmaciones consecuentes necesitan ≥2 fuentes independientes. |
| "La herramienta falló, respondo de memoria" | El fallo de herramienta es una brecha reportable, no licencia para inventar respaldo. |
| "La fuente más nueva siempre es mejor" | La recencia importa en temas cambiantes; las docs primarias superan a posts de blog recientes sin importar la fecha. |

## Señales de alerta

- Una afirmación citada sin URL de fuente, o una URL nunca realmente abierta.
- Conocimiento interno presentado como hecho investigado.
- Secretos, identificadores privados o detalles no publicados dentro de una consulta.
- Hallazgos no guardados en ningún lado: la investigación solo existe en el chat.
- Fuentes contradictorias aplanadas en una única afirmación confiada.
- Una afirmación "verificada" producida después de que todos los niveles fallaran.

## Verificación

- [ ] La decisión que alimenta la investigación se declaró antes de buscar.
- [ ] Cada afirmación lleva su URL de fuente; cada fuente citada fue abierta.
- [ ] Las afirmaciones consecuentes fueron corroboradas entre ≥2 fuentes o
      niveles independientes.
- [ ] Las contradicciones y la incertidumbre residual se registraron, no se suavizaron.
- [ ] El hallazgo se guardó bajo el workspace del harness (`research/` o la
      ruta de estado configurada).
- [ ] Ningún secreto ni identificador privado salió del proyecto dentro de una consulta.
