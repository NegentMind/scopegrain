# Scopegrain: propuesta visual privada

Estado: propuesta de diseno, NO interfaz implementada. No modificar codigo
del producto ni crear una aplicacion o servidor. Los datos de demostracion
son sinteticos y deben estar identificados como tales en las imagenes.

## Contexto y direccion

Persona: operador tecnico que cambia entre agentes y proyectos y necesita
entender que trabajo esta bloqueado, por que, con que evidencia y si la
memoria esta actualizada. La accion principal es localizar un registro y
seguir sus relaciones; no leer metricas decorativas ni ejecutar comandos.

Modo: Operate. Superficie local, densa pero legible, escritorio y movil.
El concepto propio es un cuaderno de ingenieria instrumentado: alcance,
granularidad y cadena de decisiones visibles. No un dashboard SaaS con
cuatro tarjetas de indicadores ni un clon de gestor Kanban.

## Filosofia: crecimiento medido

El alcance se expresa mediante marcos abiertos, no cajas que encierran
cada dato. La composicion combina un eje estable de lectura con subdivisiones
de escala: una decision pequena recibe espacio pequeno; la relacion entre
sus razones permanece visible. La ejecucion debe transmitir trabajo experto
mediante alineaciones y una jerarquia meticulosamente construida.

La materia es una superficie casi blanca, ligeramente verdosa, tinta
profunda y un acento de arcilla usado con disciplina. La trama de registro
es muy tenue y solo aparece en la marca, nunca detras del texto de trabajo.
La precision del contraste y las separaciones deben demostrar oficio,
no efectos llamativos ni texturas que impidan leer.

La tipografia diferencia voz y operacion: una grotesca expresiva para la
marca, una sans humanista legible para el trabajo y una monoespaciada
para claves, revisiones y estados. El cuidado de proporciones y espaciado
debe sentirse deliberado; ningun numero decorativo ocupa el lugar de
informacion que ayude a decidir.

El gesto distintivo es una cadena documental: contexto, decision, tarea,
verificacion y review. Las conexiones sugieren trazabilidad, no certificacion
automatica. El resultado debe parecer cuidadosamente compuesto por una
persona experta: contenido reconocible, aire suficiente y ningun elemento
que finja una capacidad o una medicion.

## Tokens y recursos

- fondo #F6F7F3; tinta #1A2923; acento #BF4F2B;
  estado positivo #34644B; separador #D8DED6; enlace #425C70.
- Titulares: primera disponible localmente entre Bricolage Grotesque,
  Outfit, Instrument Sans, Manrope, Noto Sans.
- Cuerpo: Instrument Sans, Public Sans, Manrope, Noto Sans, en ese orden.
- Codigo: DM Mono, IBM Plex Mono, JetBrains Mono, Noto Sans Mono.
- Usar fuentes locales de canvas-design/canvas-fonts u otra copia ya
  instalada. No descargar, instalar ni usar Arial/Inter/Roboto por defecto.
- Registrar los archivos de fuente realmente usados; no inventar licencias.
- Esquinas discretas, reglas finas, sin glassmorphism, sombras grandes,
  arcoiris, emojis, gradientes purpura ni indicadores falsos.

## Marca

Banner PNG 1600x560 y simbolo PNG 512x512 transparente.
Texto exacto: "Scopegrain".
Descriptor: "Proportional engineering for coding agents."
Linea secundaria: "Context / Decisions / Evidence".
No agregar badges de CI aprobado ni paquetes publicados.

Simbolo original: dos esquinas de marco abiertas (superior izquierda e
inferior derecha), dentro un cuadrado grande inferior izquierdo, dos
cuadrados medianos en el centro y cuatro pequenos superiores derechos.
Las escalas sugieren pasar de alcance a granularidad. Sin cerebro, robot,
hexagono generico de IA ni imitacion de logos ajenos.

## Datos congelados para las vistas de ejemplo

No derivar metricas ni presentar estos datos como registros del proyecto.
Mostrar "DESIGN PREVIEW / SAMPLE DATA" claramente en ambas vistas.
Workspace: "Sample workspace". Area seleccionada: "All areas".

| Key | Work | Area | State |
| --- | --- | --- | --- |
| SG-101 | Workspace onboarding | Core | PLAN |
| SG-102 | VantaDB namespace isolation | Memory | RESEARCH |
| SG-103 | Native host skills | Integrations | ACT |
| SG-104 | Sync queue recovery | Memory | VERIFY |
| SG-105 | Installation receipts | Lifecycle | REVIEW |
| SG-106 | Bilingual user guide | Docs | ACCEPT |

Panel memoria, estado simulado exacto: "VantaDB: offline (sample)".
Texto: "Local records remain available. Synchronization is queued."
No mostrar porcentajes, contadores derivados, duraciones o checks aprobados.

## Interfaz escritorio

PNG 1440x1000. Navegacion izquierda de unos 224 px, lectura central y
inspector derecho. Cabecera compacta con workspace/area y estado local.
Titulo principal "Project ledger".

Navegacion agrupada:
- Work: Backlog, Tasks, Plans, Progress.
- Knowledge: Research, Decisions, Designs, Memory.
- Assurance: Verifications, Reviews, Reports, Results.

Centro: tabla de registros de ejemplo, orden y separaciones legibles,
busqueda y filtro, sin tarjetas redundantes. Seleccionar SG-104.
Inspector: "Evidence chain" con Specification / Design / Task /
Verification / Review, cada enlace marcado como ejemplo, sin fingir
pruebas superadas. Una zona de cola y salud separada del estado de tareas.

## Interfaz movil

PNG 390x844. Misma informacion, no miniatura de escritorio.
Navegacion plegada, selector workspace/area, lista legible de registros
y detalle SG-104 con cadena de evidencia resumida. El aviso offline y
el identificador de diseno deben seguir visibles. Evitar texto recortado.

## Entrega

Archivos privados bajo .tasksystem/research/design-preview/:
- scopegrain-banner.png
- scopegrain-mark.png
- dashboard-desktop.png
- dashboard-mobile.png
- visual-philosophy.md (copiar la filosofia de este brief)
- render.py u otro generador local y font-sources.md

No publicar, commitear, instalar dependencias ni iniciar servicios/tests.
Las imagenes son comps propuestos para revision, no evidencia de runtime.
