# Patrones de orquestación

Especifica objetivo, entradas, alcance, casos de aceptación y autoridad
para cada rol. Paraleliza solo trabajo independiente con entradas
resueltas y escrituras disjuntas. En el fan-in inspecciona los artefactos
reales, preserva el éxito parcial y reporta qué dependencias siguen
bloqueadas. Reanuda el trabajo válido antes de reintentarlo. La revisión
con contexto fresco necesita independencia real, no solo nombres distintos.

Catálogo de referencia de patrones de orquestación de agentes que este
harness endosa, más anti-patrones a evitar. Léelo antes de añadir un nuevo
comando que coordine múltiples personas, o antes de introducir una persona
que "envuelva" a otras existentes.

La regla que gobierna: **el usuario (o un comando) es el orquestador. Las
personas no invocan a otras personas.** Las skills/referencias son saltos
obligatorios dentro del flujo de trabajo de una persona.

---

## Patrones endosados

### 1. Invocación directa (sin orquestación)

Una persona, una perspectiva, un artefacto. El default y la opción más
barata.

```
user → code-reviewer → report → user
```

**Usar cuando:** el trabajo es una perspectiva sobre un artefacto y puedes
describirlo en una frase.

**Ejemplos:** "Revisa este PR" → un code reviewer. "Encuentra problemas de
seguridad en `auth.ts`" → un auditor de seguridad. "¿Qué pruebas faltan
para el flujo de checkout?" → un ingeniero de pruebas.

**Coste:** un round trip. La baseline con la que siempre deberías comparar
los patrones orquestados.

---

### 2. Comando de persona única

Un comando que envuelve una persona con las skills del proyecto. Ahorra al
usuario re-explicar el flujo de trabajo cada vez.

```
/audit review → five-axis code review → report
```

**Usar cuando:** la misma invocación de persona única ocurre repetidamente
con el mismo setup.

**Coste:** igual que la invocación directa. El comando es solo un prompt
guardado.

**Anti-señal:** si el cuerpo del comando es mayormente "decide qué persona
llamar", elimínalo y deja que el usuario llame a la persona directamente.

---

### 3. Fan-out paralelo con merge

Múltiples personas operan sobre la misma entrada concurrentemente, cada una
produciendo un informe independiente. Un paso de merge (en el contexto del
agente principal) las sintetiza en una única decisión.

```
                    ┌─→ code-reviewer    ─┐
ship → fan out  ───┼─→ security-auditor ─┤→ merge → go/no-go + rollback
                    └─→ test-engineer    ─┘
```

**Usar cuando:**
- Las sub-tareas son genuinamente independientes (sin estado mutable
  compartido, sin dependencia de orden)
- Cada sub-agente se beneficia de su propia ventana de contexto
- El paso de merge es lo bastante pequeño para quedarse en el contexto
  principal
- La latencia de reloj importa

**Coste:** N contextos de sub-agente en paralelo + un turno de merge. Mayor
que la invocación directa, pero más rápido en tiempo de reloj y produce
mejores informes porque cada sub-agente se mantiene enfocado en su única
perspectiva.

**Checklist de validación antes de adoptar este patrón:**
- [ ] ¿Puedo ejecutar todos los sub-agentes a la vez sin problemas de orden?
- [ ] ¿Produce cada persona un *tipo* distinto de hallazgo, no solo el
      mismo hallazgo desde un ángulo diferente?
- [ ] ¿Cabrá el paso de merge en el contexto restante del agente principal?
- [ ] ¿Es el tiempo de espera del usuario lo bastante largo para que el
      paralelismo se note realmente?

Si alguna respuesta es "no", vuelve a la invocación directa o a un comando
de persona única.

---

### 4. Pipeline secuencial como comandos dirigidos por el usuario

El usuario ejecuta comandos en un orden definido, transportando contexto
(o historial de commits) entre ellos. No hay agente orquestador — el
usuario ES el orquestador.

```
user runs:  spec  →  plan  →  task  →  task (bug)  →  review  →  ship
```

**Usar cuando:** el flujo de trabajo tiene dependencias (cada paso
necesita la salida del anterior) y el juicio humano entre pasos aporta
valor.

