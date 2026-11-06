# Ladder Freeze Tag

Sitio de ladder con cuentas de jugadores: registro, inicio y cierre de sesión.
No necesita instalar paquetes. Solo requiere **Node 22.13 o superior**.

## Probarlo en tu computador

```
node server.js
```

Abre http://localhost:3000. Para otro puerto: `PORT=8080 node server.js`.

## Qué hace hoy

- Registro de jugadores (nombre, email, contraseña y datos opcionales).
- Inicio y cierre de sesión. La sesión dura 12 horas, o 30 días si marcan «Recordar en cada visita».
- La portada, el ladder, el buscador y el perfil de clan se ven con el diseño de las capturas.
- «Jugadores Activos» en la portada cuenta las cuentas creadas.

## Qué NO hace todavía

- No hay desafíos programados ni panel de administración para corregir resultados.
- No tiene «olvidé mi contraseña».
- **No hay panel de administración** ni lista del staff con permisos.

- **Lista de jugadores** (menú Datos): orden alfabético, con nombre, ID, fecha de ingreso y los datos opcionales que cada jugador completó al registrarse (ICQ, AIM, MSN, sitio web), con buscador y números de página. El formulario de registro avisa que esos datos son públicos. **El email nunca se muestra.**

- **Clanes** («Mi clan» en el menú): un jugador crea un clan (queda como líder) y puede invitar a otros por nombre; el invitado acepta o rechaza. Máximo 12 miembros, un clan por jugador. El líder puede expulsar, traspasar el liderazgo y el clan se elimina si el último miembro sale. El ladder, el perfil, la lista de clanes y el buscador leen de la base de datos; el ranking ordena por ganados y perdidos.

- **Estadísticas en vivo:** «Jugadores On Line» cuenta los jugadores con sesión abierta y «Invitados» a quienes miran el sitio sin sesión. Se considera conectado a quien tuvo una pestaña abierta en los últimos 3 minutos. Se guarda en memoria, así que se reinicia con el servidor.

- **Resultados:** el líder del clan que perdió usa «Reportar derrota» (opción del menú lateral, visible solo para líderes) con la ID del clan que le ganó, **marca qué jugadores de su clan jugaron** y puede dejar un comentario. El líder del clan ganador usa «Confirmar victoria» (también en el menú lateral) (con un número si hay pendientes), revisa quién jugó y el comentario, **marca qué jugadores de su clan reciben los puntos**, puede dejar su comentario y confirma o rechaza. **La derrota se suma al clan perdedor (y a los jugadores que marcó) en el momento del reporte**; la victoria se suma al clan ganador (y a los jugadores marcados por él) solo cuando confirma. Si el ganador rechaza el reporte o el perdedor lo cancela, la derrota se descuenta. Mientras el ganador no responde, el partido queda pendiente y no aparece en Resultados de partidos. Cada partido confirmado tiene su página de detalle (Resultados de partidos → «Ver») con ganador, perdedor, rank, quién reportó, miembros, puntaje y comentarios. Un reporte sin responder queda pendiente hasta que el ganador actúe.

- **IDs:** cada clan y cada jugador tiene una ID numérica. La ID del clan se ve en el ladder (columna «Id»), en la lista de clanes y en su perfil. La ID del jugador se ve en el menú lateral al iniciar sesión («Tu ID de jugador») y en la lista de jugadores. El líder invita a un jugador escribiendo su ID, y los reportes de derrota se hacen con la ID del clan rival.

- **Menú según la sesión:** «Ingreso Nuevo jugador» solo se ve sin sesión iniciada; «Validar cuenta» se oculta cuando la cuenta ya está validada, y «Mi clan» solo aparece con sesión. Tras registrarse, el sitio lleva directo a «Validar cuenta».

## Validar cuenta

Al registrarse se genera un código de 6 dígitos (vence en 48 h, máximo 5 intentos) y se envía por email. El jugador lo escribe en «Validar cuenta» del menú, o pide uno nuevo.

Para que los correos salgan, configura estas variables (SMTP con TLS directo, normalmente puerto 465):
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.

