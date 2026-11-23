# Selección de verificación

Parte de los criterios de aceptación y de la evidencia real de scripts/CI
del proyecto. Selecciona comprobaciones acotadas para el cambio y una
puerta de integración final acordada. Registra las pruebas omitidas, las
dependencias ausentes y los vacíos de versiones soportadas. Nunca infieras
un resultado exitoso a partir de un comando documentado. Separa la
construcción unitaria, las pruebas de transporte y la integración con host
real.

Esta es la estructura de una referencia de suite de pruebas de un proyecto.
Registra los comandos reales y las reglas estrictas de alcance; los ejemplos
siguientes son ilustrativos.

## Niveles de comandos

| Nivel | Forma | Cuándo |
|---|---|---|
| Iteración (acotada) | `<runner> --profile <audit-profile> -p <package>` — siempre acotado al paquete tocado | El ciclo diario de edición |
| Prueba única | `<runner> --test <name>` o el flag de filtro del framework | Depuración de un caso |
| Tras feature flag | `<runner> --features "<flag>" --test <name>` | Pruebas que solo existen tras un feature flag |
| Suite completa (deliberada) | `<runner> --workspace` o equivalente | Verificación de cierre de tarea, certificación, release — **nunca** el valor por defecto de iteración |
| Fuzz / nocturna / por plataforma | Carril separado, normalmente excluido del workspace | Programada o bajo demanda, con sus propios requisitos de toolchain |

## Regla estricta de alcance

**Ejecuta siempre los comandos de iteración acotados al paquete tocado.**
Una compilación de default-member a nivel workspace puede unificar feature
flags en un directorio de build compartido y colgar o colisionar (p. ej. un
servidor de pruebas que enlaza un puerto fijo). La forma de workspace
completo solo es legítima como comprobación final deliberada.

## Categorías de pruebas a enumerar

- [ ] Pruebas unitarias (co-ubicadas o `tests/unit/`)
- [ ] Pruebas de integración por subsistema (`tests/<domain>/`)
- [ ] Pruebas de API/transporte (bindings, superficie de red)
- [ ] Suites de certificación/larga duración (marcadas; fuera de la puerta por defecto)
- [ ] Objetivos property/fuzz y sus restricciones de toolchain
- [ ] Pruebas de interoperabilidad con host real — mantenidas separadas de las pruebas in-process

## Reglas de evidencia

- [ ] Una afirmación de "pass" nombra el comando, el alcance y el resultado
      observado; un comando documentado no es un resultado exitoso.
- [ ] Las pruebas omitidas, los fixtures ausentes y los vacíos de versiones
      soportadas se registran en el registro de la tarea — el silencio
      implica cobertura.
- [ ] Un fallo se reproduce con un caso mínimo discriminante antes de
      etiquetarse como bug de producto frente a fixture roto.

<!-- Cross-references: → see testing-patterns.md, build-system.md, definition-of-done.md, quality-floor.md -->
