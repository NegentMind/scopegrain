# Claridad y fronteras

Evalúa si los nombres revelan intención, las responsabilidades coheren, la
dirección de dependencias es deliberada y los efectos laterales son
explícitos. Los ejemplos y modismos del lenguaje importan más que umbrales
arbitrarios de líneas. Separa los riesgos conductuales, las consecuencias
de mantenibilidad y las preferencias. Un patrón de arquitectura solo es
útil cuando aborda las restricciones de este proyecto; una checklist por sí
sola no es evidencia de corrección.

Compendio de Clean Code (Martin, 2008/2025) y Clean Architecture
(Martin, 2017) adaptado para trabajo multi-lenguaje asistido por IA (Rust,
Python, TypeScript). Los límites numéricos como "≤20 líneas / ≤3 args" son
convención operativa, no citas literales — trátalos como defaults que el
proyecto puede re-ajustar, no como ley natural.

## 1. Fundamentos

El desarrollo de software sostenible es la contención sistemática de la
entropía del código. Los agentes sin restricciones eligen el camino de
menor resistencia local: acoplamiento difuso, niveles de abstracción
mezclados, lógica de negocio contaminada con infraestructura, acumulación
rápida de code smells.

### Axiomas clave

- **Boy Scout Rule**: quien toca un archivo lo deja más limpio de lo que lo
  encontró.
- **LeBlanc's Law**: "luego equivale a nunca" — la limpieza diferida se
  convierte en deuda técnica permanente.
- **KISS & DRY**: maximiza el trabajo no hecho; cada pieza de conocimiento
  tiene una única representación inequívoca.
- **Primacía del dominio sobre la infraestructura**: frameworks, bases de
  datos y UIs son mecanismos intercambiables; las reglas de negocio son
  primarias.
- **Hacer los estados inválidos irrepresentables**: diseña tipos de modo
  que los estados contradictorios fallen en tiempo de compilación/parseo.

| Dimensión | Ad-hoc / legacy | Clean architecture | Impacto en ciclo de vida |
|---|---|---|---|
| Curva de coste operativo | Exponencial por acumulación de deuda | Lineal y acotada | Viabilidad económica |
| Acoplamiento al entorno | Lógica de negocio soldada al framework/DB | Negocio aislado de las herramientas | Cambiar bibliotecas sin reescrituras |
| Testabilidad | Pruebas lentas que necesitan DB/servidores | Pruebas de dominio rápidas en memoria | Habilita CI |
| Velocidad de cambio | Frágil; cambios pequeños en cascada | Quirúrgico, blast radius pequeño | Frecuencia de entrega |

## 2. Micro-arquitectura: clean code políglota

### 2.1 Naming

- Los nombres revelan intención; no deben necesitar comentarios
  aclaratorios.
- Sin notación húngara ni tipos embebidos (`strName`, `iCounter`).
- Pronunciables, buscables en texto, alineados con el lenguaje ubicuo.
- **No añadas contexto gratuito (sin stuttering):** `account.address`
  no `account.accountAddress`; `store.get` no `store.storeGet`;
  `Error::Io` no `Error::IoError`. Excepciones legítimas: convenciones de
  framework (`ComponentProps`), alias de compatibilidad, namespaces de
  i18n, IDs de prueba jerárquicos, pseudo-elementos CSS.

| Lenguaje | vars/fns/métodos | tipos/clases/traits | constantes |
|---|---|---|---|
| Rust | `snake_case` | `PascalCase` | `SCREAMING_SNAKE_CASE` |
| Python | `snake_case` | `PascalCase` | `SCREAMING_SNAKE_CASE` |
| TypeScript | `camelCase` | `PascalCase` | `SCREAMING_SNAKE_CASE` |

### 2.2 Diseño de funciones y niveles de abstracción (SLAP)

- Una responsabilidad por función; un solo nivel de abstracción por cuerpo.
  Mezclar orquestación con formateo de strings o llamadas de socket en un
  mismo cuerpo está prohibido.
- Aridad: 0–1–2 args ideal; 3 necesita justificación; ≥4 → pasa un objeto
  de config inmutable o un Builder.
- **Sin argumentos flag**: un booleano que conmuta comportamiento interno
  demuestra que la función hace dos cosas — divídela.
- Convención: las funciones se mantienen lo bastante cortas para leerse de
  un vistazo (default ≤ ~20 líneas); juicio sobre el número.

### 2.3 Manejo de errores

