# Modulübersicht

Erzeugt mit `npx tsx scripts/module-index.ts` aus `src/domain/modules.ts`, `src/admin/nav.ts`, `src/db/schema.ts` und `docs/SPEC.md`. Nicht von Hand ändern; `tests/unit/module-index.test.ts` schlägt an, wenn sie veraltet ist.

Die Spalte «Tabellen» zeigt Tabellen, die in den SPEC-Abschnitten des Moduls genannt sind (kann unvollständig sein); «SPEC» nennt die Abschnitte, deren Überschrift das Modul nennt.

| Modul | Name | Braucht | Standard | Seiten (unter /admin/<id>/) | Tabellen | SPEC |
|---|---|---|---|---|---|---|
| `frontdesk` | Rezeption | – | an | `plan` | `door_codes`, `door_locks`, `housekeeping_tasks`, `room_issues`, `room_moves`, `rooms` | 16.2, 17.1, 18.5, 19.5 |
| `housekeeping` | Housekeeping | `frontdesk` | aus | `housekeeping` | `housekeeping_tasks`, `room_issues` | 17.1 |
| `guestnotes` | Gäste-Notizen | – | aus | `guestbook` | – | 17.2 |
| `statistics` | Statistik | – | an | `statistics`, `statistics/hesta` | `guest_registrations` | 17.3, 19.8 |
| `mailtexts` | Gäste-Mails | – | an | `mail-texte` | – | 17.5 |
| `groups` | Gruppen | – | aus | `groups` | `group_block_days`, `groups` | 18.1 |
| `accountingexport` | Buchhaltung-Export | `invoicing` | aus | `buchhaltung` | – | 18.3 |
| `terminal` | Kartenterminal | `invoicing` | aus | `terminal` | `onsite_payments`, `terminal_payments`, `terminal_readers` | 18.4 |
| `access` | Zutritt (Nuki) | `frontdesk` | aus | `zutritt` | `door_codes`, `door_locks` | 18.5 |
| `invoicing` | Rechnung & Kasse | – | an | `invoices`, `invoices/tagesabschluss` | `api_keys`, `bank_entries`, `booking_extras`, `booking_rooms`, `companies`, `day_closes`, `folio_items`, `invoice_dunnings`, `invoice_lines`, `invoices`, `onsite_payments`, `owner_costs`, `owner_statements`, `owners`, `pos_devices`, `pos_items`, `pos_order_lines`, `pos_orders`, `pos_receipts`, `pos_tables`, `resource_bookings`, `resources`, `terminal_payments`, `terminal_readers` | 16.3, 18.3, 18.4, 19.1, 19.7, 19.10, 19.11, 19.15, 19.16 |
| `debtors` | Debitoren | `invoicing` | aus | `invoices/debitoren` | `bank_entries`, `companies`, `invoice_dunnings` | 19.7 |
| `owners` | Eigentümerabrechnung | `invoicing` | aus | `owners` | `owner_costs`, `owner_statements`, `owners` | 19.10 |
| `resources` | Angebote vor Ort | `invoicing` | aus | `resources`, `resources/angebote` | `folio_items`, `inquiries`, `offer_lines`, `offers`, `resource_bookings`, `resources` | 19.11, 19.21 |
| `marketing` | Newsletter | – | aus | `marketing` | `newsletters` | 19.12 |
| `api` | Website-Schnittstelle (API) | – | aus | `api` | `api_idempotency`, `extras`, `webhook_deliveries` | 19.22 |
| `shop` | Shop & Lager | `invoicing` | aus | `shop` | `folio_items`, `goods`, `minibar_refills`, `pos_items` | 19.51 |
| `posbridge` | Kassen-Schnittstelle | `invoicing` | aus | `posbridge` | `api_keys`, `folio_items` | 19.15 |
| `restaurant` | Restaurant | – | aus | `restaurant/heute`, `restaurant/reservierungen`, `restaurant/tischplan`, `restaurant/warteliste`, `restaurant/kueche`, `restaurant/artikel`, `restaurant/tische`, `restaurant/tisch-qr`, `restaurant/einstellungen`, `restaurant/bestellungen`, `restaurant/bestellung-einstellungen`, `restaurant/fahrer`, `restaurant/online-verkaeufe`, `restaurant/auswertung` | `online_order_settings`, `online_orders`, `order_screens`, `sms_outbox` | 20.4 |
| `pos` | Kasse | `restaurant`, `invoicing` | aus | `restaurant`, `kasse`, `restaurant/geraete`, `restaurant/abschluss` | `folio_items`, `online_order_settings`, `online_orders`, `onsite_payments`, `order_screens`, `pos_devices`, `pos_items`, `pos_order_lines`, `pos_orders`, `pos_receipts`, `pos_tables`, `sms_outbox` | 19.16, 20.4 |
| `inbox` | Posteingang | – | aus | – | – | 19.9 |
| `feedback` | Bewertungen | – | aus | `feedback` | `stay_feedback` | 19.2 |
| `pricing_rules` | Preisempfehlung | – | aus | `preise` | `ai_plans`, `ai_pricing_runs`, `channex_outbox`, `pricing_events`, `pricing_proposals`, `pricing_rules` | 19.3, 19.20 |
| `vouchers` | Gutscheine | – | an | `vouchers` | – | – |
| `guests` | Online-Check-in & Meldeschein | – | aus | – | – | – |
| `monthlymail` | Monatsmail | – | aus | – | – | – |
| `inquiries` | Anfragen | – | an | – | `inquiries`, `offer_lines`, `offers`, `resources` | 19.21 |
