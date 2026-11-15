# Pontivo als Ersatz der Hotelsoftware: Umzug, Lücken, Kasse

Stand 15.11.2026. Entwurf zur Entscheidung, noch nicht in `docs/SPEC.md` (dort erst nach Freigabe, dann bauen). Baut auf `docs/PMS-KONZEPT.md` auf (Stufen A bis C sind gebaut, Stufe D dort heisst «Skalierung»; dieses Dokument ist die Stufe **E «Ersetzen»**).

## 1. Ziel und Aussage

Aussage an Kunden (Startseite, FAQ): *Bei kleinen und mittleren Häusern ersetzt Pontivo in der Regel die bisherige Hotelsoftware. Wer ein Restaurant mit eigener Kasse hat oder etwas braucht, das wir noch nicht haben, lässt die alte Software daneben weiterlaufen.*

Damit das stimmt, braucht es vier Dinge: einen **Umzug**, der in einem Nachmittag machbar ist (Abschnitt 2), die **fehlenden Funktionen** (3), ein **Produkt drumherum** aus Onboarding, Support und Notfallplan (4) und für Restaurants eine **eigene Kasse** als Zusatzmodul (5). Reihenfolge und Aufwand: Abschnitt 6.

Zielgruppe bleibt: Hotel garni, B&B, Ferienwohnungen, Berggasthaus, bis ca. 40 Zimmer.

## 2. Umzug aus der bisherigen Software (wichtigster Teil)

### 2.1 Grundsätze
- **Kein Wechsel mitten im Betrieb erzwingen.** Parallelbetrieb ist normal: alte Software läuft weiter, Pontivo übernimmt schrittweise.
- **Keine Doppelbuchungen, nie.** Importierte Reservierungen belegen das Inventar wie echte Buchungen (Abschnitt 2.5).
- **Ein Code für alle** (`CLAUDE.md`): Importformate sind «Quellprofile» in Code für alle Hotels, keine Hotel-Sonderlösung.
- **Der Umzug ist umkehrbar:** Import ist rückgängig machbar, und der Gesamtexport (2.9) gibt jederzeit alle Daten heraus.
- **Der Gastgeber muss keine Datenbank verstehen:** geführter Assistent, Prüfbericht in Klartext.

### 2.2 Ablauf aus Sicht des Gastgebers
1. **Einstellungen, «Umzug»** (auch im Einrichtungs-Assistenten: Frage «Haben Sie bereits eine Hotelsoftware?»).
2. **Software wählen** (Quellprofil) oder «andere / Excel». Anleitung: wie exportiere ich dort die Daten (Bildschirmfotos, Schritt für Schritt).
3. **Dateien hochladen** (CSV/Excel). Pontivo erkennt Spalten selbst, der Gastgeber bestätigt die Zuordnung.
4. **Zuordnen:** Zimmerkategorien der alten Software auf Pontivo-Zimmertypen, Tarife auf Pontivo-Tarife, MWST-Sätze. Vorschläge werden gemacht, Entscheid liegt beim Gastgeber.
5. **Trockenlauf:** Prüfbericht ohne etwas zu schreiben (Anzahl pro Art, Fehler, Warnungen, Doppelte, Überbuchungen). Erst wenn keine Fehler mehr da sind, geht es weiter.
6. **Import ausführen.** Ergebnis: Zusammenfassung und Stichprobenliste «Prüfen Sie diese 10 Reservierungen».
7. **Parallelbetrieb** mit Banner im Admin, bis zur **Umschalt-Checkliste** (2.6).

### 2.3 Was übernommen wird (Reihenfolge = Abhängigkeit)
| Nr. | Daten | Hinweis |
| --- | --- | --- |
| 1 | Zimmer und Zimmertypen | Namen, Nummern, Etage, Kapazität. Bilder und Texte nicht (Website-Assistent). |
| 2 | Tarife und Preise | **nicht automatisch ausrechnen:** Preise ab Importdatum je Tarif und Zimmertyp als Tabelle übernehmen, Pontivo-Logik (Saison, Mindestaufenthalt) richtet der Gastgeber danach ein. |
| 3 | Gäste (Stamm) | Name, Adresse, E-Mail, Telefon, Sprache, Notiz. Dublettenprüfung nach E-Mail und Name plus PLZ. |
| 4 | **Zukünftige Reservierungen** | Pflicht: Anreise bis Abreise, Zimmertyp oder Zimmer, Personen, Tarif, Preis, Status, Anzahlung/Bezahltes, Bemerkung, externe Buchungsnummer. |
| 5 | Vergangene Reservierungen | Optional, nur für Statistik und Stammgast-Erkennung (kein Inventar, keine Mails). |
| 6 | Offene Rechnungen und Guthaben | Nur offene Posten (Rechnung auf Rechnung, Anzahlungen, Gutscheine mit Restwert). |
| 7 | Gutscheine | Code, Restwert, Ablauf. |

