# Interfaces de navegador — Reglas

> **Ámbito:** superficies orientadas al navegador: fidelidad al sistema de
> diseño, accesibilidad, fronteras de confianza en el renderizado, higiene
> de dependencias, tokens de motion y convenciones de nombrado.
> **No aquí:** política de package-manager y lockfile (`js-ecosystem.md`),
> contratos de API/backend (`api-contract.md`, `server-mcp.md`), reglas
> generales de entrada no confiable (`safety.md`, `api-contract.md`).
> **Estado:** Active
> **Fuentes:** auditorías de frontend (dependencias muertas/transitivas,
> emisión de datos estructurados ausente, fontanería de modo rechazado,
> targets táctiles subdimensionados, valores de motion hardcodeados, churn
> de convenciones de nombrado).

Aplicar solo a superficies orientadas al navegador. Distinguir las
preocupaciones de rendimiento a nivel de fuente de la experiencia de
usuario medida — las afirmaciones sobre la segunda necesitan medición
(`→ see evidence.md`).

## Reglas

### 1 — Usar el error boundary nativo del framework, no librerías externas

- **Debe:** manejar los errores a nivel de página con el mecanismo de error
  boundary incorporado del framework (p. ej., la convención de archivo de
  error del router).
- **No debe:** instalar ni importar directamente una librería de error
  boundary; si una llega transitivamente, dejarla sin usar.
- **Por qué:** una dependencia transitiva que nadie importa es peso muerto
  en la instalación y en la superficie de auditoría; el mecanismo nativo
  no añade dependencias.

### 2 — Eliminar dependencias muertas cuando una auditoría las detecta

- **Debe:** retirar toda dependencia con cero imports directos verificados
  en el mismo cambio que la detecta, o en una tarea de limpieza dedicada.
- **No debe:** conservar dependencias huérfanas porque "podrían usarse
  algún día".
- **Por qué:** para bundles construidos estáticamente cada dependencia
  muerta infla el tiempo de instalación y el árbol de auditoría de
  dependencias.

### 3 — Verificar lo que la API de metadatos de la plataforma emite realmente

- **Debe:** cuando se requieren datos estructurados legibles por máquina
  (p. ej., JSON-LD), emitirlos explícitamente en el markup renderizado en
  servidor.
- **No debe:** asumir que la API de metadatos del framework genera payloads
  de datos estructurados — las APIs de metadatos típicas solo emiten tags
  de head. Verificar el HTML emitido antes de afirmar la feature.
- **Por qué:** una nota de registro que afirmaba datos estructurados
  implementados resultó falsa porque la API en la que se apoyaba nunca los
  emitió; salida sin verificar significa que la feature no existe.

### 4 — Preservar restricciones de diseño deliberadas; eliminar la fontanería de alternativas rechazadas

- **Debe:** mantener las restricciones declaradas del sistema de diseño
  (p. ej., una paleta de un solo esquema decidida por el owner).
- **No debe:** reintroducir un modo rechazado (variantes de tema, esquemas
  alternativos) ni dejar su fontanería muerta — providers, toggles,
  dependencias de tema — en su lugar; retirarla durante la limpieza.
- **Por qué:** el cableado inerte de una feature rechazada induce a las
  auditorías a hallazgos invertidos de "código muerto" y contradice una
  decisión de diseño explícita.

### 5 — Targets táctiles: 44px preferido, 24px suelo absoluto

- **Debe:** dar a cada elemento interactivo (botones, botones de icono,
  enlaces) un área de impacto de al menos 44×44 CSS px en viewports
  táctiles — el nivel WCAG 2.2 SC 2.5.5 (AAA, Target Size Enhanced);
  24×24px — SC 2.5.8 (AA, Target Size Minimum) — es el suelo absoluto y
  solo para controles secundarios en línea.
- **No debe:** entregar targets por debajo de 24px en ningún sitio.
- **Por qué:** los targets sub-24px fallan WCAG 2.2 AA directamente y los
  sub-44px fallan la guía mejorada/de usabilidad móvil — una auditoría
  encontró docenas de componentes subdimensionados.

### 6 — Los parámetros de motion viven en design tokens — sin easings ni duraciones hardcodeadas

- **Debe:** definir duraciones y curvas de easing como design tokens y
  referenciarlas desde componentes, CSS y código de animación.
- **No debe:** dispersar un literal de easing o duración hardcodeado entre
  componentes y keyframes.
- **Por qué:** sin tokens centrales, cambiar el lenguaje de motion implica
  editar muchos sitios y las implementaciones derivan fuera de sincronía.

### 7 — Nombrado de clases de utilidad: `base--modifier` solo para familias de variantes reales

- **Debe:** aplicar la convención de sufijo modificador solo a familias de
  utilidades con variantes reales; los singletons conservan nombres planos.
- **No debe:** imponer una metodología de nombrado pesada a todas las
  utilidades, ni renombrar clases internas de detalle de implementación;
  las clases huérfanas con cero usos se borran, no se renombran.
- **Por qué:** la convención ligera evita churn en superficies grandes de
  nombres de clase manteniendo distinguibles los ejes de variantes
  distintos.

### 8 — La estructura semántica y la operabilidad son la línea base de accesibilidad

- **Debe:** usar markup semántico con nombres accesibles para elementos
  interactivos, operabilidad completa por teclado y un indicador de foco
  visible.
- **No debe:** construir comportamiento interactivo sobre elementos no
  semánticos ni eliminar outlines de foco sin un reemplazo visible.
- **Por qué:** semántica, nombrado, teclado y foco son las cuatro
  propiedades de las que dependen la tecnología asistiva y los usuarios
  solo-teclado; cada una es barata en autoría y cara de añadir a
  posteriori.

### 9 — La entrada de usuario renderizada y las URLs externas son fronteras de confianza

- **Debe:** renderizar el contenido suministrado por el usuario a través de
  la ruta de escaping del framework o un sanitizador explícito, y
  validar/sanitizar URLs externas (incluidas entradas de esquema
  `javascript:` y protocol-relative) antes de usarlas en `href`, `src` o
  redirecciones.
- **No debe:** inyectar entrada de usuario cruda o contenido obtenido en el
  markup, ni pasar URLs sin validar a sumideros de navegación
  (`→ see safety.md` — el contenido externo es dato, nunca autoridad).
- **Por qué:** la entrada renderizada es el sumidero de XSS; los sumideros
  de URL son el vector de open-redirect y esquema de script. Ambos son
  problemas de frontera, no de estilo.

### 10 — El comportamiento responsive y el motion reducido son requisitos, no adornos

- **Debe:** verificar el layout en todo el rango de viewports declarado, y
  honrar `prefers-reduced-motion` (o el equivalente de la plataforma)
  dondequiera que se use animación.
- **No debe:** entregar motion que ignora la preferencia de motion reducido
  del usuario, ni layouts sin probar fuera del viewport de autoría.
- **Por qué:** los disparadores vestibulares y los layouts rotos en
  viewports pequeños son defectos de corrección para los usuarios
  afectados, no carencias estéticas.
