# Ausrollen: int, prod, zurück

Zurück zur Übersicht: [DEPLOY.md](../DEPLOY.md). Voraussetzung: die Testumgebung steht ([3-testumgebung.md](3-testumgebung.md)).

## Auf int ausrollen (so oft man will)

```bash
ssh ubuntu@IP-DES-VPS
cd /opt/pontivo-int/deploy
sudo ./deploy-int.sh                 # neuester Stand von main
sudo ./deploy-int.sh mein-branch     # oder ein bestimmter Branch/Commit
```
Das holt den Code, baut, führt die Datenbank-Migrationen aus und startet neu (1–3 Minuten). Danach auf https://int.pontivo.ch testen.

Int zurücksetzen (alles leer, frisch mit Demo-Betrieb):
```bash
cd /opt/pontivo-int/deploy
sudo docker compose --env-file .env.int -f docker-compose.int.yml down -v
sudo ./deploy-int.sh
sudo docker compose --env-file .env.int -f docker-compose.int.yml exec app node --import tsx scripts/seed.ts
```
(`-v` löscht die Testdatenbank, das ist nur auf int erlaubt.)

## Auf prod ausrollen

```bash
ssh ubuntu@IP-DES-VPS
cd /opt/pontivo/deploy                 # kein git pull nötig: release.sh und deploy.sh holen die Version selbst
sudo ./release.sh                      # gibt die Version frei, die jetzt auf int läuft (Tag prod-JJJJMMTT-HHMM)
sudo ./deploy.sh                       # rollt die neueste freigegebene Version aus
```
`deploy.sh` sichert vorher die Datenbank, baut, führt die Migrationen aus und startet neu. Danach kurz prüfen: https://pontivo.ch/api/health?deep=1 (Antwort 200), eine Testseite öffnen, im Admin anmelden.

**Wichtig:** `release.sh` gibt exakt die Version frei, die auf int läuft. Also vor dem Freigeben prüfen, dass int den gewünschten Stand zeigt (`cd /opt/pontivo-int && git log -1`).

## Zurück zur vorherigen Version (Notfall)

```bash
cd /opt/pontivo/deploy
git tag -l 'prod-*' --sort=-creatordate   # Liste der Freigaben, die neueste oben
sudo ./deploy.sh prod-20261118-1030        # eine ältere Freigabe ausrollen
```
Datenbank-Migrationen werden nie automatisch zurückgenommen. Neue Migrationen fügen nur Tabellen/Spalten hinzu, eine ältere Version läuft in der Regel damit weiter. Bei Datenproblemen die Sicherung vor dem Ausrollen einspielen ([5-betrieb.md](5-betrieb.md#sicherung), Dateien in `/opt/pontivo/backups`).

## Deploy-Zugänge für das Windows-Programm

Das Programm `tools\PontivoDeploy\PontivoDeploy.exe` meldet sich nicht als Administrator am Server an. Jede Person bekommt einen **eigenen Deploy-Zugang**: einen eigenen SSH-Schlüssel, der auf dem Server **nur** `deploy-gate.sh` starten darf (`restrict,command=…` in `authorized_keys`), und ein **eigenes Passwort** (auf dem Server nur als Hash in `/etc/pontivo-deploy/users`). Erlaubt sind nur vier Aktionen: `test`, `status`, `int`, `prod`. Es läuft immer nur ein Ausroll-Vorgang. Jeder Versuch steht im Protokoll `/var/log/pontivo-deploy.log` (Person, Zeit, Aktion, Fehlversuche; nie Passwörter). Nach einem falschen Passwort wartet der Server 3 Sekunden.

**Neue Person einrichten (z. B. die Geschäftspartnerin):**
1. Sie startet `PontivoDeploy.exe`, drückt «Zugang einrichten …», wählt einen Namen (z. B. `anna`) und «Schlüssel erzeugen». Der private Schlüssel bleibt auf ihrem PC.
2. Sie kopiert den angezeigten Befehl («Befehl kopieren») und schickt ihn dir. Er sieht so aus: `cd /opt/pontivo-int/deploy && ./deploy-user.sh add anna "ssh-ed25519 AAAA…"`.
3. Du führst ihn auf dem Server als root aus. Das Skript fragt nach dem neuen Deploy-Passwort (mindestens 10 Zeichen). Das Passwort gibst du ihr auf einem anderen Weg (Telefon, Passwortmanager).
4. Sie trägt Name und Passwort im Programm ein und drückt «Verbindung testen».

**Dasselbe für dich selbst** (eigener Name, z. B. `martin`, eigener Schlüssel vom eigenen PC).

```bash
cd /opt/pontivo-int/deploy
./deploy-user.sh list                 # wer hat Zugang
./deploy-user.sh passwd anna          # Passwort ändern
./deploy-user.sh remove anna          # Zugang entziehen (Schlüssel und Passwort weg)
./deploy-user.sh log 50               # letzte 50 Zeilen des Protokolls
```
Voraussetzung: der Benutzer `ubuntu` darf `sudo` ohne Passwort (wie bei Ubuntu-Cloud-Images üblich). Dein normaler Administrator-Zugang per SSH bleibt davon getrennt und unverändert. Wer einen Computer verliert: `remove NAME` und neu einrichten.

**Verbindung abgerissen?** Ausrollen über `deploy-gate.sh` läuft auf dem Server von der Verbindung getrennt weiter. Der Stand steht in `/var/log/pontivo-deploy-last.log`; im Programm zeigt «Stand anzeigen» ihn am Ende an («beendet mit Code 0» = fertig).
