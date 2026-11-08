import { assertInt, bpsOf } from "./money";
import type { Day } from "./dates";

export type PlanPricing = {
  baseOccupancy: number;
  extraAdultRappen: number;
  singleDiscountRappen: number;
};

export type NightlyPrice = { night: Day; price_rappen: number };

/** SPEC 5.2: Preis pro Nacht nach Belegung */
export function priceForNight(
  baseRappen: number,
  plan: PlanPricing,
  adults: number,
  children: number,
): number {
  assertInt(baseRappen, "price_rappen");
  let p = baseRappen;
  const persons = adults + children;
  if (persons === 1) p = Math.max(1, p - plan.singleDiscountRappen);
  if (adults > plan.baseOccupancy) p += (adults - plan.baseOccupancy) * plan.extraAdultRappen;
  return p;
}

/**
 * Preise je Anzahl Erwachsene (1 … maxAdults) für Channex-Tarife "per_person".
 * Gleiche Rechnung wie auf der Buchungsseite (ohne Kinder).
 */
export function occupancyPrices(baseRappen: number, plan: PlanPricing, maxAdults: number): { occupancy: number; price_rappen: number }[] {
  const out: { occupancy: number; price_rappen: number }[] = [];
  for (let n = 1; n <= Math.max(1, maxAdults); n++) out.push({ occupancy: n, price_rappen: priceForNight(baseRappen, plan, n, 0) });
  return out;
}

/** Hängt der Preis von der Anzahl Erwachsener ab? Dann braucht Channex einen Tarif "per_person". */
export function pricesVaryByOccupancy(plan: PlanPricing, maxAdults: number): boolean {
  const p = occupancyPrices(100_000, plan, maxAdults).map((o) => o.price_rappen);
  return p.some((x) => x !== p[0]);
}

export function priceStay(
  rates: { night: Day; priceRappen: number }[],
  plan: PlanPricing,
  adults: number,
  children: number,
): { nightly: NightlyPrice[]; roomsTotalRappen: number } {
  const nightly = rates.map((r) => ({
    night: r.night,
    price_rappen: priceForNight(r.priceRappen, plan, adults, children),
  }));
  return { nightly, roomsTotalRappen: nightly.reduce((s, n) => s + n.price_rappen, 0) };
}

/** SPEC 5.2: Plattformgebühr, mindestens 1 Rappen, kleiner als total */
export function platformFee(totalRappen: number, feeBps: number): number {
  if (totalRappen <= 1 || feeBps <= 0) return 0;
  const fee = bpsOf(totalRappen, feeBps);
  return Math.min(Math.max(fee, 1), totalRappen - 1);
}

export function grandTotal(roomsTotal: number, touristTax: number, taxIncluded: boolean): number {
  return taxIncluded ? roomsTotal : roomsTotal + touristTax;
}
