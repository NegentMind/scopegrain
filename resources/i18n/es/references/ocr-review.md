# Revisión visual y de texto extraído

Inspecciona la imagen/página real cuando esté disponible. Separa los
defectos de layout, los errores de contenido y los artefactos de
extracción/OCR. Registra qué superficies, tamaños, estados e idiomas se
ejercitaron. Una superficie visual inaccesible es un vacío de evidencia, no
un aprobado implícito. No inferzas el comportamiento del lector de pantalla
a partir de una sola captura.

## Checklist de revisión visual

- [ ] Se inspeccionó la imagen/página real renderizada — no inferida solo
      del código o del markup.
- [ ] Los defectos de layout (overflow, recorte, desalineación, contraste)
      se reportan separados de los errores de contenido y de los artefactos
      de extracción/OCR; las tres categorías no deben confundirse.
- [ ] Queda registrado qué superficies, tamaños de viewport, estados de
      interacción e idiomas se ejercitaron. Un estado no ejercitado es "no
      revisado", no "aprobado".
- [ ] Cuando la superficie visual es inaccesible para el revisor (headless,
      sin canal de captura), reporta un vacío de evidencia — nunca marques
      el criterio en verde por defecto.
- [ ] Una captura por sí sola no establece el orden de teclado ni el
      comportamiento del lector de pantalla; esos necesitan su propio
      ejercicio (ver `accessibility-checklist.md`).

---

# Revisión de código delegada (andamiaje determinista + razonamiento del agente)

Esta sección describe una puerta de revisión de código en *modo delegado*:
una herramienta aporta el andamiaje determinista (qué archivos revisar,
diffs empaquetados, grupos de reglas por ruta, posicionamiento) y el agente
revisor aporta el razonamiento con su propio modelo — sin endpoint de LLM ni
clave extra. Si el proyecto tiene una herramienta así configurada, úsala;
si no, el flujo siguiente sigue aplicando manualmente.

## Cuándo aplicar la puerta

| Puerta | Cómo se ejecuta | Veredicto |
|---|---|---|
| Cierre de cada tarea | Ejecuta la spec de revisión sobre el diff pendiente | Critical/High bloquean el commit |
| Revisión independiente por un agente distinto | Entrega la spec de revisión al revisor como entrada | El revisor verifica Critical/High antes de su veredicto |
| Paso de auditoría | Spec de revisión como entrada cognitiva | Cuenta como evidencia de revisión |

## Flujo de trabajo (5 pasos; el agente ejecuta 3–5)

```bash
# 1+2. Produce a review spec — one JSON { preview, rules } for the diff
<review-tool> --format json [--output result.json] [--background "<task contract>"]

# 3. Get the per-file diff according to the preview's mode/ref:
git diff HEAD -- <path>                 # working tree (tracked)
git diff <merge_base>..<to> -- <path>   # range (see the preview's mode/ref fields)
git show <commit> -- <path>             # a single commit
cat <path>                              # new untracked file

# 4. Review each file against its Rule Group + the task contract as context.
# 5. Report by severity:
#    Critical/High → block; fix now
#    Medium        → log as a backlog finding
#    Low           → discard silently unless clear value
```

Variantes útiles del wrapper: `--commit <hash>` (un commit),
`--from <base> --to <branch>` (rango), `--background "<contract>"`
(contexto de negocio de la tarea), `--output result.json` (persistir la
spec para el revisor).

## Qué suele cubrir un motor de reglas incorporado

Reglas por ruta que mapean a las reglas duras de un proyecto: constructos
estilo panic/unwrap en rutas de producción, bloques unsafe sin invariante
SAFETY documentado, clones gratuitos, guards de lock mantenidos a través de
`.await`, entradas FFI sin validar, O(n²) evitable. Un motor de reglas
complementa a los linters en lugar de duplicarlos — el linter dice *qué*,
la revisión razona *por qué importa*.

## Ruta de upgrade y CI

- Si alguna vez se configura un endpoint/modelo dedicado, el wrapper de
  delegación puede sustituirse por el comando de revisión nativo de la
  herramienta; la delegación sigue siendo el default de coste y secretos
  cero.
- Un job de CI puede publicar la spec de revisión como artefacto
  informativo en cada PR — solo informativo, nunca bloqueante del merge.

<!-- Cross-references: → see definition-of-done.md, security-checklist.md, accessibility-checklist.md, testing-patterns.md -->
