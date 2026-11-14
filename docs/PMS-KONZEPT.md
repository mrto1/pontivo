# Pontivo PMS: Konzept

Stand 14.11.2026. Entwurf zur Entscheidung, noch nicht in `docs/SPEC.md` (dort erst nach Freigabe als Abschnitt 16, dann bauen).

## 1. Ziel

Pontivo soll für kleine Betriebe (Hotel garni, B&B, Ferienwohnungen, Berggasthaus, bis ca. 40 Zimmer) alles bieten, was die günstigen Komplettlösungen bieten, und dazu Direktbuchung, KI-Chat und Schweizer Besonderheiten, die dort schwach sind (TWINT, QR-Rechnung, Kurtaxe, Gästemeldung, Banana). Leitplanken:

- **Modular:** Jede Funktion ist ein Modul, das ein Betrieb ein- oder ausschalten kann. Ausgeschaltet heisst: unsichtbar (Menü, Übersicht, Mails), Daten bleiben erhalten.
- **Eine Plattform, ein Code:** Keine Hotel-Sonderlösungen (siehe `CLAUDE.md`). Unterschiede sind Einstellungen und Module.
- **Einfach vor vollständig:** Ein Einzelbetrieb mit 6 Zimmern soll nach 30 Minuten arbeiten können, ohne ein einziges Modul zu verstehen, das er nicht braucht.

## 2. Wo wir stehen

| Bereich | Stand | Bemerkung |
| --- | --- | --- |
| Buchungen, Kalender, Verfügbarkeit, Preise/Tarife | vorhanden | Direkt, Channex (Portale), iCal-Abgleich |
| Zahlungen (Stripe, TWINT), Anzahlung/Rest, Storno, Gutscheine | vorhanden | |
| Extras, Upselling | vorhanden | |
| Gästeregister, Online-Check-in, Meldeschein, Kurtaxe-Liste | vorhanden (SPEC 14) | AVS/EasyGov-Schnittstelle vorbereitet |
| Mehrere Betriebe pro Konto, Übersicht | vorhanden | |
| Buchhaltungsexport | Banana (Monatsdatei) | |
| Team, Rollen (owner/manager/staff) | vorhanden | grob, noch nicht pro Modul |
| Admin als Handy-App (PWA/Push) | teilweise | Push vorhanden |
| **Zimmerplan mit Zimmerzuweisung** | fehlt | heute Zimmertyp + Anzahl, keine einzelne Zimmernummer |
| **Rechnung / Quittung (MWST, QR-Rechnung)** | fehlt | |
| **Kasse: Zahlung vor Ort, Anzahlung buchen, Tagesabschluss** | fehlt | |
| **Housekeeping (Reinigungsstatus, Aufgaben)** | fehlt | |
| **Gruppen (Blockierung, Rooming-Liste, Rechnung an Firma)** | fehlt | |
| **Berichte (Belegung, ADR, RevPAR, Herkunft)** | teilweise | Abrechnungsbericht vorhanden, Kennzahlen fehlen |
| **Gäste-CRM (Stammgäste, Notizen, Tags)** | teilweise | Gästeliste vorhanden |
| **Türschlösser, Zahlungsterminals** | fehlt | siehe 6 |
| **Buchhaltung über Banana hinaus** | fehlt | bexio, Abacus, Run my Accounts |

## 3. Vergleich mit den günstigen Anbietern

Wer sich mit Little Hotelier, Beds24, Smoobu, Cloudbeds (Einstiegspreise ca. 30–150 CHF/Monat) vergleicht, erwartet mindestens: einheitlicher Kalender mit Zimmerplan, Rechnungen, Housekeeping-Liste, Gäste-Notizen, einfache Berichte, Vorlagen für Mails, Rollen, Channel-Manager, Zahlungen. Wir haben davon die Hälfte. Mit den Stufen A und B (unten) sind wir auf Augenhöhe, mit C und D klar besser bei Schweizer Betrieben. Ehrlich: Mews/Protel/Opera-Funktionstiefe (Yield, Kettenverwaltung, Restaurant-POS) erreichen wir nicht und streben wir vorerst nicht an.

