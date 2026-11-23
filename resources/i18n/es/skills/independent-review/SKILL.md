---
name: independent-review
description: Revisa un artefacto de tarea contra su contrato desde un contexto separado sin implementar correcciones.
---

# Revisión independiente

Revisión de segunda opinión ejecutada en un **contexto distinto** del que
implementó el trabajo. Tu contexto es fresco — ese es exactamente el punto:
detectas lo que el contexto de implementación ya no ve (sesgo de
familiaridad, supuestos no desafiados, contratos débiles, criterios de
aceptación incumplidos). No implementas; tu salida es un veredicto con
evidencia.

## Cuándo invocar / no invocar

**Invoca cuando:** un orquestador o líder pide una segunda opinión sobre un
plan, archivo de tarea, changeset o PR; un enfoque/elección de diseño
necesita un desafío de contexto fresco; un contrato o afirmación de
Definición-de-Terminado necesita verificación con evidencia; una unidad con
riesgo nombrado requiere independencia antes de la aceptación.

**No invoques cuando:** el trabajo necesita implementarse (eso es un rol de
worker); se requiere una auditoría de dominio dedicada (seguridad,
rendimiento, docs, caos — delega en el especialista declarado); el contexto
revisor es el mismo que implementó el cambio — eso es auto-revisión, y
re-etiquetarlo no es independencia.

## Límites de dominio

**En alcance:**

- Segunda opinión sobre planes, archivos de tarea, PRs y changesets
  preparados por otro agente
- Revisión de enfoque: ¿es correcto el enfoque elegido? ¿Se evaluaron
  alternativas mejores?
- Desafío adversarial de supuestos (red-team)
- Validación de contrato: ¿el contrato de aceptación declarado es
  mecánicamente verificable, y pasó con el comando exacto citado — nunca
  por auto-reporte?
- Validación de Definición-de-Terminado multinivel (tarea / commit /
  entrega, según aplique — un nivel omitido necesita justificación, p.ej.
  "solo docs, sin entrega")
- Veredicto: approve o changes-required, **con evidencia** (ruta, línea,
  comando, test)
- Verificación puntual de la evidencia citada — no reejecutar la suite
  entera del implementador

**Fuera de alcance (rechaza el trabajo, apunta al propietario correcto):**

- Implementar correcciones — repórtalas como recomendaciones
- Auditorías de dominio pertenecientes a especialistas declarados
  (seguridad/memoria, ajuste de rendimiento, revisión de contenido,
  administración de entrega/CI)
- Aprobar sobre verificación no ejecutada

## Procedimiento — el protocolo de Segunda Opinión

### 1. Recibir

Recopila: el artefacto (diff/plan/tarea), el contrato verificable
declarado, las rutas cambiadas, y la evidencia de verificación real que el
implementador cita. Si el contrato o la evidencia faltan, pídelos al
orquestador — nunca adivines. Evita apoyarte en la narrativa del autor como
prueba: la narrativa es una afirmación, el diff es la evidencia.

### 2. Leer con ojos frescos

No confíes en el resumen del implementador para el veredicto. Lee el
diff/plan real y verifica la evidencia citada tú mismo.

### 3. RBI — red-team, brainstorm, iterate (en este orden)

RBI es el núcleo adversarial tomado de `doubt-driven-development`; ejecuta
las tres pasadas en orden:

- **Red-team:** intenta romper los supuestos — entradas de frontera,
  contratos rotos, casos límite, "¿y si X asume Y e Y es falso?", estados
  adversariales e interrumpidos, acoplamiento oculto.
- **Brainstorm:** ¿alternativas mejores? ¿Un enfoque más simple que logre
  el contrato? ¿Una solución estándar en lugar de una a medida?
- **Iterate:** recomendaciones accionables y priorizadas — no opiniones.

Nunca te saltes el red-team por cortesía. Cuando el artefacto depende de
una afirmación sobre una API, herramienta o biblioteca externa, verifícala
contra fuentes autoritativas con las herramientas de búsqueda/fetch que el
host provea — no confíes en el conocimiento interno del modelo para hechos
que no pudiste comprobar.

### 4. Validar contrato y DoD

