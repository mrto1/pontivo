import type { GuideRole } from "./guide";

/**
 * Schulungsunterlagen unter «Hilfe»: Wegweiser durch das Menü, Abläufe Schritt für Schritt und Fachbegriffe
 * (was etwas bedeutet und wie Pontivo es löst). Reine Daten. `area` = Schlüssel eines Menüpunkts (src/admin/nav.ts);
 * die Seite verlinkt nur, was im Menü des Betriebs sichtbar ist (tests/unit/help-content.test.ts prüft die Schlüssel).
 */
/** lodging: Betriebe mit Zimmern; dining: mit Gastronomie; both: nur wenn beides (z. B. Halbpension); all: immer */
export type Scope = "lodging" | "dining" | "both" | "all";
/** `scope`: gilt für die Unterkunft, die Gastronomie oder alle; `section`: Gruppe im Wegweiser bzw. bei den Abläufen */
export type Wayfinding = { area: string; title: string; what: string; /** Text für Betriebe ohne Zimmer */ whatRestaurant?: string; notThis?: string; scope: Scope };
export type FlowSection = "Rezeption" | "Reinigung" | "Restaurant: Reservation" | "Restaurant: Service und Kasse" | "Restaurant: Online und Lieferung" | "Anfragen und Nachrichten" | "Finanzen" | "Verwaltung";
export const FLOW_SECTIONS: FlowSection[] = ["Rezeption", "Reinigung", "Restaurant: Reservation", "Restaurant: Service und Kasse", "Restaurant: Online und Lieferung", "Anfragen und Nachrichten", "Finanzen", "Verwaltung"];
/** Bereich eines Abschnitts (für «Ihre wichtigsten Abläufe»: bei Hotel mit Restaurant aus beiden Bereichen) */
export const SECTION_SCOPE: Record<FlowSection, Scope> = { Rezeption: "lodging", Reinigung: "lodging", "Restaurant: Reservation": "dining", "Restaurant: Service und Kasse": "dining", "Restaurant: Online und Lieferung": "dining", "Anfragen und Nachrichten": "all", Finanzen: "all", Verwaltung: "all" };
export type Flow = { key: string; title: string; roles: GuideRole[]; section: FlowSection; /** Standard: Bereich des Abschnitts */ scope?: Scope; goal: string; steps: string[]; area: string; tip?: string };
export type Term = { term: string; meaning: string; inPontivo: string; area?: string; scope?: Scope; group: "Zimmer und Preise" | "Buchung und Zahlung" | "Gäste und Meldewesen" | "Restaurant" | "Rechnung und Kasse" | "Portale und Schnittstellen" | "Kennzahlen" };

const FRONT: GuideRole[] = ["owner", "reception"];
const SERVICE: GuideRole[] = ["owner", "service"];