## 4. Module

Jedes Modul hat: Schlüssel, Abhängigkeiten, Standard (an/aus), Menüeinträge, Rollen-Rechte, Preis (inklusive oder Zusatz).

| Modul | Inhalt | Abhängig von | Standard |
| --- | --- | --- | --- |
| `core` Buchungen & Kalender | wie heute | – | immer an |
| `frontdesk` Rezeption | Tagesliste (Anreisen, Abreisen, im Haus), Zimmerplan, Zimmerzuweisung, Zimmerwechsel, Walk-in, No-Show | core | an |
| `invoicing` Rechnung & Kasse | Rechnung/Quittung PDF, MWST, QR-Rechnung, Posten (Extras, Minibar, Restaurant auf Zimmer), Zahlungen vor Ort, Tagesabschluss | core | an |
| `housekeeping` Reinigung | Zimmerstatus (sauber/schmutzig/geprüft/gesperrt), Tagesaufträge nach Abreise/Aufenthalt, Handy-Liste für Personal, Wartungsmeldungen | frontdesk | aus |
| `groups` Gruppen | Blockierung mit Frist, Rooming-Liste, Teilnehmerliste für Meldung, Sammelrechnung, Anzahlungsplan | frontdesk, invoicing | aus |
| `guests` Gäste & Meldung | wie SPEC 14: Check-in, Meldeschein, Kurtaxe-Abrechnung; dazu Gäste-Notizen, Tags, Stammgäste | core | an |
| `reports` Berichte | Belegung, ADR, RevPAR, Herkunft/Kanal, Pickup, Storno-Quote, Direktanteil, Export CSV | core | an |
| `comms` Gäste-Mails | Vorlagen, Mails vor/nach Aufenthalt, Upselling | core | an |
| `upsell`, `ai_chat` | bestehende Zusatzmodule | | aus |
| `accounting` Buchhaltung | Banana (vorhanden), bexio, Abacus, Run my Accounts, CAMT-Abgleich Zahlungseingänge | invoicing | aus |
| `access` Zutritt | Türschloss-Codes pro Buchung | frontdesk | aus |
| `terminal` Kartenterminal | Zahlung am Empfang | invoicing | aus |
| `multi` Mehrere Betriebe | wie heute | | an |

**Ausblenden:** Neue Seite Einstellungen → Funktionen: pro Modul ein Schalter mit einem Satz Erklärung. Aus = weg aus Menü, Übersicht, Berichten, Rollen-Auswahl und automatischen Mails. Abhängigkeiten werden erklärt («Gruppen braucht Rechnung & Kasse»). Beim Anlegen eines Betriebs fragt der Assistent «Was brauchen Sie?» (Ferienwohnung nur mit Buchung und Kalender; Hotel mit Rezeption, Housekeeping, Rechnung).

## 5. Wie es in die bestehende Plattform passt

