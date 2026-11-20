#!/usr/bin/env bash
# Eingang für das Windows-Programm PontivoDeploy (und jeden anderen Deploy-Zugang).
# Wird von SSH als erzwungener Befehl gestartet (siehe deploy-user.sh): der Schlüssel dieser Person kann NUR das hier ausführen.
#   Aufruf durch SSH:  deploy-gate.sh <name>      Aktion in SSH_ORIGINAL_COMMAND: test | status | int | prod
#   Erste Zeile von stdin: das Deploy-Passwort dieser Person.
# Prüft Passwort (Hash in /etc/pontivo-deploy/users), erlaubt nur die vier Aktionen, sperrt parallele Läufe, schreibt ein Protokoll.
set -uo pipefail
NAME="${1:-}"
ACTION="${SSH_ORIGINAL_COMMAND:-}"
DB="${PONTIVO_DEPLOY_DB:-/etc/pontivo-deploy/users}"
LOG="${PONTIVO_DEPLOY_LOG:-/var/log/pontivo-deploy.log}"
SHIP="${PONTIVO_SHIP:-/opt/pontivo-int/deploy/ship.sh}"
LOCK="${PONTIVO_DEPLOY_LOCK:-/var/lock/pontivo-deploy.lock}"
FAIL_DELAY="${PONTIVO_FAIL_DELAY:-3}"

log() { printf '%s %-12s %-8s %s\n' "$(date '+%F %T')" "${NAME:-?}" "$1" "${2:-}" >> "$LOG" 2>/dev/null || true; }
fail() { echo "$1"; exit "${2:-1}"; }

[[ "$NAME" =~ ^[a-z][a-z0-9_-]{1,19}$ ]] || fail "Zugang nicht eingerichtet (Name fehlt)." 2
case "$ACTION" in test|status|int|prod) ;; *) log "ABGELEHNT" "Aktion: ${ACTION:0:40}"; fail "Unbekannte Aktion." 2 ;; esac

IFS= read -r -t 20 PW || { log "FEHLER" "kein Passwort"; fail "Kein Passwort erhalten." 2; }
[ -n "$PW" ] || { sleep "$FAIL_DELAY"; log "FEHLER" "leeres Passwort"; fail "Bitte das Deploy-Passwort eingeben." 3; }

STORED="$(grep -E "^${NAME}:" "$DB" 2>/dev/null | head -n1 | cut -d: -f2-)"
if [ -z "$STORED" ]; then sleep "$FAIL_DELAY"; log "FEHLER" "unbekannter Name"; fail "Passwort falsch." 3; fi
SALT="$(printf '%s' "$STORED" | cut -d'$' -f3)"
GIVEN="$(printf '%s' "$PW" | openssl passwd -6 -salt "$SALT" -stdin 2>/dev/null)"
if [ -z "$GIVEN" ] || [ "$GIVEN" != "$STORED" ]; then sleep "$FAIL_DELAY"; log "FEHLER" "Passwort falsch ($ACTION)"; fail "Passwort falsch." 3; fi
unset PW GIVEN

exec </dev/null
case "$ACTION" in
  test)
    log "TEST" "ok"
    echo "Angemeldet als $NAME, Passwort ok."
    if [ -x "$SHIP" ]; then echo "ship.sh vorhanden: ok"; else echo "ship.sh fehlt: auf dem Server im Ordner /opt/pontivo-int/deploy einmal ./deploy-int.sh ausführen"; exit 1; fi
    ;;
  status)
    log "STATUS" ""
    echo "int:   $(git -c safe.directory='*' -C /opt/pontivo-int log -1 --format='%h  %s  (%cd)' --date=short 2>/dev/null)"
    echo "prod:  $(git -c safe.directory='*' -C /opt/pontivo describe --tags --always 2>/dev/null)  ->  $(git -c safe.directory='*' -C /opt/pontivo log -1 --format='%h  %s' 2>/dev/null)"
    echo "Gesundheit prod: $(curl -fsS --max-time 15 'https://pontivo.ch/api/health?deep=1' 2>&1 | head -c 200)"
    echo "Gesundheit int:  $(curl -fsS --max-time 15 'https://int.pontivo.ch/api/health' 2>&1 | head -c 100)"
    ;;
  int|prod)
    exec 9>"$LOCK"
    flock -n 9 || { log "BESETZT" "$ACTION"; fail "Es läuft gerade ein anderer Ausroll-Vorgang. Bitte kurz warten." 4; }
    log "START" "$ACTION"
    "$SHIP" "$ACTION"
    rc=$?
    log "ENDE" "$ACTION Code $rc"
    exit "$rc"
    ;;
esac
