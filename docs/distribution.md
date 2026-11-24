# Distribucion declarativa (`dist`)

La familia `dist` es la maquinaria de distribucion del catalogo: pilas de
catalogos multi-fuente, bundles instalables, extensiones que aportan
recursos y presets que componen sobre los recursos servidos. Todo es
declarativo — validacion, composicion y planificacion; nunca se descarga
ni se ejecuta contenido remoto.

**Frontera remota cerrada por diseno:** las fuentes se limitan a URIs
`file://`. Una URI `http(s)` valida su forma pero se rechaza al cargar
con `REMOTE_CATALOG_UNSUPPORTED`; no existen flags "futuros" inertes.
Las mutaciones quedan registradas en un journal CAS propio y se
serializan bajo un lock del subsistema.

## Inventario de verbos (21)

### Runner de workflows declarativos

| Verbo | Que hace |
|---|---|
| `dist run --project PATH --input FILE [--no-resume]` | Ejecuta un documento de workflow declarativo con las primitivas whitelisted del harness (`task.transition`, `methodology.check`, `converge.*`, `analyze.task`, `checklist.*`, `noop`), args cerrados por op. Checkpoints atomicos en `<state>/workflow-runs/`; reanuda sin reejecutar salvo `--no-resume`. |

### Composicion y validacion de catalogos

| Verbo | Que hace |
|---|---|
| `dist stack --project PATH --input FILE` | Fusiona catalogos `file://` por prioridad desde `{sources:[{uri,priority}]}`. |
| `dist compose --project PATH --input FILE` | Compone un texto base con capas `{base, layers}` usando ops `replace`/`prepend`/`append`/`wrap`/`replace-section`. |
| `dist validate --project PATH --input FILE` | Valida una submission de catalogo: `id` slug, `version` semver, `source.uri`, `sha256` obligatorio en fuentes remotas. |
| `dist bundle-validate --project PATH --input FILE` | Valida un documento bundle: `requires` con pins y deteccion de entradas ausentes. |

### Bundles (instalar, montar, desinstalar)

| Verbo | Que hace |
|---|---|
| `dist bundle-install --project PATH --input FILE [--apply]` | Vista previa por defecto; con `--apply` copia las fuentes `file://` requeridas bajo `<configDir>/bundles/<id>/` (tope 256 archivos / 16 MiB, create-only, idempotente, provenance content-addressed con verificacion sha256 por pin). |
| `dist bundle-mount --project PATH ID` | Monta un bundle instalado en el catalogo del workspace. |
| `dist bundle-unmount --project PATH ID` | Desmonta un bundle del catalogo. |
| `dist bundle-uninstall --project PATH ID [--keep-files]` | Retira el bundle instalado; `--keep-files` conserva los archivos copiados. Mutacion directa journaled (sin vista previa). |
| `dist mounted-list --project PATH` | Lista las entradas montadas activas. |

### Extensiones

| Verbo | Que hace |
|---|---|
| `dist extension-register --project PATH --input FILE` | Registro create-only: `id`, `version` semver, `source`, `lifecycle` (`onInstall`/`onActivate`/`onRemove`) y `contributes` con forma `<kind>/<id>`. |
| `dist extension-list --project PATH` | Lista el registro de extensiones. |
| `dist extension-activate --project PATH ID` / `dist extension-deactivate --project PATH ID` | Ciclo `registered -> active <-> disabled`; activar valida `contributes` contra el catalogo del workspace. Las extensiones activas aportan sus recursos declarados a los paquetes de workflow. |
| `dist extension-remove --project PATH ID` | Retira una extension; exige que este `disabled` primero. Mutacion directa journaled. |

### Presets

| Verbo | Que hace |
|---|---|
| `dist preset-register --project PATH --input FILE` | Registro create-only de un preset `{id, priority, overrides:[]}`; cada override lleva `target` (`*`, `<kind>/*` o `<kind>/<id>`) y `op`. |
| `dist preset-list --project PATH` | Lista los presets registrados. |
| `dist preset-remove --project PATH ID` | Retira un preset. Mutacion directa journaled. |