- **Con SMTP configurado:** no se puede iniciar sesión sin validar la cuenta.
- **Sin SMTP:** el código solo aparece en la consola del servidor y el login no exige validar (si no, nadie podría entrar). Puedes forzarlo con `REQUIRE_VERIFY=1` o desactivarlo con `REQUIRE_VERIFY=0`.
- Las cuentas creadas antes de esta función quedan como validadas.

## Cómo está protegido

- Las contraseñas se guardan cifradas (scrypt con sal propia). Nunca en texto legible.
- Las sesiones usan una cookie `HttpOnly`, sin acceso desde scripts, y el servidor guarda solo la huella de cada una.
- Máximo 10 intentos fallidos de login cada 15 minutos por IP, y 20 registros por hora por IP.
- El servidor rechaza solicitudes que vengan desde otros sitios y limita el tamaño de lo que recibe.
- Cabeceras de seguridad que bloquean scripts externos.
- Los enlaces del sitio web y del logo solo aceptan `http://` o `https://`.

El límite de intentos se guarda en memoria: se reinicia si reinicias el servidor.

## Ponerlo en internet

El sitio necesita un servicio que ejecute Node de forma continua y **conserve una carpeta de datos**.
Un hosting de páginas estáticas (como GitHub Pages) no sirve, porque no ejecuta el servidor.

1. Sube esta carpeta (sin `data/`) a un servicio como Render, Railway, Fly.io o un VPS.
2. Comando de inicio: `node server.js`.
3. Variables de entorno:
   - `TRUST_PROXY=1` si el servicio pone un proxy delante (casi todos lo hacen).
   - `DATA_DIR=` ruta de un **disco persistente**. Si la carpeta de datos no persiste, **se pierden todas las cuentas** cada vez que el servicio se reinicia.
   - `COOKIE_SECURE=1` para exigir que la sesión viaje solo por HTTPS.
4. Usa siempre HTTPS. Sin él, las contraseñas viajan sin cifrar por la red.

## Temporadas (ladders), administrador y copas

- **Administrador:** es el jugador (o jugadores, separados por coma) cuyo alias pongas en la variable `ADMIN_ALIAS`. En Windows, en `INICIAR.bat` quita el `REM` de la línea `set ADMIN_ALIAS=...` y escribe tu alias. Verá el menú **Administración**.
- **Crear temporada:** nombre (ej. «Objetivo 2026»), etapa (ej. «Etapa I») y, si quieres, una fecha de cierre. Solo puede haber una activa. **Sin temporada activa no se pueden reportar partidos.**
- **Cerrar:** automáticamente al terminar el día del plazo, o cuando el administrador pulse «Cerrar temporada ahora». Se guarda la tabla final, se cancelan los reportes pendientes y el ladder vuelve a cero (los clanes y sus miembros se mantienen).
- **Copas:** los 3 primeros de cada temporada reciben copa de oro, plata y bronce. Se ven en el perfil del clan, en la tabla final de la temporada y en la lista de ladders (menú **Medal of Honor**).
- Si ya tenías datos de antes de las temporadas, se crea una primera temporada automática con todo lo jugado.

## Ranking automático

El ladder se ordena solo: más victorias primero, luego menos derrotas, luego el clan más antiguo. Las flechas verde/roja indican si el clan subió o bajó de puesto en el último cambio de resultados. Aparece **HOT** con 10 victorias seguidas o más y **COLD** con 5 derrotas seguidas o más (la racha cuenta la derrota desde que se reporta).

## Rangos y permisos del clan

| Rango | Reportar/confirmar | Reclutar | Editar clan (nombre, logo, etc.), rangos y expulsar |
|---|---|---|---|
| Líder | sí | sí | sí |
| Colíder | sí | sí | no |
| Capitán | sí | no | no |
| Miembro | no | no | no |

## Datos de prueba (opcional)

`node sembrar-prueba.js` crea 25 jugadores, 8 clanes, 21 partidos confirmados y 1 reporte pendiente para probar el sitio. Todos los jugadores se llaman `prueba_<clan>_<n>` (líderes: `prueba_alfa_1`, `prueba_bravo_1`… `prueba_hotel_1`) y tienen la contraseña `prueba1234`. Para quitarlos: `node sembrar-prueba.js --borrar` (solo borra lo de prueba). **No los dejes en el sitio público.** La base debe existir antes (arranca el servidor una vez).

## Respaldo

