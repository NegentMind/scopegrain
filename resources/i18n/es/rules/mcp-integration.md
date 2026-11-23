# Integración MCP — Reglas

> **Ámbito:** integración de servidor MCP (Model Context Protocol):
> ubicación del paquete, fidelidad de la superficie de herramientas, pureza
> del transporte, higiene del entorno, hints de capacidad y afirmaciones de
> interoperabilidad.
> **No aquí:** especificaciones del transporte HTTP (`server-mcp.md`),
> contrato de concurrencia (`concurrency-async.md`), fronteras de
> autorización (`safety.md`).
> **Estado:** Active
> **Fuentes:** auditorías de integración de protocolo (herramientas
> registradas contra rutas inexistentes, deriva spec/schema); hallazgos de
> entorno de servidor lanzado.

## Reglas

### 1 — La integración de protocolo vive en su propio paquete desacoplado

- **Debe:** mantener toda la integración de servidor de protocolo en un
  paquete dedicado, versionado por separado, con sus propias dependencias —
  no dentro del paquete núcleo ni en rutas que no existen.
- **No debe:** colocar lógica de servidor de protocolo dentro del paquete
  núcleo, ni referenciar directorios eliminados o nunca creados como si la
  contuvieran.
- **Por qué:** la integración está desacoplada para que las dependencias de
  protocolo nunca lastren el núcleo; las referencias a rutas inexistentes
  engañan a todo consumidor.

### 2 — El conjunto de herramientas expuesto coincide con un perfil declarado y los schemas registrados

- **Debe:** sincronizar la exposición de herramientas con el perfil de
  capacidad activo o el nivel de gobernanza, manteniendo el dispatch
  unificado y los schemas registrados coincidiendo exactamente con la
  especificación documentada.
- **No debe:** exponer herramientas no declaradas, ni dejar que la
  especificación y el schema registrado diverjan.
- **Por qué:** los clientes agénticos planifican contra el schema
  declarado; herramientas extra o divergentes desperdician presupuesto de
  ventana de contexto y rompen a los consumidores de schema estricto.

### 3 — Nunca bloquear el canal de transporte con trabajo del motor

- **Debe:** enrutar las llamadas intensivas en E/S y CPU a través del
  offload de trabajo bloqueante del runtime, acotado por semáforos — el
  contrato está definido en `concurrency-async.md`.
- **No debe:** ejecutar computación síncrona del motor directamente en la
  ruta de transporte stdio o streaming (`→ see concurrency-async.md`).
- **Por qué:** el canal de transporte serializa cada petición; una llamada
  síncrona detiene la sesión entera.

### 4 — La salida de protocolo y los diagnósticos viajan por canales separados

- **Debe:** mantener el canal de framing de protocolo (p. ej., stdout para
  transportes stdio) exclusivamente para mensajes de protocolo; los
  diagnósticos, logs y progreso van al canal lateral (p. ej., stderr).
- **No debe:** escribir logging ni salida legible por humanos en el canal
  de protocolo.
- **Por qué:** una sola línea extraviada corrompe el flujo de mensajes
  encuadrados y desincroniza cada petición posterior.

### 5 — Los hints de capacidad describen intención; no aplican control de acceso

- **Debe:** tratar las anotaciones estilo read-only/destructive y los roles
  Markdown como declaraciones consultivas.
- **No debe:** confiar en ellos para poner puerta al acceso — la aplicación
  pertenece a comprobaciones de autorización reales (`→ see safety.md`).
- **Por qué:** un hint es texto visible para el cliente; los clientes
  pueden ignorarlo y los servidores no deben depender de él.

### 6 — Sin registro implícito de servidores, paso de credenciales ni ampliación de permisos

- **Debe:** registrar servidores, pasar credenciales y ampliar permisos del
  host solo mediante configuración explícita y autorizada
  (`→ see safety.md`).
- **No debe:** realizar ninguno de ellos como efecto lateral de setup o
  sondeo.
- **Por qué:** cada uno extiende silenciosamente la frontera de confianza
  del host; la extensión implícita es indistinguible de un compromiso.

### 7 — La interoperabilidad solo se afirma desde un intercambio funcional

- **Debe:** verificar un intercambio de protocolo real (initialize, list,
  call) antes de afirmar que un host o cliente está soportado.
- **No debe:** afirmar interoperabilidad a partir de un fragmento de
  configuración generado solamente.
- **Por qué:** un archivo de configuración prueba intención de conectar, no
  que la negociación tenga éxito — los desajustes de handshake, schema y
  capacidad solo aparecen en el cable (`→ see evidence.md`).

### 8 — Los servidores lanzados corren con un entorno restringido

- **Debe:** al lanzar un servidor MCP, fijar o eliminar las variables de
  entorno que alteran su superficie negociada — incluidas las variables de
  perfil, inyección, taint y presupuesto del servidor de destino.
- **No debe:** lanzar con un entorno heredado sin restricciones.
- **Por qué:** las variables ambientales cambian silenciosamente la
  superficie de herramientas negociada; el host planifica entonces contra
  herramientas distintas de las declaradas.
