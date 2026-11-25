---
title: Workflows, planes y continuidad operativa
kind: guide
---
# Workflows y continuidad

Todos los comandos sobre un proyecto reciben `--project P` y admiten
`--config ruta/relativa/config.json`. Los ejemplos son sintaxis y datos
sinteticos, no evidencia de ejecucion.

## Catalogo y procedimientos

```powershell
node bin/scopegrain.mjs catalog list
node bin/scopegrain.mjs catalog show agent reviewer
node bin/scopegrain.mjs catalog check
node bin/scopegrain.mjs catalog legacy skill
node bin/scopegrain.mjs catalog legacy-show skill ponytail
node bin/scopegrain.mjs workflow audit --project P --mode review --profile core
```

Un paquete resuelve comando, roles, skills, reglas, referencias, perfil,
rutas configuradas y, con `--task UUID`, estado y acciones permitidas.
Los paths de recursos son relativos a `resourceRoot`, que identifica
el directorio de configuracion dentro del proyecto. `paths` contiene
destinos de artefactos relativos a la raiz del proyecto.
El perfil core siempre complementa cualquier perfil elegido.
No se ejecuta automaticamente ninguna instruccion ni se crea un agente.

El paquete incorpora `resourceCost`: una estimacion local heuristica
`utf8-bytes/4` sobre los contenidos resueltos (tras `composeResource` y
los presets aplicados) — nunca el conteo del tokenizer del anfitrion.
Reporta `total` y un desglose `byBucket` (`command`, `profile`, `agents`,
`skills`, `rules`, `references`, `prompts`, `mcps`); los recursos
aportados por extensiones activas se suman a su bucket. Es metadato
consultivo incluido dentro del limite de documento del paquete.

Las reglas llevan un filtro de activacion declarado en `rulesFiltered`:
una regla cuyo `meta.status` no es `active` nunca entra en el paquete
(`proposed` no es politica aprobada; `archived` esta muerta) y, cuando el
paquete se construye con `--task`, `activation.globs` se evalua contra
`task.scope` con un matcher propio (`*`, `?`, `**`; insensible a
mayusculas). Los globs casan entradas literales de scope — una entrada
de directorio no se expande a sus descendientes. Una regla sin
`activation.globs` es transversal y siempre aplica; un scope vacio
excluye todas las reglas con globs (falla cerrada).
`activation.stacks`/`languages` son datos para hosts y no condicionan el
empaquetado. Sin `--task` se incluye toda regla declarada activa. La
compuerta tambien cubre reglas aportadas por extensiones y cada
exclusion se mueve a `rulesFiltered` con su razon — nunca silenciosa.

Los aliases compatibles usan la misma interfaz `workflow`, no implementaciones
divergentes. Los modos declarados se validan; nombres o modos desconocidos
se rechazan. Los perfiles web/rust/python/database son optativos y no
instalan stacks, herramientas ni servicios.

## Planes con dependencias

El siguiente ejemplo V1 de `plan create --input plan.json` requiere modo
`manual`. En modo Organic/SDD, usar referencias estructuradas reales
`specId`, `designId` y escenarios por tarea; ver [metodologia](methodology.md).

```json
{
  "key": "entrega",
  "title": "Cambio acotado",
  "authorContext": "implementacion-a",
  "tasks": [
    {"key": "base", "title": "Base", "contract": "Contrato verificable", "scope": ["src"], "dependsOn": []},
    {"key": "api", "title": "Interfaz", "contract": "Contrato de interfaz", "scope": ["src"], "dependsOn": ["base"]}
  ]
}
```

La previsualizacion no escribe. `--apply` crea exclusivamente plan y tareas.
No se sobrescribe un plan con la misma clave. Las claves son minusculas
alfanumericas con guiones, hasta 64 caracteres; se permiten 1..100 tareas.
Los ciclos, dependencias inexistentes y scopes inseguros se rechazan.
Tambien se revalidan los registros persistidos: alterar el JSON no evita
las comprobaciones de DAG, identidad, timestamps o tamano.

`plan list`, `plan show entrega` y `plan next entrega` leen registros
actuales. Una dependencia libera a su sucesora al llegar a CLOSE, no al
declararse terminada en una conversacion. Los estados ready, active,
blocked y closed no sustituyen la maquina de estados de cada tarea.
La ejecucion utiliza [transiciones y evidencias](task-workflow.md).

`plan run entrega` calcula la agenda de ejecucion completa como olas
(waves) derivadas del DAG: cada ola agrupa las tareas cuyas dependencias
pendientes ya quedaron en olas anteriores y marca `parallel: true` cuando
pueden ejecutarse a la vez. Las tareas con triage `defer|skip|blocked`
quedan fuera en `triaged`; las activas o cerradas no se reprograman.
El verbo es de solo lectura: devuelve `{plan, waves, triaged,
unscheduled}` — el host/agente ejecuta el trabajo de cada tarea y registra
transiciones y evidencia por su cuenta; Scopegrain ordena, no ejecuta.

