# Evidencia — Reglas

> **Ámbito:** qué cuenta como prueba de una afirmación: hechos frente a
> inferencia, comprobaciones ejecutadas, atestaciones, límites de la
> inspección, obsolescencia, fixtures y el deber de reportar vacíos de
> evidencia.
> **No aquí:** proceso de workflow y manejo de comprobaciones fallidas
> (`workflow.md`), presupuestos de reintento (`research-escalation.md`),
> estándares de revisión (`review.md`).
> **Estado:** Active

## Reglas

### 1 — Etiquetar cada afirmación como hecho, inferencia o especulación

- **Debe:** distinguir hechos observados, inferencia y especulación, y
  declarar cuál es cada afirmación.
- **No debe:** presentar una inferencia o una conjetura plausible como un
  hecho observado.
- **Por qué:** las decisiones aguas abajo son tan sólidas como la
  afirmación más débil silenciosamente promovida.

### 2 — Nombrar la prueba exacta

- **Debe:** citar el comando exacto, el directorio de trabajo, el resultado
  y el artefacto inspeccionado detrás de una afirmación de verificación.
- **No debe:** afirmar "verificado" o "probado" sin una referencia
  reproducible.
- **Por qué:** una comprobación sin nombre no puede re-ejecutarse,
  auditarse ni falsarse.

### 3 — Nunca marcar como superada una comprobación no ejecutada

- **Debe:** reportar las comprobaciones propuestas pero no ejecutadas como
  no ejecutadas.
- **No debe:** registrar una comprobación como superada en base a la
  intención o al estado previo.
- **Por qué:** una comprobación que nunca corrió no produjo evidencia;
  afirmar que sí es fabricación.

### 4 — Las atestaciones registran afirmaciones; no autentican ejecución

- **Debe:** tratar las atestaciones de clasificación y resultado como
  declaraciones atribuidas sobre el trabajo.
- **No debe:** leer una atestación como prueba de que el trabajo corrió o
  de que una identidad está autenticada.
- **Por qué:** una atestación vincula una afirmación a un autor declarado;
  no es una firma sobre una traza de ejecución.

### 5 — No sobre-afirmar lo que la inspección estática puede probar

- **Debe:** tratar el comportamiento en runtime, las propiedades de
  población de datos y los resultados dependientes del entorno como
  requeridos de evidencia en runtime.
- **No debe:** afirmarlos solo desde la lectura de código.
- **Por qué:** la inspección estática no puede observar planificación,
  forma de datos de producción ni varianza de plataforma.

### 6 — Un pass obsoleto no prueba una implementación cambiada

- **Debe:** re-verificar tras una modificación y vincular el resultado a la
  revisión inspeccionada (`→ see workflow.md`).
- **No debe:** citar un pass anterior al cambio como evidencia del trabajo
  cambiado.
- **Por qué:** un resultado se vincula a la revisión que lo produjo; el
  código nuevo anula la evidencia vieja.

### 7 — Reportar evidencia ausente, corrupta o no disponible

- **Debe:** exponer los vacíos de evidencia y los artefactos perdidos o no
  disponibles, y valorarlos dentro de la afirmación.
- **No debe:** suprimir el vacío ni rellenarlo con una narrativa plausible
  (`→ see workflow.md` — nunca ocultar una comprobación fallida).
- **Por qué:** el owner valora el riesgo sobre la evidencia reportada; los
  vacíos silenciosos convierten incógnitas en cobertura asumida.

### 8 — Los dobles de prueba deben reflejar el contrato real

- **Debe:** mantener fixtures, fakes y mocks alineados con la forma del
  contrato real que representan.
- **No debe:** tratar una suite en verde contra un doble que deriva como
  evidencia de comportamiento.
- **Por qué:** la prueba verifica entonces el doble, no el sistema.
