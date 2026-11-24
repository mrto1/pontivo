/**
 * Menü des Admin-Bereichs an einer Stelle.
 * - `primary`: die vier Hauptpunkte (Heute, Kalender, Buchungen, Finanzen) nach Häufigkeit: untere Leiste (Handy) bzw. Kopfzeile (Desktop). Es gibt kein «Mehr».
 * - `settings`: Zahnrad oben rechts (nur Inhaber und Manager) mit den Punkten zum Betrieb in Gruppen (`group`), eigene Seite /einstellungen.
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
/** Bereiche eines Betriebs (SPEC 20.1): Unterkunft und Gastronomie. Fest in Hilfe, Support und Code. */
export type Area = "lodging" | "dining";
/** Art des Betriebs für die Navigation: Unterkunft (mit oder ohne Gastronomie) oder reines Restaurant */
export type NavKind = "hotel" | "restaurant";
export type HotelRef = { id: string; slug: string; primaryDomain: string | null };

/** Punkte, die es nur für Unterkünfte gibt; reine Restaurants sehen sie nicht (Zahnrad) */
export const LODGING_ONLY = ["rooms", "extras", "resourcelist", "shop", "channex", "ical", "gaesteportal", "upsell", "direct", "api", "access", "migration"] as const;

/** Gruppen des Zahnrads (Reihenfolge und Erklärung) */
export const SETTINGS_GROUPS: { title: string; lead: string }[] = [
  { title: "Betrieb", lead: "Wer Sie sind, wer mitarbeitet, Zahlungen, Geräte, Funktionen und Abrechnung." },
  { title: "Unterkunft", lead: "Zimmer, Preise und alles, was Gäste rund um den Aufenthalt nutzen." },
  { title: "Verkauf", lead: "Wie Gäste Sie finden und buchen, auf Ihrer Website, über Portale und per Mail." },
  { title: "Gastronomie", lead: "Speisekarte, Tische und Reservierung, Online-Bestellung und Kasse." },
];

/** `hidden`: Menüpunkte ausgeschalteter Module (src/domain/modules.ts) oder nicht erlaubter Bereiche. Gruppen ohne Reiter verschwinden; hat eine Gruppe nur noch einen Reiter, bleibt sie ein einfacher Punkt. Sonst führt der Punkt zum ersten übrigen Reiter. */
export function adminNav(hotel: HotelRef, hiddenIn: ReadonlySet<string> = new Set(), opts: { area?: Area; kind?: NavKind } = {}): Nav {
  const nav = baseNav(hotel, opts.area ?? (opts.kind === "restaurant" ? "dining" : "lodging"));
  const hidden = opts.kind === "restaurant" ? new Set([...hiddenIn, ...LODGING_ONLY]) : hiddenIn;
  if (!hidden.size) return nav;
  const prune = (i: NavItem): NavItem | null => {
    if (hidden.has(i.key)) return null;
    if (!i.tabs) return i;
    const tabs: NavItem[] = i.tabs.flatMap((t) => prune(t) ?? []);
    if (!tabs.length) return null;
    if (tabs.length === 1) return { ...i, key: tabs[0].key, href: tabs[0].href, tabs: tabs[0].tabs };
    return { ...i, href: tabs[0].href, tabs };
  };
  const list = (items: NavItem[]) => items.flatMap((i) => prune(i) ?? []).map((i) => (opts.kind === "restaurant" && i.key === "site" ? { ...i, label: "Website" } : opts.kind === "restaurant" && i.key === "ki-chat" ? { ...i, group: "Verkauf" } : i)); // KI-Chat steht bei Unterkünften unter «Unterkunft», in reinen Restaurants unter «Verkauf»
  // Zahnrad: die Seite /einstellungen bleibt das Ziel, nur die Punkte darunter werden gefiltert
  return { primary: list(nav.primary), settings: { ...nav.settings, tabs: list(nav.settings.tabs ?? []) }, account: prune(nav.account) ?? nav.account };
}

