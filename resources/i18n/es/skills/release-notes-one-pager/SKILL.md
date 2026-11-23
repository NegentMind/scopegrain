---
name: release-notes-one-pager
description: Usar al preparar comunicación de lanzamiento para describir cambios realmente entregados y riesgos de actualización sin inventar un release
---
# Comunicación de lanzamiento

Lee el rango real de cambios, el comportamiento visible al usuario y el
procedimiento de release. Resume compatibilidad, acciones requeridas,
limitaciones conocidas y recuperación. Separa funcionalidades entregadas de
experimentos y trabajo planeado. Enlaza evidencia inspeccionable sin exponer
logs privados ni credenciales. No edites versiones, tags ni changelogs fuera
del proceso aprobado. Redactar notas no publica un release.

El entregable es un documento de notas de release de una página (HTML o
Markdown, según el canal del proyecto). Si el proyecto provee una plantilla o
sistema de diseño, parte de él: no escribas estilos desde cero a menos que se
solicite explícitamente una estructura a medida.

## Flujo de trabajo

### Paso 0 — Reúne el rango de cambios

1. Identifica el rango exacto que se lanza: tag anterior → objetivo del
   release (lista de commits, PRs mergeados, borrador de changelog).
2. Lee el changelog existente y el procedimiento de release.
3. Si existe una plantilla del proyecto para notas de release, léela antes de
   escribir; reutiliza su estructura e inventario de clases en lugar de
   inventar una.

### Paso 1 — Construye la estructura de secciones requerida

Compón el documento en este orden:

1. **Cabecera**: versión, fecha, resumen del release en una frase.
2. **Added**: nuevas capacidades visibles al usuario.
3. **Fixed**: correcciones de bugs visibles al usuario.
4. **Breaking changes**: todo lo que requiera acción del consumidor.
5. **Known issues**: limitaciones entregadas, cada una con estado o workaround.
6. **Upgrade note**: pasos concretos, o una declaración explícita de sin acción.
7. **Puntero de cierre**: enlace al changelog completo o docs, solo si existe
   un destino real.

Da a cada sección un ancla/id estable que coincida con su nombre (`added`,
`fixed`, `breaking-changes`, `known-issues`, `upgrade-note`) para que los
destinos de navegación resuelvan.

### Paso 2 — Reglas de honestidad para detalles faltantes

Nunca inventes versiones, fechas, métricas ni afirmaciones. Cuando falten
detalles, escribe marcadores explícitos:

| Sección | Texto de detalle faltante |
|---|---|
| Summary | `No summary provided.` |
| Added | `No additions provided` |
| Fixed | `No fixes provided` |
| Breaking changes | `None` |
| Known issues | `None reported` |
| Upgrade note | `No upgrade actions required based on provided information` |

Si falta la versión o la fecha, usa `—` y etiqueta el campo en lugar de
adivinar.

### Paso 3 — Evidencia y enlaces

- Cada entrada de Added/Fixed nombra qué cambió concretamente: no
  "mejoras" genéricas.
- Las entradas pueden enlazar a evidencia inspeccionable (PR, issue, doc)
  pero nunca a logs privados, tokens o credenciales.
- Cada llamada a la acción usa un destino real y seguro. Si no existe ninguno,
  omítela: nunca `href="#"`, tokens de marcador como `REPLACE_WITH_REAL_URL`
  ni anclas engañosas. El texto del CTA debe describir con precisión el destino.

### Paso 4 — Puerta de autocomprobación

Ejecuta la puerta P0 siguiente antes de emitir. Cada P0 debe pasar.

### Paso 5 — Emite el artefacto

Emite una página. Una frase antes del artefacto; nada después.

## Puerta P0 (debe pasar)

- [ ] Las secciones requeridas existen y son visibles: Added, Fixed, Breaking
      changes, Known issues, Upgrade note.
- [ ] Cada sección usa su texto explícito de detalle faltante cuando el
      usuario no suministró nada para ella.
- [ ] Sin fechas, versiones, métricas ni afirmaciones inventadas; los campos
      faltantes son marcadores etiquetados (`Version: —`), no suposiciones.
- [ ] Sin texto de relleno ni lorem ipsum.
- [ ] El trabajo entregado está separado de experimentos, flags y trabajo planeado.
- [ ] Cada CTA/enlace tiene un destino real; sin `href="#"`, tokens de
      marcador ni dominios de ejemplo.
- [ ] Los breaking changes llevan una nota de migración cuando los
      consumidores deben actuar.
- [ ] La página refluye sin scroll horizontal en anchos estrechos (HTML).

## P1 (debería pasar)

- [ ] Las entradas de Added/Fixed son concretas (qué cambió, no "mejoras").
- [ ] Los known issues incluyen estado o workaround cuando se proporciona.
- [ ] Los pasos de actualización usan verbos claros (`Run`, `Update`, `Restart`, `Rebuild`).
- [ ] Los titulares se mantienen concisos (menos de ~14 palabras).
- [ ] Las etiquetas de CTA son específicas (`Read full changelog`), no `Learn more`.

## Señales de alerta

- Versiones, fechas o métricas inventadas para rellenar una sección: el texto
  de detalle faltante existe precisamente para ese caso.
- Un CTA o enlace con un marcador, `href="#"` o un destino que el texto no describe.
- Experimentos, trabajo tras flags o ítems planeados presentados como entregados.
- Las notas tratadas como aprobación para taggear, publicar o anunciar.
- Secciones presentes pero vacías: una sección vacía no comunica nada; el
  texto explícito estilo `None` sí.

## Límites

- Redactar notas no es aprobación para taggear, publicar o anunciar un
  release: cada una es una acción autorizada por separado.
- No edites versiones, tags, manifiestos ni el changelog canónico fuera del
  proceso de release aprobado del proyecto; propón la entrada en su lugar.

## Véase también

- `git-workflow-and-versioning`: el contrato SemVer/tag/changelog que
  suministra el rango de cambios.
- `shipping-and-launch`: la decisión de lanzamiento y el rollout que estas
  notas comunican.
- `resources/references/ship-runbook.md`: el procedimiento de release del
  proyecto cuando existe.
