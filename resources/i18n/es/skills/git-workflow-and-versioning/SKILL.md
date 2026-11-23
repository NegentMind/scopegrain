---
name: git-workflow-and-versioning
description: Úsala al preparar un commit local, aplicar política de versionado o ignore, o decidir qué artefactos generados pueden compartirse
---
# Autoridad de Git

Inspecciona el estado y preserva los cambios que no hiciste.
Revisa el diff previsto completo y la verificación relevante antes del
commit.
Sigue la política de versionado por proyecto seleccionada; las reglas de
ignore no eliminan archivos ya rastreados ni anulan el ignore de un
directorio padre.
No hagas auto-untrack, reset, amend, force-push, merge ni publicación.
Los commits locales, el push remoto y la entrega son permisos separados.
Nunca incluyas secretos ni sesiones históricas privadas en artefactos
compartidos.

Git es la red de seguridad. Trata los commits como puntos de guardado, las
ramas como sandboxes y el historial como documentación. El control de
versiones disciplinado es lo que mantiene los cambios rápidos manejables,
revisables y reversibles.

## Principios centrales

### Ramas de vida corta sobre divergencia de vida larga

Mantén la rama por defecto (trunk) siempre desplegable. Trabaja en ramas de
vida corta que se fusionan rápido — la línea de investigación
DORA/Accelerate asocia fusionar a trunk al menos a diario (una rama medida
en horas, como mucho un par de días) con mayor rendimiento de entrega. Las
ramas de vida larga son costes ocultos — divergen, crean conflictos de
fusión y retrasan la integración.

- **Las ramas de desarrollo son costes.** Cada día que una rama vive,
  acumula riesgo de fusión.
- **Una rama de PR puede seguir siendo trunk-based** — lo que importa es la
  edad de la rama, no si existe una rama.
- **Las ramas de entrega son aceptables** cuando una entrega debe
  estabilizarse mientras la rama por defecto avanza.
- **Feature flags > ramas largas.** Despliega trabajo incompleto tras flags
  en lugar de mantenerlo en una rama durante semanas.

Si el proyecto usa un modelo de ramificación distinto, adapta — la
disciplina de commit importa más que la estrategia concreta.

## Convención de commits

El ciclo de commit acotado — porción, comprobaciones estrechas, inspección
del diff, commit, punto de guardado, presupuesto por commit — lo posee
`work-unit-commits`; la división de entrega de pronósticos mayores
pertenece a `chained-pr`. Lo que esta skill fija es la *convención* que
siguen el mensaje y el historial.

### Los mensajes explican el por qué, en forma Conventional Commits

```
<type>[optional scope][!]: <short description>

[optional body explaining why, not what]

[optional footer(s)]
```

| Tipo | Uso |
|---|---|
| `feat` | Funcionalidad nueva (correlaciona con SemVer MINOR) |
| `fix` | Corrección de bug (correlaciona con SemVer PATCH) |
| `refactor` | Cambio que ni corrige un bug ni añade funcionalidad |
| `test` | Añadir o actualizar tests |
| `docs` | Solo documentación |
| `chore` | Herramientas, dependencias, config |

Otros tipos (`build`, `ci`, `perf`, `style`) son convencionales pero no
llevan efecto SemVer implícito. Un cambio incompatible se marca en
*cualquier* tipo con `!` tras el tipo/scope o un pie `BREAKING CHANGE:`
(correlaciona con MAJOR).

```
# Good: explains intent
feat: add email validation to registration endpoint

Prevents invalid email formats from reaching the database.
Uses schema validation at the route handler level, consistent
with existing validation patterns.

# Bad: describes what's obvious from the diff
update auth.ts
```

### Un asunto por commit

Cada commit hace una cosa lógica, y cada tipo de cambio es un commit
separado — nunca formato mezclado con comportamiento, ni un refactor
plegado en una funcionalidad. Las limpiezas triviales pueden viajar solo a
discreción del revisor. Los asuntos separados hacen cada cambio más fácil
de revisar, revertir y entender en el historial.

