import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { channexChannels, hotels, ratePlans, type Hotel } from "../../db/schema";
import { env } from "../../env";
import { audit } from "../../services/audit";
import { channex, type AirbnbListing } from "./client";
import { channexGroupId } from "./lookups";

/**
 * Airbnb direkt aus dem Pontivo-Admin verbinden (Channex, Leitfaden Airbnb):
 * Verbindungs-Link (OAuth bei Airbnb) → Rücksprung mit channel_id → Inserate auflisten → je Inserat einem Pontivo-Tarif
 * zuordnen → aktivieren → bestehende Reservationen je Inserat laden.
 */
const CHANNEL = "Airbnb" as const;
const LINK_VALID_MS = 2 * 60 * 60 * 1000; // Link laut Doku 2 Stunden gültig

/** Zuordnung Inserat ↔ Pontivo-Tarif (in channex_channels.mappings) */
export type AirbnbMapping = { mappingId: string; listingId: string; listingTitle: string; ratePlanId: string };
export type AirbnbChannel = Omit<typeof channexChannels.$inferSelect, "mappings"> & { mappings: AirbnbMapping[] };

export async function getAirbnbChannel(hotelId: string): Promise<AirbnbChannel | null> {
  const [row] = await db()
    .select()
    .from(channexChannels)
    .where(and(eq(channexChannels.hotelId, hotelId), eq(channexChannels.channel, CHANNEL)));
  return (row as AirbnbChannel) ?? null;
}

const returnUrl = (hotelId: string) => `${env().APP_BASE_URL.replace(/\/$/, "")}/admin/${hotelId}/channex/airbnb/return`;

/**
 * Schritt 1: Verbindungs-Link erzeugen. Bei bestehender Verbindung wird sie neu verbunden (channel_id), z. B. wenn
 * der Gastgeber die Freigabe auf Airbnb entzogen hat. Das Token kommt beim Rücksprung zurück und wird dort geprüft.
 */
export async function airbnbConnectLink(hotel: Hotel, actor: string): Promise<string> {
  const [fresh] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  if (!fresh.channexPropertyId) throw new Error("Zuerst den Betrieb in Channex anlegen");
  const groupId = await channexGroupId(fresh);
  const existing = await getAirbnbChannel(hotel.id);
  const token = crypto.randomBytes(24).toString("base64url");
  const res = await channex.airbnbConnectionLink({
    group_id: groupId,
    properties: [fresh.channexPropertyId],
    ...(existing?.channexChannelId ? { channel_id: existing.channexChannelId } : {}),
    redirect_uri: returnUrl(hotel.id),
    failure_redirect_uri: returnUrl(hotel.id),
    token,
    title: `Airbnb – ${hotel.name}`,
    // Pontivo führt den Mindestaufenthalt bei Anreise (min_stay_arrival)
    settings: { min_stay_type: "Arrival" },
  });
  const expires = new Date(Date.now() + LINK_VALID_MS);
  if (existing) {
    await db()
      .update(channexChannels)
      .set({ authToken: token, authExpiresAt: expires, updatedAt: new Date() })
      .where(and(eq(channexChannels.id, existing.id), eq(channexChannels.hotelId, hotel.id)));
  } else {
    await db().insert(channexChannels).values({ hotelId: hotel.id, channel: CHANNEL, authToken: token, authExpiresAt: expires, mappings: [] });
  }
  await audit(db(), { hotelId: hotel.id, actor, action: "channel.airbnb.link", entity: "hotel", entityId: hotel.id });
  return res.data.attributes.url;
}

/** Schritt 2: Rücksprung von Airbnb/Channex. Prüft Token, Ablauf und dass die Verbindung zu unserer Property gehört. */
export async function airbnbHandleReturn(
  hotel: Hotel,
  q: { success?: string | null; channel_id?: string | null; token?: string | null },
  actor: string,
): Promise<string> {
  const ch = await getAirbnbChannel(hotel.id);
  if (q.success !== "true") {
    if (ch) await setError(hotel.id, ch.id, "Die Freigabe auf Airbnb wurde abgebrochen oder ist fehlgeschlagen.");
    return "Airbnb wurde nicht verbunden. Bitte erneut versuchen.";
  }
  const token = q.token ?? "";
  const ok =
    !!ch?.authToken &&
    token.length === ch.authToken.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ch.authToken)) &&
    !!ch.authExpiresAt &&
    ch.authExpiresAt.getTime() > Date.now();
  if (!ok || !ch) throw new Error("Der Rücksprung von Airbnb ist ungültig oder abgelaufen. Bitte die Verbindung neu starten.");
  const channelId = String(q.channel_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(channelId)) throw new Error("Ungültige Verbindungs-ID von Channex");
  const remote = await channex.getChannel(channelId);
  if (hotel.channexPropertyId && !remote.data.attributes.properties.includes(hotel.channexPropertyId)) {
    throw new Error("Die Airbnb-Verbindung gehört nicht zu diesem Betrieb");
  }
  await db()
    .update(channexChannels)
    .set({
      channexChannelId: channelId,
      status: remote.data.attributes.is_active ? "active" : "inactive",
      authToken: null,
      authExpiresAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(channexChannels.id, ch.id), eq(channexChannels.hotelId, hotel.id)));
  await audit(db(), { hotelId: hotel.id, actor, action: "channel.airbnb.connected", entity: "hotel", entityId: hotel.id, details: { channelId } });
  return "Airbnb-Konto verbunden. Jetzt die Inserate zuordnen.";
}

/** Schritt 4: Inserate des verbundenen Airbnb-Kontos */
export async function airbnbListings(hotelId: string): Promise<AirbnbListing[]> {
  const ch = await getAirbnbChannel(hotelId);
  if (!ch?.channexChannelId) return [];
  return (await channex.airbnbListings(ch.channexChannelId)).data.listing_id_dictionary.values;
}

