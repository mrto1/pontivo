/**
 * Rollen (SPEC 17.4). Owner/Manager/Staff sind abgestuft (wie bisher). Eingeschränkte Rollen sehen nur ausdrücklich
 * freigegebene Bereiche und sind überall sonst ausgesperrt (sicher als Standard: eine Seite ohne Bereichsangabe ist für sie 404).
 */
export type FullRole = "owner" | "manager" | "staff";
export type LimitedRole = "reception" | "housekeeping" | "accounting" | "service" | "driver";
/** Eigene Rolle eines Betriebs, so aufgelöst: `custom:<Name URL-kodiert>:<Bereiche mit Komma>` (Auflösung in src/auth/session.ts, in der DB steht `custom:<id>`) */
export type CustomRole = `custom:${string}`;
export type Role = FullRole | LimitedRole | CustomRole;

export const ROLE_LABEL: Record<FullRole | LimitedRole, string> = {
  owner: "Inhaber", manager: "Manager", staff: "Mitarbeitende", reception: "Rezeption", housekeeping: "Reinigung", accounting: "Buchhaltung", service: "Service (Restaurant)", driver: "Fahrer (Lieferung)",
};

/** Bereiche = Schlüssel der Menüpunkte (src/admin/nav.ts) plus «layout» (Rahmen), «home» (leitet weiter) und «tag» (Reiter «Tag» für eingeschränkte Rollen sichtbar) */
export const ROLE_AREAS: Record<LimitedRole, readonly string[]> = {
  reception: ["layout", "home", "mypontivo", "firstweek", "help", "helpflows", "helpterms", "tag", "calendar", "bookings", "plan", "housekeeping", "resources", "reports", "guestbook", "inbox", "vouchers", "invoices", "dayclose", "groups"],
  housekeeping: ["layout", "home", "mypontivo", "firstweek", "help", "helpflows", "helpterms", "housekeeping"],
  accounting: ["layout", "home", "mypontivo", "firstweek", "help", "helpflows", "helpterms", "invoices", "dayclose", "debtors", "owners", "statistics", "hesta", "accountingexport"],
  service: ["layout", "home", "mypontivo", "firstweek", "help", "helpflows", "helpterms", "dininghome", "restaurant", "reservations", "resplan", "waitlist", "kitchen", "kasse", "onlineorders", "driver"],
  driver: ["layout", "home", "mypontivo", "firstweek", "help", "helpflows", "helpterms", "driver"],
};

/** Standardrollen, die ein Betrieb in Name und Seiten anpassen kann (Inhaber, Manager und Mitarbeitende sind abgestuft und bleiben fest) */
export const EDITABLE_STANDARD_ROLES: readonly LimitedRole[] = ["reception", "housekeeping", "accounting", "service"];
export const isEditableStandardRole = (r: string): r is LimitedRole => (EDITABLE_STANDARD_ROLES as readonly string[]).includes(r);

/** Immer dabei, damit eine eigene Rolle sich anmelden und ihr Konto sehen kann */
export const BASE_AREAS = ["layout", "home", "mypontivo", "firstweek", "help", "helpflows", "helpterms"] as const;

/** Seiten, die in einer eigenen Rolle angehakt werden können (nur Seiten, die schon für «Mitarbeitende» offen sind) */
export const CONFIGURABLE_AREAS: { key: string; label: string; group: string }[] = [
  { group: "Heute", key: "tag", label: "Tagesliste (An- & Abreisen)" },
  { group: "Heute", key: "housekeeping", label: "Reinigung" },
  { group: "Heute", key: "inbox", label: "Posteingang" },
  { group: "Restaurant", key: "dininghome", label: "Tagesübersicht" },
  { group: "Restaurant", key: "reservations", label: "Reservierungen" },
  { group: "Restaurant", key: "resplan", label: "Tischplan" },
  { group: "Restaurant", key: "waitlist", label: "Warteliste" },
  { group: "Restaurant", key: "restaurant", label: "Tische" },
  { group: "Restaurant", key: "kasse", label: "Kasse" },
  { group: "Restaurant", key: "kitchen", label: "Küchenbildschirm" },
  { group: "Restaurant", key: "onlineorders", label: "Online-Bestellungen (Bestellbildschirm)" },
  { group: "Restaurant", key: "driver", label: "Lieferungen (Fahrer)" },
  { group: "Kalender", key: "plan", label: "Zimmerplan" },
  { group: "Kalender", key: "calendar", label: "Preise & Verfügbarkeit (ansehen)" },
  { group: "Buchungen", key: "bookings", label: "Buchungen" },
  { group: "Buchungen", key: "groups", label: "Gruppen" },
  { group: "Buchungen", key: "resources", label: "Angebote vor Ort" },
  { group: "Buchungen", key: "vouchers", label: "Gutscheine" },
  { group: "Buchungen", key: "guestbook", label: "Gäste: Kartei" },
  { group: "Buchungen", key: "feedback", label: "Gäste: Bewertungen" },
  { group: "Finanzen", key: "invoices", label: "Rechnungen" },
  { group: "Finanzen", key: "dayclose", label: "Tagesabschluss" },
  { group: "Finanzen", key: "debtors", label: "Debitoren" },
  { group: "Finanzen", key: "owners", label: "Eigentümer" },
  { group: "Finanzen", key: "statistics", label: "Statistik" },
  { group: "Finanzen", key: "hesta", label: "HESTA" },
  { group: "Finanzen", key: "reports", label: "Berichte (Kurtaxe, Gästeregister, Exporte)" },
  { group: "Finanzen", key: "accountingexport", label: "Buchhaltung" },
];