/** Wegweiser in der Reihenfolge des Menüs: zuerst Unterkunft, dann Gastronomie, dann was für alle gilt */
export const WAYFINDING: Wayfinding[] = [
  // Unterkunft
  { scope: "lodging", area: "home", title: "Heute", what: "Der Tag auf einen Blick. Reiter «Tagesliste»: Anreisen, Abreisen und Gäste im Haus, mit Pfeilen auch für andere Tage; für heute Hinweise mit Direktlink und offene Zahlungen. Mit dem Online-Check-in steht bei jeder Anreise der Stand des Meldescheins («Ausweis gesehen»). Weitere Reiter: Posteingang (Anfragen und Portal-Nachrichten) und Reinigung.", notThis: "Kennzahlen mit Zeitraum (Belegung, gesparte Provision) stehen unter Finanzen → Statistik." },
  { scope: "lodging", area: "plan", title: "Kalender → Zimmerplan", what: "Welches Zimmer ist an welchem Tag mit welchem Gast belegt. Buchung antippen: Zimmer zuteilen, Zuweisung aufheben oder Zimmerwechsel während des Aufenthalts. «Automatisch zuweisen» verteilt offene Buchungen." },
  { scope: "lodging", area: "calendar", title: "Kalender → Preise & Verfügbarkeit", what: "Das Zeitraster je Zimmertyp: freie Zimmer, Preis pro Nacht und Regeln (Mindestaufenthalt, Stopp). Hier ändern Sie Preise und sperren Zimmer; die Preisempfehlung ist ein eigener Reiter.", notThis: "Einzelne Gäste und Zahlungen sind Vorgänge unter «Buchungen». Booking.com & Co. verbinden Sie unter Einstellungen → Kanäle." },
  { scope: "lodging", area: "bookings", title: "Buchungen", what: "Alle Vorgänge: Gast, Zeitraum, Zahlung, Storno, Rechnung. «+ Buchung erfassen» für Telefon und Walk-in. Weitere Reiter: Gruppen, Angebote vor Ort, Gutscheine und Gäste (Kartei, Newsletter, Bewertungen).", notThis: "Preise und Verfügbarkeit ändern Sie im Kalender, Rechnungen stehen unter Finanzen." },
  { scope: "lodging", area: "invoices", title: "Finanzen", what: "Rechnungen, Tagesabschluss (Kasse am Empfang), Debitoren, Eigentümerabrechnung, Statistik (mit gesparter Portal-Provision), Berichte (Kurtaxe-Liste, Gästeregister, HESTA) und Buchhaltung.", notThis: "Plattformgebühren und Abo stehen unter Einstellungen → Pontivo-Abrechnung (nur Inhaber)." },
  { scope: "lodging", area: "housekeeping", title: "Heute → Reinigung", what: "Die Zimmer des Tages mit Status schmutzig, sauber und geprüft, nach Abreise zuerst; am Handy gut bedienbar. Mängel melden, Minibar auffüllen und buchen." },
  // Gastronomie
  { scope: "dining", area: "dininghome", title: "Gastronomie → Heute", what: "Die Tagesübersicht: Reservationen von heute (mit Vorbestellungen und Halbpension), wer noch erwartet wird, wer am Tisch sitzt, offene Tische, dazu die Checkliste «Bereit für den Betrieb». Betriebe mit Zimmern wechseln oben mit dem Umschalter «Hotel | Restaurant» hierher." },
  { scope: "dining", area: "reservations", title: "Reservationen → Liste", what: "Alle Reservationen eines Tages: Tisch zuweisen (auch zwei Tische zusammen), Status «am Tisch», «nicht erschienen», «stornieren», neue Reservation erfassen. Link «Kartei» je Gast für Tags und Notizen." },
  { scope: "dining", area: "resplan", title: "Reservationen → Tischplan", what: "Der Plan je Raum (z. B. Hauptsaal, Terrasse) mit Zeitregler: frei, bald reserviert, besetzt; Stühle und Kellner-Farben. Tisch antippen zeigt Reservation und offene Bestellungen; mit der Kasse eröffnen Sie hier auch die Bestellung." },
  { scope: "dining", area: "onlineorders", title: "Bestellungen → Online", what: "Der Bestellbildschirm für Abholung und Lieferung: neue Bestellungen läuten, annehmen, bereit melden. Auf einem Tablet im Restaurant offen lassen." },
  { scope: "dining", area: "kasse", title: "Bestellungen → Kasse", what: "Die Kasse am Tablet: Gerät wählen, Tisch eröffnen, Artikel antippen, kassieren (bar, Karte, TWINT, aufs Zimmer). Läuft auch ohne Internet und gleicht danach ab." },
  { scope: "dining", area: "kitchen", title: "Bestellungen → Küche", what: "Der Küchenbildschirm: alle offenen Posten mit Optionen (z. B. Garstufe) und Sonderwünschen, getrennt nach Küche und Bar. Antippen meldet fertig." },
  { scope: "dining", area: "driver", title: "Bestellungen → Lieferungen", what: "Die Ansicht für Fahrer am Handy: Adresse, Telefon, Betrag, «Unterwegs» und «Geliefert»." },
  { scope: "dining", area: "posclose", title: "Gastronomie → Finanzen", what: "Kassenabschluss (Z-Bericht je Tag), Online-Verkäufe, Auswertung (Umsatz, Trinkgeld und Verweildauer je Kellner und Tisch, Bewertungen), Rechnungen, Gutscheine und Buchhaltung." },
  // Für alle
  { scope: "all", area: "settings", title: "Einstellungen (Zahnrad oben rechts)", what: "Nur für Inhaber und Manager, in Gruppen. Betrieb: Betriebsdaten, Funktionen (ein- und ausschalten), Team & Rollen, Geräte, Zahlungsmethoden, Pontivo-Abrechnung, Datenübernahme. Unterkunft: Zimmer & Tarife, Zusatzleistungen, Angebote vor Ort, Gästeportal, Upselling, KI-Chat. Verkauf: Website & Buchung, Kanäle, Shop & Lager, Gäste-Mails. Gastronomie: Speisekarte, Tischplan, Tisch-QR, Reservation, Bestellung, Kasse.", whatRestaurant: "Nur für Inhaber und Manager, in Gruppen. Betrieb: Betriebsdaten (mit Öffnungszeiten), Funktionen, Team & Rollen, Zahlungsmethoden, Pontivo-Abrechnung. Verkauf: Website, Shop & Lager. Gastronomie: Speisekarte, Tischplan, Tisch-QR, Reservation, Bestellung, Kasse." },
  { scope: "lodging", area: "rooms", title: "Einstellungen → Zimmer & Tarife", what: "Zimmertypen, Anzahl Zimmer, Fotos und Tarife (z. B. mit Frühstück, Halbpension, nicht stornierbar). Ein Zimmertyp ohne Tarif ist nicht buchbar." },
  { scope: "dining", area: "positems", title: "Einstellungen → Speisekarte", what: "Artikel mit Preisen und MWST, Optionen und Menüs (z. B. Garstufe als Pflichtwahl), Online-Angaben mit Beschreibung, Foto und Allergenen, Import per CSV oder KI." },
  { scope: "dining", area: "tables", title: "Einstellungen → Tischplan", what: "Räume und Tische anlegen, Plätze und Form festlegen, im Plan platzieren, Elemente wie Bar oder WC einzeichnen, Kellner anlegen und Tischen zuweisen, festlegen, welche Tische online buchbar sind." },
  { scope: "dining", area: "tableqr", title: "Einstellungen → Tisch-QR", what: "QR-Code je Tisch zum Ausdrucken. Gäste bezahlen am Tisch mit TWINT oder Karte (mit Trinkgeld an den Kellner) und bewerten den Besuch; auf Wunsch bestellen sie auch direkt in die Küche." },
  { scope: "dining", area: "ressettings", title: "Einstellungen → Reservation", what: "Zeiten und Plätze für die Online-Reservation, Küchentakt, Tische zuteilen und zusammenlegen, Vorbestellung mit Küchenvorlauf, Anzahlung, Storno, Erinnerung und Halbpension für Hotelgäste." },
  { scope: "all", area: "site", title: "Einstellungen → Website & Buchung", what: "Wie Gäste Sie finden: eigene Pontivo-Website oder nur der Buchungsknopf auf Ihrer bisherigen Seite. Seiten, Layout, Schrift, Logo, Sprachen; dazu Direktbuchung (Vorteile, Firmencodes, Lückenfüller)." },
  { scope: "all", area: "team", title: "Einstellungen → Team & Rollen", what: "Wer Zugang hat und was jede Rolle sehen darf. Standardrollen anpassen oder eigene Rollen mit Häkchen pro Seite anlegen." },
  { scope: "all", area: "konto", title: "Profilbild oben rechts: Mein Konto", what: "Ihr Zugang: E-Mail, Passkey, Authenticator, Mitteilungen auf dem Handy, App installieren und, wenn Sie in mehreren Betrieben arbeiten, «Ihre Betriebe» zum Wechseln. Reiter: Erste Woche und diese Hilfe." },
];

