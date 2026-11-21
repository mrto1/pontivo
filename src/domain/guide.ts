import type { Role } from "./roles";

/**
 * Einarbeitung (PMS-ERSATZ 4.2): Checkliste «Erste Woche» je Rolle und Hilfetexte je Funktion. Reine Daten und Logik.
 * Jede Aufgabe zeigt auf einen Menüpunkt (`area` = Schlüssel aus src/admin/nav.ts); ist dessen Modul aus, entfällt die Aufgabe.
 */
export type GuideTask = { key: string; area: string; title: string; hint: string };
export type GuideRole = "owner" | "reception" | "housekeeping" | "accounting" | "service";

export const GUIDE_ROLE_LABEL: Record<GuideRole, string> = { owner: "Inhaber und Manager", reception: "Rezeption", housekeeping: "Reinigung", accounting: "Buchhaltung", service: "Service (Restaurant)" };

export const GUIDE: Record<GuideRole, GuideTask[]> = {
  owner: [
    { key: "o_rooms", area: "rooms", title: "Zimmer und Preise prüfen", hint: "Zimmertypen, Grundpreis und Kapazität: stimmt alles mit der Wirklichkeit?" },
    { key: "o_site", area: "site", title: "Website ansehen", hint: "Texte, Fotos und Farben. So sehen Gäste Ihr Haus." },
    { key: "o_functions", area: "funktionen", title: "Funktionen ein- oder ausschalten", hint: "Nur was Sie brauchen, bleibt im Menü. Ausgeschaltet gehen keine Daten verloren." },
    { key: "o_team", area: "team", title: "Team einladen", hint: "Jede Person bekommt eine Rolle: Rezeption, Reinigung, Buchhaltung oder Service sehen nur ihren Bereich." },
    { key: "o_channex", area: "channex", title: "Kanäle verbinden", hint: "Booking.com, Airbnb und Expedia mit dem Kalender abgleichen." },
    { key: "o_bookings", area: "bookings", title: "Eine Testbuchung durchspielen", hint: "Von der Buchung bis zur bestätigten Mail." },
    { key: "o_invoices", area: "invoices", title: "Eine Rechnung ausstellen", hint: "Rechnungsdaten und MWST einmal mit Ihrem Treuhänder prüfen." },
    { key: "o_stats", area: "statistics", title: "Statistik anschauen", hint: "Belegung, Durchschnittspreis und Herkunft der Buchungen." },
  ],
  reception: [
    { key: "r_today", area: "home", title: "Tagesliste öffnen", hint: "Anreisen, Abreisen und Gäste im Haus auf einen Blick." },
    { key: "r_plan", area: "plan", title: "Zimmerplan ansehen", hint: "Zimmer zuteilen und bei Bedarf wechseln." },
    { key: "r_booking", area: "bookings", title: "Eine Buchung von Hand erfassen", hint: "Für Telefon und Walk-in. Der Kalender ist sofort aktuell." },
    { key: "r_checkin", area: "home", title: "Einen Gast einchecken", hint: "Meldeschein prüfen, Zimmer zuteilen." },
    { key: "r_invoice", area: "invoices", title: "Rechnung und Zahlung erfassen", hint: "Zahlung vor Ort verbuchen, Rechnung oder Quittung drucken." },
    { key: "r_dayclose", area: "dayclose", title: "Tagesabschluss üben", hint: "Bargeld zählen und den Tag abschliessen." },
    { key: "r_inbox", area: "inbox", title: "Posteingang lesen", hint: "Nachrichten von Gästen und Portalen an einem Ort." },
  ],
  housekeeping: [
    { key: "h_list", area: "housekeeping", title: "Reinigungsliste öffnen", hint: "Am Handy: die Zimmer des Tages, nach Abreise zuerst." },
    { key: "h_status", area: "housekeeping", title: "Ein Zimmer auf «sauber» setzen", hint: "So sieht die Rezeption sofort, dass es bereit ist." },
    { key: "h_issue", area: "housekeeping", title: "Einen Mangel melden", hint: "Defektes Licht, fehlendes Handtuch: kurze Meldung, die Rezeption sieht sie." },
    { key: "h_home", area: "mypontivo", title: "Pontivo auf den Startbildschirm legen", hint: "Im Menü hinter dem Profilbild (Profil & Sicherheit): so öffnet sich die Liste mit einem Tipp." },
  ],
  accounting: [
    { key: "a_invoices", area: "invoices", title: "Rechnungen ansehen", hint: "Offene, bezahlte und gutgeschriebene Rechnungen." },
    { key: "a_dayclose", area: "dayclose", title: "Tagesabschluss ansehen", hint: "Kassenzählung und Zahlungsarten je Tag." },
    { key: "a_debtors", area: "debtors", title: "Offene Posten prüfen", hint: "Firmenkunden nach Fälligkeit, Mahnungen." },
    { key: "a_export", area: "accountingexport", title: "Buchungsliste exportieren", hint: "CSV für Ihre Buchhaltung, mit Ihrer Kontenzuordnung." },
    { key: "a_stats", area: "statistics", title: "Statistik und Monatsabrechnung", hint: "Umsatz nach Monat." },
    { key: "a_owners", area: "owners", title: "Eigentümerabrechnung (falls Sie Wohnungen verwalten)", hint: "Monatsabrechnung je Eigentümer mit Ihrer Kommission." },
  ],
  service: [
    { key: "s_kasse", area: "kasse", title: "Kasse öffnen und Gerät wählen", hint: "Einmal mit Internet, danach geht es auch ohne." },
    { key: "s_order", area: "kasse", title: "Eine Bestellung am Tisch aufnehmen", hint: "Tisch eröffnen, Artikel antippen, im Haus oder Take-away." },
    { key: "s_split", area: "kasse", title: "Getrennt bezahlen üben", hint: "Bei «Jetzt» die Menge je Posten wählen, dann kassieren." },
    { key: "s_room", area: "kasse", title: "Aufs Zimmer buchen", hint: "Gast aus der Liste wählen. Der Posten erscheint in der Hotelrechnung." },
    { key: "s_tables", area: "restaurant", title: "Tischübersicht lesen", hint: "Offene Beträge je Tisch." },
  ],
};

