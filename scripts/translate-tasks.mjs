// SPDX-License-Identifier: Apache-2.0
// One-off: translate task titles/contracts to Spanish via `task meta` (CAS).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, '.scopegrain/tasks');

const TR = {
  '0296b814-7413-4733-b5a9-f7c423de001c': {
    t: 'commit f6447b8c09: docs(rules): fidelidad de contrato y normas de señal degradada de la auditoría',
    c: 'docs(rules): fidelidad de contrato y normas de señal degradada de la auditoría' },
  '1d37df7f-f0c9-49a7-b2c3-dcccf5e1f629': {
    t: 'Ola 3: rehidratación automática de contexto en flujos de sesión/tarea',
    c: 'Conectar la ruta de lectura verificada de VantaDB (memory_context por recordId, memory_search sobre namespaces sg-formal-v1, memorias L1 destiladas vía memory_recall) a la reanudación de sesión y al ensamblado de contexto de tarea, para que la historia del proyecto sea contexto usable del agente sin consultas manuales al CLI. El diseño debe mantener la superficie MCP de solo lectura y fallar cerrado cuando VantaDB no está enrolado.' },
  '214330cd-1b38-4550-9115-391a31de804e': {
    t: 'Piloto dogfood: integración del host Devin',
    c: 'Verificar que Devin descubre las skills tasksystem-* y que una tarea completa un ciclo de ida y vuelta por los almacenes del harness en este repo' },
  '3856cf64-37fb-45b6-9896-b66459aadfa1': {
    t: 'Viewer: superficies de olas de plan y contexto de sesión',
    c: 'Exponer la salida de planWaves y el paquete de contexto (tareas listas, presencia de conocimiento de usuario, journal pendiente, sesiones reanudables) en el viewer, para que el orden de ejecución del plan y el estado de inicio de sesión sean visibles sin CLI.' },
  '45678824-65ac-41bd-9c4c-69d37caadb79': {
    t: 'Dogfood: verificación de ciclo de vida post-FMEA',
    c: 'Ejercitar el lock verificado y la revalidación metodológica ACCEPT->CLOSE en uso real tras la ola F-01..F-07' },
  '45dc88f9-cdf0-4fbe-8769-153ed7f223f5': {
    t: 'Recertificar la suite completa de tests y actualizar docs de verificación',
    c: 'Ejecutar la suite npm test completa hasta un resultado limpio tras el fix de aserción del schema mcp-limits, y actualizar docs/verification.md y docs/en/verification.md para que el conteo de tests registrado coincida con el resultado real.' },
  '47a056e3-72f2-4c93-b852-31b16f2a78f0': {
    t: 'commit 145691d236: feat(context+plan): paquete de inicio de sesión, docs de tarea y agenda de olas de plan',
    c: 'feat(context+plan): paquete de inicio de sesión, docs de tarea y agenda de olas de plan' },
  '56dc01eb-251b-4b14-8749-ed12630f5121': {
    t: 'Primera release etiquetada v0.1.0',
    c: 'Cortar el primer tag/release semver de Scopegrain (sugerido v0.1.0) alineado con el CHANGELOG.md de Keep a Changelog existente: mover Unreleased a una sección de versión con fecha, etiquetar develop o main según la preferencia de ramas del owner, y opcionalmente publicar una release de GitHub. Requiere autorización del owner para etiquetar/push/publicación.' },
  '59f13515-d27f-48c8-ba5f-6ccda4819591': {
    t: 'smoke manual: edición directa de config fuera del bucle de tarea',
    c: 'se editó .scopegrain/config.json a mano' },
  '5f227474-6263-4833-8237-cb6396b2a458': {
    t: 'commit 96bddee986: feat(activity): registro retroactivo, superficie de worklog en viewer, i18n ES/EN',
    c: 'feat(activity): registro retroactivo, superficie de worklog en viewer, i18n ES/EN' },
  '6449c3b5-d716-4dc6-ab71-7d24286242da': {
    t: 'smoke manual: edición directa de config fuera del bucle de tarea',
    c: 'se editó .scopegrain/config.json a mano' },
  '6b915f15-28d5-4e60-8ccf-a1e47b74adf5': {
    t: 'commit 0e2262cd22: fix(viewer): favicon inline para silenciar el error 404 de consola',
    c: 'fix(viewer): favicon inline para silenciar el error 404 de consola' },
  '7dcbc8cf-4d23-4645-8421-4c36d62aa76f': {
    t: 'Pilotos de certificación en hosts reales (Claude, Codex, OpenCode)',
    c: 'Ejecutar pilotos en vivo en los hosts soportados restantes: activar scopegrain en Claude Code, Codex y OpenCode contra este u otro proyecto de ejemplo, verificar descubrimiento de skills, inventario de herramientas MCP (23 tools) y un ciclo de tarea por host, registrando la evidencia en docs/verification.md como las entradas de Devin y Antigravity.' },
  '9244b332-228f-4806-b1b1-fa45e9193a9b': {
    t: 'Decidir la licencia del producto (UNLICENSED)',
    c: 'El owner decide la licencia de distribución de Scopegrain (MIT, Apache-2.0, propietaria o mantener UNLICENSED). package.json declara actualmente UNLICENSED y el archivo inicial es solo local pendiente de revisión de procedencia y licencia. Entregable: archivo LICENSE más actualización del campo license en package.json.' },
  '94b27e54-f8eb-47ec-b4df-e27656439d55': {
    t: 'Ciclo de vida de registros de actividad: las tareas creadas por hook no pueden cerrarse legalmente',
    c: 'El hook post-commit crea registros de tarea en PLAN como evidencia, pero la política de workflow prohíbe PLAN->CLOSE directo, así que los registros de actividad inflan el backlog abierto para siempre. Diseñar un ciclo de vida legal: crearlos ya cerrados, marcarlos como actividad no accionable, o añadir una ruta de política para registros de evidencia.' },
  '9e59aac2-0061-464a-9c24-fa082fe4039a': {
    t: 'commit 4815e2c466: fix(viewer): reparar vista de artefactos/revisión y migrar la interfaz a shadcn',
    c: 'fix(viewer): reparar vista de artefactos/revisión y migrar la interfaz a shadcn' },
  'a07a4455-4124-47e0-b646-e1cbc7b22cdc': {
    t: 'commit c87b8c3528: feat(viewer): refresco silencioso por componente, nav responsive, selector de idioma, intros de pestaña',
    c: 'feat(viewer): refresco silencioso por componente, nav responsive, selector de idioma, intros de pestaña' },
  'ad5b89ff-0d0e-471c-a8d1-bb2fc9731c7b': {
    t: 'Instalar el modelo de embeddings de VantaDB para recall semántico',
    c: 'Restaurar embeddings/models/multilingual-e5-small/onnx (model.onnx + tokenizer.json) en la instalación de VantaDB para que capabilities deje de reportar fallback:true / StrictUnavailable. Paso del owner: pwsh scripts/setup-embeddings.ps1 y luego python embeddings/verify.py --check en el repo VantaDB. Verificar vía scopegrain vantadb status --probe mostrando model_present:true.' },
  'd4048666-8ec6-4cf5-b66c-17563d35ad43': {
    t: 'commit 1cf610447d: feat(viewer+vantadb): superficies operativas, visibilidad V3, proyección de worklog',
    c: 'feat(viewer+vantadb): superficies operativas, visibilidad V3, proyección de worklog' },
  'd699a2b2-e665-43b0-b6dc-bb59dfbdab40': {
    t: 'commit 54e952f8f2: fix(journal): localizadores de registro seguros ante reubicación; migrar estado a .scopegrain',
    c: 'fix(journal): localizadores de registro seguros ante reubicación; migrar estado a .scopegrain' },
  'da77532d-4c8c-41d9-9a21-30d3644533c6': {
    t: 'Proyección VantaDB L3: preferencias de usuario y persona',
    c: 'Diseñar e implementar la proyección acotada de capturas de preferencias de usuario (categoría preference/decision) desde la verdad .scopegrain hacia la memoria L3/persona de VantaDB, manteniendo .scopegrain como autoridad y la proyección idempotente y opt-in.' },
  'e201c9d1-8050-4338-b070-582b212a7343': {
    t: 'commit 3e0a96f5d3: fix(vantadb): endurecimiento de la integración stdio guiado por auditoría',
    c: 'fix(vantadb): endurecimiento de la integración stdio guiado por auditoría' },
};

let ok = 0, skip = 0, fail = 0;
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const tr = TR[d.id];
  if (!tr) { skip++; continue; }
  const tmp = path.join(os.tmpdir(), `sg-meta-${d.id.slice(0, 8)}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ set: { title: tr.t, contract: tr.c } }));
  try {
    execFileSync('node', ['bin/scopegrain.mjs', 'task', 'meta', '--project', '.',
      d.id, '--revision', String(d.revision), '--input', tmp],
      { cwd: ROOT, stdio: 'pipe' });
    ok++;
  } catch (e) {
    fail++;
    console.log(`FAIL ${d.id.slice(0, 8)}: ${String(e.stderr).slice(0, 200)}`);
  }
}
console.log(`done: ${ok} translated, ${skip} skipped, ${fail} failed`);
