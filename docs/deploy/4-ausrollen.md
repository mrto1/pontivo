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
cd /opt/pontivo && sudo git pull       # damit die Skripte aktuell sind
cd deploy
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
