---
name: project-onboarding
description: Investigar un repositorio desconocido y configurar Scopegrain con consentimiento explícito del dueño antes de generar artefactos.
---
# Incorporación de proyecto

1. Confirma la raíz de proyecto autorizada e inspecciona las instrucciones existentes.
2. Comprueba el estado existente y las señales actuales del harness:
   - Cuando la ejecución local de comandos está autorizada, ejecuta `scopegrain adopt --project <root>` para comprobar si `.scopegrain/config.json` ya existe, o `scopegrain investigate --project <root>` en un repositorio no inicializado para recopilar `investigation` y `suggestions` (`unanswered`, stacks detectados, candidatos de verificación no aprobados y señales activas del harness).
   - En caso contrario, inspecciona los manifiestos directamente y reporta esa limitación.
3. Comprueba arquitectura, límites de paquetes, tests, tooling, flujos de
   trabajo existentes y si la funcionalidad solicitada ya existe. Cita
   evidencia de archivos.
4. Separa hechos observados, convenciones inferidas y preguntas sin respuesta.
5. Aplica aislamiento por harness alrededor de `.scopegrain/`:
   - Mantén `.scopegrain/` como el único hogar canónico para el estado del motor Scopegrain, la configuración, las instantáneas del catálogo, las políticas y las siete rutas de artefactos operativos (`plans`, `tasks`, `reports`, `research`, `decisions`, `memory`, `state`).
   - Mantén los puentes de host nativos activos aislados en la raíz de proyecto propia de cada harness (`.devin/` para Devin, `.agents/` para Antigravity y Copilot (raíz de skills compartida — Copilot además usa `.github/`), `.claude/` para Claude Code, `.codex/` para Codex, `.opencode/` para OpenCode, `.cursor/` para Cursor). Nunca mezcles, sobrescribas ni dañes la carpeta activa de otro harness al añadir un host nuevo.
   - Decide el versionado Git **de forma consistente** para las raíces de host y `.scopegrain/` juntas: los puentes referencian recursos bajo `.scopegrain/`, así que versionar los puentes ignorando `.scopegrain/` deja un clon nuevo con referencias colgadas. Versiona ambos o ninguno (los puentes son regenerables vía `host activate`). Los destinos de merge locales de máquina (`.mcp.json`, `.codex/config.toml`, `opencode.jsonc`, `.devin/config.json`, `.agents/mcp_config.json`, `.devin/mcp_config.json`, `.cursor/mcp.json`, `.vscode/mcp.json`) llevan rutas absolutas y deben permanecer en gitignore sin excepción. La elección autoalojada de este repositorio —raíces de puente versionadas, `.scopegrain/` ignorado— es deliberada: los colaboradores regeneran el estado con `init`/`update`/`host activate`; no la copies a proyectos invitados a ciegas.
6. Pregunta interactivamente al dueño para resolver brechas (`suggestions.unanswered`) y confirmar elecciones:
   - Nombre del proyecto, idioma de documentación (`es`/`en`), hosts de agente de codificación (incluido el harness en ejecución) y modo de metodología (`organic-sdd`, `sdd` o `manual`).
   - Ruta de configuración y las siete ubicaciones de artefactos bajo `.scopegrain/`, más los ocho flags de versionado Git. Nunca asumas `docs/dev` ni inventes consentimiento.
   - Usa un `<stateDir>/init-session.json` reanudable o un `answers.json` explícito conforme a `schemas/answers.schema.json` cuando configures a lo largo de varios turnos.
7. Propón comandos de verificación con su directorio y fuente; no los
   ejecutes ni copies secretos a la configuración.
8. Previsualiza cada archivo generado antes de escribir:
   - En un proyecto nuevo: previsualiza con `scopegrain init --project <root> --answers <file>`.
   - Al añadir un harness a un proyecto ya configurado: actualiza `hosts` en `.scopegrain/config.json` y previsualiza con `scopegrain update --project <root> --reconcile`.
   - Si una instrucción o configuración de host ya existe, para y propón un merge revisado.
