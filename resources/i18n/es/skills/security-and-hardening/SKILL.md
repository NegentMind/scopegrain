---
name: security-and-hardening
description: Usar cuando un cambio toca entradas no confiables, permisos, datos sensibles o confianza de dependencias
---
# Seguridad y endurecimiento

## Disciplina central

Mapea entradas, identidades, autoridad y salidas sensibles para la ruta real.
Comprueba validación, contención, inyección, privilegio y divulgación de
errores. Inspecciona los límites de dependencias y protocolos sin asumir
herramientas instaladas. Usa fixtures propios para entradas adversarias;
pide permiso para tests externos, entrega de exploits o acciones destructivas.
Reporta evidencia causal, prerrequisitos y riesgos residuales. No equipares
una checklist o un escáner limpio con una certificación de seguridad.

Trata cada entrada externa como hostil, cada secreto como sagrado y cada
comprobación de autorización como obligatoria. La seguridad no es una fase:
es una restricción sobre cada línea que toca datos de usuario, autenticación
o sistemas externos.

## Cuándo usar

- Cualquier cosa que acepte entrada de usuario.
- Cambios de autenticación o autorización.
- Almacenar o transmitir datos sensibles.
- Integraciones externas, subidas de archivos, webhooks, callbacks.
- Manejo de pagos o PII; cambios de dependencias y cadena de suministro.

## Proceso: modelo de amenazas primero

Los controles atornillados sin un modelo de amenazas son suposiciones. Antes
de endurecer, dedica cinco minutos a pensar como un atacante:

1. **Mapea los límites de confianza.** ¿Dónde cruza hacia dentro el dato no
   confiable? Peticiones, campos de formulario, subidas, webhooks,
   respuestas de terceros, colas, y la salida de modelos/LLM. Cada límite es
   superficie de ataque.
2. **Nombra los activos.** ¿Qué vale la pena robar o romper? Credenciales,
   PII, datos de pago, acciones de administrador, estado almacenado.
3. **Ejecuta STRIDE sobre cada límite**: una lente rápida, no una ceremonia:

| Amenaza | Pregunta | Mitigación típica |
|---|---|---|
| **S**poofing | ¿Puede alguien suplantar a un usuario/servicio? | Autenticación, verificación de firmas |
| **T**ampering | ¿Pueden alterarse los datos en tránsito o en reposo? | Comprobaciones de integridad, consultas parametrizadas, TLS |
| **R**epudiation | ¿Puede una acción negarse después? | Audit logging de eventos de seguridad |
| **I**nformation disclosure | ¿Pueden filtrarse los datos? | Cifrado, listas blancas de campos, errores genéricos |
| **D**enial of service | ¿Puede saturarse? | Rate limits, topes de tamaño de entrada, timeouts |
| **E**levation of privilege | ¿Puede un usuario ganar derechos indebidos? | Comprobaciones de autorización, mínimo privilegio |

4. **Escribe casos de abuso junto a los casos de uso.** Para cada
   funcionalidad pregunta "¿cómo abusaría yo de esto?": eso se convierte en
   el primer test adversario.

Si los límites de confianza no pueden nombrarse, la funcionalidad no está
lista para asegurarse. El diseño inseguro falla antes que el código: OWASP
Top 10:2025 **A06 Insecure Design** (la edición 2021 la clasificó A04).

## El sistema de límites de tres niveles

### Siempre hacer (sin excepciones)

- Valida toda entrada externa en el límite del sistema.
- Parametriza todas las consultas de base de datos: nunca concatenes entrada
  en consultas o comandos.
- Codifica la salida para prevenir inyección (auto-escaping; no lo evadas).
- Usa transporte cifrado para toda comunicación externa.
- Hashea contraseñas con un algoritmo memory-hard (bcrypt ≥12 rondas, scrypt,
  argon2): nunca almacenes texto plano.
- Establece cabeceras de seguridad donde aplique (CSP, HSTS, protecciones de
  frame/content-type).
- Usa atributos `httpOnly`, `secure`, `sameSite` en cookies de sesión.
- Ejecuta la herramienta de auditoría de dependencias del ecosistema antes de
  cada release (`npm audit`, `pip-audit`, `cargo audit`, `govulncheck`: la
  que el proyecto declare).

### Preguntar primero (requiere aprobación del dueño)

