# Presupuestos de contexto y memoria — Reglas

> **Ámbito:** dos dominios de presupuesto: (a) presupuestos de contexto del
> agente, memoria y operaciones del harness; (b) presupuestos de residencia
> en memoria de proceso de un motor de datos — qué vive en RAM frente a
> disco, medición de presión y back-pressure.
> **No aquí:** mecánica de carga de recursos (`workflow.md`), durabilidad
> del almacenamiento (`durability.md`), límites de concurrencia
> (`concurrency-async.md`).
> **Estado:** Active
> **Fuentes:** auditoría de residencia en memoria (métrica de solo páginas
> residentes subestimando el RSS real ~6,5×); diseño de presupuestos del
> harness.

## Presupuestos de contexto y operaciones del agente

### 1 — Cargar solo recursos relevantes para la tarea; mantener concisa la evidencia de continuación

- **Debe:** mantener el contexto cargado y la evidencia de
  continuación/handoff a lo que la tarea necesita — la disciplina de carga
  en sí vive en `workflow.md`.
- **No debe:** acumular contexto no relacionado ni estado verboso que
  desplaza la evidencia de trabajo (`→ see workflow.md`).
- **Por qué:** el contexto es un presupuesto; cada página irrelevante
  desplaza evidencia que la tarea realmente necesita.

### 2 — Mantener aislada la memoria de cada proyecto

- **Debe:** leer y escribir memoria dentro de las rutas configuradas del
  proyecto seleccionado.
- **No debe:** importar decisiones, tareas o evidencia de otro proyecto.
- **Por qué:** la memoria entre proyectos introduce de contrabando contexto
  ajeno en decisiones para las que nunca se generó.

### 3 — Un presupuesto de operaciones cuenta solo operaciones registradas

- **Debe:** interpretar los límites de presupuesto como recuentos de
  operaciones registradas.
- **No debe:** reinterpretar el presupuesto como llamadas nativas del host,
  tokens, gasto financiero o tiempo transcurrido — ni estrecharlo para
  subcontar.
- **Por qué:** redefinir la unidad mueve silenciosamente el límite; ambas
  direcciones de deriva rompen la contabilidad del owner.

### 4 — Nunca reiniciar un presupuesto ni rotar evidencia para eludir un límite

- **Debe:** cuando un presupuesto se agota, pedir un nuevo límite explícito
  o una nueva estrategia (`→ see human-decisions.md`).
- **No debe:** reiniciar contadores ni rotar evidencia fuera de la vista
  para hacer sitio.
- **Por qué:** el límite es la superficie de control del owner; eludirlo en
  silencio elimina el único freno al trabajo desbocado.

## Presupuestos de memoria de proceso

### 5 — Toda nueva estructura de datos de usuario declara su residencia (RAM frente a disco)

- **Debe:** toda nueva estructura que retiene datos de usuario declara en
  su diseño o informe de revisión dónde vive: memoria heap/residente,
  archivo mapeado en memoria o un almacén gestionado en disco.
- **No debe:** asumir "está en disco" porque los datos se persisten — la
  copia viva puede seguir siendo residente en RAM.
- **Por qué:** las auditorías de memoria confirman que estructuras de
  primer orden pueden ser totalmente residentes en RAM mientras su
  persistencia sugiere lo contrario; confundir persistencia con residencia
  produce kills por falta de memoria inesperados.

### 6 — Las decisiones de back-pressure usan memoria de proceso real, no estimaciones parciales

- **Debe:** basar las decisiones de presión de memoria en la memoria
  residente real del proceso medida desde el SO, o en una estimación
  lógica explícitamente documentada como tal, con un fallback definido
  cuando la medición no está disponible.
- **No debe:** usar la suma de un subconjunto de estructuras residentes
  (p. ej., solo páginas mmap residentes) como única señal de presión —
  oculta heap, buffers, cachés e índices.
- **Por qué:** la medición en campo encontró una métrica de solo páginas
  residentes subestimando la memoria real del proceso en ~6,5×, haciendo
  que el guarda leyera presión casi nula mientras el uso real crecía
  linealmente con el dataset.

### 7 — Aplicar back-pressure antes de que el SO mate el proceso

- **Debe:** cuando la memoria medida cruza el umbral configurado, rechazar
  nuevas escrituras con un error tipado de límite de recursos que lleve
  bytes usados, el umbral y una acción sugerida — antes de alcanzar el
  límite físico.
- **No debe:** dejar que cualquier estructura residente crezca sin un tope
  fijado por configuración o marca de agua.
- **Por qué:** con un coste de memoria lineal por elemento, el crecimiento
  del dataset alcanza eventualmente la RAM total de la máquina; sin
  back-pressure efectiva el OOM killer termina el proceso sin posibilidad
  de degradación elegante.

### 8 — Toda nueva estructura residente lleva un tope duro declarado y una política al tope

- **Debe:** las estructuras en memoria cuyo tamaño depende de datos de
  usuario declaran un tope duro en el mismo módulo, más una política
  documentada al alcanzarlo: desalojar, dejar de aprender o rechazar.
- **No debe:** añadir un map, caché o vector sin tope cuyo tamaño siga al
  dataset del usuario.
- **Por qué:** los topes existentes son la única razón por la que esas
  estructuras no agotan la memoria hoy; las que no tienen tope son
  exactamente donde se necesitan las reglas de back-pressure.
