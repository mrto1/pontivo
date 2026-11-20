#!/usr/bin/env bash
# Produktion ausrollen. Aufruf auf dem Server (im Ordner /opt/pontivo/deploy):
#   ./deploy.sh              neueste freigegebene Version (Tag prod-…, siehe release.sh)
#   ./deploy.sh prod-2026…   eine bestimmte Version (auch zum Zurückgehen)
# Vorher wird die Datenbank gesichert; die Migrationen laufen beim Start automatisch.
set -euo pipefail
cd "$(dirname "$0")"
test -f .env.production || { echo "deploy/.env.production fehlt (Vorlage: .env.production.example)"; exit 1; }
# Schutz: Einstellungen der Testumgebung gehören nie in die Produktion (sonst Hinweis «Testumgebung» und Mails an die Testadresse)
if grep -Eq '^(ENVIRONMENT_LABEL|MAIL_REDIRECT_TO)=.+' .env.production; then
  echo "STOPP: In .env.production stehen ENVIRONMENT_LABEL oder MAIL_REDIRECT_TO. Das sind Einstellungen der Testumgebung (.env.int)."
  echo "Diese Zeilen aus .env.production löschen (nano .env.production) und ./deploy.sh erneut ausführen."; exit 1
fi
git -C .. fetch --tags --prune --force
REF="${1:-$(git -C .. tag -l 'prod-*' --sort=-creatordate | head -n1)}"
if [ -z "$REF" ]; then
  echo "Noch keine freigegebene Version. Erst auf int testen, dann ./release.sh ausführen."; exit 1
fi
before=$(git -C .. rev-parse --short HEAD)
git -C .. checkout --detach "$REF"
after=$(git -C .. rev-parse --short HEAD)
echo "Produktion: $before -> $after ($REF)"
docker network inspect pontivo-int >/dev/null 2>&1 || docker network create pontivo-int >/dev/null
dc() { docker compose --env-file .env.production -f docker-compose.prod.yml "$@"; }
# Sicherung vor dem Ausrollen (läuft nur, wenn die Datenbank schon läuft)
dc exec -T backup sh /backup.sh 2>/dev/null || echo "(keine Sicherung vor dem Ausrollen: Container backup läuft noch nicht)"
dc build
dc up -d
# Caddyfile kann sich geändert haben (Bind-Mount): neu laden, ohne Unterbruch
dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || dc restart caddy
dc ps
echo "Fertig. Zurück zur vorherigen Version: ./deploy.sh <Tag>   (Tags: git tag -l 'prod-*')"
echo "Hinweis: Wurden Datenbank-Migrationen ausgeführt, ist ein Zurückgehen des Codes nur sicher, wenn die alte Version die neue Datenbank versteht. Im Zweifel Sicherung einspielen (docs/deploy/5-betrieb.md, Abschnitt Sicherung)."
