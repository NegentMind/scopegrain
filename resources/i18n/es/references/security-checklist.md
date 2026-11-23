# Superficies de seguridad

Las superficies relevantes incluyen validación de entrada, inyección,
identidad, autorización, fronteras de ruta/red, secretos, confianza de
dependencias y salida de errores sensible. Determina qué rutas se ejecutan
realmente. Registra los prerequisitos de explotación, el comportamiento
observado y las suposiciones no probadas. Una revisión estática local no es
un pentest ni un certificado de garantía.

Referencia rápida para seguridad de aplicaciones web. Cada ítem siguiente
es comprobable; registra qué rutas se ejecutan realmente antes de
puntuarlas.

## Tabla de contenidos

- [Modelado de amenazas (empieza aquí)](#modelado-de-amenazas-empieza-aquí)
- [Comprobaciones pre-commit](#comprobaciones-pre-commit)
- [Autenticación](#autenticación)
- [Autorización](#autorización)
- [Validación de entrada](#validación-de-entrada)
- [Cabeceras de seguridad](#cabeceras-de-seguridad)
- [Configuración de CORS](#configuración-de-cors)
- [Protección de datos](#protección-de-datos)
- [Seguridad de dependencias](#seguridad-de-dependencias)
- [Seguridad de AI / LLM](#seguridad-de-ai--llm)
- [Manejo de errores](#manejo-de-errores)
- [Referencia rápida OWASP Top 10](#referencia-rápida-owasp-top-10)
- [Referencia rápida OWASP Top 10 para LLMs](#referencia-rápida-owasp-top-10-para-llms)

## Modelado de amenazas (empieza aquí)

Antes de buscar controles, dedica cinco minutos a pensar como un atacante:

- [ ] Fronteras de confianza mapeadas (peticiones, uploads, webhooks, APIs de terceros, salida de LLM)
- [ ] Assets nombrados (credenciales, PII, datos de pago, acciones de admin, movimiento de dinero)
- [ ] STRIDE ejecutado por frontera (Spoofing, Tampering, Repudiation, Info disclosure, DoS, Elevation)
- [ ] Casos de abuso escritos junto a los casos de uso ("¿cómo usaría mal esto?")

## Comprobaciones pre-commit

- [ ] Sin secretos en el código (`git diff --cached | grep -i "password\|secret\|api_key\|token"`)
- [ ] `.gitignore` cubre: `.env`, `.env.local`, `*.pem`, `*.key`
- [ ] `.env.example` usa valores placeholder (no secretos reales)

## Autenticación

- [ ] Contraseñas hasheadas con Argon2id (preferido por OWASP: ≥19 MiB de
      memoria, iteraciones ≥2, paralelismo 1); si no está disponible,
      scrypt (N ≥2^17, r=8, p=1) o bcrypt (el suelo OWASP es factor de
      trabajo ≥10 — usa ≥12 y ajusta a la capacidad del servidor; límite de
      contraseña de 72 bytes)
- [ ] Cookies de sesión: `httpOnly`, `secure`, `sameSite: 'lax'`
- [ ] Expiración de sesión configurada (max-age razonable)
- [ ] Rate limiting en el endpoint de login (≤10 intentos por 15 minutos)
- [ ] Tokens de reset de contraseña: limitados en tiempo (≤1 hora), de un solo uso
- [ ] Bloqueo de cuenta tras fallos repetidos (opcional, con notificación)
- [ ] MFA soportado para operaciones sensibles (opcional pero recomendado)

## Autorización

- [ ] Cada endpoint protegido comprueba autenticación
- [ ] Cada acceso a recurso comprueba propiedad/rol (previene IDOR)
- [ ] Los endpoints de admin requieren verificación de rol admin
- [ ] Las claves de API acotadas a los permisos mínimos necesarios
- [ ] Los tokens JWT validados (firma, expiración, emisor)

## Validación de entrada

- [ ] Toda entrada de usuario validada en las fronteras del sistema (rutas de API, form handlers)
- [ ] La validación usa allowlists (no denylists)
- [ ] Longitudes de string restringidas (min/max)
- [ ] Rangos numéricos validados
- [ ] Formatos de email, URL y fecha validados con bibliotecas apropiadas
- [ ] Uploads de archivos: tipo restringido, tamaño limitado, contenido verificado
- [ ] Consultas SQL parametrizadas (sin concatenación de strings)
- [ ] Salida HTML codificada (usa el auto-escaping del framework)
- [ ] URLs validadas antes de redirigir (previene open redirect)
- [ ] Fetches de URL en servidor en allowlist; IPs privadas/reservadas bloqueadas (previene SSRF)

## Cabeceras de seguridad

```
Content-Security-Policy: default-src 'self'; script-src 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0  (disabled, rely on CSP)
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

## Configuración de CORS

```typescript
// Restrictive (recommended)
cors({
  origin: ['https://yourdomain.com', 'https://app.yourdomain.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
})

// NEVER use in production:
cors({ origin: '*' })  // Allows any origin
```

## Protección de datos

- [ ] Campos sensibles excluidos de las respuestas de API (`passwordHash`, `resetToken`, etc.)
- [ ] Datos sensibles no registrados en logs (contraseñas, tokens, números completos de tarjeta)
- [ ] PII cifrada en reposo (si lo exige la regulación)
- [ ] HTTPS para toda comunicación externa
- [ ] Backups de base de datos cifrados

## Seguridad de dependencias

```bash
# Audit dependencies
npm audit

# Fix automatically where possible
npm audit fix

# Check for critical vulnerabilities
npm audit --audit-level=critical

# Keep dependencies updated
npx npm-check-updates
```

**Higiene de supply-chain** (`npm audit` no detecta paquetes maliciosos):
- [ ] Lockfile commiteado; CI instala con `npm ci` (no `npm install`)
- [ ] Dependencias nuevas revisadas (mantenimiento, descargas, scripts `postinstall`)
- [ ] Sin typosquats (`cross-env` vs `crossenv`, `react-dom` vs `reactdom`)

## Seguridad de AI / LLM

Para cualquier funcionalidad que llame a un LLM (chatbots, summarizers,
agentes, RAG):

- [ ] La salida del modelo tratada como no confiable — nunca hacia `eval`/SQL/shell/`innerHTML`/rutas de archivo
- [ ] Prompt injection asumida; los permisos se aplican en código, no en el system prompt
- [ ] Secretos, datos cross-tenant y system prompts completos mantenidos fuera de la ventana de contexto
- [ ] Permisos de herramientas/agente acotados; las acciones destructivas o irreversibles requieren confirmación
- [ ] Límites de tokens, tasa y recursión/bucles fijados (consumo acotado)

## Manejo de errores

```typescript
// Production: generic error, no internals
res.status(500).json({
  error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' }
});

// NEVER in production:
res.status(500).json({
  error: err.message,
  stack: err.stack,         // Exposes internals
  query: err.sql,           // Exposes database details
});
```

## Referencia rápida OWASP Top 10

La tabla siguiente sigue la edición vigente **OWASP Top 10:2025** (release
final; la edición 2021 queda reemplazada). SSRF se incorporó a A01,
"Vulnerable and Outdated Components" pasó a ser A03 Software Supply Chain
Failures, y A10 es una categoría nueva.

| # | Categoría (2025) | Prevención |
|---|---|---|
| A01 | Broken Access Control (incl. SSRF) | Comprobaciones de auth en cada endpoint, verificación de propiedad; URLs salientes en allowlist |
| A02 | Security Misconfiguration | Cabeceras de seguridad, permisos mínimos, defaults endurecidos |
| A03 | Software Supply Chain Failures | Auditoría de dependencias, lockfiles, deps revisadas, artefactos firmados |
| A04 | Cryptographic Failures | HTTPS, hashing fuerte, sin secretos en el código |
| A05 | Injection | Consultas parametrizadas, validación de entrada |
| A06 | Insecure Design | Modelado de amenazas, desarrollo dirigido por spec |
| A07 | Authentication Failures | Contraseñas fuertes, rate limiting, gestión de sesiones |
| A08 | Software or Data Integrity Failures | Verificar actualizaciones/dependencias, integridad de CI/CD |
| A09 | Security Logging & Alerting Failures | Registrar eventos de seguridad, no registrar secretos, telemetría alertable |
| A10 | Mishandling of Exceptional Conditions | Salida de error genérica, sin internos expuestos, modos de fallo seguros |

## Referencia rápida OWASP Top 10 para LLMs

Para apps con funcionalidades LLM. La tabla siguiente sigue la edición
vigente **OWASP GenAI LLM Top 10:2026** (publicada en agosto de 2026).
Fuente: [OWASP GenAI Security Project](https://genai.owasp.org/llm-top-10/).
Renombrados notables frente a la edición 2025: "System Prompt Leakage" pasó
a ser LLM08 Hidden Context Exposure, e Improper Output Handling se movió a
LLM10.

| ID | Riesgo (2026) | Prevención |
|---|---|---|
| LLM01 | Prompt Injection | No confíes en el system prompt como frontera; aplica permisos en código |
| LLM02 | Sensitive Information Disclosure | Mantén secretos/PII fuera de los prompts; filtra las salidas |
| LLM03 | Excessive Agency | Acota permisos de herramientas; confirma acciones destructivas |
| LLM04 | Supply Chain | Audita modelos, datasets y plugins como cualquier dependencia |
| LLM05 | Data and Model Poisoning | Usa fuentes de modelos confiables, verifica integridad; audita datos de fine-tuning y RAG |
| LLM06 | Unbounded Consumption | Limita tokens, tasa de peticiones y profundidad de bucle/recursión |
| LLM07 | Misinformation | Fundamenta respuestas con citas; valida afirmaciones críticas; mantén un humano en el bucle |
| LLM08 | Hidden Context Exposure | Asume que prompts/contexto pueden filtrarse; sin secretos en ellos; acota la persistencia de memoria |
| LLM09 | Vector and Embedding Weaknesses | Particiona embeddings de RAG por tenant; valida documentos antes de indexar |
| LLM10 | Improper Output Handling | Trata la salida del modelo como no confiable; valida, parametriza, codifica |

<!-- Cross-references: → see quality-floor.md, observability-checklist.md, definition-of-done.md, ship-runbook.md -->
