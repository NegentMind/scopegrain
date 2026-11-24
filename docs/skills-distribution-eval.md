# Evaluación: distribución del catálogo de skills vía skills.sh / `npx skills add`

> Evaluación de la auditoría 2026-11-24. Objetivo: decidir si merece la
> pena publicar `resources/skills/` como paquete consumible por el
> ecosistema Agent Skills (skills.sh, CLI `vercel-labs/skills`).

## 1. Estado real verificado

| Hecho | Valor | Referencia |
|---|---|---|
| Skills | **44 directorios** `resources/skills/<id>/SKILL.md` | `resources/skills/` |
| Frontmatter | Sólo `name` + `description` en los 44 (verificado; ningún campo extra). `name` coincide con el directorio en los 44; `description` máx. ~173 chars — dentro de spec | `resources/skills/*/SKILL.md` |
| Espejo i18n | **44 mirrors ES** en `resources/i18n/es/skills/<id>/SKILL.md` con los **mismos nombres** | `resources/i18n/es/skills/` |
| Catálogo harness | `resources/manifest.json` indexa skills como `{kind:"skill", id, path, description}` + aliases `kind:"skill"` (p. ej. `using-agent-skills`→`select-capabilities`) | `resources/manifest.json` |
| Acoplamiento | **14/44 skills referencian** `resources/references\|rules\|commands` o la CLI `scopegrain`; 2-3 citan `task gate`/`scopegrain_*`. El resto es metodología genérica | grep sobre `resources/skills/` |

## 2. Qué exige el estándar Agent Skills (agentskills.io/specification)

- Directorio `<skill-name>/` con `SKILL.md` obligatorio; opcionales
  `scripts/`, `references/`, `assets/`.
- Frontmatter YAML: `name` (1-64, minúsculas+guiones, **debe coincidir
  con el directorio**) y `description` (≤1024) obligatorios;
  `license`/`compatibility`/`metadata`/`allowed-tools` opcionales.
- `npx skills add` (vercel-labs/skills, lanzado 2026-01-20) instala
  desde shorthand GitHub `owner/repo`, URLs GitHub/GitLab/Azure/git y
  rutas locales; `--skill <id>` selecciona una; se admiten rutas
  directas a un skill dentro del repo
  (`.../tree/main/<ruta>/<id>`). Instala a los directorios de skills de
  ~75 agentes. Telemetría anónima por defecto
  (`DISABLE_TELEMETRY=1` para salirse).

## 3. Compatibilidad

| Criterio | Estado | Evaluación |
|---|---|---|
| Layout `dir/SKILL.md` | ✅ Cumple al 100% | El árbol ya ES el formato estándar |
| Frontmatter mínimo | ✅ Cumple (name==dir, description ≤1024) | Verificado en los 44 |
| Raíz estándar `skills/` | ⚠️ Parcial | Las skills viven en `resources/skills/`, no `skills/`. El CLI acepta rutas directas `tree/main/resources/skills/<id>`, pero el auto-descubrimiento de `npx skills add owner/repo` en raíces no convencionales **no está verificado empíricamente** — hay que probarlo antes de prometerlo |
| Nombres duplicados (i18n) | ⚠️ Riesgo | `resources/i18n/es/skills/` duplica los 44 `name`. Si el discovery escanea recursivo, encontrará 88 SKILL.md con 44 nombres duplicados → ambigüedad previsible o picks arbitrarios. Confirmación pendiente |
| Aliases del manifest | n/a | Los alias `kind:"skill"` son concepto del harness; el ecosistema no los entiende (irrelevante, no bloqueo) |
| Independencia funcional | ⚠️ Parcial | 14/44 citan recursos del harness que no viajarían (references/rules) — el skill funcionaría pero con referencias colgadas. El resto es portable |

## 4. Opciones

| Opción | Esfuerzo | Pros | Contras |
|---|---|---|---|
| **A. Publicar el repo tal cual** (`npx skills add NegentMind/scopegrain --skill <id>` o rutas `tree/`) | ~0 (documentar) | Zero trabajo; funciona ya vía ruta directa | Discovery ambiguo (raíz no estándar + duplicados i18n); acoplamiento 14/44; `skills.sh` listing poco limpio |
| **B. Repo espejo dedicado** `NegentMind/scopegrain-skills` con `skills/` poblado desde `resources/skills/` en release | S-M (script de sync + CI) | Discovery limpio, raíz convencional, sin duplicados; se puede curar el subset portable | Segundo repo que mantener; riesgo de drift entre `resources/skills` y el espejo (mitigable con el mismo patrón `check-manifest-version`) |
| **C. No publicar; el binario ya las instala** | 0 | `scopegrain init`/`host activate` ya proyecta skills a cada host vía el catálogo + manifiesto — el canal nativo existe | Cero visibilidad en skills.sh; no aprovecha el ecosistema |

## 5. Recomendación

**C a corto plazo; B si se quiere presencia en el ecosistema.** A es
gratis pero mediocre (discovery ambiguo + referencias colgadas en 1/3
del catálogo).

Argumentos honestos:

- El canal de distribución real de estas skills **ya existe y es
  superior para su propósito**: `resources/manifest.json` + proyección
  por host (`native.mjs`) las instala donde cada agente las lee,
  preservando la coherencia comando↔skill↔rule↔reference que define al
  harness. `npx skills add` rompería esa coherencia: instalaría skills
  sueltas sin las references/rules que 14 de ellas citan.
- El valor standalone del catálogo es **parcial**: ~2/3 son metodología
  genérica exportable (TDD, debugging, reviews), pero ese nicho está
  saturado en skills.sh; el diferencial de Scopegrain es el *sistema*,
  no skills sueltas.
- Si se opta por B: curar un subset portable (sin referencias a
  `resources/*`), añadir `license: Apache-2.0` al frontmatter, y
  verificar empíricamente el discovery del CLI antes de publicitar el
  comando de instalación.

Pendiente de verificación empírica (no comprobable sin ejecutar el CLI
externo): si `npx skills add owner/repo` auto-descubre `resources/skills/`
y cómo trata los 44 nombres duplicados del mirror i18n.
