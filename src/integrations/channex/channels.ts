import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { channexChannels, hotels, ratePlans, roomTypes, type Hotel } from "../../db/schema";
import { audit } from "../../services/audit";
import { channex, ChannexHttpError, type BookingMappingDetails } from "./client";
import { buildBookingMappings, MappingError, type PlanOption } from "./booking-mapping";
import { channexGroupId, channexPlanOptions } from "./lookups";

/**
 * Booking.com direkt aus dem Pontivo-Admin verbinden (Channex Channel API, Leitfaden Booking.com):
 * Hotel-ID prüfen → Zimmer/Tarife lesen → zuordnen → Verbindung anlegen (inaktiv) → aktivieren → bestehende Buchungen laden.
 */
const CHANNEL = "BookingCom" as const;

export type BookingChannelDetails = BookingMappingDetails & { currency?: string | null };
export type BookingChannel = typeof channexChannels.$inferSelect & { details: BookingChannelDetails };

export async function getBookingChannel(hotelId: string): Promise<BookingChannel | null> {
  const [row] = await db()
    .select()
    .from(channexChannels)
    .where(and(eq(channexChannels.hotelId, hotelId), eq(channexChannels.channel, CHANNEL)));
  return (row as BookingChannel) ?? null;
}

/** Fehlertext für den Admin (Channex-Fehler verständlich, Rest unverändert) */
export function channelErrorText(e: unknown): string {
  if (e instanceof MappingError) return e.message;
  if (e instanceof ChannexHttpError) {
    const body = e.body as { errors?: { title?: string; details?: unknown } } | null;
    const det = body?.errors?.details;
    const detail = det ? (typeof det === "string" ? det : JSON.stringify(det)) : body?.errors?.title;
    return `Channex meldet einen Fehler (HTTP ${e.status})${detail ? `: ${detail}` : ""}`;
  }
  return (e as Error).message;
}

/** Schritt 1–4: Hotel-ID testen, Zimmer/Tarife und Währung von Booking.com lesen und als Entwurf speichern */
export async function probeBookingChannel(hotel: Hotel, bookingHotelId: string, actor: string): Promise<BookingChannel> {
  const id = bookingHotelId.trim();
  if (!/^\d{3,12}$/.test(id)) throw new Error("Die Booking.com Hotel-ID besteht nur aus Ziffern (im Extranet oben links)");
  if (!hotel.channexPropertyId) throw new Error("Zuerst den Betrieb in Channex anlegen (Abschnitt Zuordnung)");
  const existing = await getBookingChannel(hotel.id);
  if (existing?.channexChannelId && existing.externalId !== id) {
    throw new Error("Es besteht schon eine Verbindung zu einer anderen Booking.com Hotel-ID. Zuerst diese Verbindung entfernen.");
  }
  const settings = { hotel_id: id };
  const test = await channex.testConnection(CHANNEL, settings);
  if (!test.data.success) {
    throw new Error(
      "Booking.com hat die Hotel-ID nicht akzeptiert. Prüfen Sie die ID und ob im Booking.com-Extranet Channex als Konnektivitätsanbieter (Connectivity Provider) ausgewählt ist.",
    );
  }
  const mapping = (await channex.mappingDetails(CHANNEL, settings)).data;
  let currency: string | null = null;
  try {
    currency = (await channex.connectionDetails(CHANNEL, settings)).data.attributes.currency ?? null;
  } catch {
    // Nur Information (Channex rechnet die Währung selbst um)
  }
  const details: BookingChannelDetails = { pricing_type: mapping.pricing_type, rooms: mapping.rooms, currency };
  if (existing) {
    await db()
      .update(channexChannels)
      .set({ externalId: id, details, lastError: null, updatedAt: new Date() })
      .where(and(eq(channexChannels.id, existing.id), eq(channexChannels.hotelId, hotel.id)));
  } else {
    await db().insert(channexChannels).values({ hotelId: hotel.id, channel: CHANNEL, externalId: id, details });
  }
  await audit(db(), { hotelId: hotel.id, actor, action: "channel.booking.probe", entity: "hotel", entityId: hotel.id, details: { bookingHotelId: id } });
  return (await getBookingChannel(hotel.id))!;
}

/** Pontivo-Tarife mit Channex-ID (für Auswahl und Zuordnung) */
export async function mappablePlans(hotelId: string) {
  return db()
    .select({ id: ratePlans.id, name: ratePlans.name, roomName: roomTypes.name, channexRatePlanId: ratePlans.channexRatePlanId })
    .from(ratePlans)
    .innerJoin(roomTypes, eq(roomTypes.id, ratePlans.roomTypeId))
    .where(and(eq(ratePlans.hotelId, hotelId), eq(ratePlans.active, true)))
    .orderBy(roomTypes.sortOrder, ratePlans.createdAt);
}

