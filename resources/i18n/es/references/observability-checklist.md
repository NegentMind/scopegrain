# Evidencia operacional

Los registros útiles correlacionan una tarea, revisión, operación, entorno
y resultado sin exponer credenciales ni entrada privada.
Distingue los valores recogidos de las estimaciones y de la instrumentación
ausente. El registro exitoso de una métrica no prueba que esté poblada.
Preserva la evidencia de fallo y evita reemplazar corrupción por éxito
vacío.

Referencia rápida para instrumentar código de producción. Cada elemento
siguiente es comprobable; la instrumentación es código y puede estar mal en
sí misma.

## Tabla de contenidos

- [Preguntas de guardia (empieza aquí)](#preguntas-de-guardia-empieza-aquí)
- [Logging estructurado](#logging-estructurado)
- [Métricas](#métricas)
- [Trazado distribuido](#trazado-distribuido)
- [Alertas](#alertas)
- [Paneles](#paneles)
- [Verifica la telemetría](#verifica-la-telemetría)
- [Puerta previa al lanzamiento](#puerta-previa-al-lanzamiento)

## Preguntas de guardia (empieza aquí)

La telemetría sin una pregunta es ruido. Antes de instrumentar nada:

- [ ] Están escritas 2–4 preguntas que un ingeniero de guardia hará sobre esta funcionalidad
- [ ] Cada señal siguiente mapea a una de esas preguntas
- [ ] Cada pregunta está emparejada con el tipo de señal correcto: las métricas dicen **que**
      algo va mal, las trazas dicen **dónde**, los logs dicen **por qué**

## Logging estructurado

- [ ] Los logs son estructurados (JSON) con nombres de evento estables — no strings de forma libre
- [ ] Cada línea de log lleva un ID de correlación/petición, generado o aceptado en la frontera del sistema
- [ ] El ID de correlación se propaga en cada llamada saliente y frontera async (cabeceras HTTP, metadatos de cola)
- [ ] Los niveles de log son consistentes: `error` = invariante roto, alguien puede actuar; `warn` = degradado pero manejado; `info` = evento de negocio significativo; `debug` = apagado en producción
- [ ] Sin secretos, tokens, contraseñas ni PII sin redactar en ninguna línea de log
- [ ] Los campos están en allowlist — sin cuerpos completos de request/response, sin cabeceras de auth
- [ ] Las llamadas a servicios externos se registran solo con metadatos: endpoint, status, latencia, número de intento, identificadores saneados
- [ ] Salida de log real verificada por muestreo: campos estructurados, no `[object Object]`

## Métricas

- [ ] **RED** instrumentado para cada endpoint y cada dependencia externa: Rate, Errors, Duration
- [ ] **USE** instrumentado para cada recurso (colas, pools, hosts): Utilization, Saturation, Errors
- [ ] La latencia es un histograma; p50/p95/p99 consultables — nunca una media
- [ ] Todas las etiquetas provienen de conjuntos pequeños y fijos (plantilla de ruta, clase de status, nombre de proveedor)
- [ ] Sin valores de etiqueta no acotados: sin IDs de usuario, IDs de tenant, emails, URLs crudas, IDs de petición ni texto de mensajes de error
- [ ] Códigos de status agrupados por clase (`5xx`, no `503`)
- [ ] Profundidad de cola y duración de procesamiento registradas para cada worker/cola

## Trazado distribuido

- [ ] Un framework de tracing (OpenTelemetry o equivalente) inicializado al arranque del servicio, antes de otros imports
- [ ] Auto-instrumentación habilitada para clientes HTTP, RPC y DB
- [ ] Contexto de traza propagado en cada llamada saliente (W3C `traceparent`/`tracestate`) y extraído de cada petición entrante
- [ ] El contexto sobrevive a las fronteras async — los mensajes de cola llevan metadatos de traza
- [ ] Spans manuales solo alrededor de unidades internas de trabajo significativas, con los atributos por los que filtrará la guardia
- [ ] Sin secretos ni PII como atributos de span
- [ ] Muestreo head-based a una tasa por defecto baja; 100% de errores retenidos si hay muestreo tail disponible

## Alertas

- [ ] Cada alerta se basa en síntomas (tasa de error, latencia p99, edad de cola) — las causas (CPU, disco, reinicios) van a paneles, no a pagers
- [ ] Cada alerta es accionable; las alertas de "ignórala, se auto-repara" se eliminan
- [ ] Cada alerta enlaza a un runbook — mínimo tres líneas: qué significa, primera consulta a ejecutar, ruta de escalado
- [ ] Umbrales y duraciones justificados por un SLO o datos históricos, no por suposiciones
- [ ] Solo dos severidades: **page** (afecta a usuarios, actuar ya) y **ticket** (degradación, actuar esta semana)
- [ ] Cada alerta nueva disparada en prueba una vez: llegó al canal correcto y el enlace del runbook funciona
- [ ] Sin alertas que se disparen a diario y se reconozcan sin acción

## Paneles

- [ ] Existe un panel de salud del servicio: tasa de error, latencia p99, tráfico, saturación
- [ ] Un panel de salud de dependencias muestra tasas de error y latencia por servicio
- [ ] El panel responde a las preguntas de guardia del inicio de esta checklist — no "todo excepto la respuesta"
- [ ] El rango temporal por defecto es sensato (1h–6h, no 30d)

## Verifica la telemetría

La instrumentación es código; puede estar mal:

- [ ] Se forzó un error en staging → encontrado en los logs por ID de correlación
- [ ] Se envió tráfico de prueba → las series de métricas aparecen con las etiquetas esperadas y valores sensatos
- [ ] Se siguió una petición de extremo a extremo en la UI de tracing → sin spans rotos
- [ ] Un fallo inducido fue diagnosticado solo desde la telemetría, sin leer la fuente

## Puerta previa al lanzamiento

Antes de que una funcionalidad llegue a producción, todo lo siguiente es cierto:

- [ ] Logs estructurados fluyendo hacia el agregador de logs
- [ ] Métricas RED visibles en paneles para cada endpoint y dependencia nueva
- [ ] Al menos una alerta basada en síntomas configurada, con runbook, disparada en prueba
- [ ] Una petición puede trazarse a través de cada servicio que toca
- [ ] La guardia sabe dónde están los runbooks

<!-- Cross-references: → see ship-runbook.md, performance-checklist.md, security-checklist.md, definition-of-done.md -->
