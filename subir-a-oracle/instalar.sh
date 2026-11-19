#!/usr/bin/env bash
# Instala la página del ladder en una VM Ubuntu (Oracle Cloud u otra).
# Uso:  sudo bash instalar.sh  tu-dominio.duckdns.org  alias_del_administrador
set -euo pipefail

DOMINIO="${1:-}"
ADMIN="${2:-}"
if [ -z "$DOMINIO" ] || [ -z "$ADMIN" ]; then
  echo "Uso: sudo bash instalar.sh tu-dominio.duckdns.org alias_del_administrador"; exit 1
fi
if [ "$(id -u)" -ne 0 ]; then echo "Ejecuta con sudo."; exit 1; fi
# La identidad de administrador se guarda en un EnvironmentFile; no admitir saltos de linea ni sintaxis de systemd.
if ! [[ "$ADMIN" =~ ^[a-zA-Z0-9_-]{3,24}$ ]]; then
  echo "El alias de administrador debe contener entre 3 y 24 caracteres: letras, numeros, _ o -."; exit 1
fi

ORIGEN="$(cd "$(dirname "$0")/.." && pwd)"
DESTINO=/opt/ladder
DATOS=/var/lib/ladder

echo "==> 1/6 Instalando Node.js 22 y Caddy"
apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https unzip
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<13)){console.error("Se necesita Node 22.13 o superior, hay "+process.version);process.exit(1)}'

echo "==> 2/6 Copiando la página a $DESTINO"
id ladder >/dev/null 2>&1 || useradd --system --home "$DESTINO" --shell /usr/sbin/nologin ladder
mkdir -p "$DESTINO" "$DATOS"
# No se copia la carpeta data de pruebas ni este instalador
tar -C "$ORIGEN" --exclude=./data --exclude=./subir-a-oracle -cf - . | tar -C "$DESTINO" -xf -
chown -R ladder:ladder "$DESTINO" "$DATOS"

echo "==> 3/6 Creando el servicio (se inicia solo y se reinicia si falla)"
# El codigo de alta administrativa nunca se escribe en el repositorio ni en el unit file.
# Conservarlo en instalaciones sucesivas evita rotarlo accidentalmente.
SECRETS_DIR=/etc/ladder
SECRETS_FILE=$SECRETS_DIR/bootstrap.env
install -d -o root -g root -m 0700 "$SECRETS_DIR"
TOKEN=""
if [ -f "$SECRETS_FILE" ]; then
  TOKEN="$(sed -n 's/^ADMIN_SETUP_TOKEN=//p' "$SECRETS_FILE" | head -n 1)"
fi
if ! [[ "$TOKEN" =~ ^[0-9a-f]{64}$ ]]; then
  TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
fi
TMP="$(mktemp "$SECRETS_DIR/.bootstrap.XXXXXX")"
chmod 0600 "$TMP"
printf 'ADMIN_ALIAS=%s\nADMIN_SETUP_TOKEN=%s\n' "$ADMIN" "$TOKEN" > "$TMP"
mv -f "$TMP" "$SECRETS_FILE"
cat > /etc/systemd/system/ladder.service <<EOF
[Unit]
Description=Ladder MOHAA Chile
After=network.target

[Service]
User=ladder
WorkingDirectory=$DESTINO
Environment=PORT=3000
Environment=DATA_DIR=$DATOS
Environment=TRUST_PROXY=1
Environment=COOKIE_SECURE=1
EnvironmentFile=/etc/ladder/bootstrap.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATOS

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now ladder

echo "==> 4/6 Configurando HTTPS con Caddy para $DOMINIO"
cat > /etc/caddy/Caddyfile <<EOF
$DOMINIO {
    encode gzip
    reverse_proxy 127.0.0.1:3000
}
EOF
systemctl enable caddy
systemctl restart caddy

echo "==> 5/6 Abriendo puertos 80 y 443 en el firewall de la VM"
for p in 80 443; do
  iptables -C INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport $p -m state --state NEW -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save || true; else apt-get install -y iptables-persistent && netfilter-persistent save || true; fi

echo "==> 6/6 Copia de seguridad diaria de la base de datos"
cat > /etc/cron.daily/ladder-respaldo <<'EOF'
#!/bin/sh
mkdir -p /var/backups/ladder
tar -czf /var/backups/ladder/datos-$(date +%F).tar.gz -C /var/lib ladder
find /var/backups/ladder -name 'datos-*.tar.gz' -mtime +14 -delete
EOF
chmod +x /etc/cron.daily/ladder-respaldo

echo
echo "Listo. Estado del servicio:"
systemctl --no-pager --lines=3 status ladder || true
echo
echo "Abre https://$DOMINIO (el certificado puede tardar un minuto)."
echo "Para registrar el alias $ADMIN, consulta PRIVADAMENTE el codigo de alta:"
echo "  sudo sed -n 's/^ADMIN_SETUP_TOKEN=//p' $SECRETS_FILE"
echo "No compartas ese codigo ni lo pegues en capturas o chats."
echo "Si no abre: revisa que el dominio apunte a la IP de esta VM y que el puerto 80/443 estén abiertos en Oracle."