**Nicht übernommen:** alte Rechnungen als Buchungsdaten (siehe 2.7), Zahlungsdaten von Karten (nie), Marketing-Einwilligungen ohne Beleg (2.8).

### 2.4 Technik
- Neue Tabellen (Migration, `CLAUDE.md`: Datei in `db/migrations/` und `src/db/schema.ts`):
  - `import_jobs` (id, hotel_id, source_profile, status `draft|checked|running|done|undone|failed`, created_by, created_at, summary jsonb)
  - `import_files` (job_id, kind, filename, content_hash, storage_ref, deleted_at)
  - `import_rows` (job_id, entity, row_no, raw jsonb, mapped jsonb, severity `ok|warn|error`, message, target_id)
  - `import_mappings` (job_id, kind `room_type|rate_plan|tax_rate`, source_value, target_id)
- **Spalte `source_ref` (text) und `import_job_id` (uuid) auf `bookings`, `guests`, `vouchers`, `invoices`.** Eindeutig je Hotel auf `(hotel_id, source_ref)`: ein zweiter Import derselben Datei erzeugt keine Dubletten (idempotent, aktualisiert statt zu verdoppeln).
- **Quellprofile** (`src/integrations/import/profiles/*.ts`): je Anbieter Spaltennamen, Datumsformat, Statuswörter. Reine Funktion `parse(file) → Zeilen`, Tests mit Beispieldateien. Ein «generisches Pontivo-CSV» ist das Basisprofil, dazu eine Vorlage zum Herunterladen mit Spaltenbeschreibung.
- **Welche Anbieter zuerst:** offene Frage (QUESTIONS.md). Vorschlag: generisches CSV/Excel zuerst, dann die zwei bis drei meistgenutzten im Zielmarkt nach Rückfrage bei echten Interessenten.
- Verarbeitung in **Hintergrundjobs** (pg-boss), Fortschritt im Admin. Grosse Dateien in Stücken.
- Zugriff nur über `requireHotel()` mit Rolle `owner` oder `manager`. Jede Abfrage nach `hotel_id`.
- Audit: pro Job ein `audit_log`-Eintrag (Start, Ergebnis, Rückgängig).

### 2.5 Verfügbarkeit, Preise, Kanäle
- Importierte zukünftige Reservierungen werden über die **bestehenden Buchungsfunktionen** angelegt (nicht direkt in die Tabellen), damit `inventory_days`, `channex_outbox` und `audit_log` in derselben Transaktion nachgeführt werden (Regel in `CLAUDE.md`).
- **Überbuchung im Trockenlauf erkennen:** Wären mehr Zimmer belegt als vorhanden, steht das im Prüfbericht als Fehler mit Datum und Zimmertyp. Der Gastgeber löst es dort (Zimmertyp anpassen, Reservierung auslassen).
- Importierte Buchungen lösen **keine Gäste-Mails** und **keine Zahlungen** aus (Flag `suppress_notifications` im Importkontext). Wer Bestätigungen will, schaltet sie bewusst pro Import ein.
- **Kanäle (Channex, Booking.com, Airbnb):** Der Kanal darf nie gleichzeitig von zwei Systemen gesteuert werden. Umschalt-Checkliste (2.6) führt: erst Pontivo verbinden und Verfügbarkeit prüfen, dann im alten System den Kanal trennen. Bis dahin hilft der bestehende **iCal-Abgleich** als Brücke.

### 2.6 Parallelbetrieb und Umschalten
- **Brücke:** iCal-Feed des alten Systems wird als Sperrzeit gelesen (vorhanden, `ical_feeds`), Pontivo-Direktbuchungen kommen über iCal zurück in die alte Software, bis sie abgeschaltet ist. Banner «Parallelbetrieb» zeigt die Grenzen.
- **Umschalt-Checkliste** (Seite im Admin, Punkt für Punkt, jeder Punkt prüfbar oder bestätigbar):
  1. Zimmer, Preise, Tarife stimmen (Stichprobe).
  2. Zukünftige Reservierungen vollständig (Zähler Alt gegen Neu).
  3. Kanalmanager auf Pontivo umgestellt, alter Kanal getrennt.
  4. Zahlungskonto (Stripe) aktiv, Testzahlung ausgeführt.
  5. Rechnungsnummern-Start gesetzt (2.7).
  6. Team eingeladen, Rollen gesetzt, 2FA empfohlen.
  7. Alter Zugang: Kündigungsfrist und Datenexport erledigt (Hinweis, nicht Pflicht).
