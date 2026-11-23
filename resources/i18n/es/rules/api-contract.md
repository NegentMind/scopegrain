# Contratos públicos — Reglas

> **Ámbito:** superficies de API pública, bindings, endpoints y registros de
> herramientas: afirmaciones documentadas, comportamiento observable,
> validación en la frontera, semántica de errores, compatibilidad de
> enums/features y dónde reside la lógica de negocio.
> **No aquí:** numeración de versiones y sincronización de releases
> (`release-ci.md`), manejo de entradas a nivel de transporte
> (`server-mcp.md`), corrupción del almacenamiento (`durability.md`).
> **Estado:** Active
> **Fuentes:** hallazgos de auditorías de API/docs (métodos documentados
> ausentes de todos los bindings, deriva de versiones dentro de un mismo
> docset, herramientas tras feature gate expuestas como activas, divergencia
> silenciosa de comportamiento en adaptadores).

## Reglas

### 1 — Toda afirmación de API documentada se resuelve a un símbolo real

- **Debe:** antes de documentar una función, clase, método, endpoint o
  herramienta como soportado, verificar que existe en el código y en los
  bindings o adaptadores publicados que lo declaran.
- **No debe:** documentar APIs especulativas o planificadas como existentes.
  Una capacidad implementada en el núcleo pero no expuesta por ningún
  binding se documenta como no disponible en esas superficies, no como
  soportada.
- **Por qué:** un usuario que sigue el ejemplo documentado falla en tiempo
  de ejecución. Una auditoría real encontró un método de cliente documentado
  que no existía en ningún binding; el patrón sigue prohibido aunque esa
  instancia ya esté corregida.

### 2 — Las afirmaciones de versión se resuelven a la declaración canónica

- **Debe:** las especificaciones de API, las cabeceras de protocolo y los
  docs versionados toman su versión de la declaración de versión canónica
  del proyecto, no de un literal hardcodeado — la regla de sincronización
  completa, incluyendo empaquetado y workflows, vive en `release-ci.md`.
- **No debe:** permitir que dos documentos del mismo docset declaren
  versiones distintas del mismo producto (`→ see release-ci.md`).
- **Por qué:** la deriva de versiones hace imposible saber qué release
  describe un documento; los incrementos mecánicos de versión siempre dejan
  literales hardcodeados atrás.

### 3 — No exponer capacidades que el núcleo rechaza con los features por defecto

- **Debe:** una herramienta, endpoint o método de adaptador solo puede
  invocar una capacidad del núcleo que funcione con el conjunto de features
  por defecto del proyecto, o debe anunciarse como con puerta (gated) o
  degradada.
- **No debe:** registrar una superficie con apariencia activa que siempre
  falla porque su implementación está detrás de un feature no predeterminado
  o no existe.
- **Por qué:** una API que siempre da error erosiona la confianza y genera
  issues falsos; las auditorías han detectado herramientas registradas cuya
  capacidad subyacente estaba desactivada por defecto tras un feature gate.

### 4 — Referencias de archivo exactas en la documentación

- **Debe:** citar rutas de módulo reales tal como existen en el repositorio.
- **No debe:** citar rutas colapsadas (`src/sdk.rs` cuando el módulo es un
  directorio) ni convenciones de prefijo inventadas para el paquete raíz.
- **Por qué:** las rutas rotas rompen la navegación para lectores y agentes;
  una auditoría encontró múltiples convenciones de ruta falsas dentro de un
  solo docset.

### 5 — Paridad de herramientas y endpoints entre código y docs en el mismo cambio

- **Debe:** al añadir, renombrar o eliminar una herramienta registrada en la
  superficie de registro de herramientas, o una ruta HTTP, actualizar la
  documentación de protocolo y API en el mismo PR.
- **No debe:** fusionar herramientas nuevas sin entradas de documentación;
  donde exista una puerta de paridad, una herramienta sin documentar debe
  fallarla.
- **Por qué:** las herramientas no documentadas se acumulan en silencio —
  una auditoría encontró aproximadamente la mitad del conjunto de
  herramientas registrado ausente del documento de protocolo.

### 6 — Los enums públicos en crecimiento son no exhaustivos o versionados

- **Debe:** todo enum o tipo unión público que pueda ganar variantes
  (errores, modos, backends) se declara no exhaustivo o explícitamente
  versionado para que los match aguas abajo sigan siendo compatibles a
  nivel de fuente.
- **No debe:** hacer match exhaustivo sin brazo de respaldo sobre el enum
  público de otro paquete; no añadir variantes de error como strings
  simples donde existe un patrón de error estructurado/encadenado — pierden
  el encadenamiento de causa.
- **Por qué:** añadir una variante a un enum exhaustivo es un cambio
  rupturista silencioso; las variantes de error en forma de string
  descartan contexto de diagnóstico del que dependen los llamantes.

### 7 — Las formas de datos públicas son invariantes respecto a los features

- **No debe:** compilar condicionalmente un campo público individual de un
  tipo público (p. ej., un campo `pub` de struct tras un feature gate) — la
  construcción literal se rompe entonces entre combinaciones de features,
  haciendo la API no conmutativa.
