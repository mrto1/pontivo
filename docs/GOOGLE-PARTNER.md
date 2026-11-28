# Google Hotelpreise: Pontivo als Connectivity-Partner

Stand der Technik und der nächsten Schritte (SPEC 19.70). Quelle der Anforderungen: Google Hotel Prices, Developer's Guide und XML-Referenz (SPEC 13).

## Was Pontivo schon kann (gebaut und getestet)

| Google verlangt | Pontivo |
|---|---|
| Hotelliste (Hotel List Feed, XML `listings`) | `GET /api/google/hotel-list?token=…` |
| Landingpage (Variablen für Hotel, Datum, Personen, Kinderalter) | Datei `GET /api/google/landing-pages?token=…`, Weiterleitung `GET /g/<Hotel-ID>` |
| Zimmer und Tarife (Property Data) | Nachricht `property`, Overlay |
| Bestand (Inventory) | `OTA_HotelInvCountNotifRQ` |
| Preise (Rate) | `OTA_HotelRateAmountNotifRQ` je Belegung, 365 Tage |
| Verfügbarkeit und Einschränkungen (Availability) | `OTA_HotelAvailNotifRQ` (Stop-Sell, CTA/CTD, Mindest-/Höchstaufenthalt) |
| Steuern und Gebühren | `TaxFeeInfo` mit Kurtaxe je Person und Nacht, Altersstufen |
| Preis auf der Landingpage = Preis auf Google (Referral/Price-Accuracy-Richtlinie) | Buchungsseite rechnet mit denselben Regeln; Kurtaxe wird getrennt ausgewiesen |
| Antworten auswerten, Fehler beheben | Antwort-Parser, Stand je Baustein, Wiederholung, Alarm |

Gesendet wird erst, wenn `GOOGLE_HOTELS_PARTNER_KEY` und `GOOGLE_HOTELS_SEND=1` gesetzt sind. Vorher lassen sich alle Nachrichten auf der Plattform-Seite (Vertrieb → Google) ansehen.

## Was nur der Betreiber tun kann

1. **Interessenformular** für Connectivity-Partner bei Google ausfüllen (Pontivo, Schweiz, Direktbuchung für Hotels). Antworten ehrlich: Start mit ersten Pilotbetrieben.
2. **Vertrag** mit Google unterschreiben (Datenschutz), technische Kontaktperson nennen, Support-Adresse für Gäste angeben.
3. **Hotel Center** Konto von Google erhalten. Dort eintragen:
   - Partner-Schlüssel (Kontoeinstellungen) → `GOOGLE_HOTELS_PARTNER_KEY`
   - IP-Adressen der Produktions-Server (Preis-Einstellungen im Hotel Center)
   - Abruf-Adresse der Hotelliste und Landingpage-Datei (mit `?token=` aus `GOOGLE_HOTELS_FEED_TOKEN`)
   - Anzeigename und Symbol der Landingpage («Pontivo» bzw. «Direkt beim Hotel»)
4. **Hotelliste hochladen** und im Matching-Report prüfen, ob Google die Häuser zuordnet (Maps-Eintrag muss zur Adresse passen).
5. **Nachrichten prüfen:** je Pilothaus die Downloads (Plattform → Google) gegen Googles Schemas vergleichen (die Schema-Prüfung läuft schon in den Tests), mit Googles Testwerkzeugen (Feed-Status im Hotel Center) und den Testreisen von Google (Landingpage-Test).
6. **Zertifizierung** mit dem technischen Ansprechpartner von Google; danach «Live on Google» je Haus.
7. Betriebe auf der Plattform-Seite **aufnehmen** (nur wenn die Voraussetzungen erfüllt sind). Betriebe, die schon über Channex bei Google laufen, dort zuerst abschalten.

## Antworten für das Interessenformular (Stand 2026-11-28)

| Feld | Antwort |
|---|---|
| Legal entity name | Lynxora GmbH (erst nach Handelsregister-Eintrag, sonst Einzelfirma) |
| Business name | Pontivo |
| Adresse | Konradstrasse 1, 8400 Winterthur, Zürich |
| CEO | Martin Guidali |
| Corporate / Booking website | https://pontivo.ch |
| Sitz / Tochtergesellschaft | Schweiz (CH) / Nein |
| Geschäft mit Kuba, Iran usw. | Nein |
| Online-Verkauf seit | noch keiner, Pilotphase (geplanter Start angeben) |
| Mitarbeitende / Buchungen pro Monat | kleinste Stufe / 0 |
| Andere Metasearch | Nein |
| Kontakt | Martin Guidali, info@pontivo.ch (gleiche Domain wie Firma), Founder & Managing Director |
| Angebot | Property Management System, Channel Manager, Central Reservation System, Booking Engine |
| Hotels beim Start | 5 (70 % = 4 vor dem Launch verbunden); nur eine sicher erreichbare Zahl nennen |
| Produkte | Free booking links (Hotel campaigns optional) |
| Standard | ARI (OTA XML Push) |
| EEA | Ja, Gäste aus der EEA werden bedient; Aggregator Unit: Ja (mehr erfahren) |
| Weitere Domains für EEA | pontivo.ch und die Domains der Hotels |
| Start | sofort |
| Bait-and-switch-Richtlinie, Bedingungen | Ja, annehmen (Kurtaxe und Pflichtgebühren werden vorab angezeigt und an Google gemeldet) |

## Fragen an Google

- Pflichtgebühr mit Basis `person` (z. B. Bettwäsche je Person und Nacht): Rechnet Google den Betrag für Kinder wie für Erwachsene, oder braucht es `AgeBrackets` auch bei `Fee`? Pontivo rechnet je Person gleich für Kinder. Wenn unklar: im Test eine Familie mit Kind buchen und den Preis mit Google vergleichen.

## Bekannte Grenzen (QUESTIONS.md)

- Pflicht-Zusatzleistungen gehen als `Fee` an Google (Betrag je Einheit, nur Typ «Betrag»); Prozentgebühren und Staffeln gibt es bei Pontivo nicht.
- Reihenfolge der XML-Elemente und Zeitformat der Stornofrist (`xs:time`, `HH:MM:SS`) sind durch die XSD-Prüfung in den Tests abgedeckt (`tests/fixtures/google-xsd`, Stand 2026-11). Bei Änderungen von Google die Dateien neu laden: `https://www.gstatic.com/ads-travel/hotels/api/<name>.xsd`.
- Pull-Modus (Live-Preise) und Promotions nicht gebaut.
