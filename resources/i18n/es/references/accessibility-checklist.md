# Interacción accesible

Las comprobaciones relevantes incluyen semántica, nombres accesibles,
operación por teclado, orden/visibilidad del foco, contraste, reflujo,
reduced motion y feedback de errores. Las comprobaciones automatizadas no
establecen conformidad completa. Declara qué se ejercitó y qué requiere un
usuario o tecnología asistiva. No etiquetes un criterio no probado como
aprobado.

Referencia rápida para revisión a nivel **WCAG 2.2 AA** (WCAG 2.2 es la
Recomendación W3C vigente; WCAG 3.0 sigue siendo un borrador de trabajo).
Los ítems de la checklist son verificables; el tooling automatizado solo
cubre un subconjunto — las comprobaciones de teclado, lector de pantalla y
zoom requieren ejercicio manual.

## Tabla de contenidos

- [Comprobaciones esenciales](#comprobaciones-esenciales)
- [Adiciones de WCAG 2.2 AA](#adiciones-de-wcag-22-aa)
- [Patrones HTML comunes](#patrones-html-comunes)
- [Herramientas de prueba](#herramientas-de-prueba)
- [Referencia rápida: regiones ARIA Live](#referencia-rápida-regiones-aria-live)
- [Anti-patrones comunes](#anti-patrones-comunes)

## Comprobaciones esenciales

### Navegación por teclado
- [ ] Todos los elementos interactivos enfocables vía tecla Tab
- [ ] El orden de foco sigue el orden visual/lógico
- [ ] El foco es visible (outline/ring en elementos enfocados)
- [ ] Los widgets personalizados tienen soporte de teclado (Enter para activar, Escape para cerrar)
- [ ] Sin trampas de teclado (el usuario siempre puede salir de un componente con Tab)
- [ ] Enlace skip-to-content al inicio de la página — visible (al menos) al enfocar por teclado
- [ ] Los modales atrapan el foco mientras están abiertos, devuelven el foco al cerrarse

### Lectores de pantalla
- [ ] Todas las imágenes tienen texto `alt` (o `alt=""` para imágenes decorativas)
- [ ] Todos los inputs de formulario tienen etiquetas asociadas (`<label>` o `aria-label`)
- [ ] Botones y enlaces tienen texto descriptivo (no "Click aquí")
- [ ] Los botones de solo icono tienen `aria-label`
- [ ] La página tiene un `<h1>` y los encabezados no saltan niveles
- [ ] Los cambios de contenido dinámico se anuncian (regiones `aria-live`)
- [ ] Las tablas tienen cabeceras `<th>` con scope

### Visual
- [ ] Contraste de texto ≥ 4.5:1 (texto normal) o ≥ 3:1 (texto grande, 18px+)
- [ ] Contraste de componentes de UI ≥ 3:1 contra el fondo
- [ ] El color no es la única forma de transmitir información
- [ ] Texto redimensionable al 200% sin romper el layout
- [ ] Sin contenido que destelle más de 3 veces por segundo

### Formularios
- [ ] Cada input tiene una etiqueta visible
- [ ] Campos obligatorios indicados (no solo por color)
- [ ] Mensajes de error específicos y asociados al campo
- [ ] Estado de error visible por más que el color (icono, texto, borde)
- [ ] Errores de envío de formulario resumidos y enfocables
- [ ] Los campos conocidos usan autocomplete (por ejemplo `type="email" autocomplete="email"`)

### Contenido
- [ ] Idioma declarado (`<html lang="en">`)
- [ ] La página tiene un `<title>` descriptivo
- [ ] Enlaces distinguibles del texto circundante (no solo por color)
- [ ] Objetivos táctiles ≥ 44x44px en móvil (buena práctica; el suelo de
      WCAG 2.2 AA es SC 2.5.8: ≥24×24 CSS px o espaciado suficiente entre
      objetivos)
- [ ] Estados vacíos con significado (no pantallas en blanco)

## Adiciones de WCAG 2.2 AA

Criterios de éxito introducidos en AA por WCAG 2.2 que las checklists
antiguas no cubren:

- [ ] SC 2.4.11 Focus Not Obscured — el elemento enfocado no queda
      completamente oculto por cabeceras sticky, banners u overlays
- [ ] SC 2.5.7 Dragging Movements — cualquier acción de arrastre tiene una
      alternativa de puntero único (un botón o control que logra el mismo
      resultado)
- [ ] SC 3.2.6 Consistent Help — los mecanismos de ayuda/contacto aparecen
      en el mismo orden relativo en cada página que los tiene
- [ ] SC 3.3.7 Redundant Entry — los datos ya introducidos no se vuelven a
      pedir en la misma sesión (auto-rellenados o seleccionables)
- [ ] SC 3.3.8 Accessible Authentication — el login no requiere una prueba
      de función cognitiva (puzzle, transcripción) salvo que se ofrezca una
      alternativa, un mecanismo (soporte de gestor de contraseñas, pegado
      permitido) o reconocimiento de objetos/contenido personal

## Patrones HTML comunes

### Botones vs. enlaces

```html
<!-- Use <button> for actions -->
<button onClick={handleDelete}>Delete Task</button>

<!-- Use <a> for navigation -->
<a href="/tasks/123">View Task</a>

<!-- NEVER use div/span as buttons -->
<div onClick={handleDelete}>Delete</div>  <!-- BAD -->
```

### Etiquetas de formulario

```html
<!-- Explicit label association -->
<label htmlFor="email">Email address</label>
<input id="email" type="email" required />

<!-- Implicit wrapping -->
<label>
  Email address
  <input type="email" required />
</label>

<!-- Hidden label (visible label preferred) -->
<input type="search" aria-label="Search tasks" />
```

### Roles ARIA

```html
<!-- Navigation -->
<nav aria-label="Main navigation">...</nav>
<nav aria-label="Footer links">...</nav>

<!-- Status messages -->
<div role="status" aria-live="polite">Task saved</div>

<!-- Alert messages -->
<div role="alert">Error: Title is required</div>

<!-- Modal dialogs -->
<dialog aria-modal="true" aria-labelledby="dialog-title">
  <h2 id="dialog-title">Confirm Delete</h2>
  ...
</dialog>

<!-- Loading states -->
<div aria-busy="true" aria-label="Loading tasks">
  <Spinner />
</div>
```

### Listas accesibles

```html
<ul role="list" aria-label="Tasks">
  <li>
    <input type="checkbox" id="task-1" aria-label="Complete: Buy groceries" />
    <label htmlFor="task-1">Buy groceries</label>
  </li>
</ul>
```

## Herramientas de prueba

```bash
# Automated audit
npx @axe-core/cli <url>  # Programmatic accessibility testing (axe CLI)
npx pa11y <url>          # CLI accessibility checker

# In browser
# Chrome DevTools → Lighthouse → Accessibility
# Chrome DevTools → Elements → Accessibility tree

# Screen reader testing
# macOS: VoiceOver (Cmd + F5)
# Windows: NVDA (free) or JAWS
# Linux: Orca
```

Las herramientas automatizadas detectan aproximadamente un tercio de los
problemas de WCAG; no pueden verificar la sensatez del orden de foco, la
calidad significativa del texto alt ni la comprensibilidad por lector de
pantalla. Registra qué fue automatizado vs. ejercitado manualmente.

## Referencia rápida: regiones ARIA Live

| Valor | Comportamiento | Uso |
|-------|----------|---------|
| `aria-live="polite"` | Anunciado en la próxima pausa | Actualizaciones de estado, confirmaciones de guardado |
| `aria-live="assertive"` | Anunciado inmediatamente | Errores, alertas sensibles al tiempo |
| `role="status"` | Igual que `polite` | Mensajes de estado |
| `role="alert"` | Igual que `assertive` | Mensajes de error |

## Anti-patrones comunes

| Anti-patrón | Problema | Corrección |
|---|---|---|
| `div` como botón | No enfocable, sin soporte de teclado | Usa `<button>` |
| Texto `alt` ausente | Imágenes invisibles para lectores de pantalla | Añade `alt` descriptivo |
| Estados solo por color | Invisibles para usuarios daltónicos | Añade iconos, texto o patrones |
| Media con autoplay | Desorienta, no se puede detener | Añade controles, no uses autoplay |
| Dropdown personalizado sin ARIA | Inutilizable por teclado/lector de pantalla | Usa `<select>` nativo o un listbox ARIA correcto |
| Eliminar outlines de foco | Los usuarios no ven dónde están | Estiliza los outlines, no los elimines |
| Enlaces/botones vacíos | "Enlace" anunciado sin descripción | Añade texto o `aria-label` |
| `tabindex > 0` | Rompe el orden natural de tabulación | Usa solo `tabindex="0"` o `-1` |

<!-- Cross-references: → see frontend-web.md, performance-checklist.md, ocr-review.md -->
