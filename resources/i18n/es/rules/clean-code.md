# Clean Code & Clean Architecture — Directivas

> **Ámbito:** disciplina de código siempre activa — dirección de
> dependencias, forma de funciones, DTOs de frontera, manejo de errores
> e higiene de modificación que aplican a todo cambio de código, no solo
> a auditorías.
> **No aquí:** la checklist de auditoría, ejemplos trabajados y escala de
> severidad (`references/clean-code-clean-architecture`), el procedimiento
> de revisión (`commands/review-change`), el procedimiento de
> simplificación (`commands/simplify-code`).
> **Estado:** Active

## Reglas

### 1 — Las dependencias solo apuntan hacia adentro

- **Debe:** mantener los imports fluyendo Infraestructura → Adaptadores →
  Aplicación → Dominio; organizar el proyecto por dominios funcionales
  (screaming architecture), no por tipo de componente técnico.
- **No debe:** importar frameworks web, ORMs o librerías de I/O en
  Dominio o Casos de Uso.
- **Por qué:** la regla de dependencia es el mecanismo de la arquitectura
  limpia — un import hacia afuera acopla silenciosamente la lógica de
  negocio a un detalle reemplazable.

### 2 — Las fronteras permanecen humildes

- **Debe:** mantener controladores, handlers CLI y consumidores limitados
  a recibir entrada, traducir DTOs e invocar casos de uso; usar DTOs
  planos para todo dato que cruce fronteras de casos de uso.
- **No debe:** devolver entidades de Dominio a infraestructura o
  controladores.
- **Por qué:** la lógica de negocio en código de entrega es intestable y
  ata el dominio al framework.

### 3 — Un nivel de abstracción por función

- **Debe:** aplicar SLAP; mantener funciones pequeñas (~≤20 líneas por
  defecto) con ≤3 argumentos — más se convierte en objeto de
  configuración; los nombres cargan la intención, sin comentarios que
  describen QUÉ hace el código.
- **No debe:** usar parámetros booleanos de bandera — dividir en métodos
  separados.
- **Por qué:** los niveles mezclados entierran el algoritmo bajo la
  mecánica, y un parámetro de bandera esconde dos comportamientos bajo
  un nombre.

### 4 — Los errores son tipados y explícitos

- **Debe:** propagar errores de dominio como valores tipados — enums de
  `thiserror` en Rust, `Result<T,E>`/uniones discriminadas en
  TypeScript, excepciones específicas de dominio/infra en Python;
  validar la entrada externa en la frontera (`unknown` + schema en TS,
  nunca `any`).
- **No debe:** `unwrap()`/`expect()` en rutas de producción, `except:`/
  `catch` vacíos que tragan, throws sin tipo.
- **Por qué:** una ruta de pánico o un catch silencioso convierte un
  fallo recuperable en un crash incontrolado o corrupción oculta de
  estado.

### 5 — Los idiomas del lenguaje cargan los invariantes

- **Debe (Rust):** newtype para primitivas con validación o semántica de
  dominio; ports de aplicación como traits; préstamo (`&str`, `&[T]`) en
  firmas en vez de `.clone()` forzado; nunca mantener un
  `std::sync::MutexGuard` a través de `.await`.
- **Debe (Python):** type hints estrictos en todas las funciones y
  métodos; `typing.Protocol` para abstracciones de port;
  `@dataclass(frozen=True)` o Pydantic frozen para value objects y DTOs;
  las entidades de dominio son clases puras — sin clases base ni
  decoradores de ORM.
- **Debe (TypeScript):** `readonly` en props de interfaces de dominio y
  `ReadonlyArray` para colecciones; interfaces de repositorio pequeñas y
  enfocadas, no monolíticas.
- **Por qué:** los idiomas son cómo la arquitectura sobrevive el contacto
  con el sistema de tipos — cada uno hace cumplir una regla que el
  compilador luego verifica.

### 6 — Solo modificación quirúrgica

- **Debe:** hacer ediciones acotadas — nunca reescribir un archivo
  completo cuando basta un cambio dirigido; enviar tests unitarios con
  estructura AAA junto a todo cambio de comportamiento.
- **Por qué:** las reescrituras totales destruyen revisabilidad e
  historia de blame, y un cambio sin tests no lleva evidencia registrada
  de comportamiento.

<!-- Referencias cruzadas: → ver references/clean-code-clean-architecture,
     commands/review-change, commands/simplify-code -->
