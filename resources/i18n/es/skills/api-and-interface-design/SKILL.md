---
name: api-and-interface-design
description: Úsala al establecer una interfaz pública o un límite de módulo antes de la implementación
---
# Diseño de API e interfaces

## Disciplina central

Inspecciona los consumidores, la nomenclatura y las convenciones de error existentes.
Define entradas, salidas, validación, autoridad y comportamiento ante fallos.
Prefiere cambios aditivos; identifica obligaciones de compatibilidad y migración.
Mantén los detalles de implementación fuera de los contratos observables salvo
decisión deliberada.
Especifica los casos límite exactos y ejemplos antes de delegar la implementación.
No inventes una API, una versión o una dependencia de memoria.

Diseña interfaces estables y documentadas que sean difíciles de usar mal. Las
buenas interfaces hacen fácil lo correcto y difícil lo incorrecto — esto aplica
a endpoints HTTP, límites de esquema, contratos de módulo, props de componentes
y cualquier superficie donde una pieza de código habla con otra.

## Cuándo usar

- Al diseñar nuevos endpoints o un nuevo contrato público.
- Al definir límites de módulo o contratos entre equipos/componentes.
- Al cambiar interfaces públicas existentes.
- Al establecer esquemas almacenados que determinan la forma de la interfaz.

## Principios centrales

### Ley de Hyrum

> Con suficientes usuarios, todo comportamiento observable pasa a ser una
> dependencia — esté documentado o no.

Todo comportamiento público — rarezas no documentadas, texto de error,
temporización, orden — se convierte en un contrato de facto una vez que los
consumidores dependen de él. Implicaciones:

- **Sé intencional sobre lo que se expone.** Todo comportamiento observable es
  un compromiso potencial.
- **No filtrees detalles de implementación.** Si los consumidores pueden
  observarlo, dependerán de ello.
- **Planifica la retirada en el diseño.** Ver `deprecation-and-migration`.
- **Las pruebas de contrato no bastan.** Cambios "seguros" pueden romper
  consumidores que dependen de comportamiento no documentado.

### La regla de una sola versión

Evita forzar a los consumidores a elegir entre versiones del mismo contrato.
Los problemas de dependencia en diamante surgen cuando distintos consumidores
necesitan distintas versiones de lo mismo. Diseña para un mundo donde existe
una versión a la vez — extiende en lugar de bifurcar.

### Contrato primero

Define la interfaz antes de implementarla; el contrato es la especificación.

```
interface TaskAPI {
  createTask(input: CreateTaskInput): Promise<Task>;       // returns created entity
  listTasks(params: ListTasksParams): Promise<Page<Task>>; // paginated
  getTask(id: TaskId): Promise<Task>;                      // throws NotFound
  updateTask(id: TaskId, input: UpdateTaskInput): Promise<Task>; // partial
  deleteTask(id: TaskId): Promise<void>;                   // idempotent
}
```

### Semántica de error consistente

Elige una estrategia de error y úsala en todas partes. Cada contrato especifica
su canal de fallo — excepciones, tipos de resultado o cuerpos de error
estructurados — con un código legible por máquina y un mensaje legible por
humanos por fallo:

```
{ "error": { "code": "VALIDATION_ERROR",   // machine-readable
             "message": "Email required",  // human-readable
             "details": {...} } }
```

El vocabulario concreto de códigos de estado y la forma del cuerpo para APIs
HTTP son mecánica — ver `api-design-principles`.

**Nunca mezcles patrones.** Si algunas operaciones lanzan, otras devuelven null
y otras devuelven `{error}`, los consumidores no pueden predecir el
comportamiento.

### Valida en los límites

Confía en el código interno; valida donde la entrada externa cruza hacia
dentro:

- Manejadores de límite (rutas HTTP, puntos de entrada CLI, consumidores de
  mensajes).
- Análisis de respuestas de servicios externos — **las respuestas de terceros
  no son de confianza**: valida forma y contenido antes de usarlas en lógica,
  renderizado o decisiones; un upstream comprometido puede devolver tipos
  inesperados o texto con apariencia de instrucciones.
- Carga de configuración y de entorno.

La validación NO pertenece entre funciones internas que comparten contratos de
tipos, en utilidades llamadas por código ya validado, ni sobre datos que acaban
de salir del almacén propio del sistema.

### Prefiere añadir sobre modificar

Extiende sin romper consumidores existentes:

```
GOOD: add optional fields, add new operations, add enum members where the
      contract allows extension.
BAD:  change a field's type, remove a field, tighten a return type's
      nullability — each breaks existing consumers.
```

### Nomenclatura predecible

