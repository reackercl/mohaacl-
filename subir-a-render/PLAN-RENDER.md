# Plan de despliegue en Render + respaldo de SQLite

## 0. Lo importante antes de elegir
La página guarda todo en **un archivo SQLite**. En Render:

| | Plan gratis | Plan Starter + disco |
|---|---|---|
| Costo | $0 | desde ~US$7/mes + el disco (revisa el precio en tu panel) |
| La página duerme | Sí, tras 15 min sin visitas (despertar ≈ 1 min) | No |
| El archivo SQLite | **Se borra** en cada reinicio, nuevo despliegue o al dormir | **Se conserva** en el disco |
| Correos por SMTP | Render bloquea los puertos 25/465/587 | Revisa en la documentación de Render |
| Uso recomendado | Pruebas con copia externa obligatoria | Producción |

Fuentes: [documentación de Render (plan gratis)](https://render.com/docs/free) y [discos persistentes](https://render-www.onrender.com/docs/disks). El precio de Starter lo tomé de un blog de terceros: confírmalo en render.com.

Con disco: solo se conserva lo que esté bajo la ruta del disco (`/var/data`), solo corre **una** instancia y cada despliegue tiene una breve caída. Render saca una foto del disco cada 24 h y guarda 7 días.

## 1. Respaldo de SQLite (ya incluido en la página)
- **Automático:** cada `BACKUP_EVERY_HOURS` (24 por defecto) y **al apagarse** el servidor (reinicio, nuevo despliegue o cuando Render lo duerme). Copia consistente con `VACUUM INTO`, comprimida, en `DATA_DIR/backups`; se conservan los últimos `BACKUP_KEEP` (14).
- **Manual:** menú **Respaldo de datos** (solo superadministrador): crear ahora, ver la lista y descargar cada archivo `.sqlite.gz`.
- **Copia externa (recomendada):** se sube además a un almacenamiento compatible con S3. Opciones: Cloudflare R2, Backblaze B2 o AWS S3 (R2 y B2 tienen un plan gratis; confirma los límites vigentes). Variables:
  `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_KEY_ID`, `BACKUP_S3_SECRET` (y opcional `BACKUP_S3_REGION`, por defecto `auto`, y `BACKUP_S3_PREFIX`, por defecto `ladder/`).
  - Ejemplo R2: endpoint `https://<ID_DE_CUENTA>.r2.cloudflarestorage.com`, región `auto`.
  - Ejemplo B2: endpoint `https://s3.<región>.backblazeb2.com`, región `<región>`.
- **Restaurar automático:** `restaurar.js` corre antes de arrancar. Si **no existe** la base de datos y hay copia externa, recupera `ladder-latest.sqlite.gz`. Si la base ya existe, no toca nada.
- **Restaurar a mano:** descomprime el `.gz`, renombra a `ladder.db`, déjalo en la carpeta de datos con el servidor detenido y arranca.

## 2. Pasos de despliegue (plan recomendado)
1. **Cuenta y repositorio:** crea un repositorio **privado** en GitHub y sube el contenido de `ladder-server/` (sin la carpeta `data/`). Copia `subir-a-render/render.yaml` a la raíz del repositorio.
2. **Copia externa (hazlo antes):** crea un bucket (R2 o B2) y una llave de acceso con permiso de lectura y escritura solo a ese bucket.
3. **Render:** New + → **Blueprint** → elige el repositorio → te pedirá `ADMIN_ALIAS` y las 4 variables `BACKUP_S3_*`.
4. **Primer arranque:** mira los *Logs*; debe decir `Ladder en marcha` y `Restauración: sin-respaldo`/`ya-existe`.
5. **Versión de Node:** en el log de compilación verifica que Node sea **22.13 o superior** (la página lo necesita para SQLite).
6. **Entra** a `https://ladder-mohaa.onrender.com` (o el nombre que Render te asigne), regístrate con el alias de `ADMIN_ALIAS` y ve a **Respaldo de datos → Crear respaldo ahora**. Debe decir "subido al almacenamiento externo".
7. **Prueba de restauración (importante):** en Render usa *Manual Deploy → Clear build cache & deploy* con el disco recién creado o prueba en local: `BACKUP_S3_*=... DATA_DIR=./prueba node restaurar.js` y revisa que aparezca `ladder.db`.

## 3. Plan gratis (solo pruebas)
Usa `render-gratis.yaml` en lugar de `render.yaml`. La copia externa es **obligatoria**: sin ella pierdes cuentas y partidos cada vez que la página duerme. Aun con ella, se pierde lo ocurrido desde el último respaldo si Render corta sin avisar (por eso `BACKUP_EVERY_HOURS=1`). La verificación de correo por SMTP no funcionará (puertos bloqueados): no actives `REQUIRE_VERIFY`.

## 4. Dominio
Render entrega una dirección `https://…onrender.com` con HTTPS. Un dominio propio se conecta con un registro CNAME. No estoy seguro de que DuckDNS permita CNAME, así que usa la dirección de Render hasta tener un dominio propio.

## 5. Seguridad y mantenimiento
- Contraseñas largas para los administradores. Cambia `ADMIN_ALIAS` solo con alias de confianza.
- Descarga un respaldo manual cada semana y guárdalo fuera de Render.
- Revisa los *Logs* tras cada despliegue.
- Los servidores de "Server online" se consultan por UDP: no he probado si Render permite ese tráfico saliente. Si todos aparecen "Sin respuesta", puede ser eso.

## 6. Migrar después a un VPS
1. Crea un respaldo manual (o usa `ladder-latest.sqlite.gz` del bucket).
2. En el VPS sigue `subir-a-oracle/GUIA.md`; antes de arrancar, descomprime el respaldo como `/var/lib/ladder/ladder.db` (dueño `ladder`).
3. Cambia el dominio a la IP nueva y apaga Render.