- Nuevos flujos de autenticación o cambios en la lógica de auth.
- Nuevas categorías de datos sensibles almacenados (PII, info de pago).
- Nuevas integraciones de servicios externos.
- Cambios de CORS; manejadores de subida de archivos; cambios de rate-limit.
- Permisos o roles elevados; tests externos, entrega de exploits o cualquier
  acción de seguridad destructiva: usa fixtures propios para entradas
  adversarias y pide permiso para cualquier cosa más allá de ellos.

### Nunca hacer

- Commitear secretos al control de versiones (claves, contraseñas, tokens).
- Registrar datos sensibles en logs (contraseñas, tokens, números de tarjeta
  completos, PII sin redactar).
- Tratar la validación del lado del cliente como un límite de seguridad.
- Desactivar mecanismos de seguridad por conveniencia.
- Evaluar datos provistos por el usuario como código (sumideros estilo
  `eval`, sumideros de HTML crudo).
- Almacenar sesiones en almacenamiento accesible al cliente.
- Exponer stack traces o detalles internos de error a los llamantes.

## Patrones de prevención OWASP

Los patrones de prevención siguientes mapean al OWASP Top 10:2025 (RC1:
nombres de ítems finales, texto aún en borrador): A05 Injection, A07
Authentication Failures, A01 Broken Access Control (SSRF incorporado), A02
Security Misconfiguration, A04 Cryptographic Failures, A03 Software Supply
Chain Failures. El resto: A06 Insecure Design (el paso de modelo de
amenazas anterior), A08 Software or Data Integrity Failures (integridad de
dependencias/CI más abajo), A09 Logging & Alerting Failures (audit logging
de eventos de seguridad: `observability-and-instrumentation`) y A10
Mishandling of Exceptional Conditions (fallar cerrado; las respuestas de
error no filtran nada interno).

### Inyección — A05 (consulta, comando, ORM)

```
BAD:  `SELECT * FROM users WHERE id = '${userId}'`
GOOD: db.query('SELECT * FROM users WHERE id = $1', [userId])
GOOD: orm.user.findUnique({ where: { id: userId } })   // parameterized
```

### Autenticación rota — A07

- Hashea con un algoritmo memory-hard con configuración de costo actual.
- Los secretos de sesión vienen del entorno, nunca del código.
- Cookies de sesión: `httpOnly` + `secure` + `sameSite` + `maxAge` acotado.
- Rate-limit en flujos de login y reset; los tokens de reset expiran.

### Cross-site scripting — inyección de salida, A05

```
BAD:  element.innerHTML = userInput;
GOOD: render through the framework's auto-escaping;
      if raw HTML is required, sanitize through a vetted sanitizer first.
```

### Control de acceso roto — A01

La autenticación no es autorización. Cada operación protegida comprueba que
el llamante puede actuar sobre *este* recurso:

```
on update(resourceId):
  resource = load(resourceId)
  if resource.owner != caller.id → 403 FORBIDDEN
  proceed
```

### Misconfiguración de seguridad — A02

- Envía una política de contenido/seguridad restrictiva; endurece con el tiempo.
- Restringe el acceso cross-origin a una lista blanca de orígenes conocidos;
  nunca comodines de origen junto con credenciales.

### Exposición de datos sensibles — A04 Cryptographic Failures

```
function toPublic(user):  strip passwordHash, resetToken, internal fields
                          before any response leaves the boundary.
secrets read from environment/config; missing → fail closed, never default.
```

### Server-side request forgery (SSRF) — dentro de A01 desde 2025

Cada vez que el servidor obtiene una URL influenciada por el llamante
(webhooks, "importar desde URL", proxies de imágenes, previsualizaciones de
enlaces), un atacante puede apuntarla a servicios internos (endpoints de
metadatos de nube, loopback, rangos privados).

```
BAD:  fetch(request.body.webhookUrl)

GOOD: allowlist scheme + host, resolve ALL DNS records, reject if ANY
      resolved address is non-unicast (loopback/link-local/private/
      unique-local across v4+v6), and forbid redirects.
```

**Advertencia: brecha TOCTOU:** el fetch puede resolver DNS de nuevo tras la
comprobación, así que un registro con TTL corto puede re-enlazar a una IP
interna entre la validación y la conexión. Para superficies de alto riesgo,
resuelve una vez y conecta a la dirección fijada, o coloca un filtro de
egreso delante.

## Patrones de validación de entrada

