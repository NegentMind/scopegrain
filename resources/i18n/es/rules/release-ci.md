# Entrega y CI — Reglas

> **Ámbito:** procedimiento de release: configuración de build, aceleración
> de CI, manifiestos de empaquetado, sincronización de versiones, política
> de soft-fail y la cadena de puertas de aceptación a publicación.
> **No aquí:** mecánica de versión documentada dentro de docs de API
> (`api-contract.md` referencia aquí como canónica), fronteras generales de
> autorización (`safety.md`), modelos de licencia/distribución
> (`licensing-and-provenance.md`).
> **Estado:** Active
> **Fuentes:** auditorías de CI/release (deriva de pin de toolchain,
> manifiestos movidos rompiendo builds de imagen, inventario de soft-fail
> sin etiquetar, aceleración documentada que no existía); política de
> workflow de release.

Leer el procedimiento de release de este proyecto y la matriz de entornos
soportados antes de cambiar la configuración de entrega.

## Reglas

### 1 — Los builds de producción usan las opciones de build por plataforma documentadas

- **Debe:** los artefactos de release se construyen con las opciones
  ajustadas por plataforma que el proyecto documenta (p. ej., un allocador
  personalizado u optimizaciones específicas de target), seleccionadas por
  plataforma.
- **No debe:** entregar binarios de release con la configuración por
  defecto donde existe una opción de plataforma documentada; no activar una
  opción en una plataforma para la que no puede compilar.
- **Por qué:** para cargas de trabajo intensivas en memoria el default de
  plataforma causa fragmentación de heap y contención; las opciones
  ajustadas existen porque la medición las justificó — entregar defaults
  tira ese trabajo a la basura.

### 2 — La aceleración de CI compartida vive en un único paso de setup compartido

- **Debe:** mantener la aceleración de caché de build e instalación de
  herramientas en un único setup compartido o acción compuesta consumida
  por todos los jobs; toda capacidad de CI documentada debe existir
  realmente en los workflows.
- **No debe:** duplicar pasos de aceleración por workflow, reinstalar
  herramientas desde fuente donde existe una acción de instalación rápida,
  ni documentar aceleración de CI no implementada.
- **Por qué:** un único punto beneficia a cada job; la documentación que
  declara una capacidad inexistente ya ha costado tiempo real de depuración.

### 3 — Manifiestos de empaquetado: toolchain ≥ mínimo declarado, las rutas copiadas deben existir

- **Debe:** la versión del toolchain de build en manifiestos de contenedor
  y empaquetado es al menos la versión mínima de toolchain declarada del
  proyecto, y cada ruta de manifiesto copiada apunta a un directorio que
  existe en el repo.
- **No debe:** fijar un toolchain por debajo del mínimo declarado, ni
  copiar manifiestos de componentes que fueron movidos, renombrados o nunca
  existieron.
- **Por qué:** un solo pin obsoleto o directorio movido rompe todo el build
  de imagen; cualquier componente nuevo cuyo manifiesto se copia debe
  existir primero.

### 4 — Sincronización de versiones: docs, empaquetado y workflows toman la versión canónica

- **Debe:** docs de API, manifiestos de paquete y workflows de release
  declaran la misma versión que la fuente de versión canónica del proyecto
  — esta regla es el hogar canónico; `api-contract.md` apunta aquí.
- **No debe:** hardcodear versiones divergentes entre el docset o los
  archivos de empaquetado.
- **Por qué:** las auditorías han encontrado tres versiones distintas
  dentro de un docset más una cuarta en el empaquetado; los incrementos
  mecánicos siempre dejan literales atrás.

### 5 — Sin soft-fail en CI sin etiqueta de categoría y justificación

- **Debe:** todo paso continue-on-error o soft-fail equivalente lleva un
  comentario de categoría explícito (experimental / best-effort /
  non-critical / informational) según la política de CI del proyecto.
- **No debe:** añadir un nuevo soft-fail sin justificación, una etiqueta de
  categoría y — para tests flaky — un issue rastreado.
- **Por qué:** el soft-fail sin etiquetar oculta regresiones reales; el
  inventario clasificado es lo único que mantiene honestas las instancias
  existentes.

### 6 — Aceptación, commit, push, merge y publicación son puertas distintas

- **Debe:** tratar aceptación, commit local, push, merge y publicación como
  puntos de autorización separados — pasar uno nunca implica el siguiente
  (`→ see safety.md`).
- **No debe:** encadenar hacia push o publicación porque el commit fue
  permitido.
- **Por qué:** cada puerta tiene un radio de impacto distinto; un commit
  local es reversible, un push es visible, una publicación es efectivamente
  permanente.

### 7 — Sin cambios implícitos a tags, versiones, changelogs, registros o tooling de CI

- **Debe:** cambiar elementos de la superficie de release — tags, campos de
  versión, changelogs, destinos de registro, tooling de CI — solo mediante
  cambios explícitos y declarados.
- **No debe:** modificarlos como efecto lateral de otro trabajo.
- **Por qué:** los cambios en la superficie de release alteran qué se
  entrega y cómo se atribuye; las ediciones implícitas eluden cada puerta
  de release.

### 8 — Confirmar credenciales y autoridad para cada acción sin exponer secretos

- **Debe:** verificar que las credenciales existen y que la acción
  específica está autorizada antes de una operación de publicación o
  registro — referenciando las variables de secretos solo por nombre
  (`→ see safety.md`).
- **No debe:** mostrar, hacer eco ni registrar valores de credenciales, ni
  asumir que la presencia de una credencial implica permiso para toda
  acción.
- **Por qué:** una comprobación de presencia prueba que la variable existe,
  no que autoriza esta publicación; un valor expuesto queda comprometido
  permanentemente.

### 9 — Una release requiere un plan de recuperación factible; los efectos no verificados se reportan

- **Debe:** disponer de una ruta factible de rollback o recuperación antes
  de publicar, y reportar los efectos de despliegue que no pudieron
  verificarse en lugar de asumir el éxito (`→ see evidence.md`).
- **No debe:** declarar una release verificada cuando sus efectos
  post-publicación nunca fueron observados.
- **Por qué:** los fallos de publicación los descubren los consumidores;
  sin una ruta de recuperación la única corrección es una segunda release
  de emergencia.