- Nach dem Umschalten: 30 Tage «Rückweg»: Import bleibt rückgängig machbar, solange an den Daten nichts Wesentliches bearbeitet wurde (2.4: Rückgängig nur für Datensätze ohne spätere Zahlung/Rechnung, sonst gezielte Liste).

### 2.7 Rechnungen und Aufbewahrung
- **Lückenlose Nummer:** Einstellung «Nächste Rechnungsnummer» pro Betrieb (Startwert und Format), damit die Reihe der alten Software ohne Lücke und ohne Doppel weiterläuft.
- **Alte Rechnungen:** werden **nicht** als Buchungsdaten importiert (falsche Zahlen im Bericht wären schlimmer als keine). Aufbewahrung 10 Jahre bleibt beim Gastgeber. Pontivo bietet optional eine **Dokumentenablage** (PDF hochladen, Datum, Kategorie, unveränderlich), damit alles an einem Ort liegt. ASSUMPTION: Das ist Komfort, kein rechtliches Archiv. Rechtliche Einordnung klärt der Treuhänder.

### 2.8 Datenschutz
- Der Import ist **Auftragsverarbeitung** (AVV bereits vorhanden, ergänzen). Hochgeladene Dateien werden **30 Tage nach Abschluss gelöscht** (`import_files.deleted_at`), die Daten selbst bleiben.
- **Marketing-Einwilligung** wird nicht übernommen, ausser die Quelldatei hat eine belegte Spalte dafür (Wert und Datum). Sonst `false`.
- Gästedaten von Reservierungen, die schon vorbei sind und keinen Zweck mehr haben, werden nach den bestehenden Aufbewahrungsregeln behandelt.

### 2.9 Gesamtexport (Gegenstück, wichtig für Vertrauen)
- Seite «Meine Daten exportieren» (Inhaber): ZIP mit CSV je Tabelle (Buchungen, Gäste, Zimmer, Tarife, Rechnungen, Zahlungen, Gutscheine, Meldescheine) und allen Rechnungs-PDFs. Läuft im Hintergrund, Link per E-Mail, 7 Tage gültig. Jederzeit, kostenlos.
- Gleiches Schema wie das generische Import-CSV, damit man auch **zurück oder weiter** kann.

### 2.10 Abnahmekriterien (als Tests)
1. Generisches CSV mit 200 Reservierungen: Trockenlauf meldet korrekt Fehler, Warnung, Doppelte, Überbuchung; schreibt nichts.
2. Derselbe Import zweimal: keine Dubletten (`source_ref`).
3. Importierte Buchung verringert Verfügbarkeit in `inventory_days` und erzeugt `channex_outbox`/`audit_log` in derselben Transaktion.
4. Import mit Überbuchung kann nicht ausgeführt werden.
5. Importierte Buchungen lösen keine Mails und keine Zahlung aus.
6. Rückgängig: alle Datensätze des Jobs ohne spätere Zahlung/Rechnung verschwinden, Inventar ist wieder frei; mit Zahlung wird sie in der Liste gemeldet und bleibt.
7. Mandantentrennung: Job von Hotel A ist für Hotel B nicht sichtbar oder auslösbar.
8. Gesamtexport enthält alle Tabellen, nur des eigenen Hotels, und lässt sich im Import-Trockenlauf wieder lesen.
9. Rechnungsnummer: Startwert gesetzt, nächste Rechnung folgt lückenlos.

## 3. Fehlende Funktionen: wie sie ins bestehende Konstrukt passen

Pontivo besteht aus **Modulen** (`src/domain/modules.ts`: Schlüssel, Abhängigkeiten, Standard an/aus, Menüpunkt, Rollenbereich). Jede neue Funktion wird ein Modul oder die Erweiterung eines bestehenden. So bleibt ein 6-Zimmer-Betrieb unberührt (ausgeschaltet = unsichtbar, Daten bleiben).

