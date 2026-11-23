---
name: observability-and-instrumentation
description: Usar cuando las afirmaciones operativas requieren logs, métricas o trazas reales en lugar de marcadores estáticos
---
# Observabilidad e instrumentación

## Disciplina central

Define la pregunta y los eventos necesarios para responderla.
Inspecciona la instrumentación existente y los identificadores de correlación.
Mantén las entradas sensibles y las credenciales fuera de la telemetría compartida.
Verifica que los datos se recopilen realmente antes de exponer o declarar una métrica.
Registra las brechas y el costo de recopilación; no fabriques mediciones.
Usa entornos propios o autorizados y preserva la evidencia de fallos.

El código que no puede observarse no puede operarse. La observabilidad es la
capacidad de responder "¿qué está haciendo el sistema y por qué?" desde fuera,
usando la telemetría que el código emite. La instrumentación se escribe junto a
la funcionalidad, como los tests: una funcionalidad entregada sin telemetría
convierte el primer incidente en arqueología en lugar de una consulta.

## Cuándo usar

- Al construir cualquier cosa que se ejecute en producción.
- Nuevos endpoints, trabajos en segundo plano, integraciones externas, reintentos o colas.
- Un incidente tardó demasiado en diagnosticarse con los datos disponibles.
- Al configurar o revisar alertas.

**No aplica para:**

- Diagnosticar un fallo en vivo: eso es `systematic-debugging` (esta skill es
  lo que hace que aquella sea rápida la próxima vez).
- Optimizar una lentitud ya medida: `performance-optimization`.
- Listas de verificación de monitoreo del día de lanzamiento y disparadores de rollback: `shipping-and-launch`.

## Proceso

### 1. Define "funcionar" antes de instrumentar

La telemetría sin una pregunta es ruido. Antes de añadir cualquier señal,
escribe 2–4 preguntas que un ingeniero de guardia hará sobre esta funcionalidad:

```
FEATURE: payment retry
QUESTIONS ON-CALL WILL ASK:
1. What fraction succeeds on first attempt vs after retry?
2. On permanent failure, why? (provider error? timeout? validation?)
3. Is the provider slower than usual?
→ Every signal below must answer one of these.
```

Si las preguntas no pueden nombrarse, no instrumentes todavía: registrarlo
todo no enseña nada.

### 2. Elige la señal correcta para cada pregunta

| Señal | Responde | Perfil de costo | Ejemplo |
|---|---|---|---|
| Log estructurado | "¿Qué ocurrió en este caso concreto?" | por evento; crece con el tráfico | `payment_failed` + código del proveedor |
| Métrica | "¿Con qué frecuencia / qué tan rápido, en agregado?" | fijo por serie; barato de consultar | latencia p99 de llamadas al proveedor |
| Traza | "¿A dónde se fue el tiempo entre servicios?" | por petición; normalmente muestreada | un checkout lento por salto |

Regla general: las métricas te dicen **que** algo va mal, las trazas te dicen
**dónde**, los logs te dicen **por qué**.

### 3. Logging estructurado

Registra eventos, no prosa. Cada línea es un objeto estructurado con un
nombre de evento estable y campos legibles por máquina:

```
BAD:  info(`Payment ${id} failed for user ${userId} after ${n} retries`)
GOOD: warn({ event: 'payment_failed', paymentId: id, provider: 'x',
             errorCode: err.code, attempt: n }, 'payment failed')
```

**Niveles de log: semántica consistente:**

| Nivel | Significado | Acción del guardia |
|---|---|---|
| `error` | invariante roto; alguien puede necesitar actuar | investigar |
| `warn` | degradado pero gestionado (reintento exitoso, fallback usado) | vigilar tendencias |
| `info` | evento de negocio significativo | ninguna |
| `debug` | detalle de diagnóstico | desactivado en producción por defecto |

**Los IDs de correlación son obligatorios.** Genera o acepta un ID de petición
en el límite del sistema; adjúntalo a cada línea de log, span y llamada
saliente: sin él, una petición no puede reconstruirse a partir de logs
entrelazados. Propágalo a través de los límites de servicios y colas.

**Nunca registres secretos, tokens, contraseñas ni PII completa.** Las
tuberías de telemetría son una vía clásica de filtrado: usa listas blancas de
campos; nunca registres cuerpos de petición completos.

### 4. Métricas

Para servicios orientados a peticiones, instrumenta **RED** en cada endpoint
y cada dependencia externa: **R**ate, **E**rrors, **D**uration (histograma, no
promedio). Para recursos (colas, pools, hosts) usa **USE**: **U**tilization,
**S**aturation, **E**rrors. (RED es el subconjunto orientado a peticiones de
las **cuatro señales doradas** de Google SRE: latencia, tráfico, errores,
saturación; USE es el método a nivel de recurso.) Prefiere el estándar de
telemetría neutro respecto al proveedor (OpenTelemetry o el equivalente del
proyecto) para que la instrumentación sobreviva a la elección del backend.

**La cardinalidad es el modo de fallo.** Cada combinación única de etiquetas
es una serie separada. Las etiquetas solo provienen de conjuntos pequeños y
fijos:

```
OK as label:    route_template   status_class="5xx"   provider
NEVER a label:  user_id, email, request_id, raw URL, error text
```

Nunca registres promedios, siempre percentiles: un promedio oculta al 1% de
usuarios que lo pasan fatal. Usa histogramas; lee p50/p95/p99.

### 5. Trazado distribuido

- Prefiere el estándar neutro respecto al proveedor con autoinstrumentación
  que cubra transportes y clientes de datos comunes: casi cero código.
