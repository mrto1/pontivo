import { adminNav, leafKeys, type Nav } from "./nav";
import { areasOf, atLeast, isLimitedRole, type Role } from "../domain/roles";

/**
 * Menü, wie eine Person es sieht (SPEC 19.42): ausgeschaltete Module und nicht erlaubte Bereiche fallen weg.
 * - Eingeschränkte Rollen sehen nur ihre Seiten. «Tag» fällt für sie weg (die Seite leitet auf ihre Seite um), damit kein toter Reiter bleibt.
 * - «Abo & Gebühren» sieht nur der Inhaber.
 * - Das Zahnrad (`showSettings`) gibt es nur für Inhaber und Manager.
 */
export function visibleNav(hotel: { id: string; slug: string; primaryDomain: string | null }, role: Role, moduleHidden: ReadonlySet<string>): { nav: Nav; showSettings: boolean } {
  const hidden = new Set(moduleHidden);
  if (isLimitedRole(role)) {
    for (const k of leafKeys(adminNav(hotel))) if (!areasOf(role).includes(k)) hidden.add(k);
    hidden.add("home");
  }
  if (role !== "owner") hidden.add("report");
  return { nav: adminNav(hotel, hidden), showSettings: !isLimitedRole(role) && atLeast(role, "manager") };
}
