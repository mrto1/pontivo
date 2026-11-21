import type { GuideRole } from "./guide";

/**
 * Schulungsunterlagen unter «Hilfe»: Wegweiser durch das Menü, Abläufe Schritt für Schritt und Fachbegriffe
 * (was etwas bedeutet und wie Pontivo es löst). Reine Daten. `area` = Schlüssel eines Menüpunkts (src/admin/nav.ts);
 * die Seite verlinkt nur, was im Menü des Betriebs sichtbar ist (tests/unit/help-content.test.ts prüft die Schlüssel).
 */
export type Wayfinding = { area: string; title: string; what: string; notThis?: string };
export type Flow = { key: string; title: string; roles: GuideRole[]; goal: string; steps: string[]; area: string; tip?: string };
export type Term = { term: string; meaning: string; inPontivo: string; area?: string; group: "Zimmer und Preise" | "Buchung und Zahlung" | "Gäste und Meldewesen" | "Rechnung und Kasse" | "Portale und Schnittstellen" | "Kennzahlen" };

const FRONT: GuideRole[] = ["owner", "reception"];

export const WAYFINDING: Wayfinding[] = [
  { area: "home", title: "Heute (erster Reiter «Tagesliste»)", what: "Der Tag auf einen Blick: Anreisen, Abreisen und Gäste im Haus, mit Pfeilen und Datumsfeld auch für andere Tage (Vorschau). Für heute zusätzlich Hinweise mit Direktlink zur passenden Einstellung und offene Zahlungen. Daneben als Reiter Reinigung, Posteingang und Restaurant. Mit dem Online-Check-in steht bei jeder Anreise der Stand des Meldescheins.", notThis: "Kennzahlen mit Zeitraum (Belegung, gesparte Provision) stehen unter Finanzen → Statistik." },
  { area: "calendar", title: "Kalender", what: "Das Zeitraster je Zimmertyp: wie viele Zimmer sind frei, was kostet die Nacht, wo gelten Regeln (Mindestaufenthalt, Stopp). Hier ändern Sie Preise und sperren Zimmer. Erster Reiter ist der Zimmerplan (mit Rezeption), dazu Preisempfehlung.", notThis: "Einzelne Gäste und Zahlungen sehen Sie hier nicht, das sind Vorgänge unter «Buchungen». Booking.com & Co. verbinden Sie unter Einstellungen → Kanäle." },
  { area: "plan", title: "Zimmerplan (erster Reiter im Kalender)", what: "Welches Zimmer ist an welchem Tag mit welchem Gast belegt. Hier teilen Sie konkrete Zimmernummern zu und wechseln Zimmer." },
  { area: "bookings", title: "Buchungen", what: "Alle Vorgänge: Gast, Zeitraum, Zahlung, Storno. Neue Buchung von Hand (Telefon, Walk-in), No-Show, Rückerstattung. Dazu Gruppen, Angebote vor Ort, Gutscheine und Gäste (Kartei, Newsletter, Bewertungen).", notThis: "Preise und Verfügbarkeit ändern Sie im Kalender, Rechnungen stehen unter Finanzen." },
  { area: "reports", title: "Berichte (Finanzen → Berichte)", what: "Alle Listen und Exporte an einem Ort: Buchungsabrechnung, Kurtaxe-Liste, Gästeregister, HESTA und Buchhaltung, je mit Zeitraum und CSV/PDF. Der Online-Check-in (Meldeschein) wird unter Einstellungen → Funktionen eingeschaltet, sein Stand steht bei den Anreisen in der Tagesliste." },
  { area: "invoices", title: "Finanzen", what: "Rechnungen, Tagesabschluss, Debitoren, Eigentümerabrechnung, Statistik (mit gesparter Portal-Provision), Berichte und Buchhaltung.", notThis: "Plattformgebühren und Abo stehen unter Einstellungen → Abo & Gebühren (nur Inhaber)." },
  { area: "settings", title: "Einstellungen (Zahnrad oben rechts)", what: "Nur für Inhaber und Manager, in drei Gruppen. Betrieb: Grunddaten (Anzahlung, Kurtaxe, Zahlungskonto), Zimmer & Tarife, Team & Rollen. Verkauf: Website & Buchung, Kanäle, Gäste-Mails, Gästeportal, Upselling, KI-Chat. Technik: Funktionen (Module ein- und ausschalten), Geräte & Kasse, Datenübernahme, Abo & Gebühren." },
  { area: "rooms", title: "Zimmer & Tarife (Zahnrad → Betrieb)", what: "Zimmertypen, Anzahl Zimmer, Fotos, Tarife (z. B. mit Frühstück, nicht stornierbar) und Zusatzleistungen. Ein Zimmertyp ohne Tarif ist nicht buchbar." },
  { area: "site", title: "Website & Buchung (Einstellungen → Verkauf)", what: "Wie Gäste Sie finden und buchen: eigene Pontivo-Website oder nur der Buchungsknopf auf Ihrer bisherigen Seite. Layout, Schrift, Logo, Sprachen." },
  { area: "team", title: "Team & Rollen (Einstellungen → Grunddaten)", what: "Wer Zugang hat und was jede Rolle sehen darf. Eigene Rollen mit Häkchen pro Seite." },
  { area: "mypontivo", title: "Profilbild (oben rechts)", what: "Ihr Konto: Passwort, Passkey, Authenticator, Mitteilungen auf dem Handy, App installieren. Im Menü dahinter auch Erste Woche, diese Hilfe und Abmelden." },
];

