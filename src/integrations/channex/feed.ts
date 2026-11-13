import { and, eq, inArray, sql } from "drizzle-orm";
import { db, rows, type Tx } from "../../db/client";
import { bookingRooms, bookings, guests, hotels, inboundEvents, ratePlans, roomTypes, type Hotel } from "../../db/schema";
import { nightsOf } from "../../domain/dates";
import { decimalToRappen } from "../../domain/money";
import { newPublicToken, newReference } from "../../domain/ids";
import { assertTransition } from "../../domain/state-machine";
import { enqueueAvailability } from "../../services/outbox";
import { audit } from "../../services/audit";
import { enqueueEmail } from "../../email/enqueue";
import { env } from "../../env";
import { channex, type BookingRevision } from "./client";
import { pushForBooking } from "../../push/service";
import { channexAlert } from "./alerts";

/** SPEC 5.6: ota_name → bookings.source. Channex liefert z. B. "Booking.com", "BookingCom", "A-Expedia", "Airbnb". */
export function sourceFromOta(otaName: string | null | undefined): "booking_com" | "expedia" | "airbnb" | "other_ota" {
  const n = (otaName ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (n.includes("bookingcom")) return "booking_com";
  if (n.includes("expedia")) return "expedia";
  if (n.includes("airbnb")) return "airbnb";
  return "other_ota";
}

export class RevisionError extends Error {
  constructor(public code: "unknown_property" | "unmapped_room" | "invalid", message: string) {
    super(message);
  }
}

type MappedRoom = {
  roomTypeId: string;
  ratePlanId: string | null;
  adults: number;
  children: number;
  ages: number[];
  nightly: { night: string; price_rappen: number }[];
  amountRappen: number;
};

/** Preise pro Nacht aus rooms[].days (Dezimal-String → Rappen) */
// ASSUMPTION: Fehlt `days`, wird `amount` gleichmässig auf die Nächte verteilt (Rest auf die letzte Nacht).
export function nightlyFromRoom(room: BookingRevision["rooms"][number]): { night: string; price_rappen: number }[] {
  const nights = nightsOf(room.checkin_date, room.checkout_date);
  if (room.days && Object.keys(room.days).length) {
    return nights.map((night) => ({ night, price_rappen: room.days?.[night] != null ? decimalToRappen(room.days[night]) : 0 }));
  }
  const total = room.amount ? decimalToRappen(room.amount) : 0;
  const each = nights.length ? Math.floor(total / nights.length) : 0;
  return nights.map((night, i) => ({ night, price_rappen: i === nights.length - 1 ? total - each * (nights.length - 1) : each }));
}

async function mapRooms(hotel: Hotel, rev: BookingRevision): Promise<MappedRoom[]> {
  if (!rev.rooms?.length) throw new RevisionError("invalid", "Revision ohne Zimmer");
  const rtIds = rev.rooms.map((r) => r.room_type_id).filter((x): x is string => !!x);
  const rpIds = rev.rooms.map((r) => r.rate_plan_id).filter((x): x is string => !!x);
  const rts = rtIds.length ? await db().select().from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), inArray(roomTypes.channexRoomTypeId, rtIds))) : [];
  const rps = rpIds.length ? await db().select().from(ratePlans).where(and(eq(ratePlans.hotelId, hotel.id), inArray(ratePlans.channexRatePlanId, rpIds))) : [];
  return rev.rooms.map((r) => {
    const rt = rts.find((x) => x.channexRoomTypeId === r.room_type_id);
    if (!rt) throw new RevisionError("unmapped_room", `Zimmertyp ${r.room_type_id ?? "null"} ist keinem Zimmertyp des Hotels zugeordnet`);
    const rp = rps.find((x) => x.channexRatePlanId === r.rate_plan_id && x.roomTypeId === rt.id) ?? null; // NULL erlaubt (schema.sql)
    const nightly = nightlyFromRoom(r);
    return {
      roomTypeId: rt.id,
      ratePlanId: rp?.id ?? null,
      adults: Math.max(1, r.occupancy?.adults ?? 1),
      children: (r.occupancy?.children ?? 0) + (r.occupancy?.infants ?? 0),
      ages: r.occupancy?.ages ?? [],
      nightly,
      amountRappen: r.amount ? decimalToRappen(r.amount) : nightly.reduce((s, n) => s + n.price_rappen, 0),
    };
  });
}