| Lenguaje | Reglas |
|---|---|
| Rust | Sin `unwrap()`/`expect()` en código de producción (excepto invariantes imposibles documentados). `Result<T, E>` + propagación con `?`. Errores de dominio como enums tipados (`thiserror` en libs, `anyhow` en binarios). |
| Python | Excepciones personalizadas explícitas heredando de una base `DomainException`. Sin `except Exception:` silenciosos ni `except:` pelados. Captura solo en la capa que traduce a respuestas/DTOs de infraestructura. |
| TypeScript | Prefiere uniones discriminadas o un `Result<T, E>` explícito sobre throws descontrolados para operaciones de dominio. Si se usan excepciones, subclases de `Error` personalizadas capturadas en adaptadores de interfaz. |

### 2.4 Comentarios

Un comentario es a menudo un fallo al expresar la intención en el código.
Permitidos: decisiones de diseño no obvias, avisos de consecuencia de
rendimiento, docs formales de API pública. Elimina: narración redundante,
código comentado, comentarios de cierre de bloque.

### 2.5 Catálogo de code smells

| ID | Smell | Manifestación | Corrección | Impacto |
|---|---|---|---|---|
| G1 | **Rigidez** | Un cambio de requisito cascades por muchos módulos | Desacoplar vía DIP e interfaces/traits | Menor coste de mantenimiento |
| G2 | **Fragilidad** | Un cambio rompe partes no relacionadas sin aviso | Encapsular conceptos volátiles; eliminar deps implícitas | Estabilidad, menos regresiones |
| G3 | **Inmovilidad** | El módulo no se puede reutilizar — soldado a su entorno | Extraer la lógica de negocio pura de las libs de infra | Reuso entre apps |
| G4 | **Opacidad** | Alta carga cognitiva para leer | Renombrar, acortar funciones, aplicar SLAP | Onboarding más fácil (humano e IA) |
| G5 | **Feature envy** | Un método toca los datos de otro objeto más que los propios | Mover el método al dueño de los datos | Cohesión, encapsulación |
| G6 | **Train wreck** | `a.getB().getC().getD().execute()` | Law of Demeter: habla solo con colaboradores directos | Acoplamiento superficial |
| G7 | **Primitive obsession** | `string`/`int` usados para conceptos validados | Value Objects (Newtype / frozen dataclass / branded types) | Validación centralizada |

## 3. Modismos por lenguaje

### Rust

1. **Patrón Newtype**: envuelve primitivas en structs de un campo para
   seguridad en tiempo de compilación contra la primitive obsession.
2. **Patrón Typestate**: codifica el estado del objeto + transiciones
   válidas en el sistema de tipos para que las llamadas inválidas no
   compilen.
3. **Borrow sobre clone**: las firmas toman `&str`, `&[T]`, `&Path` en
   lugar de exigir `String`, `Vec<T>`, `PathBuf`; `.clone()` solo como
   decisión de diseño documentada.
4. **Gobernanza async**: NUNCA mantener un guard de `std::sync::Mutex` a
   través de `.await`; NUNCA ejecutar trabajo bloqueante/de CPU intensiva
   en el ejecutor async — delega a `spawn_blocking`.

### Python

1. **Type hints estrictos**: 100% del código de producción tipado (`Self`,
   `Unpack`, `Literal`, `Callable`, `Generic`); verificado bajo
   mypy/pyright strict.
2. **`typing.Protocol` sobre ABCs** para contratos de puertos — acoplamiento
   laxo sin herencia rígida.
3. **Inmutabilidad**: `@dataclass(frozen=True)` o modelos Pydantic frozen
   para Value Objects y DTOs de frontera.
4. **Sin globales mutables a nivel módulo / singletons mutables**; la
   config se inyecta por constructores.

### TypeScript

1. **Sin `any`**. Usa `unknown` para valores externos y valida en la
   frontera con una biblioteca de esquemas (clase Zod/Valibot).
2. **Uniones discriminadas** para estados y resultados falibles
   (`{ status: 'success'; data: T } | { status: 'error'; message: string }`).
3. **Inmutable por defecto**: props `readonly`, `ReadonlyArray<T>` para
   colecciones de dominio.
4. **Interfaces pequeñas compuestas** sobre monolíticas; las clases de
   infra implementan solo lo que cada caso de uso necesita.

## 4. SOLID y gobernanza de componentes

### SOLID

1. **SRP** — una razón para cambiar por módulo; sirve a un actor de negocio.
2. **OCP** — abierto a extensión (nuevas implementaciones de contratos),
   cerrado a modificación (no editar código probado).
3. **LSP** — implementaciones sustituibles por sus abstracciones; no
   debilitar postcondiciones ni fortalecer precondiciones.
