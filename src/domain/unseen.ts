/**
 * Zahlen für Ungesehenes (SPEC 20.1): je Person und Liste. Reine Logik: welche Art zu welchem Bereich und Menüpunkt gehört.
 * Eine Art zählt nur, wenn die Seite im Menü der Person steht (Rolle und Module), sonst verrät die Zahl etwas, wohin sie keinen Zugang hat.
 */
import type { Area, Nav, NavItem } from "../admin/nav";

export type SeenKind = "inbox" | "bookings" | "reservations" | "orders";
export const SEEN_KINDS: Record<SeenKind, { area: Area; page: string }> = {
  inbox: { area: "lodging", page: "inbox" },
  bookings: { area: "lodging", page: "bookings" },
  reservations: { area: "dining", page: "reservations" },
  orders: { area: "dining", page: "onlineorders" },
};
export const isSeenKind = (k: string): k is SeenKind => k in SEEN_KINDS;

const hasKey = (i: NavItem, key: string): boolean => i.key === key || (i.tabs ?? []).some((t) => hasKey(t, key));

/** Hauptpunkt, unter dem die Liste steht (null: Seite nicht im Menü dieser Person) */
export function itemKeyFor(kind: SeenKind, nav: Nav | null): string | null {
  if (!nav) return null;
  return nav.primary.find((i) => hasKey(i, SEEN_KINDS[kind].page))?.key ?? null;
}

export type Badges = { byItem: Record<string, number>; byArea: Record<Area, number> };

/** Zahlen je Menüpunkt und je Bereich aus den Zählungen; 0 erscheint nicht */
export function badgesFor(counts: Partial<Record<SeenKind, number>>, navs: { lodging: Nav | null; dining: Nav | null }): Badges {
  const out: Badges = { byItem: {}, byArea: { lodging: 0, dining: 0 } };
  for (const k of Object.keys(SEEN_KINDS) as SeenKind[]) {
    const n = counts[k] ?? 0;
    const key = n > 0 ? itemKeyFor(k, navs[SEEN_KINDS[k].area]) : null;
    if (!key) continue;
    out.byItem[key] = (out.byItem[key] ?? 0) + n;
    out.byArea[SEEN_KINDS[k].area] += n;
  }
  return out;
}

/** Anzeige: ab 100 «99+» */
export const badgeText = (n: number): string => (n > 99 ? "99+" : String(n));
