---
name: work-unit-commits
description: Usar al dividir implementación autorizada en commits revisables, mantener tests y docs con la unidad que verifican, o decidir qué pertenece a cada commit.
---
# Commits de unidad de trabajo

Un commit es una unidad de trabajo revisable cuando la tarea autoriza
commits. Los commits locales son parte de la evidencia de implementación;
push, PR, merge y release siguen siendo decisiones separadas del dueño.

## Cuándo usar

- Una tarea de implementación autoriza commits locales y produce porciones.
- Decidir qué pertenece a un commit, o si una porción es un commit o varios.
- Se escribieron tests o docs y deben aterrizar con la unidad que cubren.
- Un cambio excede el presupuesto revisable y debe dividirse (véase entonces
  `chained-pr`).

No para: redacción de mensajes, estrategia de ramas o bumps de versión: la
convención vive en `git-workflow-and-versioning`; esta skill es dueña del
*ciclo*.

## El ciclo de commit

Cada unidad sigue el mismo bucle: un commit se gana, no se programa:

```
Implement slice → Run narrow checks → Inspect the diff → Commit → Next slice
```

- **Implementa** la unidad completa de funcionalidad más pequeña.
- **Testea**: ejecuta las comprobaciones que la unidad afecta (o el test
  nuevo que añade).
- **Inspecciona**: `git status` + `git diff --staged`: solo los archivos de
  la unidad, sin cambios ajenos, sin secretos.
- **Commitea**: guarda el incremento con un mensaje descriptivo.
- **Continúa**: la siguiente porción se construye sobre el estado
  verificado; no reejecutes por defecto comprobaciones largas sin cambios.

Si una comprobación falla tras la porción, el último commit es el punto de
guardado: revierte a él, investiga, reintenta. Nunca pierdes más de un
incremento.

## Elegir el límite de porción

Prefiere la estrategia de corte que se ajuste al trabajo:

- **Porciones verticales (default):** una ruta completa a través del stack
  por commit (p. ej. crear → listar → editar → borrar, cada una de extremo a
  extremo).
- **Contrato primero:** cuando los lados se desarrollan en paralelo:
  commitea primero el contrato de interfaz/tipos, luego las implementaciones
  contra él, luego la integración.
- **Riesgo primero:** cuando la incertidumbre es alta: commitea primero la
  prueba más arriesgada para que el fallo se descubra antes de que existan
  las porciones dependientes.

Una unidad que lleva riesgo nombrado (security, data-integrity,
public-contract, concurrency, delivery, external-effects, verification-gap)
recibe su propio commit: nunca agrupada con trabajo ordinario.

## Reglas

- Un commit = una unidad de trabajo entregable (comportamiento, arreglo,
  migración o unidad de docs que se sostiene sola). Nunca dividas por tipo
  de archivo (`models`, luego `services`, luego `tests`) cuando ninguno
  funciona solo.
- Mantén tests y docs en el mismo commit que la unidad que verifican o explican.
- Usa mensajes Conventional Commit que expliquen el resultado, no la lista
  de archivos (convención completa en `git-workflow-and-versioning`):

  ```
  <type>[optional scope][!]: <short outcome>   # feat|fix|refactor|test|docs|chore

  <optional body: why, not what>

  BREAKING CHANGE: <what consumers must do>     # or the ! marker
  ```

  Un breaking change es su propia unidad: nunca de contrabando dentro de un
  commit ordinario.

- Tamaño: apunta a porciones que un revisor pueda abarcar (~400 líneas
  autoradas como techo orientativo; más pequeño es mejor). Cuenta adiciones
  más eliminaciones autoradas; los artefactos generados quedan en el commit
  pero no en el conteo autorado. Los pronósticos más grandes pertenecen a la
  estrategia de entrega `chained-pr`: divide en tiempo de plan, no por
  cirugía de ramas.
- El repositorio debe seguir teniendo sentido tras aplicar solo ese commit:
  compila, los tests existentes pasan, y el rollback elimina la unidad sin
  tocar trabajo no relacionado.
- Mantén las preocupaciones separadas: nada de formato mezclado con
  comportamiento, ninguna refactorización plegada en una funcionalidad,
  ninguna limpieza de "ya que estoy aquí".
- Haz las unidades amigables al rollback: cambios aditivos primero; cambios
  destructivos y de reemplazo en commits separados; migraciones con una ruta
  inversa definida.

## Higiene pre-commit

Antes de que cada unidad aterrice:

```bash
git status --short     # only this unit's files staged
git diff --staged      # review the complete intended diff
# scan staged diff for secrets
# run the narrow checks this unit affects
```

Nunca prepares cambios que no hiciste; las ediciones ajenas preexistentes se
dejan intactas y se reportan.

## Checklist por commit

Cada commit produce: el sha registrado en la evidencia de la tarea o el
worklog, y un diff que el revisor puede aceptar o revertir sin tocar nada
más.

- [ ] Propósito único y claro, revisable solo con diff + mensaje.
- [ ] Tests/docs incluidos con la unidad que verifican o explican.
- [ ] Unidades con riesgo nombrado aisladas en su propio commit.
- [ ] El repo compila y los tests existentes pasan solo con este commit.
- [ ] Identidad del commit (sha) registrada en la evidencia de la tarea o el worklog.
- [ ] Ningún cambio ajeno o preexistente del usuario preparado en el commit.
- [ ] Revertir este commit elimina la unidad sin daños colaterales.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Commitearé cuando la funcionalidad esté hecha" | Un commit gigante es imposible de revisar, depurar o revertir. |
| "Dividiré este cambio después" | La división retroactiva es cirugía de historial; el siguiente límite de porción es el lugar barato para dividir. |
| "Los tests pueden ir en un commit posterior" | Un commit sin sus tests es inverificable en aislamiento y rompe `bisect`. |
| "Todo es parte de la misma funcionalidad" | Misma funcionalidad ≠ misma unidad. Las unidades revisables aterrizan por separado. |
| "Preparar cambios ajenos es inofensivo" | Absorber el trabajo de otro en tu commit roba su historial y oculta scope creep. |

## Señales de alerta

- Horas de trabajo sin commitear acumulándose sin punto de guardado.
- Un commit que no puede compilar ni pasar comprobaciones por sí solo.
- Tests o docs llegando por detrás en un "commit de tests" separado.
- Un breaking change dentro de un `fix:`/`feat:` ordinario sin `!` ni
  marcador `BREAKING CHANGE:`.
- Diff preparado que contiene archivos que la unidad no tocó.
- Una unidad pronosticada muy por encima del presupuesto sin estrategia
  `chained-pr`.

## Límites

- La autorización de commit viene de la tarea/el dueño; el harness observa
  commits como evidencia pero nunca pushea implícitamente.
- El candidato de revisión es el commit de unidad de trabajo (o la porción
  de PR a la que pertenece), nunca la rama de funcionalidad acumulada.
- Un commit no autoriza la siguiente unidad de trabajo, la publicación ni el merge.