Toda la información está en `data/ladder.db`. Para respaldar, detén el servidor y copia la carpeta `data/` completa.
Esa base contiene correos de los jugadores: guárdala en un lugar privado.

## Archivos

- `server.js`: servidor y API (`/api/register`, `/api/login`, `/api/logout`, `/api/me`, `/api/stats`, `/api/verify`, `/api/resend`, `/api/players`, `/api/clans`, `/api/clan`, `/api/my` y `/api/clan/*`).
- `public/index.html`, `public/style.css`, `public/app.js`: el sitio.

## Panel «Administración Ladder» (parte 1)

Entra con una cuenta de personal y aparece **Administración Ladder** en el menú (el botón no se muestra a jugadores normales y el servidor además rechaza cualquier petición sin permiso).

**Roles** (siempre se leen de la base de datos, nunca del navegador):
| Rol | Puede |
|---|---|
| Superadministrador | Todo, incluida la eliminación definitiva de partidos y asignar roles. Los alias de `ADMIN_ALIAS` lo son de forma fija. |
| Administrador | Ver y modificar partidos, eliminarlos de forma lógica (restaurables), temporadas, historial. |
| Moderador | Ver partidos e historial (las funciones de revisión llegan en las siguientes partes). |

Primer uso: arranca con `ADMIN_ALIAS=tu_nombre` (en INICIAR.bat quita el `rem` de esa línea), entra y asigna roles en *Configuración de la Ladder*.

**Partidos**: filtros por clan, jugador, ID, estado, modalidad y fechas; ficha con marcador, fecha, modalidad, estado y jugadores; crear partidos a mano; eliminar (restaurable) o eliminar definitivamente (solo superadmin, escribiendo ELIMINAR). Todo cambio exige un **motivo** y recalcula victorias, derrotas y rachas desde todos los partidos de la temporada activa (no se duplica nada). Si dos personas editan a la vez, la segunda recibe un aviso y debe recargar. Los partidos de temporadas cerradas no cambian de ganador ni de estado.

Estados: *Reportado (pendiente)*, *En disputa*, *Validado*, *Rechazado*, *Anulado*, *Eliminado*. Regla: la derrota cuenta desde el reporte (también en disputa; se puede cambiar en la configuración `dispute_counts`), la victoria al validarse.

**Historial de acciones**: cada cambio queda con quién, cuándo, valores antes/después, motivo y resultado. La base de datos rechaza editar o borrar esos registros (triggers).

Pendiente para las siguientes partes: reportes con evidencias, jugadores, clanes, sanciones, denuncias, reportes a líderes.

## Panel de administración (parte 2): reportes

- **Gestión de reportes**: cola de revisión (pendientes y en disputa, los más antiguos primero), marcados, todos y eliminados. Arriba aparecen las **alertas**: reportes que el clan ganador no confirmó pasado el plazo (72 horas por defecto, se cambia en *Configuración*). La plataforma solo avisa; nunca sanciona sola.
- En la ficha de cada partido: **aprobar y validar**, **rechazar**, **marcar duplicado o inválido** (anulan el reporte y recalculan), **pedir más información**, **abrir disputa** y quitar la marca. Cada acción pide motivo y queda en el historial.
- **Evidencias**: capturas PNG/JPG/WEBP/GIF de hasta 4 MB (se comprueba el contenido real del archivo) y enlaces http/https. Se guardan en `data/evidence` con nombre aleatorio y solo se entregan a personal autorizado o a los líderes, colíderes y capitanes de los dos clanes del partido. Se pueden ocultar a los clanes y restaurar.
- **Notas privadas** (solo administración) y **resoluciones visibles** para los clanes, que las ven en *Manejo de cuenta* junto con sus evidencias. Los líderes pueden adjuntar capturas a sus partidos pendientes o en disputa.
- Moderadores: pueden revisar, pedir información, abrir disputas, escribir notas y ocultar evidencias; no pueden validar, anular ni cambiar configuración.

## Panel de administración (parte 3): jugadores, clanes y líderes

