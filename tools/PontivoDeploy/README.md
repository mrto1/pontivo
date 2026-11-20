# Pontivo Deploy (Windows)

Kleine Oberfläche zum Ausrollen: «Auf INT ausrollen» und «INT auf PROD ausrollen». Sie führt per SSH nur `ship.sh int`, `ship.sh prod` und eine Status-Abfrage aus.

- **Benutzen:** `PontivoDeploy.exe` doppelklicken (benötigt nichts ausser dem in Windows 10/11 enthaltenen .NET Framework 4.8 und dem OpenSSH-Client). Anmeldung per SSH-Schlüssel ohne Passwort. Einstellungen: `%APPDATA%\PontivoDeploy\config.txt`.
- **Neu bauen** (z. B. nach einer Änderung an `Program.cs`): .NET SDK 8 installieren, dann in diesem Ordner
  `dotnet build -c Release -o out` und die `out\PontivoDeploy.exe` (ca. 20 KB) hierher als `PontivoDeploy.exe` kopieren.
- Die .exe ist nicht signiert: Windows SmartScreen zeigt beim ersten Start «Weitere Informationen» → «Trotzdem ausführen».
