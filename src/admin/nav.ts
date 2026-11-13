/**
 * Menü des Admin-Bereichs an einer Stelle.
 * - `primary`: untere Leiste (Handy) bzw. Kopfzeile (Desktop)
 * - `groups`: Inhalt des Fensters «Mehr»
 * - `tabs`: Unterseiten eines Menüpunkts. Sie erscheinen als Reiter über der Seite, im Menü steht nur der Sammelpunkt.
 * Umgruppieren = nur diese Datei ändern.
 */
export type NavItem = { key: string; label: string; href: string; external?: boolean; tabs?: NavItem[] };
export type NavGroup = { title: string; items: NavItem[] };
export type Nav = { primary: NavItem[]; groups: NavGroup[] };

export function adminNav(hotel: { id: string; slug: string; primaryDomain: string | null }, setup: boolean): Nav {
  const base = `/admin/${hotel.id}`;
  const link = (key: string, label: string, path = key): NavItem => ({ key, label, href: `${base}/${path}` });
  if (setup) {
    // Während der Einrichtung: schlank
    return {
      primary: [link("einrichten", "Einrichten"), link("rooms", "Zimmer"), link("site", "Website"), link("settings", "Einstellungen")],
      groups: [{ title: "Anderes", items: [{ key: "preview", label: "Vorschau ansehen", href: `/h/${hotel.slug}/de`, external: true }] }],
    };
  }
  return {
    primary: [
      { key: "home", label: "Übersicht", href: base },
      link("calendar", "Kalender"),
      link("bookings", "Buchungen"),
      { ...link("guests", "Gäste"), tabs: [link("guests", "Gäste"), link("inquiries", "Anfragen"), link("vouchers", "Gutscheine")] },
    ],
    groups: [
      {
        title: "Mein Betrieb",
        items: [{ ...link("rooms", "Angebot"), tabs: [link("rooms", "Zimmer"), link("site", "Website")] }, link("ki-chat", "KI-Chat"), link("report", "Abrechnung")],
      },
      { title: "Verbinden", items: [{ ...link("channex", "Vertrieb"), tabs: [link("channex", "Channel-Manager"), link("embed", "Einbinden")] }] },
      {
        title: "Konto",
        items: [
          link("settings", "Einstellungen"),
          { key: "view", label: "Website ansehen", href: hotel.primaryDomain ? `//${hotel.primaryDomain}` : `/h/${hotel.slug}/de`, external: true },
        ],
      },
    ],
  };
}

/** Alle Seiten des Menüs (Sammelpunkte und ihre Reiter), ohne externe Links */
export function allPages(nav: Nav): NavItem[] {
  return [...nav.primary, ...nav.groups.flatMap((g) => g.items)].flatMap((i) => (i.tabs ? i.tabs : [i])).filter((i) => !i.external);
}

const matches = (pathname: string, href: string, home: string) => (href === home ? pathname === home : pathname === href || pathname.startsWith(`${href}/`));

/** Aktiv, wenn der Pfad dem Ziel (oder einem seiner Reiter) entspricht; Übersicht nur exakt */
export function isActive(pathname: string, item: NavItem, home: string): boolean {
  if (item.external) return false;
  return matches(pathname, item.href, home) || !!item.tabs?.some((t) => matches(pathname, t.href, home));
}

/** Der Sammelpunkt, zu dem die aktuelle Seite gehört (für die Reiter über der Seite) */
export function sectionFor(pathname: string, nav: Nav, home: string): NavItem | null {
  const all = [...nav.primary, ...nav.groups.flatMap((g) => g.items)];
  return all.find((i) => i.tabs && i.tabs.some((t) => matches(pathname, t.href, home))) ?? null;
}