Automatiza las comprobaciones de archivos en stage con hooks (formatters
estilo lint-staged) donde el proyecto los tenga; los pasos de inspección en
sí viven en `work-unit-commits`.

## Ramificación

```
main (always deployable)
  ├── feature/task-creation    ← one feature per branch
  ├── feature/user-settings    ← parallel work
  └── fix/duplicate-tasks      ← bug fixes
```

- Ramifica desde la rama por defecto del proyecto.
- Mantén las ramas de vida corta — horas cuando sea posible, fusión en 1-3
  días como máximo; apunta a integrar en trunk al menos a diario.
- Mantén pocas ramas activas en vuelo a la vez.
- Elimina las ramas tras la fusión.
- Nomenclatura: `feature/<short>`, `fix/<short>`, `chore/<short>`,
  `refactor/<short>` — o la convención establecida del proyecto.

### Worktrees para trabajo en paralelo

Usa worktrees para correr varias ramas simultáneamente sin cambiar:

```bash
git worktree add ../project-feature-a feature/task-creation
git worktree add ../project-feature-b feature/user-settings
# each directory has its own branch; work proceeds in isolation
git worktree remove ../project-feature-a   # when merged or abandoned
```

El aislamiento significa que un experimento fallido no cuesta nada, y el
trabajo en paralelo nunca colisiona hasta fusionarse explícitamente.

## Resúmenes de cambio

Tras cualquier modificación, entrega un resumen estructurado — documenta la
disciplina de alcance y saca a la superficie cambios no intencionados:

```
CHANGES MADE:
- src/routes/tasks.ts: Added validation middleware to POST endpoint
- src/lib/validation.ts: Added TaskCreateSchema

THINGS I DIDN'T TOUCH (intentionally):
- src/routes/auth.ts: similar validation gap, out of scope

POTENTIAL CONCERNS:
- The schema rejects extra fields — confirm this is desired.
```

La sección "didn't touch" demuestra disciplina de alcance en lugar de una
renovación no solicitada.

## Archivos generados y política de ignore

- Haz commit de archivos generados solo cuando el proyecto los espera
  (lockfiles, migraciones versionadas).
- Nunca hagas commit de salida de build, `.env`, ni estado de
  sesión/herramientas privado.
- Mantén un archivo de ignore que cubra las exclusiones estándar.
- Las reglas de ignore no eliminan archivos ya rastreados (dejar de
  rastrear es una acción autorizada separada) y no anulan el ignore de un
  directorio padre.

## Git para depuración

```bash
git bisect start && git bisect bad HEAD && git bisect good <known-good>
git log --oneline -20
git diff HEAD~5..HEAD -- src/
git blame <file>
git log --grep="keyword" --oneline
```

## Entrega y versionado

Los commits son cómo *tú* rastreas el cambio; una **versión** es cómo lo
rastrean los *consumidores*. En cuanto algo depende del código — un equipo,
un paquete publicado, un cliente desplegado — "lo último en main" deja de
responder "¿qué estoy ejecutando, y es seguro actualizar?"

### Versionado semántico

```
MAJOR  breaking change — consumers must change their code
MINOR  new functionality, backward-compatible
PATCH  bug fix, backward-compatible
```

El número es una promesa. Un "patch" que cambia comportamiento del que los
consumidores dependían es un cambio incompatible disfrazado (ley de Hyrum —
ver `api-and-interface-design`). SemVer también permite que un aviso de
desaprobación viaje en un bump MINOR; la ruta de retirada real es trabajo
de `deprecation-and-migration`. Ante la duda de si un cambio es
incompatible, asume que lo es.

### Etiqueta la entrega; el tag es la fuente de verdad

```bash
git tag -a v1.4.0 -m "Release 1.4.0"
git push origin v1.4.0        # only with explicit push authorization
```

Deriva la versión del tag en lugar de editar a mano archivos dispersos,
para que artefacto, tag y changelog nunca puedan discrepar. Etiquetar y
hacer push de tags son acciones de entrega — separadas de los commits
locales.

### Changelog curado

