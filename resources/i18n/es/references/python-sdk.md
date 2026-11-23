# Temas del SDK de Python

Inspecciona las versiones de Python soportadas, la API pública, el
empaquetado y el comportamiento de errores. Para bindings nativos
inspecciona la propiedad (ownership), la interacción GIL/runtime, el tiempo
de vida de los objetos, la conversión y la cancelación usando la biblioteca
de binding real. Compara ejemplos y firmas con el código. Las
implementaciones nativas y las de Python puro no deben presumirse con
capacidades idénticas.

Esta es la estructura de una referencia de SDK de Python / binding nativo.
Registra los hechos reales del proyecto bajo cada encabezado.

## Contrato de build y pruebas

- [ ] **Entorno de pruebas hermético**: las pruebas corren contra un
      virtualenv creado por el proyecto (un script de bootstrap que compila
      el binding y crea el venv), nunca contra una instalación global del
      intérprete. Registra el script de setup exacto y la invocación de
      pruebas que produce.
- [ ] Ruta de **instalación editable** desde fuente (`pip install -e ./<pkg>`)
      y qué backend de build acciona (`maturin`/PyO3, `setuptools`,
      `scikit-build-core`, …).
- [ ] **Nombre de distribución vs. nombre de import** — a menudo difieren
      (`pip install foo-py` → `import foo_py`). Registra ambos; confundirlos
      rompe instalaciones y documentación.
- [ ] **Versión mínima de Python** y qué objetivos de wheel publica
      realmente el release.

## Superficie de revisión de bindings nativos

Para bindings FFI (clase PyO3 o equivalente), verifica con la fuente real
del binding, no con suposiciones:

- [ ] **Ownership/tiempo de vida**: quién posee cada objeto que cruza la
      frontera; imposibilidad de use-after-free por el orden del GC de
      Python.
- [ ] **Interacción GIL/runtime**: el GIL se libera alrededor de llamadas
      bloqueantes o de CPU intensiva; sin deadlocks donde hilos de Python
      esperan locks nativos mantenidos durante callbacks de Python.
- [ ] **Mapeo de errores**: errores nativos → una jerarquía documentada de
      excepciones de Python (tipadas, capturables, con códigos/mensajes de
      error estables); ningún panic/abort cruzando la frontera FFI.
- [ ] **Conversión de tipos**: conversiones de frontera validadas
      (overflow de int, codificación de strings, protocolos de buffer);
      sin truncamiento silencioso.
- [ ] **Cancelación/interrumpibilidad**: la semántica de Ctrl-C /
      cancelación funciona; las llamadas nativas largas son interrumpibles
      o fragmentadas.
- [ ] **Stubs de tipos**: existen stubs `.pyi` y coinciden con las firmas
      en runtime — stubs obsoletos son un hallazgo de deriva documentada.

## Comprobaciones de documentación

- [ ] Los ejemplos y firmas de la documentación coinciden con la API real
      (ejecútalos o compara firmas; la documentación que va por detrás del
      binding es un hallazgo).
- [ ] Se declara la paridad de capacidades entre el binding nativo y
      cualquier superficie en Python puro u otro lenguaje; nunca presumas
      características idénticas.

<!-- Cross-references: → see clean-code-clean-architecture.md, test-suite.md, security-checklist.md -->