/** Schritt 5–7: Zuordnung bauen und die Verbindung in Channex anlegen bzw. die Zuordnung ersetzen */
export async function saveBookingMapping(hotel: Hotel, selection: Record<string, string>, actor: string): Promise<void> {
  const ch = await getBookingChannel(hotel.id);
  if (!ch) throw new Error("Zuerst die Booking.com Hotel-ID prüfen");
  const [fresh] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  if (!fresh.channexPropertyId) throw new Error("Zuerst den Betrieb in Channex anlegen");
  const plans = await mappablePlans(hotel.id);
  const own = new Set(plans.map((p) => p.id));
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(selection)) {
    if (!v) continue;
    if (!own.has(v)) throw new Error("Unbekannter Tarif in der Auswahl");
    clean[k] = v;
  }
  const options = await channexPlanOptions(fresh, plans);
  const names = new Map(plans.map((p) => [p.id, `${p.roomName} – ${p.name}`]));
  const items = buildBookingMappings(ch.details, clean, options, names);
  const groupId = await channexGroupId(fresh);
  try {
    if (!ch.channexChannelId) {
      const res = await channex.createChannel({
        channel: CHANNEL,
        group_id: groupId,
        title: `Booking.com – ${hotel.name}`,
        properties: [fresh.channexPropertyId],
        settings: { hotel_id: ch.externalId },
        rate_plans: items,
      });
      await db()
        .update(channexChannels)
        .set({ channexChannelId: res.data.id, status: "inactive", selection: clean, mappings: items, lastError: null, updatedAt: new Date() })
        .where(and(eq(channexChannels.id, ch.id), eq(channexChannels.hotelId, hotel.id)));
    } else {
      // rate_plans ersetzt die gesamte Zuordnung (Leitfaden: Updating a connection)
      await channex.updateChannel(ch.channexChannelId, { channel: CHANNEL, rate_plans: items });
      await db()
        .update(channexChannels)
        .set({ selection: clean, mappings: items, lastError: null, updatedAt: new Date() })
        .where(and(eq(channexChannels.id, ch.id), eq(channexChannels.hotelId, hotel.id)));
    }
  } catch (e) {
    await setError(hotel.id, ch.id, channelErrorText(e));
    throw e;
  }
  await audit(db(), { hotelId: hotel.id, actor, action: "channel.booking.mapping", entity: "hotel", entityId: hotel.id, details: { mappings: items.length } });
}

/** Schritt 8: Bereitschaft prüfen, aktivieren (Channex sendet den Vollstand an Booking.com), bestehende Buchungen laden */
export async function activateBookingChannel(hotel: Hotel, actor: string): Promise<{ loaded: boolean }> {
  const ch = await getBookingChannel(hotel.id);
  if (!ch?.channexChannelId) throw new Error("Zuerst die Zuordnung speichern");
  const [fresh] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  if (!fresh.channexEnabled) throw new Error("Zuerst auf der Channex-Seite den Abgleich einschalten, damit Preise und Verfügbarkeit in Channex aktuell sind");
  const issues = (await channex.checkReadiness(ch.channexChannelId)).data;
  if (issues.length) {
    const text = issues.map((i) => `${i.entity} ${i.relation}: ${i.error_code}`).join("; ");
    await setError(hotel.id, ch.id, `Noch nicht bereit: ${text}`);
    throw new Error(`Die Verbindung ist noch nicht bereit (${text})`);
  }
  await channex.activateChannel(ch.channexChannelId);
  await db()
    .update(channexChannels)
    .set({ status: "active", lastError: null, updatedAt: new Date() })
    .where(and(eq(channexChannels.id, ch.id), eq(channexChannels.hotelId, hotel.id)));
  // Bestehende künftige Reservationen von Booking.com holen (Leitfaden: Actions, load_future_reservations)
  let loaded = true;
  try {
    await channex.executeChannelAction(ch.channexChannelId, "load_future_reservations");
  } catch (e) {
    loaded = false;
    await setError(hotel.id, ch.id, `Aktiv, aber bestehende Buchungen konnten nicht geladen werden: ${channelErrorText(e)}`);
  }
  await audit(db(), { hotelId: hotel.id, actor, action: "channel.booking.activate", entity: "hotel", entityId: hotel.id, details: { loaded } });
  return { loaded };
}

export async function deactivateBookingChannel(hotel: Hotel, actor: string): Promise<void> {
  const ch = await getBookingChannel(hotel.id);
  if (!ch?.channexChannelId) throw new Error("Keine Verbindung vorhanden");
  await channex.deactivateChannel(ch.channexChannelId);
  await db()
    .update(channexChannels)
    .set({ status: "inactive", updatedAt: new Date() })
    .where(and(eq(channexChannels.id, ch.id), eq(channexChannels.hotelId, hotel.id)));
  await audit(db(), { hotelId: hotel.id, actor, action: "channel.booking.deactivate", entity: "hotel", entityId: hotel.id });
}

/** Verbindung entfernen (aktive zuerst deaktivieren). Bereits erhaltene Buchungen bleiben. */
export async function removeBookingChannel(hotel: Hotel, actor: string): Promise<void> {
  const ch = await getBookingChannel(hotel.id);
  if (!ch) return;
  if (ch.channexChannelId) {
    if (ch.status === "active") await channex.deactivateChannel(ch.channexChannelId);
    await channex.deleteChannel(ch.channexChannelId);
  }
  await db().delete(channexChannels).where(and(eq(channexChannels.id, ch.id), eq(channexChannels.hotelId, hotel.id)));
  await audit(db(), { hotelId: hotel.id, actor, action: "channel.booking.remove", entity: "hotel", entityId: hotel.id, details: { bookingHotelId: ch.externalId } });
}

async function setError(hotelId: string, id: string, msg: string) {
  await db()
    .update(channexChannels)
    .set({ lastError: msg, updatedAt: new Date() })
    .where(and(eq(channexChannels.id, id), eq(channexChannels.hotelId, hotelId)));
}

export type { PlanOption };