**Coste:** un contexto de sub-agente por paso. Gratis para la capa de
orquestación porque no hay agente orquestador.

**Por qué no automatizarlo:** un "orquestador de ciclo de vida" LLM
(a) perdería matices entre pasos porque tiene que resumir para el hand-off,
(b) se saltaría los checkpoints humanos que capturan trabajo en dirección
equivocada pronto, y (c) duplicaría el coste de tokens vía turnos de
paráfrasis.

---

### 5. Aislamiento de investigación (preservación de contexto)

Cuando una tarea requiere leer grandes cantidades de material que no
debería contaminar el contexto principal, lanza un sub-agente de
investigación que devuelva solo un digest.

```
main agent → research sub-agent (reads 50 files) → digest → main agent continues
```

**Usar cuando:**
- La sesión principal necesita mantenerse enfocada en una tarea posterior
- El resultado de la investigación es mucho más pequeño que la entrada que
  consume
- La calidad de la decisión se beneficia de que el agente principal tenga
  espacio para pensar después

**Ejemplos:** "Encuentra cada call site de esta API deprecated en el
monorepo", "Resume lo que dicen estos 30 decision records sobre caching."

**Coste:** un contexto de sub-agente aislado. Vale la pena siempre que la
alternativa sea cargar cientos de archivos en el contexto principal.

Si el host proporciona un subagente explore/search de solo lectura
incorporado, préferelo sobre definir una persona de investigación
personalizada; define una personalizada solo cuando necesites un system
prompt específico de dominio que el default no inferiría.

---

## Mapeo de capacidades del host

Este catálogo es agnóstico del harness, pero los hosts difieren en lo que
aplican:

| Capacidad | Implicación |
|---|---|
| Subagents | Patrón 3: el agente principal hace fan-out; los sub-agentes solo reportan de vuelta. La ejecución paralela requiere emitir las llamadas de spawn **en un solo turno** — los turnos secuenciales serializan. |
| Agentes estilo teammate ("teams") | Pares que se mensajean entre sí y comparten una lista de tareas. Correcto para trabajo adversarial/colaborativo; mayor coste. A menudo experimental. |
| Límites impuestos por la plataforma | Algunos hosts prohíben subagentes que lancen subagentes, o teams anidados — los anti-patrones B y D fallan entonces por construcción. No confíes en esto; mantén la regla igualmente. |
| Frontmatter por persona | Campos como `tools`, `model`, `disallowedTools`, `maxTurns` pueden honrarse solo en modo subagente — verifica el host. Si una persona depende de una skill o herramienta cargada, configúrala a nivel de sesión para que funcione en ambos modos. |
| Agentes de solo lectura incorporados | Muchos hosts traen agentes explore/plan/general-purpose. No los redefinas; apila personas especialistas encima. |
| Perillas de coste | Si el host permite selección de modelo por persona, modelos baratos para escaneos de cobertura y modelos fuertes para revisión de seguridad es una optimización legítima. |

### Ejemplo desarrollado: modo teammate para depuración de hipótesis en competencia

Usa teammates en lugar de fan-out cuando el valor proviene de que los
investigadores **se desafíen entre sí**, no de la cobertura paralela:

> *El checkout ocasionalmente se cuelga ~30 s antes de completar, más o
> menos una vez cada 50 sesiones, sin errores en los logs, empezó tras el
> release de la semana pasada.*

Causas plausibles mutuamente excluyentes: una carrera en el nuevo flujo de
confirmación, una comprobación de auth que cae a una llamada síncrona
lenta, un índice ausente que escala con el tamaño del carrito, un tercero
flaky reintentando en silencio.

| | Fan-out (subagentes) | Teammates |
|---|---|---|
| Los sub-agentes ven | El mismo diff, lentes distintas | Una lista de tareas compartida, los mensajes de los demás |
| Salida | Informes independientes → un merge | Debate adversarial → causa raíz por consenso |
| Correcto cuando | Quieres un veredicto sobre un artefacto conocido | Quieres *encontrar* el artefacto entre hipótesis |