- **Valida por esquema en el límite**: tipos declarados, topes de longitud,
  valores enumerados, cadenas recortadas. Rechaza con la forma de error
  consistente y detalles por campo; después el código interno confía en los
  tipos.
- **Subidas de archivos**: lista blanca de tipos de medio, tope de tamaños y
  comprobación de contenido (magic bytes) en lugar de confiar en la
  extensión cuando importa.

## Triaje de auditoría de dependencias

No todo hallazgo necesita acción inmediata. Árbol de decisión:

```
audit reports a vulnerability
├── severity critical/high
│   ├── vulnerable code reachable in this app?
│   │   ├── yes → fix now (update, patch or replace the dependency)
│   │   └── no (dev-only, dead path) → fix soon, not a blocker
│   └── fix available?
│       ├── yes → update to the patched version
│       └── no → workaround, replace the dep, or allowlist with a review date
├── moderate → reachable in production? next release cycle; dev-only? backlog
└── low → track; fix during regular dependency updates
```

Preguntas clave: ¿la función vulnerable realmente se llama? ¿dependencia de
runtime o solo dev? ¿explotable en este contexto de despliegue? Al diferir,
registra la razón y una fecha de revisión.

### Higiene de cadena de suministro

Las herramientas de auditoría detectan vulnerabilidades conocidas; no
detectan paquetes maliciosos ni typosquatted.

- **Commitea el lockfile**; instala reproduciblemente en CI: sin deriva
  silenciosa.
- **Revisa las dependencias nuevas**: mantenimiento, adopción, si se ganan su
  lugar. Cada dependencia es superficie de ataque (OWASP **A03 Software
  Supply Chain Failures**, **LLM03 Supply Chain**).
- **Cuidado con los scripts de instalación** en paquetes desconocidos:
  código arbitrario en tiempo de instalación.
- **Vigila los typosquats**: nombres parecidos que difieren en un carácter.

## Rate limiting

Acota el consumo en el límite: un límite general por ventana para la API, y
uno mucho más estricto para los endpoints de autenticación (intentos, no
solo peticiones). Devuelve cabeceras de límite y `Retry-After`.

## Gestión de secretos

```
.env.example  → committed template with placeholders
.env, *.local → NEVER committed
ignore rules must cover: .env*, *.pem, *.key
```

Escanea los diffs preparados buscando `password|secret|api_key|token` antes
de commitear. **Si un secreto llega a un remoto, rótalo**: borrar la línea o
reescribir el historial no basta; asume compromiso, revoca y reemite primero,
luego purga el historial.

## Asegurar funcionalidades de IA/LLM

Toda funcionalidad que llama a un modelo hereda una nueva superficie de
ataque (OWASP Top 10 for LLM Applications 2025):

- **La salida del modelo es entrada no confiable (LLM05 Improper Output
  Handling).** Nunca la canalices a evaluación de código, consultas, shells,
  HTML crudo o rutas de archivo. Parsea defensivamente → valida → codifica,
  exactamente como entrada cruda de usuario.
- **Los prompts pueden secuestrarse (LLM01 Prompt Injection).** El texto no
  confiable en el contexto (mensaje de usuario, página obtenida, documento)
  puede llevar instrucciones. El system prompt no es un límite de seguridad:
  aplica permisos en código, no en el prompt.
- **Mantén secretos y datos entre tenants fuera de los prompts (LLM02
  Sensitive Information Disclosure / LLM07 System Prompt Leakage).**
  Cualquier cosa en el contexto puede ser repetida.
- **Restringe los permisos de herramientas/agentes (LLM06 Excessive
  Agency).** Alcance mínimo, confirmación para acciones destructivas o
  irreversibles, valida cada argumento de herramienta.
- **Acota el consumo (LLM10 Unbounded Consumption).** Tope de tokens, tasa y
  profundidad de bucle para que una entrada manipulada no dispare el costo
  ni cuelgue el sistema.
- **Aísla los datos de recuperación (LLM08 Vector and Embedding
  Weaknesses).** En sistemas de recuperación aumentada, particiona los
  embeddings por tenant y valida los documentos antes de indexar.

```
BAD:  db.query(await llm.generate(sqlText));  container.innerHTML = reply;
GOOD: intent = schema.parse(json.parse(reply));  // validate
      runAllowlistedAction(intent.action, intent.params);
      container.textContent = reply;              // encode
```

## Checklist de revisión de seguridad