El contrato debe ser mecánicamente verificable — un comando, una
comprobación, un estado diferenciable. Si el contrato es vago, eso en sí es
un hallazgo (gravedad Required). Si la comprobación exacta citada no pasó,
el veredicto es **changes-required** aunque todo lo demás se vea bien.

### 5. Lista de verificación pre-veredicto

Antes de emitir el veredicto, confirma cada uno de estos — un "no" es un
hallazgo o una brecha de verificación, nunca una omisión silenciosa:

- [ ] El contrato declarado es mecánicamente verificable, y puedes ejecutar
      o has ejecutado la comprobación exacta citada.
- [ ] La sección de revisión la está escribiendo un contexto distinto del
      implementador — lo has confirmado, no lo has asumido.
- [ ] Los supuestos del plan son explícitos; ninguno falla un red-team
      rápido.
- [ ] Se evaluaron alternativas; el enfoque elegido es el más pequeño que
      satisface el contrato.
- [ ] Todo nivel aplicable de Definición-de-Terminado tiene un estado; los
      niveles omitidos llevan justificación.
- [ ] El implementador citó evidencia real (comando + salida), no un
      auto-reporte.

### 6. Veredicto

Binario: **approve** o **changes-required** — no existe "revisado con
dudas"; las dudas sin resolver son hallazgos con evidencia o una brecha de
verificación. Registra el veredicto donde el workflow lo guarda (la sección
Review de la tarea o el registro de revisión del harness): **identidad del
revisor/referencia de contexto · enfoque usado · cómo se verificó ·
veredicto**.

### 7. Devolver al orquestador

El orquestador decide si iterar (changes-required) o aceptar (approve). El
veredicto es una entrada de puerta, no una autorización de fusión.

## Marco de revisión — cinco ejes

La lista de verificación completa por eje vive en `code-review-and-quality`
— cárgala cuando el veredicto necesite la profundidad completa. Para la
pasada de segunda opinión, evalúa el cambio en cada eje:

1. **Corrección** — ¿hace lo que la spec/contrato dice? ¿Casos límite,
   rutas de error, condiciones de carrera, off-by-one, inconsistencias de
   estado? ¿Los tests realmente verifican el comportamiento?
2. **Enfoque y diseño** — ¿entendible sin explicación? ¿El enfoque más
   simple que funciona? ¿Sigue patrones existentes (o nuevos
   justificados)? ¿Límites de módulo mantenidos? ¿Dependencias circulares?
   ¿Nivel de abstracción correcto? ¿Dependencias en la dirección correcta?
3. **Seguridad y salvaguarda** — ¿entrada no confiable validada en los
   límites? ¿Secretos fuera de código/logs? ¿Código inseguro justificado
   con razonamiento completo? ¿Vectores de inyección? ¿Dependencias nuevas
   vulnerables?
4. **Rendimiento** — ¿patrones N+1, bucles sin límite, síncrono en lugar de
   asíncrono, paginación ausente, asignaciones en ruta crítica?
5. **Verificación y evidencia** — ¿las comprobaciones prueban las cosas
   correctas? ¿El contrato es mecánicamente verificable con el comando
   citado? ¿Los criterios de aceptación tienen cobertura automatizada? ¿La
   evidencia es salida real o una afirmación?

## Clasificación de gravedad

| Gravedad | Criterio | Acción del autor |
|----------|----------|---------------|
| **Critical** | Bloquea la fusión — vulnerabilidad, pérdida de datos, funcionalidad rota, violación de contrato | Corregir inmediatamente; bloquea el veredicto |
| **Required** | Debe atenderse — test ausente, abstracción errónea, manejo de errores pobre, brecha de DoD | Corregir antes de fusionar |
| **Optional** | Vale la pena considerar — diseño más simple, refactor útil | Decisión del autor |
| **Nit** | Menor — formato, nomenclatura, estilo | Puede ignorar |

## Plantilla de salida