4. **ISP** — ningún cliente forzado a depender de métodos que no usa;
   interfaces pequeñas especializadas.
5. **DIP** — los módulos de alto y bajo nivel dependen ambos de
   abstracciones; los detalles dependen de abstracciones, no viceversa.

### Cohesión de componentes

- **REP** — el grano de reuso = el grano de release; las clases agrupadas
  se publican juntas bajo una versión.
- **CCP** — las clases que cambian por la misma razón viven en el mismo
  componente (SRP a nivel de paquete).
- **CRP** — las clases que no se reutilizan juntas no comparten paquete
  (ISP a nivel de paquete).

### Acoplamiento de componentes

- **ADP** — el grafo de dependencias es acíclico (un DAG).
- **SDP** — las dependencias apuntan hacia la estabilidad; depende solo de
  componentes más estables.
- **SAP** — un componente es tan abstracto como estable; los componentes
  estables de alto nivel descansan sobre abstracciones para
  extensibilidad.

### Métricas cuantitativas

- **Ca** (acoplamiento aferente): externos que dependen de este módulo — su
  responsabilidad.
- **Ce** (acoplamiento eferente): externos que este módulo usa — su
  vulnerabilidad.
- **Inestabilidad**: `I = Ce / (Ca + Ce)` — `0` maximalmente estable, `1`
  totalmente inestable.
- **Abstracción**: `A = Na / Nc` — abstracciones sobre el total de tipos.
- **Distancia a la main sequence**: `D = |A + I - 1|` — `≈0` es equilibrado.

| Zona | (I, A) | Diagnóstico | Mantenibilidad |
|---|---|---|---|
| Zone of pain | `I≈0, A≈0` | Concreto pero del que se depende — difícil de extender | Rigidez crítica (típico: legacy pesado en esquemas sin interfaces) |
| Zone of uselessness | `I≈1, A≈1` | Abstracto, sin dependientes | Abstracciones muertas que no aportan valor |
| Main sequence | `D≈0` | Equilibrio abstracción/estabilidad | Evolución segura, reuso |

## 5. Clean Architecture (macro)

### Regla de dependencias

**Las dependencias de la fuente apuntan solo hacia dentro, hacia la
política de más alto nivel.** Los círculos internos no pueden conocer,
importar ni nombrar nada declarado en círculos externos.

### Capas

| Capa | Nivel | Tipos de componente | Depende de | Responsabilidad |
|---|---|---|---|---|
| 1. Entities | Centro / más alto | Entidades de dominio, value objects, servicios de dominio | Nada | Reglas de negocio globales; sin framework, UI, ORM ni DB |
| 2. Use cases | Medio-alto | Interactors, puertos de entrada/salida, DTOs de app | Solo entities | Orquestar el flujo de datos para satisfacer requisitos |
| 3. Interface adapters | Medio-bajo | Controllers, presenters, mappers, repos concretos | Use cases + entities | Traducir entre el formato de la app y los agentes externos |
| 4. Frameworks & drivers | Exterior / más bajo | DB, web framework, UI, SDKs de terceros, CLI | Adapters | Infraestructura técnica, detalles de I/O |

### Screaming architecture

Organiza las carpetas por **dominio funcional**, no por capa técnica. Forma
idiomática por lenguaje:

```
src/<domain>/            # e.g. identity/, ordering/, billing/
  domain/                # entities, value objects, domain errors
  application/           # use cases + ports (traits / Protocols / interfaces)
  infrastructure/        # repos, HTTP/CLI controllers, ORM adapters
```

Si el árbol real es plano por módulo técnico mientras la forma pretendida
está orientada a dominio, regístralo explícitamente — audita la **dirección
de dependencias**, no la forma de carpetas, y no reorganices sin un
registro de decisión aprobado.

### Humble Object + DTOs de frontera

Los módulos de frontera (controllers HTTP, consumidores de mensajes,
entrypoints de CLI) se mantienen "humble": reciben, traducen a DTOs,
invocan un caso de uso — cero lógica de negocio. Los datos cruzan las
fronteras solo vía DTOs planos o primitivas. **Las entidades ORM, los
modelos de estado de DB y los decoradores de framework nunca entran en
Application ni en Domain.**

## 6. Forma desarrollada (código bueno)

El patrón, condensado — entidad de dominio que aplica invariantes,
abstracción de puerto, caso de uso orquestando:

