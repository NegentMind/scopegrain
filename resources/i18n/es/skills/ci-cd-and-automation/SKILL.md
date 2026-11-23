---
name: ci-cd-and-automation
description: Úsala cuando un cambio afecta a un pipeline de verificación o entrega existente
---
# Límites del pipeline

Lee los workflows, disparadores, credenciales y matriz soportada reales del
proyecto. Traza qué entradas, artefactos y privilegios cruzan cada límite de
job. Preserva el mínimo privilegio, la reproducibilidad y el reporte claro
de fallos. No debilites tests, no amplíes secretos ni añadas efectos remotos
implícitamente. Valida la sintaxis y los fixtures propios relevantes cuando
esté autorizado. Separa editar un workflow de autorizar su ejecución en
producción.

Automatiza los controles de calidad para que ningún cambio llegue a
producción sin pasar tests, lint, comprobación de tipos y build. CI/CD es el
mecanismo de aplicación de todas las demás disciplinas — captura lo que
humanos y agentes pasan por alto, consistentemente, en cada cambio.

**Shift left:** captura los problemas lo antes posible en el pipeline. Un
bug capturado en lint cuesta minutos; el mismo bug en producción cuesta
horas. Mueve las comprobaciones hacia arriba — análisis estático antes que
tests, tests antes que staging, staging antes que producción.

**Más rápido es más seguro:** lotes más pequeños y entregas más frecuentes
reducen el riesgo. Un despliegue con 3 cambios es más fácil de depurar que
uno con 30.

## Cuándo usar

- Al configurar el pipeline de CI de un proyecto nuevo
- Al añadir o modificar comprobaciones automatizadas
- Al configurar pipelines de despliegue
- En cualquier cambio que debería disparar verificación automatizada
- Al depurar fallos de CI

## Contrato de salida

- Un informe de los controles añadidos, eliminados o reordenados — con la
  señal de fallo que produce cada control.
- El delta de permisos/secretos del cambio, señalado explícitamente
  (secretos nuevos, scopes de token ampliados, nuevos efectos remotos).
- Estado de validación de sintaxis y fixtures, marcado *ejecutado* o
  *pendiente* — editar un workflow se reporta por separado de autorizar su
  ejecución en producción.
- Ninguna comprobación no ejecutada se declara como superada.

## El pipeline de controles de calidad

Todo cambio pasa estos controles antes de la fusión:

```
Pull Request Opened
    │
    ▼
┌─────────────────┐
│   LINT           │
│   TYPE CHECK     │
│   UNIT TESTS     │
│   BUILD          │
│   INTEGRATION    │
│   E2E (optional) │
│   SECURITY AUDIT │
│   SIZE BUDGET    │
└─────────────────┘
    │
    ▼
  Ready for review
```

**Ningún control puede saltarse.** Si lint falla, arregla lint — no
desactives la regla. Si un test falla, arregla el código — no saltes el
test. Si un control está genuinamente mal, cámbialo deliberadamente con
aprobación del propietario, nunca en silencio.

## Forma del pipeline (patrón portable)

Adapta este esqueleto a la plataforma de CI real del proyecto:

```yaml
# quality job — one job per gate, run in parallel where independent
steps:
  - checkout
  - setup toolchain (pinned version, dependency cache)
  - install dependencies (locked/frozen install)
  - lint
  - type check
  - test (with coverage)
  - build
  - dependency/security audit (fail on high+)
```

Los tests de integración corren contra servicios efímeros declarados en el
workflow (contenedores con health checks), con credenciales del almacén de
secretos de CI — incluso las credenciales solo de test nunca van hardcodeadas.
Los jobs end-to-end suben sus informes/capturas como artefactos en caso de
fallo.

## Devolver los fallos de CI a los agentes

El poder de CI con agentes es el bucle de retroalimentación:

```
CI fails → copy the specific failure output → feed it to the agent
"The pipeline failed with this error: [paste]. Fix and verify locally."
→ agent fixes → pushes → CI runs again
```

| Fallo | Respuesta del agente |
|---|---|
| Lint | Ejecutar el auto-fix del linter, commit |
| Error de tipos | Leer la ubicación del error, corregir el tipo |
| Fallo de test | Aplicar depuración sistemática; arreglar el código, no el test |
| Error de build | Revisar configuración y dependencias |

Nunca devuelvas un error redactado o parafraseado — la salida literal es la
evidencia.

## Estrategias de despliegue

### Despliegues de vista previa

Cada PR obtiene un despliegue de vista previa aislado para verificación
manual antes de la fusión.

### Feature flags

Los flags desacoplan despliegue de publicación — entrega código sin
activarlo, revierte sin redesplegar, haz canary a un porcentaje pequeño y
amplía. El ciclo de vida de flags (propietario, caducidad, limpieza), los
porcentajes de despliegue escalonado y los umbrales de avance/pausa/rollback
viven en `shipping-and-launch`; el pipeline solo tiene que ejercitar ambos
estados del flag en CI.

