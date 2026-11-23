# Concurrencia y asincronía — Reglas

> **Ámbito:** código concurrente y asíncrono: protección del bucle de
> eventos, disciplina de locks a través de puntos de suspensión, límites de
> concurrencia, orden de locks multi-estructura y neutralidad de runtime.
> **No aquí:** aplicaciones de transporte/handlers (`server-mcp.md`,
> `mcp-integration.md`), propiedad de escrituras en almacenamiento
> (`durability.md`).
> **Estado:** Active
> **Fuentes:** auditoría de bloqueo del runtime; hallazgos de coordinación
> de locks multi-índice (re-adquisición de mutex no reentrante, deadlock de
> rwlock en el mismo hilo).

Aplicar solo donde exista código concurrente o asíncrono.

## Reglas

### 1 — El trabajo pesado del motor en handlers async pasa por el offload de trabajo bloqueante

- **Debe:** toda llamada a una ruta del motor síncrona, ligada a CPU o
  disco, hecha desde un contexto async usa el mecanismo de offload de
  trabajo bloqueante del runtime (p. ej., `spawn_blocking`), siguiendo el
  patrón de handler establecido del proyecto.
- **No debe:** ejecutar llamadas síncronas al sistema de archivos,
  operaciones de batch/flush u otro trabajo de CPU/disco directamente
  dentro de las tareas del bucle de eventos.
- **Por qué:** una sola llamada síncrona larga bloquea un hilo trabajador
  del runtime, matando de hambre el bucle de eventos y disparando la
  latencia de cola bajo carga concurrente.

### 2 — Nunca mantener un guard de lock síncrono a través de un punto de suspensión

- **No debe:** mantener un guard de mutex síncrono mientras la tarea se
  suspende (`.await`, yield o cualquier devolución al planificador).
- **Debe:** usar el mutex async-aware del runtime para estado compartido a
  través de suspensiones; para estado puramente síncrono, adquirir y
  liberar el guard dentro de una única llamada síncrona sin suspensión
  intermedia.
- **Por qué:** un guard síncrono que cruza una suspensión bloquea el hilo
  trabajador fuera de la vista del planificador y puede producir deadlock
  contra la planificación de tareas.

### 3 — Acotar la concurrencia del servidor con semáforos async-aware, no locks

- **Debe:** limitar el trabajo concurrente de handlers con el semáforo
  async del runtime o un patrón de pool de conexiones construido sobre él;
  acotar también el propio pool de offload — las peticiones sin límite lo
  saturarán.
- **No debe:** inventar límites de concurrencia con mutexes síncronos
  envolviendo handlers.
- **Por qué:** un semáforo async cede en lugar de bloquear hilos
  trabajadores; un mutex síncrono no.

### 4 — Los locks síncronos permanecen dentro de árboles de llamadas síncronos

- **Debe:** confinar los mutexes síncronos a métodos síncronos a los que
  solo se llega vía la ruta de offload bloqueante o un hilo dedicado.
- **No debe:** exponer esos métodos como puntos de entrada async directos
  ni mantener sus guards a través de suspensiones.
- **Por qué:** mezclar los dos modelos colapsa la separación entre hilos de
  E/S e hilos de CPU/disco; el confinamiento es lo que hace seguros los
  locks síncronos.

### 5 — La E/S de archivos síncrona vive en hilos dedicados; las builds de doble modo permanecen tras feature gate

- **Debe:** ejecutar el trabajo síncrono del sistema de archivos dentro del
  offload bloqueante o en hilos dedicados de fondo/inicialización — nunca
  en el bucle de eventos.
- **Debe:** donde el codebase soporta builds con y sin bucle de eventos
  (p. ej., targets embebidos), poner las dos variantes de E/S tras un
  feature de build con firmas sync/async paralelas en lugar de duplicar
  lógica.
- **Por qué:** las auditorías confirman que los hilos dedicados no bloquean
  el runtime; mover esas llamadas al contexto async sin offload reintroduce
  el bloqueo, y una única implementación tras feature gate evita la deriva
  de lógica.

### 6 — Las escrituras multi-estructura siguen un orden global de locks; sin re-adquisición reentrante

- **Debe:** toda ruta de escritura que toca múltiples estructuras
  compartidas adquiere los locks en un único orden global documentado.
- **No debe:**
  - re-adquirir un mutex no reentrante dentro de una sección crítica que ya
    lo posee — un try-lock con timeout se degrada silenciosamente al
    expirar;
  - llamar a un método que toma un lock de lectura/escritura que el mismo
    hilo ya posee en escritura (la re-entrada de rwlock en el mismo hilo
    produce deadlock);
  - tomar un lock de escritura bloqueante en una ruta de lectura — usar
    try-write con fallback de lectura.
- **Debe:** los métodos que adquieren internamente un lock dado exponen una
  variante `*_locked` (privada al crate) que asume el lock ya tomado; los
  llamantes dentro de una sección vigilada usan siempre la variante
  `_locked` y sueltan otros guards antes de invocarla.
- **Debe:** una variante de "refresh" sin lock no debe convertirse en un
  no-op silencioso — las transiciones de estado requeridas se ejecutan
  igualmente, solo que sin re-bloquear.
- **Por qué:** una auditoría encontró una ruta de escritura llamando a
  trabajo de mantenimiento bajo un lock exterior y un guard de escritura de
  caché: el llamado re-adquirió el lock no reentrante (timeout por
  candidato, fallo silencioso) y el rwlock hizo deadlock en el mismo hilo.
  Un orden fijo garantiza que los escritores se serializan de forma
  predecible y los lectores nunca se encolan detrás de un escritor.

### 7 — Probar el contrato concurrente, no solo el happy path

- **Debe:** ejercitar cancelación, contención, ordenamiento y limpieza en
  fallo para las rutas concurrentes — colas, permisos y recursos
  compartidos incluidos.
- **No debe:** tratar una pasada de pruebas secuencial o de un solo cliente
  como cobertura del comportamiento concurrente.
- **Por qué:** las carreras, fugas e inanición de permisos son invisibles a
  las pruebas secuenciales; los modos de fallo que este archivo existe para
  prevenir solo aparecen bajo concurrencia (`→ see evidence.md`).

### 8 — No imponer un runtime o tipo de lock sin evidencia

- **Debe:** usar el runtime y las primitivas sobre las que el proyecto
  realmente corre, establecidos por inspección.
- **No debe:** imponer un runtime async concreto, un tipo de mutex
  particular o una API específica de lenguaje sin evidencia de que ese es
  el runtime del proyecto.
- **Por qué:** estas reglas describen un contrato, no un proveedor; forzar
  un runtime ajeno en un codebase crea un segundo modelo de concurrencia
  sin dueño.
