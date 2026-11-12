import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { channexChannels, hotels, ratePlans, roomTypes, type Hotel } from "../../db/schema";
import { audit } from "../../services/audit";
import { channex, ChannexHttpError, type BookingMappingDetails } from "./client";
import { buildBookingMappings, MappingError, type PlanOption } from "./booking-mapping";
import { channexGroupId, channexPlanOptions } from "./lookups";

/**
 * Kanäle mit Hotel-ID und Zimmer/Tarif-Zuordnung direkt aus dem Pontivo-Admin verbinden (Channex Channel API,
 * Adapter-Art "meta", mapping_mode room_rate_multioccupancy): Booking.com und Expedia.
 * Ablauf: Hotel-ID prüfen → Zimmer/Tarife lesen → zuordnen → Verbindung anlegen (inaktiv) → aktivieren → bestehende Buchungen laden.
 * Airbnb läuft anders (OAuth, Zuordnung je Inserat) und steht in airbnb.ts.
 */
export type MetaChannel = "BookingCom" | "Expedia";

export const META_CHANNELS: Record<
  MetaChannel,
  { label: string; path: string; audit: string; idExample: string; notAccepted: string }
> = {
  BookingCom: {
    label: "Booking.com",
    path: "booking",
    audit: "booking",
    idExample: "5868189",
    notAccepted:
      "Booking.com hat die Hotel-ID nicht akzeptiert. Prüfen Sie die ID und ob im Booking.com-Extranet Channex als Konnektivitätsanbieter (Connectivity Provider) ausgewählt ist.",
  },
  Expedia: {
    label: "Expedia",
    path: "expedia",
    audit: "expedia",
    idExample: "12345678",
    notAccepted:
      "Expedia hat die Hotel-ID nicht akzeptiert. Prüfen Sie die ID und ob das Hotel bei Expedia den Zugriff für Channex freigegeben hat (Anleitung im Channex-Leitfaden zu Expedia).",
  },
};

export function parseMetaChannel(v: unknown): MetaChannel {
  if (v === "BookingCom" || v === "Expedia") return v;
  throw new Error("Unbekannter Kanal");
}

/** Expedia-Einstellungen laut Channex-Adapter (GET /channels/adapter?code=Expedia): min_stay_type, booking_amount_settings */
export const EXPEDIA_MIN_STAY = ["Arrival", "Through"] as const;
export const EXPEDIA_BOOKING_AMOUNT = ["Collect Amount", "Total Amount", "Total Amount Excluding Tax"] as const;

export type BookingChannelDetails = BookingMappingDetails & {
  currency?: string | null;
  /** Expedia: Mindestaufenthalt je Anreise- oder Aufenthaltstag */
  minStayType?: (typeof EXPEDIA_MIN_STAY)[number];
  /** Expedia: welcher Betrag in der Buchung steht */
  bookingAmount?: (typeof EXPEDIA_BOOKING_AMOUNT)[number];
};
export type BookingChannel = typeof channexChannels.$inferSelect & { details: BookingChannelDetails; externalId: string };

export async function getMetaChannel(hotelId: string, channel: MetaChannel): Promise<BookingChannel | null> {
  const [row] = await db()
    .select()
    .from(channexChannels)
    .where(and(eq(channexChannels.hotelId, hotelId), eq(channexChannels.channel, channel)));
  return (row as BookingChannel) ?? null;
}
export const getBookingChannel = (hotelId: string) => getMetaChannel(hotelId, "BookingCom");

/** Einstellungen für POST /channels (Booking.com: nur hotel_id) */
function createSettings(ch: BookingChannel): Record<string, unknown> {
  if (ch.channel === "Expedia") {
    // ASSUMPTION: Standard Channex-Vorgabe für Auszahlung ("Collect Amount"); Mindestaufenthalt je Anreisetag wie bei Airbnb.
    return { hotel_id: ch.externalId, min_stay_type: ch.details.minStayType ?? "Arrival", booking_amount_settings: ch.details.bookingAmount ?? "Collect Amount" };
  }
  return { hotel_id: ch.externalId };
}

/** Fehlertext für den Admin (Channex-Fehler verständlich, Rest unverändert) */
export function channelErrorText(e: unknown, label = "Booking.com"): string {
  if (e instanceof MappingError) return e.message;
  if (e instanceof ChannexHttpError && /same settings already exists/.test(JSON.stringify(e.body))) {
    return `Diese ${label} Hotel-ID ist bei Channex schon verbunden (auch über ein anderes Konto möglich). Jede Hotel-ID lässt sich nur einmal verbinden.`;
  }
  if (e instanceof ChannexHttpError) {
    const body = e.body as { errors?: { title?: string; details?: unknown } } | null;
    const det = body?.errors?.details;
    const detail = det ? (typeof det === "string" ? det : JSON.stringify(det)) : body?.errors?.title;
    return `Channex meldet einen Fehler (HTTP ${e.status})${detail ? `: ${detail}` : ""}`;
  }
  return (e as Error).message;
}

