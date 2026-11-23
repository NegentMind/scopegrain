---
name: shipping-and-launch
description: Usar para evaluar la preparación de entrega o planificar la recuperación de un release fallido
---
# Entrega y recuperación

Entrega con confianza: todo lanzamiento debe ser reversible, observable e
incremental. Lee el proceso de release real, el entorno destino y la
evidencia de aceptación. Identifica bloqueos, compatibilidad, observabilidad
y viabilidad de recuperación. Produce una evaluación GO/NO-GO separada de
los pasos ejecutables propuestos. Requiere aprobación específica por acción
para publicación, push, despliegue o migración de datos; las credenciales
nunca deben entrar en los informes. Para recuperación inspecciona el estado
realmente cambiado; un revert de Git puede no deshacer efectos secundarios
externos. Para cuando un paso falla y registra lo que queda.

## Contrato de salida

- Una **evaluación GO/NO-GO** contra la checklist de pre-lanzamiento: cada
  ítem rojo o amarillo nombrado, ninguno omitido en silencio.
- Un **plan de rollback** (condiciones de disparo, pasos, consideraciones de
  datos, tiempo de rollback) escrito antes de cualquier paso de despliegue.
- **Pasos ejecutables propuestos**, listados por separado de la evaluación:
  cada acción de publish, push, deploy o migrate lleva su propio estado de
  aprobación.
- **Evidencia post-lanzamiento**: salud, tasa de error, latencia, flujo
  crítico: reportada desde salida observada, nunca afirmada.

## Cuándo usar

- Desplegar una funcionalidad a producción por primera vez
- Lanzar un cambio significativo a usuarios
- Migrar datos o infraestructura
- Abrir un programa beta o de acceso anticipado
- Recuperarse de un release fallido o parcial
- Cualquier despliegue que conlleve riesgo (todos)

## La checklist de pre-lanzamiento

Ejecuta cada sección; un lanzamiento solo es tan seguro como su puerta más débil.

### Calidad de código

- [ ] Todos los tests pasan (unitarios, integración, extremo a extremo)
- [ ] El build tiene éxito sin warnings
- [ ] Lint y comprobación de tipos pasan
- [ ] Código revisado y aprobado
- [ ] Sin comentarios TODO que deban resolverse antes del lanzamiento
- [ ] Sin logging de depuración en rutas de código de producción
- [ ] El manejo de errores cubre los modos de fallo esperados

### Seguridad

- [ ] Sin secretos en el código ni en el control de versiones
- [ ] La auditoría de dependencias del ecosistema no muestra vulnerabilidades
      críticas ni altas
- [ ] Validación de entrada en todos los endpoints visibles al usuario
- [ ] Comprobaciones de autenticación y autorización en su lugar
- [ ] Cabeceras de seguridad configuradas (CSP, HSTS, etc.)
- [ ] Rate limiting en endpoints de autenticación
- [ ] CORS restringido a orígenes específicos (sin comodín)

### Rendimiento

- [ ] Presupuestos de latencia y tamaño cumplidos en rutas críticas
- [ ] Sin consultas N+1 en rutas críticas
- [ ] Assets estáticos optimizados y cacheados
- [ ] Consultas de base de datos respaldadas por índices apropiados

### Accesibilidad (cuando el cambio es visible al usuario)

- [ ] La navegación por teclado funciona para todos los elementos interactivos
- [ ] El lector de pantalla puede transmitir contenido y estructura de página
- [ ] El contraste cumple el estándar adoptado por el proyecto
- [ ] Gestión de foco correcta para modales y contenido dinámico
- [ ] Mensajes de error descriptivos y asociados a los campos del formulario
- [ ] Sin warnings pendientes de escaneo automatizado

### Infraestructura

- [ ] Variables de entorno establecidas en producción
- [ ] Migraciones de base de datos aplicadas (o listas, con rollback definido)
- [ ] DNS y TLS configurados
- [ ] CDN o capa de caché configurada para assets estáticos (si aplica)
- [ ] Logging y reporte de errores configurados
- [ ] Existe un endpoint de health check y responde

### Documentación

- [ ] README y requisitos de setup al día
- [ ] Documentación de API al día
- [ ] ADRs escritos para cualquier decisión arquitectónica
- [ ] Entrada de changelog escrita para los consumidores
- [ ] Documentación visible al usuario actualizada donde aplique

## Estrategia de feature flags

Entrega tras feature flags para desacoplar despliegue de lanzamiento:

```
1. DEPLOY with flag OFF     → Code is in production but inactive
2. ENABLE for team/beta     → Internal testing in production environment
3. GRADUAL ROLLOUT          → 5% → 25% → 50% → 100% of users
4. MONITOR at each stage    → Watch error rates, performance, user feedback
5. CLEAN UP                 → Remove flag and dead code path after full rollout
```

**Reglas:**

- Cada feature flag tiene un dueño y una fecha de expiración.
- Limpia los flags dentro de una ventana acordada tras el rollout completo.
- No anides feature flags (combinaciones exponenciales).
- Prueba ambos estados del flag (on y off) en CI.

## Rollout por etapas

```
1. DEPLOY to staging
   └── Full test suite + manual smoke test of critical flows

2. DEPLOY to production (feature flag OFF)
   └── Verify deployment succeeded (health check)
   └── Check error monitoring (no new errors)

3. ENABLE for team (flag ON for internal users)
   └── Team uses the feature in production
   └── Monitoring window before wider exposure

4. CANARY rollout (flag ON for a small % of users)
   └── Compare metrics: canary vs. baseline
   └── Advance only if all thresholds pass (table below)

5. GRADUAL increase (25% → 50% → 100%)
   └── Same monitoring at each step
   └── Ability to return to the previous percentage at any point

6. FULL rollout (flag ON for all users)
   └── Monitor for a full observation period
   └── Clean up the feature flag
```