- **Jugadores**: búsqueda por nick, ID o clan. La ficha muestra datos de la cuenta (el email solo lo ve un administrador), clan y rango, victorias, derrotas y porcentaje (empates no existen en esta Ladder), historial de partidos de todas las temporadas, ajustes, notas privadas e historial administrativo.
- **Acciones sobre un jugador** (administrador, siempre con motivo): cambiar el nick, activar o desactivar la cuenta (al desactivar se cierran sus sesiones), cambiar clan y rango respetando las reglas existentes (máximo 12 integrantes, un clan no se queda sin Líder ni vacío). Un nick reservado en `ADMIN_ALIAS` no se puede usar ni cambiar, para que nadie obtenga permisos de superadministrador renombrándose.
- **Corrección de estadísticas**: la forma recomendada es corregir el partido original (parte 1). Para casos excepcionales hay un **ajuste administrativo** separado (jugador o clan): motivo obligatorio, valores antes y después en el historial, el recálculo automático lo respeta y se puede revertir. Los ajustes pertenecen a la temporada activa.
- **Clanes**: ficha con integrantes, liderazgo (hacer Líder principal, designar o quitar Colíder), datos administrativos, ajustes, partidos y reportes abiertos, notas e historial. **Líderes**: lista de Líderes y Colíderes con los reportes que deben confirmar.
- Moderadores: pueden ver jugadores y clanes y escribir notas; no pueden modificar nada.
- Las sanciones y el historial disciplinario están en la parte 4 (abajo).

## Panel de administración (parte 4): sanciones, denuncias y disciplina
Menú **Sanciones y disciplina** (pestañas Sanciones, Denuncias y Apelaciones) y, dentro de **Líderes**, los reportes disciplinarios.

- **Sanciones** (se aplican desde la ficha del jugador o del clan): advertencia, amonestación, pérdida de victorias, anulación de un resultado, suspensión temporal, suspensión de torneo, descalificación temporal, expulsión y baneo permanente.
  - Motivo de una lista configurable, descripción, gravedad, reglas infringidas, duración y fecha de inicio. Las temporales vencen solas (pasan a «Expirada»; nada se borra).
  - La pérdida de victorias y la anulación de un resultado se aplican por el mismo mecanismo que los ajustes y se deshacen al levantar la sanción.
  - Suspensión, descalificación, expulsión y baneo **bloquean** reportar, confirmar y crear o aceptar clan (en el servidor). Un clan sancionado no puede ser rival de un reporte nuevo.
  - Moderador: solo advertencias y amonestaciones. Administrador: todas menos el baneo permanente. Superadministrador: baneo permanente, escribiendo BANEAR.
  - Motivos de trampas o programas prohibidos exigen una **denuncia con la infracción confirmada**: una acusación no es culpabilidad.
- **Apelaciones**: el sancionado apela desde «Manejo de cuenta» dentro del plazo (7 días, configurable `appeal_days`); la administración acepta (levanta la sanción) o rechaza con una resolución visible.
- **Denuncias**: cualquier jugador puede denunciar (máximo 5 por día, con enlaces de evidencia). Estados: recibida, pendiente, en investigación, evidencia insuficiente, confirmada, rechazada, cerrada. Los moderadores investigan; confirmar, rechazar y cerrar requiere Administrador. Las evidencias de denuncias y sanciones solo las ve el equipo autorizado.
- **Reportes disciplinarios a líderes**: se crean contra un Líder o Colíder (opcionalmente con un partido), con plazo de respuesta. Flujo: pendiente → notificado (el líder lo ve y responde en «Manejo de cuenta») → revisión → resuelto → cerrado. Crear un reporte nunca sanciona ni notifica solo.
- Todo queda en el historial de auditoría (inmutable) y cada sanción tiene su propia línea de tiempo.
- Notas privadas disponibles también en denuncias, reportes y sanciones.


## Cuentas de prueba
Abre `PROBAR.bat` (dos veces la primera vez: la primera crea la base de datos, la segunda carga los datos de prueba y abre el sitio).
Todas las cuentas usan la clave `prueba1234`:
- **Administrador:** `prueba_admin` (entra y verás el menú *Administración*).
- **Usuario:** `prueba_alfa_1` (clan Prueba Alfa; hay otros como `prueba_bravo_1`, `prueba_eco_1`…).
**Ver las dos perspectivas a la vez en el mismo navegador:** el navegador guarda una sola sesión por dirección, así que si entras como administrador y luego abres otra pestaña en la misma dirección, verás la misma cuenta. Usa direcciones distintas: `http://127.0.0.1:3000` para el administrador y `http://localhost:3000` para el usuario (o una ventana de incógnito). Junto a tu nombre el sitio indica si la sesión es ADMINISTRADOR o usuario; si ves la cuenta equivocada, pulsa *Cerrar sesión*.
Para borrar los datos de prueba: `node sembrar-prueba.js --borrar`.


