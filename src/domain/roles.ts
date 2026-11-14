/**
 * Rollen (SPEC 17.4). Owner/Manager/Staff sind abgestuft (wie bisher). Eingeschränkte Rollen sehen nur ausdrücklich
 * freigegebene Bereiche und sind überall sonst ausgesperrt (sicher als Standard: eine Seite ohne Bereichsangabe ist für sie 404).
 */
export type FullRole = "owner" | "manager" | "staff";
export type LimitedRole = "reception" | "housekeeping" | "accounting";
export type Role = FullRole | LimitedRole;

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Inhaber", manager: "Manager", staff: "Mitarbeitende", reception: "Rezeption", housekeeping: "Reinigung", accounting: "Buchhaltung",
};

/** Bereiche = Schlüssel der Menüpunkte (src/admin/nav.ts) plus «layout» (Rahmen) und «home» (leitet weiter) */
export const ROLE_AREAS: Record<LimitedRole, readonly string[]> = {
  reception: ["layout", "home", "calendar", "bookings", "frontdesk", "plan", "housekeeping", "guests", "guestbook", "inquiries", "vouchers", "invoices", "groups"],
  housekeeping: ["layout", "home", "housekeeping"],
  accounting: ["layout", "home", "invoices", "statistics"],
};

export const isLimitedRole = (r: Role | null): r is LimitedRole => r === "reception" || r === "housekeeping" || r === "accounting";
export const roleAllowsArea = (r: LimitedRole, area: string) => ROLE_AREAS[r].includes(area);

/** Erste Seite nach dem Anmelden für eingeschränkte Rollen */
export const LANDING: Record<LimitedRole, string> = { reception: "frontdesk", housekeeping: "housekeeping", accounting: "invoices" };

const RANK: Record<FullRole, number> = { staff: 1, manager: 2, owner: 3 };
/** Eingeschränkte Rollen erfüllen nie eine Mindestrolle, nur den Bereichs-Zugang */
export function atLeast(role: Role | null, min: FullRole): boolean {
  return role !== null && !isLimitedRole(role) && RANK[role] >= RANK[min];
}

/** Zugriff auf eine Seite/Aktion: volle Rollen nach Mindestrolle, eingeschränkte nur mit Bereich (und nur wo «staff» genügt) */
export function canAccess(role: Role | null, min: FullRole, area?: string): boolean {
  if (role === null) return false;
  if (isLimitedRole(role)) return min === "staff" && !!area && roleAllowsArea(role, area);
  return atLeast(role, min);
}
