# Subir el ladder a Oracle Cloud (gratis) con un dominio de DuckDNS

Tiempo aproximado: 40–60 minutos la primera vez.

## 1. Crear tu dominio gratis (DuckDNS)
1. Entra a https://www.duckdns.org e inicia sesión (con Google, GitHub, etc.).
2. En "domains" escribe el nombre que quieras (por ejemplo `ladder-mohaa`) y pulsa **add domain**.
   Tu dirección será `ladder-mohaa.duckdns.org`. Todavía déjala sin IP; la pondrás en el paso 3.

## 2. Crear la VM gratuita en Oracle Cloud
1. Crea tu cuenta en https://cloud.oracle.com (pide una tarjeta solo para verificar; usando "Always Free" no se cobra).
2. Menú ☰ → **Compute → Instances → Create instance**.
3. Imagen: **Ubuntu 22.04 o 24.04**. Forma (Shape): una **Always Free** (por ejemplo VM.Standard.E2.1.Micro, o Ampere A1 si hay cupo).
   - Si dice "Out of capacity", prueba otra vez más tarde u otra zona de disponibilidad.
4. En "Add SSH keys" elige **Generate a key pair** y **descarga la clave privada** (guárdala bien: es tu llave de entrada).
5. Crea la instancia y copia su **Public IP address**.
6. Abre los puertos en Oracle: en la instancia → su **Subnet** → **Security List** → **Add Ingress Rules**:
   - Source CIDR `0.0.0.0/0`, protocolo TCP, puerto destino **80**.
   - Otra regla igual con el puerto **443**.

## 3. Apuntar el dominio a la VM
En duckdns.org, en tu dominio, pega la **Public IP** de la VM y pulsa **update ip**.

## 4. Subir la página y ejecutar el instalador
Desde tu PC (Windows PowerShell o Mac/Linux), en la carpeta donde tienes el zip y la clave:

```
scp -i CLAVE.key ladder-freeze-tag.zip ubuntu@IP_DE_LA_VM:~
ssh -i CLAVE.key ubuntu@IP_DE_LA_VM
```

Ya dentro de la VM:

```
sudo apt-get install -y unzip
unzip ladder-freeze-tag.zip
cd ladder-server/subir-a-oracle
sudo bash instalar.sh ladder-mohaa.duckdns.org TU_ALIAS_DE_ADMIN
```

(Cambia `ladder-mohaa.duckdns.org` por tu dominio y `TU_ALIAS_DE_ADMIN` por el alias con el que te vas a registrar como administrador.)

## 5. Primer uso
1. Abre `https://tu-dominio.duckdns.org`.
2. El instalador crea un codigo aleatorio de alta administrativa y lo guarda con permisos restringidos (solo root) en /etc/ladder/bootstrap.env. Para verlo **privadamente** dentro de la VM (no lo pegues en Discord, capturas ni GitHub), ejecuta:

       sudo sed -n 's/^ADMIN_SETUP_TOKEN=//p' /etc/ladder/bootstrap.env

3. Regístrate con el alias de administrador usado al instalar. En «Codigo de alta administrativa» introduce ese codigo. Tu contraseña de usuario es **otra** contraseña distinta, elegida al registrarte.
4. Comprueba que aparece el panel de Administración. Entra a "Administrar Links", "Server online" y "Descargas" para cargar el contenido.

El instalador conserva el codigo si se ejecuta otra vez; no lo rota en cada actualizacion. Nunca lo guardes en archivos del repositorio. El instalador acepta alias de 3 a 24 caracteres compuestos por letras, numeros, guion o guion bajo.

## Cosas útiles
- Ver si funciona: `sudo systemctl status ladder`
- Ver errores: `sudo journalctl -u ladder -n 50`
- Reiniciar: `sudo systemctl restart ladder`
- Actualizar la página: sube el zip nuevo, descomprímelo y repite `sudo bash instalar.sh ...` (no borra los datos).
- Copias de seguridad: se guardan solas cada día en `/var/backups/ladder` (14 días). Descarga una de vez en cuando:
  `scp -i CLAVE.key ubuntu@IP:/var/backups/ladder/datos-FECHA.tar.gz .`
- Correos (verificar cuentas): si quieres, configura las variables `SMTP_*` (ver LEEME.md) en `/etc/systemd/system/ladder.service`.

## Cuando migres a un servidor pagado
1. Descarga la última copia de seguridad.
2. En el servidor nuevo, ejecuta `instalar.sh` con tu dominio nuevo.
3. Detén el servicio, descomprime la copia en `/var/lib/ladder` y arranca de nuevo. Cuentas, clanes y partidos se conservan.
4. Apunta el dominio nuevo a la IP nueva.

## Si algo falla
- **No abre la página:** revisa que el dominio tenga la IP correcta en DuckDNS y que las reglas 80/443 estén en Oracle.
- **Certificado:** `sudo journalctl -u caddy -n 50` (suele ser que el dominio aún no apunta a la IP o el puerto 80 está cerrado).
- **IP pública:** si borras y recreas la VM, la IP cambia; actualízala en DuckDNS.
