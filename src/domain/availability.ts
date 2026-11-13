import { diffDays, nightsOf, type Day } from "./dates";

/** SPEC 5.1 – reine Prüfung eines Angebots (Zimmertyp × Rateplan) */

export const MAX_NIGHTS = 30;

export type StayQuery = {
  checkin: Day;
  checkout: Day;
  adults: number;
  children: number;
};

export type RoomCapacity = { maxAdults: number; maxChildren: number; maxOccupancy: number };

export type InvRow = { night: Day; total: number; booked: number; blocked: number; externalBlocked?: number };
export type RateRow = {
  night: Day;
  priceRappen: number;
  minStayArrival: number;
  maxStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  stopSell: boolean;
};

export type Rejection =
  | "invalid_dates"
  | "in_past"
  | "too_long"
  | "occupancy"
  | "no_inventory"
  | "sold_out"
  | "no_rate"
  | "stop_sell"
  | "closed_to_arrival"
  | "min_stay"
  | "max_stay"
  | "closed_to_departure";

export function validateStay(q: StayQuery, today: Day): Rejection | null {
  const n = diffDays(q.checkin, q.checkout);
  if (n <= 0) return "invalid_dates";
  if (q.checkin < today) return "in_past";
  if (n > MAX_NIGHTS) return "too_long";
  return null;
}

export function fitsRoom(q: StayQuery, room: RoomCapacity): boolean {
  return (
    q.adults <= room.maxAdults &&
    q.children <= room.maxChildren &&
    q.adults + q.children <= room.maxOccupancy
  );
}

/**
 * Prüft Verfügbarkeit und Regeln. inv/rates dürfen Zeilen ausserhalb des Aufenthalts enthalten
 * (rates für den Abreisetag werden für closed_to_departure gebraucht).
 */
export function evaluateOffer(
  q: StayQuery,
  room: RoomCapacity,
  inv: InvRow[],
  rates: RateRow[],
): { ok: true; rates: RateRow[] } | { ok: false; reason: Rejection } {
  if (!fitsRoom(q, room)) return { ok: false, reason: "occupancy" };
  const nights = nightsOf(q.checkin, q.checkout);
  const invBy = new Map(inv.map((r) => [r.night, r]));
  const rateBy = new Map(rates.map((r) => [r.night, r]));
  const stayRates: RateRow[] = [];
  for (const night of nights) {
    const i = invBy.get(night);
    if (!i) return { ok: false, reason: "no_inventory" };
    if (i.total - i.booked - i.blocked - (i.externalBlocked ?? 0) < 1) return { ok: false, reason: "sold_out" };
    const r = rateBy.get(night);
    if (!r) return { ok: false, reason: "no_rate" };
    if (r.stopSell) return { ok: false, reason: "stop_sell" };
    stayRates.push(r);
  }
  const arrival = stayRates[0];
  if (arrival.closedToArrival) return { ok: false, reason: "closed_to_arrival" };
  if (nights.length < arrival.minStayArrival) return { ok: false, reason: "min_stay" };
  if (arrival.maxStay !== null && nights.length > arrival.maxStay) return { ok: false, reason: "max_stay" };
  const dep = rateBy.get(q.checkout);
  if (dep && dep.closedToDeparture) return { ok: false, reason: "closed_to_departure" };
  return { ok: true, rates: stayRates };
}