/** Schritt 1–4: Hotel-ID testen, Zimmer/Tarife und Währung des Kanals lesen und als Entwurf speichern */
export async function probeMetaChannel(
  hotel: Hotel,
  channel: MetaChannel,
  externalHotelId: string,
  actor: string,
  opts: { minStayType?: string; bookingAmount?: string } = {},
): Promise<BookingChannel> {
  const cfg = META_CHANNELS[channel];
  const id = externalHotelId.trim();
  if (!/^\d{3,12}$/.test(id)) {
    // ASSUMPTION: Auch Expedia-Hotel-IDs bestehen nur aus Ziffern (Channex-Beispiel/Erfahrung; auf Staging nicht geprüft).
    throw new Error(`Die ${cfg.label} Hotel-ID besteht nur aus Ziffern`);
  }
  if (!hotel.channexPropertyId) throw new Error("Zuerst den Betrieb in Channex anlegen (Abschnitt Zuordnung)");
  const existing = await getMetaChannel(hotel.id, channel);
  if (existing?.channexChannelId && existing.externalId !== id) {
    throw new Error(`Es besteht schon eine Verbindung zu einer anderen ${cfg.label} Hotel-ID. Zuerst diese Verbindung entfernen.`);
  }
  const minStayType = channel === "Expedia" ? pick(EXPEDIA_MIN_STAY, opts.minStayType, existing?.details.minStayType) : undefined;
  const bookingAmount = channel === "Expedia" ? pick(EXPEDIA_BOOKING_AMOUNT, opts.bookingAmount, existing?.details.bookingAmount) : undefined;
  const settings = { hotel_id: id };
  const test = await channex.testConnection(channel, settings);
  if (!test.data.success) throw new Error(cfg.notAccepted);
  const mapping = (await channex.mappingDetails(channel, settings)).data;
  let currency: string | null = null;
  try {
    currency = (await channex.connectionDetails(channel, settings)).data.attributes.currency ?? null;
  } catch {
    // Nur Information (Channex rechnet die Währung selbst um)
  }
  // ASSUMPTION (Expedia): mapping_details liefert dieselbe Form wie bei Booking.com (pricing_type, rooms[].rates[]); auf Staging
  // ohne Expedia-Testhotel nicht prüfbar (QUESTIONS.md). Fehlt pricing_type, gilt "Standard" (Preis pro Zimmer).
  const details: BookingChannelDetails = {
    pricing_type: mapping.pricing_type ?? "Standard",
    rooms: mapping.rooms ?? [],
    currency,
    ...(minStayType ? { minStayType } : {}),
    ...(bookingAmount ? { bookingAmount } : {}),
  };
  if (existing) {
    await db()
      .update(channexChannels)
      .set({ externalId: id, details, lastError: null, updatedAt: new Date() })
      .where(and(eq(channexChannels.id, existing.id), eq(channexChannels.hotelId, hotel.id)));
  } else {
    await db().insert(channexChannels).values({ hotelId: hotel.id, channel, externalId: id, details });
  }
  await audit(db(), { hotelId: hotel.id, actor, action: `channel.${cfg.audit}.probe`, entity: "hotel", entityId: hotel.id, details: { externalHotelId: id } });
  return (await getMetaChannel(hotel.id, channel))!;
}

function pick<T extends string>(allowed: readonly T[], value: string | undefined, fallback: T | undefined): T | undefined {
  if (value === undefined || value === "") return fallback;
  if (!(allowed as readonly string[]).includes(value)) throw new Error("Ungültige Einstellung");
  return value as T;
}