- Añade spans manuales solo alrededor de unidades internas de trabajo
  significativas; adjunta los atributos por los que el guardia filtrará.
- Propaga el contexto a través de cada límite asíncrono (cabeceras, metadatos
  de cola) o la traza muere en la brecha.
- Muestrea con head-based a una tasa por defecto baja; conserva el 100% de
  los errores donde el backend admita muestreo tail.

### 6. Alertas

Alerta sobre **síntomas que los usuarios sienten**, no sobre causas:

```
SYMPTOM (page-worthy):        CAUSE (dashboard, not a page):
error rate > 1% for 5 min     CPU at 85%
p99 latency > 2s              one instance restarted
queue age > 10 min            disk at 70%
```

Las alertas basadas en causas saltan cuando nada va mal y pierden fallos
imprevistos. Reglas para cada alerta:

1. **Accionable**: si la respuesta es "se autocorrige", elimínala.
2. **Enlaza un runbook**: aunque sean tres líneas: significado, primera
   consulta, escalado.
3. **Umbral + duración** justificados por el SLO o el historial, no una suposición.
4. **Solo dos severidades**: page (visible para el usuario, actuar ya) y ticket
   (degradación, actuar esta semana). Un tercer nivel entrena a la gente a ignorar todos.

### 7. Verifica la propia telemetría

La instrumentación es código; puede estar mal. Antes de dar el trabajo por
terminado:

- Fuerza un error en un entorno propio/autorizado → encuéntralo por ID de
  correlación; confirma que los campos son estructurados, no `[object Object]`.
- Envía tráfico de prueba → confirma que aparecen las series de métricas con
  las etiquetas esperadas y valores razonables.
- Sigue una petición de extremo a extremo → sin spans rotos.
- Dispara cada alerta nueva una vez (baja temporalmente el umbral) → confirma
  que llega al canal correcto y que el enlace del runbook funciona.
- Preserva la evidencia del fallo; registra brechas y costo de recopilación.
  Nunca fabriques mediciones ni declares una métrica antes de que los datos
  fluyan realmente.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Añadiré logging cuando funcione" | "Después" se convierte en "después del primer incidente": el momento más caro para descubrir la ceguera. |
| "Más logs = más observabilidad" | El ruido no estructurado ralentiza los incidentes. Tres eventos consultables superan a 300 líneas de prosa. |
| "La salida por consola vale por ahora" | La salida no estructurada no puede filtrarse, correlacionarse ni alertarse. |
| "Miraremos los dashboards cuando se rompa" | Los dashboards construidos sin preguntas definidas muestran todo menos la respuesta. |
| "Alerta de todo, afina después" | Un pager ruidoso entrena a la gente a ignorarlo; la page real se pierde. |
| "El ID de usuario como etiqueta de métrica ayuda a depurar" | También colapsa el backend de métricas. Las búsquedas de alta cardinalidad viven en logs/trazas. |
| "El tracing es excesivo para dos servicios" | Dos servicios ya plantean preguntas entre servicios que los logs no pueden responder; la autoinstrumentación es barata. |

## Señales de alerta

- Una funcionalidad con reintentos, colas o llamadas externas y cero telemetría nueva.
- Líneas de log construidas por interpolación de cadenas en lugar de campos estructurados.
- Sin ID de correlación: cada línea de log es una huérfana.
- Etiquetas de métricas que llevan IDs de usuario, URLs crudas o texto de error (bomba de cardinalidad).
- Latencia registrada como promedio sin percentiles.
- Alertas que saltan a diario y se reconocen sin acción.
- Pager basado en causas mientras la tasa de error visible al usuario no se monitorea.
- Secretos, tokens o cuerpos de petición completos en los logs.
- "En mi máquina funciona" ofrecido como evidencia de salud en producción.

## Contrato de salida

La instrumentación se entrega con prueba de que funciona:

- Las preguntas del guardia escritas, cada señal mapeada a una.
- Salida de telemetría real mostrada: una línea de log estructurada hallada
  por ID de correlación, una serie de métrica con sus etiquetas, una traza de
  extremo a extremo.
- Cada alerta listada con su síntoma, justificación del umbral, enlace al
  runbook y resultado del disparo de prueba.
- Brechas y costo de recopilación (tasa de muestreo, cardinalidad, volumen de
  logs) registrados: nunca una métrica declarada antes de que los datos fluyan.

## Verificación

- [ ] Preguntas del guardia escritas; cada señal mapea a una.
- [ ] Toda la salida de log estructurada con nombres de evento estables y un
      ID de correlación en cada línea.
- [ ] Sin secretos, tokens ni PII sin redactar en la telemetría (salida real
      comprobada por muestreo).
- [ ] Métricas RED en cada endpoint nuevo y dependencia externa, con
      conjuntos de etiquetas acotados.
- [ ] La latencia es un histograma; p95/p99 consultables.
- [ ] Una petición rastreable de extremo a extremo en trazas sin spans rotos.
- [ ] Cada alerta nueva es por síntoma, enlaza un runbook y se disparó en
      prueba una vez.
- [ ] Un fallo inducido fue localizado solo con telemetría: datos realmente
      recopilados, no supuestos.

## Véase también

- `resources/references/observability-checklist.md`: lista de verificación
  rápida y puerta de instrumentación previa al lanzamiento.
- `security-and-hardening`: mantén credenciales y PII fuera de la telemetría.
- `performance-optimization`: qué hacer una vez que la telemetría demuestra lentitud.