Un fan-out es un veredicto; un team es una investigación. Se dispara
describiendo el síntoma, nombrando qué lentes de persona lanzar e
instruyéndoles a desafiar las teorías de los demás hasta que dos puedan
refutar las de los otros.

**No** reconstruyas esto como un comando que haga fan-out de subagentes —
los subagentes no pueden mensajearse entre sí, y perderías el debate
adversarial que hace funcionar al patrón. Documenta el prompt disparador
como un snippet en su lugar.

**Cuándo *no* usar teammates:** veredicto con destino a producción sobre un
diff conocido (fan-out), una perspectiva sobre un artefacto (invocación
directa), ciclo de vida secuencial (Patrón 4), investigación de mucha
lectura con un digest pequeño (Patrón 5).

---

## Anti-patrones

### A. Persona router ("meta-orquestador")

Una persona cuyo trabajo es decidir a qué otra persona llamar.

```
/work → router-persona → "this needs a review" → code-reviewer → router (paraphrases) → user
```

**Por qué falla:**
- Capa de routing pura sin valor de dominio
- Añade dos saltos de paráfrasis → pérdida de información + ~2× coste de tokens
- El usuario ya sabía que quería una revisión; podría haberla invocado
  directamente
- Replica el trabajo que los comandos y el mapeo de intención ya hacen

**En su lugar:** añade o refina comandos; documenta el mapeo intención →
comando en las instrucciones de agente del proyecto.

### B. Persona que llama a otra persona

Un `code-reviewer` que internamente invoca a un `security-auditor` cuando
ve código de auth.

**Por qué falla:**
- Las personas fueron diseñadas para producir una sola perspectiva;
  encadenarlas frustra eso
- El resumen que el llamador pasa pierde contexto que el llamado necesita
- Los modos de fallo se multiplican (¿qué formato de salida gana? ¿qué
  reglas aplican?)
- Oculta el coste al usuario

**En su lugar:** la persona llamadora *recomienda* una auditoría de
seguimiento en su informe. El usuario o un comando ejecuta la segunda
pasada.

### C. Orquestador secuencial que parafrasea

Un agente que ejecuta spec → plan → task → … en nombre del usuario.

**Por qué falla:**
- Pierde los checkpoints humanos que capturan trabajo en dirección errónea
- Cada hand-off resume contexto — deriva acumulada a lo largo de un
  pipeline largo
- Duplica el coste de tokens: turno de orquestador + turno de sub-agente
  por paso
- Elimina la agencia del usuario exactamente donde el juicio más importa

**En su lugar:** mantén al usuario como orquestador; documenta la secuencia
recomendada y deja que los usuarios la invoquen.

### D. Árboles profundos de personas

Un comando ship que llama a un coordinador pre-ship que llama a un
coordinador de calidad que llama al revisor real.

**Por qué falla:**
- Cada capa añade latencia y tokens sin valor de decisión
- La depuración se convierte en una investigación multi-nivel
- Las personas hoja pierden contexto en múltiples pasos de resumen

**En su lugar:** mantén la profundidad de orquestación en 1 como máximo
(comando → personas); el merge ocurre en el agente principal.

---

## Flujo de decisión

```
Is the work one perspective on one artifact?
├── Yes → Direct invocation. Stop.
└── No  → Will the same composition repeat?
         ├── No  → Direct invocation, ad hoc. Stop.
         └── Yes → Are sub-tasks independent?
                  ├── No  → Sequential user-driven commands (Pattern 4).
                  └── Yes → Parallel fan-out with merge (Pattern 3).
                           Validate against the checklist above.
                           If any check fails → single-persona command (Pattern 2).
```

## Cuándo añadir un patrón nuevo a este catálogo

Añade una entrada nueva solo después de:

1. Haber usado el patrón al menos dos veces en trabajo real
2. Poder nombrar un artefacto concreto en este repo que lo demuestre
3. Poder explicar por qué un patrón existente no habría funcionado
4. Poder describir su sombra anti-patrón (lo que la gente construirá por
   error en su lugar)

Las entradas de catálogo prematuras se convierten en documentación
aspiracional que nadie sigue.

<!-- Cross-references: → see ship-runbook.md, skills-engineering.md, task-domain.md -->
