---
name: code-review-and-quality
description: Úsala al inspeccionar un cambio en busca de defectos de comportamiento, regresiones, riesgos de límites y tests ausentes
---
# Revisión de código y calidad

Revisión multieje con controles de calidad. Todo cambio se revisa antes de
ser aceptado — sin excepciones. Cinco ejes: **corrección, legibilidad,
arquitectura, seguridad, rendimiento.**

**El estándar de aprobación:** aprueba un cambio cuando mejora
verificablemente la salud general del código, aunque no sea perfecto. El
código perfecto no existe — el objetivo es la mejora continua. No bloquees
un cambio porque no es como lo habrías escrito tú. Si mejora la base de
código y sigue las convenciones del proyecto, apruebalo.

## Cuándo usar

- Antes de fusionar cualquier cambio o marcar una unidad de trabajo como
  completa
- Tras completar una implementación de funcionalidad
- Cuando otro agente, modelo o humano produjo código que debes evaluar
- Al refactorizar código existente
- Tras cualquier corrección de bug — revisa tanto la corrección **como** el
  test de regresión

## La revisión de cinco ejes

### 1. Corrección — ¿el código hace lo que afirma?

- ¿Coincide con la especificación, el contrato o los requisitos de la
  tarea?
- ¿Se manejan los casos límite (null, vacío, valores frontera)?
- ¿Se manejan las rutas de error, no solo el camino feliz?
- ¿Pasa los tests relevantes — y los tests realmente prueban las cosas
  correctas?
- ¿Errores de off-by-one, condiciones de carrera o inconsistencias de
  estado?

### 2. Legibilidad y simplicidad — ¿puede otro ingeniero entenderlo sin el
autor?

- ¿Nombres descriptivos y consistentes con las convenciones del proyecto?
  (Nada de `temp`, `data`, `result` sueltos.)
- ¿Flujo de control directo (sin ternarios anidados, callbacks profundos)?
- ¿Organización lógica — código relacionado agrupado, límites de módulo
  claros?
- ¿Trucos "ingeniosos" que deberían simplificarse?
- **¿Podría hacerse en menos líneas?** 1000 líneas donde bastan 100 es un
  fallo.
- **¿Las abstracciones se ganan su complejidad?** No generalices hasta el
  tercer caso de uso.
- ¿Comentarios que aclararían intención no obvia? (Nunca comentes lo
  obvio.)
- ¿Artefactos muertos: variables no-op, shims de retrocompatibilidad,
  comentarios `// removed`?
- **Un condicional nuevo injertado en un flujo no relacionado es un olor de
  diseño, no un nit** — empuja la lógica a su propio helper, estado o
  política.
- **Condicionales repetidos sobre la misma forma señalan un modelo o
  dispatcher ausente.** Una rama "temporal" suele ser deuda permanente.

### 3. Arquitectura — ¿encaja el cambio en el diseño del sistema?

- ¿Sigue los patrones existentes, o introduce uno nuevo — y si es nuevo,
  está justificado y documentado?
- ¿Se mantienen límites de módulo limpios? ¿Las dependencias fluyen en la
  dirección correcta — sin dependencias circulares?
- ¿Duplicación que debería compartirse?
- ¿Nivel de abstracción apropiado — ni sobreingeniería, ni demasiado
  acoplamiento?
- **¿Este refactor reduce la complejidad o solo la reubica?** Cuenta los
  conceptos que un lector debe sostener para seguir el cambio. Si una
  versión "más limpia" deja ese recuento igual, no es más limpia — prefiere
  la reestructuración que hace desaparecer ramas, modos o capas enteras.
  Prefiere borrar una abstracción a pulirla.
- **¿Lógica específica de funcionalidad filtrándose a un módulo compartido
  o de propósito general?** Mantén la lógica en su capa propietaria;
  reutiliza el helper canónico, no un casi-duplicado; no normalices la
  deriva arquitectónica.
- **¿Los límites de tipos son explícitos?** Cuestiona `any`/`unknown`/
  opcionales/casts gratuitos y fallbacks silenciosos que tapan un
  invariante poco claro — un límite explícito a menudo simplifica el flujo
  de control circundante.

### 4. Seguridad — ¿introduce el cambio vulnerabilidades?