| Funktion | Modul | Hängt an | Standard | Daten (neu) | Aufwand |
| --- | --- | --- | --- | --- | --- |
| Firmenkunden, Rechnung auf Rechnung, Zahlungseingänge, Mahnwesen | `debtors` (neu) | `invoicing` | aus | `companies`, `dunning_runs`, Feld `invoices.company_id`, `invoices.due_at` | M–L |
| Buchhaltungs-Export bexio, Abacus, Sage | Erweiterung `accountingexport` | `invoicing` | aus | keine (Exporter pro Anbieter hinter `AccountingExporter`) | M je Anbieter |
| Pauschalen (Halbpension, Arrangements) | Erweiterung Tarife | Kern | an | `rate_plans.board` (`none|breakfast|half|full`, löst `breakfast_included` ab), Pauschal-Leistungen mit MWST-Aufteilung | M |
| Zimmerwechsel, Upgrade | Erweiterung `frontdesk` | `frontdesk` | an | Verlauf in `booking_rooms` (von, bis, Zimmer), Preisfolge (gratis/Aufpreis) | S–M |
| Schlüsselkarten | Erweiterung `access` | `access` | aus | `KeyProvider`-Schnittstelle neben Nuki | L, hardwareabhängig, später |
| Wellness, Sauna, Seminarraum, Tennis (buchbare Ressourcen) | `resources` (neu) | `invoicing` (für Posten aufs Zimmer) | aus | `resources`, `resource_slots`, `resource_bookings` | M–L |
| Seminare: Angebot und Raumbuchung | Erweiterung `inquiries` + `resources` | beide | aus | Anfrage → Angebot (PDF) → Raumbuchung | M |
| Gästekarte der Destination | Erweiterung `guests` | `guests` | aus | je Destination verschieden, **Anforderungen klären, nicht raten** | unklar |
| Mehrzimmerbuchung, Tagesabschluss | **zuerst im Code prüfen**: `booking_rooms` und `onsite_payments` existieren, ob die Abläufe vollständig sind, ist offen | | | | S (Prüfung) |

**Wo es im Menü und in den Rollen landet**
- `debtors`: Menü «Mein Betrieb → Debitoren», Rollen `owner`, `manager`, `accounting`.
- `resources`: Menü «Mein Betrieb → Angebote vor Ort», Rollen `owner`, `manager`, `reception` (buchen), `housekeeping` nicht.
- Neue Bereiche kommen in `ROLE_AREAS` (`src/domain/roles.ts`) und in den Test «alle Bereiche der Rollen sind echte Menüpunkte».
- Preisanzeige und Funktionsliste («Einstellungen → Funktionen») bekommen je Modul einen Satz Erklärung, wie heute.

**Regeln für alle**
- Eigene Migration pro Modul, `CLAUDE.md`-Regeln (Rappen, `hotel_id`, `requireHotel()`).
- Jede Änderung an Verfügbarkeit oder Preisen: Outbox und Audit in derselben Transaktion.
- Fremde Schnittstellen nur nach verlinkter Doku (SPEC 13), keine erfundenen Felder.

## 4. Betrieb als Produkt (Punkt 5)

Ein System, das die Hotelsoftware ersetzt, muss nicht nur funktionieren, es muss **vertrauenswürdig und erklärbar** sein.

### 4.1 Eignungs-Check im Onboarding
Beim Einrichten (und auf der Startseite) drei Fragen: Zimmerzahl, «Haben Sie ein Restaurant mit eigener Kasse?», «Welche Software nutzen Sie jetzt?» Antwort:
- **Passt** (ersetzt Ihre Software, Umzug geführt),
- **Passt mit Kassen-Schnittstelle oder Kassenmodul** (Restaurant),
- **Läuft daneben** (z. B. über 40 Zimmer, Spezialwünsche; Direktbuchung und Kanäle trotzdem nutzbar).
Die Seite verspricht nie mehr, als die Antwort hergibt.

### 4.2 Einarbeitung
- Checkliste «Erste Woche» pro Rolle (Rezeption, Reinigung, Buchhaltung): 5 bis 8 Aufgaben mit Link.
- Hilfeseiten pro Modul (ein Absatz, ein Bild) direkt neben der Funktion.
- Optional: Einrichtungshilfe gegen Entgelt (Umzug begleiten), nicht Pflicht.

