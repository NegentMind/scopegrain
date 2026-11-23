# Herramientas de desarrollo opcionales

Inventaría las herramientas por disponibilidad real, versión soportada,
permisos requeridos y alcance. La ausencia no es permiso para instalar.
Prefiere los comandos existentes del proyecto y la herramienta adecuada más
pequeña. Una propuesta de integración generada no demuestra que un servicio
esté configurado, alcanzable o autorizado. Reporta fallbacks y limitaciones
de capacidad.

Esta es la estructura del inventario de dev-tooling de un proyecto. La
lista concreta de herramientas es documentación del owner — registra estas
*categorías* y los campos siguientes, verificados contra la máquina, no
asumidos.

## Formato de registro de inventario

| Campo | Qué registrar |
|---|---|
| Herramienta | Nombre y método de instalación |
| Instalada | ✅/❌ — verificado en la máquina, no asumido |
| Comando | La invocación exacta usada en este proyecto |
| Propósito | Una línea: qué problema elimina |
| Alcance | Global, local al proyecto, o solo-CI |

## Categorías que vale la pena inventariar

### Ciclo de feedback rápido
- File-watcher + runners de check/test (herramientas estilo `watch`):
  re-verificación sub-segundo en cada guardado.
- Un archivo de task runner en la raíz del repo
  (Justfile/Makefile/Taskfile) que nombra los comandos canónicos. Léelo
  antes de proponer alternativas.
  Registra: quick check · full verify · watch loop · fmt-fix · lint ·
  escaneo de dependencias sin usar · auditoría de tamaño de binario ·
  deps desactualizadas · auditoría de seguridad · generación de changelog ·
  réplica del orden de CI · certificación pesada · build de release ·
  puntos de entrada de ejecución.

### Higiene de dependencias y supply-chain
- Detectores de dependencias sin usar, informes de dependencias
  desactualizadas, escáneres de advisories/vulnerabilidades, verificadores
  de licencias/deny.
- Config del bot de PRs de dependencias automatizadas: ecosistemas
  cubiertos, calendario, límites de PR, reglas de agrupación.

### Inspección de binarios/artefactos
- Perfiladores de tamaño, reportadores de tiempo de build, diffing de
  artefactos.

### Automatización de releases
- Automatización de version-bump + changelog + tag + publish (p. ej. una
  herramienta clase release-plz): dónde vive su config, qué incrementa
  (semver dirigido por conventional-commit), qué publica y en qué orden.
- Generadores de changelog dirigidos por convenciones de commits.

### Setup de editor/IDE
- `.vscode/` (o equivalente): extensiones recomendadas, format-on-save,
  ajustes del analizador acordes a los feature flags del proyecto,
  definiciones de tareas que reflejan el task runner, config de
  asistente/tooling.

### Alias de git y ergonomía
- Registra alias configurados globalmente solo si el proyecto depende de
  ellos; si no, trátalos como preferencia personal, no como contrato del
  proyecto.

### Aceleración de CI
- Cachés de compilador / de objetos en CI (clase sccache, cachés de capa de
  dependencias): qué backend usan y cómo están cableados (variables de
  entorno escritas por paso porque las composite actions no aceptan `env`
  en el nivel superior — ese tipo de detalle de cableado es exactamente lo
  que pertenece aquí).

## Flujo diario recomendado (plantilla)

```bash
# Iterative development — terminal 1
<task-runner> watch                 # instant feedback loop

# Before commit
<task-runner> verify                # fmt + lint + scoped tests + audit

# Commit
git add -p && git commit -m "feat: ..."

# Release — only via the project's release automation
<release-tool> release              # bump + changelog + tag + publish
```

## Reglas de verificación

- [ ] "Instalada" se verificó (binario en PATH / versión reportada), nunca
      inferida de la documentación.
- [ ] Todo comando de esta referencia se leyó del task runner del proyecto
      o de la config de CI.
- [ ] Para cada herramienta se declara el fallback (qué ejecutar cuando la
      herramienta está ausente — normalmente el equivalente nativo del
      lenguaje).

<!-- Cross-references: → see build-system.md, test-suite.md, ship-runbook.md, quality-floor.md -->