/** Welche Checkliste gehört zur Rolle? Volle Rollen (Inhaber, Manager, Mitarbeitende) lesen die Inhaber-Liste. */
export function guideRole(role: Role): GuideRole {
  return role === "reception" || role === "housekeeping" || role === "accounting" || role === "service" ? role : "owner";
}

/** Aufgaben der Rolle, die im Menü des Betriebs erreichbar sind (`visibleAreas`) */
export const tasksFor = (role: Role, visibleAreas: ReadonlySet<string>): GuideTask[] => GUIDE[guideRole(role)].filter((t) => visibleAreas.has(t.area));

export const progress = (tasks: GuideTask[], done: ReadonlySet<string>) => ({ done: tasks.filter((t) => done.has(t.key)).length, total: tasks.length });

/** Hilfe je Funktion: ein Satz «So fangen Sie an» (die Beschreibung steht schon im Modul-Register) */
export const HELP_START: Record<string, string> = {
  frontdesk: "Die «Tagesliste» unter «Heute» gibt es immer. Mit der Rezeption teilen Sie im Zimmerplan (Kalender) die Zimmer zu.",
  housekeeping: "Nach jeder Abreise erscheint ein Reinigungsauftrag. Das Personal öffnet die Liste am Handy und setzt das Zimmer auf «sauber».",
  invoicing: "Öffnen Sie eine Buchung und wählen Sie «Rechnung erstellen». Zahlungen vor Ort buchen Sie in derselben Buchung.",
  debtors: "Legen Sie die Firma einmal an. Bei einer Buchung wählen Sie dann «auf Rechnung», die Zahlungsfrist kommt aus der Firma.",
  resources: "Legen Sie das Angebot mit Zeitfenstern an (z. B. Sauna, 60 Minuten). Buchen Sie es bei einer Buchung, der Preis kommt aufs Zimmer.",
  pos: "Legen Sie unter Einstellungen → Verkauf → Restaurant Artikel, Tische und mindestens ein Gerät an. Dann öffnen Sie «Kasse» am Tablet.",
  posbridge: "Erstellen Sie einen Schlüssel und geben Sie ihn Ihrem Kassenanbieter. Dessen Kasse bucht Posten aufs Zimmer.",
  inbox: "Verbinden Sie Booking.com, Airbnb oder Expedia unter Einstellungen → Kanäle. Nachrichten erscheinen danach hier.",
  owners: "Ordnen Sie jede Wohnung einem Eigentümer zu und setzen Sie Ihre Kommission. Die Monatsabrechnung rechnet Pontivo.",
  marketing: "Schreiben Sie ein Mail und wählen Sie die Empfänger nach Sprache. Es gehen nur Gäste, die zugestimmt haben.",
  vouchers: "Legen Sie Beträge fest, die Gäste online kaufen können. Im Haus lösen Sie den Code bei der Buchung ein.",
  access: "Verbinden Sie Ihr Nuki-Konto. Pro Buchung entsteht automatisch ein Code für die Dauer des Aufenthalts.",
  terminal: "Registrieren Sie den Kartenleser einmal mit dem Code vom Gerät. Dann zahlen Gäste am Empfang mit der Karte.",
  groups: "Legen Sie einen Zimmerblock mit Freigabefrist an. Die Teilnehmer tragen Sie in der Rooming-Liste ein.",
  accountingexport: "Ordnen Sie Ihre Konten zu und laden Sie die Buchungsliste pro Monat als CSV herunter.",
  statistics: "Wählen Sie Monat und Zimmertyp. Belegung, Durchschnittspreis und Umsatz pro Zimmer sehen Sie sofort.",
};
