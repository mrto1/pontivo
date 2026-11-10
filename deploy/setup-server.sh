#!/usr/bin/env bash
# Einmalig auf einem frischen Ubuntu-Server (als root): Docker, Firewall, automatische Sicherheitsupdates.
set -euo pipefail
apt-get update
apt-get install -y ca-certificates curl git ufw unattended-upgrades
# Docker (offizielles Installationsskript)
curl -fsSL https://get.docker.com | sh
# Firewall: nur SSH, HTTP, HTTPS
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
# Sicherheitsupdates automatisch einspielen
dpkg-reconfigure -f noninteractive unattended-upgrades
echo "Server bereit. Weiter mit Schritt 4 in docs/DEPLOY.md"