/** Schritt 5: ein Inserat einem Pontivo-Tarif zuordnen (Airbnb bestätigt im Hintergrund, ca. 30 Sekunden) */
export async function mapAirbnbListing(hotel: Hotel, listingId: string, ratePlanId: string, actor: string): Promise<void> {
  const ch = await getAirbnbChannel(hotel.id);
  if (!ch?.channexChannelId) throw new Error("Zuerst das Airbnb-Konto verbinden");
  if (ch.mappings.some((m) => m.listingId === listingId)) throw new Error("Dieses Inserat ist schon zugeordnet");
  if (ch.mappings.some((m) => m.ratePlanId === ratePlanId)) throw new Error("Dieser Tarif ist schon einem anderen Inserat zugeordnet");
  const [plan] = await db().select().from(ratePlans).where(and(eq(ratePlans.id, ratePlanId), eq(ratePlans.hotelId, hotel.id)));
  if (!plan) throw new Error("Unbekannter Tarif");
  if (!plan.channexRatePlanId) throw new Error(`Tarif «${plan.name}» ist noch nicht in Channex angelegt`);
  const listing = (await airbnbListings(hotel.id)).find((l) => l.id === listingId);
  if (!listing) throw new Error("Inserat nicht im verbundenen Airbnb-Konto gefunden");
  const res = await channex.createMapping(ch.channexChannelId, { rate_plan_id: plan.channexRatePlanId, settings: { listing_id: listingId } });
  const mappings = [...ch.mappings, { mappingId: res.data.id, listingId, listingTitle: listing.title, ratePlanId }];
  await db()
    .update(channexChannels)
    .set({ mappings, lastError: null, updatedAt: new Date() })
    .where(and(eq(channexChannels.id, ch.id), eq(channexChannels.hotelId, hotel.id)));
  // Schon aktive Verbindung: bestehende Reservationen dieses Inserats sofort holen
  if (ch.status === "active") await loadReservations(hotel.id, ch.id, ch.channexChannelId, [listingId]);
  await audit(db(), { hotelId: hotel.id, actor, action: "channel.airbnb.map", entity: "hotel", entityId: hotel.id, details: { listingId, ratePlanId } });
}

/** Zuordnung eines Inserats aufheben (Airbnb bestätigt im Hintergrund) */
export async function unmapAirbnbListing(hotel: Hotel, listingId: string, actor: string): Promise<void> {
  const ch = await getAirbnbChannel(hotel.id);
  const m = ch?.mappings.find((x) => x.listingId === listingId);
  if (!ch?.channexChannelId || !m) throw new Error("Zuordnung nicht gefunden");
  await channex.deleteMapping(ch.channexChannelId, m.mappingId);
  await db()
    .update(channexChannels)
    .set({ mappings: ch.mappings.filter((x) => x.listingId !== listingId), updatedAt: new Date() })
    .where(and(eq(channexChannels.id, ch.id), eq(channexChannels.hotelId, hotel.id)));
  await audit(db(), { hotelId: hotel.id, actor, action: "channel.airbnb.unmap", entity: "hotel", entityId: hotel.id, details: { listingId } });
}

/** Schritt 6+7: aktivieren und bestehende Reservationen je Inserat laden */
export async function activateAirbnb(hotel: Hotel, actor: string): Promise<{ loaded: boolean }> {
  const ch = await getAirbnbChannel(hotel.id);
  if (!ch?.channexChannelId) throw new Error("Zuerst das Airbnb-Konto verbinden");
  if (!ch.mappings.length) throw new Error("Zuerst mindestens ein Inserat zuordnen");
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
  const loaded = await loadReservations(hotel.id, ch.id, ch.channexChannelId, ch.mappings.map((m) => m.listingId));
  await audit(db(), { hotelId: hotel.id, actor, action: "channel.airbnb.activate", entity: "hotel", entityId: hotel.id, details: { loaded } });
  return { loaded };
}

/**
 * Verbindung entfernen. Laut Doku müssen bei Airbnb zuerst alle Zuordnungen entfernt werden, bevor die Verbindung
 * deaktiviert werden kann; danach löschen. Bereits erhaltene Buchungen bleiben.
 */
export async function removeAirbnb(hotel: Hotel, actor: string): Promise<void> {
  const ch = await getAirbnbChannel(hotel.id);
  if (!ch) return;
  if (ch.channexChannelId) {
    for (const m of ch.mappings) await channex.deleteMapping(ch.channexChannelId, m.mappingId);
    if (ch.status === "active") await channex.deactivateChannel(ch.channexChannelId);
    await channex.deleteChannel(ch.channexChannelId);
  }
  await db().delete(channexChannels).where(and(eq(channexChannels.id, ch.id), eq(channexChannels.hotelId, hotel.id)));
  await audit(db(), { hotelId: hotel.id, actor, action: "channel.airbnb.remove", entity: "hotel", entityId: hotel.id });
}

async function loadReservations(hotelId: string, rowId: string, channelId: string, listingIds: string[]): Promise<boolean> {
  let ok = true;
  for (const listingId of listingIds) {
    try {
      await channex.executeChannelAction(channelId, "load_future_reservations", { listing_id: listingId });
    } catch {
      ok = false;
    }
  }
  if (!ok) await setError(hotelId, rowId, "Aktiv, aber bestehende Reservationen konnten nicht für alle Inserate geladen werden.");
  return ok;
}

async function setError(hotelId: string, id: string, msg: string) {
  await db()
    .update(channexChannels)
    .set({ lastError: msg, updatedAt: new Date() })
    .where(and(eq(channexChannels.id, id), eq(channexChannels.hotelId, hotelId)));
}
