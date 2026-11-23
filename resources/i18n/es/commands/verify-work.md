---
name: verify-work
description: Ejecuta o prescribe verificación acotada y preserva la evidencia en bruto.
---
# Verificar el trabajo

Router sobre `unified-review` — carga esa skill y ejecuta su flujo para
el modo seleccionado; este archivo posee solo la selección de modo y el
contrato de salida. Si el propietario pasa un perfil de proyecto
nombrado, úsalo. Rol: `verification-engineer`. Regla rectora:
`rules/evidence`.

Los hallazgos se registran según `prompts/finding-record`; el resultado
de la verificación aterriza en el registro de continuación/estado según
`prompts/session-recitation`.

## Modos

| Invocación | Modo `unified-review` | Uso |
|---|---|---|
| `verify-work` / `verify-work quick` | quick | Puerta mecánica estrecha sobre la superficie cambiada |
| `verify-work certify` | certify | Puerta pre-merge/pre-push: secuencial, parada dura en el primer fallo |

## Ejecución

1. Descubre los criterios de aceptación reales, los comandos de
   verificación registrados del proyecto, los entornos soportados y el
   permiso aplicable para ejecutar comprobaciones. **Nunca hardcodees
   una pila** — usa los comandos registrados para este proyecto
   (`references/build-system`, `references/test-suite`,
   `references/testing-patterns`); las pilas desconocidas permanecen
   desconocidas. El suelo de calidad (`references/quality-floor`)
   define lo que una puerta nunca puede omitir.
2. Ámbito: si el diff de trabajo está vacío, usa el diff del último
   commit como ámbito de revisión e indícalo.
3. La verificación es manual por defecto: propón comandos exactos y
   directorios de trabajo, luego registra la salida real. Si la
   ejecución está reservada al propietario, entrégale los comandos
   exactos y espera la salida completa. Un comando propuesto nunca se
   reporta como comprobación superada.
4. **quick:** el conjunto de comprobaciones más pequeño adecuado para
   la superficie cambiada — las comprobaciones de
   formato/lint/test/política registradas que realmente aplican.
5. **certify:** la puerta de integración acordada, secuencial, parada
   dura en el primer fallo ("FAILED at <gate> — aborting" / "CERTIFY
   PASSED — safe to push"). Cubre los límites de compatibilidad;
   ningún modo cambia el suelo de calidad ni autoriza instalaciones o
   servicios.

## Autoridad y verificación

Este comando ejecuta o prescribe comprobaciones — no corrige el
producto, no aprueba una release ni afirma revisión independiente.
Verificación manual por defecto; un certify superado aún requiere
autorización explícita del propietario para el propio push.

## Contrato de salida (obligatorio, post-ejecución)

1. **Informe:** `<reports path>/verify-<mode>-<YYYYMMDD>-<HHMMSS>.md`
   (con relleno de ceros) con un marcador por puerta, hallazgos
   priorizados (Critical/Important/Suggestion con archivo:línea y una
   corrección concreta), y el veredicto.
2. **Estado:** un registro de última verificación en la ruta de estado
   configurada:
   `{timestamp, mode, verdict: PASS|FAIL, findings_critical, report_file}`,
   más la actualización de continuación según `session-recitation`.
3. **Índice:** una fila en el índice de informes; marca cualquier
   informe anterior del mismo modo superado.
4. **Backlog:** cada hallazgo ≥ medium se registra según
   `prompts/finding-record` — `source` nombra este informe, esquema
   según `references/backlog-format`, deduplicado contra elementos
   existentes.

## Mensaje final

- PASS: `VERIFICATION PASSED (<mode>)` + resumen de hallazgos.
- FAIL: `VERIFICATION FAILED — fix the errors above before shipping.`

## Señales de alarma

- Una comprobación propuesta o parcialmente ejecutada reportada como
  superada.
- Un comando de pila hardcodeado en lugar de los registrados del
  proyecto.
- certify continuado más allá del primer fallo.
- El suelo de calidad debilitado para que una ejecución pase.

## Entrega

La revisión profunda de lógica pertenece a `review-change`; la
auditoría de superficie completa pertenece a `audit-project`. Los
hallazgos fluyen a `implement-task`; la preparación de release es
`assess-release`.