- **Modul-Register** in `src/domain/modules.ts` (Schlüssel, Abhängigkeiten, Menü, Rechte, Standard). `hotel_modules` gibt es schon; die feste CHECK-Liste (`guests, invoicing, housekeeping, reports, groups, ai_chat, upsell`) wird durch das Register ersetzt. Die Navigation (`src/admin/nav.ts`) zeigt nur Einträge aktiver Module. `requireHotel()` prüft zusätzlich `requireModule(hotel, "housekeeping")`, damit ausgeschaltete Seiten auch per Adresse nicht erreichbar sind.
- **Zimmernummern:** neue Tabelle `rooms` (Nummer, Zimmertyp, Etage, Status, Notiz). `bookings` bekommt `room_id` (leer = nur Zimmertyp, wie heute). Verfügbarkeit bleibt auf Zimmertyp-Ebene gezählt (Channex/iCal ändern sich nicht); die Zuweisung ist eine zweite Schicht obendrauf. Automatische Zuweisung beim Check-in-Tag, manuelle per Drag & Drop. Wichtig: kein Umbau des bewährten Bestands-Zählers.
- **Rechnungen:** `invoices` (Nummernkreis pro Betrieb, lückenlos), `invoice_lines` (Beschreibung, Menge, Preis, MWST-Satz), `folio_items` (Posten pro Buchung: Zimmer, Extras, Kurtaxe, Vor-Ort-Käufe), `payments` bleibt Quelle der Wahrheit für Geld. Rechnung ist unveränderlich nach Versand, Korrektur nur per Gutschrift. MWST: Beherbergung hat in der Schweiz einen Sondersatz (3,8 %, befristet bis Ende 2027, Stand prüfen), Verpflegung 8,1 % bzw. 2,6 %; Kurtaxe ist keine MWST-Leistung. Betriebe, die nicht MWST-pflichtig sind, bekommen Rechnungen ohne MWST. QR-Rechnung nach Swiss Payment Standards für offene Beträge (Firmen, Gruppen).
- **Housekeeping:** `room_status` und `housekeeping_tasks`; Aufgaben entstehen aus Buchungen (Abreise → Reinigung, Aufenthalt > N Tage → Zwischenreinigung). Handy-Ansicht für Personal mit eigener Rolle `housekeeping` (sieht nur Zimmer, keine Preise oder Gästedaten ausser Name/Hinweis).
- **Gruppen:** `group_blocks` (Zimmertypen × Nächte reserviert, Freigabefrist), Rooming-Liste verknüpft mit `guest_registrations`. Blockierung nutzt dieselbe Inventar-Buchung mit Outbox-Eintrag zu Channex wie heute.
- **Kurtaxe und Gästemeldung:** bestehen (SPEC 14). Ergänzung: Abrechnung pro Quartal mit Beleg an die Gemeinde (Export), Meldung via AVS/EasyGov sobald verfügbar (`RegistrationReporter` ist vorbereitet).
- **Rechte:** Rollen werden pro Modul feinkörnig (z. B. Reinigung: nur Housekeeping; Rezeption: ohne Berichte/Preise; Buchhaltung: nur Rechnungen/Export). Jede Aktion bleibt im `audit_log`.
- **Mandantentrennung, Geld in Rappen, Daten als Strings:** unverändert nach `CLAUDE.md`.

## 6. Schnittstellen (Adapter-Muster)

Gemeinsames Muster: Tabelle `integrations` (Betrieb, Art, Anbieter, verschlüsselte Zugangsdaten, Status) und ein TypeScript-Interface pro Art, mehrere Anbieter dahinter, Tests mit Fake-Anbieter (wie `PaymentProvider`). Vor jedem Anbieter gilt: Dokumentation lesen, keine API-Felder erfinden.

- **Türschlösser** (`LockProvider`: Code für Aufenthalt anlegen und widerrufen, Gültigkeit Check-in bis Check-out). Kandidaten: Nuki (Web API, in der Schweiz verbreitet), TTLock, Salto KS (Cloud). Code wird beim Check-in-Link/Ankunftsinfos angezeigt und mit der Mail vor Anreise versandt; ersetzt die heutige statische Code-Angabe pro Zimmertyp. Risiko: Gerätekosten und Support liegen beim Betrieb; Aufbau pro Anbieter ca. eine Woche.
- **Zahlungsterminals** (`TerminalProvider`): Stripe Terminal (Reader wie WisePOS E/S700) passt zu unserem Connect-Konto; Zahlung am Empfang wird als `payment` auf die Buchung gebucht, Provision wie bei Online. Schweizer Terminals von SIX/Worldline haben meist keine offene Schnittstelle zu kleinen PMS; vorerst nicht verfolgen. TWINT vor Ort über QR-Code von Stripe prüfen.
- **Buchhaltung** (`AccountingExporter`): Banana vorhanden; bexio (API), Abacus/Run my Accounts/Sage per Datei oder API. Debitoren aus Rechnungen, Zahlungseingänge per CAMT.054-Datei abgleichen (QR-Rechnung).
- **Meldewesen:** AVS, EasyGov (siehe SPEC 14).
- **Weitere später:** Telefonanlage/Anrufer-ID, Schlüsselkartensysteme (Vingcard), Kassen (Restaurant), Bewertungsplattformen, Gästekarte (Destination).

