# Evaluación: anclaje externo de checkpoints del journal

> Evaluación de la auditoría 2026-11-24, complementaria a
> [records-integrity-design.md](records-integrity-design.md). El
> checkpoint firmado cubre rollback/truncation/fabricación **dentro**
> del perímetro local; su hueco declarado es el borrado o la
> sustitución total de `checkpoints.jsonl` cuando el verificador no
> conoce el último digest por vía externa. El anclaje externo cierra
> ese hueco. Esto evalúa opciones; no hay implementación.

## 1. Qué se ancla

El artefacto a anclar es el **digest del último checkpoint**
(`sha256(JCS(checkpoint))` del diseño) — 32 bytes que prueban «este
estado del journal existía en este instante». Anclar el digest, no el
fichero, minimiza coste y exposición (nada de contenido sale del
perímetro).

## 2. Opciones evaluadas

| Opción | Qué prueba | Coste | Beneficio de auditoría | Encaje local-first |
|---|---|---|---|---|
| **Copia exportada manual** (`journal verify --export` → copia fuera del árbol) | Existencia previa contra una copia que el atacante quizá no alcanza | 0 deps, ~0 LOC (ya diseñado en el bundle exportable) | Media: sólo tan fuerte como la separación del segundo medio | Excelente: sin red, sin servicios |
| **`git tag -s` firmado** (digest en el mensaje del tag, o `checkpoints.jsonl` exportado commiteado a un repo de auditoría) | Estado en el instante del tag + binding a identidad GPG/SSH del release | ~0 extra: ya se propone tag firmado en [release-runbook.md](release-runbook.md) | Buena: git history + hosting remoto (GitHub) dan tercera copia y sellado temporal débil | Bueno: git ya es el flujo; la firma de tag requiere clave existente |
| **RFC 3161 TSA** (p. ej. freetsa) | Timestamp cualificado del digest por una autoridad externa | Bajo: una petición HTTPS + fichero `.tsr` | Media-buena: prueba temporal externa sin identidad | Regular: red puntual opt-in |
| **OpenTimestamps** (`ots stamp` sobre el digest) | Inclusión del digest en un árbol anclado a Bitcoin | Bajo: CLI o lib; gratis, sin cuenta; confirmación asíncrona | Buena: anclaje público permanente sin depender de una autoridad | Bueno: red opt-in, sin identidad |
| **Rekor / Sigstore** (`cosign sign-blob` del digest o del `checkpoints.jsonl`) | Entrada inmutable en transparency log público + identidad firmante (keyless OIDC o clave) | Medio-alto: binario cosign, flujo OIDC o gestión de claves, verificación contra el log | La más alta: tercero público, queryable, con identidad | Pobre para el uso diario local; razonable como opción de release |

## 3. Análisis

- **Para auditoría interna/forense**, la barrera real es «¿conoce el
  verificador un digest más allá del alcance del atacante?». La copia
  exportada y el tag firmado resuelven eso a coste casi cero. OTS y
  Rekor añaden *public verifiability* — relevante sólo si terceros
  deben auditar el journal sin confiar en el operador, un caso que un
  harness local-first no tiene por defecto.
- **`network:"ask"`** de `policy/workflow.json` obliga: cualquier
  anclaje con red es opt-in explícito por operación, nunca automático.
- Rekor tiene además el problema contrario: el digest del checkpoint es
  público — inofensivo (son hashes), pero el *hecho* de anclar con
  cadencia revela ritmo de actividad. Detalle menor, declarado.
- El tag firmado cubre sólo releases; el journal avanza entre releases.
  Para continuidad entre releases hace falta export periódico o anclaje
  por operación — de ahí la recomendación por capas.

## 4. Recomendación

**Capas opt-in, ninguna obligatoria:**

1. **Por defecto (cero coste):** `journal checkpoint` + export del
   último checkpoint a una segunda ubicación fuera del árbol
   journaled (otro disco, repo privado, email — a elección del
   operador). Es la diferencia entre «detectable» y «probablemente
   detectable».
2. **En cada release:** `git tag -s` cuyo mensaje incluya
   `journal-checkpoint: <digest>` (una línea extra en el comando del
   runbook; ~coste cero) o, mejor, el bundle
   `{head.json, checkpoints.jsonl}` exportado y adjunto al release.
3. **Opcional (auditoría pública):** `cosign sign-blob` sobre
   `checkpoints.jsonl` exportado → Rekor. Recomendado sólo si el
   proyecto publica evidencia para terceros; OpenTimestamps es la
   alternativa más ligera si se quiere anclaje público sin OIDC.
4. **No recomendado:** RFC 3161 como única capa (dependencia de una
   autoridad concreta sin beneficio sobre el tag firmado), y
   cualquier anclaje automático en el commit path (violaría
   `network:"ask"` y acoplaría el journal a un servicio externo).

La decisión final: el diseño de `records-integrity-design.md` es
suficiente sin anclaje para el uso local; el anclaje es una mejora
incremental que se activa donde ya hay un canal de confianza (git
remoto, release firmada), no una dependencia nueva.
