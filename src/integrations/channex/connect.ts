import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { channexOutbox, hotels, ratePlans, roomTypes, type Hotel } from "../../db/schema";
import { pricesVaryByOccupancy } from "../../domain/pricing";
import { audit } from "../../services/audit";
import { channex } from "./client";
import { enqueueFullSync } from "./outbox-worker";

/**
 * SPEC 7.1 "Channex verbinden": Property, Room Types und Rate Plans in Channex anlegen
 * (Felder gemäss Channex-Doku create property / room type / rate plan) und die UUIDs speichern.
 * Bereits vorhandene IDs werden nicht neu angelegt.
 */
// Tarife ohne Zuschlag/Einzelrabatt: "per_room" mit einer Belegungsoption = base_occupancy (primär).
// Tarife, deren Preis von der Anzahl Erwachsener abhängt: "per_person" mit je einer Option für 1 … max_adults
// (Rate-Plans-Doku), primär = base_occupancy; die Preise je Belegung sendet der Outbox-Worker als `rates`.
export async function createInChannex(hotel: Hotel, actor: string) {
  let propertyId = hotel.channexPropertyId;
  if (!propertyId) {
    const res = await channex.createProperty({
      title: hotel.name,
      currency: hotel.currency,
      email: hotel.contactEmail,
      phone: hotel.contactPhone ?? undefined,
      zip_code: hotel.postalCode ?? undefined,
      country: "CH",
      city: hotel.city ?? undefined,
      address: hotel.addressLine ?? undefined,
      timezone: hotel.timezone,
      property_type: "hotel",
      settings: { min_stay_type: "arrival" },
    });
    propertyId = res.data.id;
    await db().update(hotels).set({ channexPropertyId: propertyId }).where(eq(hotels.id, hotel.id));
  }
  const rts = await db().select().from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true)));
  for (const rt of rts) {
    let rtId = rt.channexRoomTypeId;
    if (!rtId) {
      const res = await channex.createRoomType({
        property_id: propertyId,
        title: rt.name,
        count_of_rooms: Math.max(1, rt.roomCount),
        occ_adults: rt.maxAdults,
        occ_children: rt.maxChildren,
        occ_infants: 0,
        room_kind: "room",
      });
      rtId = res.data.id;
      await db().update(roomTypes).set({ channexRoomTypeId: rtId }).where(eq(roomTypes.id, rt.id));
    }
    const rps = await db().select().from(ratePlans).where(and(eq(ratePlans.roomTypeId, rt.id), eq(ratePlans.active, true)));
    for (const rp of rps) {
      if (rp.channexRatePlanId) continue;
      const primary = Math.min(rp.baseOccupancy, rt.maxAdults);
      const perPerson = pricesVaryByOccupancy(rp, rt.maxAdults);
      const res = await channex.createRatePlan({
        title: rp.name,
        property_id: propertyId,
        room_type_id: rtId,
        currency: hotel.currency,
        sell_mode: perPerson ? "per_person" : "per_room",
        rate_mode: "manual",
        options: perPerson
          ? Array.from({ length: rt.maxAdults }, (_, i) => ({ occupancy: i + 1, is_primary: i + 1 === primary }))
          : [{ occupancy: primary, is_primary: true }],
      });
      await db().update(ratePlans).set({ channexRatePlanId: res.data.id, channexPerPerson: perPerson }).where(eq(ratePlans.id, rp.id));
    }
  }
  await audit(db(), { hotelId: hotel.id, actor, action: "channex.create", entity: "hotel", entityId: hotel.id, details: { propertyId } });
}

/** Bestehende Channex-IDs von Hand zuordnen (Hotel hat schon eine Property in Channex) */
// ASSUMPTION: Von Hand zugeordnete Tarife gelten als "per_room" (channex_per_person bleibt unverändert, Standard false);
// es wird ein Preis für die Basisbelegung gesendet (QUESTIONS.md).
export async function saveMapping(
  hotel: Hotel,
  m: { propertyId: string | null; roomTypes: Record<string, string | null>; ratePlans: Record<string, string | null> },
  actor: string,
) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const clean = (v: string | null) => (v && v.trim() ? (uuid.test(v.trim()) ? v.trim().toLowerCase() : (() => { throw new Error(`Keine gültige UUID: ${v}`); })()) : null);
  await db().transaction(async (tx) => {
    await tx.update(hotels).set({ channexPropertyId: clean(m.propertyId) }).where(eq(hotels.id, hotel.id));
    for (const [id, v] of Object.entries(m.roomTypes)) {
      await tx.update(roomTypes).set({ channexRoomTypeId: clean(v) }).where(and(eq(roomTypes.id, id), eq(roomTypes.hotelId, hotel.id)));
    }
    for (const [id, v] of Object.entries(m.ratePlans)) {
      await tx.update(ratePlans).set({ channexRatePlanId: clean(v) }).where(and(eq(ratePlans.id, id), eq(ratePlans.hotelId, hotel.id)));
    }
    await audit(tx, { hotelId: hotel.id, actor, action: "channex.mapping", entity: "hotel", entityId: hotel.id, details: m });
  });
}

/** Abgleich einschalten: channex_enabled + Vollabgleich */
export async function enableChannex(hotel: Hotel, actor: string) {
  const [fresh] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  if (!fresh.channexPropertyId) throw new Error("Zuerst Property-ID speichern oder in Channex anlegen");
  await db().update(hotels).set({ channexEnabled: true, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
  await enqueueFullSync({ ...fresh, channexEnabled: true }, actor);
}

export async function disableChannex(hotel: Hotel, actor: string) {
  await db().update(hotels).set({ channexEnabled: false, updatedAt: new Date() }).where(eq(hotels.id, hotel.id));
  await audit(db(), { hotelId: hotel.id, actor, action: "channex.disable", entity: "hotel", entityId: hotel.id });
}

/** Status für den Admin: offene/fehlerhafte Einträge, letzte Synchronisation */
export async function channexStatus(hotelId: string) {
  const [counts] = (
    await db().execute(sql`
      SELECT count(*) FILTER (WHERE status IN ('pending','sending'))::int AS pending,
             count(*) FILTER (WHERE status = 'failed')::int AS failed,
             max(sent_at) FILTER (WHERE status = 'sent' AND last_error IS NULL) AS last_sent
        FROM channex_outbox WHERE hotel_id = ${hotelId}`)
  ).rows as { pending: number; failed: number; last_sent: Date | null }[];
  const errors = await db()
    .select({ id: channexOutbox.id, kind: channexOutbox.kind, error: channexOutbox.lastError, at: channexOutbox.createdAt, status: channexOutbox.status })
    .from(channexOutbox)
    .where(and(eq(channexOutbox.hotelId, hotelId), sql`${channexOutbox.lastError} IS NOT NULL AND ${channexOutbox.lastError} NOT LIKE 'übersprungen%'`))
    .orderBy(sql`${channexOutbox.id} DESC`)
    .limit(5);
  return { ...counts, errors };
}
