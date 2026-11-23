---
name: chained-pr
description: Úsala cuando un cambio pronostica más de ~400 líneas escritas o el propietario pide PRs apilados/encadenados; selecciona una estrategia acotada de porciones de entrega.
---
# PR encadenado / Porciones de entrega

Estrategia de entrega para trabajo orgánico o formal cuyo recuento de líneas
escritas pronostica más allá del presupuesto de porción revisable (~400
adiciones + eliminaciones). La división ocurre una vez, en el momento del
plan — no mediante cirugía retroactiva de ramas.

Los cambios pequeños y enfocados son más fáciles de revisar, más rápidos de
fusionar y más seguros de revertir. El presupuesto existe porque la calidad
de revisión colapsa con el tamaño del diff: un revisor maneja ~100 líneas
cómodamente, ~300 aceptablemente para un cambio lógico, y cualquier cosa
hacia ~1000+ es donde se esconden los defectos. El techo de ~400 líneas
escritas (adiciones + eliminaciones; los artefactos generados se excluyen del
recuento) es el presupuesto de porción revisable del harness — ver
`work-unit-commits`.

**Límite de alcance.** Esta skill posee la mecánica de *entrega*:
pronóstico, selección de estrategia, contratos de porción y la cadena de
apilado/rebase. El ciclo implementar→verificar→commit *dentro* de cada
porción es `incremental-implementation` — sus patrones de división
vertical/contract-first/risk-first son el vocabulario de ordenación de
abajo, aplicado a granularidad de PR.

## Selección de estrategia (una pregunta, una vez)

| Condición | Estrategia |
|---|---|
| Pronóstico ≤ ~400 líneas escritas, enfocado | `single-pr` — un PR, sin cadena. |
| Pronóstico excede el presupuesto, hay unidades con riesgo nombrado | `ask-on-risk` — cadena propuesta; el propietario confirma los límites de porción. |
| Pronóstico excede el presupuesto, todas las unidades ordinarias | `auto-chain` — la cadena procede bajo la estrategia registrada. |
| El diff no puede dividirse limpiamente (generado/vendor/migración) | `exception-ok` — excepción documentada del propietario; un solo PR con justificación explícita. |

Pregunta al propietario exactamente una vez cuando no hay estrategia
registrada y se excede el presupuesto; no repreguntes por porción. Registra
la estrategia elegida y los límites de porción (qué unidades de trabajo caen
en cada PR) en el registro de tarea o el plan.

**Pronóstico:** estima adiciones + eliminaciones escritas por unidad de
trabajo en el momento del plan. Los artefactos generados (lockfiles, salida
de codegen, código vendorizado) permanecen en el diff pero no en el recuento
escrito. Cuando el pronóstico es incierto, redondea hacia arriba — una cadena
innecesaria degrada con gracia a PRs pequeños; un PR sobredimensionado no
planificado no degrada a nada revisable.

## Anatomía de una porción

Cada porción es un contrato escrito antes de ser código. Por porción,
registra:

- **Unidad entregable** — una unidad de trabajo que se sostiene sola (nunca
  una capa horizontal como "todos los tests" o "todos los modelos").
- **Estado inicial / estado final** — qué hace el árbol antes y después.
- **Dependencias** — sobre qué porciones anteriores se construye; una
  porción sin dependencias de trabajo en curso puede avanzar en paralelo.
- **Trabajo aplazado** — trabajo explícitamente diferido a porciones
  posteriores.
- **Fuera de alcance** — ítems adyacentes notados pero deliberadamente no
  tocados.
- **Verificación** — las comprobaciones acotadas que esta porción debe pasar
  por sí sola.

Los tests y docs viajan con la unidad que verifican o explican — misma
porción, mismo conjunto de commits (ver `work-unit-commits`).

## Estrategias de ordenación

Elige la ordenación una vez, en el momento del plan; impórtala de
`incremental-implementation`:

- **Porciones verticales (por defecto):** cada PR entrega un comportamiento
  completo y funcional a través de todas las capas que toca.
- **Contract-first:** la porción 0 fija la interfaz/esquema; porciones
  paralelas implementan cada lado contra él; una porción final integra.
- **Risk-first:** el mecanismo más arriesgado o menos seguro aterriza
  primero para que un fallo se descubra antes de invertir el resto.
- **Por área/grupo de archivos:** solo cuando las porciones necesitan
  revisores distintos — nunca como excusa para dividir una unidad lógica
  arbitrariamente.

## Reglas de porción

- Una unidad de trabajo entregable por porción; tests y docs viajan con la
  unidad.
- Cada porción declara: estado inicial, estado final, dependencias de
  porciones anteriores, trabajo aplazado e ítems fuera de alcance.
- Cada porción debe verificar independientemente y revertirse sin revertir
  trabajo no relacionado.
- Los diffs contaminados son un defecto: reorienta o rebasea hasta que solo
  aparezca la unidad actual; nunca ensanches una porción para ocultar
  contaminación.
- Nunca mezcles estrategias una vez elegida.
- Mantén cada porción en verde: el proyecto compila y sus comprobaciones
  declaradas pasan tras cada porción, no solo al final de la cadena.
