/**
 * Modul-Register (SPEC 16.1). Ein Modul ist eine Funktion, die ein Betrieb ein- oder ausschalten kann.
 * Ausgeschaltet = unsichtbar (Menü, Seiten, Übersicht); Daten bleiben erhalten.
 * Gespeichert in hotel_modules (hotel_id, module, enabled). Keine Zeile = Standard.
 * Kostenpflichtige Module (ai_chat, upsell) haben einen eigenen Einschalt-Ablauf mit Konditionen und stehen hier nicht.
 */
export type ModuleDef = {
  key: string;
  label: string;
  description: string;
  /** Module, die laufen müssen, damit dieses Sinn ergibt */
  deps: string[];
  defaultOn: boolean;
  /** Menüpunkte (Schlüssel aus src/admin/nav.ts), die bei «aus» verschwinden */
  navKeys: string[];
};

export const MODULES: ModuleDef[] = [
  { key: "frontdesk", label: "Rezeption", description: "Tagesliste (Anreisen, Abreisen, im Haus), Zimmerplan und Zimmernummern. Sinnvoll für Hotels; Ferienwohnungen brauchen es meist nicht.", deps: [], defaultOn: true, navKeys: ["frontdesk", "plan"] },
  { key: "housekeeping", label: "Housekeeping", description: "Reinigungsstatus je Zimmer, Tagesaufträge nach Abreise, Handy-Liste für das Reinigungspersonal und Meldungen zu Mängeln.", deps: ["frontdesk"], defaultOn: false, navKeys: ["housekeeping"] },
  { key: "guestnotes", label: "Gäste-Notizen", description: "Notizen und Tags zu Gästen (z. B. Stammgast, Wunsch Zimmer oben), sichtbar bei der Buchung, mit Suche. Bitte keine Gesundheits- oder sonstigen heiklen Angaben notieren.", deps: [], defaultOn: false, navKeys: ["guestbook"] },
  { key: "statistics", label: "Statistik", description: "Belegung, Durchschnittspreis (ADR), Umsatz pro verfügbarem Zimmer (RevPAR) und Herkunft der Buchungen, nach Monat und Zimmertyp; dazu die Monatszahlen für die Beherbergungsstatistik (HESTA).", deps: [], defaultOn: true, navKeys: ["statistics", "hesta"] },
  { key: "mailtexts", label: "Mail-Texte", description: "Eigene Sätze und Betreff in den Gäste-Mails (Bestätigung, Vor der Anreise, Nach dem Aufenthalt, Restzahlung, Rechnung), pro Sprache.", deps: [], defaultOn: true, navKeys: ["mailtexts"] },
  { key: "groups", label: "Gruppen", description: "Zimmerblock für Gruppen mit Freigabefrist, Rooming-Liste (Teilnehmer) und Rechnung an die Firma.", deps: [], defaultOn: false, navKeys: ["groups"] },
  { key: "accountingexport", label: "Buchhaltung-Export", description: "Rechnungen und Zahlungen als Buchungsliste (CSV) für den Treuhänder, mit eigener Kontenzuordnung.", deps: ["invoicing"], defaultOn: false, navKeys: ["accountingexport"] },
  { key: "terminal", label: "Kartenterminal", description: "Kartenzahlung am Empfang mit einem Stripe-Kartenleser (WisePOS E / S700). Die Zahlung wird automatisch auf die Buchung gebucht. Hardware und Kartengebühren siehe Stripe.", deps: ["invoicing"], defaultOn: false, navKeys: ["terminal"] },
  { key: "access", label: "Zutritt (Nuki)", description: "Keypad-Codes für Nuki-Türschlösser: pro Buchung automatisch ein Code für Eingang und Zimmer, gültig von Check-in bis Check-out, danach gelöscht. Braucht Nuki-Hardware (Keypad, ggf. Bridge) und ein Nuki-Web-Konto.", deps: ["frontdesk"], defaultOn: false, navKeys: ["access"] },
  { key: "invoicing", label: "Rechnung & Kasse", description: "Rechnungen und Quittungen mit MWST und QR-Rechnung, Zahlungen vor Ort verbuchen, Tagesabschluss mit Kassenzählung.", deps: [], defaultOn: true, navKeys: ["invoices", "dayclose"] },
  { key: "debtors", label: "Debitoren", description: "Firmenkunden mit Rechnung auf Rechnung und eigener Zahlungsfrist, Liste der offenen Rechnungen nach Fälligkeit, Zahlungserinnerungen und Mahnungen, Zahlungseingang aus der Bankdatei (camt.054).", deps: ["invoicing"], defaultOn: false, navKeys: ["debtors"] },
  { key: "owners", label: "Eigentümerabrechnung", description: "Für Verwalter von Ferienwohnungen: Objekte gehören Eigentümern. Monatsabrechnung mit Umsatz, Ihrer Kommission und Kosten, als Druckansicht und per Mail an den Eigentümer.", deps: ["invoicing"], defaultOn: false, navKeys: ["owners"] },
  { key: "resources", label: "Angebote vor Ort", description: "Wellness, Sauna, Seminarraum oder Tennisplatz in Zeitfenstern buchen, mit Plätzen pro Fenster. Hausgäste können den Preis aufs Zimmer buchen lassen (Posten in der Rechnung).", deps: ["invoicing"], defaultOn: false, navKeys: ["resources"] },
  { key: "marketing", label: "Newsletter", description: "Mail an Gäste, die zugestimmt haben, mit Auswahl nach Sprache, Stichwort und früheren Aufenthalten. Jede Mail enthält einen Abmeldelink.", deps: [], defaultOn: false, navKeys: ["marketing"] },
  { key: "posbridge", label: "Kassen-Schnittstelle", description: "Ihre Restaurantkasse bucht Posten direkt aufs Zimmer: eine kleine Schnittstelle mit eigenem Schlüssel (widerrufbar). Die Posten erscheinen in der Hotelrechnung.", deps: ["invoicing"], defaultOn: false, navKeys: ["posbridge"] },
  { key: "pos", label: "Restaurant und Kasse", description: "Bestellen am Tisch, Kassieren (bar, Karte, TWINT, aufs Zimmer), Tagesabschluss. Bons sind unveränderbar und lückenlos nummeriert.", deps: ["invoicing"], defaultOn: false, navKeys: [] },
  { key: "inbox", label: "Posteingang", description: "Nachrichten von Booking.com, Airbnb und Expedia an einem Ort lesen und beantworten, mit Mitteilung bei neuen Nachrichten. Braucht den Channel-Manager und die Channex-App «Messages» (kostet bei Channex extra).", deps: ["channex"], defaultOn: false, navKeys: ["inbox"] },
  { key: "feedback", label: "Bewertungen", description: "Nach dem Aufenthalt fragen die Gäste, wie es war. Zufriedene Gäste bekommen den Link zu Ihrer Bewertungsseite, unzufriedene schreiben Ihnen direkt. Gesendet wird mit der Nachher-Mail.", deps: [], defaultOn: false, navKeys: ["feedback"] },
  { key: "pricing_rules", label: "Preisempfehlung", description: "Schlägt Preise nach Ihren Regeln vor (Auslastung, Last Minute, Wochentag, Ereignisse), mit Mindest- und Höchstpreis. Sie bestätigen; auf Wunsch wird innerhalb Ihres Preiskorridors automatisch übernommen.", deps: [], defaultOn: false, navKeys: ["pricing"] },
  { key: "vouchers", label: "Gutscheine", description: "Gutscheine online verkaufen und im Haus einlösen.", deps: [], defaultOn: true, navKeys: ["vouchers"] },
  { key: "inquiries", label: "Anfragen", description: "Anfragen von der Website und aus dem Chat (z. B. Gruppen, Sonderwünsche).", deps: [], defaultOn: true, navKeys: ["inquiries"] },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);
