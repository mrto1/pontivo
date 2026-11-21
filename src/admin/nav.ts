/**
 * Menü des Admin-Bereichs an einer Stelle.
 * - `primary`: die vier Hauptpunkte (Heute, Kalender, Buchungen, Finanzen) nach Häufigkeit: untere Leiste (Handy) bzw. Kopfzeile (Desktop). Es gibt kein «Mehr».
 * - `settings`: Zahnrad oben rechts (nur Inhaber und Manager) mit den Punkten zum Betrieb in drei Gruppen (`group`), eigene Seite /einstellungen.
 * - `tabs`: Unterseiten eines Menüpunkts. Sie erscheinen als Reiter über der Seite, im Menü steht nur der Sammelpunkt.
 *   Reiter können selbst Reiter haben (zweite Reihe).
 * - `account`: «Mein Konto» hinter dem Profilbild, mit eigenen Reitern.
 * Umgruppieren = nur diese Datei ändern.
 */
export type NavItem = {
  key: string; label: string; href: string; external?: boolean; tabs?: NavItem[];
  /** Zahnrad: Gruppe, in der der Punkt auf der Einstellungsseite und in der Seitenleiste steht */
  group?: string;
  /** Zahnrad: ein Satz Erklärung für die Einstellungsseite */
  lead?: string;
  /** Symbol der unteren Leiste (Handy), sonst `key` */
  icon?: string;
  /** weitere Adressen, bei denen der Punkt aktiv leuchtet (Detailseiten ohne eigenen Menüpunkt) */
  match?: string[];
};
export type Nav = { primary: NavItem[]; settings: NavItem; account: NavItem };

/** Gruppen des Zahnrads (Reihenfolge und Erklärung) */
export const SETTINGS_GROUPS: { title: string; lead: string }[] = [
  { title: "Betrieb", lead: "Wer Sie sind, was Sie anbieten und wer im Team mitarbeitet." },
  { title: "Verkauf", lead: "Wie Gäste Sie finden und buchen, auf Ihrer Website, über Portale und per Mail." },
  { title: "Technik", lead: "Funktionen ein- und ausschalten, Geräte anschliessen, Daten übernehmen, Abo." },
];

/** `hidden`: Menüpunkte ausgeschalteter Module (src/domain/modules.ts) oder nicht erlaubter Bereiche. Gruppen ohne Reiter verschwinden; hat eine Gruppe nur noch einen Reiter, bleibt sie ein einfacher Punkt. Sonst führt der Punkt zum ersten übrigen Reiter. */
export function adminNav(hotel: { id: string; slug: string; primaryDomain: string | null }, hidden: ReadonlySet<string> = new Set()): Nav {
  const nav = baseNav(hotel);
  if (!hidden.size) return nav;
  const prune = (i: NavItem): NavItem | null => {
    if (hidden.has(i.key)) return null;
    if (!i.tabs) return i;
    const tabs: NavItem[] = i.tabs.flatMap((t) => prune(t) ?? []);
    if (!tabs.length) return null;
    if (tabs.length === 1) return { ...i, key: tabs[0].key, href: tabs[0].href, tabs: tabs[0].tabs };
    return { ...i, href: tabs[0].href, tabs };
  };
  const list = (items: NavItem[]) => items.flatMap((i) => prune(i) ?? []);
  // Zahnrad: die Seite /einstellungen bleibt das Ziel, nur die Punkte darunter werden gefiltert
  return { primary: list(nav.primary), settings: { ...nav.settings, tabs: list(nav.settings.tabs ?? []) }, account: prune(nav.account) ?? nav.account };
}

