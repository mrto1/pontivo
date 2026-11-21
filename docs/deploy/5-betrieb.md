# Betrieb: Sicherung, Überwachung, Verwaltung

Zurück zur Übersicht: [DEPLOY.md](../DEPLOY.md).

## Checkliste vor dem ersten echten Hotel

- [ ] AGB, Datenschutz, Bedingungen für Gastgeber juristisch geprüft (QUESTIONS.md)
- [ ] `PLATFORM_*`-Angaben ausgefüllt, Impressum vorhanden
- [ ] Stripe auf Live-Schlüssel umgestellt, Webhook live angelegt
- [ ] Postmark-Domain bestätigt, Test-Login-Mail angekommen
- [ ] Sicherung ausser Haus läuft
- [ ] Testbuchung mit echter Karte und Rückerstattung

## Sicherung

### Ausser Haus (wichtig)

VPS Lite hat **keine Snapshots**. Der Container `backup` legt täglich Datenbank und Fotos im Volume `pontivo_backups` ab (14 Tage).
Das schützt vor Fehlbedienung, nicht vor dem Verlust des Servers. Darum zusätzlich täglich eine Kopie ausser Haus, z. B. mit
**Infomaniak Swiss Backup** (S3-kompatibel) oder kDrive über `rclone`. Kann ich bei Bedarf einrichten.

Wiederherstellen (Beispiel):

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db pg_restore -U pontivo -d pontivo --clean < db-2026-11-10.dump
```

### Auf den eigenen PC (kostenlos)

Der Container `backup` sichert täglich die Datenbank und die Uploads nach `/opt/pontivo/backups` (14 Tage Aufbewahrung, nur für den Benutzer `ubuntu` lesbar). Eine Sicherung auf demselben Server schützt nicht vor einem Totalausfall des Servers, deshalb holst du die Dateien regelmässig auf deinen PC:

1. Einmalig auf dem Server: `cd /opt/pontivo-int/deploy && ./deploy-int.sh`, dann `cd /opt/pontivo/deploy && ./release.sh && ./deploy.sh` (der Sicherungsordner wird dabei von einem Docker-Volume auf `/opt/pontivo/backups` umgestellt; die ersten Dateien entstehen gleich nach dem Start).
2. Auf dem PC (PowerShell, im Ordner des Repos): `powershell -ExecutionPolicy Bypass -File scripts\pull-backups.ps1`. Zielordner standardmässig `%USERPROFILE%\PontivoBackups`, lokal werden 90 Tage behalten.
3. Automatisch: Windows-Aufgabenplanung → neue Aufgabe → täglich → Programm `powershell`, Argumente `-ExecutionPolicy Bypass -File "C:\Pfad\zum\Repo\scripts\pull-backups.ps1"`. Der PC muss zur Zeit eingeschaltet sein, sonst wird einfach am nächsten Tag nachgeholt.
4. Die Dateien enthalten Personendaten (DSG): Zielordner auf einer verschlüsselten Platte (BitLocker) ablegen, nicht in eine Cloud synchronisieren.
5. Wiederherstellung testen (mindestens einmal): `pg_restore -d <leere Datenbank> db-JJJJ-MM-TT.dump`.

## Überwachung

- Der Worker meldet sich jede Minute. `GET https://pontivo.ch/api/health?deep=1` antwortet mit 200, wenn alles in Ordnung ist, und mit 503 plus den Namen der Probleme (`worker`, `email_backlog`, `channex_backlog`, `stuck_holds`, `disk`). Dort einen kostenlosen Uptime-Dienst einrichten (z. B. UptimeRobot, Prüfintervall 5 Minuten, Benachrichtigung per Mail). Für die einfache Prüfung der Website reicht `/api/health`.
- Der Worker prüft alle 10 Minuten selbst und schickt bei neuen Problemen eine Mail an `PLATFORM_ALERT_EMAIL` (pro Problem höchstens alle 6 Stunden).
- Nachts um 04:10 gleicht ein Job Stripe-Zahlungen mit Buchungen ab (bezahlt ohne bestätigte Buchung, bestätigt ohne Zahlung, bezahlt aber abgelaufen) und meldet Abweichungen per Mail. Er ändert nichts selbst.

## Betriebe und Benutzer verwalten, Testkonten löschen
Bequem im Admin: `https://pontivo.ch/plattform` (nur Plattform-Admin; Link unten auf der Übersicht). Dort: Betriebe pausieren oder wieder online nehmen, Mitglieder hinzufügen oder entfernen, Login-Link senden, Sicherheit (Passkeys, Authenticator) eines Benutzers zurücksetzen, Betriebe und Benutzer endgültig löschen (Bestätigung durch Eintippen von Name bzw. E-Mail). Jede Löschung und jedes Zurücksetzen steht im Protokoll (`audit_log`).

Alternativ per Kommandozeile (Testkonto samt Betrieb):
Löscht ein Konto und seine Betriebe vollständig, mit allen Buchungen, Gästen und Mails (nicht rückgängig). Ohne `--yes` zeigt das Skript nur, was gelöscht würde. Betriebe mit weiteren Mitgliedern oder Status «live» bleiben (live nur mit `--include-live`), Plattform-Admins werden nie gelöscht.
```bash
cd /opt/pontivo/deploy
sudo docker compose --env-file .env.production -f docker-compose.prod.yml exec app node --import tsx scripts/delete-test-account.ts test@example.ch
sudo docker compose --env-file .env.production -f docker-compose.prod.yml exec app node --import tsx scripts/delete-test-account.ts test@example.ch --yes
```
Hinweis: Stripe-Konto und Channex-Property des Testbetriebs werden dabei nicht mitgelöscht, sie gehören bei Stripe/Channex separat entfernt.

## Umgebungsdatei prüfen und aufräumen

Mit der Zeit sammeln sich in `.env.production` (und `.env.int`) Einträge an, die niemand mehr braucht, und manchmal stehen gefährliche Werte drin (Testschlüssel in der Produktion, `PAYMENT_PROVIDER=fake`, eine Mail-Umleitung). Das Skript prüft die Datei gegen den Code und zeigt **nie Werte**, nur Namen:

```bash
cd /opt/pontivo/deploy
python3 env-check.py .env.production                # prüfen (Produktion)
python3 env-check.py .env.int --env int             # Testumgebung
python3 env-check.py .env.production --write        # dazu eine aufgeräumte Kopie .env.production.neu schreiben
```

Es meldet **Fehler** (beheben), **Fehlendes**, **Hinweise** (z. B. Dateirechte, zusammengehörige Schlüssel, Beispieladresse) und **Überflüssiges** (nicht mehr gelesene Namen, Einträge, die Docker selbst setzt, Leerwerte, Doppelte). Das Original bleibt unverändert. Nach `diff .env.production .env.production.neu` und Kontrolle: `mv .env.production.neu .env.production`, dann `./deploy.sh`. Auf dem Server vorher ein Backup der Datei ablegen.

