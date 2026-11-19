# Public Contracts

- Verify a symbol or interface exists before documenting it as supported.
- Preserve observable behavior or explicitly manage a breaking change.
- Validate untrusted inputs and external responses at boundaries; fail
  fast on locally-invalid arguments before dispatching to a remote service.
- Keep error semantics, examples and protocol metadata consistent.
- Do not expose a disabled capability as a supported default; a degraded
  or fallback capability must be reported as such, not presented healthy.
- Do not collapse partial or degraded responses (abstained results,
  truncation, abstention reasons) into an indistinguishable empty success;
  propagate those signals to the caller.
- Derive release version and compatibility from this project's sources,
  not another project's remembered version.