function baseNav(hotel: HotelRef, area: Area): Nav {
  const base = `/admin/${hotel.id}`;
  const link = (key: string, label: string, path = key, extra: Partial<NavItem> = {}): NavItem => ({ key, label, href: `${base}/${path}`, ...extra });
  const set = (group: string, item: NavItem, lead: string): NavItem => ({ ...item, group, lead });
  // Restaurant-Baum (SPEC 20.1, Navigation Teil B): gleiche Seiten und Schlüssel, eigene vier Hauptpunkte
  const dining: NavItem[] = [
    { key: "g-dining-today", label: "Heute", href: `${base}/restaurant/heute`, icon: "home", tabs: [link("dininghome", "Tagesübersicht", "restaurant/heute"), link("inbox", "Posteingang", "inbox?bereich=restaurant")] },
    { key: "g-dining-res", label: "Reservierungen", href: `${base}/restaurant/reservierungen`, icon: "bookings", tabs: [link("reservations", "Liste", "restaurant/reservierungen"), link("resplan", "Tischplan", "restaurant/tischplan"), link("waitlist", "Warteliste", "restaurant/warteliste"), link("guestbook", "Gäste")] },
    { key: "g-dining-orders", label: "Bestellungen", href: `${base}/restaurant`, icon: "orders", tabs: [link("onlineorders", "Online", "restaurant/bestellungen"), link("restaurant", "Tische"), link("kasse", "Kasse"), link("kitchen", "Küche", "restaurant/kueche"), link("driver", "Lieferungen", "restaurant/fahrer")] },
    { key: "g-dining-finance", label: "Finanzen", href: `${base}/restaurant/abschluss`, icon: "finance", tabs: [link("posclose", "Kassenabschluss", "restaurant/abschluss"), link("onlinesales", "Online-Verkäufe", "restaurant/online-verkaeufe"), link("invoices", "Rechnungen"), link("vouchers", "Gutscheine"), link("accountingexport", "Buchhaltung", "buchhaltung")] },
  ];
  return {
    primary: area === "dining" ? dining : [
      // Heute: der laufende Tagesbetrieb
      {
        key: "g-overview", label: "Heute", href: base, icon: "home",
        tabs: [
          { key: "home", label: "Tagesliste", href: base },
          link("inbox", "Posteingang"),
          link("housekeeping", "Reinigung"),
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
          link("reports", "Berichte", "berichte"),
          link("accountingexport", "Buchhaltung", "buchhaltung"),
        ],
      },
    ],
    // Zahnrad oben rechts: Übersichtsseite mit Gruppen, am Desktop zugleich Seitenleiste
    settings: {
      key: "einstellungen", label: "Einstellungen", href: `${base}/einstellungen`,
      tabs: [
        set("Betrieb", link("settings", "Betriebsdaten"), "Name, Adresse, Zeiten, Öffnungszeiten und Kurtaxe."),
        set("Betrieb", link("funktionen", "Funktionen"), "Nur was Sie brauchen, bleibt im Menü. Dazu die Darstellung (Symbol und Name des Restaurant-Bereichs)."),
        set("Betrieb", link("team", "Team & Rollen"), "Wer Zugang hat und was jede Person sehen darf."),
        set("Betrieb", { ...link("g-devices", "Geräte", "terminal"), tabs: [link("terminal", "Kartenterminal"), link("access", "Zutritt", "zutritt")] }, "Kartenleser und Türschlösser."),
        set("Betrieb", link("payments", "Zahlungsmethoden", "zahlungen"), "Karte und TWINT über Stripe, Anzahlung, Grundgebühr und hinterlegte Karte."),
        set("Betrieb", link("report", "Abrechnung", "report", { match: [`${base}/plattform-rechnung`] }), "Monatsabrechnung, Plattformgebühren und Rechnungen von Pontivo (nur Inhaber)."),
        set("Betrieb", link("migration", "Datenübernahme"), "Buchungen und Gäste aus Ihrer bisherigen Software übernehmen."),
        set("Unterkunft", link("rooms", "Zimmer & Tarife"), "Zimmertypen, Fotos, Preise und Tarife."),
        set("Unterkunft", link("extras", "Zusatzleistungen", "rooms/extras"), "Hund, Parkplatz, Endreinigung und weitere Extras zum Zimmer."),
        set("Unterkunft", link("resourcelist", "Angebote vor Ort", "resources/angebote"), "Sauna, Seminarraum, Tennisplatz: Plätze, Zeitfenster und Preise."),
        set("Unterkunft", link("gaesteportal", "Gästeportal"), "Wünsche, Tipps, Türcode und Check-out auf der Buchungsseite des Gastes."),
        set("Unterkunft", link("upsell", "Upselling"), "Extras wie Frühstück, die Gäste online dazubuchen."),
        set("Unterkunft", link("ki-chat", "KI-Chat"), "Der digitale Assistent auf Website und Buchungsseite."),
        set("Verkauf", { ...link("g-site", "Website & Buchung", "site"), tabs: [link("site", "Website"), link("direct", "Direktbuchung", "direktbuchung"), link("api", "Schnittstelle (API)")] }, "Online-Buchung ein- und ausschalten, Texte, Fotos und Farben der Website, Werkzeuge für Direktbuchungen."),
        set("Verkauf", { ...link("g-channels", "Kanäle", "channex"), tabs: [link("channex", "Channel-Manager"), link("ical", "Kalender-Abgleich")] }, "Booking.com, Airbnb, Expedia und iCal, dazu die Provision der Portale."),
        set("Verkauf", link("shop", "Shop & Lager"), "Waren mit Preis, Minibar und Lagerbestand; aufs Zimmer buchen."),
        set("Verkauf", link("mailtexts", "Gäste-Mails", "mail-texte"), "Eigene Sätze in Bestätigung, Vor-der-Anreise- und Nachher-Mail."),
        set("Gastronomie", link("positems", "Speisekarte", "restaurant/artikel"), "Artikel mit Preisen, Optionen und Menüs, KI-Speisekarte und Import per CSV."),
        set("Gastronomie", link("tables", "Tischplan", "restaurant/tische"), "Tische anlegen, Plätze und Form festlegen, Tische im Plan platzieren, Import per CSV."),
        set("Gastronomie", link("ressettings", "Reservierung", "restaurant/einstellungen"), "Zeiten, Plätze und Regeln für die Online-Reservierung, Anzahlung und Erinnerung."),
        set("Gastronomie", link("ordersettings", "Bestellung", "restaurant/bestellung-einstellungen"), "Abholung und Lieferung, Zeiten, Liefergebiete, Barzahlung, Probebestellung und Live-Schaltung."),
        set("Gastronomie", { ...link("g-pos", "Kasse", "restaurant/geraete"), tabs: [link("posdevices", "Kassen-Geräte", "restaurant/geraete"), link("posbridge", "Kassen-Schnittstelle")] }, "Kassen-Geräte, Verbindung zum Hotel und Schnittstelle zu Ihrer bisherigen Kasse."),
      ],
    },
    // Profilbild oben rechts
    account: { ...link("konto", "Mein Konto"), tabs: [link("konto", "Profil & Sicherheit"), link("firstweek", "Erste Woche", "erste-woche"), { ...link("help", "Hilfe", "hilfe"), tabs: [link("help", "Wegweiser", "hilfe"), link("helpflows", "Abläufe", "hilfe/ablaeufe"), link("helpterms", "Fachbegriffe", "hilfe/begriffe")] }] },
  };
}

