# Pontivo Deploy (Windows)

Kleine Oberfläche zum Ausrollen: «Auf INT ausrollen» und «INT auf PROD ausrollen».

- **Benutzen:** `PontivoDeploy.exe` doppelklicken (benötigt nur das in Windows 10/11 enthaltene .NET Framework 4.8 und den OpenSSH-Client). Folgt dem hellen/dunklen Modus von Windows.
- **Zugang:** Jede Person hat einen eigenen SSH-Schlüssel (nur zum Ausrollen) und ein eigenes Passwort. Beim ersten Mal «Zugang einrichten …»: erzeugt den Schlüssel unter `%APPDATA%\PontivoDeploy\` und zeigt den Befehl, den der Administrator auf dem Server ausführt (`deploy-user.sh add`). Das Passwort wird nie gespeichert; Name, Server und Schlüsselpfad stehen in `%APPDATA%\PontivoDeploy\config.txt`.
- **Server-Seite:** `deploy/deploy-gate.sh` (prüft Passwort, erlaubt nur test/status/int/prod, protokolliert) und `deploy/deploy-user.sh` (Personen verwalten). Details: `docs/deploy/4-ausrollen.md`.
- **Neu bauen** (nach einer Änderung an `Program.cs`): .NET SDK 8 installieren, dann in diesem Ordner
  `dotnet publish -c Release -o out` und `out\PontivoDeploy.exe` (ca. 30 KB) hierher als `PontivoDeploy.exe` kopieren.
- Die .exe ist nicht signiert: Windows SmartScreen zeigt beim ersten Start «Weitere Informationen» → «Trotzdem ausführen».