9. Pide permiso explícito para aplicar la creación (`--apply`). Guarda las preferencias aprobadas para reutilizar; si se necesitan cambios de configuración más tarde, vuelve a preguntar.
10. Activa solo el harness actual en su raíz aislada tras previsualizar:
   - Previsualiza con `scopegrain host activate --project <root> --host <harness> [--surface <app-cli|ide>]` (para Antigravity, selecciona `app-cli` para skills, subagentes y `.agents/mcp_config.json`, o `ide` para skills y `.agents/mcp_config.json`).
   - Aplica con `--apply` solo tras la confirmación del dueño, luego verifica con `scopegrain doctor --project <root>`.
11. Explica qué se detectó automáticamente, qué aún necesita investigación
    semántica y qué integraciones quedan sin verificar.

## Disciplina de investigación

- Lee los archivos de instrucciones propios del proyecto antes que su
  código: son la señal de mayor densidad para convenciones, límites y zonas
  prohibidas.
- Clasifica cada hallazgo: **hecho observado** (evidencia de archivo/ruta
  citada), **convención inferida** (patrón repetido en archivos, marcado
  como inferencia), **pregunta sin respuesta** (enrutada al dueño, nunca
  adivinada).
- Comprueba si la capacidad solicitada ya existe antes de planificar su
  construcción: busca en el codebase, el backlog y el registro de trabajo
  completado.
- Verifica que nada sea escribible silenciosamente fuera de la raíz de
  proyecto autorizada.

## Ritual de inicio de sesión (una vez que el harness está activo)

Al inicio de cada sesión de trabajo, en orden:

1. **Carga el paquete de sesión**: lee las instrucciones del proyecto, el
   archivo de conocimiento configurado, el estado de tareas, las entradas
   recientes del worklog, los objetivos abiertos y los eventos pendientes
   (p. ej. `scopegrain context --project .`).
2. **Comprueba el estado del repositorio**: ¿cambios sin commit? ¿últimos
   commits? (`git status --short`, `git log --oneline -5`). El trabajo sin
   commit ajeno se preserva y se reporta, nunca se absorbe.
3. **Comprueba trabajo en curso**: reanuda el estado registrado en lugar de
   reiniciar desde la memoria de la conversación.
4. **Carga solo las capacidades relevantes a la tarea**: según
   `select-capabilities`; lee los cuerpos de las skills seleccionadas y los
   archivos de reglas/referencia del área exacta tocada, no todo el catálogo.
5. **Verifica el entorno solo cuando la tarea lo toca**: comprobaciones de
   versión del toolchain y el comando de verificación rápida del proyecto.

Al final de la sesión: ejecuta `session-handoff` (registra el trabajo
completado, destila lecciones, guarda el registro de handoff) y las
comprobaciones de cierre del proyecto.

## Autoauditoría del harness (quién vigila al harness)

Cuando los archivos del harness cambian (commands, agents, skills, prompts,
rules, references) o se sospecha deriva, audita el harness, no el producto:

**Alcance:** solo la superficie de configuración del harness: el layout de
estado de `.scopegrain/`, los directorios de puente de host activos, los
archivos de command/skill/agent/prompt/rule y los manifiestos. El código de
producto, los lanzamientos y el rendimiento del producto están fuera de
alcance (otros roles los poseen).

**Procedimiento:**

1. Determina el alcance de la auditoría: el diff dentro de la superficie del
   harness (`git diff --name-only HEAD`, fallback `HEAD~1`); una auditoría
   completa cuando no hay diff.
2. Ejecuta las comprobaciones siguientes, cada hallazgo con evidencia
   `path:line`: una afirmación sin evidencia no es un hallazgo.
3. El veredicto es binario: **healthy** | **changes required**.
4. Los hallazgos en o por encima de la severidad acordada se convierten en
   filas de hallazgos en el registro activo con el origen registrado; el
   informe aterriza bajo `.scopegrain/reports/` con una fila de índice.
5. El auditor reporta; no implementa arreglos. La implementación es un
   rol/acción separada.

**Comprobaciones, en orden:**

- Por cada skill modificada: verificación estructural donde exista tooling.
- Deriva de conteo: directorios de skill/agent/command vs manifiestos e
  índices: un directorio no registrado es deriva, no activación.