function baseNav(hotel: { id: string; slug: string; primaryDomain: string | null }): Nav {
  const base = `/mypontivo/${hotel.id}`;
  const link = (key: string, label: string, path = key, extra: Partial<NavItem> = {}): NavItem => ({ key, label, href: `${base}/${path}`, ...extra });
  const set = (group: string, item: NavItem, lead: string): NavItem => ({ ...item, group, lead });
  return {
    primary: [
      // Heute: der laufende Tagesbetrieb
      {
        key: "g-overview", label: "Heute", href: base, icon: "home",
        tabs: [
          { key: "home", label: "Tagesliste", href: base },
          link("housekeeping", "Reinigung"),
          link("inbox", "Posteingang"),
          link("guests", "Check-in"),
          { ...link("g-restaurant", "Restaurant", "restaurant"), tabs: [link("restaurant", "Tische"), link("kasse", "Kasse"), link("posclose", "Kassenabschluss", "restaurant/abschluss")] },
        ],
      },
      // Kalender: Zeitraster je Zimmertyp. Erster Reiter ist der Zimmerplan, solange die Rezeption (Modul frontdesk) an ist
      { key: "g-calendar", label: "Kalender", href: `${base}/plan`, icon: "calendar", tabs: [link("plan", "Zimmerplan"), link("calendar", "Preise & Verfügbarkeit"), link("pricing", "Preisempfehlung", "preise")] },
      // Buchungen: Vorgänge und Gäste
      {
        key: "g-bookings", label: "Buchungen", href: `${base}/bookings`, icon: "bookings",
        tabs: [
          link("bookings", "Buchungen"), link("groups", "Gruppen"), link("resources", "Angebote vor Ort"), link("vouchers", "Gutscheine"),
          { ...link("g-guests", "Gäste", "guestbook"), tabs: [link("guestbook", "Kartei"), link("marketing", "Newsletter"), link("feedback", "Bewertungen")] },
        ],
      },
      // Finanzen: Rechnungen, Zahlen, Buchhaltung
      {
        key: "g-finance", label: "Finanzen", href: `${base}/invoices`, icon: "finance",
        tabs: [
          link("invoices", "Rechnungen"), link("dayclose", "Tagesabschluss", "invoices/tagesabschluss"), link("debtors", "Debitoren", "invoices/debitoren"), link("owners", "Eigentümer"),
          { ...link("g-statistics", "Statistik", "statistics"), tabs: [link("statistics", "Statistik"), link("hesta", "HESTA", "statistics/hesta")] },
          link("accountingexport", "Buchhaltung", "buchhaltung"),
        ],
      },
    ],
    // Zahnrad oben rechts: Übersichtsseite mit drei Gruppen, am Desktop zugleich Seitenleiste
    settings: {
      key: "einstellungen", label: "Einstellungen", href: `${base}/einstellungen`,
      tabs: [
        set("Betrieb", link("settings", "Grunddaten"), "Name, Adresse, Zeiten, Kurtaxe, Zahlung und Rechnung."),
        set("Betrieb", link("rooms", "Zimmer & Tarife"), "Zimmertypen, Fotos, Preise und Tarife."),
        set("Betrieb", link("extras", "Zusatzleistungen", "rooms/extras"), "Hund, Parkplatz, Endreinigung und weitere Extras zum Zimmer."),
        set("Betrieb", link("team", "Team & Rollen"), "Wer Zugang hat und was jede Person sehen darf."),
        set("Verkauf", { ...link("g-site", "Website & Buchung", "site"), tabs: [link("site", "Website"), link("direct", "Direktbuchung", "direktbuchung"), link("api", "Schnittstelle (API)")] }, "Texte, Fotos und Farben der Website, Buchungsstrecke, Werkzeuge für Direktbuchungen."),
        set("Verkauf", { ...link("g-channels", "Kanäle", "channex"), tabs: [link("channex", "Channel-Manager"), link("ical", "Kalender-Abgleich")] }, "Booking.com, Airbnb, Expedia und iCal, dazu die Provision der Portale."),
        set("Verkauf", link("mailtexts", "Gäste-Mails", "mail-texte"), "Eigene Sätze in Bestätigung, Vor-der-Anreise- und Nachher-Mail."),
        set("Verkauf", link("gaesteportal", "Gästeportal"), "Wünsche, Tipps, Türcode und Check-out auf der Buchungsseite des Gastes."),
        set("Verkauf", link("upsell", "Upselling"), "Extras wie Frühstück, die Gäste online dazubuchen."),
        set("Verkauf", link("ki-chat", "KI-Chat"), "Der digitale Assistent auf Website und Buchungsseite."),
        set("Technik", link("funktionen", "Funktionen"), "Nur was Sie brauchen, bleibt im Menü."),
        set("Technik", { ...link("g-devices", "Geräte & Kasse", "terminal"), tabs: [link("terminal", "Kartenterminal"), link("access", "Zutritt", "zutritt"), link("positems", "Kassen-Artikel", "restaurant/artikel"), link("posbridge", "Kassen-Schnittstelle")] }, "Kartenleser, Türschlösser, Artikel der Restaurantkasse und Schnittstelle zu Ihrer Kasse."),
        set("Technik", link("migration", "Datenübernahme"), "Buchungen und Gäste aus Ihrer bisherigen Software übernehmen."),
        set("Technik", link("report", "Abo & Gebühren", "report", { match: [`${base}/plattform-rechnung`] }), "Monatsabrechnung, Plattformgebühren und Rechnungen von Pontivo (nur Inhaber)."),
      ],
    },
    // Profilbild oben rechts
    account: { ...link("mypontivo", "Mein Konto"), tabs: [link("mypontivo", "Profil & Sicherheit"), link("firstweek", "Erste Woche", "erste-woche"), { ...link("help", "Hilfe", "hilfe"), tabs: [link("help", "Wegweiser", "hilfe"), link("helpflows", "Abläufe", "hilfe/ablaeufe"), link("helpterms", "Fachbegriffe", "hilfe/begriffe")] }] },
  };
}

