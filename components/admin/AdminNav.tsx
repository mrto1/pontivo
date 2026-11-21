"use client";
import { usePathname } from "next/navigation";
import { isActive, type Nav, type NavItem } from "@/src/admin/nav";

/**
 * Menü: Desktop = vier Hauptpunkte in der Kopfzeile, Handy = feste Leiste unten (höchstens 4 Punkte, alles Weitere sind Reiter). Menüinhalt kommt aus src/admin/nav.ts.
 * Oben rechts: Zahnrad (Einstellungen des Betriebs, nur Inhaber und Manager) und Profilbild (führt direkt zu «Mein Konto»).
 */
/** Symbole der unteren Leiste (Handy); unbekannte Punkte bekommen einen neutralen Kreis */
const TAB_ICONS: Record<string, string> = {
  home: "M4 11l8-7 8 7 M6 10v10h12V10 M10 20v-5h4v5",
  calendar: "M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4",
  pricing: "M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-6",
  bookings: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6",
  frontdesk: "M3 18V7 M3 14h18v4 M21 14v-2a3 3 0 00-3-3h-7v5",
  guests: "M9 11a3 3 0 100-6 3 3 0 000 6z M3 20a6 6 0 0112 0 M17 8a3 3 0 010 6 M21 20a5 5 0 00-4-4.9",
  guestbook: "M9 11a3 3 0 100-6 3 3 0 000 6z M3 20a6 6 0 0112 0 M17 8a3 3 0 010 6 M21 20a5 5 0 00-4-4.9",
  finance: "M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-6",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6z M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 005 12a7 7 0 00.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 002 1.2l.4 2.7h4l.4-2.7a7 7 0 002-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  "pf-home": "M4 11l8-7 8 7 M6 10v10h12V10 M10 20v-5h4v5",
  "pf-hotels": "M4 20V6l8-3 8 3v14 M9 20v-5h6v5 M8 9h.01 M12 9h.01 M16 9h.01",
  "pf-sales": "M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-6",
  "pf-billing": "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6",
  "pf-settings": "M12 15a3 3 0 100-6 3 3 0 000 6z M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 005 12a7 7 0 00.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 002 1.2l.4 2.7h4l.4-2.7a7 7 0 002-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z",
};
function TabIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={TAB_ICONS[name] ?? "M12 4a8 8 0 100 16 8 8 0 000-16z"} />
    </svg>
  );
}

export function AdminNav({ nav, home, userLabel, initials, showSettings }: { nav: Nav; home: string; userLabel: string; initials: string; showSettings: boolean }) {
  const pathname = usePathname();
  const myActive = isActive(pathname, nav.account, home);
  const gearActive = showSettings && isActive(pathname, nav.settings, home);
  const a = (i: NavItem) => (isActive(pathname, i, home) ? "active" : undefined);

  return (
    <>
      <nav className="admin-nav" aria-label="Hauptmenü">
        {nav.primary.map((i) => <a key={i.key} href={i.href} className={a(i)} aria-current={isActive(pathname, i, home) ? "page" : undefined}>{i.label}</a>)}
      </nav>
      <div className="head-tools">
        {showSettings ? (
          <a href={nav.settings.href} className={`gear-link${gearActive ? " active" : ""}`} aria-current={gearActive ? "page" : undefined} aria-label="Einstellungen" title="Einstellungen">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={TAB_ICONS.gear} /></svg>
          </a>
        ) : null}
        {/* Profilbild: direkt die Seite «Mein Konto» (Reiter: Profil & Sicherheit, Erste Woche, Hilfe; dort auch Abmelden) */}
        <a href={nav.account.href} className={`avatar-link${myActive ? " active" : ""}`} aria-label={`${nav.account.label} (${userLabel})`} aria-current={myActive ? "page" : undefined} title={userLabel}>{initials}</a>
      </div>

      <nav className="tabbar" aria-label="Hauptmenü">
        {nav.primary.map((i) => <a key={i.key} href={i.href} className={a(i)} aria-current={isActive(pathname, i, home) ? "page" : undefined}><TabIcon name={i.icon ?? i.key} /><span>{i.label}</span></a>)}
      </nav>
    </>
  );
}