- Límites declarados vs permisos reales: tablas de instrucciones que
  contradicen bloques de permisos reales de roles/agentes.
- Routers delgados: los commands enrutan a skills/runbooks; lógica
  duplicada en un command es un defecto.
- Portabilidad: rutas absolutas, rutas específicas de máquina, nombres de
  host horneados en recursos compartidos.
- Referencias entre capas: enlaces y rutas entre commands, skills y
  references que ya no resuelven.
- Plantillas que citan archivos eliminados.

**Regla de resolución:** las rutas escritas dentro de los recursos del
harness resuelven contra la **raíz del proyecto**, no contra el directorio
del harness: un linter externo que las resuelva contra el directorio del
harness produce falsos positivos; documéntalos como tales, no "arregles" las
referencias.

## Disciplina de archivos de referencia

Mantén las referencias largas fuera de las instrucciones siempre cargadas;
consúltalas perezosamente:

- Lee un archivo de referencia solo cuando aplica su disparador (un error
  específico, un flujo de bug, el formato de salida de una herramienta).
- Si un archivo se leyó para resolver un problema y la solución no está
  documentada, **añade la entrada faltante** en el formato propio del archivo.
- Mantén la estructura establecida al editar (tabla de secciones, bloques de
  código para comandos); el frontmatter, los enlaces y las convenciones de
  `kind`/ruta para documentos nuevos son dominio de `documentation-and-adrs`.
- Las reglas de área son reglas duras: carga exactamente el archivo del área
  tocada; nunca omitas ni relajes una; nunca cargues en masa todo el conjunto.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "La detección encontró el stack, solo escribe la config" | La detección es una propuesta, no una autorización: el dueño confirma cada elección. |
| "Existe un default docs/dev en otros proyectos" | Las rutas de artefactos nunca se asumen por convención; provienen de respuestas explícitas. |
| "Aplicar ahora ahorra un viaje de ida y vuelta" | La previsualización previa existe para que los archivos generados se revisen, no se confíen a ciegas. |
| "Esta carpeta no se usa, puedo reutilizarla" | La carpeta de puente activa de otro harness nunca se mezcla, sobrescribe ni daña. |

## Señales de alerta

- Una configuración escrita sin previsualización o sin consentimiento del dueño.
- Secretos o datos privados de sesión dentro de la configuración generada.
- Estado de `.scopegrain/` mezclado en una carpeta de puente de host, o el
  puente de un harness dañado por la activación de otro.
- Rutas `docs/dev` asumidas que nunca fueron confirmadas.
- Comandos de verificación ejecutados durante el onboarding en lugar de propuestos.
- Un merge que sobrescribió silenciosamente instrucciones o configuración de host existentes.

## Verificación

- [ ] Se confirmó la raíz de proyecto autorizada; nada se escribió fuera de ella.
- [ ] Los hallazgos están clasificados: hecho observado (con evidencia),
      convención inferida (marcada), pregunta sin respuesta (enrutada al dueño).
- [ ] Cada archivo generado fue previsualizado antes de `--apply`; el
      consentimiento fue explícito.
- [ ] `scopegrain doctor` (o la comprobación de salud equivalente) se ejecutó
      tras la activación y su salida fue reportada.
- [ ] Las integraciones no verificadas y las brechas semánticas restantes
      fueron declaradas.

## Límites

- Previsualiza antes de escribir, siempre; `--apply` solo con consentimiento explícito.
- La detección no es autorización: los stacks, hosts y comandos de
  verificación candidatos detectados son propuestas hasta que el dueño confirma.
- Nunca copies secretos, tokens o datos privados de sesión a la configuración
  o a archivos generados.
- El onboarding configura el harness; no autoriza instalaciones, llamadas de
  red, pushes ni activación de flujos de trabajo.

## Véase también

- `context-engineering`: la jerarquía de archivos de reglas y contexto que el
  onboarding arranca.
- `select-capabilities`: carga perezosa de capacidades una vez que el harness está activo.
- `session-handoff`: el registro de fin de sesión al que el ritual delega.
- `documentation-and-adrs`: convenciones de autoría para documentos creados
  durante o después del onboarding.
