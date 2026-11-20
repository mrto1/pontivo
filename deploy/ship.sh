#!/usr/bin/env bash
# Alles in einem Befehl: auf int ausrollen, nach Bestätigung freigeben und auf prod ausrollen.
#   ausrollen              int ausrollen, testen, bei «j» weiter auf prod
#   ausrollen prod         nur prod: gibt die Version frei, die gerade auf int läuft, und rollt sie aus
#   ausrollen int          nur int (Branch optional: ausrollen int mein-branch)
# Einmalig einrichten (als root): ln -sf /opt/pontivo-int/deploy/ship.sh /usr/local/bin/ausrollen
set -euo pipefail
INT="${INT_DIR:-/opt/pontivo-int}/deploy"
PROD="${PROD_DIR:-/opt/pontivo}/deploy"
[ "$(id -u)" = 0 ] || { echo "Bitte als root ausführen (zuerst: sudo -i)."; exit 1; }
mode="${1:-}"
if [ "$mode" != "prod" ]; then
  shift || true
  "$INT/deploy-int.sh" "$@"
  [ "$mode" = "int" ] && exit 0
  echo
  echo ">>> int läuft: https://int.pontivo.ch  Jetzt testen."
  read -r -p ">>> Getestet? Diese Version auf prod ausrollen? (j/N) " a
  case "$a" in j|J|y|Y) ;; *) echo "Nicht auf prod ausgerollt. Später mit: ausrollen prod"; exit 0 ;; esac
fi
"$PROD/release.sh"
"$PROD/deploy.sh"
echo
echo "Prüfung: https://pontivo.ch/api/health?deep=1"
curl -fsS --max-time 20 "https://pontivo.ch/api/health?deep=1" && echo || echo "(Health-Prüfung nicht erfolgreich: Logs ansehen, siehe docs/DEPLOY.md)"
