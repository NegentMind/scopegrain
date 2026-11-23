# Invariantes del núcleo — Reglas

> **Ámbito:** invariantes del motor núcleo: feature gating, disciplina de
> superficie pública, propagación de errores, responsabilidad sobre código
> unsafe, convenciones de configuración y manejo de estado corrupto.
> **No aquí:** paridad de contratos públicos/docs (`api-contract.md`),
> durabilidad del almacenamiento (`durability.md`), modelos de locking
> (`concurrency-async.md`), disciplina de alcance (`workflow.md`).
> **Estado:** Active
> **Fuentes:** auditoría de feature gating (capacidad experimental
> publicada sin gate); auditoría de código (panics en almacenamiento de
> bajo nivel, doble nomenclatura de variables de entorno).

Antes de cambiar código del núcleo, identificar quién posee cada
invariante y en qué dirección corren las dependencias; probar las
condiciones de frontera; evitar cambios de arquitectura no relacionados y
supuestos de dominio importados.

## Reglas

### 1 — La capacidad experimental permanece tras feature flags — nunca en los defaults

- **Debe:** todo módulo o capacidad experimental compila tras un feature
  flag estilo `experimental-*` declarado en el manifiesto del paquete.
- **No debe:** activar módulos experimentales en el conjunto de features
  por defecto ni en builds de producción, ni dejar sin gate una capacidad
  documentada como experimental.
- **Por qué:** un módulo experimental sin gate llega a producción por
  accidente, expone API inestable y contradice el contrato de la
  especificación que las pruebas hacen cumplir — una auditoría de feature
  gating encontró exactamente esta deriva.

### 2 — Las funciones internas sin llamantes externos permanecen fuera de la superficie pública

- **Debe:** marcar como internas las funciones sin llamantes externos
  verificados — ocultas de la documentación o privadas al paquete.
- **No debe:** exportar a la API pública funciones que solo se invocan
  internamente.
- **Por qué:** cada símbolo público es un contrato de compatibilidad; lo
  que nada fuera del paquete usa no debe prometerse.

### 3 — Sin atajos de panic-on-error fuera de tests

- **Debe:** propagar errores a través del tipo error/result del proyecto en
  todo código que no sea de pruebas.
- **No debe:** usar llamadas estilo unwrap/expect ni fallbacks que
  enmascaran errores en rutas que no son de pruebas. Excepción sancionada:
  un helper de lock envenenado donde un lock envenenado es un invariante de
  proceso irrecuperable.
- **Por qué:** un panic en una ruta caliente mata todo el proceso en lugar
  de devolver un error tipado al llamante; las auditorías han encontrado
  panics en código de almacenamiento de bajo nivel.

### 4 — Todo bloque unsafe lleva un invariante documentado

- **Debe:** cada bloque unsafe documenta su invariante (tiempo de vida,
  alineación, aliasing) con un comentario estilo `// SAFETY:` que nombra la
  propiedad que lo garantiza; los bloques estilo FFI/transmute reciben una
  prueba con memory-checker donde el toolchain lo soporta.
- **No debe:** introducir nuevo unsafe sin pago de deuda equivalente en
  otra parte del cambio (deuda unsafe neta cero o negativa) ni sin su
  invariante documentado.
- **Por qué:** unsafe se concentra en pocos archivos; un bloque sin
  invariante documentado es una promesa inverificable.

### 5 — La configuración de entorno usa un prefijo y un helper de parseo

- **Debe:** todas las variables de entorno comparten un único prefijo de
  proyecto documentado; la lectura pasa por un helper de parseo común; un
  valor no reconocido o malformado advierte y cae al default documentado —
  nunca hace panic.
- **No debe:** implementar parseo ad hoc por punto de llamada ni permitir
  que dos nombres distintos denoten el mismo concepto.
- **Por qué:** los operadores no pueden predecir nombres de variables
  cuando las convenciones derivan entre capas; una auditoría encontró el
  mismo concepto configurado bajo dos nombres de variable distintos en
  módulos diferentes.

### 6 — El estado corrupto es un error explícito, nunca un éxito vacío

- **Debe:** exponer el estado corrupto o ilegible como un error tipado a
  través de la ruta de errores.
- **No debe:** reemplazar silenciosamente estado corrupto con un resultado
  vacío/por defecto que se lee como éxito (`→ see api-contract.md` para la
  forma a nivel de respuesta de esta regla).
- **Por qué:** un éxito vacío convierte pérdida de datos en una respuesta
  plausible de "sin datos"; el llamante trata entonces datos faltantes como
  vacío legítimo.