/** Alle Seiten des Menüs (die Blätter: Reiter, nie ihre Sammelpunkte), ohne externe Links */
export function allPages(nav: Nav): NavItem[] {
  return [...nav.primary, nav.settings, nav.account].flatMap(leaves).filter((i) => !i.external);
}
const leaves = (i: NavItem): NavItem[] => (i.tabs ? i.tabs.flatMap(leaves) : [i]);

/** Alle Seiten beider Bereiche (Unterkunft und Gastronomie), jede einmal: für Prüfungen «ist ein echter Menüpunkt» */
export function allPagesBoth(hotel: HotelRef, hidden: ReadonlySet<string> = new Set()): NavItem[] {
  const seen = new Set<string>();
  return [...allPages(adminNav(hotel, hidden, { area: "lodging" })), ...allPages(adminNav(hotel, hidden, { area: "dining" }))].filter((i) => !seen.has(i.key) && !!seen.add(i.key));
}

/** Schlüssel aller Blätter eines Menüs (Gruppen haben keine eigenen Seiten) */
export const leafKeys = (nav: Nav): string[] => allPages(nav).map((i) => i.key);

/** Punkte des Zahnrads nach Gruppen, in der Reihenfolge von SETTINGS_GROUPS (leere Gruppen fehlen) */
export function settingsGroups(nav: Nav): { title: string; lead: string; items: NavItem[] }[] {
  return SETTINGS_GROUPS.map((g) => ({ ...g, items: (nav.settings.tabs ?? []).filter((i) => i.group === g.title) })).filter((g) => g.items.length);
}

const matches = (pathname: string, href: string, home: string) => (href === home ? pathname === home : pathname === href || pathname.startsWith(`${href}/`));

