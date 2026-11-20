#!/usr/bin/env bash
# Eingang für das Windows-Programm PontivoDeploy (und jeden anderen Deploy-Zugang).
# Wird von SSH als erzwungener Befehl gestartet (siehe deploy-user.sh): der Schlüssel dieser Person kann NUR das hier ausführen.
#   Aufruf durch SSH:  deploy-gate.sh <name> <aktion>      Aktion: test | status | int | prod
#   Erste Zeile von stdin: das Deploy-Passwort dieser Person.
# Prüft Passwort (Hash in /etc/pontivo-deploy/users), erlaubt nur die vier Aktionen, sperrt parallele Läufe, schreibt ein Protokoll.
set -uo pipefail
NAME="${1:-}"
# sudo verwirft die Umgebung: die Aktion kommt als 2. Argument ("$SSH_ORIGINAL_COMMAND" im erzwungenen Befehl); Umgebung nur als Rückfall (Tests).
ACTION="${2:-${SSH_ORIGINAL_COMMAND:-}}"
DB="${PONTIVO_DEPLOY_DB:-/etc/pontivo-deploy/users}"
LOG="${PONTIVO_DEPLOY_LOG:-/var/log/pontivo-deploy.log}"
SHIP="${PONTIVO_SHIP:-/opt/pontivo-int/deploy/ship.sh}"
LOCK="${PONTIVO_DEPLOY_LOCK:-/var/lock/pontivo-deploy.lock}"
RUNLOG="${PONTIVO_RUN_LOG:-/var/log/pontivo-deploy-last.log}"
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
    if [ -s "$RUNLOG" ]; then
      if [ -f "$RUNLOG.rc" ]; then echo "Letzter Vorgang: beendet mit Code $(cat "$RUNLOG.rc")"; else echo "Letzter Vorgang: LÄUFT NOCH"; fi
      echo "--- Ende der letzten Ausgabe ---"; tail -n 12 "$RUNLOG"
    fi
    ;;
  int|prod)
    exec 9>"$LOCK"
    flock -n 9 || { log "BESETZT" "$ACTION"; fail "Es läuft gerade ein anderer Ausroll-Vorgang. Bitte kurz warten." 4; }
    log "START" "$ACTION"
    : > "$RUNLOG"; rm -f "$RUNLOG.rc"
    # Der Vorgang läuft vom SSH getrennt weiter (eigene Sitzung, hält die Sperre auf fd 9), auch wenn die Verbindung abbricht.
    SHIP="$SHIP" ACTION="$ACTION" RUNLOG="$RUNLOG" LOGF="$LOG" NAME="$NAME" setsid bash -c '
      trap "" HUP PIPE
      "$SHIP" "$ACTION" >> "$RUNLOG" 2>&1 < /dev/null
      rc=$?
      echo "$rc" > "$RUNLOG.rc"
      printf "%s %-12s %-8s %s\n" "$(date "+%F %T")" "$NAME" "ENDE" "$ACTION Code $rc" >> "$LOGF" 2>/dev/null
    ' < /dev/null > /dev/null 2>&1 &
    # Ausgabe live mitlesen, bis der Vorgang fertig ist. Bricht die Verbindung ab, läuft er trotzdem weiter.
    pos=0
    while :; do
      done_flag=0; [ -f "$RUNLOG.rc" ] && done_flag=1
      size=$(stat -c %s "$RUNLOG" 2>/dev/null || echo 0)
      if [ "$size" -gt "$pos" ]; then
        tail -c +$((pos + 1)) "$RUNLOG" | head -c $((size - pos)); pos=$size
      fi
      [ "$done_flag" = 1 ] && break
      sleep 1
    done
    rc="$(cat "$RUNLOG.rc" 2>/dev/null || echo 1)"
    exit "$rc"
    ;;
esac
