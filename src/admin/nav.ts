/**
 * Menü des Admin-Bereichs an einer Stelle.
 * - `primary`: untere Leiste (Handy) bzw. Kopfzeile (Desktop). Es gibt kein «Mehr»: alles Weitere liegt als Reiter unter «Mein Betrieb».
 * - `tabs`: Unterseiten eines Menüpunkts. Sie erscheinen als Reiter über der Seite, im Menü steht nur der Sammelpunkt.
 *   Reiter können selbst Reiter haben (zweite Reihe).
 * - `account`: «Mein Konto» hinter dem Profilbild, mit eigenen Reitern.
 * Umgruppieren = nur diese Datei ändern.
 */
export type NavItem = { key: string; label: string; href: string; external?: boolean; tabs?: NavItem[]; };
export type Nav = { primary: NavItem[]; account: NavItem };

/** `hidden`: Menüpunkte ausgeschalteter Module (src/domain/modules.ts). Hat ein Sammelpunkt nur noch einen Reiter, bleibt er ein einfacher Punkt. */
export function adminNav(hotel: { id: string; slug: string; primaryDomain: string | null }, hidden: ReadonlySet<string> = new Set()): Nav {
  const nav = baseNav(hotel);
  if (!hidden.size) return nav;
  const prune = (i: NavItem): NavItem | null => {
    if (hidden.has(i.key)) return null;
    if (!i.tabs) return i;
    const tabs: NavItem[] = i.tabs.flatMap((t) => prune(t) ?? []);
    if (!tabs.length) return null;
    if (tabs.length === 1) return { ...i, key: tabs[0].key, href: tabs[0].href, tabs: tabs[0].tabs };
    return { ...i, tabs };
  };
  const list = (items: NavItem[]) => items.flatMap((i) => prune(i) ?? []);
  return { primary: list(nav.primary), account: prune(nav.account) ?? nav.account };
}

function baseNav(hotel: { id: string; slug: string; primaryDomain: string | null }): Nav {
  const base = `/mypontivo/${hotel.id}`;
  const link = (key: string, label: string, path = key): NavItem => ({ key, label, href: `${base}/${path}` });
  return {
    primary: [
      // Mein Betrieb (erster Reiter «Übersicht»): Stand der Einrichtung und alles, was den Betrieb selbst betrifft
      {
        ...{ key: "home", label: "Mein Betrieb", href: base },
        tabs: [
          { key: "home", label: "Übersicht", href: base },
          link("rooms", "Zimmer und Tarife"),
          { ...link("site", "Website und Buchung"), tabs: [link("site", "Website und Buchung"), link("direct", "Direktbuchung", "direktbuchung"), link("api", "Schnittstelle (API)")] },
          link("team", "Team"),
          { ...link("settings", "Einstellungen"), tabs: [link("settings", "Betrieb"), link("funktionen", "Funktionen"), link("terminal", "Kartenterminal"), link("access", "Zutritt", "zutritt")] },
          { ...link("statistics", "Statistik"), tabs: [link("statistics", "Statistik"), link("hesta", "HESTA", "statistics/hesta")] },
          link("accountingexport", "Buchhaltung", "buchhaltung"),
          { ...link("restaurant", "Restaurant"), tabs: [link("restaurant", "Tische"), link("kasse", "Kasse (offline-fähig)"), link("positems", "Artikel", "restaurant/artikel"), link("posclose", "Kassenabschluss", "restaurant/abschluss"), link("posbridge", "Kassen-Schnittstelle")] },
        ],
      },
      // Zeitraster je Zimmertyp: Preise, Verfügbarkeit, Sperren, Abgleich mit den Portalen
      { ...link("calendar", "Kalender"), tabs: [link("calendar", "Preise & Verfügbarkeit"), link("plan", "Zimmerplan"), link("pricing", "Preisempfehlung", "preise"), link("channex", "Channel-Manager"), link("ical", "Kalender-Abgleich")] },
      // Vorgänge: Gast, Zahlung, Storno, Rechnung
      { ...link("bookings", "Buchungen"), tabs: [link("bookings", "Buchungen"), link("frontdesk", "Heute"), link("housekeeping", "Reinigung"), link("groups", "Gruppen"), link("resources", "Angebote vor Ort"), link("invoices", "Rechnungen"), link("dayclose", "Tagesabschluss", "invoices/tagesabschluss"), link("debtors", "Debitoren", "invoices/debitoren"), link("report", "Plattformgebühren"), link("owners", "Eigentümer")] },
      { ...link("guests", "Gäste"), tabs: [link("guests", "Online-Check-in"), link("guestbook", "Kartei"), link("inbox", "Posteingang"), link("marketing", "Newsletter"), link("vouchers", "Gutscheine"), link("feedback", "Bewertungen"), link("ki-chat", "KI-Chat"), link("upsell", "Upselling"), link("mailtexts", "Mail-Texte", "mail-texte")] },
    ],
    // Profilbild oben rechts
    account: { ...link("mypontivo", "Mein Konto"), tabs: [link("mypontivo", "Profil & Sicherheit"), link("migration", "Datenübernahme"), link("firstweek", "Erste Woche", "erste-woche"), { ...link("help", "Hilfe", "hilfe"), tabs: [link("help", "Wegweiser", "hilfe"), link("helpflows", "Abläufe", "hilfe/ablaeufe"), link("helpterms", "Fachbegriffe", "hilfe/begriffe")] }] },
  };
}

/** Alle Seiten des Menüs (die Blätter: Reiter, nie ihre Sammelpunkte), ohne externe Links */
export function allPages(nav: Nav): NavItem[] {
  const leaves = (i: NavItem): NavItem[] => (i.tabs ? i.tabs.flatMap(leaves) : [i]);
  return [...nav.primary, nav.account].flatMap(leaves).filter((i) => !i.external);
}

const matches = (pathname: string, href: string, home: string) => (href === home ? pathname === home : pathname === href || pathname.startsWith(`${href}/`));

/** Länge des genauesten passenden Ziels in diesem Punkt (samt Reitern), sonst 0 */
export function bestMatch(pathname: string, item: NavItem, home: string): number {
  const own = !item.external && matches(pathname, item.href, home) ? item.href.length : 0;
  return Math.max(own, ...(item.tabs ?? []).map((t) => bestMatch(pathname, t, home)));
}

/** Aktiv, wenn der Pfad dem Ziel (oder einem seiner Reiter) entspricht; Übersicht nur exakt */
export function isActive(pathname: string, item: NavItem, home: string): boolean {
  return bestMatch(pathname, item, home) > 0;
}

/** Der Sammelpunkt, zu dem die aktuelle Seite gehört (für die Reiter über der Seite) */
export function sectionFor(pathname: string, nav: Nav, home: string): NavItem | null {
  return [...nav.primary, nav.account].find((i) => i.tabs && isActive(pathname, i, home)) ?? null;
}
