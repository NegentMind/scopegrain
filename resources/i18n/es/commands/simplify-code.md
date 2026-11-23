---
name: simplify-code
description: Simplifica complejidad demostrada preservando el comportamiento observable.
---
# Simplificar código

Invoca `code-simplification` y `test-driven-development` (los tests de
caracterización de abajo). Simplifica el código cambiado recientemente
— o el ámbito explícitamente pasado — preservando el comportamiento
exacto. Prepara al revisor de cierre con `prompts/review-request`.
Reglas rectoras: `rules/api-contract`, `rules/review`. Roles:
`implementer` simplifica, `reviewer` comprueba.

## Procedimiento

1. Lee las instrucciones y convenciones del proyecto; inspecciona el
   objetivo, los llamadores, los contratos y los tests existentes antes
   de tocar nada.
2. Identifica el código objetivo — cambios recientes salvo que se
   autorizara un ámbito más amplio. No expandas el ámbito a una
   reescritura estética, y no borres código aparentemente sin uso sin
   comprobar consumidores externos, generados y dinámicos.
3. Acuerda ámbito y aceptación; añade caracterización de comportamiento
   ausente (un test de caracterización) antes de cambiar código donde
   la cobertura sea escasa (`references/testing-patterns`).
4. Busca oportunidades de simplificación
   (`references/clean-code-clean-architecture`):
   - Anidamiento profundo → cláusulas de guarda o helpers extraídos.
   - Funciones largas → dividir por responsabilidad.
   - Ternarios anidados → if/else o switch/match.
   - Nombres genéricos → nombres descriptivos.
   - Lógica duplicada → funciones compartidas.
   - Código muerto → eliminar solo tras confirmar cero consumidores.
5. Aplica cada simplificación incrementalmente — ejecuta las
   comprobaciones estrechas registradas del proyecto tras cada cambio
   (propuestas hasta ser autorizadas; verificación manual por defecto).
   Si una comprobación falla tras una simplificación, revierte ese
   cambio y reconsidera.
6. Verifica que todas las comprobaciones autorizadas pasan e
   inspecciona el diff completo.

## Autoridad y verificación

Cada cambio se verifica incrementalmente mediante las comprobaciones
registradas del proyecto — propuestas al propietario bajo verificación
manual, nunca autoreportadas en verde. El ámbito se mantiene en lo
acordado: no reescrituras estéticas, no limpieza empaquetada, no
publicación.

## Contrato de salida

- El diff completo inspeccionado más la evidencia de comprobaciones
  ejecutadas.
- Un registro de revisión donde el riesgo lo requiriera
  (`code-review-and-quality`, preparado vía `prompts/review-request`);
  efectos verificados y huecos restantes declarados claramente.

## Señales de alarma — NO simplificar

- Rutas calientes críticas de rendimiento — la medición dirige esas
  decisiones, no el estilo (`performance-optimization`).
- Validación sensible a seguridad — la redundancia es defensa en
  profundidad.
- Firmas de API pública — los cambios disruptivos necesitan ciclos de
  deprecación (`deprecation-and-migration`).
- Fronteras unsafe/FFI — cambia una, audítalas todas.
- Código generado — regenera en su lugar.

## Entrega

Aguas arriba: `implement-task` produce el código que este comando
simplifica; para un defecto encontrado a mitad de simplificación, una
comprobación que lo reproduce precede a la corrección, y los defectos
no relacionados se registran según `prompts/finding-record`. No afirmes
ejecución más rápida sin medición.
