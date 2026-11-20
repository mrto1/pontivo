#!/usr/bin/env bash
# Die Version, die gerade auf int läuft, für die Produktion freigeben (Tag prod-JJJJMMTT-HHMM).
# Aufruf auf dem Server im Ordner /opt/pontivo/deploy, danach ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
INT_DIR="${INT_DIR:-/opt/pontivo-int}"
test -d "$INT_DIR/.git" || { echo "Testumgebung nicht gefunden: $INT_DIR (siehe docs/DEPLOY.md, Abschnitt Testumgebung)"; exit 1; }
commit=$(git -C "$INT_DIR" rev-parse HEAD)
git -C .. fetch --tags --prune --force
git -C .. cat-file -e "$commit^{commit}" 2>/dev/null || { echo "Version $commit ist hier nicht bekannt. Zuerst auf int ausrollen (./deploy-int.sh)."; exit 1; }
tag="prod-$(date +%Y%m%d-%H%M)"
git -C .. tag -a "$tag" "$commit" -m "Freigabe nach Test auf int"
echo "Freigegeben: $tag ($(git -C .. log -1 --format=%s "$commit"))"
echo "Jetzt ausrollen: ./deploy.sh"