### Despliegues escalonados

```
merge to main
  → staging deployment (auto) → manual verification
  → production deployment (manual or auto-after-staging)
  → monitoring window
      ├── errors detected → rollback
      └── clean → done
```

### Mecanismo de rollback

Todo despliegue necesita una ruta de retorno ensayada: redesplegar una
versión anterior fijada vía un workflow manual/dispatch, o desactivar el
flag. Documenta las condiciones de disparo y el tiempo de rollback antes del
despliegue, no durante el incidente.

## Gestión de entorno y secretos

```
.env.example        → committed (template, no real values)
.env                → never committed (local development)
.env.test           → committed only if it holds no real secrets
CI secrets          → CI secrets store / vault
Production secrets  → deployment platform / vault
```

- CI nunca contiene secretos de producción; usa credenciales separadas con
  alcance de CI.
- Traza qué jobs pueden leer qué secretos; un job de tests unitarios no
  debería tener credenciales de despliegue (mínimo privilegio por límite de
  job).
- Una edición de workflow que añade un secreto nuevo, scope de token o
  efecto remoto es un cambio privilegiado — señálalo explícitamente, no lo
  cueles con ediciones no relacionadas.

## Automatización más allá de CI

- **Actualizaciones de dependencias:** PRs automatizados programados (estilo
  Dependabot) con un tope de PRs abiertos para que las actualizaciones
  sigan siendo revisables.
- **Rol Build Cop:** designa un propietario rotatorio para mantener el
  pipeline en verde. Cuando el build se rompe, el Build Cop lo arregla o lo
  revierte — evitando que builds rotos se acumulen mientras todos asumen que
  otro lo hará.
- **Comprobaciones de PR:** revisiones obligatorias, comprobaciones de
  estado obligatorias antes de fusionar, protección de rama contra
  force-pushes, auto-merge opcional cuando está en verde.

## Optimización de CI

Cuando el pipeline supera los ~10 minutos, aplica en orden de impacto:

```
├── Cache dependencies and toolchain artifacts
├── Split gates into parallel jobs (lint ‖ typecheck ‖ test ‖ build)
├── Path filters: skip unrelated jobs (e.g. skip e2e on docs-only PRs)
├── Matrix/shard large test suites across runners
├── Move slow tests off the critical path (scheduled runs)
└── Larger or self-hosted runners for CPU-heavy builds
```

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "CI es demasiado lento" | Optimiza el pipeline; no lo saltes. |
| "Este cambio es trivial, salta CI" | Los cambios triviales rompen builds; CI es rápido para cambios triviales de todos modos. |
| "El test es inestable, reejecútalo" | Los tests inestables enmascaran bugs reales. Arregla la inestabilidad. |
| "Añadiremos CI después" | Los proyectos sin CI acumulan estados rotos. Configúralo el primer día. |
| "Las pruebas manuales bastan" | Las pruebas manuales no escalan y no son repetibles. |

## Señales de alerta

- Sin pipeline de CI en el proyecto
- Fallos de CI ignorados o silenciados
- Tests desactivados para que el pipeline pase
- Despliegues a producción sin verificación en staging
- Sin mecanismo de rollback
- Secretos en código o archivos de workflow en lugar del almacén de secretos
- Tiempos de CI largos sin esfuerzo de optimización
- Una edición de workflow que amplía permisos de token o añade efectos
  remotos sin señalarlo

## Verificación

Tras configurar o modificar CI:

- [ ] Todos los controles de calidad presentes (lint, tipos, tests, build,
      auditoría)
- [ ] El pipeline corre en cada PR y push a la rama por defecto
- [ ] Los fallos bloquean la fusión (protección de rama configurada)
- [ ] Los resultados de CI retroalimentan el bucle de desarrollo
- [ ] Los secretos viven en el almacén de secretos, con alcance por job
- [ ] El despliegue tiene un mecanismo de rollback documentado
- [ ] El pipeline se mantiene dentro del presupuesto de tiempo del proyecto,
      o se aplicó optimización (~10 minutos de techo orientativo)
- [ ] Sintaxis del workflow validada; fixtures relevantes ejercitados cuando
      autorizado
- [ ] Editar el workflow se reporta por separado de autorizar su ejecución
      en producción

## Ver también

- `shipping-and-launch` — ciclo de vida de flags, umbrales de despliegue
  escalonado y el GO/NO-GO de lanzamiento que este pipeline alimenta.
- `git-workflow-and-versioning` — ramificación y etiquetado que el pipeline
  protege y publica.
- `systematic-debugging` — aplicado cuando un fallo de CI necesita
  diagnóstico en lugar de una reejecución a ciegas.
