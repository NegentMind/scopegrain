# Esqueleto de runbook de entrega

Descubre el proceso de release real y su objetivo. Valida las
comprobaciones acordadas, la revisión, la compatibilidad, el manejo de
secretos y la viabilidad de recuperación. Evalúa GO/NO-GO por separado de
los pasos ejecutables de publicación. Obtén autoridad específica de la
acción antes de efectos laterales externos. Ante un fallo inspecciona el
estado realmente cambiado; un revert de la fuente puede dejar datos,
registros o despliegues sin cambiar. Registra cada paso completado/pendiente.

Esta es la forma de procedimiento canónica para una decisión de ship
GO/NO-GO en fan-out más su rollback. Los comandos y personas referenciados
abajo son las operaciones ship/rollback del harness — adapta los nombres al
proyecto.

## Pre-vuelo (obligatorio)

Ejecuta la puerta de auditoría mecánica del proyecto antes de la decisión
de ship. Un fallo de auditoría implica **NO-GO** por defecto. Nunca inicies
la publicación para hacer pasar una puerta que falla.

## Fase A — Fan-out en paralelo

Lanza las revisiones de especialistas en paralelo — todos los spawns en un
solo turno. Tres lentes cubren la mayoría de los releases:

1. **Seguridad y memory safety** — bloques unsafe, fronteras FFI,
   advisories de dependencias, supply chain. Sin revisión funcional (eso
   vive en la Fase B).
2. **Cobertura y resiliencia** — vacíos de fuzzing/chaos, casos límite,
   carreras, concurrencia. Salida: análisis + pruebas recomendadas.
3. **Rendimiento y observabilidad** — métricas de latencia/error en
   endpoints nuevos, regresión de benchmark en rutas calientes (baseline
   nombrada antes/después), tamaño de binario, backpressure.

Si el spawn paralelo no está disponible, ejecútalos secuencialmente — el
merge funciona igual.

## Fase B — Merge (en el contexto principal, sin personas)

1. **Calidad de código** — hallazgos Critical/Important de cada especialista
   + tests/lint/build. Deduplica. Los ejes de revisión funcional viven aquí
   (corrección, legibilidad, arquitectura).
2. **Seguridad** — los hallazgos Critical/High son bloqueantes.
3. **Rendimiento** — del especialista de perf; web vitals si aplica.
4. **Accesibilidad** — teclado, lector de pantalla, contraste (checklist
   propia).
5. **Infraestructura** — variables de entorno, migraciones, monitorización,
   feature flags.
6. **Documentación** — README, registros de decisión, changelog.

## Fase C — Decisión + plan de rollback obligatorio

```markdown
## Ship Decision: GO | NO-GO
### Blockers (must fix) — [origin: finding severity + file:line]
### Recommended fixes — [origin: finding + file:line]
### Acknowledged risks — [risk + mitigation]
### Rollback plan — triggers, exact procedure, RTO, previous SHA
### Specialist reports (full)
```

Persiste ambos artefactos:

- Un archivo de informe fechado bajo la ruta de ship-reports del proyecto.
- Un registro legible por máquina de último estado de ship:
  `{timestamp, decision, sha_shipped, previous_sha, rollback_plan, trigger_conditions}`.

## Reglas

1. El fan-out es en paralelo, nunca secuencial. Las personas no se llaman
   entre sí.
2. Un plan de rollback es obligatorio antes de cualquier GO.
3. Un hallazgo Critical desde cualquier lente → NO-GO por defecto salvo
   aceptación explícita del owner.
4. Omite el fan-out solo si: ≤2 archivos Y diff <50 líneas Y no toca
   auth/pagos/datos/env-config. El default es siempre fan-out.

## Rollback (fallo post-ship)

Prerequisito: un informe de ship previo (fallback: historial de git).

1. **Descubrir** — localiza el último informe de ship + registro
   last-ship-state + commits de ship recientes en el historial. Identifica
   el SHA publicado, el plan de rollback, qué triggers se dispararon, qué
   flags/migraciones se aplicaron.
2. **Precondiciones** — working tree limpio (stash o abort). SHA objetivo
   del plan o elegido por el owner; verifica que el objetivo es ancestro de
   HEAD. **Comprobación de irrevertibilidad:** migraciones destructivas
   (DROP/DELETE sin WHERE) → abortar; se requiere intervención manual.
3. **Revert** — `git revert --no-commit <target>..HEAD` (ante conflicto,
   aborta el merge/revert y reporta). Revierte flags/env/configs. Retrocede
   migraciones si existe rollback. Compila + prueba; si falla, reset --hard
   y reporta.
4. **Finalizar** — commit `rollback: revert <desc>`. Health check. Escribe
   un informe de rollback fechado (causa, SHAs, lecciones, enlace al
   informe de ship). Si el plan de ship original daba pasos exactos, esos
   pasos tienen precedencia sobre este procedimiento genérico.

## Trampas de registro/publicación (aprendidas de releases fallidos)

- **Los secretos deben existir y no estar vacíos.** En la publicación en
  registries, la *presencia* de una variable de entorno de token vacía
  puede deshabilitar la publicación trusted/OIDC mientras sigue fallando la
  autenticación. Usa OIDC *o* un token con alcance de publicación — nunca
  ambos, nunca una variable vacía.
- **Un token solo está verificado si una publicación real lo acepta.** Leer
  una lista de owners o `whoami` no prueba el alcance de publicación.
- **Los canales de staging no pueden crear paquetes.** Una primera
  publicación necesita un token con capacidad directa.
- **Los pines de canal colisionan.** Si un paso de CI nombra un canal de
  toolchain distinto al archivo de pin del repo, gana el archivo — fija el
  override de entorno en el paso.
- **No resuelvas una versión recién publicada en la misma corrida.** Las
  carreras de propagación del registry (ETARGET); reintenta con backoff, no
  falles en duro.
- **Los dispatches de `workflow run` necesitan un flag de repo explícito**
  cuando no hay checkout.
- **La automatización de release a menudo exige un prefijo de nombre de
  rama** para disparar la publicación; mergear desde una rama sin prefijo
  deja el release sin publicar.
- **Higiene post-release:** haz fast-forward de la rama de desarrollo a la
  rama de release para que un merge posterior no revierta arreglos que solo
  existen en la rama de release.

**Verificación final:** ejecuta el script de verificación de release del
proyecto (assets + registries + checksums + smoke de `--version`) después
de que caiga el tag.

<!-- Cross-references: → see definition-of-done.md, observability-checklist.md, orchestration-patterns.md, dev-tools.md -->
