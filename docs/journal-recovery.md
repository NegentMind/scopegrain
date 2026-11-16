# Recuperacion explicita del journal

La recuperacion opera sobre una operacion conocida, en un proyecto y workspace
ya enrolados. Coordine primero la inactividad de escritores y trabajadores;
el lock es cooperativo, no aislamiento del sistema operativo ni autenticacion
de identidad administrativa.

Consulte la operacion y su digest de intent:

```text
scopegrain journal show OPERATION --project PATH [--config REL]
```

Prepare un archivo JSON con `action`, `expectedIntentDigest` y `reason`.
`action` es `finalize-committed` o `abandon-prepared`; el motivo se conserva
literalmente. Ejemplo de opciones (`expectedIntentDigest` es un marcador de
posicion: reemplacelo por el digest real que informa `journal show`):

```json
{
  "action": "abandon-prepared",
  "expectedIntentDigest": "<digest-de-intent-devuelto-por-journal-show>",
  "reason": "operator decision after local review"
}
```

Elija la accion tras revisar la evidencia local:

```text
scopegrain journal recover OPERATION --project PATH [--config REL] --input FILE
scopegrain journal recover OPERATION --project PATH [--config REL] --input FILE --apply
```

Sin `--apply` la operacion es una vista previa de solo lectura. Con `--apply`
se vuelven a comprobar los permisos, el intent, los snapshots, el head y el
indice antes de persistir la decision. El recibo conserva la primera fecha y
el primer motivo; un cambio de decision o motivo es un conflicto.

`finalize-committed` exige un marcador de commit valido. La coincidencia de
bytes en la fuente no demuestra que la operacion haya terminado y no permite
crear un marcador. `abandon-prepared` conserva un resultado no confirmado:
los archivos ausentes, parciales, coincidentes o ajenos no se revierten,
adoptan, borran ni modifican. Revise y resuelva las fuentes por separado.

Los historiales incompletos o corruptos, snapshots invalidos y locks huerfanos
fallan de forma cerrada; no se reconstruyen ni se roban locks automaticamente.
El lock compara identidad `dev`/`ino` y token antes de liberarse, pero es
cooperativo: esas comprobaciones no son un unlink atomico del sistema
operativo, por lo que la coordinacion externa sigue siendo responsabilidad
del operador.
Una reserva activa sin indice se detecta al listar pendientes. Si el puntero
activo es nulo, el listado acotado no puede detectar un indice historico
ausente: una pagina vacia no demuestra sincronizacion global. La recuperacion
explicita de la operacion conocida puede reconstruir su indice; una auditoria
integral separada es necesaria para detectar ausencias desconocidas.