### 4.3 Verlässlichkeit
- **Notfall-Rezeption:** Täglich um 06:00 geht eine **Tagesliste (Anreisen, Abreisen, im Haus, Zimmer, Bemerkungen) per E-Mail als PDF** an den Betrieb. Zusätzlich liest die Admin-App die Tagesliste **auch ohne Internet** (Service Worker, nur lesen). Ohne Internet gibt es keine neuen Buchungen, aber die Rezeption steht nicht still.
- **Backups:** Datenbank täglich, 30 Tage Aufbewahrung, **Wiederherstellungstest vierteljährlich dokumentiert**. Das ist offen (DEPLOY.md), vor dem Versprechen erledigen.
- **Überwachung:** Statusseite (`system_status` existiert), Alarm bei Ausfall, Reaktionszeiten schriftlich.
- **Support:** Zeiten und Reaktionszeit festlegen (z. B. Werktage, 4 Stunden), Kanal E-Mail, Notfall-Nummer nur für zahlende Betriebe. Entscheid beim Betreiber.

### 4.4 Rechtliches (vor dem Versprechen «ersetzt Ihre Software»)
Treuhänder/Anwalt bestätigt: Rechnungsinhalt und MWST, QR-Rechnung (echter Scan), Aufbewahrung, Meldeschein und Kurtaxe, AVV und AGB. Offen und in `QUESTIONS.md`: AVS-Schnittstelle, Gästemeldung AI, HESTA, einige Kurtaxe-Sätze. Ohne diese Bestätigung bleibt die Aussage vorsichtig («in der Regel», «kleine und mittlere Häuser»).

## 5. Modul «Restaurant und Kasse» (`pos`, optional, später)

**Idee:** Kleine Restaurantkasse für Betriebe mit einem Restaurant bis ca. 60 Plätze. Wichtigster Nutzen: **Zahlung aufs Zimmer** ohne doppelte Erfassung, dazu Rechnung, MWST und Tagesabschluss aus einer Hand. Nicht gedacht für grosse Küchen mit mehreren Druckerplätzen (dort bleibt die vorhandene Kasse, siehe 5.5).

### 5.1 Umfang Version 1
- Artikelstamm mit Kategorien, Preis, MWST-Satz (Vor-Ort-Verzehr und Take-away getrennt), Tagesangebot.
- Tischplan (einfach: Tische benennen, Status frei/besetzt/zu bezahlen).
- Bestellung am Tisch (Handy/Tablet im Browser), Nachbestellung, Splitten nach Gast oder Posten, Storno und Rabatt mit Grund (Rolle nötig).
- Bezahlen: **bar, Karte (Stripe Terminal, vorhanden), TWINT, aufs Zimmer**. Trinkgeld.
- Bon (PDF oder Drucker über Browser/Netzwerk), Tagesabschluss (Z-Bericht), Export an Buchhaltung.
- Ausgeschlossen in V1: Küchen-/Bardrucker-Routing, Reservierungsverwaltung (Tische), Lagerbestand, Mitarbeiterzeiten, Bonusprogramme.

### 5.2 Ins Konstrukt
- Modul `pos`, hängt an `invoicing`, Standard aus, Menü «Mein Betrieb → Restaurant», eigene Rolle `service` (Bestellen, Kassieren) und Bereich in `ROLE_AREAS`.
- Tabellen: `pos_items`, `pos_tables`, `pos_orders`, `pos_order_lines`, `pos_payments`, `pos_day_closes`. Alles mit `hotel_id`.
- **Aufs Zimmer:** schreibt in die bestehenden `folio_items` der Buchung (Leistungsart «Restaurant», MWST-Satz der Zeile). Die Hotelrechnung enthält die Posten automatisch.
- Zahlung per Karte über das bestehende Terminal (`terminal_payments`), bar als `onsite_payments`.

### 5.3 Rechtlich und fachlich (vor dem Bauen mit Treuhänder klären)
- MWST-Sätze je Posten (Verzehr vor Ort, Take-away, Getränke) und Ausweis auf dem Bon.
- **Unveränderlichkeit:** Bons und Tagesabschlüsse werden nie geändert oder gelöscht, nur durch Gegenbuchung storniert (`pos_order_lines` append-only, Hash-Kette optional).
- Aufbewahrung 10 Jahre, Export für die Revision.
- Anforderungen der Kantone oder der ESTV an Kassensysteme: **Anforderungen klären, nicht raten.**

### 5.4 Technik und Betrieb
- **Offline-Fähigkeit:** Bestellungen werden lokal in der App zwischengespeichert und nach Verbindungsabbruch synchronisiert (Warteschlange, eindeutige Bon-Nummern pro Gerät, Zusammenführung). Ohne Offline ist Service mit WLAN-Ausfall nicht tragbar. ASSUMPTION: Das ist die schwierigste Anforderung und braucht eigene Tests (Netz unterbrechen, doppelt senden, zwei Geräte).
- Hardware V1: beliebiges Tablet oder Handy, Kartenleser wie bisher, Bondrucker optional (Netzwerkdrucker über Browserdruck). Spezialhardware später.
- Support auch abends und am Wochenende einplanen (der Service läuft dann).