Un changelog no es `git log`. Es la respuesta orientada al consumidor a
"¿qué cambió y me importa?" — agrupado por `Added / Changed / Fixed /
Deprecated / Removed / Security`, lo más nuevo arriba, cada entrada
redactada en torno al impacto de usuario:

```markdown
## [1.4.0] - 2025-06-12
### Added
- Bulk task import via CSV
### Fixed
- Timezone drift in recurring task due dates
### Deprecated
- `GET /v1/tasks/all` — use paginated `GET /v1/tasks` (removal in 2.0)
```

Escribe la entrada en el mismo cambio que hace el cambio — no reconstruida
desde arqueología de commits en el momento de la entrega. La página de
entrega orientada al consumidor derivada de este changelog es trabajo de
`release-notes-one-pager`; enviar la entrega en sí es trabajo de
`shipping-and-launch` — esta sección es el contrato de versionado que
alimenta a ambos.

## Límites de autoridad

- Commit local, push remoto, merge, tag y publicación son **permisos
  separados**. Una autorización de commit no implica nada sobre push o
  entrega.
- Nunca hagas amend, force-push, reset --hard, auto-untrack ni publicación
  sin instrucción explícita.
- Preserva cambios preexistentes sin commit que no son tuyos — trabaja
  alrededor de ellos, nunca los arrastres a tu commit ni los descartes.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "El mensaje no importa" | Los mensajes son documentación para lectores y agentes futuros. |
| "Lo aplastaré todo después" | El squash destruye la narrativa de desarrollo. Haz commits limpios desde el principio. |
| "Las ramas añaden sobrecarga" | Las ramas de vida corta son baratas; las de vida larga son el coste real. |
| "No necesito un archivo de ignore" | Hasta que un `.env` con secretos de producción acaba en un commit. |
| "Es solo un arreglo pequeño, sube el patch" | Comprueba qué observan los consumidores; un cambio de comportamiento del que se depende es incompatible sea cual sea el tamaño del diff. |
| "El changelog es el log de commits" | Los commits son para ti; el changelog está curado para consumidores. |
| "Escribiremos el changelog en la entrega" | Para entonces el impacto se reconstruye de memoria. Escríbelo con el cambio. |

## Señales de alerta

- Cambios grandes sin commit acumulándose
- Mensajes como "fix", "update", "misc"
- Formato mezclado con cambios de comportamiento
- Sin archivo de ignore; `node_modules/`, `.env`, artefactos de build en
  commits
- Ramas de vida larga divergiendo lejos de la rama por defecto
- Force-push a ramas compartidas
- Un cambio incompatible entregado bajo un bump minor/patch
- Una entrega sin tag, o una versión editada a mano desincronizada del tag
- Un changelog que es solo mensajes de commit volcados
- Secretos o historial de sesión privado en cualquier artefacto compartido

## Verificación

Para cada commit, ejecuta la lista de verificación por commit de
`work-unit-commits` (propósito único, tests/docs con la unidad,
comprobaciones acotadas en verde, sha registrado, sin cambios ajenos,
reversible de forma aislada).

Para cada entrega (cualquier cosa con consumidores):

- [ ] El bump de versión coincide con el cambio: incompatible → major,
      aditivo → minor, corrección → patch
- [ ] La entrega está etiquetada; la versión deriva del tag
- [ ] El changelog tiene una entrada curada y legible agrupada por impacto
- [ ] Push/tag/publicación realizados solo con autorización explícita

## Ver también

- `work-unit-commits` — el ciclo de commit acotado, el presupuesto por
  commit y la inspección pre-commit que esta convención asume.
- `chained-pr` — división de entrega cuando un pronóstico excede el
  presupuesto.
- `api-and-interface-design` — la ley de Hyrum y qué cuenta como
  incompatible.
- `deprecation-and-migration` — retirar superficie con una ventana de
  desaprobación.
- `shipping-and-launch` / `release-notes-one-pager` — a qué alimenta el
  contrato de versionado en el momento de la entrega.
- `resources/references/definition-of-done.md` — la puerta permanente que
  todo cambio supera antes del commit.
