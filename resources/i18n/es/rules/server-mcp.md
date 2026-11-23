# Fronteras de servidor y protocolo — Reglas

> **Ámbito:** superficies de servidor y servicio de protocolo: fidelidad de
> identidad/versión, concurrencia de handlers, validación de entrada de
> transporte, honestidad de métricas y pruebas de rutas de fallo.
> **No aquí:** integración específica de stdio/MCP (`mcp-integration.md`),
> detalles del contrato de concurrencia (`concurrency-async.md`), reglas de
> superficie de API pública (`api-contract.md`).
> **Estado:** Active
> **Fuentes:** auditorías de protocolo (herramienta documentada que no
> existía, esquema de recursos fantasma, versión declarada desajustada);
> hallazgo de endpoint de métricas (histogramas
> registrados-pero-nunca-observados).

## Reglas

### 1 — La identidad del servidor y las versiones de protocolo coinciden con la implementación

- **Debe:** mantener la identidad de servidor declarada, la versión de
  protocolo, los esquemas de recursos y la lista de herramientas
  sincronizados con la implementación real.
- **No debe:** documentar herramientas no registradas, esquemas de recursos
  que no existen ni versiones de protocolo que el servidor no habla.
- **Por qué:** una auditoría encontró una herramienta documentada que no
  existía, un esquema de recursos fantasma y una versión declarada que no
  coincidía con nada — los clientes negocian contra ficción.

### 2 — La concurrencia de handlers sigue el contrato compartido

- **Debe:** limitar el trabajo concurrente de handlers con el semáforo
  async del runtime y ejecutar el trabajo del motor a través del mecanismo
  de offload de trabajo bloqueante — el contrato está definido en
  `concurrency-async.md`.
- **No debe:** bloquear el bucle de eventos del servidor con trabajo
  síncrono del motor, ni inventar límites de concurrencia con mutexes
  síncronos (`→ see concurrency-async.md`).
- **Por qué:** el trabajo síncrono sin límite en el bucle de eventos mata
  de hambre a cada cliente conectado.

### 3 — Los endpoints de métricas sirven métricas alimentadas — sin placeholders

- **Debe:** un endpoint público de métricas exporta métricas realmente
  registradas desde la ruta caliente de servicio (histogramas de latencia
  de petición, contadores de peticiones, contadores de
  importación/exportación) a través del registro real.
- **No debe:** registrar métricas que nada registra, exponer contadores o
  histogramas vacíos, ni devolver texto placeholder mientras la feature de
  métricas está habilitada.
- **Por qué:** un integrador sondeará el endpoint; un histograma
  registrado-pero-nunca-observado devuelve salida vacía y el endpoint se
  lee como decorativo.

### 4 — Las entradas de transporte, el contexto de autorización y las salidas serializadas se validan

- **Debe:** validar las entradas de petición en la frontera de transporte,
  llevar el contexto de autorización explícitamente a los handlers y
  verificar las formas de salida serializadas contra el contrato declarado
  (`→ see api-contract.md` validación en la frontera).
- **No debe:** pasar payloads de transporte crudos a llamadas del motor, ni
  asumir la identidad/permisos del llamante solo desde el estado de la
  conexión.
- **Por qué:** la frontera de transporte es donde los bytes no confiables
  se convierten en trabajo del motor; la validación ahí es el único lugar
  donde la transición de confianza puede comprobarse coherentemente.

### 5 — Las rutas de fallo se prueban: errores, peticiones malformadas, cancelación, cierre

- **Debe:** ejercitar respuestas de error, peticiones malformadas,
  cancelación y cierre limpio — incluido el trabajo en vuelo al cerrar
  (`→ see js-ecosystem.md` para el ciclo de vida op-gate/drain donde
  aplique).
- **No debe:** tratar las pruebas de integración de happy path como
  cobertura del comportamiento del servidor.
- **Por qué:** los servidores fallan en los bordes — un frame malformado,
  una petición cancelada, una escritura en vuelo durante el cierre; cada
  uno es una clase de defecto distinta invisible a las pruebas de happy
  path.
