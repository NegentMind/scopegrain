# Procedencia y licenciamiento — Reglas

> **Ámbito:** atribución de fuentes, evidencia de licencia, permiso de
> redistribución, separación open-core/comercial (donde el proyecto usa ese
> modelo) e higiene de contenido de paquetes distribuibles.
> **No aquí:** mecánica de versiones/releases (`release-ci.md`), secretos
> en canales de runtime (`safety.md`), mecánica de pertenencia al workspace
> (`js-ecosystem.md`).
> **Estado:** Active
> **Fuentes:** registro de decisión del modelo open-core; investigación de
> modelos de licencia (trade-offs de núcleo permisivo frente a edición
> propietaria).

Estas reglas aplican donde existe un modelo de licenciamiento; no imponen
un modelo open-core, una edición privada, un registro ni un nombre de
paquete a un proyecto que no los tiene — los términos de distribución son
una decisión del owner (`→ see human-decisions.md`).

## Reglas

### 1 — El núcleo abierto conserva su licencia; las features exclusivas comerciales quedan fuera

- **Debe:** donde el proyecto usa un modelo open-core, mantener la licencia
  permisiva declarada del paquete núcleo y no añadir features diseñadas
  para ser exclusivas de una edición comercial.
- **No debe:** relicenciar el núcleo, ni sacar de él features existentes,
  sin una decisión humana explícita.
- **Por qué:** en un modelo open-core el foso defensivo son las features
  más la marca, no la licencia; extraer features del núcleo rompe la
  adopción y la confianza de los contribuidores.

### 2 — Una edición propietaria vive fuera del workspace abierto

- **Debe:** mantener todo paquete comercial o propietario en un repositorio
  o directorio separado que nunca aparezca en la lista de miembros, builds
  por defecto, empaquetado ni configuración de publicación del workspace
  abierto.
- **No debe:** empaquetar código propietario dentro del build, paquete o
  pipeline de publicación del paquete abierto.
- **Por qué:** el núcleo abierto no debe depender de código propietario ni
  arrastrarlo; un fallo ahí no puede permitirse bloquear el CI ni las
  releases del núcleo.

### 3 — Los entregables propietarios se distribuyen compilados, nunca como fuente — sin secretos en VCS

- **Debe:** entregar las ediciones comerciales como artefactos compilados a
  través de un registro privado o un canal de artefactos firmados.
- **No debe:** exponer fuente propietaria públicamente ni dentro del
  repositorio abierto, ni incrustar credenciales de registro ni secretos de
  firma de licencias en el control de versiones.
- **Por qué:** una licencia propietaria protege ingresos solo mientras la
  fuente permanece retenida y las credenciales fuera del historial.

### 4 — La validación de licencia es local y se aplica en todo tipo de build

- **Debe:** las features con puerta validan un artefacto de licencia
  (formato, expiración, límite de asientos/nodos) antes de habilitarse —
  sin servidor de licencias y sin call-home.
- **No debe:** relajar u omitir la validación en builds de release o
  producción.
- **Por qué:** la licencia declara el techo de uso; una verificación que
  depende del tipo de build no es verificación en absoluto.

### 5 — Preservar atribución y evidencia de licencia del material de terceros

- **Debe:** mantener registrados y verificables la fuente, la licencia y la
  atribución de cualquier contenido de terceros (código, datos,
  documentación, artefactos generados); pedir al owner que decida los
  términos de distribución y revise las obligaciones de terceros.
- **No debe:** inferir permiso de redistribución a partir de la
  disponibilidad local — la presencia en el workspace no es una licencia.
- **Por qué:** redistribuir sin términos verificados convierte un vacío de
  procedencia en una responsabilidad legal que solo aflora tras la
  publicación.

### 6 — Los paquetes distribuibles no llevan secretos ni historial privado

- **Debe:** auditar lo que entra en un paquete distribuible — secretos,
  credenciales y datos históricos privados quedan fuera
  (`→ see safety.md`).
- **No debe:** copiar secretos o datos históricos privados a un artefacto
  que sale del workspace.
- **Por qué:** un artefacto publicado es irrecuperable; el contenido
  incrustado en él es público para siempre.