### Umbrales de decisión del rollout

Decide en cada etapa si avanzar, mantener o revertir:

| Métrica | Avanzar (verde) | Mantener e investigar (amarillo) | Revertir (rojo) |
|--------|-----------------|------------------------------|-----------------|
| Tasa de error | Dentro de ~10% de la línea base | 10-100% sobre la línea base | >2x línea base |
| Latencia P95 | Dentro de ~20% de la línea base | 20-50% sobre la línea base | >50% sobre la línea base |
| Errores nuevos de cliente | Sin tipos de error nuevos | Errores nuevos <0.1% de sesiones | Errores nuevos >0.1% de sesiones |
| Métricas de negocio | Neutras o positivas | Declive <5% (puede ser ruido) | Declive >5% |

**Revierte inmediatamente si:** la tasa de error supera 2x la línea base, la
latencia p95 crece >50%, los problemas reportados por usuarios se disparan,
se detectan problemas de integridad de datos, o se descubre una
vulnerabilidad de seguridad.

## Monitoreo y observabilidad

Monitorea tres capas:

```
Application:  error rate (total and per endpoint), p50/p95/p99 latency,
              request volume, key business metrics
Infrastructure: CPU/memory, connection pools, disk, network, queue depth
Client:       real-user performance metrics, client-side errors,
              API failure rates from the client perspective
```

Reporta errores con contexto (ruta, sujeto, stack) pero nunca expongas
internos, secretos o credenciales en respuestas visibles al usuario,
dashboards o informes.

### Verificación post-lanzamiento (primera hora)

```
1. Health endpoint returns success
2. Error monitoring shows no new error types
3. Latency shows no regression
4. Critical user flow tested manually
5. Logs flowing and readable
6. Rollback mechanism confirmed ready (dry run if possible)
```

## Plan de rollback (escríbelo antes de desplegar)

```markdown
### Trigger Conditions
- Error rate > 2x baseline | P95 latency > [X] | reports of [specific issue]

### Rollback Steps
1. Disable feature flag, OR redeploy the previous known-good version
2. Verify rollback: health check, error monitoring
3. Communicate: notify the team

### Data Considerations
- Migration rollback path: [command, or irreversible + mitigation]
- Data written by the new feature: [preserved / cleaned up]

### Time to Rollback
- Flag: < 1 minute | Redeploy: < 5 minutes | Data rollback: < 15 minutes
```

## Recuperación de un release fallido

- **Para en el primer paso fallido.** Registra las acciones completadas y lo
  que queda antes de intentar cualquier otra cosa.
- **Inspecciona el estado realmente cambiado**: despliegues, flags, datos
  migrados, artefactos publicados, cachés: no solo el grafo de commits. Un
  revert no deshace efectos secundarios externos como paquetes publicados,
  migraciones aplicadas o cachés invalidadas.
- **Distingue rollback de roll-forward.** Restaurar el estado de ejecución
  anterior (flag off, versión previa) es distinto de entregar un arreglo.
  Prefiere flag-disable o redespliegue sobre cirugía de historial en ramas
  compartidas.
- Reejecuta la verificación post-lanzamiento tras recuperar.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Funciona en staging, funcionará en producción" | Producción tiene datos, patrones de tráfico y casos límite diferentes. Monitorea tras el deploy. |
| "No necesitamos feature flags para esto" | Toda funcionalidad se beneficia de un kill switch. Incluso los cambios simples rompen cosas. |
| "El monitoreo es sobrecarga" | Sin él descubres los problemas por quejas de usuarios en lugar de dashboards. |
| "Añadiremos monitoreo después" | No puedes depurar lo que no puedes ver. Añádelo antes del lanzamiento. |
| "Revertir es admitir un fallo" | Revertir es ingeniería responsable. Entregar una funcionalidad rota es el fallo. |

## Señales de alerta

- Desplegar sin un plan de rollback
- Sin monitoreo ni reporte de errores en producción
- Releases big-bang (todo a la vez, sin staging)
- Feature flags sin expiración ni dueño
- Nadie monitoreando el deploy durante la primera hora
- Configuración de producción hecha de memoria, no en código
- "Es viernes por la tarde, lancémoslo"

## Verificación

Antes de desplegar:

- [ ] Checklist de pre-lanzamiento completada (todas las secciones en verde)
- [ ] Feature flag configurado (si aplica)
- [ ] Plan de rollback documentado
- [ ] Dashboards de monitoreo configurados, equipo notificado
- [ ] Aprobación específica por acción registrada para publish, push, deploy o migrate

Después de desplegar:

- [ ] El health check devuelve éxito
- [ ] Tasa de error y latencia normales
- [ ] Flujo de usuario crítico verificado
- [ ] Logs fluyendo
- [ ] Rollback probado o verificado como listo

## Véase también

- `ci-cd-and-automation`: mecánica de entrega del lado del pipeline
  (despliegues de preview, flujo de promoción, workflows de rollback); esta
  skill es dueña de la decisión de lanzamiento y las puertas del rollout.
- `git-workflow-and-versioning`: tags, SemVer y el contrato de changelog que
  un release consume.
- `release-notes-one-pager`: la comunicación de release orientada al consumidor.
- `resources/references/ship-runbook.md`: runbook de publicación por
  registro cuando el proyecto tiene uno.
- `resources/references/definition-of-done.md`,
  `resources/references/security-checklist.md`,
  `resources/references/performance-checklist.md`,
  `resources/references/accessibility-checklist.md`,
  `resources/references/observability-checklist.md`: las puertas permanentes
  tras las secciones de la checklist de pre-lanzamiento.