- ¿Entrada de usuario validada y saneada en los límites del sistema?
- ¿Secretos fuera de código, logs y control de versiones?
- ¿Autenticación/autorización comprobadas donde hace falta?
- ¿Consultas parametrizadas — sin concatenación de strings en
  SQL/comandos?
- ¿Salida codificada contra inyección (XSS et al.)?
- ¿Dependencias de fuentes confiables, sin vulnerabilidades conocidas?
- ¿Datos externos (APIs, logs, contenido de usuario, config) tratados como
  no confiables y validados antes de usarse en lógica o renderizado?

Para una postura de seguridad dedicada, remite a `security-and-hardening` y
`resources/references/security-checklist.md` — este eje controla el cambio;
esa skill posee el modelo de amenazas completo.

### 5. Rendimiento — ¿introduce el cambio problemas de rendimiento?

- ¿Patrones de consulta N+1?
- ¿Bucles sin límite o obtención de datos sin restricción?
- ¿Trabajo síncrono que debería ser asíncrono?
- ¿Re-renderizados innecesarios en componentes de UI?
- ¿Paginación ausente en endpoints de lista?
- ¿Objetos grandes creados en rutas críticas?

Para una postura de rendimiento dedicada, remite a
`performance-optimization` y
`resources/references/performance-checklist.md`.

Cuando señales un problema estructural, **propón el movimiento — no solo el
problema.** Una revisión que solo dice "esto es complejo" deja al autor
adivinando. Recurre a una reestructuración nombrada:

- Sustituir una cadena de condicionales por un modelo tipado o un
  dispatcher explícito.
- Colapsar ramas duplicadas en un único flujo más claro.
- Separar orquestación de lógica de negocio para que cada una se lea por sí
  sola.
- Sacar la lógica específica de funcionalidad de un módulo compartido al
  paquete que posee el concepto.
- Reutilizar el helper canónico en lugar de un casi-duplicado a medida.
- Hacer explícito un límite de tipos para que la ramificación posterior
  desaparezca.
- Eliminar un wrapper de paso que añade indirección sin aclarar la API.
- Extraer un helper, o dividir un archivo grande en módulos enfocados.

Prefiere el remedio que **elimina piezas móviles** sobre uno que reparte la
misma complejidad.

## Tamaño del cambio

Los cambios pequeños y enfocados son más fáciles de revisar, más rápidos de
fusionar, más seguros de desplegar:

```
~100 lines changed   → Good. Reviewable in one sitting.
~300 lines changed   → Acceptable if it's a single logical change.
~1000 lines changed  → Too large. Split it.
```

**Vigila el tamaño del archivo, no solo el tamaño del diff.** Un diff
pequeño puede empujar un archivo más allá de una frontera sana — alrededor
de 1000 líneas *totales* en un archivo es una señal de inspección, no un
tope duro. Cuando un cambio agranda materialmente un archivo ya grande,
pregunta si descomponer *primero* — extraer helpers, subcomponentes,
módulos — y luego añadir.

**Qué cuenta como "un cambio":** una única modificación autocontenida que
aborda una cosa, incluye tests relacionados y mantiene el sistema
funcional. Una parte de una funcionalidad — no la funcionalidad entera.

**Estrategias de división:**

| Estrategia | Cómo | Cuándo |
|----------|-----|------|
| Apilar | Entregar un cambio pequeño, construir el siguiente sobre él | Dependencias secuenciales |
| Por grupo de archivos | Cambios separados por dominio de revisor | Áreas transversales |
| Horizontal | Código/stubs compartidos primero, luego consumidores | Arquitectura en capas |
| Vertical | Porciones full-stack más pequeñas | Trabajo de funcionalidad |

**Cuándo los cambios grandes son aceptables:** eliminaciones completas de
archivos y refactors automatizados donde el revisor verifica la intención,
no cada línea.

**Separa refactorización de trabajo de funcionalidad.** Un cambio que
refactoriza *y* añade comportamiento son dos cambios — entrégalos por
separado. Las limpiezas pequeñas (renombrados) pueden viajar a discreción
del revisor.

## Descripciones de cambio

Todo cambio necesita una descripción que se sostenga sola en el historial.

- **Primera línea:** corta, imperativa, autosuficiente. "Delete the legacy
  RPC", no "Deleting the legacy RPC". Localizable sin leer el diff.
