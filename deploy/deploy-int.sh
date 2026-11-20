#!/usr/bin/env bash
# Testumgebung int.pontivo.ch ausrollen. Aufruf auf dem Server im Ordner /opt/pontivo-int/deploy:
#   ./deploy-int.sh              neuesten Stand von main
#   ./deploy-int.sh mein-branch  einen anderen Branch, Tag oder Commit
set -euo pipefail
cd "$(dirname "$0")"
test -f .env.int || { echo "deploy/.env.int fehlt (Vorlage: .env.int.example)"; exit 1; }
# Schutz: die Testumgebung muss als solche gekennzeichnet sein (Hinweis, Mails an die Testadresse)
grep -Eq '^ENVIRONMENT_LABEL=.+' .env.int && grep -Eq '^MAIL_REDIRECT_TO=.+' .env.int || { echo "STOPP: In .env.int müssen ENVIRONMENT_LABEL=int und MAIL_REDIRECT_TO=<Testadresse> stehen."; exit 1; }
REF="${1:-main}"
git -C .. fetch --tags --prune --force origin
if git -C .. rev-parse --verify -q "origin/$REF" >/dev/null; then TARGET="origin/$REF"; else TARGET="$REF"; fi
git -C .. checkout --detach "$TARGET"
echo "int: $(git -C .. log -1 --format='%h %s' HEAD)"
docker network inspect pontivo-int >/dev/null 2>&1 || docker network create pontivo-int >/dev/null
dc() { docker compose --env-file .env.int -f docker-compose.int.yml "$@"; }
dc build
dc up -d
dc ps
echo "Fertig: https://int.pontivo.ch"
echo "Demo-Betrieb anlegen (einmalig): docker compose --env-file .env.int -f docker-compose.int.yml exec app node --import tsx scripts/seed.ts"
