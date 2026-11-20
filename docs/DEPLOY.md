# Pontivo betreiben: Übersicht

Stand: 20.11.2026. Pontivo läuft auf **https://pontivo.ch** (VPS bei Infomaniak, Schweiz), getestet wird auf **https://int.pontivo.ch**.
Diese Seite ist der Einstieg: zuerst «Was will ich tun?», darunter der Spickzettel für den Alltag. Die Anleitungen stehen in `docs/deploy/`.

## Was will ich tun?

| Ich möchte … | Anleitung |
|---|---|
| Pontivo **zum ersten Mal** auf einen Server bringen (VPS, DNS, Start) | [1-erstinstallation.md](deploy/1-erstinstallation.md) |
| **E-Mail, Zahlung (Stripe), Channex, Bot-Schutz, eigene Domains, Push, KI, Buchhaltung** anbinden | [2-dienste.md](deploy/2-dienste.md) |
| die **Testumgebung int** einrichten oder verstehen, was dort geht | [3-testumgebung.md](deploy/3-testumgebung.md) |
| eine **neue Version ausrollen** (int, prod) oder **zurückgehen** | [4-ausrollen.md](deploy/4-ausrollen.md) |
| **Sicherung**, **Überwachung**, Betriebe und Benutzer verwalten, Checkliste vor dem ersten Hotel | [5-betrieb.md](deploy/5-betrieb.md) |

## Spickzettel

Alles auf dem Server, nach `ssh ubuntu@IP-DES-VPS` und `sudo -i` (dann ist kein `sudo` mehr nötig).

**Vom Windows-PC aus, ohne Terminal:** Doppelklick auf `scripts\pontivo-deploy.bat` (im Repo-Ordner auf dem PC). Es öffnet ein kleines Fenster mit zwei Knöpfen: «1. Auf INT ausrollen» und «2. INT auf PROD ausrollen» (mit Rückfrage). «Verbindung testen» prüft Zugang und Rechte, «Stand anzeigen» zeigt, was auf int und prod läuft. Das Fenster ist nur eine Oberfläche für den Befehl `ausrollen` (unten) und braucht dieselbe SSH-Anmeldung per Schlüssel wie `scripts\pull-backups.ps1`. Voraussetzung auf dem Server: einmal `ausrollen` einrichten (siehe unten).

**Neue Version ausrollen: ein Befehl.**
```bash
ausrollen
```
Das rollt auf int aus und wartet. Du testest auf https://int.pontivo.ch und tippst `j`, dann wird die Version freigegeben und auf prod ausgerollt (inkl. Prüfung). Mit `n` bleibt prod unberührt. Weitere Formen: `ausrollen prod` (nur prod, mit der Version, die gerade auf int läuft), `ausrollen int` (nur int), `ausrollen int mein-branch`.

Einmalig einrichten (als root): `ln -sf /opt/pontivo-int/deploy/ship.sh /usr/local/bin/ausrollen`. Falls `ship.sh` noch nicht existiert: einmal `cd /opt/pontivo-int/deploy && ./deploy-int.sh`.

Ohne Abkürzung entspricht das diesen drei Schritten:
```bash
cd /opt/pontivo-int/deploy && ./deploy-int.sh   # 1. neuesten Stand auf int ausrollen, auf https://int.pontivo.ch testen
cd /opt/pontivo/deploy && ./release.sh          # 2. die getestete Version freigeben
./deploy.sh                                     # 3. Produktion ausrollen
```
Kein `git pull` in `/opt/pontivo`: Dort steht immer eine freigegebene Version (git meldet «You are not currently on a branch»). `deploy.sh` holt und wechselt die Version selbst.

**Status und Logs** (prod; für int `.env.int` und `docker-compose.int.yml` verwenden):
```bash
cd /opt/pontivo/deploy
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail 100 app worker caddy
```

**Eine Einstellung ändern** (z. B. `MAIL_REDIRECT_TO`, Schlüssel): Datei mit `nano .env.production` (int: `.env.int`) bearbeiten, speichern mit `Strg+O`, `Enter`, `Strg+X`, dann `./deploy.sh` (int: `./deploy-int.sh`).

**Notfall, zurück zur letzten Version:** `git tag -l 'prod-*' --sort=-creatordate`, dann `./deploy.sh prod-JJJJMMTT-HHMM` ([Details](deploy/4-ausrollen.md#zurück-zur-vorherigen-version-notfall)).

**Läuft alles?** `https://pontivo.ch/api/health?deep=1` antwortet mit 200, sonst 503 mit den Namen der Probleme.

## Prod und int im Überblick

| | **int** (Test) | **prod** (echt) |
|---|---|---|
| Adresse | https://int.pontivo.ch (Passwortschutz) | https://pontivo.ch |
| Ordner auf dem Server | `/opt/pontivo-int` | `/opt/pontivo` |
| Zahlung | Stripe Testmodus | Stripe live |
| E-Mails | alle an `MAIL_REDIRECT_TO` | normal |
| Code | `main` oder ein Branch | nur freigegebene Versionen (`prod-…`) |

Der Weg einer Änderung: **Entwicklung → int ausrollen → testen → freigeben → prod ausrollen.**