export const FLOWS: Flow[] = [
  // Rezeption
  {
    key: "f_phone", section: "Rezeption", title: "Eine Buchung am Telefon erfassen", roles: FRONT, area: "bookings",
    goal: "Der Gast ruft an. Das Zimmer ist danach reserviert und der Kalender sofort aktuell.",
    steps: ["Buchungen öffnen und «+ Buchung erfassen» wählen. Rechts öffnet sich eine Seitenleiste.", "Zimmer und Tarif, Anreise, Abreise und Personen eintragen. Weitere Zimmer (Familie) unter «Weiteres Zimmer hinzufügen».", "Name, E-Mail und Telefon des Gastes eintragen.", "«Buchung erfassen». Ist für die Daten nichts mehr frei, meldet Pontivo es; sonst geht die Bestätigung per Mail an den Gast."],
    tip: "Der Preis kommt aus dem Kalender, die Kurtaxe wird dazugerechnet.",
  },
  {
    key: "f_checkin", section: "Rezeption", title: "Einen Gast einchecken", roles: FRONT, area: "home",
    goal: "Der Gast kommt an: Zimmer zuteilen, Meldeschein und Zahlung erledigen.",
    steps: ["Heute → «Tagesliste»: dort stehen die Anreisen.", "Zimmer zuteilen: Kalender → Zimmerplan, Buchung antippen und Zimmer wählen (oder vorher «Automatisch zuweisen»).", "Meldeschein: Der Gast hat das Formular online ausgefüllt (Link 7 Tage vor Anreise). Ausweis ansehen und in der Tagesliste «Ausweis gesehen» wählen.", "Offene Restzahlung: Buchung öffnen → «Restbetrag vor Ort erhalten» oder «Zahlung verbuchen»."],
    tip: "Zimmer wechseln Sie später im Zimmerplan (Buchung antippen → Zimmerwechsel), der Preis bleibt.",
  },
  {
    key: "f_cancel", section: "Rezeption", title: "Eine Buchung stornieren oder als No-Show markieren", roles: FRONT, area: "bookings",
    goal: "Gast oder Hotel storniert; Pontivo rechnet die Gebühr nach dem Tarif und erstattet über Stripe.",
    steps: ["Buchung öffnen.", "Pontivo zeigt, was nach der Regel des Tarifs erstattet wird: kostenlos bis zur Frist, danach die Gebühr in Prozent des Zimmerpreises.", "«Verbindlich stornieren». Die Nächte sind sofort wieder frei, der Gast bekommt eine Mail.", "Kam der Gast nicht: ab dem Tag nach der Anreise «Als No-Show markieren»."],
    tip: "Storniert das Hotel, wird immer voll erstattet. Buchungen von Booking.com & Co. stornieren Sie im Portal.",
  },
  {
    key: "f_overbooking", section: "Rezeption", title: "Überbuchung lösen", roles: FRONT, area: "bookings",
    goal: "Ein Portal hat ein Zimmer verkauft, das schon belegt war.",
    steps: ["Pontivo meldet die Überbuchung per Mail und markiert die Buchung.", "Zimmerplan öffnen und prüfen, ob ein anderes Zimmer desselben Typs frei ist.", "Sonst den Gast anrufen und im Portal umbuchen oder stornieren (zählt dort als Hotel-Storno)."],
  },
  {
    key: "f_inbox", section: "Anfragen und Nachrichten", title: "Anfragen und Nachrichten beantworten", roles: FRONT, area: "inbox",
    goal: "Alles, was Gäste schreiben, an einem Ort.",
    steps: ["Heute → Posteingang öffnen. Oben filtern Sie nach Quelle (Website und Chat, Portale, Gästewünsche).", "Anfrage von der Website: dem Gast antworten oder «Angebot erstellen».", "Portal-Nachricht: Unterhaltung öffnen und antworten; sie geht über den Channel-Manager ans Portal. Erledigtes «Abschliessen»."],
  },
  // Reinigung
  {
    key: "f_clean", section: "Reinigung", title: "Zimmer reinigen und melden", roles: ["owner", "housekeeping", "reception"], area: "housekeeping",
    goal: "Nach der Abreise weiss die Rezeption sofort, welches Zimmer bereit ist.",
    steps: ["Heute → Reinigung am Handy öffnen: die Zimmer des Tages, nach Abreise zuerst.", "Ist ein Zimmer gereinigt, auf «sauber» setzen; die Rezeption kann es danach auf «geprüft» setzen.", "Mangel entdeckt (Lampe defekt, Handtuch fehlt)? «Mangel melden» mit kurzem Text; erledigte Mängel stehen darunter."],
  },
  // Restaurant: Reservation
  {
    key: "f_reserve", section: "Restaurant: Reservation", title: "Eine Reservation am Telefon erfassen", roles: SERVICE, area: "reservations",
    goal: "Reservation erfassen und dem Gast einen Tisch geben.",
    steps: ["Gastronomie → Reservationen → Liste. Mit dem Umschalter oben wechseln Betriebe mit Zimmern in die Gastronomie.", "Unter «Neue Reservation» Zeit, Personen und Name eintragen; mit E-Mail bekommt der Gast eine Bestätigung.", "Tisch wählen, bei Gruppen mit «+ Tisch» einen zweiten dazu, oder «Offene automatisch einem Tisch zuteilen»."],
    tip: "Online-Reservationen kommen von selbst dazu. Ist ein Zeitraum voll, tragen sich Gäste auf die Warteliste ein.",
  },
  {
    key: "f_tableplan", section: "Restaurant: Reservation", title: "Den Tischplan im Service lesen", roles: SERVICE, area: "resplan",
    goal: "Auf einen Blick sehen, welcher Tisch frei ist, wann der nächste Gast kommt und wer welchen Tisch bedient.",
    steps: ["Reservationen → Tischplan; oben den Raum wählen (z. B. Hauptsaal, Terrasse).", "Farben: grün frei, orange bald reserviert, rot besetzt oder offene Bestellung. Mit dem Zeitregler sehen Sie die Belegung zu einer anderen Uhrzeit.", "Tisch antippen: Reservation, nächste Reservation und offene Bestellungen; mit der Kasse «Bestellung eröffnen».", "Kellner-Filter zeigt nur die Tische einer Person."],
    tip: "Kommt ein Gast an, setzen Sie die Reservation in der Liste auf «am Tisch». Hat er vorbestellt, geht die Vorbestellung dann in die Küche.",
  },
  {
    key: "f_preorder", section: "Restaurant: Reservation", title: "Mit Vorbestellung arbeiten (auch Gruppen)", roles: SERVICE, area: "reservations",
    goal: "Gäste wählen die Gerichte schon bei der Online-Reservation und bezahlen vorab.",
    steps: ["Einmal einrichten: Einstellungen → Reservation → Vorbestellung zulassen, auf Wunsch «Pflicht ab Personen» und Küchenvorlauf.", "In der Liste steht bei der Reservation die Vorbestellung mit Betrag. Fehlt der Tisch, warnt die Liste: ohne Tisch geht nichts in die Küche.", "Mit Küchenvorlauf erscheint die Vorbestellung so viele Minuten vor Ankunft in der Küche, sonst wenn der Gast «am Tisch» ist. Der Betrag ist bereits als Bon verbucht."],
    tip: "Storniert der Gast rechtzeitig, wird der Betrag zurückerstattet; bei «nicht erschienen» bleibt er.",
  },
  {
    key: "f_halfboard", section: "Restaurant: Reservation", scope: "both", title: "Halbpension: Hotelgäste am Tisch", roles: SERVICE, area: "reservations",
    goal: "Gäste mit Halb- oder Vollpension haben jeden Abend automatisch einen Tisch.",
    steps: ["Einmal einrichten: Tarif mit Halbpension (Einstellungen → Zimmer & Tarife) und Einstellungen → Reservation → «Halbpension mit Tisch» mit der Uhrzeit.", "Pontivo legt für jede Nacht eine Reservation mit Tisch an, Notiz «Halbpension · Zimmer …».", "Zeit oder Tisch ändern Sie in der Liste; storniert der Gast das Zimmer, verschwindet auch die Reservation."],
  },
  // Restaurant: Service und Kasse
  {
    key: "f_order", section: "Restaurant: Service und Kasse", title: "Am Tisch bestellen und kassieren", roles: SERVICE, area: "kasse",
    goal: "Bestellung aufnehmen, in die Küche schicken, getrennt bezahlen lassen oder aufs Zimmer buchen.",
    steps: ["Im Tischplan den Tisch antippen und «Bestellung eröffnen» (oder am Tablet: Kasse → Tisch).", "Artikel antippen; bei Pflicht-Optionen (z. B. Garstufe) wählen, Sonderwunsch dazu. Die Küche sieht die Posten sofort.", "Zum Kassieren: «Kassieren», Zahlungsart wählen; bei getrennter Rechnung je Posten die Menge.", "Hotelgast: «Aufs Zimmer» und den Gast wählen. Der Posten erscheint in der Hotelrechnung."],
    tip: "Die Kasse am Tablet läuft auch ohne Internet weiter. Bons sind lückenlos nummeriert und unveränderbar.",
  },
  {
    key: "f_qr", section: "Restaurant: Service und Kasse", title: "Gäste bestellen und bezahlen per QR-Code", roles: SERVICE, area: "tableqr",
    goal: "Der Gast scannt den Code am Tisch, bestellt selbst und bezahlt mit TWINT oder Karte, mit Trinkgeld.",
    steps: ["Einmal einrichten: Einstellungen → Tisch-QR, Codes ausdrucken und auf die Tische stellen. «Bestellen am Tisch» bei Bedarf einschalten.", "Bestellt der Gast, erscheint die Bestellung am Tisch und in der Küche wie eine eigene.", "Bezahlt der Gast, entsteht der Bon automatisch; das Trinkgeld gehört zum Kellner des Tisches.", "Nach dem Bezahlen bewertet der Gast. Ab 4 Sternen bietet Pontivo den Link zu Google an, Kritik bleibt intern."],
  },
  {
    key: "f_kitchen", section: "Restaurant: Service und Kasse", title: "Mit dem Küchenbildschirm arbeiten", roles: SERVICE, area: "kitchen",
    goal: "Die Küche sieht jede Bestellung mit Optionen und meldet fertig.",
    steps: ["Bestellungen → Küche auf einem Bildschirm in der Küche öffnen, Station wählen (Küche oder Bar) und «Ton einschalten».", "Neue Posten erscheinen oben mit Tisch, Garstufe und Sonderwunsch.", "Fertigen Posten antippen. Der Service sieht, was bereit ist."],
  },
  {
    key: "f_posclose", section: "Restaurant: Service und Kasse", title: "Kassenabschluss machen", roles: ["owner", "service", "accounting"], area: "posclose",
    goal: "Am Abend: Z-Bericht prüfen, Bargeld zählen, Tag abschliessen.",
    steps: ["Gastronomie → Finanzen → Kassenabschluss.", "Pontivo zeigt die Bons des Tages nach Zahlart mit Trinkgeld und MWST.", "Bargeld zählen, eintragen und «Tag abschliessen»."],
    tip: "Korrekturen sind Gegenbons; der Abschluss bleibt unverändert.",
  },
  // Restaurant: Online und Lieferung
  {
    key: "f_online_order", section: "Restaurant: Online und Lieferung", title: "Online-Bestellungen annehmen", roles: SERVICE, area: "onlineorders",
    goal: "Bestellungen zum Abholen oder Liefern sicher empfangen und rechtzeitig bestätigen.",
    steps: ["Bestellungen → Online auf dem Tablet im Restaurant öffnen (am Ladekabel), «Prüfung starten» und den Ton bestätigen.", "Neue Bestellung läutet: «Annehmen» (oder +10/+20/+30 Min.) oder «Ablehnen» mit Grund; bezahlte Beträge gehen dann automatisch zurück.", "Ist das Essen fertig: «Bereit». Bei Abholung danach «Abgeholt»; Lieferungen übernimmt der Fahrer."],
    tip: "Nach 5 Minuten ohne Antwort kommt ein Alarm per SMS und Mail, nach 10 Minuten wird storniert. Ist kein Bestellbildschirm erreichbar, pausiert Pontivo die Online-Bestellung von selbst.",
  },
  {
    key: "f_deliver", section: "Restaurant: Online und Lieferung", title: "Eine Lieferung ausfahren", roles: ["owner", "driver", "service"], area: "driver",
    goal: "Bestellung zum Gast bringen und bei Barzahlung richtig abrechnen.",
    steps: ["Lieferungen am Handy öffnen; Adresse, Telefon und Betrag stehen auf der Karte.", "Beim Losfahren «Unterwegs» tippen, der Gast bekommt Bescheid; die Navigation öffnet sich über den Link.", "Beim Gast «Geliefert» (bar: Betrag kassieren). Niemand da oder Annahme verweigert: «Nicht angenommen»."],
  },
  // Finanzen
  {
    key: "f_pay", section: "Finanzen", scope: "lodging", title: "Zahlung vor Ort verbuchen und Rechnung stellen", roles: ["owner", "reception", "accounting"], area: "invoices",
    goal: "Bar, Karte oder TWINT am Empfang so erfassen, dass Rechnung und Tagesabschluss stimmen.",
    steps: ["Buchung öffnen; im Abschnitt Kasse «Zahlung verbuchen» mit Betrag und Zahlungsart.", "«Rechnung erstellen / Entwurf öffnen», prüfen und ausstellen; drucken oder per Mail senden.", "Firmenkunden: Rechnung an die Firma (Debitoren), mit deren Zahlungsfrist."],
    tip: "Fehler korrigieren Sie nie durch Löschen, sondern mit einer Gutschrift. So bleibt alles nachvollziehbar.",
  },
  {
    key: "f_dayclose", section: "Finanzen", scope: "lodging", title: "Tagesabschluss am Empfang", roles: ["owner", "reception", "accounting"], area: "dayclose",
    goal: "Am Abend: Wie viel Bargeld muss in der Kasse sein, stimmt es, Tag abschliessen.",
    steps: ["Finanzen → Tagesabschluss öffnen.", "Pontivo zeigt die Zahlungen des Tages nach Zahlungsart und die ausgestellten Rechnungen mit MWST.", "Bargeld zählen und eintragen; die Differenz wird angezeigt.", "«Tag abschliessen». Danach ist der Tag gesperrt: keine Zahlung und keine Rechnung mehr auf diesen Tag."],
    tip: "Ein Fehler nach dem Abschluss wird am nächsten Tag mit einer Gegenbuchung korrigiert.",
  },
  {
    key: "f_export", section: "Finanzen", title: "Buchungsliste für den Treuhänder", roles: ["owner", "accounting"], area: "accountingexport",
    goal: "Rechnungen und Zahlungen eines Monats als Liste für die Buchhaltung.",
    steps: ["Finanzen → Buchhaltung öffnen.", "Konten einmal zuordnen (Erlös, Kurtaxe, MWST, Zahlungsarten).", "Zeitraum wählen und die CSV-Datei herunterladen."],
  },
  // Verwaltung
  {
    key: "f_price", section: "Verwaltung", scope: "lodging", title: "Preise ändern oder Zimmer sperren", roles: ["owner"], area: "calendar",
    goal: "Wochenende teurer, Zimmer für Renovation blockiert, Mindestaufenthalt in der Hochsaison.",
    steps: ["Kalender → Preise & Verfügbarkeit öffnen.", "Unter «Preise und Regeln setzen» Tarif, Zeitraum und Preis eintragen; Wochentage anhaken, wenn es nur für Fr/Sa gelten soll.", "Mehrere Zeilen werden zusammen gespeichert. Leere Felder bleiben unverändert.", "Zum Sperren: «Zimmer sperren / freigeben», Zimmertyp, Zeitraum und Anzahl."],
    tip: "Preisänderungen gehen automatisch an Booking.com & Co., wenn der Channel-Manager verbunden ist.",
  },
  {
    key: "f_menu", section: "Verwaltung", scope: "dining", title: "Speisekarte und Optionen pflegen", roles: ["owner"], area: "positems",
    goal: "Artikel, Preise, Garstufen und Allergene stimmen überall: Kasse, Küche, Online-Bestellung, Vorbestellung und QR.",
    steps: ["Einstellungen → Speisekarte: Artikel mit Preis und MWST anlegen (oder per CSV/KI importieren).", "Unter «Optionen und Menüs» eine Gruppe anlegen (z. B. Garstufe, Pflicht, eine Wahl), Optionen mit Aufpreis hinzufügen und den Artikeln zuordnen.", "Unter «Online-Bestellung» Artikel antippen: online bestellbar, Beschreibung, Foto und Allergene."],
  },
  {
    key: "f_team", section: "Verwaltung", title: "Eine neue Person einrichten", roles: ["owner"], area: "team",
    goal: "Mitarbeitende bekommen Zugang mit genau den Seiten, die sie brauchen.",
    steps: ["Zahnrad (Einstellungen) → Team & Rollen öffnen.", "E-Mail eintragen und eine Rolle wählen (z. B. Rezeption, Reinigung, Service).", "Passt keine Rolle: «+ Eigene Rolle anlegen», Vorlage wählen und Seiten anhaken.", "Die Person meldet sich mit dem Link aus der Mail an und findet unter Hilfe → Erste Woche ihre Checkliste."],
  },
];

