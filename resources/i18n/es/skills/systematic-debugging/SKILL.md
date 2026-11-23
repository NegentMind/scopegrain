---
name: systematic-debugging
description: Usar cuando un test, comando o comportamiento observado falla antes de proponer un arreglo de código
---
# Depuración sistemática

Los arreglos aleatorios desperdician tiempo y crean nuevos bugs. Los parches
rápidos enmascaran problemas subyacentes.

**Principio central:** encuentra SIEMPRE la causa raíz antes de intentar
arreglos. Los arreglos de síntomas son un fallo. Violar la letra de este
proceso es violar el espíritu de la depuración.

## La Ley de Hierro

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

Si no has completado la Fase 1, no puedes proponer arreglos.

## Cuándo usar

Úsala para CUALQUIER problema técnico: fallos de tests, bugs de producción,
comportamiento inesperado, problemas de rendimiento, fallos de build,
problemas de integración.

**Úsala ESPECIALMENTE cuando:**
- Bajo presión de tiempo (las emergencias hacen tentador el adivinar)
- "Solo un arreglo rápido" parece obvio
- Ya probaste múltiples arreglos
- El arreglo anterior no funcionó
- No comprendes completamente el problema

**No la omitas cuando:** el problema parece simple (los bugs simples también
tienen causas raíz), tienes prisa (apurarse garantiza retrabajo), o alguien
lo quiere arreglado YA (lo sistemático es más rápido que el forcejeo).

Para recuperación de interrupciones/trabajo parcial (reanudar con seguridad,
preservar salidas) en lugar de trabajo de causa raíz, véase
`debugging-and-error-recovery`.

## Las fases

DEBES completar cada fase antes de proceder a la siguiente.

### Fase 0 — Contención (solo impacto en producción)

**Solo cuando hay impacto en producción en vivo (incidente, servicio caído):**

- PRIMERO mitiga/restaura el servicio: rollback, feature flag off, reinicio,
  escalado.
- Causa raíz DESPUÉS: nunca depures en caliente mientras el servicio está caído.
- Sin impacto en producción → salta directo a la Fase 1.

### Fase 1 — Investigación de causa raíz

**Antes de intentar CUALQUIER arreglo:**

1. **Lee los mensajes de error con cuidado.** No te saltes errores ni
   warnings: a menudo contienen la solución exacta. Lee los stack traces
   completos. Anota números de línea, rutas de archivo, códigos de error.
2. **Reproduce consistentemente.** ¿Puedes dispararlo de forma fiable?
   ¿Pasos exactos? ¿Siempre? Si no es reproducible → reúne más datos, no
   adivines. Captura el fallo exacto, las entradas, el entorno y el límite
   reproducible más pequeño.
3. **Comprueba cambios recientes.** ¿Qué cambió que pudo causar esto? Git
   diff, commits recientes, nuevas dependencias, cambios de config,
   diferencias de entorno.
4. **Reúne evidencia a través de los límites de componentes.** Cuando el
   sistema tiene múltiples componentes (CI → build → signing; API → servicio
   → base de datos), añade instrumentación de diagnóstico ANTES de proponer
   arreglos:

   ```
   For EACH component boundary:
     - Log what data enters the component
     - Log what data exits the component
     - Verify environment/config propagation
     - Check state at each layer

   Run once to gather evidence showing WHERE it breaks
   → then analyze evidence to identify the failing component
   → then investigate that specific component
   ```

5. **Traza el flujo de datos hacia atrás** cuando el error está profundo en
   la pila de llamadas (véase Trazado de causa raíz más abajo). ¿Dónde se
   origina el valor malo? ¿Qué llamó a esto con el valor malo? Sigue
   trazando hacia arriba hasta encontrar el origen: arregla en el origen,
   no en el síntoma.

### Fase 2 — Análisis de patrones

**Encuentra el patrón antes de arreglar:**

1. **Encuentra ejemplos que funcionan**: localiza código similar funcional
   en el mismo codebase. ¿Qué funciona que sea similar a lo que está roto?
2. **Compara contra referencias**: si implementas un patrón, lee la
   implementación de referencia COMPLETA. No la ojees: lee cada línea.
   Comprende el patrón plenamente antes de aplicarlo.