- **Debe:** si un campo solo existe bajo un feature, usar un valor opcional
  interno, ocultar el campo o poner puerta a todo el tipo.
- **Por qué:** los consumidores con un conjunto de features distinto fallan
  al compilar por razones ajenas a su propio código.

### 8 — La lógica de negocio vive en el núcleo; los bindings y adaptadores son pegamento más memoria

- **Debe:** la lógica de negocio — semántica de validación, scoring y
  matemáticas de distancia, decisiones de búsqueda (selección de métrica,
  fusión de resultados, top-k, dedup), manejo de estado — reside en el
  núcleo. Los bindings de lenguaje, adaptadores de servidor e integraciones
  de framework son pegamento más memoria: serialización, mapeo de tipos,
  traducción de errores, liberación del lock del runtime, defaults de
  conveniencia y guardas de entrada en la frontera FFI (clamps, topes de
  longitud — defensa en profundidad legítima en una frontera de confianza).
- **No debe:**
  - reimplementar en un binding un cálculo que el núcleo ya provee
    (funciones de distancia, conversión de score a similitud,
    normalización);
  - tomar decisiones de búsqueda en la capa de interfaz: fallback silencioso
    de métrica según la forma de la entrada, fusión del lado del cliente o
    dedup del lado del cliente;
  - rodear un error deliberado del núcleo en un binding mientras otros lo
    exponen — un binding que traga en silencio un error deliberado del
    núcleo crea divergencia por plataforma: misma entrada, comportamiento
    distinto por adaptador;
  - duplicar fórmulas entre adaptadores sin una fuente única.
- **Por qué:** sin la regla cada adaptador reinventa la semántica del núcleo
  y la deriva crece. Una auditoría encontró un adaptador sustituyendo
  silenciosamente una métrica de distancia para entradas que el núcleo
  rechaza deliberadamente, fórmulas de scoring duplicadas en dos
  integraciones y fusión de resultados del lado del cliente — misma
  entrada, resultados distintos por plataforma.
- **Excepciones:** los adaptadores de framework pueden implementar
  capacidades requeridas por el framework (p. ej., modos opt-in de
  reranking o fusión) siempre que (a) el cálculo primario de
  distancia/score provenga del núcleo, (b) el mapeo del score esté
  documentado y marcado con un puntero `TODO(core)` a la fuente del núcleo,
  y (c) el comportamiento divergente esté justificado por el contrato del
  framework.
- **Correcciones:** mover la lógica al núcleo solo si no cambia ninguna API
  pública; si requiere un cambio de especificación o rupturista,
  documentarlo, dejar un marcador `TODO(core)` en el binding y anotarlo en
  el informe de la tarea.

### 9 — Validar la entrada no confiable en la frontera; fallar rápido

- **Debe:** validar entradas no confiables y respuestas externas en la
  frontera del contrato, rechazando argumentos localmente inválidos antes
  de despachar a un servicio remoto o capa interna.
- **No debe:** reenviar entrada malformada hacia adentro y dejar que una
  capa más profunda la descubra, ni confiar en la forma de una respuesta
  externa sin comprobarla.
- **Por qué:** la validación en la frontera localiza los fallos en la capa
  que puede reportarlos coherentemente; la propagación hacia adentro
  convierte errores del llamante en crashes internos (`→ see safety.md`
  para el manejo de contenido no confiable).

### 10 — Preservar el comportamiento observable o gestionar el cambio rupturista

- **Debe:** mantener el comportamiento observable estable para los
  consumidores, o gestionar la ruptura explícitamente — versionado,
  ventana de deprecación, notas de migración — a través del proceso de
  cambios del proyecto.
- **No debe:** publicar un cambio de comportamiento silencioso y dejar que
  los consumidores lo descubran.
- **Por qué:** una ruptura no gestionada transfiere el coste de migración a
  todos los consumidores a la vez; una ruptura gestionada lo programa.

### 11 — Propagar señales parciales y degradadas; nunca colapsar a éxito vacío

- **Debe:** propagar las señales de resultado parcial al llamante —
  resultados abstenidos, truncamiento, razones de abstención, operación
  degradada o de fallback — reportadas como tales.
- **No debe:** colapsar una respuesta parcial o degradada en un éxito vacío
  indistinguible, ni presentar una capacidad degradada como sana
  (`→ see core-engine.md` para el estado interno corrupto).
- **Por qué:** un éxito vacío es indistinguible de "sin datos"; el llamante
  toma decisiones silenciosamente sobre una fracción de la verdad.

### 12 — La semántica de errores, los ejemplos y los metadatos de protocolo permanecen consistentes

- **Debe:** mantener códigos/formas de error, ejemplos documentados y
  metadatos de protocolo alineados con la implementación en el mismo cambio
  que los altera.
- **No debe:** dejar que ejemplos o contratos de error deriven respecto a
  lo que el código realmente devuelve.
- **Por qué:** un contrato de error que deriva es una segunda API ficticia
  contra la que los consumidores programan.
