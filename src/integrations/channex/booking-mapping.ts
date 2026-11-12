import type { BookingMappingDetails, BookingRate } from "./client";

/**
 * Zuordnung Booking.com ↔ Pontivo (reine Logik, ohne I/O).
 * Leitfaden Booking.com, Schritt 6: ein `rate_plans`-Eintrag pro (Channex-Tarif-Belegung → Booking-Zimmer/-Tarif/-Belegung),
 * je Zimmer-Tarif-Paar genau ein Eintrag mit `primary_occ: true`. OBP: ein Eintrag je Belegung, Standard: einer je Tarif.
 */

/** Eine Belegungs-Variante eines Pontivo-Tarifs in Channex (`rate_plans/options?multi_occupancy=true`). */
export type PlanOption = { channexId: string; occupancy: number };

export type BookingMappingItem = {
  rate_plan_id: string;
  settings: {
    room_type_code: number | string;
    rate_plan_code: number | string;
    occupancy: number;
    pricing_type: "OBP" | "Standard";
    primary_occ: boolean;
    readonly: boolean;
  };
};

/** Schlüssel einer Booking-Zimmer/Tarif-Kombination im Formular und in `selection` */
export const pairKey = (roomId: number | string, rateId: number | string) => `${roomId}:${rateId}`;

export class MappingError extends Error {}

/**
 * Baut die Zuordnung aus der Auswahl im Admin.
 * @param selection  pairKey → Pontivo rate_plans.id (leer/fehlend = auf Booking.com nicht verkaufen)
 * @param optionsByPlan  Pontivo rate_plans.id → Belegungs-Varianten in Channex
 * @param planNames  für Fehlermeldungen
 */
export function buildBookingMappings(
  details: BookingMappingDetails,
  selection: Record<string, string | undefined>,
  optionsByPlan: Map<string, PlanOption[]>,
  planNames: Map<string, string> = new Map(),
): BookingMappingItem[] {
  const items: BookingMappingItem[] = [];
  for (const room of details.rooms) {
    for (const rate of room.rates) {
      const planId = selection[pairKey(room.id, rate.id)];
      if (!planId) continue;
      const opts = optionsByPlan.get(planId);
      const name = planNames.get(planId) ?? planId;
      if (!opts?.length) throw new MappingError(`Tarif «${name}» ist noch nicht in Channex angelegt`);
      const pricing = details.pricing_type;
      const base = { room_type_code: room.id, rate_plan_code: rate.id, pricing_type: pricing, readonly: rate.readonly };
      if (pricing === "OBP") {
        const occs = occupanciesOf(rate);
        const pairs = occs
          .map((occ) => ({ occ, opt: opts.find((o) => o.occupancy === occ) }))
          .filter((p): p is { occ: number; opt: PlanOption } => !!p.opt);
        if (!pairs.length) {
          throw new MappingError(
            `«${room.title} / ${rate.title}» (Booking.com) verkauft für ${occs.join(", ")} Personen; Tarif «${name}» hat dafür keine Preise`,
          );
        }
        // ASSUMPTION: Die höchste zugeordnete Belegung ist die primäre (wie im Beispiel des Booking.com-Leitfadens).
        const primary = Math.max(...pairs.map((p) => p.occ));
        for (const p of pairs) {
          items.push({ rate_plan_id: p.opt.channexId, settings: { ...base, occupancy: p.occ, primary_occ: p.occ === primary } });
        }
      } else {
        // Standard (Preis pro Zimmer): ein Eintrag je Tarif, mit der höchsten Belegung, die unser Tarif kennt.
        // ASSUMPTION: `occupancy` = max_persons des Booking-Tarifs, falls unser Tarif diese Belegung hat, sonst unsere höchste.
        const want = rate.max_persons ?? Math.max(...opts.map((o) => o.occupancy));
        const opt = opts.find((o) => o.occupancy === want) ?? opts.reduce((a, b) => (b.occupancy > a.occupancy ? b : a));
        items.push({ rate_plan_id: opt.channexId, settings: { ...base, occupancy: opt.occupancy, primary_occ: true } });
      }
    }
  }
  if (!items.length) throw new MappingError("Bitte mindestens einen Booking.com-Tarif einem Pontivo-Tarif zuordnen");
  return items;
}

function occupanciesOf(rate: BookingRate): number[] {
  if (rate.occupancies?.length) return [...rate.occupancies].sort((a, b) => a - b);
  return rate.max_persons ? [rate.max_persons] : [];
}
