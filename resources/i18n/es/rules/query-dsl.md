# Contratos del lenguaje de consulta — Reglas

> **Ámbito:** implementaciones de consulta/DSL: sintaxis, tokenización,
> semántica de matching, comportamiento de error y límites de recursos como
> contratos públicos.
> **No aquí:** internals de índices (`indexes.md`), documentación de la
> superficie de API (`api-contract.md`).
> **Estado:** Active
> **Fuentes:** investigación de matching de frases (matching posicional,
> tokenización literal, delegación al planner, sin motor externo).

Aplicar a implementaciones de consulta o DSL. Tratar sintaxis,
tokenización, semántica de matching y comportamiento de error como
contratos públicos; probar entradas entrecomilladas, vacías, malformadas,
anidadas y adversariales según corresponda. No importar operadores, ranking
ni semántica de frases de otro producto.

## Reglas

### 1 — Las frases entrecomilladas significan adyacencia estricta

- **Debe:** interpretar la entrada multi-palabra entrecomillada como una
  frase con tokens contiguos en orden exacto (slop cero), casada contra los
  datos posicionales almacenados.
- **No debe:** relajar la adyacencia de frase por defecto (proximidad o
  slop > 0); la proximidad relajada requiere una extensión opt-in explícita
  en la capa de matching — nunca un cambio en el almacenamiento.
- **Por qué:** el matching posicional con orden estricto es el default
  establecido, equivalente a la semántica de consulta de frases
  convencional; una vez verificado funcionando no debe aflojarse en
  silencio.

### 2 — Los tokens de frase son literales — sin eliminación de stopwords ni stemming dentro de comillas

- **Debe:** tokenizar las frases entrecomilladas literalmente al construir
  el plan de consulta.
- **No debe:** correr el pipeline de stemming o stopwords sobre contenido
  entrecomillado — distorsiona el matching exacto.
- **Por qué:** la normalización agresiva rompe las frases literales; el
  parser ya resuelve los literales entrecomillados y esa semántica debe
  sobrevivir a la evolución del parser.

### 3 — No adoptar un motor de búsqueda externo pesado para alcance ya cubierto

- **No debe:** añadir una dependencia de motor de búsqueda full-text (y su
  árbol transitivo) para matching de frases que el almacenamiento existente
  ya implementa y prueba.
- **Por qué:** un motor externo exige un schema aparte, un índice duplicado
  y sincronización de la ruta de escritura para una capacidad ya cubierta —
  YAGNI.

### 4 — Una sola ruta de gramática — el parser delega las frases al planner

- **Debe:** extraer las frases entrecomilladas en tiempo de parseo y
  delegar a la ruta de plan de frases existente del planner para cada nueva
  condición de texto.
- **No debe:** construir una segunda gramática de frases en el parser que
  compita con la del planner.
- **Por qué:** la extracción duplicada crea deriva entre parseo y
  ejecución; una sola ruta mantiene la semántica comprobable de extremo a
  extremo.

### 5 — Las consultas no confiables reciben límites explícitos de trabajo y tamaño

- **Debe:** acotar el trabajo de consulta y el tamaño de entrada donde
  consultas no confiables pueden agotar recursos — límites de longitud de
  entrada, topes de complejidad del plan, soporte de timeout o cancelación.
- **No debe:** permitir que una consulta suministrada por el usuario
  conduzca asignación o evaluación sin límites (`→ see api-contract.md`
  validación en la frontera).
- **Por qué:** la interfaz de consulta es un consumidor de recursos de
  control remoto; sin límites, una entrada construida es una primitiva de
  denegación de servicio.
