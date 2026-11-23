# Persistencia y recuperación — Reglas

> **Ámbito:** estado persistente: atomicidad, durabilidad y semántica de
> recuperación, propiedad de escrituras, pruebas de
> interrupción/corrupción, trade-offs de almacenamiento aceptados y ajuste
> del backend.
> **No aquí:** orden de locks y modelos async (`concurrency-async.md`),
> presupuestos de residencia en memoria (`memory-budget.md`), autorización
> de acciones destructivas (`safety.md`).
> **Estado:** Active
> **Fuentes:** decisión de trade-off de layout de almacenamiento (cerrada,
> con umbral de reapertura medido); registro de decisión de configuración
> del backend.

Aplicar a estado persistente. Especificar qué significan realmente
atomicidad, durabilidad y recuperación para el modelo de almacenamiento y
fallo antes de escribir código.

## Reglas

### 1 — Los trade-offs aceptados permanecen cerrados — reabrir exige la medición original

- **Debe:** tratar una decisión de "trade-off aceptado" cerrada (p. ej., un
  layout de almacenamiento más simple elegido sobre localidad física de
  datos, a un coste medido por debajo de un umbral documentado) como un
  contrato congelado, y registrar la señal cuantitativa de reapertura en el
  registro de decisión.
- **No debe:** reintroducir la complejidad rechazada (cachés de buffer,
  layouts de datos optimizados para localidad) sin una medición nueva
  contra el benchmark original que cruce el umbral documentado.
- **Por qué:** sin el umbral registrado, cada nuevo contribuidor re-litiga
  una decisión medida solo con intuición.

### 2 — La configuración del backend de almacenamiento debe corresponder al patrón de acceso documentado

- **Debe:** justificar cada opción de ajuste del backend (compaction,
  memtable, tamaño de bloque y caché) contra el patrón de acceso real y
  declarado de la carga de trabajo — p. ej., escrituras pequeñas frecuentes
  más lecturas aleatorias frente a escaneos secuenciales — y exigir un
  registro de decisión que cite tanto el patrón como un benchmark
  antes/después.
- **Debe:** asegurar que el dataset del benchmark excede la caché bajo
  prueba; si el working set cabe en caché, el delta medido es ruido.
- **No debe:** cambiar opciones del backend por especulación, ni aceptar
  afirmaciones de ajuste medidas sobre un working set totalmente en caché.
  Las desviaciones aceptadas se documentan con sus condiciones de alcance,
  no se ignoran en silencio.
- **Por qué:** los defaults del backend suelen alinearse con patrones de
  acceso comunes; el ajuste sin medir optimiza una carga de trabajo que
  puede no existir, y un benchmark demasiado pequeño oculta el efecto por
  completo.

### 3 — Las escrituras corren bajo propiedad exclusiva o control de concurrencia declarado

- **Debe:** serializar o coordinar explícitamente toda escritura a estado
  persistente — propiedad exclusiva, un lock de escritura o un protocolo de
  concurrencia declarado.
- **No debe:** permitir escritores no coordinados contra la misma
  estructura persistente (`→ see concurrency-async.md` para el orden de
  locks cuando intervienen varias estructuras).
- **Por qué:** las escrituras no coordinadas se entrelazan a nivel de byte;
  la recuperación hereda entonces un estado que ningún escritor individual
  produjo jamás.

### 4 — La interrupción y la corrupción se prueban, nunca se infieren

- **Debe:** probar las rutas de interrupción y corrupción — kill a media
  escritura, páginas rasgadas, logs truncados — y declarar la garantía de
  durabilidad que cada mecanismo realmente provee.
- **No debe:** inferir durabilidad ante pérdida de energía a partir de un
  rename exitoso, una salida normal del proceso o una prueba de cierre
  limpio.
- **Por qué:** las afirmaciones de durabilidad viven o mueren en las rutas
  de fallo; una prueba de ruta limpia no puede observar la propiedad que se
  declara (`→ see evidence.md`).

### 5 — Nunca destruir datos de usuario para recuperar conveniencia

- **Debe:** recuperar pruebas y limpiar locks obsoletos sin borrar datos de
  usuario preexistentes; poner en cuarentena o respaldar primero cuando los
  datos deben moverse.
- **No debe:** borrar o sobrescribir datos de usuario para desbloquear una
  prueba, un lock obsoleto o una migración (`→ see safety.md` — las
  operaciones destructivas necesitan autorización en cualquier caso).
- **Por qué:** una recuperación que destruye los datos que debía preservar
  es un segundo fallo, no una corrección.
