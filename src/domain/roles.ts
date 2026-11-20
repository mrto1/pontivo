/**
 * Rollen (SPEC 17.4). Owner/Manager/Staff sind abgestuft (wie bisher). Eingeschränkte Rollen sehen nur ausdrücklich
 * freigegebene Bereiche und sind überall sonst ausgesperrt (sicher als Standard: eine Seite ohne Bereichsangabe ist für sie 404).
 */
export type FullRole = "owner" | "manager" | "staff";
export type LimitedRole = "reception" | "housekeeping" | "accounting" | "service";
/** Eigene Rolle eines Betriebs, so aufgelöst: `custom:<Name URL-kodiert>:<Bereiche mit Komma>` (Auflösung in src/auth/session.ts, in der DB steht `custom:<id>`) */
export type CustomRole = `custom:${string}`;
export type Role = FullRole | LimitedRole | CustomRole;

export const ROLE_LABEL: Record<FullRole | LimitedRole, string> = {
  owner: "Inhaber", manager: "Manager", staff: "Mitarbeitende", reception: "Rezeption", housekeeping: "Reinigung", accounting: "Buchhaltung", service: "Service (Restaurant)",
};

/** Bereiche = Schlüssel der Menüpunkte (src/admin/nav.ts) plus «layout» (Rahmen) und «home» (leitet weiter) */
export const ROLE_AREAS: Record<LimitedRole, readonly string[]> = {
  reception: ["layout", "home", "mypontivo", "firstweek", "help", "helpflows", "helpterms", "calendar", "bookings", "frontdesk", "plan", "housekeeping", "resources", "guests", "guestbook", "inbox", "vouchers", "invoices", "dayclose", "groups"],
  housekeeping: ["layout", "home", "mypontivo", "firstweek", "help", "helpflows", "helpterms", "housekeeping"],
  accounting: ["layout", "home", "mypontivo", "firstweek", "help", "helpflows", "helpterms", "invoices", "dayclose", "debtors", "owners", "statistics", "hesta", "accountingexport"],
  service: ["layout", "home", "mypontivo", "firstweek", "help", "helpflows", "helpterms", "restaurant", "kasse"],
};

/** Immer dabei, damit eine eigene Rolle sich anmelden und ihr Konto sehen kann */
export const BASE_AREAS = ["layout", "home", "mypontivo", "firstweek", "help", "helpflows", "helpterms"] as const;

/** Seiten, die in einer eigenen Rolle angehakt werden können (nur Seiten, die schon für «Mitarbeitende» offen sind) */
export const CONFIGURABLE_AREAS: { key: string; label: string; group: string }[] = [
  { group: "Kalender", key: "calendar", label: "Preise & Verfügbarkeit (ansehen)" },
  { group: "Kalender", key: "plan", label: "Zimmerplan" },
  { group: "Buchungen", key: "bookings", label: "Buchungen" },
  { group: "Buchungen", key: "frontdesk", label: "Heute (Anreisen, Abreisen)" },
  { group: "Buchungen", key: "housekeeping", label: "Reinigung" },
  { group: "Buchungen", key: "groups", label: "Gruppen" },
  { group: "Buchungen", key: "resources", label: "Angebote vor Ort" },
  { group: "Buchungen", key: "invoices", label: "Rechnungen" },
  { group: "Buchungen", key: "dayclose", label: "Tagesabschluss" },
  { group: "Buchungen", key: "debtors", label: "Debitoren" },
  { group: "Buchungen", key: "owners", label: "Eigentümer" },
  { group: "Gäste", key: "guests", label: "Check-in" },
  { group: "Gäste", key: "guestbook", label: "Kartei" },
  { group: "Gäste", key: "inbox", label: "Posteingang" },
  { group: "Gäste", key: "vouchers", label: "Gutscheine" },
  { group: "Gäste", key: "feedback", label: "Bewertungen" },
  { group: "Mein Betrieb", key: "statistics", label: "Statistik" },
  { group: "Mein Betrieb", key: "hesta", label: "HESTA" },
  { group: "Mein Betrieb", key: "accountingexport", label: "Buchhaltung" },
  { group: "Mein Betrieb", key: "restaurant", label: "Restaurant (Tische)" },
  { group: "Mein Betrieb", key: "kasse", label: "Kasse" },
];

export const encodeCustomRole = (name: string, areas: readonly string[]): CustomRole =>
  `custom:${encodeURIComponent(name)}:${[...new Set([...BASE_AREAS, ...areas])].join(",")}`;
export const isCustomRole = (r: string | null): r is CustomRole => typeof r === "string" && r.startsWith("custom:") && r.split(":").length === 3;
const parseCustom = (r: CustomRole) => { const [, name, areas] = r.split(":"); return { name: decodeURIComponent(name), areas: areas.split(",").filter(Boolean) }; };

export const isLimitedRole = (r: Role | null): r is LimitedRole | CustomRole => r === "reception" || r === "housekeeping" || r === "accounting" || r === "service" || isCustomRole(r);
export const areasOf = (r: LimitedRole | CustomRole): readonly string[] => (isCustomRole(r) ? parseCustom(r).areas : ROLE_AREAS[r]);
export const roleAllowsArea = (r: LimitedRole | CustomRole, area: string) => areasOf(r).includes(area);
export const roleLabel = (r: Role): string => (isCustomRole(r) ? parseCustom(r).name : ROLE_LABEL[r as FullRole | LimitedRole] ?? r);

/** Erste Seite nach dem Anmelden für eingeschränkte Rollen */
export const LANDING: Record<LimitedRole, string> = { reception: "frontdesk", housekeeping: "housekeeping", accounting: "invoices", service: "kasse" };
const LANDING_ORDER = ["frontdesk", "housekeeping", "bookings", "calendar", "invoices", "kasse", "restaurant", "guests", "inbox", "statistics"];
export function landingFor(r: LimitedRole | CustomRole): string {
  if (!isCustomRole(r)) return LANDING[r];
  const areas = parseCustom(r).areas;
  return LANDING_ORDER.find((a) => areas.includes(a)) ?? areas.find((a) => !(BASE_AREAS as readonly string[]).includes(a)) ?? "mypontivo";
}

const RANK: Record<FullRole, number> = { staff: 1, manager: 2, owner: 3 };
/** Eingeschränkte Rollen erfüllen nie eine Mindestrolle, nur den Bereichs-Zugang */
export function atLeast(role: Role | null, min: FullRole): boolean {
  return role !== null && !isLimitedRole(role) && RANK[role as FullRole] >= RANK[min];
}

/** Zugriff auf eine Seite/Aktion: volle Rollen nach Mindestrolle, eingeschränkte nur mit Bereich (und nur wo «staff» genügt) */
export function canAccess(role: Role | null, min: FullRole, area?: string): boolean {
  if (role === null) return false;
  if (isLimitedRole(role)) return min === "staff" && !!area && roleAllowsArea(role, area);
  return atLeast(role, min);
}
