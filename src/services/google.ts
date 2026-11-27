import { and, eq, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { hotelModules, hotels, ratePlans, roomTypes, type Hotel } from "../db/schema";
import { UserError } from "../domain/errors";
import { actionFeed, entityFeed, feedDescriptor, googleLinks, listingChecklist, type FeedEntity, type GoogleLinks, type CheckItem } from "../domain/google";
import { plainText } from "../domain/richtext";
import type { Block } from "../domain/blocks";
import { audit } from "./audit";
import { moduleDef } from "../domain/modules";
import { moduleOn } from "./modules";
import { publicBase } from "./brand";
import { listPages } from "./site";
import { orderSettings, onlineOrderingOn } from "./online-orders";
import { tableReservationOnline } from "./reservations";
import { raiseAlert } from "./monitor";

/**
 * Google (SPEC 19.67): Links für das Unternehmensprofil, kostenlose Buchungslinks über Channex (Hotels),
 * Reservieren und Bestellen über das Actions Center (Restaurants). Einstellungen im Modul «google» (hotel_modules.settings).
 */
export class GoogleError extends UserError {}

export type HotelLinksStatus = "off" | "requested" | "active";
/** `partner`: der Betrieb steht im eigenen Google-Partnerfeed von Pontivo (SPEC 19.70), ohne Channex-Kanal */
export type GoogleSettings = { reserve: boolean; order: boolean; hotelLinks: HotelLinksStatus; partner: boolean; requestedAt?: string; activeAt?: string };
const DEFAULTS: GoogleSettings = { reserve: false, order: false, hotelLinks: "off", partner: false };

export async function googleSettings(hotelId: string): Promise<GoogleSettings & { enabled: boolean }> {
  const [r] = await db().select().from(hotelModules).where(and(eq(hotelModules.hotelId, hotelId), eq(hotelModules.module, "google")));
  return { ...DEFAULTS, ...((r?.settings ?? {}) as Partial<GoogleSettings>), enabled: r ? r.enabled : moduleDef("google")!.defaultOn };
}

export async function writeSettings(hotelId: string, patch: Partial<GoogleSettings>, actor: string, action: string) {
  const cur = await googleSettings(hotelId);
  const { enabled: _e, ...rest } = cur;
  const next = { ...rest, ...patch };
  await db().transaction(async (tx) => {
    await tx.insert(hotelModules).values({ hotelId, module: "google", enabled: cur.enabled, settings: next })
      .onConflictDoUpdate({ target: [hotelModules.hotelId, hotelModules.module], set: { settings: next } });
    await audit(tx, { hotelId, actor, action, entity: "hotel_modules", entityId: hotelId, details: patch });
  });
}

/** Restaurant: Reservieren und Bestellen über Google (Actions Center) ein- oder ausschalten */
export async function saveGoogleDining(hotel: Hotel, v: { reserve: boolean; order: boolean }, actor: string) {
  if (v.reserve && !(await tableReservationOnline(hotel.id))) throw new GoogleError("Zuerst die Online-Reservation einschalten (Einstellungen → Reservation).");
  if (v.order && !(await onlineOrderingOn(hotel.id))) throw new GoogleError("Zuerst die Online-Bestellung live schalten (Einstellungen → Bestellung).");
  await writeSettings(hotel.id, v, actor, "google.dining");
}

export type GoogleOverview = {
  links: GoogleLinks;
  lodging: boolean;
  /** Modul Restaurant an (Reservieren/Bestellen über Google möglich) */
  restaurant: boolean;
  dining: { reserveOnline: boolean; orderOnline: boolean };
  checklist: CheckItem[];
  settings: GoogleSettings & { enabled: boolean };
  /** Über Google gekommen, letzte 30 Tage */
  last30: { bookings: number; reservations: number; orders: number };
};

/** Koordinaten aus dem Baustein «Lage» (wie die strukturierten Daten) */
export async function coordinates(hotelId: string): Promise<{ lat: number; lng: number } | null> {
  const blocks = (await listPages(hotelId)).flatMap((p) => p.blocks as Block[]);
  const loc = blocks.find((b): b is Extract<Block, { type: "location" }> => b.type === "location" && b.lat !== null && b.lng !== null);
  return loc ? { lat: loc.lat!, lng: loc.lng! } : null;
}

async function hasDescription(hotel: Hotel): Promise<boolean> {
  if (hotel.content.de?.intro) return true;
  const blocks = (await listPages(hotel.id)).flatMap((p) => p.blocks as Block[]);
  return blocks.some((b) => (b.type === "hero" && !!plainText(b.intro?.de ?? "")) || (b.type === "text" && plainText(b.body?.de ?? "").length > 40));
}

export async function googleOverview(hotel: Hotel): Promise<GoogleOverview> {
  const lodging = hotel.propertyType !== "restaurant";
  const [settings, reserveOnline, orderOnline, coords, desc] = await Promise.all([
    googleSettings(hotel.id), tableReservationOnline(hotel.id), onlineOrderingOn(hotel.id), coordinates(hotel.id), hasDescription(hotel),
  ]);
  const rts = lodging ? await db().select({ photos: roomTypes.photos }).from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true))) : [];
  const plans = lodging ? await db().select({ id: ratePlans.id }).from(ratePlans).where(and(eq(ratePlans.hotelId, hotel.id), eq(ratePlans.active, true))) : [];
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [c] = rows<{ b: number; r: number; o: number }>(await db().execute(sql`SELECT
    (SELECT count(*)::int FROM bookings WHERE hotel_id = ${hotel.id} AND referrer = 'google' AND created_at >= ${since}) AS b,
    (SELECT count(*)::int FROM pos_reservations WHERE hotel_id = ${hotel.id} AND referrer = 'google' AND created_at >= ${since}) AS r,
    (SELECT count(*)::int FROM online_orders WHERE hotel_id = ${hotel.id} AND referrer = 'google' AND created_at >= ${since}) AS o`));
  return {
    lodging,
    restaurant: await moduleOn(hotel.id, "restaurant"),
    links: googleLinks({ base: publicBase(hotel), lang: hotel.defaultLanguage, lodging, reserve: reserveOnline, order: orderOnline }),
    dining: { reserveOnline, orderOnline },
    checklist: listingChecklist({
      live: hotel.status === "live",
      address: !!(hotel.addressLine && hotel.postalCode && hotel.city),
      phone: !!hotel.contactPhone,
      coordinates: !!coords,
      photo: (hotel.content.photos?.length ?? 0) > 0 || rts.some((r) => r.photos.length > 0),
      description: desc,
      // ASSUMPTION: jeder aktive Tarif hat eine Stornoregel (Pflichtfeld im Tarif), also genügt «mindestens ein Tarif»
      cancellation: plans.length > 0,
      channex: hotel.channexEnabled && !!hotel.channexPropertyId,
    }),
    settings,
    last30: { bookings: c?.b ?? 0, reservations: c?.r ?? 0, orders: c?.o ?? 0 },
  };
}

