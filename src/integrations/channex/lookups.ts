import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import { hotels, ratePlans, roomTypes, type Hotel } from "../../db/schema";
import { channex } from "./client";
import type { PlanOption } from "./booking-mapping";

/**
 * Channex-Gruppe der Property (Pflichtfeld group_id für Kanalverbindungen).
 * Doku Get Property API: data.relationships.groups.data[].id; eine Property gehört zu mindestens einer Gruppe
 * (ohne Angabe die Standardgruppe des Benutzers). Wird in hotels.channex_group_id zwischengespeichert.
 */
export async function channexGroupId(hotel: Hotel): Promise<string> {
  if (hotel.channexGroupId) return hotel.channexGroupId;
  if (!hotel.channexPropertyId) throw new Error("Zuerst den Betrieb in Channex anlegen");
  const res = await channex.getProperty(hotel.channexPropertyId);
  const groupId = res.data.relationships?.groups?.data?.[0]?.id;
  if (!groupId) throw new Error("Channex liefert keine Gruppe für diese Property");
  await db().update(hotels).set({ channexGroupId: groupId }).where(eq(hotels.id, hotel.id));
  return groupId;
}

/**
 * Belegungen, für die ein Pontivo-Tarif in Channex Preise hat, abgeleitet aus der Art, wie `createInChannex`
 * ihn angelegt hat: "per_person" → 1 … max_adults, sonst nur die primäre Belegung (min(base_occupancy, max_adults)).
 * ASSUMPTION: In der Booking.com-Zuordnung ist `rate_plan_id` für alle Belegungen die Channex-ID des Tarifs;
 * die Belegung steht in `settings.occupancy` (QUESTIONS.md, auf Staging zu prüfen).
 */
export async function channexPlanOptions(
  hotel: Hotel,
  plans: { id: string; channexRatePlanId: string | null }[],
): Promise<Map<string, PlanOption[]>> {
  const ids = plans.filter((p) => p.channexRatePlanId).map((p) => p.id);
  const out = new Map<string, PlanOption[]>();
  if (!ids.length) return out;
  const rows = await db()
    .select({ id: ratePlans.id, channexId: ratePlans.channexRatePlanId, perPerson: ratePlans.channexPerPerson, base: ratePlans.baseOccupancy, maxAdults: roomTypes.maxAdults })
    .from(ratePlans)
    .innerJoin(roomTypes, eq(roomTypes.id, ratePlans.roomTypeId))
    .where(and(eq(ratePlans.hotelId, hotel.id), inArray(ratePlans.id, ids)));
  for (const r of rows) {
    if (!r.channexId) continue;
    const occs = r.perPerson ? Array.from({ length: r.maxAdults }, (_, i) => i + 1) : [Math.min(r.base, r.maxAdults)];
    out.set(r.id, occs.map((occupancy) => ({ channexId: r.channexId!, occupancy })));
  }
  return out;
}
