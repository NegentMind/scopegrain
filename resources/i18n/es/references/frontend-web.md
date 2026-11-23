# Evidencia de proyectos web

Identifica rutas, fronteras del framework, ejecución server/client, estado,
formularios, assets y semántica de accesibilidad antes de proponer cambios.
Usa las convenciones visuales establecidas y verifica el comportamiento
responsive. La revisión estática de código puede identificar riesgos pero no
puede establecer el rendimiento real de usuario ni la operación completa de
teclado/lector de pantalla.

Esta es la estructura de una referencia de frontend web. Registra las
decisiones de stack y convenciones reales del proyecto — el inventario
concreto siguiente es una plantilla, no la respuesta.

## Qué registrar

### Mapa de estructura

Anota el árbol real — un hecho por flecha:

```
web/
  src/
    app/            ← framework routes (note: server vs. client components)
    components/
      ui/           ← design-system primitives
      <domain>/     ← product-specific composite components
    hooks/          ← shared behavior hooks (focus trap, reveal, toast, …)
    lib/            ← dictionaries/i18n, utilities (class-merge helper, …)
  public/assets/    ← static media
```

### Tabla de decisiones de stack

| Decisión | Por qué se tomó |
|---|---|
| Framework + versión mayor | Modelo de router, estrategia de renderizado, modo de salida del build, cualquier compromiso estilo `ignoreBuildErrors` — registrado explícitamente |
| Biblioteca de componentes | Qué design system, qué preset de estilo, qué set de iconos |
| Estilos | Versión del framework CSS y dónde vive realmente el tema (tokens de tema en CSS vs. archivo de config — un archivo de config obsoleto es una trampa) |
| Animación | Qué biblioteca para transiciones de página, scroll reveal, count-up, gráficos interactivos |
| Gestión de estado | Qué store, y si realmente se usa o solo está instalado |

### Tokens del design system

- Colores: tokens nombrados con valores hex.
- Bordes/sombras: el tratamiento característico del proyecto (p. ej.
  sombras rígidas desplazadas), con las clases de utilidad exactas.
- Efectos/utilidades nombrados que el codebase ya define — reutilízalos en
  lugar de inventar otros paralelos.

### i18n

- Mecanismo: forma de provider/context + hook (estilo `{ t, lang, setLang }`),
  ubicación de diccionarios, conjunto de idiomas, número aproximado de claves.
- Callejones sin salida: bibliotecas i18n instaladas pero sin usar —
  regístralas para que un agente no cablee un segundo sistema i18n.

### Convenciones de animación

- Transiciones de página: el componente wrapper usado y dónde se monta.
- Scroll reveal: el wrapper + props de dirección/retardo.
- Gráficos especializados: qué biblioteca posee qué visual característico.

### Hechos de contenido que deben coincidir con la realidad

- Las versiones reales del stack que el sitio anuncia (mínimos de
  lenguaje/runtime).
- Integraciones/características reales nombradas en el copy — una
  afirmación de marketing que contradice el codebase es un bug.
- La versión real del producto mostrada.

## Verificación antes de proponer un cambio

- [ ] Qué rutas/páginas existen y cuáles renderizan en servidor vs. cliente.
- [ ] Qué convenciones visuales debe seguir la edición (tokens, efectos).
- [ ] Si el cambio debe ejercitarse en anchos móvil + escritorio y bajo
      reduced-motion.
- [ ] Si alguna afirmación del contenido del sitio depende de un hecho del
      stack que estás a punto de cambiar.

<!-- Cross-references: → see accessibility-checklist.md, performance-checklist.md, ocr-review.md -->
