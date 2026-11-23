# Descubrimiento del build

Los manifests y la presencia de lockfile son evidencia del stack y del
gestor de paquetes. No son permiso para ejecutar scripts ni instalar
dependencias. Las señales desconocidas o conflictivas requieren resolución
explícita. Inspecciona los scripts reales y la configuración de CI antes de
proponer un comando. No inventes un comando de pruebas para un stack
detectado que no sea Node.

Esta es la estructura a rellenar para el contrato de build de un
repositorio. Registra qué está fijado, para qué sirve *cada* perfil y los
workarounds de plataforma que ya existen — no inventes nuevos.

## Qué registrar

### Toolchain

- [ ] Archivos de toolchain/versión fijados (`rust-toolchain.toml`,
      `.nvmrc`, `.python-version`, `mise.toml`, …) — el pin prevalece sobre
      un paso de CI que nombre un canal distinto.
- [ ] Gestor de paquetes y lockfile (`Cargo.lock`, `package-lock.json`,
      `pnpm-lock.yaml`, `uv.lock`, …); si el lockfile está commiteado.
- [ ] Versiones mínimas soportadas que el proyecto declara a los
      consumidores.

### Perfiles de build/prueba

Registra el nombre, los ajustes y el *uso previsto* de cada perfil — no
solo el comando:

| Perfil | Ajustes típicos | Uso previsto |
|---|---|---|
| dev | iteración rápida (opt baja, sin info de debug o limitada) | ciclo local de edición |
| test | igual que dev, más los defaults del harness de pruebas | perfil del `test`-runner |
| ci | sin LTO, opt moderada, codegen paralelo | puerta rápida de CI |
| release | LTO thin/fat, opt alta, una sola unidad de codegen | artefactos publicados |
| audit/certify | lo que sea el perfil pre-merge/certificación | validación completa deliberada |

### Workarounds de plataforma ya en vigor

Todo workaround debe ser descubrible y justificado. Ejemplos del tipo a
registrar:

- Límites de paralelismo exigidos por RAM o por el SO (`--build-jobs 2`,
  `jobs = 2` en la config del toolchain) — anota la *razón*.
- Overrides forzados de linker/toolchain en archivos de config del
  toolchain — anota qué hacía mal la herramienta por defecto (p. ej. clase
  de crash) antes de sustituirla.
- Pasos de CI que fijan una variable de entorno para desambiguar dos
  definiciones de toolchain en competencia (flag de canal vs. archivo de
  toolchain).
- Riesgos de unificación de features: un build implícito de "default
  members" puede unificar features en un directorio target compartido y
  colgar o colisionar — registra qué comandos deben permanecer fijados en
  alcance.

### Estrategias de iteración rápida (workflow, sin cambio de código)

| Estrategia | Por qué es más rápida |
|---|---|
| Acotar a los paquetes tocados (`-p`, filtros de ruta) | Omite el resto del workspace |
| Reducir features (`--no-default-features -F "…"`) | Excluye dependencias opcionales pesadas |
| Usar el perfil nativo de check/lint | Ya tiene ajustes mínimos de opt/debug |
| Pedir timings al build (`--timings`, build scan) | Muestra exactamente a dónde va el tiempo |
| Excluir paquetes hoja sabidamente lentos de las corridas workspace-wide | Los adaptadores/wrappers rara vez cambian |

Prioriza el flag de alcance: normalmente domina a cualquier otra
optimización.

### Features por defecto y opcionales

- [ ] Registra el conjunto de features por defecto y la *razón* por la que
      las features pesadas son opt-in.
- [ ] Registra las features que condicionan subsistemas enteros (servidor
      HTTP, bindings FFI, integraciones remotas, instrumentación, hooks
      solo de prueba como `failpoints`) — las pruebas y binarios que las
      requieren deben nombrarlas.

## Verificación

- [ ] Todo comando que propongas existe en los scripts/CI del proyecto y fue
      leído, no asumido.
- [ ] Los comandos de iteración acotados y los comandos deliberados de
      workspace completo están etiquetados como tales; la suite completa
      nunca es el default de iteración.
- [ ] Los workarounds específicos de plataforma llevan una causa declarada,
      o se marcan como indocumentados y no confiables.

<!-- Cross-references: → see test-suite.md, dev-tools.md, definition-of-done.md -->
