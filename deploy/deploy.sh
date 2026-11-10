#!/usr/bin/env bash
# Neue Version ausrollen: Code holen, Image bauen, Migrationen, Neustart. Aufruf auf dem Server: ./deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
test -f .env.production || { echo "deploy/.env.production fehlt (Vorlage: .env.production.example)"; exit 1; }
git -C .. pull --ff-only
dc() { docker compose --env-file .env.production -f docker-compose.prod.yml "$@"; }
dc build
dc up -d
dc ps
echo "Fertig. Logs: docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app worker"