```rust
// domain/: entity + typed errors + validated value object
#[derive(Error, Debug)]
pub enum DomainError { InsufficientFunds { avail: f64, req: f64 }, InvalidAmount }

pub struct Money(f64);
impl Money {
    pub fn new(v: f64) -> Result<Self, DomainError> {
        if v <= 0.0 { Err(DomainError::InvalidAmount) } else { Ok(Self(v)) }
    }
}
pub struct Account { id: u64, balance: Money }
impl Account {
    pub fn withdraw(&mut self, amt: &Money) -> Result<(), DomainError> { /* invariant check, mutate, Ok */ }
}

// application/: port + use case (no sqlx, no HTTP)
pub trait AccountRepository: Send + Sync {
    fn find_by_id(&self, id: u64) -> Result<Option<Account>, RepoError>;
    fn save(&self, a: &Account) -> Result<(), RepoError>;
}
// AppError: From<DomainError> + From<RepoError> — errors translate at the boundary
pub struct ProcessPayment { repo: Box<dyn AccountRepository> }
impl ProcessPayment {
    pub fn execute(&self, id: u64, raw: f64) -> Result<(), AppError> {
        let amt = Money::new(raw)?;               // boundary validation
        let mut acct = self.repo.find_by_id(id)?.ok_or(AppError::NotFound)?;
        acct.withdraw(&amt)?;                      // domain rule
        Ok(self.repo.save(&acct)?)
    }
}
```

```python
# domain: frozen dataclasses + DomainException hierarchy
@dataclass(frozen=True)
class Email:
    value: str
    def __post_init__(self): ...  # raise InvalidEmailException on bad format

# application: Protocol port + use case
class UserRepository(Protocol):
    def find_by_email(self, email: Email) -> Optional[User]: ...
    def save(self, user: User) -> User: ...

class RegisterUser:
    def __init__(self, repo: UserRepository): self._repo = repo
    def execute(self, cmd: RegisterUserCommand) -> User:
        email = Email(cmd.email)                    # raises on invalid
        if self._repo.find_by_email(email): raise UserAlreadyExistsException(...)
        return self._repo.save(User(user_id=None, email=email))
```

```typescript
// domain: readonly entity + Money value object
class Money { private constructor(readonly amount: number) {}
  static create(v: number): Money { if (v <= 0) throw new Error("positive only"); return new Money(v); } }

// application: small port + Result-returning use case
interface ProductRepo { save(p: Product): Promise<void>; }
type Result<T, E> = { isOk: true; value: T } | { isOk: false; error: E };

class CreateProduct {
  constructor(private repo: ProductRepo) {}
  async execute(dto: CreateProductDTO): Promise<Result<Product, string>> {
    try {
      const p = new Product(dto.id, dto.name, Money.create(dto.price));
      await this.repo.save(p);
      return { isOk: true, value: p };
    } catch (e) { return { isOk: false, error: String(e) }; }
  }
}
```

Contraste de anti-patrón (lo que estos reemplazan): tipos ORM/HTTP dentro
de route handlers, cuerpos de petición tipados `any`,
`unwrap()`/`panic!` en rutas de producción, SQL concatenado por strings,
argumentos flag, reglas de negocio viviendo en controllers.

## 7. Testing y TDD

### Las tres leyes del TDD

1. Ningún código de producción excepto para hacer pasar una prueba que
   falla.
2. No más código de prueba del necesario para fallar (los errores de
   compilación cuentan como fallos).
3. No más código de producción del necesario para pasar la prueba actual.

### F.I.R.S.T.

- **Fast** — milisegundos, ejecutables constantemente.
- **Independent** — sin estado ni orden entre pruebas.
- **Repeatable** — resultados idénticos en cualquier entorno.
- **Self-validating** — pass/fail booleano, sin inspección manual de logs.
- **Timely** — escritas justo antes del código de producción.

### Arrange-Act-Assert + test doubles por lenguaje

| Lenguaje | Estructura | Doubles |
|---|---|---|
| Rust | Módulo `#[cfg(test)]` dentro del archivo | doubles generados estilo mockall desde traits |
| Python | pytest + fixtures inmutables | pytest-mock para aislamiento |
| TypeScript | Vitest/Jest | fakes en memoria de puertos de repositorio sobre mocks dinámicos |

## 8. Matriz de gobernanza