async function occupyRooms(tx: Tx, hotelId: string, rooms: { roomTypeId: string; nightly: { night: string }[] }[], delta: 1 | -1) {
  for (const r of rooms) {
    const nights = r.nightly.map((n) => n.night);
    if (!nights.length) continue;
    // Ohne Verfügbarkeitsbedingung: die OTA hat schon verkauft (SPEC 5.6)
    await tx.execute(sql`
      UPDATE inventory_days SET booked = GREATEST(0, booked + ${delta}), updated_at = now()
       WHERE hotel_id = ${hotelId} AND room_type_id = ${r.roomTypeId} AND night = ANY(${sql.raw(`ARRAY[${nights.map((n) => `'${n}'`).join(",")}]`)}::date[])`);
    const sorted = [...nights].sort();
    await enqueueAvailability(tx, hotelId, r.roomTypeId, sorted[0], sorted[sorted.length - 1]);
  }
}

async function isOverbooked(tx: Tx, rooms: { roomTypeId: string; nightly: { night: string }[] }[]): Promise<boolean> {
  for (const r of rooms) {
    const nights = r.nightly.map((n) => n.night);
    if (!nights.length) continue;
    const res = rows<{ n: number }>(
      await tx.execute(sql`
        SELECT count(*)::int AS n FROM inventory_days
         WHERE room_type_id = ${r.roomTypeId} AND booked + blocked > total
           AND night = ANY(${sql.raw(`ARRAY[${nights.map((n) => `'${n}'`).join(",")}]`)}::date[])`),
    );
    if (res[0].n > 0) return true;
  }
  return false;
}

