"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { inSettings, isActive, settingsGroups, type Nav } from "@/src/admin/nav";

/**
 * Rahmen für die Seiten des Zahnrads: am Desktop links die Seitenleiste mit den drei Gruppen, am Handy ein Link zurück zur Übersicht.
 * Alle anderen Seiten bleiben unverändert (nur `tabs` und `children`). Unterreiter (`tabs`) stehen über der Seite.
 */
export function SettingsFrame({ nav, home, tabs, children }: { nav: Nav; home: string; tabs: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  if (!inSettings(pathname, nav, home)) return <>{tabs}{children}</>;
  const onOverview = pathname === nav.settings.href;
  return (
    <div className="settings-frame">
      <aside className="settings-side" aria-label="Einstellungen">
        <a href={nav.settings.href} className={onOverview ? "active" : undefined}>Übersicht</a>
        {settingsGroups(nav).map((g) => (
          <div key={g.title}>
            <h3>{g.title}</h3>
            {g.items.map((i) => <a key={i.key} href={i.href} className={isActive(pathname, i, home) && !onOverview ? "active" : undefined} aria-current={isActive(pathname, i, home) && !onOverview ? "page" : undefined}>{i.label}</a>)}
          </div>
        ))}
      </aside>
      <div style={{ minWidth: 0 }}>
        {onOverview ? null : <a className="settings-back small" href={nav.settings.href}>‹ Einstellungen</a>}
        {tabs}
        {children}
      </div>
    </div>
  );
}