## 7. Reihenfolge

| Stufe | Inhalt | Warum zuerst | Aufwand |
| --- | --- | --- | --- |
| **A Rezeption und Rechnung** | Modul-Register und «Funktionen»-Seite, Zimmer (Nummern), Zimmerplan, Tagesliste, Rechnung/Quittung PDF mit MWST und QR-Rechnung, Zahlung vor Ort verbuchen | grösste Lücke zu den Günstigen; ohne Rechnung kein ernsthafter Betrieb | L |
| **B Betrieb** | Housekeeping mit Handy-Liste, Gäste-Notizen/Tags, Berichte (Belegung, ADR, RevPAR, Herkunft), Rollen pro Modul, Mail-Vorlagen | macht das Tagesgeschäft vollständig | M–L |
| **C Schweiz und Vernetzung** | Gruppen, Kurtaxe-Quartalsabrechnung, bexio/Abacus-Export, Stripe Terminal, Nuki | hier gewinnen wir gegen ausländische Anbieter | L |
| **D Skalierung** | Mehrbetrieb-Berichte (Kette), Offene API/Webhooks, Marktplatz für Integrationen, Schlüsselkarten | für grössere Kunden und Partner | L |

Aufwand: S = Tage, M = ca. 1–2 Wochen, L = mehrere Wochen bei gleichem Tempo wie bisher mit KI-Unterstützung. Jede Stufe in kleinen Scheiben liefern (ein Modul, getestet, produktiv), wie bisher.

## 8. Preismodell (Vorschlag, zu entscheiden)

- Kern (Buchung, Kalender, Rezeption, Rechnung, Berichte): wie heute über Plattformgebühr bei Direktbuchung plus Mindestgebühr, damit der Einstieg günstig bleibt.
- Betriebs-Module mit Hardware-/Support-Aufwand (Zutritt, Terminal): Zusatzpreis pro Monat oder Weitergabe der Fremdkosten.
- Optionale KI-Module: wie heute (KI-Chat Abo, Upselling 5 % Provision).
- Vergleich: Die Günstigen verlangen 30–150 CHF/Monat fix. Wer bei uns wenig Direktbuchungen macht, zahlt weniger, wer viele macht, mehr. Mindestgebühr beachten, damit PMS-Nutzer ohne Direktbuchung uns trotzdem tragen.

## 9. Risiken

- **Umfang:** Ein PMS ist nie fertig. Deshalb Stufen und Module, jede Funktion erst nach Gesprächen mit 3–5 echten Betrieben priorisieren.
- **Recht/Steuern:** MWST-Sätze, Rechnungsinhalt, Aufbewahrung (10 Jahre Geschäftsunterlagen), QR-Rechnung, Datenschutz bei Meldescheinen: Treuhänder/Anwalt prüfen lassen, bevor Rechnungen produktiv gehen.
- **Zuweisung vs. Zähler:** Die Schicht «Zimmernummer» darf Channex/iCal nicht stören; deshalb additiv bauen und mit bestehenden Tests absichern.
- **Support:** Hardware-Anbindungen erzeugen Supportfälle; erst mit Pilotbetrieben.

## 10. Entscheide, die ich von dir brauche

1. Stufe A als nächste Arbeit freigeben (dann schreibe ich SPEC-Abschnitt 16 und baue in Scheiben)?
2. Zimmernummern von Anfang an Pflicht oder optional (Ferienwohnungen brauchen sie nicht)? Vorschlag: optional, Modul `frontdesk` an.
3. Hast du schon einen Pilotbetrieb, der Rechnungen und Housekeeping testen würde?
4. Treuhänder für die Prüfung von Rechnung/MWST vorhanden?