export const TERMS: Term[] = [
  // Zimmer und Preise
  { scope: "lodging", group: "Zimmer und Preise", term: "Zimmertyp", meaning: "Eine Gruppe gleichartiger Zimmer, die Gäste nicht einzeln unterscheiden, z. B. «Doppelzimmer Seesicht» mit 4 Zimmern.", inPontivo: "Verkauft wird der Zimmertyp, nicht die Zimmernummer. Die Nummer teilen Sie erst beim Check-in im Zimmerplan zu. Anzahl, Kapazität und Fotos pflegen Sie unter «Zimmer und Tarife».", area: "rooms" },
  { scope: "lodging", group: "Zimmer und Preise", term: "Tarif (Rateplan)", meaning: "Eine Preis- und Bedingungsvariante eines Zimmertyps: z. B. «Flexibel mit Frühstück» oder «Nicht stornierbar, günstiger».", inPontivo: "Pro Tarif legen Sie Verpflegung, Stornoregel, Preisbasis (für wie viele Personen) und Mindestaufenthalt fest. Ohne Tarif ist ein Zimmertyp nicht buchbar und im Kalender ohne Preiszeile.", area: "rooms" },
  { scope: "lodging", group: "Zimmer und Preise", term: "Verfügbarkeit", meaning: "Wie viele Zimmer eines Typs an einer Nacht noch frei sind.", inPontivo: "Der Kalender zeigt freie Zimmer pro Nacht (Anzahl minus gebucht, gesperrt und über Portale belegt). Rot heisst ausgebucht. Jede Buchung zieht die Nächte in derselben Transaktion ab, deshalb ist Doppelverkauf ausgeschlossen.", area: "calendar" },
  { scope: "lodging", group: "Zimmer und Preise", term: "Sperre (Kontingent sperren)", meaning: "Zimmer, die nicht verkauft werden sollen: Renovation, Eigenbedarf, Stammgast-Reserve.", inPontivo: "Kalender → «Zimmer sperren / freigeben». Mit Anzahl 0 geben Sie wieder frei. Die Sperre gilt auch für Portale.", area: "calendar" },
  { scope: "lodging", group: "Zimmer und Preise", term: "Mindestaufenthalt (Min. Nächte)", meaning: "Wie viele Nächte ein Gast mindestens bleiben muss, z. B. 3 Nächte über Ostern.", inPontivo: "Im Kalender pro Tag («Mindestaufenthalt bei Anreise») und im Tarif als Dauerregel, z. B. für Pakete. Beides gilt zusammen.", area: "calendar" },
  { scope: "lodging", group: "Zimmer und Preise", term: "Stopp (Stop-Sell)", meaning: "Ein Tag oder Tarif wird nicht mehr verkauft, obwohl Zimmer frei wären.", inPontivo: "Im Kalender «Verkaufsstopp» setzen. Er erscheint als «STOP» in der Zeile und geht an die Portale.", area: "calendar" },
  { scope: "lodging", group: "Zimmer und Preise", term: "CTA / CTD (keine Anreise / keine Abreise)", meaning: "Closed to Arrival: an diesem Tag darf niemand anreisen. Closed to Departure: niemand abreisen. So füllen Sie Lücken oder erzwingen Wochenpakete.", inPontivo: "Im Kalender pro Tag setzbar. In der Tabelle stehen «CTA» und «CTD» in der Preiszeile.", area: "calendar" },
  { scope: "lodging", group: "Zimmer und Preise", term: "Preisempfehlung", meaning: "Preisvorschläge nach Regeln wie Auslastung, Last Minute, Wochentag oder Ereignis.", inPontivo: "Sie legen Regeln und einen Mindest- und Höchstpreis fest. Pontivo schlägt vor, Sie bestätigen; auf Wunsch wird innerhalb Ihres Preiskorridors automatisch übernommen.", area: "pricing" },
  { scope: "lodging", group: "Zimmer und Preise", term: "Pauschale / Verpflegung", meaning: "Übernachtung nur, mit Frühstück, Halb- oder Vollpension.", inPontivo: "Pro Tarif wählbar. Bei Halb- und Vollpension geben Sie den Wert der Verpflegung je Person und Nacht an, damit die Rechnung die Beherbergung zum Sondersatz und die Verpflegung zum Normalsatz ausweist.", area: "rooms" },
  // Buchung und Zahlung
  { scope: "lodging", group: "Buchung und Zahlung", term: "Zimmer halten (Hold)", meaning: "Das Zimmer wird kurz für den Gast zurückgehalten, während er bezahlt.", inPontivo: "Beim Online-Buchen hält Pontivo das Zimmer rund eine halbe Stunde. Wird nicht bezahlt, läuft die Reservation ab und die Nächte werden automatisch wieder frei.", area: "bookings" },
  { scope: "lodging", group: "Buchung und Zahlung", term: "Buchungsstatus", meaning: "In welchem Zustand sich die Buchung befindet.", inPontivo: "Hold (reserviert, Zahlung läuft) → bestätigt → storniert oder No-Show. Abgelaufen heisst: nicht rechtzeitig bezahlt. Jeder Wechsel wird im Protokoll festgehalten.", area: "bookings" },
  { scope: "lodging", group: "Buchung und Zahlung", term: "Anzahlung und Restzahlung", meaning: "Der Gast zahlt bei der Buchung einen Teil, den Rest später.", inPontivo: "Sie legen einen Prozentsatz und die Frist fest (Einstellungen → Zahlungsmethoden). Bei kurzfristigen Buchungen oder kleinem Rest wird sofort voll bezahlt. Vor dem Fälligkeitstag schickt Pontivo dem Gast einen Zahlungslink, danach Erinnerungen. Wer vor Ort bezahlt, wird in der Buchung als «vor Ort erhalten» markiert.", area: "settings" },
  { scope: "lodging", group: "Buchung und Zahlung", term: "Stornoregel / Stornogebühr", meaning: "Bis wann ein Gast kostenlos absagen darf und was danach fällig wird.", inPontivo: "Im Tarif: «Kostenlos bis X Tage vor Anreise» und eine Gebühr in Prozent des Zimmerpreises. Pontivo rechnet die Rückerstattung selbst. Die Kurtaxe wird immer erstattet. Der Gast sieht die Regel schon vor der Buchung.", area: "rooms" },
  { scope: "lodging", group: "Buchung und Zahlung", term: "No-Show", meaning: "Der Gast erscheint nicht und sagt nicht ab.", inPontivo: "In der Buchung ab dem Tag nach der Anreise als «No-Show» markieren. Es gilt die Stornogebühr des Tarifs, die Nächte werden freigegeben.", area: "bookings" },
  { scope: "lodging", group: "Buchung und Zahlung", term: "Direktbuchung", meaning: "Der Gast bucht bei Ihnen, nicht über Booking.com & Co.", inPontivo: "Auf Ihrer Website oder über den Buchungsknopf. Das Geld geht über Stripe direkt auf Ihr Konto; Pontivo behält nur die Plattformgebühr. Finanzen → Statistik zeigt, wie viel Portal-Provision Sie dadurch sparen.", area: "statistics" },
  { scope: "lodging", group: "Buchung und Zahlung", term: "Plattformgebühr", meaning: "Was Pontivo pro Direktbuchung berechnet.", inPontivo: "Prozentsatz auf den Zimmerpreis, automatisch bei der Zahlung abgezogen. Die Aufstellung pro Monat mit Export finden Sie unter Einstellungen → Pontivo-Abrechnung (nur Inhaber).", area: "report" },
  { scope: "all", group: "Buchung und Zahlung", term: "Gutschein", meaning: "Ein Betrag, den Gäste kaufen oder verschenken und später einlösen.", inPontivo: "Gäste kaufen online, der Code wird per Mail verschickt. Sie lösen ihn bei einer Buchung ein; der Betrag wird abgezogen.", area: "vouchers" },
  // Gäste und Meldewesen
  { scope: "lodging", group: "Gäste und Meldewesen", term: "Meldeschein", meaning: "Gesetzliche Anmeldung der Gäste mit Name, Geburtsdatum, Nationalität und Adresse.", inPontivo: "Der Gast füllt ihn vorab online aus (Link 7 Tage vor Anreise); am Empfang bestätigen Sie, dass Sie den Ausweis gesehen haben. Aufbewahrt wird so lange, wie der Kanton es verlangt, danach löscht Pontivo automatisch. Menü: Finanzen → Berichte (Gästeregister).", area: "reports" },
  { scope: "lodging", group: "Gäste und Meldewesen", term: "Gästeportal", meaning: "Die Buchungsseite, die der Gast über den Link in seiner Mail öffnet, ohne Login.", inPontivo: "Dort meldet der Gast Wünsche (Late Check-out, Handtücher), sieht Tipps, die laufende Rechnung, ab Anreise den Türcode und checkt am Abreisetag selbst aus. Wünsche landen im Posteingang (Reiter «Gästewünsche»). Einstellungen → Gästeportal.", area: "reports" },
  { scope: "lodging", group: "Gäste und Meldewesen", term: "Kurtaxe", meaning: "Gemeindeabgabe pro Person und Nacht (Kinder oft befreit), die der Gast zusätzlich zahlt.", inPontivo: "Pontivo kennt den Satz Ihrer Gemeinde und rechnet ihn automatisch zum Zimmerpreis. Bestätigen Sie den Satz einmal in den Einstellungen. Die Quartalsliste für die Gemeinde exportieren Sie unter Finanzen → Berichte (Kurtaxe-Liste).", area: "reports" },
  { group: "Gäste und Meldewesen", scope: "all", term: "Kartei", meaning: "Notizen und Stichwörter zu Gästen, z. B. Stammgast, Fensterplatz oder «ohne Nüsse».", inPontivo: "Je E-Mail-Adresse und nur in Ihrem Betrieb. Hotel: Buchungen → Gäste → Kartei; Restaurant: Reservationen → Gäste oder der Link «Kartei» in der Reservationsliste. Gast antippen, Tags und Notiz eintragen. Ab 3 Restaurantbesuchen gilt ein Gast als Stammgast. Bitte keine Gesundheitsangaben.", area: "guestbook" },
  { scope: "all", group: "Gäste und Meldewesen", term: "Zustimmung (Newsletter)", meaning: "Mails zu Angeboten dürfen nur an Gäste gehen, die zugestimmt haben.", inPontivo: "Der Gast setzt das Häkchen bei der Buchung. Jede Newsletter-Mail enthält einen Abmeldelink.", area: "marketing" },
  // Rechnung und Kasse
  { scope: "all", group: "Rechnung und Kasse", term: "MWST und Sondersatz", meaning: "Beherbergung wird in der Schweiz zum Sondersatz besteuert, Verpflegung und Getränke zum Normalsatz.", inPontivo: "Pontivo teilt die Rechnung automatisch auf. Die MWST wird je Satz auf der Rechnung ausgewiesen. Ihre Angaben dazu stimmen Sie einmal mit Ihrem Treuhänder ab.", area: "invoices" },
  { scope: "all", group: "Rechnung und Kasse", term: "QR-Rechnung", meaning: "Der Schweizer Einzahlungsschein als QR-Code auf der Rechnung.", inPontivo: "Rechnungen enthalten den QR-Code, wenn Sie IBAN und Adresse hinterlegt haben. Zahlungen aus der Bankdatei (camt.054) ordnet Pontivo den offenen Rechnungen zu.", area: "invoices" },
  { scope: "all", group: "Rechnung und Kasse", term: "Gutschrift", meaning: "Eine Korrekturrechnung mit negativem Betrag. Rechnungen werden nie gelöscht oder überschrieben.", inPontivo: "Zu jeder Rechnung können Sie eine Gutschrift erstellen. So bleibt die Nummernfolge lückenlos und revisionsfähig.", area: "invoices" },
  { scope: "lodging", group: "Rechnung und Kasse", term: "Tagesabschluss", meaning: "Täglicher Kassenabschluss: erwartetes gegen gezähltes Bargeld, Summen je Zahlungsart.", inPontivo: "Der Abschluss ist unveränderbar. Auf einen abgeschlossenen Tag lassen sich keine Zahlungen oder Rechnungen mehr buchen.", area: "dayclose" },
  { scope: "all", group: "Rechnung und Kasse", term: "Debitoren", meaning: "Offene Forderungen, vor allem Firmenkunden mit Rechnung statt Sofortzahlung.", inPontivo: "Firma einmal anlegen, bei der Buchung «auf Rechnung» wählen; die Frist kommt aus der Firma. Die Liste zeigt offene Posten nach Fälligkeit, mit Erinnerungen und Mahnungen.", area: "debtors" },
  { scope: "lodging", group: "Rechnung und Kasse", term: "Eigentümerabrechnung", meaning: "Wer Ferienwohnungen für Eigentümer verwaltet, rechnet monatlich Umsatz, Kommission und Kosten ab.", inPontivo: "Wohnungen den Eigentümern zuordnen, Kommission festlegen; Pontivo erstellt die Monatsabrechnung als Druckansicht oder Mail.", area: "owners" },
  // Portale
  { scope: "lodging", group: "Portale und Schnittstellen", term: "Channel-Manager", meaning: "Ein Dienst, der Preise und freie Zimmer gleichzeitig an Booking.com, Airbnb und Expedia schickt und deren Buchungen zurückholt.", inPontivo: "Pontivo nutzt dafür Channex. Sie verbinden Ihr Portal-Konto einmal unter Einstellungen → Kanäle → Channel-Manager. Danach ist der Kalender die einzige Stelle, an der Sie Preise pflegen.", area: "channex" },
  { scope: "lodging", group: "Portale und Schnittstellen", term: "Kalender-Abgleich (iCal)", meaning: "Der einfache Abgleich mit Portalen ohne Channel-Manager: Belegungen werden als Kalender-Link ausgetauscht.", inPontivo: "Einstellungen → Kanäle → Kalender-Abgleich: Link der Portale eintragen und Pontivos Link dort hinterlegen. Nur Belegung, keine Preise, und der Abgleich ist nicht sofort.", area: "ical" },
  { scope: "lodging", group: "Portale und Schnittstellen", term: "Überbuchung", meaning: "Zwei Buchungen für dasselbe Zimmer, weil ein Portal verkauft hat, bevor es den neuen Stand kannte.", inPontivo: "Pontivo speichert die Portal-Buchung trotzdem (das Portal hat sie schon verkauft), markiert sie rot und meldet per Mail. Sie lösen es mit Umteilen oder Umbuchen.", area: "bookings" },
  { scope: "all", group: "Portale und Schnittstellen", term: "Stripe", meaning: "Der Zahlungsdienst für Kreditkarte und TWINT.", inPontivo: "Sie verbinden Ihr eigenes Stripe-Konto in den Einstellungen. Gästezahlungen gehen direkt dorthin. Pontivo speichert keine Kartendaten.", area: "settings" },
  { scope: "all", group: "Portale und Schnittstellen", term: "Modul", meaning: "Eine Funktion, die Sie ein- oder ausschalten können, z. B. Housekeeping oder Restaurant.", inPontivo: "Einstellungen → Funktionen. Ausgeschaltete Module verschwinden aus dem Menü, die Daten bleiben erhalten. Ein Betrieb ohne Personal braucht oft nur wenige.", area: "funktionen" },
  // Kennzahlen
  { scope: "lodging", group: "Kennzahlen", term: "Belegung", meaning: "Anteil der verkauften Zimmernächte an allen verfügbaren Zimmernächten.", inPontivo: "Statistik nach Monat und Zimmertyp.", area: "statistics" },
  { scope: "lodging", group: "Kennzahlen", term: "ADR (Durchschnittspreis)", meaning: "Durchschnittlicher Zimmerpreis pro verkaufter Nacht.", inPontivo: "Statistik, pro Monat und Zimmertyp.", area: "statistics" },
  { scope: "lodging", group: "Kennzahlen", term: "RevPAR", meaning: "Umsatz pro verfügbarem Zimmer (Belegung × ADR). Zeigt, wie gut Sie Ihre Zimmer insgesamt auslasten und verkaufen.", inPontivo: "Statistik. Der wichtigste Vergleichswert zwischen Monaten und Häusern.", area: "statistics" },
  { scope: "lodging", group: "Kennzahlen", term: "HESTA", meaning: "Die monatliche Beherbergungsstatistik des Bundesamts für Statistik.", inPontivo: "Statistik → HESTA fasst die Monatszahlen zusammen, die Sie melden müssen.", area: "hesta" },
  { scope: "lodging", group: "Zimmer und Preise", term: "Zimmerplan", meaning: "Eine Übersicht, welches Zimmer (mit Nummer) an welchem Tag von welchem Gast belegt ist.", inPontivo: "Kalender → Zimmerplan: Sie legen die Zimmer an, teilen jeder Buchung ein Zimmer desselben Typs zu (von Hand oder automatisch) und quartieren Gäste bei Bedarf um. Preis und Verfügbarkeit ändern sich dabei nicht. Optional: Ohne Zimmernummern läuft alles wie bisher.", area: "plan" },
  { scope: "lodging", group: "Zimmer und Preise", term: "Schulferien (Ferienvorschläge)", meaning: "Die kantonalen Schulferien, in denen die Nachfrage oft höher ist als sonst.", inPontivo: "Pontivo spielt die Ferien der Kantone zentral ein (Angaben ohne Gewähr) und zeigt die Ferien Ihres Kantons in der Preisempfehlung als Vorschlag. Ob und wie Sie die Preise anpassen, entscheiden Sie.", area: "pricing" },
  { scope: "lodging", group: "Buchung und Zahlung", term: "Firmencode", meaning: "Ein Code, mit dem Gäste einer Firma einen Rabatt bekommen, optional «auf Rechnung».", inPontivo: "Einstellungen → Website & Buchung → Direktbuchung: Sie legen den Code für eine Firma an (Rabatt bis 50 % auf den Zimmerpreis, optional befristet). Bei «auf Rechnung» ist die Buchung sofort bestätigt und die Firma erhält später die Rechnung (Debitoren). Ein falscher Code zeigt immer einen Fehler.", area: "direct" },
  { scope: "lodging", group: "Buchung und Zahlung", term: "Lückenfüller", meaning: "Ein Rabatt für kurze Aufenthalte, die eine Lücke von 1 bis 3 freien Nächten zwischen zwei Buchungen genau füllen.", inPontivo: "Einstellungen → Website & Buchung → Direktbuchung: Solche Aufenthalte dürfen den Mindestaufenthalt unterschreiten und bekommen auf Wunsch bis 30 % Rabatt. Das gilt nur für Direktbuchungen, die Preise auf den Portalen ändern sich nicht. Pro Buchung gilt immer nur ein Rabatt.", area: "direct" },
  { scope: "lodging", group: "Buchung und Zahlung", term: "Warteliste", meaning: "Eine Liste von Gästen, die sich melden wollen, sobald für ihre Daten wieder etwas frei wird.", inPontivo: "Ist ein Zeitraum ausgebucht, kann der Gast seine E-Mail und die Wunschdaten hinterlassen. Wird etwas frei, schickt Pontivo einmal eine Mail mit Link in die Suche. Der Gast kann sich per Link abmelden. Einstellung unter Einstellungen → Website & Buchung → Direktbuchung.", area: "direct" },
  { scope: "lodging", group: "Buchung und Zahlung", term: "Abbruch-Mail", meaning: "Eine einmalige Erinnerung an Gäste, die eine Buchung begonnen, aber nicht bezahlt haben.", inPontivo: "Standardmässig aus. Wenn Sie sie einschalten (Direktbuchung), erhält der Gast einmal eine Mail, sofern die Daten noch frei sind und er inzwischen nicht gebucht hat. Prüfen Sie vorher mit der Datenschutzerklärung, ob das für Sie passt.", area: "direct" },
  { scope: "lodging", group: "Buchung und Zahlung", term: "Upselling", meaning: "Zusatzangebote, die Gäste vor der Anreise per Mail bekommen, z. B. Frühstück, Spa oder Late Check-out.", inPontivo: "Modul «Upselling»: Gäste, die Angebote erhalten möchten, bekommen vor der Anreise eine Mail mit Ihren Angeboten und bezahlen direkt an Sie über Stripe. Pontivo behält dafür eine Provision (siehe Bedingungen für Gastgeber).", area: "upsell" },
  { scope: "lodging", group: "Buchung und Zahlung", term: "Eingebettete Zahlung", meaning: "Das Zahlungsfenster von Stripe erscheint direkt auf Ihrer Seite, statt dass der Gast auf eine andere Seite weitergeleitet wird.", inPontivo: "Einstellungen → Zahlungsmethoden (nur Inhaber). Die Karteneingabe liegt trotzdem immer bei Stripe, Pontivo und Ihre Website sehen keine Kartendaten. Ist sie ausgeschaltet oder nicht möglich, wird der Gast wie bisher weitergeleitet.", area: "settings" },
  { scope: "lodging", group: "Buchung und Zahlung", term: "Gruppenbuchung (Block)", meaning: "Mehrere Zimmer, die Sie für eine Gruppe reservieren, bevor die einzelnen Teilnehmer feststehen.", inPontivo: "Modul «Gruppen»: Sie blocken Zimmer je Typ und Nacht, ordnen später die Teilnehmer zu (Rooming-Liste) und legen eine Freigabefrist fest. Nicht vergebene Blockzimmer gehen danach automatisch zurück in den Verkauf.", area: "groups" },
  { scope: "lodging", group: "Buchung und Zahlung", term: "Angebote vor Ort", meaning: "Buchbare Einrichtungen mit Zeitfenstern, z. B. Sauna, Wellness, Seminarraum oder Tennisplatz.", inPontivo: "Modul «Angebote vor Ort»: Sie legen Plätze, Dauer und Preis je Zeitfenster fest und buchen Gäste darauf. Der Betrag kommt auf die Rechnung der Buchung.", area: "resources" },
  { scope: "lodging", group: "Gäste und Meldewesen", term: "Online-Check-in", meaning: "Der Gast erledigt vor der Anreise die Anmeldung online, damit es am Empfang schnell geht.", inPontivo: "Modul «Online-Check-in»: 7 Tage vor Anreise erhält der Gast einen Link zum Meldeschein. Sensible Angaben werden verschlüsselt gespeichert. Am Empfang prüfen Sie den Ausweis und bestätigen das. Menü: Heute → Tagesliste (bei jeder Anreise).", area: "reports" },
  { scope: "lodging", group: "Gäste und Meldewesen", term: "Zutritt (Türcode)", meaning: "Ein digitaler Code für die Tür, der nur für die Dauer des Aufenthalts gilt.", inPontivo: "Modul «Zutritt» mit Nuki-Schlössern: Sie verbinden Ihre Schlösser und ordnen sie der Eingangstür oder einem Zimmer zu. Auf der Buchung erstellen oder ziehen Sie den Code zurück. Codes stehen nie in Gäste-Mails.", area: "access" },
  { scope: "lodging", group: "Rechnung und Kasse", term: "Kartenterminal", meaning: "Ein Kartenlesegerät, mit dem Gäste vor Ort zahlen, z. B. beim Check-out.", inPontivo: "Modul «Kartenterminal» (Stripe): Sie registrieren das Gerät und lösen die Zahlung aus der Buchung heraus aus. Sie wird als Zahlung vor Ort auf der Rechnung verbucht.", area: "terminal" },
  { scope: "all", group: "Portale und Schnittstellen", term: "Schnittstelle (API)", meaning: "Eine technische Verbindung, über die andere Programme oder Websites mit Pontivo sprechen.", inPontivo: "Einstellungen → Website & Buchung → Schnittstelle (API): Eine Agentur oder Ihr Website-Partner bindet die Buchung in die eigene Website ein. Pontivo liefert dabei nur Verfügbarkeit, Preise und die Buchung samt Zahlung.", area: "api" },
  // Restaurant
  { scope: "dining", group: "Restaurant", term: "Tischplan", meaning: "Die Übersicht der Tische je Raum mit ihrem Zustand: frei, bald reserviert, besetzt.", inPontivo: "Reservationen → Tischplan mit Zeitregler, Stühlen und Kellner-Farben. Tisch antippen zeigt Reservation und offene Bestellungen; mit der Kasse eröffnen Sie dort die Bestellung. Eingerichtet wird er unter Einstellungen → Tischplan.", area: "resplan" },
  { scope: "dining", group: "Restaurant", term: "Tische zusammenlegen", meaning: "Für eine grössere Gruppe werden zwei oder mehr Tische zu einem gemacht.", inPontivo: "Von Hand mit «+ Tisch» in der Reservationsliste, automatisch mit der Einstellung «Tische zusammenlegen» (bis 4 nahe Tische im selben Raum).", area: "reservations" },
  { scope: "dining", group: "Restaurant", term: "Küchentakt", meaning: "Wie viele Gäste höchstens zur selben Uhrzeit neu beginnen, damit nicht alle gleichzeitig bestellen.", inPontivo: "Einstellungen → Reservation: Höchstzahl Gäste je Beginnzeit. Ist sie erreicht, bietet die Online-Reservation diese Zeit nicht mehr an.", area: "ressettings" },
  { scope: "dining", group: "Restaurant", term: "Vorbestellung", meaning: "Gäste wählen die Gerichte schon bei der Reservation, oft bei Gruppen.", inPontivo: "Online mit Vorauszahlung, auch mit Optionen wie Garstufe. Mit Küchenvorlauf erscheint sie vor der Ankunft in der Küche, sonst sobald der Gast am Tisch ist.", area: "ressettings" },
  { scope: "dining", group: "Restaurant", term: "Optionen und Menüs", meaning: "Wahlmöglichkeiten zu einem Gericht (Garstufe, Beilage, «ohne Zwiebeln») oder ein Menü aus mehreren Gängen.", inPontivo: "Einstellungen → Speisekarte → Optionen und Menüs: Gruppe anlegen, Pflicht oder freiwillig, mit Aufpreis. Gilt für Kasse, Küche, Online-Bestellung, Vorbestellung und QR.", area: "positems" },
  { scope: "dining", group: "Restaurant", term: "Tisch-QR", meaning: "Ein QR-Code auf dem Tisch, über den Gäste bestellen und bezahlen.", inPontivo: "Einstellungen → Tisch-QR: Codes drucken, Bestellen am Tisch einschalten. Bezahlt wird mit TWINT oder Karte, das Trinkgeld geht an den Kellner des Tisches, danach folgt die Bewertung.", area: "tableqr" },
  { scope: "both", group: "Restaurant", term: "Halbpension mit Tisch", meaning: "Hotelgäste mit Abendessen im Preis bekommen jeden Abend einen Tisch.", inPontivo: "Mit Tarif «Halbpension» und der Einstellung «Halbpension mit Tisch» legt Pontivo die Reservationen je Nacht automatisch an.", area: "ressettings" },
  { scope: "dining", group: "Restaurant", term: "Bon und Gegenbon", meaning: "Der Kassenbeleg einer Zahlung; ein Gegenbon hebt einen Bon auf.", inPontivo: "Bons sind lückenlos nummeriert und unveränderbar (je Gerät ein Nummernkreis). Korrigiert wird mit einem Gegenbon, nie durch Löschen.", area: "kasse" },
  { scope: "dining", group: "Restaurant", term: "Z-Bericht (Kassenabschluss)", meaning: "Die Tagessumme der Kasse nach Zahlart, mit Trinkgeld und MWST.", inPontivo: "Gastronomie → Finanzen → Kassenabschluss: Bargeld zählen und den Tag abschliessen.", area: "posclose" },
];

/** Geltungsbereich eines Begriffs (ohne Angabe: Unterkunft) */
export const termScope = (t: Term): Scope => t.scope ?? "lodging";
export const flowScope = (f: Flow): Scope => f.scope ?? SECTION_SCOPE[f.section];

/** Rollen, für die ein Ablauf gezeigt wird (Inhaber sehen alles) */
export const flowsFor = (role: GuideRole): Flow[] => (role === "owner" ? FLOWS : FLOWS.filter((f) => f.roles.includes(role)));
export const TERM_GROUPS = [...new Set(TERMS.map((t) => t.group))];