- **Cuerpo:** qué cambia y por qué — contexto, decisiones, razonamiento no
  visible en el código. Enlaza bugs, benchmarks, docs de diseño. Reconoce
  carencias conocidas.
- **Antipatrones:** "Fix bug", "Fix build", "Add patch", "Moving code
  from A to B", "Phase 1", "Add convenience functions".

## Proceso de revisión

### Paso 1 — Entender el contexto

Antes de mirar el código: ¿qué intenta lograr este cambio? ¿Qué
especificación, contrato o tarea implementa? ¿Cuál es el delta de
comportamiento esperado?

### Paso 2 — Revisar primero los tests

Los tests revelan intención y cobertura:

- ¿Existen tests para el cambio?
- ¿Prueban comportamiento, no detalles de implementación?
- ¿Están cubiertos los casos límite?
- ¿Nombres descriptivos?
- ¿Capturarían una regresión si el código cambiara?

### Paso 3 — Revisar la implementación

Recorre cada archivo cambiado contra los cinco ejes. Traza los defectos
sospechados hasta escenarios ejecutables antes de declararlos como
hallazgos — un hallazgo sin mecanismo de fallo es una hipótesis; etiquétalo
como tal.

### Paso 4 — Categorizar hallazgos por gravedad

Etiqueta cada comentario para que el autor sepa qué es obligatorio y qué
opcional:

| Prefijo | Significado | Acción del autor |
|--------|---------|---------------|
| **Critical:** | Bloquea la fusión — vulnerabilidad, pérdida de datos, funcionalidad rota | Debe corregir |
| *(sin prefijo)* | Cambio obligatorio | Debe atender antes de fusionar |
| **Optional:** / **Consider:** | Sugerencia | Vale la pena considerar, no obligatorio |
| **Nit:** | Menor — formato, preferencia de estilo | Puede ignorar |
| **FYI** | Informativo — contexto para el futuro | Ninguna |

**Encabeza con lo que importa.** Ordena los hallazgos por palanca:
corrección y seguridad primero, luego regresiones estructurales y
simplificaciones perdidas, luego todo lo demás. No entierres un problema
real bajo nits cosméticos — unos pocos comentarios de alta convicción valen
más que una lista larga. Un problema estructural más diez nits significa que
el problema estructural *es* la revisión.

### Paso 5 — Verificar la verificación

Comprueba la historia de verificación del autor:

- ¿Qué tests corrieron — y dónde está la evidencia (comando + salida)?
- ¿Pasó el build?
- ¿Se ejercitó el cambio manualmente donde los tests no llegan?
- ¿Capturas / evidencia de antes-después para cambios de UI?
- Cualquier cosa afirmada pero no ejecutada realmente → el hallazgo es una
  **brecha de verificación**, no un pase.

## Contrato de salida

El entregable es una revisión, no una corrección: hallazgos etiquetados por
gravedad y ordenados por palanca (críticos/obligatorios primero), cada uno
con `file:line` y una recomendación concreta, más un veredicto —
**Approve** o **Request changes** — y la historia de verificación. La lista
de verificación de abajo es la forma canónica. Un hallazgo que no puede
nombrar un mecanismo de fallo se etiqueta como hipótesis, no se declara como
defecto. El veredicto atestigua lo que muestra la evidencia; nunca autoriza
fusión, push o entrega.

## Patrón de revisión independiente / multicontexto

Contextos distintos tienen puntos ciegos distintos — rota el revisor:

```
Author context writes the code
        │
        ▼
Independent fresh context reviews for correctness and architecture
        │
        ▼
Author addresses the feedback
        │
        ▼
Owner makes the final call
```

Lanza el revisor a través del mecanismo que el host proporcione (subagente,
sesión delegada). Dale el diff, el contrato y los prefijos de gravedad —
nada más que necesite para confiar. Si el contexto revisor es el mismo que
implementó el cambio, eso es auto-revisión: decláralo; no satisface la
independencia para trabajo con riesgo nombrado (ver `independent-review`),
y necesita una exención explícita del propietario.

## Higiene de código muerto

Tras cualquier refactor o cambio de implementación:

1. Identifica el código ahora inalcanzable o sin uso.
2. Lístalo explícitamente.
3. **Pregunta antes de borrar:** "¿Elimino estos elementos ya sin uso:
   [lista]?"

