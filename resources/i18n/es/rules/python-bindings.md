# Python y fronteras nativas — Reglas

> **Ámbito:** integraciones Python/nativas: propiedad de objetos, el lock
> del runtime del host (clase GIL), tiempo de vida, cancelación, conversión
> de excepciones y contratos de operaciones por lotes.
> **No aquí:** ubicación de la lógica de negocio (`api-contract.md`),
> gate/drain del ciclo de vida de bindings (`js-ecosystem.md`), mecánica
> del runtime async (`concurrency-async.md`).
> **Estado:** Active
> **Fuentes:** investigación de diseño del contrato de bindings
> (liberación del lock, iteración paralela, propiedad de callbacks).

Aplicar solo a integraciones Python/nativas. Antes de escribir código de
binding, identificar la propiedad de objetos, la frontera del lock del
runtime, los tiempos de vida, el comportamiento de cancelación y la
conversión de excepciones en ambos lados. Usar la librería de binding real
del proyecto y las versiones soportadas — no asumir un framework de
binding concreto ni una API de GIL específica.

## Reglas

### 1 — Las operaciones por lotes liberan el lock del runtime del host pronto, corren en paralelo, fallan rápido

- **Debe:** los métodos por lotes liberan el lock del runtime del lenguaje
  host (p. ej., el GIL) lo antes posible, ejecutan el lote a través del
  mecanismo de iteración paralela del proyecto y propagan el primer error
  en lugar de continuar — todo lote nuevo sigue este patrón.
- **No debe:** ejecutar peticiones por lotes secuencialmente bajo el lock
  mantenido, ni degradar a un bucle que sigue tras un fallo mientras
  retiene recursos.
- **Por qué:** la liberación temprana más el fail-fast paralelo es el
  contrato medido de throughput y latencia de cola en las rutas de lotes de
  bindings.

### 2 — Los tiempos de vida de callbacks pertenecen al binding que gestiona el lock del runtime

- **Debe:** al liberar el lock del runtime del host, mover los handlers de
  notificación y callback al closure sin lock y soltarlos dentro de la
  propia capa de binding.
- **No debe:** retener esos closures en el núcleo ni en wrappers que no
  gestionan el locking del runtime del host.
- **Por qué:** cerrar los callbacks en el binding evita referencias
  colgantes entre el runtime del lenguaje host y los closures nativos.

### 3 — La paridad pública y el comportamiento de error se prueban a través de la frontera de lenguajes

- **Debe:** probar que la superficie pública del binding y su
  comportamiento de error (tipos de excepción, mensajes, casos extremos)
  coinciden con el contrato del núcleo en cada versión soportada.
- **No debe:** asumir que las excepciones o las formas de retorno
  sobreviven a la frontera sin cambios (`→ see api-contract.md` — la
  semántica de errores es contrato).
- **Por qué:** la traducción en la frontera altera silenciosamente la
  semántica — una excepción mal tipada o un error tragado es una ruptura
  de contrato que el compilador no puede ver.