### 5.5 Schnittstelle für fremde Kassen (`PosBridge`)
Wer seine Kasse behalten will, bucht Posten aufs Zimmer über eine kleine API:
- `POST /api/v1/folio-items` mit API-Schlüssel pro Betrieb (Einstellungen, widerrufbar), Felder: Buchung oder Zimmernummer, Beschreibung, Menge, Betrag in Rappen, MWST-Satz, externe Beleg-ID.
- Idempotent über externe Beleg-ID. Nur eigenes Hotel (`hotel_id` aus dem Schlüssel).
- Welche Kassen zuerst angebunden werden: offen, Rückfrage bei Interessenten.

### 5.6 Preis (Vorschlag, zu entscheiden)
Zusatzmodul mit festem Monatspreis (Support-Aufwand abends) und ohne Provision auf Umsatz. Vergleichsrahmen: Kleine Cloud-Kassen kosten ca. 30 bis 90 CHF/Monat. Konkreten Preis erst nach Aufwandsschätzung und Treuhänder-Antwort festlegen.

## 6. Reihenfolge, Aufwand, Abhängigkeiten

| Reihenfolge | Inhalt | Aufwand | Voraussetzung |
| --- | --- | --- | --- |
| E1 | **Umzug**: generisches CSV, Prüfbericht, Import, Rückgängig, Rechnungsnummern-Start, Gesamtexport | L | keine |
| E2 | Eignungs-Check, Umschalt-Checkliste, Notfall-Tagesliste, Hilfeseiten, Erste-Woche-Checkliste | M | E1 teilweise |
| E3 | Quellprofile für 2 bis 3 gängige Programme | M je Profil | Beispieldateien von Interessenten |
| E4 | Prüfung Mehrzimmerbuchung/Tagesabschluss, Zimmerwechsel, Pauschalen (`board`) | M | keine |
| E5 | `debtors` (Firmenkunden, Mahnwesen), bexio-Export | L | `invoicing` (vorhanden) |
| E6 | `PosBridge` (API für fremde Kassen) | M | API-Schlüssel, `folio_items` |
| E7 | `resources` (Wellness, Seminar) | M–L | `invoicing` |
| E8 | `pos` (eigene Kasse) | XL | Treuhänder-Antwort, Offline-Konzept |
| später | Schlüsselkarten, Gästekarte | L | Partner/Destination |

Parallel (nicht programmieren, sondern klären): Treuhänder/Anwalt (4.4), Backup-Test, Supportzeiten, Preise.

## 7. Risiken
- **Falsches Versprechen:** «ersetzt Software» ohne rechtliche Abnahme. Gegenmittel: vorsichtige Formulierung, Abnahme vor Ausweitung.
- **Fehlerhafter Import** erzeugt falsche Buchungen oder Überbuchungen. Gegenmittel: Trockenlauf, Prüfbericht, Rückgängig, Stichprobenliste.
- **Zwei Systeme steuern denselben Kanal.** Gegenmittel: Checkliste und iCal-Brücke.
- **Kasse ist ein eigenes Produkt** (Offline, Recht, Hardware, Abendsupport). Gegenmittel: kleine V1, spät, nach Klärung.
- **Aufwand pro Quellprofil** wächst. Gegenmittel: erst generisches CSV, Profile nur auf konkrete Nachfrage.

## 8. Offene Fragen (auch in `QUESTIONS.md`)
1. Welche Hotelsoftware nutzen die ersten Zielkunden (damit E3 die richtigen Profile baut)?
2. Wie lange darf der Rückweg offen bleiben (30 Tage vorgeschlagen)?
3. Wer bietet Einrichtungshilfe an, und zu welchem Preis (oder nur Anleitung)?
4. Supportzeiten und Reaktionszeit.
5. Anforderungen an Kassensysteme (ESTV, Kantone) und Aufbewahrung der Bons.
6. Preis des Kassenmoduls und Verteilung auf Mehrwert gegen Fixpreis.
7. Welche Fremdkassen sollen zuerst über `PosBridge` angebunden werden?
8. Destination Gästekarte: welche Destinationen, welche Schnittstellen?