```
DEAD CODE IDENTIFIED:
- formatLegacyDate() in src/utils/date.ts — replaced by formatDate()
- OldTaskCard component — replaced by TaskCard
- LEGACY_API_URL constant — no remaining references
→ Safe to remove these?
```

No dejes código muerto por ahí; no borres en silencio lo que no tienes
claro.

## Velocidad de revisión

Las revisiones lentas bloquean equipos enteros — coste de cambio de
contexto < coste de espera:

- **Responde en un día laborable** — el máximo, no el objetivo.
- Ideal: responde poco después de la petición; un cambio típico completa
  varias rondas en un día.
- Prioriza respuestas individuales rápidas sobre aprobación final rápida.
- Cambios grandes: pide al autor que divida en lugar de revisar un
  changeset masivo.

## Manejo de desacuerdos

Jerarquía de resolución:

1. **Los hechos técnicos y los datos** prevalecen sobre opiniones y
   preferencias.
2. **Las guías de estilo** son la autoridad absoluta en estilo.
3. **El diseño de software** se evalúa con principios de ingeniería, no
   gusto personal.
4. **La consistencia de la base de código** es aceptable si no degrada la
   salud.

**No aceptes "lo limpiaré después".** La limpieza diferida raramente ocurre
— exígela antes de la entrega salvo emergencia genuina. Si los problemas
circundantes no pueden atenderse en este cambio, exige un hallazgo
registrado con un propietario.

## Honestidad en la revisión

- **No selles sin mirar.** "LGTM" sin evidencia no ayuda a nadie.
- **No suavices problemas reales.** Un bug que llegará a producción no es
  una "preocupación menor".
- **Cuantifica los problemas.** "Este N+1 añade ~50 ms por ítem" supera a
  "podría ser lento".
- **Replica a enfoques con problemas claros.** El servilismo es un modo de
  fallo — dilo directamente y propón alternativas.
- **Acepta el override con elegancia.** Si el autor tiene contexto completo
  y discrepa, remite a su criterio. Comenta el código, no a las personas.

## Disciplina de dependencias

La revisión de dependencias es parte de la revisión de código.

**Antes de añadir cualquier dependencia:**

1. ¿La pila existente ya resuelve esto? (A menudo sí.)
2. ¿Cuánto pesa? (Comprueba el impacto en bundle/enlace.)
3. ¿Mantenida activamente? (Último commit, issues abiertos.)
4. ¿Vulnerabilidades conocidas? (Ejecuta el comando de auditoría del
   proyecto.)
5. ¿Licencia compatible?

**Regla:** prefiere la biblioteca estándar y las utilidades existentes.
Toda dependencia es un pasivo.

**Actualizar una dependencia es un cambio de código** — y las fusiones
masivas de "bump deps" son el tipo más arriesgado:

1. **Lee el changelog, no el número de versión.** Semver es una promesa que
   el mantenedor puede no haber cumplido; un "patch" puede llevar un cambio
   de comportamiento. Para majors, lee las notas de migración.
2. **Una dependencia por cambio** (o un grupo pequeño relacionado). Un bump
   masivo que rompe el build oculta qué paquete lo hizo; un cambio de un
   solo paquete mantiene la causa obvia y la reversión limpia.
3. **Deja que los tests decidan.** Verificado por una suite en verde antes
   *y* después — no por "se instaló". Cobertura escasa alrededor del
   comportamiento de la dependencia es en sí el hallazgo; añade un test
   primero.
4. **Atiende al grafo transitivo.** Revisa el diff del lockfile, no solo el
   manifiesto — un bump directo puede arrastrar docenas de cambios
   indirectos.
5. **Mantén el lockfile honesto.** Hazle commit, revisa su diff, nunca lo
   edites a mano.

## La lista de verificación de revisión