export const moduleDef = (key: string) => MODULES.find((m) => m.key === key);

export type ModuleRow = { module: string; enabled: boolean };

/** Ist das Modul an? Fehlt die Zeile, gilt der Standard. Unbekannte Module sind aus. */
export function isOn(rows: ModuleRow[], key: string): boolean {
  const def = moduleDef(key);
  if (!def) return false;
  const r = rows.find((x) => x.module === key);
  return r ? r.enabled : def.defaultOn;
}

/** Menüpunkte, die wegen ausgeschalteter Module verschwinden */
export function hiddenNavKeys(rows: ModuleRow[]): Set<string> {
  return new Set(MODULES.filter((m) => !isOn(rows, m.key)).flatMap((m) => m.navKeys));
}

/** Prüft, ob ein Wechsel erlaubt ist. Gibt eine Erklärung zurück, wenn nicht. */
export function switchProblem(rows: ModuleRow[], key: string, on: boolean): string | null {
  const def = moduleDef(key);
  if (!def) return "Unbekannte Funktion.";
  if (on) {
    const missing = def.deps.filter((d) => !isOn(rows, d)).map((d) => moduleDef(d)?.label ?? d);
    return missing.length ? `«${def.label}» braucht zuerst: ${missing.join(", ")}.` : null;
  }
  const users = MODULES.filter((m) => m.deps.includes(key) && isOn(rows, m.key)).map((m) => m.label);
  return users.length ? `«${def.label}» wird noch gebraucht von: ${users.join(", ")}. Bitte zuerst dort ausschalten.` : null;
}