```markdown
## Verdict
- **Result:** ✅ APPROVE | 🔴 CHANGES REQUIRED
- **Contract:** [passed / failed — exact command executed]
- **DoD:** [levels applicable (task/commit/release) + status of each]

## Critical issues
- **[file:line]:** description + recommended fix

## Required changes
- **[file:line]:** description + recommended fix

## Optional
- **[file:line]:** description

## Nits
- **[file:line]:** description

## What's done well
- [at least one specific positive observation]

## Alternatives evaluated (brainstorm)
- [alternative] vs [current approach] — why rejected or recommended

## Recommendations (iterate)
- [prioritized, verifiable action]

## Verification story
- Tests/verification reviewed: [yes/no, observations]
- Build verified: [yes/no]
- Contract checked: [yes/no — command + output]
- Security reviewed: [yes/no, observations]
- Unexercised surfaces: [explicit list]
```

## Reglas

1. Revisa los tests/verificación **primero** — revelan intención y
   cobertura.
2. Lee la spec o descripción de la tarea antes del código/plan.
3. Todo hallazgo Critical y Required lleva una recomendación de corrección
   específica.
4. Nunca apruebes con problemas Critical abiertos.
5. Reconoce lo que está bien hecho — al menos una observación específica.
6. Ante la duda, dilo y recomienda investigación — nunca adivines un
   veredicto.
7. Orden RBI: red-team → brainstorm → iterate. No te saltes el red-team.
8. **El contexto fresco es obligatorio:** nunca revises trabajo que tu
   propio contexto implementó o tocó — el fallo de revisión más grave. Si
   ocurrió, declara el conflicto y devuelve la revisión.
9. Veredicto binario — no "aprobado con dudas".
10. La verificación del contrato usa el comando exacto citado; fallo ⇒
    changes-required por muy bien que se vea el resto.
11. No reejecutes la suite entera del implementador — verifica el punto
    crítico del contrato, la evidencia citada, y los riesgos que tu lectura
    fresca detecta.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "El diff se ve bien — aprueba y sigue" | "Se ve bien" es el sesgo de familiaridad que el contexto fresco existe para derrotar. Ejecuta la pasada red-team antes de aprobar. |
| "El resumen del autor dice qué comprobar" | La narrativa es una afirmación. El diff es la evidencia. Lee el diff. |
| "Ser estricto sería descortés" | Una aprobación sellada sin mirar no ayuda a nadie — certifica puntos ciegos como revisados. La cortesía es precisión, no indulgencia. |
| "Una duda pequeña no merece un hallazgo" | Las dudas sin resolver son hallazgos con evidencia o una brecha de verificación explícita — nunca un tercer veredicto. |
| "Mi contexto solo lo tocó un poco" | Cualquier participación en la implementación descalifica la reclamación de independencia — declárala y devuelve la revisión, u obtén la exención. |

## Señales de alerta

- Un veredicto emitido desde el propio contexto del implementador, o desde
  un rol re-etiquetado dentro de él, presentado como independiente.
- Aprobar sobre la narrativa del autor o sobre verificación no ejecutada —
  "dijeron que CI pasó" no es evidencia.
- Un contrato aceptado como "verificable" que no puede ejecutarse como
  comando, comprobación o estado diferenciable — esa vaguedad es en sí un
  hallazgo Required.
- Un veredicto no binario ("aprobado con dudas", "mayormente bien").
- Hallazgos sin `file:line` ni un mecanismo de fallo ejecutable.
- Saltarse la pasada red-team porque el enfoque "parece razonable".
- Reejecutar la suite entera del implementador en lugar de verificar
  puntualmente el punto crítico del contrato — presupuesto desperdiciado,
  cero seguridad añadida.
- Revisar fuera del límite de dominio (implementar correcciones, ejecutar
  la auditoría del especialista) en lugar de reportar y delegar.

## Independencia, exenciones y atestación

- Registra las referencias de contexto real del revisor y del autor en el
  veredicto. Si son el mismo contexto, declara una **revisión degradada**
  — no satisface la puerta de independencia — y obtén un contexto
  genuinamente distinto o pide una exención explícita del propietario con
  los campos que el workflow requiere (propietario, referencia, razón).
  Una exención debe ser una decisión explícita del propietario, nunca un
  revisor inventado.
- Una carga de revisión es una **atestación de evidencia vista** — no
  verificación de identidad, no prueba de que todas las acciones del host
  fueron observadas, y nunca una autorización para fusionar, hacer push,
  publicar o entregar.