3. **Identifica diferencias**: lista cada diferencia entre lo que funciona
   y lo roto, por pequeña que sea. No asumas "eso no puede importar".
4. **Comprende las dependencias**: ¿qué otros componentes necesita esto?
   ¿Settings, config, entorno? ¿Qué supuestos hace?

### Fase 3 — Hipótesis y prueba

Método científico:

1. **Forma una única hipótesis.** Declárala claramente: "Creo que X es la
   causa raíz porque Y." Escríbela. Sé específico, no vago.
2. **Prueba mínimamente.** El cambio MÁS PEQUEÑO posible para probar la
   hipótesis. Una variable cada vez. No arregles varias cosas a la vez.
   Elige una comprobación **discriminante**: coincidir con un síntoma no es
   prueba.
3. **Verifica antes de continuar.** ¿Funcionó? → Fase 4. ¿No funcionó? →
   forma una hipótesis NUEVA. NO añadas más arreglos encima. Si la
   evidencia contradice la hipótesis, reevalúa en lugar de apilar arreglos.
4. **Cuando no sabes**: di "no entiendo X". No finjas. Pide ayuda.
   Investiga más.
5. **Haz la reproducción automatizable para bisección**: si la repro es
   determinista con un código de salida distinto de cero, déjala como
   script para que `git bisect run <script>` funcione; registra el comando
   en la sección de repro de la tarea. Trampas: commits que no compilan →
   `bisect skip`; bugs de interacción entre dos commits (bisect apunta al
   peor de los dos).

### Fase 4 — Implementación

**Arregla la causa raíz, no el síntoma:**

1. **Crea un test que falle.** La reproducción más simple posible: test
   automatizado si es posible, script único si no hay framework. DEBE existir
   antes de arreglar. Usa `test-driven-development` para el test fallido
   apropiado.
2. **Implementa un único arreglo.** Aborda la causa raíz identificada. UN
   cambio cada vez. Sin mejoras de "ya que estoy aquí". Sin refactorización
   empaquetada.
3. **Verifica el arreglo.** ¿El test pasa ahora? ¿Ningún otro test roto?
   ¿Problema realmente resuelto de extremo a extremo?
4. **Si el arreglo no funciona: PARA.** Cuenta los intentos:
   - <3 arreglos fallidos → vuelve a la Fase 1 con la nueva información.
   - **≥3 arreglos fallidos → PARA y cuestiona la arquitectura (5).**
   - NO intentes el arreglo #4 sin una discusión arquitectónica.
5. **3+ arreglos fallidos ⇒ cuestiona la arquitectura.** Patrón que indica
   un problema arquitectónico: cada arreglo revela nuevo estado
   compartido/acoplamiento en un lugar distinto; los arreglos requieren
   "refactorización masiva"; cada arreglo crea nuevos síntomas en otra
   parte. Pregunta: ¿es este patrón fundamentalmente sano? ¿Nos aferramos a
   él por inercia? ¿Deberíamos refactorizar en lugar de arreglar síntomas?
   **Discute con el dueño antes de más arreglos.** Esto no es una hipótesis
   fallida: es una arquitectura equivocada.
6. **DMAIC para bugs recurrentes.** Para arreglos de bugs que siguen
   volviendo: Define / Measure (línea base) / Analyze (causa raíz con
   datos) / Improve / **Control**: el paso que suele faltar es Control: sin
   monitoreo de regresión tras el arreglo, el bug vuelve. Registra una
   fecha/método de reverificación al cerrar el arreglo.

## Técnicas de apoyo

### Trazado de causa raíz (hacia atrás por la cadena de llamadas)

Los bugs se manifiestan profundo en la pila; el instinto dice arreglar donde
aparece el error: eso es un síntoma.

1. **Observa el síntoma.** `Error: git init failed in packages/core`
2. **Encuentra la causa inmediata.** ¿Qué código lo produce directamente?
   `execFile('git', ['init'], { cwd: projectDir })`
3. **Pregunta: ¿qué llamó a esto?** `WorktreeManager.createSession(dir)` →
   `Session.initializeWorkspace()` → `Session.create()` → el test llama a
   `Project.create()`.
4. **¿Qué valor se pasó?** `projectDir = ''`: la cadena vacía resuelve a
   `process.cwd()`: ¡el árbol de fuentes!
