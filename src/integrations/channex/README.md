# Channex (Meilenstein M3)

Noch nicht gebaut. Bereits vorhanden:

- Outbox: Jede Änderung an `inventory_days` / `rates_days` schreibt einen Eintrag in `channex_outbox` (siehe `src/services/outbox.ts`).
- Webhook-Endpoint `POST /api/webhooks/channex` mit HMAC-Prüfung (`signature.ts`).

Zu bauen (SPEC 7): `client.ts` (REST mit `user-api-key`), Worker `channex-outbox` (Bündeln, Token-Bucket 10/min pro Property und Art, Backoff),
Worker `channex-feed` (Feed lesen, Revisionen nach SPEC 5.6 verarbeiten, nur nach Erfolg acken), Admin-Aktion „Channex verbinden“.

## Webhook einrichten (getestet auf Staging, 10.11.2026)

`node --import tsx scripts/channex-webhook.ts [URL] [--new-key]` legt einen Signierschlüssel (`POST /signing_keys`, Geheimnis nur einmal sichtbar)
und einen globalen, signierten Webhook (`event_mask: "booking"`, `send_data: false`, `is_signed: true`, `signing_key_id`) an.
Channex sendet `x-hmac-timestamp`, `x-hmac-signature-256` (und `x-hmac-keys-256`). Test: neue Buchung und Stornierung über die
Channex-CRS-API → Webhook → Feed → Import und Ack innerhalb weniger Sekunden, Verfügbarkeit danach zurück an Channex.
