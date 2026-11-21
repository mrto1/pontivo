import type { Nav, NavItem } from "./nav";

/**
 * Menü der Plattform-Verwaltung (/plattform), gleicher Aufbau wie bei myPontivo: Hauptpunkte in der Kopfzeile bzw. unten am Handy,
 * Unterseiten als Reiter über der Seite. Umgruppieren = nur diese Datei und die Seiten unter app/plattform ändern.
 */
export const PLATFORM_HOME = "/plattform";

export function platformNav(): Nav {
  const link = (key: string, label: string, path: string): NavItem => ({ key, label, href: `${PLATFORM_HOME}/${path}` });
  return {
    primary: [
      { key: "pf-home", label: "Übersicht", href: PLATFORM_HOME },
      { ...link("pf-hotels", "Betriebe", "betriebe"), tabs: [link("pf-hotels", "Betriebe", "betriebe"), link("pf-users", "Benutzer", "benutzer")] },
      link("pf-sales", "Vertrieb", "vertrieb"),
      { ...link("pf-billing", "Abrechnung", "rechnungen"), tabs: [link("pf-billing", "Rechnungen", "rechnungen"), link("pf-vat", "MWST", "mwst")] },
      { ...link("pf-settings", "Plattform", "admins"), tabs: [link("pf-admins", "Plattform-Admins", "admins"), link("pf-site", "Website-Texte", "website"), link("pf-holidays", "Schulferien", "schulferien")] },
    ],
    // kein Zahnrad in der Plattform-Verwaltung (leerer Platzhalter, wird nie angezeigt)
    settings: { key: "pf-none", label: "", href: "/plattform/-", tabs: [] },
    account: { key: "pf-account", label: "Zu meinen Betrieben", href: "/admin" },
  };
}