/** Frühere Bereiche: «frontdesk» (An- & Abreisen) ist in «Tag» aufgegangen, «guests» (Check-in & Meldeschein) in «Tag» und «Berichte» */
const legacyArea = (a: string) => (a === "frontdesk" ? "tag" : a === "guests" ? "reports" : a);
export const encodeCustomRole = (name: string, areas: readonly string[]): CustomRole =>
  `custom:${encodeURIComponent(name)}:${[...new Set([...BASE_AREAS, ...areas.map(legacyArea)])].join(",")}`;
/** Sieht die Rolle den Reiter «Tag»? Volle Rollen immer, eingeschränkte nur mit Bereich «tag». */
export const hasArea = (r: Role, area: string): boolean => !isLimitedRole(r) || areasOf(r).includes(area);
export const seesDay = (r: Role): boolean => hasArea(r, "tag");
export const isCustomRole = (r: string | null): r is CustomRole => typeof r === "string" && r.startsWith("custom:") && r.split(":").length === 3;
const parseCustom = (r: CustomRole) => { const [, name, areas] = r.split(":"); return { name: decodeURIComponent(name), areas: areas.split(",").filter(Boolean) }; };

export const isLimitedRole = (r: Role | null): r is LimitedRole | CustomRole => r === "reception" || r === "housekeeping" || r === "accounting" || r === "service" || r === "driver" || isCustomRole(r);
export const areasOf = (r: LimitedRole | CustomRole): readonly string[] => (isCustomRole(r) ? parseCustom(r).areas : ROLE_AREAS[r]);
export const roleAllowsArea = (r: LimitedRole | CustomRole, area: string) => areasOf(r).includes(area);
export const roleLabel = (r: Role): string => (isCustomRole(r) ? parseCustom(r).name : ROLE_LABEL[r as FullRole | LimitedRole] ?? r);

/** Erste Seite nach dem Anmelden für eingeschränkte Rollen */
export const LANDING: Record<LimitedRole, string> = { reception: "", housekeeping: "housekeeping", accounting: "invoices", service: "restaurant/heute", driver: "restaurant/fahrer" };
const LANDING_ORDER = ["tag", "housekeeping", "bookings", "calendar", "invoices", "dininghome", "onlineorders", "driver", "kasse", "restaurant", "reservations", "kitchen", "reports", "inbox", "statistics"];
/** Bereiche, deren Adresse nicht dem Schlüssel entspricht */
const AREA_PATH: Record<string, string> = { onlineorders: "restaurant/bestellungen", driver: "restaurant/fahrer", dininghome: "restaurant/heute", reservations: "restaurant/reservierungen", kitchen: "restaurant/kueche", resplan: "restaurant/tischplan", waitlist: "restaurant/warteliste" };
export function landingFor(r: LimitedRole | CustomRole): string {
  if (!isCustomRole(r)) return LANDING[r];
  const areas = parseCustom(r).areas;
  const first = LANDING_ORDER.find((a) => areas.includes(a));
  if (first === "tag") return "";
  if (first) return AREA_PATH[first] ?? first;
  return areas.find((a) => !(BASE_AREAS as readonly string[]).includes(a)) ?? "mypontivo";
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
