#!/usr/bin/env bash
# Passwortschutz für int.pontivo.ch setzen oder ändern. Aufruf auf dem Server im Ordner /opt/pontivo/deploy (Produktion!):
#   ./int-password.sh benutzername
set -euo pipefail
cd "$(dirname "$0")"
USER_NAME="${1:?Aufruf: ./int-password.sh benutzername}"
read -r -s -p "Passwort für $USER_NAME: " PW; echo
HASH=$(docker run --rm caddy:2 caddy hash-password --plaintext "$PW")
mkdir -p int
printf '\tbasic_auth @geschuetzt {\n\t\t%s %s\n\t}\n' "$USER_NAME" "$HASH" > int/auth.caddy
chmod 600 int/auth.caddy
docker network inspect pontivo-int >/dev/null 2>&1 || docker network create pontivo-int >/dev/null
docker compose --env-file .env.production -f docker-compose.prod.yml up -d caddy
docker compose --env-file .env.production -f docker-compose.prod.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
echo "Passwortschutz für int.pontivo.ch ist aktiv."
