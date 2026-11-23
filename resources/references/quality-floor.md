# Quality Floor

The applicable quality floor is the target project's approved contract.
Inspect actual checks and their scope. Do not suppress a failing case,
weaken an assertion, skip a boundary or change a threshold merely to pass.
Distinguish a defective test fixture from a behavioral regression using
source evidence and a discriminating reproduction.

## The 5 floor checks

The floor defines what must **never** happen, regardless of project
configuration:

1. **No new suppressions** — `#[allow(...)]`, `@ts-ignore`,
   `eslint-disable`, `# noqa`, `# type: ignore`
2. **No unimplemented stubs** — `todo!()`, `unimplemented!()`,
   `panic!("not implemented")`, `throw new Error("Not implemented")`,
   `raise NotImplementedError`
3. **No skipped/deleted tests without a reason** — `#[ignore]`, `.skip`,
   `xit`, `test.only` leftovers, a test file deleted with no explanation
   in the change
4. **No secrets in source** — API keys, tokens, passwords in code
5. **The floor itself is not weakened to make a change pass** — the
   quality-bar document only ever gets stronger (ratchet)

## Reference implementation (per-diff scanner)

A floor guard is a small script that inspects the pending diff against a
base ref and exits 0/1/2. Shape (PowerShell sketch — adapt to the project):

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

### Secrets-scanner allowlist (shape)

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

## Pipeline integration

| Point | Mode | Purpose |
|---|---|---|
| Pre-commit hook | `-DiffOnly` (changed files only) | Fast, <seconds |
| Pre-push hook | full diff vs. base branch | Complete before sharing |
| CI gate | run with `-BaseBranch <base>` | Blocks merge on FAIL |

## Exit codes

| Code | Meaning | Action |
|---|---|---|
| 0 | PASS | Continue |
| 1 | WARN | Log finding, continue (pre-commit only) |
| 2 | FAIL | Block commit/push/merge |

## Ecosystem adaptation

| Check | Rust | TypeScript | Python |
|---|---|---|---|
| Suppressions | `#[allow(...)]` | `@ts-ignore`, `eslint-disable` | `# noqa`, `# type: ignore` |
| Stubs | `unimplemented!()`, `todo!()` | `throw new Error("Not implemented")` | `raise NotImplementedError` |
| Tests | `#[ignore]`, removed `#[cfg(test)]` | `.skip`, `xit`, `test.only` | `@pytest.mark.skip` |
| Secrets | leak scanner + allowlist | same | same |
| Quality bar | the project's bar file | same | same |

## Verification

The floor guard is applied correctly when:

- [ ] The script exists and is executable
- [ ] Pre-commit hook calls it in diff-only mode
- [ ] Pre-push hook calls it in full mode
- [ ] A CI gate runs it against the base branch
- [ ] The secrets scanner has a committed project allowlist
- [ ] Exit codes 0/1/2 behave as specified

<!-- Referencias cruzadas: → ver definition-of-done.md, security-checklist.md, test-suite.md, ship-runbook.md -->