export const probeBookingChannel = (hotel: Hotel, bookingHotelId: string, actor: string) => probeMetaChannel(hotel, "BookingCom", bookingHotelId, actor);

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
export async function saveMetaMapping(hotel: Hotel, channel: MetaChannel, selection: Record<string, string>, actor: string): Promise<void> {
  const cfg = META_CHANNELS[channel];
  const ch = await getMetaChannel(hotel.id, channel);
  if (!ch) throw new Error(`Zuerst die ${cfg.label} Hotel-ID prüfen`);
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
        channel,
        group_id: groupId,
        title: `${cfg.label} – ${hotel.name}`,
        properties: [fresh.channexPropertyId],
        settings: createSettings(ch),
        rate_plans: items,
      });
      await db()
        .update(channexChannels)
        .set({ channexChannelId: res.data.id, status: "inactive", selection: clean, mappings: items, lastError: null, updatedAt: new Date() })
        .where(and(eq(channexChannels.id, ch.id), eq(channexChannels.hotelId, hotel.id)));
    } else {
      // rate_plans ersetzt die gesamte Zuordnung (Leitfaden: Updating a connection)
      await channex.updateChannel(ch.channexChannelId, { channel, rate_plans: items });
      await db()
        .update(channexChannels)
        .set({ selection: clean, mappings: items, lastError: null, updatedAt: new Date() })
        .where(and(eq(channexChannels.id, ch.id), eq(channexChannels.hotelId, hotel.id)));
    }
  } catch (e) {
    await setError(hotel.id, ch.id, channelErrorText(e, cfg.label));
    throw e;
  }
  await audit(db(), { hotelId: hotel.id, actor, action: `channel.${cfg.audit}.mapping`, entity: "hotel", entityId: hotel.id, details: { mappings: items.length } });
}
export const saveBookingMapping = (hotel: Hotel, selection: Record<string, string>, actor: string) => saveMetaMapping(hotel, "BookingCom", selection, actor);

/** Schritt 8: Bereitschaft prüfen, aktivieren (Channex sendet den Vollstand an den Kanal), bestehende Buchungen laden */
export async function activateMetaChannel(hotel: Hotel, channel: MetaChannel, actor: string): Promise<{ loaded: boolean }> {
  const cfg = META_CHANNELS[channel];
  const ch = await getMetaChannel(hotel.id, channel);
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
  // Bestehende künftige Reservationen holen (Aktion load_future_reservations; bei Booking.com und Expedia laut Channex-Adapter vorhanden)
  let loaded = true;
  try {
    await channex.executeChannelAction(ch.channexChannelId, "load_future_reservations");
  } catch (e) {
    loaded = false;
    await setError(hotel.id, ch.id, `Aktiv, aber bestehende Buchungen konnten nicht geladen werden: ${channelErrorText(e, cfg.label)}`);
  }
  await audit(db(), { hotelId: hotel.id, actor, action: `channel.${cfg.audit}.activate`, entity: "hotel", entityId: hotel.id, details: { loaded } });
  return { loaded };
}
export const activateBookingChannel = (hotel: Hotel, actor: string) => activateMetaChannel(hotel, "BookingCom", actor);

export async function deactivateMetaChannel(hotel: Hotel, channel: MetaChannel, actor: string): Promise<void> {
  const ch = await getMetaChannel(hotel.id, channel);
  if (!ch?.channexChannelId) throw new Error("Keine Verbindung vorhanden");
  await channex.deactivateChannel(ch.channexChannelId);
  await db()
    .update(channexChannels)
    .set({ status: "inactive", updatedAt: new Date() })
    .where(and(eq(channexChannels.id, ch.id), eq(channexChannels.hotelId, hotel.id)));
  await audit(db(), { hotelId: hotel.id, actor, action: `channel.${META_CHANNELS[channel].audit}.deactivate`, entity: "hotel", entityId: hotel.id });
}
export const deactivateBookingChannel = (hotel: Hotel, actor: string) => deactivateMetaChannel(hotel, "BookingCom", actor);

/** Verbindung entfernen (aktive zuerst deaktivieren). Bereits erhaltene Buchungen bleiben. */
export async function removeMetaChannel(hotel: Hotel, channel: MetaChannel, actor: string): Promise<void> {
  const ch = await getMetaChannel(hotel.id, channel);
  if (!ch) return;
  if (ch.channexChannelId) {
    if (ch.status === "active") await channex.deactivateChannel(ch.channexChannelId);
    await channex.deleteChannel(ch.channexChannelId);
  }
  await db().delete(channexChannels).where(and(eq(channexChannels.id, ch.id), eq(channexChannels.hotelId, hotel.id)));
  await audit(db(), { hotelId: hotel.id, actor, action: `channel.${META_CHANNELS[channel].audit}.remove`, entity: "hotel", entityId: hotel.id, details: { externalHotelId: ch.externalId } });
}
export const removeBookingChannel = (hotel: Hotel, actor: string) => removeMetaChannel(hotel, "BookingCom", actor);

async function setError(hotelId: string, id: string, msg: string) {
  await db()
    .update(channexChannels)
    .set({ lastError: msg, updatedAt: new Date() })
    .where(and(eq(channexChannels.id, id), eq(channexChannels.hotelId, hotelId)));
}

export type { PlanOption };
