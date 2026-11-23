# Ecosistema JavaScript — Reglas

> **Ámbito:** paquetes JavaScript/TypeScript/WASM/Node: integridad de
> package-manager y lockfile, seguridad de scripts de instalación,
> afirmaciones documentadas de capacidad, artefactos de build, pertenencia
> al workspace y ciclo de vida de bindings.
> **No aquí:** reglas de UI de navegador (`frontend-web.md`), ubicación de
> la lógica de negocio del núcleo (`api-contract.md`), primitivas de
> concurrencia (`concurrency-async.md`).
> **Estado:** Active
> **Fuentes:** auditorías JS/WASM (artefacto no comiteado citado como
> estructura, exclusiones documentadas reportadas como defectos,
> afirmaciones de persistencia obsoletas, escrituras fire-and-forget
> perdidas al cerrar).

## Reglas

### 1 — Las afirmaciones de persistencia nombran el mecanismo opt-in que las habilita

- **Debe:** documentar las capacidades de almacenamiento/persistencia con
  los backends explícitos reales y la llamada u opción concreta que las
  habilita (p. ej., un constructor persistente frente al de memoria por
  defecto).
- **No debe:** afirmar persistencia para la ruta en memoria por defecto, ni
  prometer capacidades que el runtime de destino deshabilita.
- **Por qué:** la documentación de capacidades deriva en ambas direcciones
  — una afirmación obsoleta de "siempre en memoria" ocultó en su día una
  capa de persistencia implementada. Afirmar menos de lo que existe también
  es un fallo de diagnóstico.

### 2 — Los artefactos de build no son fuente — nunca citarlos como estructura del repo

- **Debe:** tratar los directorios de paquete y distribución generados como
  artefactos regenerables; verificar que un directorio existe antes de
  citarlo en docs o investigación.
- **No debe:** documentar el contenido de un directorio de artefacto no
  comiteado como estructura existente del repositorio.
- **Por qué:** una auditoría citó en su día un directorio generado — con
  módulos concretos dentro — como existente; el directorio nunca fue
  comiteado en absoluto.

### 3 — Las exclusiones de workspace documentadas son decisiones, no omisiones

- **Debe:** mantener un paquete excluido de la pertenencia al
  workspace/monorepo cuando un comentario registra el porqué (p. ej., un
  conflicto de toolchain o linker), y tratarlo como decisión intencional.
- **No debe:** "corregir" una entrada de members vacía o ausente sin leer
  el comentario de exclusión y el manifiesto raíz.
- **Por qué:** las auditorías han reportado exclusiones deliberadas y
  documentadas como defectos; revertirlas reintroduce el fallo de build
  original.

### 4 — Ciclo de vida del binding: op-gate más drain al cerrar

- **Debe:** todo binding o adaptador que expone operaciones asíncronas sobre
  un motor síncrono debe (1) derivar cada operación a través del mecanismo
  de trabajo bloqueante, (2) poner puerta a cada operación para que
  rechace una vez comienza el cierre, y (3) drenar la puerta antes de
  cerrar el motor.
- **No debe:** permitir una escritura fire-and-forget cuyo trabajo derivado
  no se ha ejecutado cuando `close()` retorna — la escritura se pierde en
  silencio al salir.
- **Por qué:** el patrón gate-and-drain es el contrato de ciclo de vida
  establecido en los adaptadores mantenidos desde una auditoría dedicada;
  todo binding nuevo debe reproducirlo.

### 5 — La evidencia de package-manager y lockfile manda; las contradicciones se resuelven

- **Debe:** determinar el package manager a partir de la evidencia
  declarada (campo `packageManager`, tipo de lockfile) y honrar el formato
  de módulo, el runtime y la política de versiones soportadas del proyecto;
  resolver las contradicciones entre fuentes antes de actuar.
- **No debe:** mezclar package managers dentro de un proyecto ni actuar
  sobre un lockfile que contradice el manager declarado.
- **Por qué:** dos managers producen dos grafos de resolución; el lockfile
  es el único testigo reproducible de lo que se instaló realmente.

### 6 — Nunca ejecutar scripts de ciclo de vida para inspeccionar o instalar

- **Debe:** inspeccionar manifiestos estáticamente, y correr instalaciones
  con la ejecución de scripts de ciclo de vida deshabilitada (p. ej.,
  `--ignore-scripts`, o el default equivalente del package manager),
  usando una allowlist explícita donde un paquete legítimamente necesite
  uno.
- **No debe:** correr scripts estilo `install`/`postinstall` solo para leer
  metadatos, ni ejecutarlos implícitamente sobre árboles de dependencias
  no confiables (`→ see safety.md` — la existencia de un script no es
  autorización).
- **Por qué:** los scripts de ciclo de vida son un vector de supply-chain
  de primer orden — ejecutan código arbitrario de cualquier dependencia
  transitiva en tiempo de instalación; deshabilitarlos por defecto es la
  recomendación permanente de la industria.

### 7 — Validar la serialización en la frontera navegador/servidor

- **Debe:** verificar las formas serializadas que cruzan entre contextos JS
  (hilo principal/worker, navegador/servidor, frontera WASM) contra el
  payload realmente emitido.
- **No debe:** asumir que los dos lados concuerdan en tipos, nombres de
  campo o codificación.
- **Por qué:** la serialización en la frontera falla en silencio — un campo
  mal tipado se lee como undefined, no como un error.

### 8 — Sin adiciones de framework ni churn de lockfile no relacionados

- **Debe:** mantener los cambios de dependencias y lockfile dentro del
  alcance declarado de la tarea (`→ see workflow.md` disciplina de
  alcance).
- **No debe:** introducir un framework ni regenerar lockfiles para trabajo
  no relacionado.
- **Por qué:** el churn de lockfile reescribe el grafo de resolución para
  cada consumidor y oculta el cambio real dentro de miles de diffs no
  relacionados.
