# Suelo de calidad

El suelo de calidad aplicable es el contrato aprobado del proyecto
objetivo. Inspecciona las comprobaciones reales y su alcance. No suprimas
un caso que falla, debilites una aserción, omitas una frontera ni cambies
un umbral solo para pasar. Distingue un fixture de prueba defectuoso de una
regresión de comportamiento usando evidencia de la fuente y una
reproducción discriminante.

## Las 5 comprobaciones del suelo

El suelo define lo que **nunca** debe ocurrir, independientemente de la
configuración del proyecto:

1. **Sin supresiones nuevas** — `#[allow(...)]`, `@ts-ignore`,
   `eslint-disable`, `# noqa`, `# type: ignore`
2. **Sin stubs sin implementar** — `todo!()`, `unimplemented!()`,
   `panic!("not implemented")`, `throw new Error("Not implemented")`,
   `raise NotImplementedError`
3. **Sin pruebas omitidas/eliminadas sin razón** — `#[ignore]`, `.skip`,
   `xit`, restos de `test.only`, un archivo de pruebas eliminado sin
   explicación en el cambio
4. **Sin secretos en la fuente** — claves de API, tokens, contraseñas en el
   código
5. **El propio suelo no se debilita para hacer pasar un cambio** — el
   documento de la barra de calidad solo se vuelve más fuerte (ratchet)

## Implementación de referencia (escáner por diff)

Un guard de suelo es un pequeño script que inspecciona el diff pendiente
contra una ref base y sale con 0/1/2. Forma (boceto en PowerShell — adáptalo
al proyecto):

```powershell
# floor-guard — exit codes: 0=pass, 1=warn, 2=fail
param([string]$BaseBranch = "origin/develop", [switch]$DiffOnly = $true)

$exitCode = 0; $findings = @()

# 1. New suppressions in changed source files
$s = git diff $BaseBranch --name-only -- "*.rs" | ForEach-Object {
    git diff $BaseBranch -- $_ | Select-String '#\[allow\(|#\[deny\(|#\[warn\(' }
if ($s) { $findings += "NEW_SUPPRESSIONS: $($s.Count)"; $exitCode = 2 }

# 2. Unimplemented stubs
$stubs = git diff $BaseBranch --name-only -- "*.rs" | ForEach-Object {
    git diff $BaseBranch -- $_ | Select-String 'unimplemented!|todo!|panic!\("not implemented"' }
if ($stubs) { $findings += "UNIMPLEMENTED_STUBS: $($stubs.Count)"; $exitCode = 2 }

# 3. Ignored/deleted tests
$tc = git diff $BaseBranch --name-only -- "*test*" | ForEach-Object {
    $d = git diff $BaseBranch -- $_
    if ($d -match '#\[ignore\]|\.skip|xit\(|test\.only|mark\.skip') { "IGNORED_TEST: $_" }
    # deleted = absent on disk but still tracked at the base ref
    if (-not (Test-Path $_) -and (git ls-files --error-unmatch $_ 2>$null)) {
        "DELETED_TEST: $_ (no explanation in commit)" } }
if ($tc) { $findings += $tc; $exitCode = 2 }

# 4. Secrets (leakage scanner, e.g. gitleaks-class tool)
if (Get-Command gitleaks -ErrorAction SilentlyContinue) {
    $leaks = gitleaks detect --redact --no-banner --source . --config-path=<allowlist-config> 2>$null
    if ($leaks) { $findings += "SECRETS_DETECTED: $($leaks.Count)"; $exitCode = 2 } }

# 5. Quality-bar file not weakened (a threshold number lowered in its table)
$q = git diff $BaseBranch -- <quality-bar-file> 2>$null
if ($q -match '^-.*\|.*\d+.*\|') { $findings += "FLOOR_WEAKENED: threshold lowered"; $exitCode = 2 }

if ($findings) { Write-Host "FLOOR GUARD FAILED:" -ForegroundColor Red
    $findings | ForEach-Object { Write-Host "  - $_" } } else { Write-Host "FLOOR GUARD PASSED" }
exit $exitCode
```

### Allowlist del escáner de secretos (forma)

```toml
[allowlist]
description = "project allowlist"
paths  = ["*.md", "*.txt", "*.example", "*.sample", "test*", "*_test.*", "benches/*", "examples/*"]
regexes = [
    '''(?i)(password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]''',
    '''(?i)(api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{16,}['"]''',
    '''(?i)(secret|token)\s*[:=]\s*['"][^'"]{16,}['"]'''
]
```

## Integración en pipeline

| Punto | Modo | Propósito |
|---|---|---|
| Hook pre-commit | `-DiffOnly` (solo archivos cambiados) | Rápido, <segundos |
| Hook pre-push | diff completo vs. rama base | Completo antes de compartir |
| Puerta de CI | ejecutar con `-BaseBranch <base>` | Bloquea el merge ante FAIL |

## Códigos de salida

| Código | Significado | Acción |
|---|---|---|
| 0 | PASS | Continuar |
| 1 | WARN | Registrar hallazgo, continuar (solo pre-commit) |
| 2 | FAIL | Bloquear commit/push/merge |

## Adaptación por ecosistema

| Comprobación | Rust | TypeScript | Python |
|---|---|---|---|
| Supresiones | `#[allow(...)]` | `@ts-ignore`, `eslint-disable` | `# noqa`, `# type: ignore` |
| Stubs | `unimplemented!()`, `todo!()` | `throw new Error("Not implemented")` | `raise NotImplementedError` |
| Pruebas | `#[ignore]`, `#[cfg(test)]` eliminado | `.skip`, `xit`, `test.only` | `@pytest.mark.skip` |
| Secretos | escáner de fugas + allowlist | igual | igual |
| Barra de calidad | el archivo de barra del proyecto | igual | igual |

## Verificación

El guard de suelo está aplicado correctamente cuando:

- [ ] El script existe y es ejecutable
- [ ] El hook pre-commit lo llama en modo diff-only
- [ ] El hook pre-push lo llama en modo completo
- [ ] Una puerta de CI lo ejecuta contra la rama base
- [ ] El escáner de secretos tiene una allowlist de proyecto commiteada
- [ ] Los códigos de salida 0/1/2 se comportan como se especifica

<!-- Cross-references: → see definition-of-done.md, security-checklist.md, test-suite.md, ship-runbook.md -->
