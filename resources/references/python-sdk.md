# Python SDK Topics

Inspect supported Python versions, public API, packaging and error behavior.
For native bindings inspect ownership, GIL/runtime interaction, object
lifetime, conversion and cancellation using the actual binding library.
Compare examples and signatures with code. Native and pure-Python
implementations must not be presumed to have identical capabilities.

This is the structure for a Python-SDK / native-binding reference. Record
the project's real facts under each heading.

## Build and test contract

- [ ] **Hermetic test environment**: tests run against a project-created
      virtualenv (a bootstrap script that builds the binding and creates
      the venv), never against a global interpreter install. Record the
      exact setup script and the test invocation it produces.
- [ ] **Editable install** path from source (`pip install -e ./<pkg>`) and
      which build backend it drives (`maturin`/PyO3, `setuptools`,
      `scikit-build-core`, …).
- [ ] **Distribution name vs. import name** — they often differ
      (`pip install foo-py` → `import foo_py`). Record both; confusing them
      breaks installs and docs.
- [ ] **Minimum Python version** and which wheel targets the release
      actually publishes.

## Native-binding review surface

For FFI bindings (PyO3-class or equivalent), verify with the real binding
source, not assumptions:

- [ ] **Ownership/lifetime**: who owns each object crossing the boundary;
      no use-after-free possible from Python's GC ordering.
- [ ] **GIL/runtime interaction**: the GIL is released around blocking or
      CPU-heavy calls; no deadlocks where Python threads wait on native
      locks held during Python callbacks.
- [ ] **Error mapping**: native errors → a documented Python exception
      hierarchy (typed, catchable, with stable error codes/messages);
      no panics/abort crossing the FFI boundary.
- [ ] **Type conversion**: boundary conversions validated (int overflow,
      string encoding, buffer protocols); no silent truncation.
- [ ] **Cancellation/interruptibility**: Ctrl-C / cancellation semantics
      work; long native calls are interruptible or chunked.
- [ ] **Type stubs**: `.pyi` stubs exist and match the runtime signatures —
      stale stubs are a documented-drift finding.

## Documentation checks

- [ ] Examples and signatures in docs match the real API (run them or
      diff signatures; docs that trail the binding are findings).
- [ ] Capability parity between the native binding and any pure-Python or
      other-language surface is stated; never presume identical features.

<!-- Referencias cruzadas: → ver clean-code-clean-architecture.md, test-suite.md, security-checklist.md -->