**Autenticación**
- [ ] Contraseñas hasheadas con un algoritmo memory-hard (bcrypt ≥12 / scrypt / argon2).
- [ ] Tokens de sesión httpOnly + secure + sameSite; login con rate-limit; tokens de reset expiran.

**Autorización**
- [ ] Cada endpoint comprueba permisos; los usuarios alcanzan solo sus propios recursos; acciones de admin re-verificadas.

**Entrada**
- [ ] Toda entrada externa validada en el límite; consultas parametrizadas; salida codificada.
- [ ] Fetches del lado del servidor con lista blanca (sin SSRF a servicios internos).

**Datos**
- [ ] Sin secretos en código ni historial; campos sensibles excluidos de las respuestas; PII protegida en reposo.

**Infraestructura**
- [ ] Cabeceras de seguridad establecidas; CORS restringido a orígenes conocidos; dependencias auditadas; los errores no filtran nada interno.

**Cadena de suministro**
- [ ] Lockfile commiteado; instalación de CI reproducible; nuevas dependencias revisadas (mantenimiento, scripts de instalación, typosquats).

**IA/LLM (si está presente)**
- [ ] Salida del modelo tratada como no confiable; secretos/PII fuera de los prompts; permisos de herramientas acotados con confirmación para acciones destructivas.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Herramienta interna, la seguridad no importa" | Las herramientas internas se comprometen; los atacantes golpean el eslabón más débil. |
| "Añadiremos seguridad después" | Reacondicionar es un orden de magnitud más difícil que incorporarla desde el inicio. |
| "Nadie explotaría esto" | Los escáneres automatizados lo encontrarán; la oscuridad no es seguridad. |
| "El framework maneja la seguridad" | Los frameworks proveen herramientas, no garantías: deben usarse correctamente. |
| "Es solo un prototipo" | Los prototipos se convierten en producción. |
| "El threat modeling es excesivo" | Cinco minutos de "¿cómo atacaría esto?" previenen fallos de diseño que ningún control parcha después. |
| "Es solo salida del modelo, solo texto" | Ese "texto" puede ser una consulta, una etiqueta script o un comando de shell. |
| "Un escáner limpio significa que somos seguros" | Una checklist o un escaneo en verde es evidencia de comprobaciones ejecutadas: nunca una certificación. |

## Contrato de salida

Un pase de endurecimiento reporta hallazgos, no certificación:

- El modelo de amenazas: límites de confianza mapeados, activos nombrados,
  casos de abuso escritos.
- Cada hallazgo con evidencia causal (ruta, payload, precondiciones) y el
  control que lo cierra.
- Ítems diferidos con razón y fecha de revisión: triados, no descartados en
  silencio.
- Riesgo residual declarado explícitamente; un escaneo limpio es evidencia
  de comprobaciones ejecutadas, no prueba de seguridad.

## Señales de alerta

- Entrada de usuario llegando a consultas, comandos o renderizado de marcado directamente.
- Secretos en el código fuente o el historial.
- Endpoints sin comprobaciones de autenticación o autorización.
- Orígenes comodín, rate limits ausentes en endpoints de auth.
- Stack traces o internos expuestos a los llamantes.
- Dependencias con vulnerabilidades críticas conocidas sin atender.
- Servidor obteniendo URLs suministradas por el llamante sin lista blanca.
- Salida del modelo fluyendo a una consulta, el DOM, un shell o `eval`.
- Secretos, PII o el system prompt completo dentro de un contexto de modelo.

## Verificación

- [ ] La herramienta de auditoría del ecosistema no reporta hallazgos
      critical/high sin atender.
- [ ] Sin secretos en código ni historial; diffs preparados escaneados.
- [ ] Toda entrada externa validada en los límites; auth comprobada por endpoint.
- [ ] Cabeceras de seguridad presentes; las respuestas de error no exponen internos.
- [ ] Fetches de URL del lado del servidor validados contra una lista blanca.
- [ ] Salida del modelo validada y codificada antes de usarla (si hay funciones de IA).
- [ ] El informe lleva evidencia causal, prerrequisitos y riesgos
      residuales: enmarcado como hallazgos, no certificación.

## Véase también

- `resources/references/security-checklist.md`: la checklist detallada y los
  pasos de verificación pre-commit.
- `source-driven-development`: seguridad de recuperación para contenido obtenido.
- `observability-and-instrumentation`: audit logging de eventos de seguridad
  sin filtrar secretos a la telemetría.