/** Verarbeitet eine Revision (neu, geändert, storniert) in einer Transaktion. Wirft RevisionError bei Mapping-Problemen. */
export async function processRevision(rev: BookingRevision): Promise<{ bookingId: string | null; action: string }> {
  // Nur Werte aus unserer Allowlist in SQL verwenden: Datumswerte prüfen
  for (const r of rev.rooms ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.checkin_date) || !/^\d{4}-\d{2}-\d{2}$/.test(r.checkout_date)) throw new RevisionError("invalid", "Ungültiges Datum");
    for (const d of Object.keys(r.days ?? {})) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new RevisionError("invalid", "Ungültiges Datum in days");
  }
  const [hotel] = await db().select().from(hotels).where(eq(hotels.channexPropertyId, rev.property_id));
  if (!hotel) throw new RevisionError("unknown_property", `Unbekannte Property ${rev.property_id}`);

  if (rev.status === "cancelled") {
    return db().transaction(async (tx) => {
      const [b] = rows<{ id: string; status: string }>(await tx.execute(sql`SELECT id, status FROM bookings WHERE channex_booking_id = ${rev.booking_id} AND hotel_id = ${hotel.id} FOR UPDATE`));
      if (!b) {
        await audit(tx, { hotelId: hotel.id, actor: "channex", action: "channex.cancel_unknown_booking", details: { booking_id: rev.booking_id, revision: rev.id } });
        return { bookingId: null, action: "ignored" };
      }
      if (b.status === "cancelled") return { bookingId: b.id, action: "already_cancelled" };
      assertTransition(b.status, "cancelled");
      const old = await tx.select().from(bookingRooms).where(eq(bookingRooms.bookingId, b.id));
      await occupyRooms(tx, hotel.id, old.map((o) => ({ roomTypeId: o.roomTypeId, nightly: o.nightlyPrices })), -1);
      await tx.update(bookings).set({ status: "cancelled", cancelledAt: new Date(), cancelReason: "ota", updatedAt: new Date() }).where(eq(bookings.id, b.id));
      await enqueueEmail(tx, { hotelId: hotel.id, bookingId: b.id, template: "booking_cancelled", to: hotel.contactEmail, language: hotel.defaultLanguage, data: { bookingId: b.id, refundRappen: 0 } });
      await pushForBooking(tx, hotel.id, b.id, "cancelled");
      await audit(tx, { hotelId: hotel.id, actor: "channex", action: "booking.cancel", entity: "booking", entityId: b.id, details: { revision: rev.id } });
      return { bookingId: b.id, action: "cancelled" };
    });
  }

  const mapped = await mapRooms(hotel, rev);
  const roomsTotal = mapped.reduce((s, r) => s + r.amountRappen, 0);
  const total = rev.amount ? decimalToRappen(rev.amount) : roomsTotal;
  const adults = Math.max(1, rev.occupancy?.adults ?? mapped.reduce((s, r) => s + r.adults, 0));
  const children = rev.occupancy ? (rev.occupancy.children ?? 0) + (rev.occupancy.infants ?? 0) : mapped.reduce((s, r) => s + r.children, 0);
  const lang = (rev.customer?.language ?? "").toLowerCase().startsWith("en") ? "en" : (rev.customer?.language ?? "").toLowerCase().startsWith("de") ? "de" : hotel.defaultLanguage;

  return db().transaction(async (tx) => {
    const [existing] = rows<{ id: string; status: string; overbooked: boolean; guest_id: string | null }>(
      await tx.execute(sql`SELECT id, status, overbooked, guest_id FROM bookings WHERE channex_booking_id = ${rev.booking_id} AND hotel_id = ${hotel.id} FOR UPDATE`),
    );
    let bookingId: string;
    let action: string;
    const fields = {
      checkin: rev.arrival_date,
      checkout: rev.departure_date,
      adults,
      children,
      childrenAges: mapped.flatMap((m) => m.ages),
      language: lang,
      roomsTotalRappen: roomsTotal,
      touristTaxRappen: 0, // ASSUMPTION: Kurtaxe bei OTA-Buchungen unbekannt → 0, Hotel rechnet vor Ort ab
      totalRappen: total,
      platformFeeRappen: 0,
      otaReservationCode: rev.ota_reservation_code ?? null,
      guestNotes: rev.notes ?? null,
      source: sourceFromOta(rev.ota_name),
      updatedAt: new Date(),
    };

    if (existing && existing.status === "cancelled") {
      // Änderung zu einer bereits stornierten Buchung: nicht wiederbeleben, nur protokollieren
      await audit(tx, { hotelId: hotel.id, actor: "channex", action: "channex.revision_for_cancelled", entity: "booking", entityId: existing.id, details: { revision: rev.id, status: rev.status } });
      return { bookingId: existing.id, action: "ignored" };
    }

    if (existing) {
      bookingId = existing.id;
      action = "modified";
      const old = await tx.select().from(bookingRooms).where(eq(bookingRooms.bookingId, existing.id));
      await occupyRooms(tx, hotel.id, old.map((o) => ({ roomTypeId: o.roomTypeId, nightly: o.nightlyPrices })), -1);
      await tx.delete(bookingRooms).where(eq(bookingRooms.bookingId, existing.id));
      await tx.update(bookings).set(fields).where(eq(bookings.id, existing.id));
      if (existing.guest_id && rev.customer) {
        await tx
          .update(guests)
          .set({ firstName: rev.customer.name || "Gast", lastName: rev.customer.surname || "-", email: (rev.customer.mail ?? "").toLowerCase(), phone: rev.customer.phone ?? null })
          .where(eq(guests.id, existing.guest_id));
      }
    } else {
      action = "created";
      const [g] = await tx
        .insert(guests)
        .values({
          hotelId: hotel.id,
          firstName: rev.customer?.name || "Gast",
          lastName: rev.customer?.surname || "-",
          email: (rev.customer?.mail ?? "").toLowerCase(),
          phone: rev.customer?.phone ?? null,
          language: lang,
        })
        .returning();
      const [b] = await tx
        .insert(bookings)
        .values({ ...fields, hotelId: hotel.id, reference: newReference(), publicToken: newPublicToken(), status: "confirmed", confirmedAt: new Date(), guestId: g.id, channexBookingId: rev.booking_id })
        .returning();
      bookingId = b.id;
    }

    await tx.insert(bookingRooms).values(
      mapped.map((m) => ({
        bookingId,
        hotelId: hotel.id,
        roomTypeId: m.roomTypeId,
        ratePlanId: m.ratePlanId,
        adults: m.adults,
        children: m.children,
        nightlyPrices: m.nightly,
        amountRappen: m.amountRappen,
      })),
    );
    await occupyRooms(tx, hotel.id, mapped, 1);

    const over = await isOverbooked(tx, mapped);
    await tx.update(bookings).set({ overbooked: over }).where(eq(bookings.id, bookingId));
    if (over && !existing?.overbooked) {
      const data = { bookingId };
      await enqueueEmail(tx, { hotelId: hotel.id, bookingId, template: "overbooking_alert", to: hotel.contactEmail, language: hotel.defaultLanguage, data });
      await pushForBooking(tx, hotel.id, bookingId, "overbooking");
      const alert = env().PLATFORM_ALERT_EMAIL;
      if (alert) await enqueueEmail(tx, { hotelId: hotel.id, bookingId, template: "overbooking_alert", to: alert, data });
    }
    if (action === "created") {
      await enqueueEmail(tx, { hotelId: hotel.id, bookingId, template: "hotel_new_booking", to: hotel.contactEmail, language: hotel.defaultLanguage, data: { bookingId } });
      await pushForBooking(tx, hotel.id, bookingId, "new");
    }
    await audit(tx, { hotelId: hotel.id, actor: "channex", action: `booking.ota_${action}`, entity: "booking", entityId: bookingId, details: { revision: rev.id, ota: rev.ota_name, overbooked: over } });
    return { bookingId, action };
  });
}