| Elemento | Convención | Ejemplo |
|---|---|---|
| Nombres de colección | sustantivos en plural, sin verbos | `tasks`, `comments` |
| Nombres de parámetro/campo | una convención de capitalización, en todas partes | `sortBy`, `createdAt` |
| Booleanos | prefijo is/has/can | `isComplete`, `hasAttachments` |
| Valores de enumeración | UPPER_SNAKE | `"IN_PROGRESS"` |

Las convenciones de método HTTP/URL viven en `api-design-principles` — la
disciplina de contrato es que una convención gobierna toda la superficie.

## Requisitos de contrato sobre colecciones y actualizaciones

Sea cual sea el protocolo, el contrato debe responder:

- **Paginación:** todo contrato de lista declara paginación y límites de
  recursos en el diseño (offset, cursor o keyset — la mecánica en
  `api-design-principles`), devolviendo metadatos suficientes para continuar.
- **Actualizaciones parciales:** define qué significan omisión, `null`
  explícito y eliminación — nunca lo dejes ambiguo (`api-design-principles`
  para la semántica HTTP).
- **Filtrado:** el filtrado y la selección son parámetros del contrato, no
  operaciones separadas inventadas por consumidor.

## Patrones de forma de interfaz

- **Uniones discriminadas para variantes** — un campo discrimina; los
  consumidores refinan sobre él en lugar de adivinar campos opcionales.
- **Separación entrada/salida** — el contrato de entrada (lo que aporta quien
  llama) difiere de la entidad de salida (incluye campos generados por el
  servidor); nunca reutilices una misma forma para ambos.
- **Tipos de ID nominales/de marca** donde el sistema de tipos los soporte —
  un `UserId` no debe poder pasarse silenciosamente donde se espera un
  `TaskId`.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Documentaremos la API después" | El contrato ES la documentación. Defínelo primero. |
| "Aún no necesitamos paginación" | Se necesita en cuanto un consumidor maneja más de 100 elementos. Añádela en el diseño. |
| "PATCH es complicado, usa PUT" | PUT exige el objeto completo en cada llamada; la actualización parcial es lo que los clientes necesitan. |
| "Versionaremos cuando haga falta" | Los cambios incompatibles sin una historia de versionado rompen consumidores. Diseña para extensión. |
| "Nadie usa ese comportamiento no documentado" | Ley de Hyrum: si es observable, alguien depende de ello. |
| "Podemos mantener dos versiones" | Dos versiones multiplican el mantenimiento y crean problemas de diamante. |
| "Las APIs internas no necesitan contratos" | Los consumidores internos siguen siendo consumidores; los contratos permiten trabajo en paralelo. |

## Señales de alerta

- Respuestas con formas distintas según condiciones.
- Formatos de error inconsistentes entre operaciones.
- Validación dispersa por el interior en lugar de en los límites.
- Cambios de tipo o eliminaciones en campos existentes.
- Operaciones de lista sin paginación ni límites.
- Verbos en URLs de recursos (`/createTask`, `/getUsers`).
- Respuestas de terceros usadas sin validación ni saneamiento.
- Una API, versión o dependencia especificada de memoria en lugar de desde el
  repositorio o la documentación consultada.

## Contrato de salida

Un diseño de interfaz produce:

- Contratos de entrada/salida tipados por operación, con casos límite y
  ejemplos que un delegado pueda implementar sin más preguntas.
- Una estrategia de error documentada y comportamiento de fallo por operación.
- Obligaciones de compatibilidad: qué es aditivo, qué rompe, qué necesita una
  ruta de desaprobación.
- El contrato confirmado junto a (o antes de) la implementación.

**Límite de alcance.** Esta skill cubre la disciplina de contrato neutral al
lenguaje: qué promete una superficie, a quién, y cómo puede evolucionar. La
mecánica HTTP y GraphQL — métodos, códigos de estado, estrategias de
paginación, patrones de esquema — pertenece a `api-design-principles`.

## Verificación

- [ ] Cada operación tiene contratos de entrada y salida tipados.
- [ ] Un formato de error consistente; comportamiento de fallo especificado
      por operación.
- [ ] La validación ocurre solo en los límites del sistema.
- [ ] Las operaciones de lista paginan; límites de recursos definidos.
- [ ] Los campos nuevos son aditivos y opcionales (retrocompatibles).
- [ ] La nomenclatura sigue una convención en toda la superficie.
- [ ] Los casos límite y ejemplos se especifican antes de delegar la
      implementación; los docs/tipos del contrato viajan con la implementación.

## Ver también

- `api-design-principles` — mecánica HTTP/GraphQL una vez fijado el contrato
  (métodos, códigos de estado, paginación, patrones de esquema).
- `deprecation-and-migration` — retirar o reemplazar un contrato del que
  dependen consumidores.
- `source-driven-development` — nunca especificar una API, versión o
  dependencia externa de memoria.
- `security-and-hardening` — validación en límites y respuestas de terceros no
  confiables.