/** Alle Seiten des Menüs (die Blätter: Reiter, nie ihre Sammelpunkte), ohne externe Links */
export function allPages(nav: Nav): NavItem[] {
  return [...nav.primary, nav.settings, nav.account].flatMap(leaves).filter((i) => !i.external);
}
const leaves = (i: NavItem): NavItem[] => (i.tabs ? i.tabs.flatMap(leaves) : [i]);

/** Schlüssel aller Blätter eines Menüs (Gruppen haben keine eigenen Seiten) */
export const leafKeys = (nav: Nav): string[] => allPages(nav).map((i) => i.key);

/** Punkte des Zahnrads nach Gruppen, in der Reihenfolge von SETTINGS_GROUPS (leere Gruppen fehlen) */
export function settingsGroups(nav: Nav): { title: string; lead: string; items: NavItem[] }[] {
  return SETTINGS_GROUPS.map((g) => ({ ...g, items: (nav.settings.tabs ?? []).filter((i) => i.group === g.title) })).filter((g) => g.items.length);
}

const matches = (pathname: string, href: string, home: string) => (href === home ? pathname === home : pathname === href || pathname.startsWith(`${href}/`));

/** Länge des genauesten passenden Ziels in diesem Punkt (samt Reitern), sonst 0 */
export function bestMatch(pathname: string, item: NavItem, home: string): number {
  const own = item.external ? 0 : Math.max(0, ...[item.href, ...(item.match ?? [])].filter((h) => matches(pathname, h, home)).map((h) => h.length));
  return Math.max(own, ...(item.tabs ?? []).map((t) => bestMatch(pathname, t, home)));
}

/** Aktiv, wenn der Pfad dem Ziel (oder einem seiner Reiter) entspricht; Übersicht nur exakt */
export function isActive(pathname: string, item: NavItem, home: string): boolean {
  return bestMatch(pathname, item, home) > 0;
}

/** Gehört die Seite zum Zahnrad (Übersichtsseite oder einer ihrer Punkte)? */
export const inSettings = (pathname: string, nav: Nav, home: string): boolean => isActive(pathname, nav.settings, home);

/** Der Sammelpunkt, zu dem die aktuelle Seite gehört (für die Reiter über der Seite). Im Zahnrad ist es der Punkt mit Unterreitern (z. B. Website & Buchung). */
export function sectionFor(pathname: string, nav: Nav, home: string): NavItem | null {
  const own = [...nav.primary, nav.account].find((i) => i.tabs && isActive(pathname, i, home));
  if (own) return own;
  return (nav.settings.tabs ?? []).find((i) => i.tabs && isActive(pathname, i, home)) ?? null;
}
