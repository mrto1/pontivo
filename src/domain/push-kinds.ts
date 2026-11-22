/**
 * Mitteilungen nach Art und Person (SPEC 20.1). Reine Logik.
 * Eine Person bekommt eine Art nur, wenn sie die zugehörige Liste im Menü sieht (wie bei den Zahlen, src/domain/unseen.ts) und die Art nicht abgestellt hat.
 * ASSUMPTION: «Sonstiges» (Gutschein verkauft, Extras verkauft) bekommen nur Inhaber und Manager.
 */
import type { Nav } from "../admin/nav";
import { atLeast, isLimitedRole, type Role } from "./roles";
import { itemKeyFor, SEEN_KINDS, type SeenKind } from "./unseen";

export type PushKind = SeenKind | "other";
export const PUSH_KINDS: PushKind[] = ["orders", "reservations", "bookings", "inbox", "other"];
export const isPushKind = (k: string): k is PushKind => (PUSH_KINDS as string[]).includes(k);
export const PUSH_KIND_LABEL: Record<PushKind, { title: string; hint: string }> = {
  orders: { title: "Online-Bestellungen", hint: "Neue Bestellung und Erinnerung, wenn eine wartet" },
  reservations: { title: "Reservierungen", hint: "Neue Online-Reservierung" },
  bookings: { title: "Buchungen", hint: "Neue Buchung, Stornierung, Überbuchung" },
  inbox: { title: "Anfragen und Nachrichten", hint: "Neue Anfrage, Gästewunsch, Gästenachricht, Check-out im Portal" },
  other: { title: "Sonstiges", hint: "Gutschein oder Extras verkauft" },
};

/** Sieht diese Rolle die Liste zu dieser Art? */
export function pushVisible(role: Role, kind: PushKind, navs: { lodging: Nav | null; dining: Nav | null }): boolean {
  if (kind === "other") return !isLimitedRole(role) && atLeast(role, "manager");
  return itemKeyFor(kind, navs[SEEN_KINDS[kind].area]) !== null;
}

/** Bekommt die Person die Mitteilung? Eine Wahl der Person gilt nur innerhalb dessen, was sie sehen darf. */
export const pushWanted = (role: Role, kind: PushKind, navs: { lodging: Nav | null; dining: Nav | null }, pref: boolean | undefined): boolean =>
  pushVisible(role, kind, navs) && pref !== false;