/** Hotel: kostenlose Buchungslinks anfragen. Nur mit vollständiger Prüfliste; die Plattform schaltet den Google-Kanal in Channex frei. */
export async function requestHotelLinks(hotel: Hotel, actor: string) {
  const o = await googleOverview(hotel);
  if (!o.lodging) throw new GoogleError("Kostenlose Buchungslinks gibt es nur für Unterkünfte.");
  const missing = o.checklist.filter((x) => !x.ok);
  if (missing.length) throw new GoogleError(`Es fehlt noch: ${missing.map((x) => x.text).join("; ")}.`);
  if (o.settings.hotelLinks !== "off") return;
  await writeSettings(hotel.id, { hotelLinks: "requested", requestedAt: new Date().toISOString() }, actor, "google.hotel_links_requested");
  await raiseAlert(`google-request:${hotel.id}`, `Google: ${hotel.name} möchte kostenlose Buchungslinks`, `In Channex den Kanal «Google Hotel Search» für die Property anlegen, Zimmer und Tarife zuordnen, dann in der Plattform-Verwaltung → Google auf «aktiv» stellen. Buchungslink: ${o.links.bookTemplate}`);
}

/** Plattform: Status der kostenlosen Buchungslinks setzen (nach Freischaltung in Channex) */
export async function setHotelLinksStatus(hotelId: string, status: HotelLinksStatus, actor: string) {
  await writeSettings(hotelId, { hotelLinks: status, ...(status === "active" ? { activeAt: new Date().toISOString() } : {}) }, actor, `google.hotel_links_${status}`);
}