## Artefactos inmutables

```powershell
node bin/scopegrain.mjs artifact add review --project P --input review.json
node bin/scopegrain.mjs artifact list review --project P
node bin/scopegrain.mjs artifact show review UUID --project P
```

Entrada: `{"title":"Revision","body":"Hallazgos y limites","references":[]}`.
Las referencias son rutas relativas seguras del proyecto; las citas
externas pueden documentarse en el cuerpo. `--apply` autoriza la creacion.
La identidad es un UUID propio; no se edita un artefacto historico para
reescribir evidencia. La procedencia contextual se escribe en el cuerpo.
El limite de documento aplica al JSON serializado completo, no solo al
texto de entrada; un documento demasiado grande se rechaza antes de
persistirlo (`DOCUMENT_TOO_LARGE`).

| Tipo | Destino configurado |
| --- | --- |
| spec | plans/specs |
| design (V2) | plans/designs |
| report | reports |
| review | reports/reviews |
| research | research |
| decision | decisions |
| lesson | memory/lessons |
| handoff | memory/handoffs |

Por defecto, todos esos destinos viven bajo `.scopegrain/`, no `docs/`.
Un proyecto puede conservar rutas antiguas explicitamente elegidas; nunca
se mueven o eliminan archivos existentes por un cambio de defaults.

El `spec` generico V1 no satisface una referencia formal. Las operaciones
tipadas distinguen especificacion estructurada, design ligado a su digest
e informe `report` ligado a una revision REVIEW. Un outcome no es un nuevo
tipo de carpeta ni una certificacion de los archivos citados.

## Aprobaciones y acciones

La suite cuenta actualmente 1540 pruebas (conteo verificado en la
auditoria del 2026-11-24; la ultima integral registrada, del
2026-11-23, reporto 1440 pruebas: 1435 pass y 5 fail). El piloto de
Devin Local quedo certificado en una sesion real; el piloto nativo de
Antigravity App/CLI quedo certificado el
2026-11-19; el piloto nativo de OpenCode V2 quedo certificado el
2026-11-23; Claude, Codex, la superficie IDE de Antigravity y
Hermes siguen pendientes. Ver los resultados y limites
en [verificacion](verification.md).

Las operaciones `approval target/create/show/answer` separan identificacion
del contenido, pregunta, lectura y respuesta. Previsualizar una respuesta
no modifica el consentimiento persistido. Aplicarla requiere revision y
`expectedTargetDigest` actuales, revalidados bajo lock; no es un overwrite
generico ni una aprobacion de herramientas nativas.

`methodology check` consulta ACT o ACCEPT sin escribir. El paquete de
workflow incluye modo y resultado metodologico y obtiene sus acciones de
la misma evaluacion. Una revocacion elimina `edit` cuando corresponde;
consultar los metadatos no sustituye la arista del workflow o los permisos
del anfitrion. Los presupuestos de sesiones usan esas acciones efectivas.

## Sesiones y recuperacion

```powershell
node bin/scopegrain.mjs session create --project P --task UUID --limit 20
node bin/scopegrain.mjs session record SESSION_UUID --project P --revision 0 --input event.json
node bin/scopegrain.mjs session resume SESSION_UUID --project P
```

Evento: `{"action":"read","evidence":"Fuente inspeccionada","context":"paso-1"}`.
Crear o registrar requiere `--apply`. El registro usa CAS, lock exclusivo
y validacion de la accion contra el estado actual de la tarea.
El limite explicito es de 1..10000 operaciones registradas. Agotamiento,
revision antigua o accion no permitida no avanzan la sesion.
Un append cuyo reloj retrocede respecto del ultimo evento se rechaza,
sin reordenar la historia ni modificar los bytes existentes.

`resume` devuelve estado y evidencia actuales, eventos y presupuesto
restante; no repite comandos, limpia locks ni reactiva trabajo por su cuenta.
Los documentos operativos tienen un limite de 1 MiB. El presupuesto no
cuenta llamadas nativas no registradas, tokens, dinero ni tiempo.
El campo opcional `tokens` por evento y `tokenLimit` son declaraciones
auto-reportadas del llamador (`self-reported-unverified`), nunca
observadas por el harness.

## Integraciones

Los puentes nativos y fragmentos MCP se entregan para revision dentro de
`integrations/` del harness. Activarlos requiere copiar o fusionar lo
apropiado en el anfitrion tras revisar su version y permisos.
Ver [integraciones nativas](native-hosts.md) y
[modelo de seguridad](security.md). No existe una interceptacion universal.
