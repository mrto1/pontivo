import { adminNav, leafKeys, type Area, type Nav, type NavItem, type NavKind } from "./nav";

const leafKeysOf = (i: NavItem): string[] => (i.tabs ? i.tabs.flatMap(leafKeysOf) : [i.key]);
import { areasOf, atLeast, isLimitedRole, seesDay, type Role } from "../domain/roles";

/**
 * Menü, wie eine Person es sieht (SPEC 19.42, 20.1): ausgeschaltete Module und nicht erlaubte Bereiche fallen weg.
 * - Eingeschränkte Rollen sehen nur ihre Seiten. «Tag» sehen sie nur mit dem Bereich «tag»; sonst leitet die Seite auf ihre Seite um und es bleibt kein toter Reiter.
 * - «Abo & Gebühren» sieht nur der Inhaber.
 * - Das Zahnrad (`showSettings`) gibt es nur für Inhaber und Manager.
 * - Zwei Bereiche: reines Restaurant nur Gastronomie; Unterkunft mit Modul «restaurant» beide (Umschalter, wenn die Person in beiden einen Hauptpunkt sieht).
 */
export type VisibleNav = { nav: Nav; navs: { lodging: Nav | null; dining: Nav | null }; kind: NavKind; showSettings: boolean; showSwitch: boolean };

export function visibleNav(hotel: { id: string; slug: string; primaryDomain: string | null; propertyType?: string }, role: Role, moduleHidden: ReadonlySet<string>, area: Area = "lodging"): VisibleNav {
  const kind: NavKind = hotel.propertyType === "restaurant" ? "restaurant" : "hotel";
  const hidden = new Set(moduleHidden);
  if (isLimitedRole(role)) {
    const keys = new Set([...leafKeys(adminNav(hotel, new Set(), { area: "lodging" })), ...leafKeys(adminNav(hotel, new Set(), { area: "dining" }))]);
    for (const k of keys) if (k !== "home" && !areasOf(role).includes(k)) hidden.add(k);
    if (!seesDay(role)) hidden.add("home");
  }
  if (role !== "owner") hidden.add("report");
  const diningOn = !moduleHidden.has("dininghome");
  const lodgingNav = kind === "hotel" ? adminNav(hotel, hidden, { area: "lodging", kind }) : null;
  const diningNav = kind === "restaurant" || diningOn ? adminNav(hotel, hidden, { area: "dining", kind }) : null;
  // Ein Bereich zählt nur, wenn die Person dort eine eigene Seite sieht (geteilte wie Posteingang, Rechnungen, Gutscheine zählen nicht)
  const own = (n: Nav | null, other: Nav | null) => {
    if (!n) return false;
    const shared = new Set(other ? n.primary.flatMap(leafKeysOf).filter((k) => other.primary.flatMap(leafKeysOf).includes(k)) : []);
    return n.primary.flatMap(leafKeysOf).some((k) => !shared.has(k));
  };
  const fullL = kind === "hotel" ? adminNav(hotel, new Set(), { area: "lodging" }) : null, fullD = adminNav(hotel, new Set(), { area: "dining" });
  const lodging = own(lodgingNav, fullD) ? lodgingNav : kind === "hotel" && !diningNav ? lodgingNav : null;
  const dining = own(diningNav, fullL) ? diningNav : kind === "restaurant" ? diningNav : null;
  const showSwitch = !!lodging?.primary.length && !!dining?.primary.length;
  // Eine Person, die nur einen Bereich sieht, bleibt dort (z. B. Service im Restaurant)
  const current: Area = !lodging?.primary.length && dining ? "dining" : !dining?.primary.length ? "lodging" : area;
  const nav = (current === "dining" ? dining : lodging) ?? dining ?? lodging ?? lodgingNav ?? diningNav!;
  return { nav, navs: { lodging, dining }, kind, showSettings: !isLimitedRole(role) && atLeast(role, "manager"), showSwitch };
}
