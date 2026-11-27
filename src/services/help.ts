import type { Hotel } from "../db/schema";
import { allPages } from "../admin/nav";
import { visibleNav } from "../admin/visible-nav";
import { hiddenNavKeys, isOn, MODULES, modulesForKind, type ModuleRow } from "../domain/modules";
import { isLimitedRole, type Role } from "../domain/roles";
import { termScope, type Scope, type Term } from "../domain/help-content";
import { isRestaurant, isWholeUnit } from "./onboarding";
import { moduleRows } from "./modules";

/**
 * Was die Hilfe für diesen Betrieb und diese Person zeigt (SPEC 19.65):
 * - `pages`/`allowed`: Menüpunkte, die der Betrieb hat (eingeschaltete Funktionen) und die Person sehen darf
 * - `lodging`/`dining`: Betrieb mit Zimmern bzw. mit eingeschalteter Gastronomie
 * - `moduleOf(area)`: zu welcher Funktion ein Menüpunkt gehört; `more`: Funktionen, die zur Betriebsart passen, aber aus sind
 */
export type HelpContext = Awaited<ReturnType<typeof helpContext>>;

export async function helpContext(hotel: Hotel, role: Role, rowsIn?: ModuleRow[]) {
  const rows = rowsIn ?? (await moduleRows(hotel.id));
  // dieselben Menüs wie in der Navigation: je Bereich (Unterkunft, Gastronomie) und schon nach Rolle gefiltert
  const { navs } = visibleNav(hotel, role, hiddenNavKeys(rows));
  const pages = new Map([navs.lodging, navs.dining].flatMap((n) => (n ? allPages(n) : [])).map((p) => [p.key, p.href]));
  const lodging = !isRestaurant(hotel.propertyType);
  const dining = isOn(rows, "restaurant");
  const relevant = modulesForKind({ restaurantOnly: !lodging, wholeUnit: isWholeUnit(hotel.propertyType) });
  const more = MODULES.filter((m) => relevant.includes(m.key) && !isOn(rows, m.key));
  const moduleOf = (area: string) => MODULES.find((m) => m.navKeys.includes(area)) ?? null;
  const allowed = (area: string) => pages.has(area);
  /** Bereich passt zum Betrieb (Unterkunft/Gastronomie) */
  const inScope = (s: Scope) => s === "all" || (s === "both" ? lodging && dining : s === "lodging" ? lodging : dining);
  /** Gehört der Menüpunkt zu einer Funktion, die zum Betrieb passt, aber aus ist? Dann diese Funktion. */
  const offModule = (area: string) => {
    const m = moduleOf(area);
    return m && !isOn(rows, m.key) && relevant.includes(m.key) ? m : null;
  };
  /** Begriff gilt im Betrieb: Bereich passt, und die Seite (falls angegeben) ist da */
  const termShown = (t: Term) => inScope(termScope(t)) && (!t.area || pages.has(t.area) || !moduleOf(t.area));
  /** Begriff gehört zu einer weiteren Funktion (aus, aber passend) */
  const termMore = (t: Term) => !termShown(t) && !!t.area && !!offModule(t.area);
  return { rows, pages, lodging, dining, relevant, more, moduleOf, allowed, inScope, offModule, termShown, termMore, limited: isLimitedRole(role) };
}

/** Erster Satz einer Beschreibung (für kurze Listen); Abkürzungen wie «z. B.», «inkl.» beenden keinen Satz */
const ABBR = /(^|\s)(\p{L}|z|bzw|inkl|ca|evtl|Nr|max|min|vgl|usw|etc|ggf|resp|Std|Min|Tel|CHF)$/u;
export function firstSentence(t: string): string {
  const re = /[.!?](?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m[0] === "." && ABBR.test(t.slice(0, m.index))) continue;
    return t.slice(0, m.index + 1).trim();
  }
  return t.trim();
}
