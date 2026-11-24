# LLM-as-judge eval layer

Capa no-determinista de evaluación de los artefactos que consume el
agente (context packet, workflow packet, task-suggest). Diseño según la
auditoría 2026-11-24 (H8):

- **Scoring absoluto con rúbrica** (patrón G-Eval), nunca comparación
  par-a-par: el drift de baseline se mide por puntuación, no por orden.
- **Juez pinned + temperature 0** para determinismo razonable.
- **Nightly / muestreado — NUNCA gate de PR**: un modelo estocástico no
  puede bloquear merges; sirve como canario de calidad.
- Fixtures en `fixtures/` son muestras reales volcadas de un proyecto
  init — regenerarlas con el comando del runbook antes de cada nightly.

## Uso

```bash
npx promptfoo@latest eval -c eval/llm-judge/promptfooconfig.yaml
```

Requiere la API key del proveedor juez (`ANTHROPIC_API_KEY` u
`OPENAI_API_KEY`). Sin key, la capa es config válida sin ejecutar.

## Regenerar fixtures

```bash
node bin/scopegrain.mjs context --project <fixture-project> \
  > eval/llm-judge/fixtures/context-packet.sample.json
node bin/scopegrain.mjs workflow --project <fixture-project> \
  > eval/llm-judge/fixtures/workflow-packet.sample.json
node bin/scopegrain.mjs task suggest --project <fixture-project> <id> \
  > eval/llm-judge/fixtures/task-suggest.sample.json
```