### Mantenimiento y traza

| Verbo | Que hace |
|---|---|
| `dist selftest --project PATH` | Autodiagnostico del subsistema. |
| `dist journal --project PATH [--tail N] [--registry R] [--op O] [--id I]` | Lee el trail CAS de mutaciones (bundle/extension/preset) con filtros opcionales. |
| `dist pack --project PATH --source DIR --out FILE` | Empaqueta un directorio en un archivo de bundle determinista. |

## Como se consumen los presets

Los overrides de un preset se aplican al servir recursos del catalogo
dentro de los paquetes de workflow (`workflow` y los aliases de catalogo
como `pipeline`/`status`): `buildWorkflowPacket` selecciona por
`target` las capas de los presets registrados en orden de `priority`
ascendente (la mayor prioridad se aplica la ultima), compone el texto
del recurso con `composeResource` y deja traza auditable en
`packet.presets.applied` (o en la lista diferida cuando el paquete es
lazy). `dist compose` permite probar la composicion sobre cualquier
texto base sin escribir nada.

Operaciones de capa: `replace` (sustituye todo el texto), `prepend`,
`append`, `wrap` (`{{BODY}}` obligatorio) y `replace-section` (reemplaza
el cuerpo bajo el encabezado Markdown cuyo anchor en minusculas coincide
con `selector`; sin coincidencia no cambia nada).

## Guia de `examples/preset-yagni.json`

`examples/preset-yagni.json` es un preset listo para registrar: la
escalera YAGNI portable y ejecucion concisa, equivalente agnostico de
anfitrion al modo "ponytail" del archivo heredado. Su contenido:

```json
{
  "id": "yagni-concise",
  "version": "1.0.0",
  "priority": 10,
  "description": "Portable YAGNI ladder and concise execution preset (host-agnostic equivalent of legacy ponytail mode).",
  "overrides": [
    {
      "target": "command/*",
      "op": "append",
      "content": "\n\n## Concise / YAGNI discipline (preset: yagni-concise)\n\nPrefer the smallest verified change that satisfies the stated contract:\nreuse existing abstractions > stdlib > installed dependencies > minimal new code.\nAvoid speculative generality, unnecessary wrappers and unrelated edits.\n"
    }
  ]
}
```

- `target: "command/*"` aplica el override a todos los comandos del
  catalogo; `op: "append"` anexa la disciplina YAGNI al final del cuerpo.
- `priority: 10` ordena la capa frente a otros presets (menor = antes).

Registrarlo y comprobarlo:

```powershell
node .\bin\scopegrain.mjs dist preset-register --project . --input examples/preset-yagni.json
node .\bin\scopegrain.mjs dist preset-list --project .
```

```bash
node ./bin/scopegrain.mjs dist preset-register --project . --input examples/preset-yagni.json
node ./bin/scopegrain.mjs dist preset-list --project .
```

Efecto: al construir un paquete de workflow, cada comando servido lleva
anexada la seccion "Concise / YAGNI discipline", y el paquete declara el
override en `packet.presets.applied`. Para retirarlo:

```powershell
node .\bin\scopegrain.mjs dist preset-remove --project . yagni-concise
```

Los registros de extensiones y presets viven bajo el directorio de la
config del proyecto; las mutaciones pasan por el journal CAS de `dist`,
consultable con `dist journal`.

## Documentos relacionados

- [release-runbook.md](release-runbook.md) — proceso de publicación del
  paquete npm (distinto del subsistema `dist`, que mueve catálogos
  entre proyectos).
- [skills-distribution-eval.md](skills-distribution-eval.md) — evaluación
  de distribuir `resources/skills/` por el ecosistema Agent Skills
  (`npx skills add`), canal alternativo a la proyección por host.
