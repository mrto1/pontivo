#!/bin/sh
# Läuft im Container «backup»: Datenbank und Uploads sichern, ältere als 14 Tage löschen
set -e
d=$(date +%Y-%m-%d)
pg_dump -h db -U pontivo -d pontivo -Fc -f "/backups/db-$d.dump"
tar -czf "/backups/uploads-$d.tar.gz" -C /uploads .
find /backups -type f -mtime +14 -delete
echo "Sicherung $d fertig: $(ls -1 /backups | wc -l) Dateien"
