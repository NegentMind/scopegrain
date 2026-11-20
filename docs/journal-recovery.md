# Recuperacion explicita del journal

La recuperacion opera sobre una operacion conocida, en un proyecto y workspace
ya enrolados. Coordine primero la inactividad de escritores y trabajadores;
el lock es cooperativo, no aislamiento del sistema operativo ni autenticacion
de identidad administrativa.

Liste los eventos pendientes de reconocimiento con una ventana acotada
(`--since-sequence` pagina por secuencia de journal, `--limit` acota la
pagina):

```text
scopegrain journal list --project PATH [--config REL] [--since-sequence N] [--limit N]
```

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

## Operaciones de actualizacion (CAS)

Las operaciones `update` siguen el mismo ciclo `prepared`/`committed` y se
recuperan con las mismas acciones, digest de intent esperado y recibo
inmutable. Un evento `update` declara `previousHash` (hash de los bytes
esperados actuales) y `sourceRevision` (revision esperada actual); el CAS
se comprueba antes de reservar secuencias y de nuevo bajo el lock antes
del renombrado atomico temporal+rename. Un `previousHash` que no coincide,
una fuente ausente o un destino no regular es un conflicto cerrado
(`JOURNAL_SOURCE_CONFLICT`) sin estado de journal reservado; un fallo en la
fase de aplicacion conserva el recibo incierto `unconfirmed`/`prepared`
igual que en las creaciones.

La recuperacion es identica: `finalize-committed` exige el marcador de
commit; `abandon-prepared` conserva un resultado no confirmado y nunca
restaura la imagen previa: los bytes actualizados, parciales o ajenos
permanecen como estan. La imagen previa verificada queda persistida como
`snapshots/<previousHash>.blob` solo como evidencia para una restauracion
manual revisada; la recuperacion jamas la restaura automaticamente.
El snapshot de cada evento (`snapshotRef`) es siempre la post-imagen.

El CAS es cooperativo bajo el lock del journal: escritores que no pasan
por el journal pueden intercalarse en la ventana entre la verificacion y
el renombrado, sin aislamiento del sistema operativo. El `sourceRevision`
declarado es metadato de procedencia: el kernel no mantiene un indice por
registro ni verifica el numero contra operaciones historicas; la coherencia
de cadena (revision resultante = esperada + 1, `previousHash` igual al
`sourceHash` previo) es una comprobacion del modelo de lectura, no un gate
de escritura.

Los historiales incompletos o corruptos y los snapshots invalidos fallan de
forma cerrada; no se reconstruyen automaticamente.

## Recuperacion de locks obsoletos

Los locks llevan una carga JSON `{t, pid, at}` con el token, el pid del
escritor y la marca temporal. La garantia de recuperacion es:

- **Pid muerto**: el lock se reclama en el siguiente `acquire`. Un proceso
  que ya no existe no puede terminar su seccion, asi que retener su lock
  bloquearia el journal para siempre.
- **Pid vivo**: el lock nunca se rompe, por antiguo que sea. Un escritor
  suspendido sigue siendo un escritor real; romper su lock permitiria un
  segundo escritor en la misma seccion.
- **Sin metadatos** (tokens planos heredados, archivos de cero bytes): el
  lock se reclama solo tras superar una antiguedad de una hora en `mtime`.
- **Carrera de reemplazo**: la reclamacion verifica de nuevo la identidad
  `dev`/`ino` entre la inspeccion y el unlink; un delete+recreate concurrente
  preserva el lock del sucesor.

El lock sigue siendo cooperativo: compara `dev`/`ino` y token antes de
liberarse, pero esas comprobaciones no son un unlink atomico del sistema
operativo; la coordinacion externa (no lanzar dos agentes escribiendo sobre
el mismo estado) sigue siendo responsabilidad del operador.

## Compactacion con archivado total

Las operaciones terminales — `committed` con todos sus eventos reconocidos,
o `abandoned` tras recuperacion — se archivan intactas, nunca se borran:

```text
scopegrain journal compact --project PATH [--config REL]
```

El comando mueve `operations/<id>` a `archive/operations/<id>` bajo el lock
del journal. Las operaciones pendientes, activas, `prepared` o con eventos
sin reconocer se conservan. Los snapshots son direccionados por contenido y
compartidos, por lo que permanecen donde estan; la procedencia se preserva
byte a byte y las lecturas (`journal show`, listados acked) resuelven ambas
ubicaciones. `head.json` mantiene `pendingOperations`, el contador que el
arranque de sesion consulta en lugar de escanear el journal.

Una reserva activa sin indice se detecta al listar pendientes. Si el puntero
activo es nulo, el listado acotado no puede detectar un indice historico
ausente: una pagina vacia no demuestra sincronizacion global. La recuperacion
explicita de la operacion conocida puede reconstruir su indice; una auditoria
integral separada es necesaria para detectar ausencias desconocidas.