| Regla de ingeniería | Anti-patrón prevenido | Ejemplo de implementación | Efecto garantizado |
|---|---|---|---|
| Aislamiento de dominio | Imports de ORM/web framework dentro de entities | Entities como structs/clases puros, sin decoradores de terceros | Independencia de infra, portabilidad del núcleo |
| Separación SLAP | Llamadas SQL/HTTP mezcladas con cálculo | Persistencia en repositorios, reglas en entities | Pruebas unitarias en memoria sin I/O |
| Puertos e interfaces | Clientes DB/HTTP instanciados dentro de casos de uso | Abstracciones inyectadas por constructor | Proveedores intercambiables vía IoC |
| Inmutabilidad de value objects | Mutación directa de emails/importes/IDs | Nueva instancia inmutable por cambio | Sin efectos laterales descontrolados |
| DTOs en las fronteras | Modelos ORM devueltos a controllers/UI | Conversión a DTO explícita en la capa de adaptadores | Sin fuga de detalles de DB hacia fuera |

## 9. Directivas inyectables para agentes

Líneas imperativas aptas para un archivo de instrucciones de agente
(AGENTS.md / archivo de rules / system prompt). La redacción MUST/NEVER es
deliberada.

### Todos los lenguajes

```
CLEAN ARCHITECTURE & CLEAN CODE — MANDATORY RULES
1. ARCHITECTURE & DEPENDENCIES
* Organize the project by functional domains (screaming architecture),
  not technical components.
* Dependencies point inward only: Infrastructure → Adapters → Application → Domain.
* NEVER import web frameworks, ORMs or I/O libraries into Domain or Use Cases.
* Boundary objects are Humble: controllers/CLI/consumers only receive,
  translate DTOs and invoke use cases.
2. MICRO-ARCHITECTURE
* Apply SLAP: one abstraction level per function.
* Keep functions small (~≤20 lines default) and ≤3 arguments; more → config object.
* NEVER use boolean flag parameters; split into separate methods.
* No comments describing WHAT code does; names carry intent.
3. BOUNDARIES & DTOs
* Flat DTOs for all data crossing use-case boundaries.
* NEVER return Domain entities to infrastructure or controllers.
4. MODIFICATION
* Surgical edits only; never rewrite a whole file when a bounded edit suffices.
* Every change ships with AAA-structured unit tests.
```

### Rust

```
* Newtype for primitives carrying validation or domain semantics.
* Domain errors: typed enums via thiserror; never String/Box<dyn Error> in Domain.
* NEVER unwrap()/expect() in production; propagate with ?.
* Application ports as traits (async_trait or native).
* Borrow (&str, &[T]) in signatures; avoid forced .clone().
* NEVER hold a std::sync::MutexGuard across .await.
```

### Python

```
* 100% strict type hints on all functions/methods.
* typing.Protocol for port abstractions; no forced inheritance.
* @dataclass(frozen=True) or frozen Pydantic for Value Objects/DTOs.
* NEVER bare/passive except Exception: — catch specific domain/infra exceptions only.
* Domain entities are pure classes: no ORM base classes or decorators.
```

### TypeScript

```
* NEVER use any; external input is unknown + schema-validated at the boundary.
* readonly on domain interface props; ReadonlyArray for collections.
* Discriminated unions / Result<T,E> for fallible domain operations.
* Small focused repository interfaces, not monolithic ones.
```

## 10. Escala de severidad de auditoría

Al auditar un codebase contra este compendio:

- **🔴 Blocker**: dependencia hacia fuera (dominio importando
  infraestructura), constructos de panic-path en producción (`unwrap()`,
  throw sin manejar), `any`, catch vacío, guard de lock a través de
  `.await`, SQL/ORM dentro de una entity.
- **🟡 Debt**: función demasiado larga, >3 args sin justificación,
  booleano flag, nombres con stuttering, primitive obsession sin Value
  Object, comentario redundante, DTO ausente en una frontera.
- **🟢 Suggestion**: micro-naming, orden vertical, cosmética de guía de
  estilo.

La deuda 🔴/🟡 nueva introducida por un cambio debería pagarse en el mismo
cambio — deuda neta por cambio ≤ 0 (Boy Scout aplicado al PR, no solo al
archivo).

## 11. Comprobaciones cruzadas al auditar

- [ ] Compara la arquitectura documentada con el grafo de imports/build —
      una frontera que nada aplica es una propuesta.
- [ ] Separa los hallazgos en: riesgo conductual, consecuencia de
      mantenibilidad, preferencia. No reportes preferencias como defectos.
- [ ] Verifica un smell contra rutas de código reales antes de reportarlo
      (Regla 0: análisis de impacto antes de señalar).
- [ ] Existen excepciones idiomáticas (convenciones de framework, alias de
      compatibilidad) — revisa la lista de excepciones del proyecto antes
      de señalar nombres.

<!-- Cross-references: → see architecture.md, definition-of-done.md, quality-floor.md, testing-patterns.md -->
