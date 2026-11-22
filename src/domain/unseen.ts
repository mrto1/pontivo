/**
 * Zahlen für Ungesehenes (SPEC 20.1): je Person und Liste. Reine Logik: welche Art zu welchem Bereich und Menüpunkt gehört.
 * Eine Art zählt nur, wenn die Seite im Menü der Person steht (Rolle und Module), sonst verrät die Zahl etwas, wohin sie keinen Zugang hat.
 */
import type { Area, Nav, NavItem } from "../admin/nav";

/** Anfragearten, die im Restaurant-Posteingang landen (nur wenn der Betrieb auch das Restaurant führt); alle übrigen bleiben im Posteingang der Unterkunft */
export const DINING_INQUIRY_KINDS = ["table"] as const;
export const isDiningInquiry = (kind: string): boolean => (DINING_INQUIRY_KINDS as readonly string[]).includes(kind);

export type SeenKind = "inbox" | "dininginbox" | "bookings" | "reservations" | "orders";
export const SEEN_KINDS: Record<SeenKind, { area: Area; page: string }> = {
  inbox: { area: "lodging", page: "inbox" },
  dininginbox: { area: "dining", page: "inbox" },
  bookings: { area: "lodging", page: "bookings" },
  reservations: { area: "dining", page: "reservations" },
  orders: { area: "dining", page: "onlineorders" },
};
export const isSeenKind = (k: string): k is SeenKind => k in SEEN_KINDS;

const hasKey = (i: NavItem, key: string): boolean => i.key === key || (i.tabs ?? []).some((t) => hasKey(t, key));

/** Hauptpunkt, unter dem eine Seite steht (null: Seite nicht im Menü dieser Person) */
export function itemKeyForPage(page: string, nav: Nav | null): string | null {
  if (!nav) return null;
  return nav.primary.find((i) => hasKey(i, page))?.key ?? null;
}
export const itemKeyFor = (kind: SeenKind, nav: Nav | null): string | null => itemKeyForPage(SEEN_KINDS[kind].page, nav);

/**
 * Offene Aufgaben (SPEC 20.1): eine gemeinsame Zahl je Betrieb, nicht je Person. Sie bleibt, bis die Aufgabe erledigt ist, auch wenn jemand die Liste schon gesehen hat.
 * Arten: `inbox` (offene Anfragen und Gästewünsche), `orders` (Online-Bestellungen, die auf Annahme warten), `overdue` (überfällige Rechnungen).
 */
export type TaskKind = "inbox" | "dininginbox" | "orders" | "overdue";
export const TASK_KINDS: Record<TaskKind, { area: Area; page: string }> = {
  inbox: { area: "lodging", page: "inbox" },
  dininginbox: { area: "dining", page: "inbox" },
  orders: { area: "dining", page: "onlineorders" },
  overdue: { area: "lodging", page: "debtors" },
};

/** Zahl am Menüpunkt: neu (nur für diese Person) und offen (für das ganze Team) */
export type Badge = { fresh: number; open: number };
export type Badges = { byItem: Record<string, Badge>; byArea: Record<Area, Badge> };
const none = (): Badge => ({ fresh: 0, open: 0 });

/** Zahlen je Menüpunkt und je Bereich aus den Zählungen; was die Person nicht sieht, zählt nicht */
export function badgesFor(fresh: Partial<Record<SeenKind, number>>, open: Partial<Record<TaskKind, number>>, navs: { lodging: Nav | null; dining: Nav | null }): Badges {
  const out: Badges = { byItem: {}, byArea: { lodging: none(), dining: none() } };
  const add = (area: Area, page: string, field: keyof Badge, n: number) => {
    const key = n > 0 ? itemKeyForPage(page, navs[area]) : null;
    if (!key) return;
    out.byItem[key] = out.byItem[key] ?? none();
    out.byItem[key][field] += n;
    out.byArea[area][field] += n;
  };
  for (const k of Object.keys(SEEN_KINDS) as SeenKind[]) add(SEEN_KINDS[k].area, SEEN_KINDS[k].page, "fresh", fresh[k] ?? 0);
  for (const k of Object.keys(TASK_KINDS) as TaskKind[]) add(TASK_KINDS[k].area, TASK_KINDS[k].page, "open", open[k] ?? 0);
  return out;
}

/** Anzeige: «neu» (nur diese Person) hat Vorrang vor «offen» (Team). 0 erscheint nicht, ab 100 «99+». */
export function badgeView(b: Badge | undefined): { n: number; tone: "fresh" | "open"; label: string } | null {
  if (!b) return null;
  if (b.fresh > 0) return { n: b.fresh, tone: "fresh", label: b.open > b.fresh ? `${b.fresh} neu, ${b.open} offen` : `${b.fresh} neu` };
  if (b.open > 0) return { n: b.open, tone: "open", label: `${b.open} offen` };
  return null;
}

/** Anzeige: ab 100 «99+» */
export const badgeText = (n: number): string => (n > 99 ? "99+" : String(n));
