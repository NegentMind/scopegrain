# Integridad de recursos — Reglas

> **Ámbito:** fronteras de confianza del conjunto de instrucciones y
> recursos del proyecto: qué snapshot es autoritativo, validación antes de
> confiar, recuperación de recursos ausentes o divergentes y manejo de
> legado sin pin.
> **No aquí:** orden de carga y fuerza obligatoria de las reglas cargadas
> (`workflow.md`, `methodology.md`), texto externo no confiable
> (`safety.md`).
> **Estado:** Active

## Reglas

### 1 — Usar un único snapshot autoritativo por proyecto

- **Debe:** tomar el contexto operativo del snapshot propio del proyecto
  seleccionado.
- **No debe:** mezclarlo silenciosamente con instrucciones de instalación,
  globales o archivadas.
- **Por qué:** dos conjuntos de instrucciones en desacuerdo sobre el
  workflow producen comportamiento híbrido que no responde ante ninguno.

### 2 — Validar los recursos antes de confiar en ellos

- **Debe:** comprobar schema, rutas, dependencias y cualquier evidencia de
  integridad existente (hashes, manifiestos, firmas).
- **No debe:** asumir que un recurso está vigente porque está presente.
- **Por qué:** la presencia prueba existencia, no corrección ni
  procedencia.

### 3 — Los recursos ausentes o divergentes necesitan diagnóstico, no reparación silenciosa

- **Debe:** diagnosticar la divergencia y obtener una decisión de
  recuperación explícita.
- **No debe:** auto-descargar, sobrescribir, activar reemplazos ni afirmar
  equivalencia de versiones sin evidencia.
- **Por qué:** la reparación silenciosa sustituye contenido declarado por
  contenido no verificado — exactamente el modo de fallo que la
  comprobación de integridad existe para prevenir.

### 4 — El legado sin pin permanece etiquetado, nunca verificado por hash

- **Debe:** etiquetar el contenido sin versión ni hash fijado como legado
  sin pin.
- **No debe:** presentarlo como verificado o comprobado por integridad.
- **Por qué:** la etiqueta preserva el nivel de confianza honesto; una
  afirmación de verificación falsa es peor que ninguna.