export const FLOWS: Flow[] = [
  {
    key: "f_phone", title: "Eine Buchung am Telefon erfassen", roles: FRONT, area: "bookings",
    goal: "Der Gast ruft an. Das Zimmer ist danach reserviert und der Kalender sofort aktuell.",
    steps: ["Buchungen öffnen und «Neue Buchung» wählen.", "Zeitraum und Personen eingeben; Pontivo zeigt nur Zimmertypen, die frei sind.", "Zimmertyp und Tarif wählen. Der Preis kommt aus dem Kalender, Kurtaxe wird dazugerechnet.", "Name und E-Mail des Gastes eintragen (für die Bestätigung).", "Speichern. Die Bestätigung geht per Mail an den Gast."],
    tip: "Ist der Gast nicht mehr erreichbar und das Zimmer wieder gefragt: Buchung öffnen und stornieren, die Nächte sind sofort wieder frei.",
  },
  {
    key: "f_checkin", title: "Einen Gast einchecken", roles: FRONT, area: "home",
    goal: "Der Gast kommt an: Zimmer zuteilen, Meldeschein und Kurtaxe erledigen.",
    steps: ["Heute → «Tagesliste» öffnen (oder mit den Pfeilen den Tag wechseln). Dort stehen die Anreisen.", "Bei der Anreise «Einchecken» wählen und die Zimmernummer zuteilen (der Zimmerplan zeigt, welche frei ist).", "Meldeschein prüfen: Der Gast bekommt 7 Tage vor Anreise einen Link zum Online-Formular. Ausweis ansehen und am Empfang bestätigen, dass er gesehen wurde.", "Offene Restzahlung? In der Buchung als «vor Ort erhalten» verbuchen oder per Rechnung kassieren."],
    tip: "Zimmer wechseln Sie später im Zimmerplan, der Preis bleibt.",
  },
  {
    key: "f_pay", title: "Zahlung vor Ort verbuchen", roles: ["owner", "reception", "accounting"], area: "invoices",
    goal: "Bar, Karte oder TWINT am Empfang so erfassen, dass Rechnung und Tagesabschluss stimmen.",
    steps: ["Buchung öffnen und «Zahlung erfassen» wählen.", "Betrag und Zahlungsart wählen (bar, Karte, TWINT, Rechnung).", "Rechnung oder Quittung erstellen und drucken oder per Mail senden."],
    tip: "Fehler korrigieren Sie nie durch Löschen, sondern mit einer Gegenbuchung oder Gutschrift. So bleibt alles nachvollziehbar.",
  },
  {
    key: "f_cancel", title: "Eine Buchung stornieren", roles: FRONT, area: "bookings",
    goal: "Gast oder Hotel storniert; Pontivo rechnet die Gebühr nach dem Tarif und erstattet über Stripe.",
    steps: ["Buchung öffnen und «Stornieren» wählen.", "Pontivo zeigt, was nach der Regel des Tarifs erstattet wird: kostenlos bis zur Frist, danach die Gebühr in Prozent des Zimmerpreises.", "Bestätigen. Die Nächte sind sofort wieder frei, der Gast bekommt eine Mail."],
    tip: "Storniert das Hotel, wird immer voll erstattet. Buchungen von Booking.com & Co. stornieren Sie im Portal, hier steht nur ein Hinweis.",
  },
  {
    key: "f_price", title: "Preise ändern oder Zimmer sperren", roles: ["owner"], area: "calendar",
    goal: "Wochenende teurer, Zimmer für Renovation blockiert, Mindestaufenthalt in der Hochsaison.",
    steps: ["Kalender öffnen.", "Unter «Preise und Regeln setzen» Tarif, Zeitraum und Preis eintragen. Wochentage anhaken, wenn es nur für Fr/Sa gelten soll.", "Mehrere Zeilen werden zusammen gespeichert. Leere Felder bleiben unverändert.", "Zum Sperren: «Zimmer sperren / freigeben», Zimmertyp, Zeitraum und Anzahl gesperrter Zimmer."],
    tip: "Preisänderungen gehen automatisch an Booking.com & Co., wenn der Channel-Manager verbunden ist.",
  },
  {
    key: "f_overbooking", title: "Überbuchung erkennen", roles: ["owner", "reception"], area: "bookings",
    goal: "Ein Portal hat gleichzeitig ein Zimmer verkauft, das schon belegt war.",
    steps: ["Pontivo meldet die Überbuchung per Mail und markiert die Buchung rot.", "Zimmerplan öffnen und prüfen, ob ein anderes Zimmer desselben Typs frei ist.", "Sonst den Gast anrufen und im Portal umbuchen oder stornieren (zählt dort als Hotel-Storno)."],
  },
  {
    key: "f_dayclose", title: "Tagesabschluss machen", roles: ["owner", "reception", "accounting"], area: "dayclose",
    goal: "Am Abend: Wie viel Bargeld muss in der Kasse sein, stimmt es, Tag abschliessen.",
    steps: ["Finanzen → Tagesabschluss öffnen.", "Pontivo zeigt die Zahlungen des Tages nach Zahlungsart und die ausgestellten Rechnungen mit MWST.", "Bargeld zählen und den Betrag eintragen; die Differenz zum erwarteten Betrag wird angezeigt.", "Abschliessen. Danach ist der Tag gesperrt: keine Zahlung und keine Rechnung mehr auf diesen Tag."],
    tip: "Ein Fehler nach dem Abschluss wird am nächsten Tag mit einer Gegenbuchung korrigiert, der Abschluss selbst bleibt unverändert.",
  },
  {
    key: "f_clean", title: "Zimmer reinigen und melden", roles: ["owner", "housekeeping", "reception"], area: "housekeeping",
    goal: "Nach der Abreise weiss die Rezeption sofort, welches Zimmer bereit ist.",
    steps: ["Reinigung am Handy öffnen: die Zimmer des Tages, nach Abreise zuerst.", "Ist ein Zimmer gereinigt, auf «sauber» setzen.", "Mangel entdeckt (Lampe defekt, Handtuch fehlt)? «Mangel melden» mit kurzem Text, die Rezeption sieht es."],
  },
  {
    key: "f_order", title: "Am Tisch bestellen und kassieren", roles: ["owner", "service"], area: "kasse",
    goal: "Bestellung aufnehmen, getrennt bezahlen lassen, aufs Zimmer buchen.",
    steps: ["Kasse öffnen, Tisch wählen, Artikel antippen (im Haus oder Take-away).", "Zum Kassieren: Zahlungsart wählen. Bei getrennter Rechnung pro Posten die Menge wählen.", "Hotelgast: «Aufs Zimmer» wählen und den Gast aus der Liste. Der Posten erscheint in der Hotelrechnung."],
    tip: "Die Kasse läuft auch ohne Internet weiter und gleicht danach ab. Bons sind lückenlos nummeriert und unveränderbar.",
  },
  {
    key: "f_export", title: "Buchungsliste für den Treuhänder", roles: ["owner", "accounting"], area: "accountingexport",
    goal: "Rechnungen und Zahlungen eines Monats als Liste für die Buchhaltung.",
    steps: ["Finanzen → Buchhaltung öffnen.", "Konten einmal zuordnen (Erlös, Kurtaxe, MWST, Zahlungsarten).", "Monat wählen und die CSV-Datei herunterladen."],
  },
  {
    key: "f_inbox", title: "Anfragen und Portal-Nachrichten beantworten", roles: FRONT, area: "inbox",
    goal: "Alles, was Gäste schreiben, an einem Ort.",
    steps: ["Heute → Posteingang öffnen. Oben filtern Sie nach Quelle (Website und Chat, Portale).", "Anfrage von der Website: dem Gast per Mail antworten oder «Angebot erstellen».", "Portal-Nachricht: Unterhaltung öffnen, Antwort schreiben; sie geht über den Channel-Manager ans Portal."],
  },
  {
    key: "f_team", title: "Eine neue Person einrichten", roles: ["owner"], area: "team",
    goal: "Mitarbeitende bekommen Zugang mit genau den Seiten, die sie brauchen.",
    steps: ["Zahnrad (Einstellungen) → Team & Rollen öffnen.", "E-Mail eintragen und eine Rolle wählen (z. B. Rezeption, Reinigung).", "Passt keine Standardrolle: unter «Rollen und Seiten» eine eigene Rolle anlegen und Seiten anhaken.", "Die Person meldet sich mit dem Link aus der Mail an und findet unter «Erste Woche» ihre Checkliste."],
  },
];