5. **Encuentra el disparador original.** `setupCoreTest()` devuelve
   `{ tempDir: '' }`: accedido antes de que `beforeEach` se ejecutara.

Arregla en el origen (p. ej. un getter que lanza cuando se accede antes de
la inicialización), luego **también** añade defensa en profundidad en cada
capa.

**Cuando no puedes trazar manualmente, añade instrumentación de pila:** antes
de la operación peligrosa (no después de que falle), registra contexto +
`new Error().stack`. En tests usa `console.error`/stderr: un logger puede
estar suprimido. Captura el sitio de llamada, cwd, env, timestamp. Analiza
qué test/llamante dispara el patrón.

**Encontrar un test contaminante:** cuando algo aparece durante los tests
pero no sabes qué test: bisecta ejecutando los tests de uno en uno y
comprobando el artefacto tras cada uno; para en el primer contaminante.
Bosquejo:

```bash
for f in $TEST_FILES; do
  [ -e "$POLLUTION" ] && continue   # already dirty before run
  run_test "$f" >/dev/null 2>&1
  [ -e "$POLLUTION" ] && { echo "POLLUTER: $f"; break; }
done
```

### Validación de defensa en profundidad

Un arreglo en un lugar puede ser evadido por otras rutas, refactorización o
mocks. **Valida en CADA capa por la que pasan los datos: haz el bug
estructuralmente imposible.** Validación única: "arreglamos el bug".
Múltiples capas: "hicimos el bug imposible".

| Capa | Propósito | Ejemplo |
|-------|---------|---------|
| 1. Punto de entrada | Rechazar entrada obviamente inválida en el límite de API | validar no vacío, existe, tipo correcto |
| 2. Lógica de negocio | Asegurar que los datos tienen sentido para la operación | precondiciones sobre valores de dominio |
| 3. Guardia de entorno | Prevenir operaciones peligrosas en contextos específicos | rechazar `git init` fuera de tmpdir bajo `NODE_ENV=test` |
| 4. Instrumentación de depuración | Capturar forense cuando las capas fallan | logging de stack + contexto antes de la operación peligrosa |

Aplica: traza el flujo de datos → mapea cada checkpoint → añade validación
en cada capa → prueba cada capa intentando evadir la anterior.

### Espera basada en condiciones

Los tests flaky adivinan el timing con esperas arbitrarias (`setTimeout`,
`sleep`): condiciones de carrera que pasan en local y fallan bajo carga de
CI. **Espera la condición real, no una suposición sobre la duración.**

```
❌ await sleep(50); expect(getResult()).toBeDefined();
✅ await waitFor(() => getResult() !== undefined);
```

Poller genérico: evalúa la condición dentro del bucle (datos frescos, no una
instantánea cacheada), sondea ~10 ms, lleva siempre un timeout con un
mensaje de error claro ("Timeout waiting for <description> after N ms").

Errores comunes: sondear demasiado rápido (1 ms: quema CPU); sin timeout
(cuelga para siempre); estado cacheado obsoleto (llama al getter dentro del
bucle).

**Cuándo un timeout arbitrario SÍ es correcto:** primero espera la condición
disparadora, luego espera un intervalo documentado basado en timing
*conocido* (p. ej. "200 ms = 2 ticks de un timer de 100 ms"): y comenta POR QUÉ.

## Señales de alerta — PARA y vuelve a la Fase 1

Si te descubres pensando:

- "Arreglo rápido por ahora, investigo después"
- "Solo prueba cambiar X y mira si funciona"
- "Añade varios cambios, ejecuta los tests"
- "Salta el test, verifico manualmente"
- "Probablemente es X, déjame arreglarlo"
- "No lo entiendo del todo pero esto podría funcionar"
- "El patrón dice X pero lo adaptaré diferente"
- "Estos son los problemas principales: [lista arreglos sin investigar]"
- Proponer soluciones antes de trazar el flujo de datos
- **"Un intento de arreglo más" (cuando ya probaste 2+)**
- **Cada arreglo revela un problema nuevo en un lugar distinto**

TODO esto significa: PARA. Vuelve a la Fase 1. A 3+ fallos, cuestiona la
arquitectura.