```markdown
## Review: [change title]

### Context
- [ ] I understand what this change does and why

### Correctness
- [ ] Matches spec/contract requirements
- [ ] Edge cases handled
- [ ] Error paths handled
- [ ] Tests cover the change adequately

### Readability
- [ ] Names clear and consistent
- [ ] Logic straightforward
- [ ] No unnecessary complexity

### Architecture
- [ ] Follows existing patterns
- [ ] No unnecessary coupling or dependencies
- [ ] Appropriate abstraction level
- [ ] Refactors reduce complexity rather than relocate it
- [ ] No feature logic in shared modules; file stays healthy-sized

### Security
- [ ] No secrets in code
- [ ] Input validated at boundaries
- [ ] No injection vectors
- [ ] Auth checks in place
- [ ] External data treated as untrusted

### Performance
- [ ] No N+1 patterns
- [ ] No unbounded operations
- [ ] Pagination on list endpoints

### Verification
- [ ] Tests pass (evidence, not claim)
- [ ] Build succeeds
- [ ] Manual verification done where applicable

### Verdict
- [ ] **Approve** — ready
- [ ] **Request changes** — issues must be addressed
```

## Bloqueadores presuntivos

Saca a la superficie y propón el diseño más simple para cada uno; escala a
Obligatorio solo cuando el cambio empeora activamente la estructura:

- Un refactor que reubica complejidad en lugar de reducirla.
- Un cambio que empuja un archivo más allá de la frontera de tamaño sin
  descomposición.
- Lógica de funcionalidad añadida a un módulo compartido.
- Un casi-duplicado de un helper canónico existente.
- Un fallback silencioso que oculta un invariante poco claro.

## Racionalizaciones comunes — recházalas

| Racionalización | Realidad |
|---|---|
| "Funciona, ya es suficiente" | Código que funciona pero es ilegible, inseguro o arquitectónicamente erróneo crea deuda compuesta. |
| "Lo escribí yo, sé que es correcto" | Los autores son ciegos a sus propios supuestos. |
| "Lo limpiaremos después" | Después nunca llega. La revisión es la puerta — úsala. |
| "El código generado por IA probablemente está bien" | El código de IA necesita *más* escrutinio — es confiado y plausible incluso cuando está mal. |
| "Los tests pasan, está bien" | Los tests no capturan problemas de arquitectura, seguridad o legibilidad. |
| "El refactor lo deja más limpio" | Reubicar complejidad no es reducirla — busca la versión donde las ramas desaparecen. |
| "Es solo una pequeña adición a este archivo" | Juzga la estructura resultante, no el tamaño del diff. |
| "Es solo un bump de versión" | Un bump es un cambio de comportamiento que no escribiste — lee el changelog. |
| "Actualizaré todo en un PR para ahorrar tiempo" | Los bumps masivos ocultan qué paquete lo rompió. Uno por cambio. |

## Señales de alerta

- Cambios fusionados sin ninguna revisión
- Revisión que solo comprueba si los tests pasan
- "LGTM" sin evidencia de revisión real
- Cambios sensibles a seguridad sin revisión enfocada en seguridad
- Cambios grandes "demasiado grandes para revisar bien" — divídelos
- Correcciones de bugs sin tests de regresión
- Comentarios de revisión sin etiquetas de gravedad
- Aceptar "lo arreglaré después"
- Un refactor que mueve código sin reducir el recuento de conceptos
- Condicionales nuevos dispersos en rutas no relacionadas (abstracción
  ausente)
- Un helper a medida duplicando uno canónico; lógica de funcionalidad en
  módulos compartidos
- Un bump masivo de dependencias sin revisión de changelog ni aislamiento
  por paquete
- Un cambio de lockfile editado a mano, sin commit o fusionado sin revisar

## Verificación tras la revisión

- [ ] Todos los problemas Critical resueltos
- [ ] Todos los cambios Required resueltos o explícitamente diferidos con
      justificación y un hallazgo registrado
- [ ] Los tests pasan — con evidencia ejecutada, no afirmaciones
- [ ] El build tiene éxito
- [ ] La historia de verificación está documentada (qué cambió, cómo se
      verificó)
- [ ] Actualizaciones de dependencias revisadas contra changelogs, aisladas
      por paquete, suite en verde, diff de lockfile revisado

## Límites

- Una revisión de solo informe no implementa correcciones — hallazgos y
  recomendaciones son su salida.
- No reclaims independencia desde una etiqueta de rol distinta dentro del
  mismo contexto de implementación; declara las brechas residuales
  honestamente.
- Los hallazgos y veredictos son atestaciones de evidencia vista — no
  autorizan fusión, push ni entrega.
