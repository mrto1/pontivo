/**
 * Menü des Admin-Bereichs an einer Stelle: untere Leiste (Handy) bzw. Kopfzeile (Desktop) = `primary`,
 * Rest im Fenster «Mehr» nach `groups`. Umgruppieren = nur diese Datei ändern.
 */
export type NavItem = { key: string; label: string; href: string; external?: boolean };
export type NavGroup = { title: string; items: NavItem[] };
export type Nav = { primary: NavItem[]; groups: NavGroup[] };

export function adminNav(hotel: { id: string; slug: string; primaryDomain: string | null }, setup: boolean): Nav {
  const base = `/admin/${hotel.id}`;
  const link = (key: string, label: string, path = key): NavItem => ({ key, label, href: `${base}/${path}` });
  const preview: NavItem = { key: "preview", label: "Vorschau ansehen", href: `/h/${hotel.slug}/de`, external: true };
  if (setup) {
    // Während der Einrichtung: schlank
    return {
      primary: [link("einrichten", "Einrichten"), link("rooms", "Zimmer"), link("site", "Website"), link("settings", "Einstellungen")],
      groups: [{ title: "Anderes", items: [preview] }],
    };
  }
  return {
    primary: [{ key: "home", label: "Übersicht", href: base }, link("calendar", "Kalender"), link("bookings", "Buchungen"), link("guests", "Gäste")],
    groups: [
      { title: "Betrieb", items: [link("inquiries", "Anfragen"), link("vouchers", "Gutscheine"), link("report", "Abrechnung")] },
      { title: "Angebot", items: [link("rooms", "Zimmer"), link("site", "Website")] },
      { title: "Verbinden", items: [link("channex", "Channel-Manager"), link("embed", "Einbinden")] },
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

/** Aktiv, wenn der Pfad dem Ziel entspricht (Übersicht nur exakt) */
export function isActive(pathname: string, item: NavItem, home: string): boolean {
  if (item.external) return false;
  return item.href === home ? pathname === home : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