## Jugadores en vivo (Twitch y YouTube)
El menú tiene «Jugadores en vivo»: muestra con el reproductor incrustado a quienes estén transmitiendo ahora, según los canales que cada jugador dejó en *Manejo de cuenta → Mis redes*. Un canal sin transmisión no aparece.
Para detectar transmisiones se usan las APIs oficiales, que piden claves gratuitas. Defínelas como variables de entorno antes de iniciar el servidor (por ejemplo en `INICIAR.bat`, con `set NOMBRE=valor`):
- `TWITCH_CLIENT_ID` y `TWITCH_CLIENT_SECRET`: se crean en https://dev.twitch.tv/console (registrar una aplicación).
- `YOUTUBE_API_KEY`: clave de la YouTube Data API v3 en Google Cloud.
Sin claves, esa plataforma no se consulta y la página lo avisa. El resultado se guarda unos 2,5 minutos para no gastar la cuota de las APIs.
Para YouTube vale el enlace del canal (`youtube.com/@canal` o `youtube.com/channel/...`); un enlace a un video suelto no sirve. Los reproductores de Twitch solo cargan en el dominio real del sitio (`parent`), así que pruébalos con tu dirección pública.


## Server online
Menú "Server online": lista los servidores de MOHAA con IP, mapa y jugadores conectados (consulta UDP, se guarda 45 s).
El administrador (permiso de configuración) agrega los servidores en esa misma página, una línea por servidor: `Nombre | IP:puerto` (puerto de juego, 12203 por defecto).
Se consulta el puerto de juego + 97 (GameSpy, MOHAA original) y también el puerto de juego (OpenMOHAA). En el VPS/firewall debe estar permitido el tráfico UDP de salida.

## Noticias
"Noticias" (menú) lista las noticias publicadas, con filtro por tipo (Noticia, Torneo, Juego, Importante); cada una se abre en su propia página (#noticias/ID) y las últimas aparecen en la portada.
Quien tenga el rol **Encargado de noticias** o sea Administrador/Superadministrador ve debajo el "Panel de noticias": publicar, editar, guardar borradores, fijar arriba y eliminar.
El superadministrador asigna el rol en Administración Ladder → Configuración → Personal con permisos. El encargado de noticias solo ve el panel de noticias, no el resto de la administración.

## Descargas
Menú Soporte → "Descargas": guía rápida para jugadores nuevos y lista de archivos agrupados (Juego, Parches, Expansiones, Mapas, Mods y ladder, Herramientas).
Los enlaces los agrega el administrador en esa misma página (panel "Administrar descargas"). Los archivos no se alojan en el sitio: se enlaza a donde estén (tu Drive, Mega, el sitio de la comunidad, etc.).

## Links (barra lateral)
El cuadro "Links" de la portada (columna derecha, bajo Estadísticas) muestra banners de otras páginas (como en el sitio antiguo). Si no hay links dice "Aún no hay enlaces".
La administración los gestiona en el menú "Administrar Links": nombre, enlace, imagen (se sube el archivo y se ajusta sola a 150 × 60 px, o se pega su enlace https), orden con ↑ ↓, editar y eliminar.

## Subir a un servidor
Carpeta `subir-a-oracle/`: guía paso a paso en español (`GUIA.md`) y un instalador (`instalar.sh`) que deja la página como servicio, con HTTPS y copias de seguridad diarias.

## Respaldo de la base de datos
Menú "Respaldo de datos" (solo superadministrador): respaldo manual, lista y descarga. Automático cada `BACKUP_EVERY_HOURS` (24) y al apagarse; se guardan `BACKUP_KEEP` (14) en `DATA_DIR/backups`.
Copia externa opcional (S3/R2/B2): `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_KEY_ID`, `BACKUP_S3_SECRET`. `node restaurar.js` recupera el último respaldo externo si falta la base de datos.
Plan de despliegue en Render: carpeta `subir-a-render/`.