- El trabajo incompleto pero fusionado viaja tras un feature flag o un
  valor por defecto seguro — una porción fusionada es desplegable aunque la
  funcionalidad esté sin terminar.
- Refactors y cambios de comportamiento son porciones distintas — nunca un
  PR con dos sombreros.

## Mecánica de apilado

Cuando las porciones dependen entre sí, ejecútalas como cadena:

1. La porción 1 se ramifica desde la rama base. La porción 2 se ramifica
   desde la rama de la porción 1 — su diff contiene solo la unidad 2 porque
   su base es la porción 1.
2. Mantén la cadena superficial y ordenada; revisa de abajo hacia arriba.
3. Cuando la porción N se fusiona, reorienta el PR de la porción N+1 hacia
   la rama base y rebasea para que el diff vuelva a contener solo su propia
   unidad.
4. Si una porción se reelabora tras la revisión, propaga el cambio por la
   cadena deliberadamente — rebasea cada descendiente, reverifica cada uno.
5. Fusiona en orden salvo que una porción posterior sea demostrablemente
   independiente; fusionar fuera de orden es lo que crea el defecto de diff
   contaminado de arriba.
6. Nunca dejes que una porción absorba el trabajo de la siguiente para
   "ahorrar un rebase" — la disciplina de alcance aplica a los PRs igual
   que a los commits.

## Límites de autoridad

- Esta skill solo planifica porciones. Crear ramas/PRs, hacer push, fusionar
  o publicar son acciones separadas autorizadas por el propietario
  (`gitPush: ask`).
- Una estrategia registrada es un plan de entrega, no una autorización de
  fusión.
- El trabajo SDD formal aplica el mismo presupuesto: los límites de porción
  pertenecen al documento de diseño cuando el pronóstico lo excede.
- `exception-ok` es una decisión documentada del propietario con
  justificación — no un valor por defecto, ni cobertura retroactiva para un
  diff que creció sin plan.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Lo dividiré después de escribirlo" | La división retroactiva es cirugía de ramas; la división en el plan es barata. |
| "Un PR grande se revisa más rápido de una vez" | Los revisores leen por encima los diffs grandes; los defectos se esconden en las mil líneas del medio. |
| "La cadena añade sobrecarga de rebase" | El impuesto de rebase es pequeño junto a un mega-PR revertido o un defecto pasado por alto. |
| "Este refactor cabe dentro del PR de la funcionalidad" | Dos sombreros, dos PRs — los diffs mezclados anulan la revisión por porción. |
| "Los archivos generados inflan el recuento" | Los artefactos generados viajan pero no cuentan como líneas escritas. |
| "Preguntar una vez por porción mantiene informado al propietario" | Repreguntar es ruido; registra la estrategia una vez, reporta progreso por porción. |

## Señales de alerta

- Un pronóstico por encima del presupuesto sin estrategia registrada.
- Límites de porción trazados por tipo de archivo en lugar de por unidades
  entregables.
- Una porción que no puede verificar o revertirse independientemente.
- Un diff de PR que contiene trabajo de otra porción — reorienta, nunca
  ensanches.
- Fusiones fuera de orden en una cadena dependiente.
- Estrategia cambiada a mitad de camino ("solo esta vez agrupo dos
  unidades").
- `exception-ok` reclamado a posteriori en lugar de decidido por adelantado.
- Tests/docs entregados en una porción posterior separada de la unidad que
  cubren.

## Contrato de salida

Una entrega encadenada produce:

- La estrategia registrada (`single-pr` / `ask-on-risk` / `auto-chain` /
  `exception-ok`) elegida una vez, antes del primer PR.
- Un contrato de porción escrito por PR: unidad, estado inicial/final,
  dependencias, trabajo aplazado, fuera de alcance, verificación acotada.
- Evidencia por porción: resultados de comprobaciones independientes y un
  diff que contiene solo su propia unidad.
- Para `exception-ok`, la justificación documentada del propietario —
  decidida por adelantado.

## Verificación

Antes de declarar la cadena entregada:

- [ ] La estrategia y los límites de porción se registraron antes del primer
      PR.
- [ ] Cada porción declara estado inicial/final, dependencias, trabajo
      aplazado e ítems fuera de alcance.
- [ ] Cada porción verificó independientemente con sus comprobaciones
      acotadas.
- [ ] El diff de cada porción contiene solo su propia unidad (sin
      contaminación).
- [ ] Las unidades con riesgo nombrado se aislaron, no se agruparon con
      trabajo ordinario.
- [ ] Las fusiones ocurrieron en orden de dependencia; cada una aterrizó en
      verde.
- [ ] La funcionalidad completa verifica de extremo a extremo tras aterrizar
      la última porción.
- [ ] Todo `exception-ok` lleva la justificación documentada del
      propietario.

## Ver también

- `incremental-implementation` — el ciclo implementar→verificar→commit
  dentro de cada porción; fuente de las estrategias de ordenación.
- `work-unit-commits` — el presupuesto de porción revisable (~400 líneas
  escritas) y qué pertenece a cada commit.
- `spec-driven-development` — los límites de porción viven en el documento
  de diseño para trabajo formal.
- `deprecation-and-migration` — las migraciones suelen necesitar
  `exception-ok` o una cadena cuidadosamente ordenada.