## Señales del dueño de que lo estás haciendo mal

- "¿Eso no está pasando?": asumiste sin verificar
- "¿Nos mostrará…?": deberías haber añadido recolección de evidencia
- "Deja de adivinar": estás proponiendo arreglos sin entender
- "Piensa más": cuestiona los fundamentos, no solo los síntomas
- "¿Estamos atascados?" (frustrado): tu enfoque no está funcionando

Cuando veas esto: PARA. Vuelve a la Fase 1.

## Racionalizaciones comunes

| Excusa | Realidad |
|--------|---------|
| "El problema es simple, no hace falta proceso" | Los problemas simples también tienen causas raíz. El proceso es rápido para bugs simples. |
| "Emergencia, no hay tiempo para proceso" | La depuración sistemática es MÁS RÁPIDA que el forcejeo de probar-y-fallar. |
| "Solo prueba esto primero, luego investiga" | El primer arreglo establece el patrón. Hazlo bien desde el inicio. |
| "Escribiré el test tras confirmar el arreglo" | Los arreglos sin test no se mantienen. El test primero lo prueba. |
| "Varios arreglos a la vez ahorran tiempo" | No puedes aislar qué funcionó: causa nuevos bugs. |
| "La referencia es muy larga, adaptaré el patrón" | La comprensión parcial garantiza bugs. Léela completa. |
| "Veo el problema, déjame arreglarlo" | Ver síntomas ≠ entender la causa raíz. |
| "Un intento de arreglo más" (tras 2+) | 3+ fallos = problema arquitectónico. Cuestiona el patrón, no arregles de nuevo. |

## Referencia rápida

| Fase | Actividades clave | Criterio de éxito |
|-------|---------------|------------------|
| 0. Contención | Mitigar el impacto en vivo primero (solo producción) | Servicio restaurado |
| 1. Causa raíz | Leer errores, reproducir, revisar cambios, reunir evidencia | Entender QUÉ y POR QUÉ |
| 2. Patrón | Ejemplos funcionales, comparar | Diferencias identificadas |
| 3. Hipótesis | Teoría, test discriminante mínimo | Confirmada o nueva hipótesis |
| 4. Implementación | Test fallido, arreglo único, verificar | Bug resuelto, tests pasan |

## Cuando el proceso revela "sin causa raíz"

Si la investigación sistemática muestra que el problema es verdaderamente
ambiental, dependiente de timing o externo: completaste el proceso:
documenta lo que investigaste, implementa el manejo apropiado (reintento,
timeout, mensaje de error claro), y añade monitoreo/logging para
investigación futura. **Pero:** ~95% de los casos de "sin causa raíz" son
investigación incompleta. Reporta honestamente cuando la reproducción o la
confirmación causal siga sin estar disponible.

Un fallo también puede tener **varias causas contribuyentes**: una cadena
de porqués lineal que para en la primera causa deja a la segunda recurrir.
Cuando la causa confirmada explica solo parte del conjunto de síntomas,
sigue investigando: cada síntoma restante sin explicar es su propia Fase 1.

## Contrato de salida

El entregable de este proceso no es "vuelve a funcionar": es:

1. La causa raíz documentada (qué falló, por qué, la cadena de evidencia).
2. Un test fallido o reproductor que probó la causa antes del arreglo.
3. El arreglo mínimo en el origen, más defensa en profundidad donde los
   datos cruzan capas.
4. El caso de regresión que sobrevive a la sesión.
5. Un relato honesto de lo que queda sin verificar: los elementos
   ambientales, intermitentes o de causa externa se nombran como tales.

Reanudar tras una interrupción, o recuperar un delegado que devolvió un
resultado incompleto, es contrato de `debugging-and-error-recovery`:
termina aquí primero el bucle de causa raíz cuando la causa sigue abierta.

## Límites

- Captura el fallo exacto, las entradas, el entorno y el límite reproducible
  antes de proponer nada.
- Los comandos se ejecutan bajo el modelo de permisos del host: propón
  comandos exactos cuando la ejecución esté reservada al dueño; nunca
  declares que una comprobación no ejecutada probó un arreglo.
- Un arreglo que pasa es evidencia para ese límite; el test de regresión es
  el artefacto duradero.