/** Eine Revision idempotent verarbeiten und nur bei Erfolg acken (SPEC 7.3) */
export async function handleRevision(rev: BookingRevision): Promise<"acked" | "failed"> {
  await db()
    .insert(inboundEvents)
    .values({ source: "channex", eventId: rev.id, type: `booking_${rev.status}`, payload: rev as unknown as Record<string, unknown> })
    .onConflictDoNothing();
  const [ev] = await db().select().from(inboundEvents).where(and(eq(inboundEvents.source, "channex"), eq(inboundEvents.eventId, rev.id)));
  if (!ev.processedAt) {
    try {
      await processRevision(rev);
      await db().update(inboundEvents).set({ processedAt: new Date(), error: null }).where(and(eq(inboundEvents.source, "channex"), eq(inboundEvents.eventId, rev.id)));
    } catch (e) {
      const msg = (e as Error).message;
      await db().update(inboundEvents).set({ error: msg.slice(0, 4000) }).where(and(eq(inboundEvents.source, "channex"), eq(inboundEvents.eventId, rev.id)));
      if (!ev.error) {
        const [hotel] = await db().select().from(hotels).where(eq(hotels.channexPropertyId, rev.property_id));
        await channexAlert(hotel ?? null, `Buchung ${rev.ota_reservation_code ?? rev.booking_id} konnte nicht übernommen werden`, msg);
      }
      return "failed";
    }
  }
  await channex.ack(rev.id);
  return "acked";
}

/**
 * Job `channex-feed`: alle offenen Revisionen holen (älteste zuerst) und verarbeiten.
 * Der Feed liefert nur nicht bestätigte Revisionen; nach dem Ack wird die nächste Seite neu geladen.
 */
// ASSUMPTION: Paginierung über erneutes Laden der ersten Seite (die Doku nennt keine Parameternamen). Fehlgeschlagene
// Revisionen werden im selben Lauf übersprungen; sind es mehr als eine Seite (10), wartet der Rest auf den nächsten Lauf.
export async function pullFeed(): Promise<{ acked: number; failed: number }> {
  if (!env().CHANNEX_API_KEY) return { acked: 0, failed: 0 };
  const failedRevisions = new Set<string>();
  const blockedBookings = new Set<string>(); // Reihenfolge pro booking_id einhalten
  let acked = 0;
  for (let round = 0; round < 100; round++) {
    const page = await channex.feed();
    const revs = (page.data ?? []).map((d) => ({ ...d.attributes, id: d.attributes?.id ?? d.id })).filter((r) => !failedRevisions.has(r.id));
    if (!revs.length) break;
    let progressed = false;
    for (const rev of revs) {
      if (blockedBookings.has(rev.booking_id)) {
        failedRevisions.add(rev.id);
        continue;
      }
      if ((await handleRevision(rev)) === "acked") {
        acked++;
        progressed = true;
      } else {
        failedRevisions.add(rev.id);
        blockedBookings.add(rev.booking_id);
      }
    }
    if (!progressed) break;
  }
  return { acked, failed: failedRevisions.size };
}

