#!/usr/bin/env bash
# Deploy-Zugänge verwalten (auf dem Server als root). Jede Person bekommt einen eigenen SSH-Schlüssel (kann NUR ausrollen)
# und ein eigenes Passwort. Protokoll: /var/log/pontivo-deploy.log
#   ./deploy-user.sh add anna "ssh-ed25519 AAAA… kommentar"    Person hinzufügen (fragt nach einem neuen Passwort)
#   ./deploy-user.sh passwd anna                               Passwort ändern
#   ./deploy-user.sh relink anna                               Schlüssel-Eintrag auf das aktuelle Format bringen
#   ./deploy-user.sh remove anna                               Zugang entziehen
#   ./deploy-user.sh list                                      Personen anzeigen
#   ./deploy-user.sh log [Anzahl Zeilen]                       Protokoll anzeigen
set -euo pipefail
DB="${PONTIVO_DEPLOY_DB:-/etc/pontivo-deploy/users}"
LOG="${PONTIVO_DEPLOY_LOG:-/var/log/pontivo-deploy.log}"
SSH_USER="${DEPLOY_SSH_USER:-ubuntu}"
GATE="${PONTIVO_GATE:-/opt/pontivo-int/deploy/deploy-gate.sh}"
AUTH="${PONTIVO_AUTH_FILE:-$(getent passwd "$SSH_USER" | cut -d: -f6)/.ssh/authorized_keys}"
die() { echo "$1" >&2; exit 1; }
[ "$(id -u)" = 0 ] || [ -n "${PONTIVO_TEST:-}" ] || die "Bitte als root ausführen (sudo -i)."
cmd="${1:-}"; name="${2:-}"
valid_name() { [[ "$1" =~ ^[a-z][a-z0-9_-]{1,19}$ ]] || die "Name: 2–20 Zeichen, nur kleine Buchstaben, Ziffern, - und _ (z. B. martin)."; }

read_password() {
  if [ -n "${PONTIVO_DEPLOY_PASSWORD:-}" ]; then PW="$PONTIVO_DEPLOY_PASSWORD"; return; fi
  read -rs -p "Neues Deploy-Passwort für $name (mindestens 10 Zeichen): " PW; echo
  read -rs -p "Passwort wiederholen: " PW2; echo
  [ "$PW" = "$PW2" ] || die "Die Passwörter sind nicht gleich."
}
set_password() {
  [ "${#PW}" -ge 10 ] || die "Das Passwort ist zu kurz (mindestens 10 Zeichen)."
  local salt hash; salt="$(openssl rand -hex 8)"
  hash="$(printf '%s' "$PW" | openssl passwd -6 -salt "$salt" -stdin)"
  mkdir -p "$(dirname "$DB")"; chmod 700 "$(dirname "$DB")" 2>/dev/null || true
  touch "$DB"; chmod 600 "$DB"
  grep -v -E "^${name}:" "$DB" > "$DB.tmp" || true
  printf '%s:%s\n' "$name" "$hash" >> "$DB.tmp"
  mv "$DB.tmp" "$DB"; chmod 600 "$DB"
}

write_key_line() { # name, "typ schlüssel"
  # Die gewünschte Aktion geht als Argument an das Gate ($SSH_ORIGINAL_COMMAND wird von der Shell des Benutzers als EIN Wort eingesetzt).
  printf 'restrict,command="sudo -n %s %s \\"$SSH_ORIGINAL_COMMAND\\"" %s pontivo-deploy:%s\n' "$GATE" "$1" "$2" "$1" >> "$AUTH"
}

case "$cmd" in
  add)
    valid_name "$name"
    key="${3:-}"
    [[ "$key" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp[0-9]+)\ [A-Za-z0-9+/=]+(\ [^\"\\]*)?$ ]] || die "Der öffentliche Schlüssel sieht nicht richtig aus (Zeile aus der Datei id_….pub, in Anführungszeichen)."
    ! grep -q -E "^${name}:" "$DB" 2>/dev/null || die "«$name» gibt es schon. Passwort ändern: ./deploy-user.sh passwd $name"
    read_password; set_password
    mkdir -p "$(dirname "$AUTH")"; touch "$AUTH"
    keytype_and_body="$(printf '%s' "$key" | cut -d' ' -f1,2)"
    write_key_line "$name" "$keytype_and_body"
    chmod 600 "$AUTH"; [ -z "${PONTIVO_TEST:-}" ] && chown "$SSH_USER": "$AUTH" 2>/dev/null || true
    echo "Zugang für «$name» eingerichtet. Dieser Schlüssel kann nur ausrollen (Passwort nötig)."
    ;;
  passwd)
    valid_name "$name"
    grep -q -E "^${name}:" "$DB" 2>/dev/null || die "«$name» gibt es nicht."
    read_password; set_password; echo "Passwort für «$name» geändert."
    ;;
  relink)
    valid_name "$name"
    line="$(grep -F " pontivo-deploy:${name}" "$AUTH" 2>/dev/null | head -n1 || true)"
    [ -n "$line" ] || die "Für «$name» gibt es keinen Schlüssel-Eintrag."
    body="$(printf '%s' "$line" | awk '{print $(NF-2) " " $(NF-1)}')"
    grep -v -F " pontivo-deploy:${name}" "$AUTH" > "$AUTH.tmp" || true
    cat "$AUTH.tmp" > "$AUTH"; rm -f "$AUTH.tmp"
    write_key_line "$name" "$body"
    echo "Schlüssel-Eintrag für «$name» erneuert (Passwort unverändert)."
    ;;
  remove)
    valid_name "$name"
    [ -f "$DB" ] && { grep -v -E "^${name}:" "$DB" > "$DB.tmp" || true; mv "$DB.tmp" "$DB"; chmod 600 "$DB"; }
    [ -f "$AUTH" ] && { grep -v -F " pontivo-deploy:${name}" "$AUTH" > "$AUTH.tmp" || true; cat "$AUTH.tmp" > "$AUTH"; rm -f "$AUTH.tmp"; }
    echo "Zugang für «$name» entzogen."
    ;;
  list)
    [ -f "$DB" ] && cut -d: -f1 "$DB" | sort | sed 's/^/  /' || echo "  (niemand eingerichtet)"
    ;;
  log)
    tail -n "${name:-40}" "$LOG" 2>/dev/null || echo "(noch kein Protokoll)"
    ;;
  *)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