/** Plattform: alle Betriebe mit Google-Einstellungen (Anfragen zuerst) */
export async function googleRequests() {
  const list = rows<{ hotel_id: string; name: string; slug: string; settings: GoogleSettings }>(await db().execute(sql`
    SELECT m.hotel_id, h.name, h.slug, m.settings FROM hotel_modules m JOIN hotels h ON h.id = m.hotel_id
     WHERE m.module = 'google' AND (m.settings->>'hotelLinks' IN ('requested', 'active') OR (m.settings->>'reserve')::boolean OR (m.settings->>'order')::boolean)
     ORDER BY (m.settings->>'hotelLinks' = 'requested') DESC, h.name`));
  return list.map((r) => ({ hotelId: r.hotel_id, name: r.name, slug: r.slug, settings: { ...DEFAULTS, ...r.settings } }));
}

/**
 * Feeds für das Actions Center (Restaurants mit «Reservieren/Bestellen über Google»): Entity- und Action-Feed mit Beschreibung.
 * Nur Betriebe, die live sind, das Modul «google» eingeschaltet haben und deren Online-Reservation bzw. -Bestellung läuft.
 */
export async function actionsCenterFeeds(now = new Date()) {
  const list = rows<{ hotel_id: string }>(await db().execute(sql`
    SELECT m.hotel_id FROM hotel_modules m JOIN hotels h ON h.id = m.hotel_id
     WHERE m.module = 'google' AND m.enabled AND h.status = 'live'
       AND ((m.settings->>'reserve')::boolean OR (m.settings->>'order')::boolean)`));
  const entities: FeedEntity[] = [];
  for (const { hotel_id } of list) {
    const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel_id));
    if (!h || !h.addressLine || !h.postalCode || !h.city) continue;
    const s = await googleSettings(h.id);
    const reserve = s.reserve && (await tableReservationOnline(h.id));
    const order = s.order && (await onlineOrderingOn(h.id));
    if (!reserve && !order) continue;
    const os = order ? await orderSettings(h.id) : null;
    const links = googleLinks({ base: publicBase(h), lang: h.defaultLanguage, lodging: false, reserve, order });
    const c = await coordinates(h.id);
    entities.push({
      id: h.id, name: h.name, phone: h.contactPhone ? phoneE164(h.contactPhone) : null, url: links.website,
      lat: c?.lat ?? null, lng: c?.lng ?? null, street: h.addressLine, city: h.city, postalCode: h.postalCode, country: "CH",
      reserveUrl: links.reserve, orderUrl: links.order, delivery: !!os?.delivery, takeout: !!os?.pickup,
    });
  }
  const ts = Math.floor(now.getTime() / 1000);
  return {
    ts,
    entity: { file: `entity_${ts}.json`, data: entityFeed(entities), descriptor: { file: `entity_${ts}.filesetdesc.json`, data: feedDescriptor("reservewithgoogle.entity", ts, [`entity_${ts}.json`]) } },
    action: { file: `action_${ts}.json`, data: actionFeed(entities), descriptor: { file: `action_${ts}.filesetdesc.json`, data: feedDescriptor("reservewithgoogle.action.v2", ts, [`action_${ts}.json`]) } },
    count: entities.length,
  };
}

/** Schweizer Nummer in internationaler Schreibweise (+41…), sonst unverändert ohne Leerzeichen */
export function phoneE164(v: string): string {
  const d = v.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.startsWith("00")) return `+${d.slice(2)}`;
  if (d.startsWith("0")) return `+41${d.slice(1)}`;
  return d;
}