/** Länge des genauesten passenden Ziels in diesem Punkt (samt Reitern), sonst 0 */
export function bestMatch(pathname: string, item: NavItem, home: string): number {
  const own = item.external ? 0 : Math.max(0, ...[item.href, ...(item.match ?? [])].map((h) => h.split("?")[0]).filter((h) => matches(pathname, h, home)).map((h) => h.length));
  return Math.max(own, ...(item.tabs ?? []).map((t) => bestMatch(pathname, t, home)));
}

/** Aktiv, wenn der Pfad dem Ziel (oder einem seiner Reiter) entspricht; Übersicht nur exakt */
export function isActive(pathname: string, item: NavItem, home: string): boolean {
  return bestMatch(pathname, item, home) > 0;
}

/**
 * Gehört die Seite zum Zahnrad (Übersichtsseite oder einer ihrer Punkte)? Gewinnt der genauere Treffer:
 * «Kassen-Artikel» (restaurant/artikel) liegt im Zahnrad, obwohl «Restaurant» unter Heute eine Adresse davor ist.
 */
export const inSettings = (pathname: string, nav: Nav, home: string): boolean => {
  const s = bestMatch(pathname, nav.settings, home);
  return s > 0 && s >= Math.max(0, bestMatch(pathname, nav.account, home), ...nav.primary.map((i) => bestMatch(pathname, i, home)));
};

/**
 * Aktiv im Menü oben: nur der Punkt mit dem genauesten Treffer (Hauptpunkte, Zahnrad, Konto). So leuchtet bei «restaurant/abschluss»
 * nur «Finanzen», obwohl «Bestellungen → Tische» (restaurant) eine Adresse davor liegt, und bei einer Zahnrad-Seite kein Hauptpunkt.
 */
export const isActiveIn = (pathname: string, nav: Nav, item: NavItem, home: string): boolean => {
  const own = bestMatch(pathname, item, home);
  if (!own) return false;
  return own >= Math.max(...[...nav.primary, nav.account, nav.settings].map((i) => bestMatch(pathname, i, home)));
};

/** Der Sammelpunkt, zu dem die aktuelle Seite gehört (für die Reiter über der Seite). Im Zahnrad ist es der Punkt mit Unterreitern (z. B. Website & Buchung). */
export function sectionFor(pathname: string, nav: Nav, home: string): NavItem | null {
  const own = inSettings(pathname, nav, home) ? undefined : [...nav.primary, nav.account].filter((i) => i.tabs && isActiveIn(pathname, nav, i, home))[0];
  if (own) return own;
  return (nav.settings.tabs ?? []).find((i) => i.tabs && isActive(pathname, i, home)) ?? null;
}

/** Bereich einer Seite: steht sie nur in einem Baum (genauerer Treffer), legt sie den Bereich fest; sonst null (geteilte Seite, Zahnrad, Konto) */
export function areaOfPath(pathname: string, navs: { lodging: Nav | null; dining: Nav | null }, home: string): Area | null {
  const score = (n: Nav | null) => (n ? Math.max(0, ...n.primary.map((i) => bestMatch(pathname, i, home))) : 0);
  const l = score(navs.lodging), d = score(navs.dining);
  return d > l ? "dining" : l > d ? "lodging" : null;
}

/** Bezeichnungen im Umschalter: links die Betriebsart, rechts die gewählte Gastro-Bezeichnung (feste Liste) */
export const LODGING_LABEL: Record<string, string> = { hotel: "Hotel", bnb: "B&B", apartment: "Ferienwohnung", chalet: "Chalet", group_house: "Gruppenhaus", restaurant: "Restaurant" };
export const DINING_LABELS = ["restaurant", "cafe", "bar", "beiz", "takeaway", "kitchen"] as const;
export type DiningLabel = (typeof DINING_LABELS)[number];
export const DINING_LABEL: Record<DiningLabel, { de: string; en: string; fr: string; it: string }> = {
  restaurant: { de: "Restaurant", en: "Restaurant", fr: "Restaurant", it: "Ristorante" },
  cafe: { de: "Café", en: "Café", fr: "Café", it: "Caffè" },
  bar: { de: "Bar", en: "Bar", fr: "Bar", it: "Bar" },
  beiz: { de: "Beiz", en: "Pub", fr: "Bistrot", it: "Osteria" },
  takeaway: { de: "Take-away", en: "Take-away", fr: "À l'emporter", it: "Da asporto" },
  kitchen: { de: "Küche", en: "Kitchen", fr: "Cuisine", it: "Cucina" },
};