export const TERMS: Term[] = [
  // Zimmer und Preise
  { group: "Zimmer und Preise", term: "Zimmertyp", meaning: "Eine Gruppe gleichartiger Zimmer, die Gäste nicht einzeln unterscheiden, z. B. «Doppelzimmer Seesicht» mit 4 Zimmern.", inPontivo: "Verkauft wird der Zimmertyp, nicht die Zimmernummer. Die Nummer teilen Sie erst beim Check-in im Zimmerplan zu. Anzahl, Kapazität und Fotos pflegen Sie unter «Zimmer und Tarife».", area: "rooms" },
  { group: "Zimmer und Preise", term: "Tarif (Rateplan)", meaning: "Eine Preis- und Bedingungsvariante eines Zimmertyps: z. B. «Flexibel mit Frühstück» oder «Nicht stornierbar, günstiger».", inPontivo: "Pro Tarif legen Sie Verpflegung, Stornoregel, Preisbasis (für wie viele Personen) und Mindestaufenthalt fest. Ohne Tarif ist ein Zimmertyp nicht buchbar und im Kalender ohne Preiszeile.", area: "rooms" },
  { group: "Zimmer und Preise", term: "Verfügbarkeit", meaning: "Wie viele Zimmer eines Typs an einer Nacht noch frei sind.", inPontivo: "Der Kalender zeigt freie Zimmer pro Nacht (Anzahl minus gebucht, gesperrt und über Portale belegt). Rot heisst ausgebucht. Jede Buchung zieht die Nächte in derselben Transaktion ab, deshalb ist Doppelverkauf ausgeschlossen.", area: "calendar" },
  { group: "Zimmer und Preise", term: "Sperre (Kontingent sperren)", meaning: "Zimmer, die nicht verkauft werden sollen: Renovation, Eigenbedarf, Stammgast-Reserve.", inPontivo: "Kalender → «Zimmer sperren / freigeben». Mit Anzahl 0 geben Sie wieder frei. Die Sperre gilt auch für Portale.", area: "calendar" },
  { group: "Zimmer und Preise", term: "Mindestaufenthalt (Min. Nächte)", meaning: "Wie viele Nächte ein Gast mindestens bleiben muss, z. B. 3 Nächte über Ostern.", inPontivo: "Im Kalender pro Tag («Mindestaufenthalt bei Anreise») und im Tarif als Dauerregel, z. B. für Pakete. Beides gilt zusammen.", area: "calendar" },
  { group: "Zimmer und Preise", term: "Stopp (Stop-Sell)", meaning: "Ein Tag oder Tarif wird nicht mehr verkauft, obwohl Zimmer frei wären.", inPontivo: "Im Kalender «Verkaufsstopp» setzen. Er erscheint als «STOP» in der Zeile und geht an die Portale.", area: "calendar" },
  { group: "Zimmer und Preise", term: "CTA / CTD (keine Anreise / keine Abreise)", meaning: "Closed to Arrival: an diesem Tag darf niemand anreisen. Closed to Departure: niemand abreisen. So füllen Sie Lücken oder erzwingen Wochenpakete.", inPontivo: "Im Kalender pro Tag setzbar. In der Tabelle stehen «CTA» und «CTD» in der Preiszeile.", area: "calendar" },
  { group: "Zimmer und Preise", term: "Preisempfehlung", meaning: "Preisvorschläge nach Regeln wie Auslastung, Last Minute, Wochentag oder Ereignis.", inPontivo: "Sie legen Regeln und einen Mindest- und Höchstpreis fest. Pontivo schlägt vor, Sie bestätigen; auf Wunsch wird innerhalb Ihres Preiskorridors automatisch übernommen.", area: "pricing" },
  { group: "Zimmer und Preise", term: "Pauschale / Verpflegung", meaning: "Übernachtung nur, mit Frühstück, Halb- oder Vollpension.", inPontivo: "Pro Tarif wählbar. Bei Halb- und Vollpension geben Sie den Wert der Verpflegung je Person und Nacht an, damit die Rechnung die Beherbergung zum Sondersatz und die Verpflegung zum Normalsatz ausweist.", area: "rooms" },
  // Buchung und Zahlung
  { group: "Buchung und Zahlung", term: "Reservierung (Hold)", meaning: "Das Zimmer wird kurz für den Gast zurückgehalten, während er bezahlt.", inPontivo: "Beim Online-Buchen hält Pontivo das Zimmer rund eine halbe Stunde. Wird nicht bezahlt, läuft die Reservierung ab und die Nächte werden automatisch wieder frei.", area: "bookings" },
  { group: "Buchung und Zahlung", term: "Buchungsstatus", meaning: "In welchem Zustand sich die Buchung befindet.", inPontivo: "Hold (reserviert, Zahlung läuft) → bestätigt → storniert oder No-Show. Abgelaufen heisst: nicht rechtzeitig bezahlt. Jeder Wechsel wird im Protokoll festgehalten.", area: "bookings" },
  { group: "Buchung und Zahlung", term: "Anzahlung und Restzahlung", meaning: "Der Gast zahlt bei der Buchung einen Teil, den Rest später.", inPontivo: "Sie legen einen Prozentsatz und die Frist fest (Einstellungen → Grunddaten). Bei kurzfristigen Buchungen oder kleinem Rest wird sofort voll bezahlt. Vor dem Fälligkeitstag schickt Pontivo dem Gast einen Zahlungslink, danach Erinnerungen. Wer vor Ort bezahlt, wird in der Buchung als «vor Ort erhalten» markiert.", area: "settings" },
  { group: "Buchung und Zahlung", term: "Stornoregel / Stornogebühr", meaning: "Bis wann ein Gast kostenlos absagen darf und was danach fällig wird.", inPontivo: "Im Tarif: «Kostenlos bis X Tage vor Anreise» und eine Gebühr in Prozent des Zimmerpreises. Pontivo rechnet die Rückerstattung selbst. Die Kurtaxe wird immer erstattet. Der Gast sieht die Regel schon vor der Buchung.", area: "rooms" },
  { group: "Buchung und Zahlung", term: "No-Show", meaning: "Der Gast erscheint nicht und sagt nicht ab.", inPontivo: "In der Buchung ab dem Tag nach der Anreise als «No-Show» markieren. Es gilt die Stornogebühr des Tarifs, die Nächte werden freigegeben.", area: "bookings" },
  { group: "Buchung und Zahlung", term: "Direktbuchung", meaning: "Der Gast bucht bei Ihnen, nicht über Booking.com & Co.", inPontivo: "Auf Ihrer Website oder über den Buchungsknopf. Das Geld geht über Stripe direkt auf Ihr Konto; Pontivo behält nur die Plattformgebühr. Finanzen → Statistik zeigt, wie viel Portal-Provision Sie dadurch sparen.", area: "statistics" },
  { group: "Buchung und Zahlung", term: "Plattformgebühr", meaning: "Was Pontivo pro Direktbuchung berechnet.", inPontivo: "Prozentsatz auf den Zimmerpreis, automatisch bei der Zahlung abgezogen. Die Aufstellung pro Monat mit Export finden Sie unter Einstellungen → Abo & Gebühren (nur Inhaber).", area: "report" },
  { group: "Buchung und Zahlung", term: "Gutschein", meaning: "Ein Betrag, den Gäste kaufen oder verschenken und später einlösen.", inPontivo: "Gäste kaufen online, der Code wird per Mail verschickt. Sie lösen ihn bei einer Buchung ein; der Betrag wird abgezogen.", area: "vouchers" },
  // Gäste und Meldewesen
  { group: "Gäste und Meldewesen", term: "Meldeschein", meaning: "Gesetzliche Anmeldung der Gäste mit Name, Geburtsdatum, Nationalität und Adresse.", inPontivo: "Der Gast füllt ihn vorab online aus (Link 7 Tage vor Anreise); am Empfang bestätigen Sie, dass Sie den Ausweis gesehen haben. Aufbewahrt wird so lange, wie der Kanton es verlangt, danach löscht Pontivo automatisch. Menü: Heute → Check-in.", area: "reports" },
  { group: "Gäste und Meldewesen", term: "Gästeportal", meaning: "Die Buchungsseite, die der Gast über den Link in seiner Mail öffnet, ohne Login.", inPontivo: "Dort meldet der Gast Wünsche (Late Check-out, Handtücher), sieht Tipps, die laufende Rechnung, ab Anreise den Türcode und checkt am Abreisetag selbst aus. Wünsche landen im Posteingang (Reiter «Gästewünsche»). Einstellungen → Gästeportal.", area: "reports" },
  { group: "Gäste und Meldewesen", term: "Kurtaxe", meaning: "Gemeindeabgabe pro Person und Nacht (Kinder oft befreit), die der Gast zusätzlich zahlt.", inPontivo: "Pontivo kennt den Satz Ihrer Gemeinde und rechnet ihn automatisch zum Zimmerpreis. Bestätigen Sie den Satz einmal in den Einstellungen. Die Quartalsliste für die Gemeinde exportieren Sie unter Heute → Check-in.", area: "reports" },
  { group: "Gäste und Meldewesen", term: "Kartei", meaning: "Notizen und Stichwörter zu Gästen, z. B. Stammgast oder Wunsch nach ruhigem Zimmer.", inPontivo: "Sichtbar bei der Buchung und durchsuchbar. Bitte keine Gesundheitsangaben oder andere heikle Daten notieren.", area: "guestbook" },
  { group: "Gäste und Meldewesen", term: "Zustimmung (Newsletter)", meaning: "Mails zu Angeboten dürfen nur an Gäste gehen, die zugestimmt haben.", inPontivo: "Der Gast setzt das Häkchen bei der Buchung. Jede Newsletter-Mail enthält einen Abmeldelink.", area: "marketing" },
  // Rechnung und Kasse
  { group: "Rechnung und Kasse", term: "MWST und Sondersatz", meaning: "Beherbergung wird in der Schweiz zum Sondersatz besteuert, Verpflegung und Getränke zum Normalsatz.", inPontivo: "Pontivo teilt die Rechnung automatisch auf. Die MWST wird je Satz auf der Rechnung ausgewiesen. Ihre Angaben dazu stimmen Sie einmal mit Ihrem Treuhänder ab.", area: "invoices" },
  { group: "Rechnung und Kasse", term: "QR-Rechnung", meaning: "Der Schweizer Einzahlungsschein als QR-Code auf der Rechnung.", inPontivo: "Rechnungen enthalten den QR-Code, wenn Sie IBAN und Adresse hinterlegt haben. Zahlungen aus der Bankdatei (camt.054) ordnet Pontivo den offenen Rechnungen zu.", area: "invoices" },
  { group: "Rechnung und Kasse", term: "Gutschrift", meaning: "Eine Korrekturrechnung mit negativem Betrag. Rechnungen werden nie gelöscht oder überschrieben.", inPontivo: "Zu jeder Rechnung können Sie eine Gutschrift erstellen. So bleibt die Nummernfolge lückenlos und revisionsfähig.", area: "invoices" },
  { group: "Rechnung und Kasse", term: "Tagesabschluss", meaning: "Täglicher Kassenabschluss: erwartetes gegen gezähltes Bargeld, Summen je Zahlungsart.", inPontivo: "Der Abschluss ist unveränderbar. Auf einen abgeschlossenen Tag lassen sich keine Zahlungen oder Rechnungen mehr buchen.", area: "dayclose" },
  { group: "Rechnung und Kasse", term: "Debitoren", meaning: "Offene Forderungen, vor allem Firmenkunden mit Rechnung statt Sofortzahlung.", inPontivo: "Firma einmal anlegen, bei der Buchung «auf Rechnung» wählen; die Frist kommt aus der Firma. Die Liste zeigt offene Posten nach Fälligkeit, mit Erinnerungen und Mahnungen.", area: "debtors" },
  { group: "Rechnung und Kasse", term: "Eigentümerabrechnung", meaning: "Wer Ferienwohnungen für Eigentümer verwaltet, rechnet monatlich Umsatz, Kommission und Kosten ab.", inPontivo: "Wohnungen den Eigentümern zuordnen, Kommission festlegen; Pontivo erstellt die Monatsabrechnung als Druckansicht oder Mail.", area: "owners" },
  // Portale
  { group: "Portale und Schnittstellen", term: "Channel-Manager", meaning: "Ein Dienst, der Preise und freie Zimmer gleichzeitig an Booking.com, Airbnb und Expedia schickt und deren Buchungen zurückholt.", inPontivo: "Pontivo nutzt dafür Channex. Sie verbinden Ihr Portal-Konto einmal unter Einstellungen → Kanäle → Channel-Manager. Danach ist der Kalender die einzige Stelle, an der Sie Preise pflegen.", area: "channex" },
  { group: "Portale und Schnittstellen", term: "Kalender-Abgleich (iCal)", meaning: "Der einfache Abgleich mit Portalen ohne Channel-Manager: Belegungen werden als Kalender-Link ausgetauscht.", inPontivo: "Einstellungen → Kanäle → Kalender-Abgleich: Link der Portale eintragen und Pontivos Link dort hinterlegen. Nur Belegung, keine Preise, und der Abgleich ist nicht sofort.", area: "ical" },
  { group: "Portale und Schnittstellen", term: "Überbuchung", meaning: "Zwei Buchungen für dasselbe Zimmer, weil ein Portal verkauft hat, bevor es den neuen Stand kannte.", inPontivo: "Pontivo speichert die Portal-Buchung trotzdem (das Portal hat sie schon verkauft), markiert sie rot und meldet per Mail. Sie lösen es mit Umteilen oder Umbuchen.", area: "bookings" },
  { group: "Portale und Schnittstellen", term: "Stripe", meaning: "Der Zahlungsdienst für Kreditkarte und TWINT.", inPontivo: "Sie verbinden Ihr eigenes Stripe-Konto in den Einstellungen. Gästezahlungen gehen direkt dorthin. Pontivo speichert keine Kartendaten.", area: "settings" },
  { group: "Portale und Schnittstellen", term: "Modul", meaning: "Eine Funktion, die Sie ein- oder ausschalten können, z. B. Housekeeping oder Restaurant.", inPontivo: "Einstellungen → Funktionen. Ausgeschaltete Module verschwinden aus dem Menü, die Daten bleiben erhalten. Ein Betrieb ohne Personal braucht oft nur wenige.", area: "funktionen" },
  // Kennzahlen
  { group: "Kennzahlen", term: "Belegung", meaning: "Anteil der verkauften Zimmernächte an allen verfügbaren Zimmernächten.", inPontivo: "Statistik nach Monat und Zimmertyp.", area: "statistics" },
  { group: "Kennzahlen", term: "ADR (Durchschnittspreis)", meaning: "Durchschnittlicher Zimmerpreis pro verkaufter Nacht.", inPontivo: "Statistik, pro Monat und Zimmertyp.", area: "statistics" },
  { group: "Kennzahlen", term: "RevPAR", meaning: "Umsatz pro verfügbarem Zimmer (Belegung × ADR). Zeigt, wie gut Sie Ihre Zimmer insgesamt auslasten und verkaufen.", inPontivo: "Statistik. Der wichtigste Vergleichswert zwischen Monaten und Häusern.", area: "statistics" },
  { group: "Kennzahlen", term: "HESTA", meaning: "Die monatliche Beherbergungsstatistik des Bundesamts für Statistik.", inPontivo: "Statistik → HESTA fasst die Monatszahlen zusammen, die Sie melden müssen.", area: "hesta" },
  { group: "Zimmer und Preise", term: "Zimmerplan", meaning: "Eine Übersicht, welches Zimmer (mit Nummer) an welchem Tag von welchem Gast belegt ist.", inPontivo: "Kalender → Zimmerplan: Sie legen die Zimmer an, teilen jeder Buchung ein Zimmer desselben Typs zu (von Hand oder automatisch) und quartieren Gäste bei Bedarf um. Preis und Verfügbarkeit ändern sich dabei nicht. Optional: Ohne Zimmernummern läuft alles wie bisher.", area: "plan" },
  { group: "Zimmer und Preise", term: "Schulferien (Ferienvorschläge)", meaning: "Die kantonalen Schulferien, in denen die Nachfrage oft höher ist als sonst.", inPontivo: "Pontivo spielt die Ferien der Kantone zentral ein (Angaben ohne Gewähr) und zeigt die Ferien Ihres Kantons in der Preisempfehlung als Vorschlag. Ob und wie Sie die Preise anpassen, entscheiden Sie.", area: "pricing" },
  { group: "Buchung und Zahlung", term: "Firmencode", meaning: "Ein Code, mit dem Gäste einer Firma einen Rabatt bekommen, optional «auf Rechnung».", inPontivo: "Website und Buchung → Direktbuchung: Sie legen den Code für eine Firma an (Rabatt bis 50 % auf den Zimmerpreis, optional befristet). Bei «auf Rechnung» ist die Buchung sofort bestätigt und die Firma erhält später die Rechnung (Debitoren). Ein falscher Code zeigt immer einen Fehler.", area: "direct" },
  { group: "Buchung und Zahlung", term: "Lückenfüller", meaning: "Ein Rabatt für kurze Aufenthalte, die eine Lücke von 1 bis 3 freien Nächten zwischen zwei Buchungen genau füllen.", inPontivo: "Website und Buchung → Direktbuchung: Solche Aufenthalte dürfen den Mindestaufenthalt unterschreiten und bekommen auf Wunsch bis 30 % Rabatt. Das gilt nur für Direktbuchungen, die Preise auf den Portalen ändern sich nicht. Pro Buchung gilt immer nur ein Rabatt.", area: "direct" },
  { group: "Buchung und Zahlung", term: "Warteliste", meaning: "Eine Liste von Gästen, die sich melden wollen, sobald für ihre Daten wieder etwas frei wird.", inPontivo: "Ist ein Zeitraum ausgebucht, kann der Gast seine E-Mail und die Wunschdaten hinterlassen. Wird etwas frei, schickt Pontivo einmal eine Mail mit Link in die Suche. Der Gast kann sich per Link abmelden. Einstellung unter Website und Buchung → Direktbuchung.", area: "direct" },
  { group: "Buchung und Zahlung", term: "Abbruch-Mail", meaning: "Eine einmalige Erinnerung an Gäste, die eine Buchung begonnen, aber nicht bezahlt haben.", inPontivo: "Standardmässig aus. Wenn Sie sie einschalten (Direktbuchung), erhält der Gast einmal eine Mail, sofern die Daten noch frei sind und er inzwischen nicht gebucht hat. Prüfen Sie vorher mit der Datenschutzerklärung, ob das für Sie passt.", area: "direct" },
  { group: "Buchung und Zahlung", term: "Upselling", meaning: "Zusatzangebote, die Gäste vor der Anreise per Mail bekommen, z. B. Frühstück, Spa oder Late Check-out.", inPontivo: "Modul «Upselling»: Gäste, die Angebote erhalten möchten, bekommen vor der Anreise eine Mail mit Ihren Angeboten und bezahlen direkt an Sie über Stripe. Pontivo behält dafür eine Provision (siehe Bedingungen für Gastgeber).", area: "upsell" },
  { group: "Buchung und Zahlung", term: "Eingebettete Zahlung", meaning: "Das Zahlungsfenster von Stripe erscheint direkt auf Ihrer Seite, statt dass der Gast auf eine andere Seite weitergeleitet wird.", inPontivo: "Einstellungen → Grunddaten → Zahlungen (nur Inhaber). Die Karteneingabe liegt trotzdem immer bei Stripe, Pontivo und Ihre Website sehen keine Kartendaten. Ist sie ausgeschaltet oder nicht möglich, wird der Gast wie bisher weitergeleitet.", area: "settings" },
  { group: "Buchung und Zahlung", term: "Gruppenbuchung (Block)", meaning: "Mehrere Zimmer, die Sie für eine Gruppe reservieren, bevor die einzelnen Teilnehmer feststehen.", inPontivo: "Modul «Gruppen»: Sie blocken Zimmer je Typ und Nacht, ordnen später die Teilnehmer zu (Rooming-Liste) und legen eine Freigabefrist fest. Nicht vergebene Blockzimmer gehen danach automatisch zurück in den Verkauf.", area: "groups" },
  { group: "Buchung und Zahlung", term: "Angebote vor Ort", meaning: "Buchbare Einrichtungen mit Zeitfenstern, z. B. Sauna, Wellness, Seminarraum oder Tennisplatz.", inPontivo: "Modul «Angebote vor Ort»: Sie legen Plätze, Dauer und Preis je Zeitfenster fest und buchen Gäste darauf. Der Betrag kommt auf die Rechnung der Buchung.", area: "resources" },
  { group: "Gäste und Meldewesen", term: "Online-Check-in", meaning: "Der Gast erledigt vor der Anreise die Anmeldung online, damit es am Empfang schnell geht.", inPontivo: "Modul «Online-Check-in»: 7 Tage vor Anreise erhält der Gast einen Link zum Meldeschein. Sensible Angaben werden verschlüsselt gespeichert. Am Empfang prüfen Sie den Ausweis und bestätigen das. Menü: Heute → Check-in.", area: "reports" },
  { group: "Gäste und Meldewesen", term: "Zutritt (Türcode)", meaning: "Ein digitaler Code für die Tür, der nur für die Dauer des Aufenthalts gilt.", inPontivo: "Modul «Zutritt» mit Nuki-Schlössern: Sie verbinden Ihre Schlösser und ordnen sie der Eingangstür oder einem Zimmer zu. Auf der Buchung erstellen oder ziehen Sie den Code zurück. Codes stehen nie in Gäste-Mails.", area: "access" },
  { group: "Rechnung und Kasse", term: "Kartenterminal", meaning: "Ein Kartenlesegerät, mit dem Gäste vor Ort zahlen, z. B. beim Check-out.", inPontivo: "Modul «Kartenterminal» (Stripe): Sie registrieren das Gerät und lösen die Zahlung aus der Buchung heraus aus. Sie wird als Zahlung vor Ort auf der Rechnung verbucht.", area: "terminal" },
  { group: "Portale und Schnittstellen", term: "Schnittstelle (API)", meaning: "Eine technische Verbindung, über die andere Programme oder Websites mit Pontivo sprechen.", inPontivo: "Website und Buchung → Schnittstelle: Eine Agentur oder Ihr Website-Partner bindet die Buchung in die eigene Website ein. Pontivo liefert dabei nur Verfügbarkeit, Preise und die Buchung samt Zahlung.", area: "api" },
];

/** Rollen, für die ein Ablauf gezeigt wird (Inhaber sehen alles) */
export const flowsFor = (role: GuideRole): Flow[] => (role === "owner" ? FLOWS : FLOWS.filter((f) => f.roles.includes(role)));
export const TERM_GROUPS = [...new Set(TERMS.map((t) => t.group))];
