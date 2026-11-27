import { and, eq, inArray, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { extras, googleAriState, hotels, inventoryDays, ratePlans, ratesDays, roomTypes, type Hotel } from "../db/schema";
import { todayIn, type Day } from "../domain/dates";
import {
  availabilityMessage, availRuns, GOOGLE_ARI_DAYS, hotelListFeed, inventoryMessage, inventoryRuns, landingPagesFile, propertyDataMessage,
  pricesBeforeTax, rangeDays, rateMessage, rateRuns, sha, taxFeeMessage, type FeeModel, type GoogleKind, type GoogleReply, type ListingHotel, type Meta, type PlanModel, type RoomModel,
} from "../domain/google-hotels";
import { env } from "../env";
import { googleSendEnabled, partnerKey, postGoogle, GoogleHttpError } from "../integrations/google-hotels/client";
import { audit } from "./audit";
import { coordinates, GoogleError, googleSettings, phoneE164, writeSettings } from "./google";
import { taxRuleFor } from "./hotels";
import { raiseAlert } from "./monitor";

/**
 * Google Hotelpreise als eigener Connectivity-Partner (SPEC 19.70): Pontivo meldet Hotelliste, Zimmer, Tarife, Bestand,
 * Preise, Einschränkungen und Kurtaxe selbst an Google (statt über Channex). Nur Betriebe mit `partner` in den Google-Einstellungen.
 */

const CATEGORY: Record<Hotel["propertyType"], string> = { hotel: "hotel", bnb: "bed and breakfast", apartment: "apartment", chalet: "chalet", group_house: "group house", restaurant: "restaurant" };

export type Eligibility = { ok: boolean; missing: string[]; entry: ListingHotel | null };

/** Was ein Betrieb für den Google-Partnerfeed braucht (Pflichtfelder der Hotelliste, Preise nach den Preis-Richtlinien von Google) */
export async function listingEligibility(hotel: Hotel, now = new Date()): Promise<Eligibility> {
  const missing: string[] = [];
  if (hotel.propertyType === "restaurant") return { ok: false, missing: ["Nur für Unterkünfte"], entry: null };
  if (hotel.status !== "live") missing.push("Online-Buchung ist nicht live");
  if (!(hotel.addressLine && hotel.postalCode && hotel.city)) missing.push("Adresse unvollständig");
  const coords = await coordinates(hotel.id);
  if (!coords) missing.push("Lage auf der Karte fehlt (Baustein «Lage» mit Koordinaten)");
  const rts = await db().select({ id: roomTypes.id }).from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true)));
  const plans = rts.length ? await db().select({ id: ratePlans.id }).from(ratePlans).where(and(eq(ratePlans.hotelId, hotel.id), eq(ratePlans.active, true), inArray(ratePlans.roomTypeId, rts.map((r) => r.id)))) : [];
  if (!plans.length) missing.push("Kein aktives Zimmer mit Tarif");
  const rule = await taxRuleFor(hotel, todayIn(hotel.timezone, now));
  if (!rule || rule.status === "needs_confirmation") missing.push("Kurtaxe-Satz der Gemeinde nicht bestätigt");
  const s = await googleSettings(hotel.id);
  if (s.hotelLinks === "active") missing.push("Kostenlose Buchungslinks laufen schon über Channex (dort zuerst abschalten)");
  const ok = missing.length === 0;
  const entry: ListingHotel | null = coords && hotel.addressLine && hotel.postalCode && hotel.city ? {
    id: hotel.id, name: hotel.name, street: hotel.addressLine, city: hotel.city, postalCode: hotel.postalCode, canton: hotel.canton, country: "CH",
    lat: coords.lat, lng: coords.lng, phone: hotel.contactPhone ? phoneE164(hotel.contactPhone) : null, category: CATEGORY[hotel.propertyType],
  } : null;
  return { ok, missing, entry };
}

/** Plattform: Betrieb in den Google-Partnerfeed aufnehmen oder herausnehmen */
export async function setPartner(hotel: Hotel, on: boolean, actor: string) {
  if (on) {
    const e = await listingEligibility(hotel);
    if (!e.ok) throw new GoogleError(`${hotel.name}: ${e.missing.join("; ")}.`);
  }
  await writeSettings(hotel.id, { partner: on }, actor, on ? "google.partner_on" : "google.partner_off");
}

async function partnerHotels(): Promise<Hotel[]> {
  const ids = rows<{ hotel_id: string }>(await db().execute(sql`SELECT hotel_id FROM hotel_modules WHERE module = 'google' AND enabled AND (settings->>'partner')::boolean`)).map((r) => r.hotel_id);
  return ids.length ? db().select().from(hotels).where(inArray(hotels.id, ids)) : [];
}

/** Hotelliste (XML) aller Betriebe im Partnerfeed, die die Voraussetzungen erfüllen */
export async function hotelListXml(): Promise<{ xml: string; count: number }> {
  const list: ListingHotel[] = [];
  for (const h of await partnerHotels()) {
    const e = await listingEligibility(h);
    if (e.ok && e.entry) list.push(e.entry);
  }
  return { xml: hotelListFeed(list, "de"), count: list.length };
}

export const landingPagesXml = () => landingPagesFile(env().APP_BASE_URL);

// ---------------------------------------------------------------- Stand eines Betriebs

type Item<T> = { key: string; hash: string; value: T };
export type Snapshot = {
  property: { hash: string; rooms: RoomModel[]; plans: PlanModel[] };
  taxes: { hash: string; rule: Awaited<ReturnType<typeof taxRuleFor>>; included: boolean; fees: FeeModel[] };
  separate: boolean;
  inventory: Item<ReturnType<typeof inventoryRuns>>[];
  rate: Item<ReturnType<typeof rateRuns>>[];
  availability: Item<ReturnType<typeof availRuns>>[];
  roomOf: Map<string, string>;
};

/** Zimmer, Tarife, Bestand, Preise, Einschränkungen und Kurtaxe der nächsten 365 Tage aus der Datenbank (immer mit hotel_id) */
export async function buildSnapshot(hotel: Hotel, now = new Date()): Promise<Snapshot> {
  const today = todayIn(hotel.timezone, now);
  const days: Day[] = rangeDays(today, GOOGLE_ARI_DAYS);
  const last = days[days.length - 1]!;
  const rts = await db().select().from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true)));
  const rps = rts.length ? await db().select().from(ratePlans).where(and(eq(ratePlans.hotelId, hotel.id), eq(ratePlans.active, true), inArray(ratePlans.roomTypeId, rts.map((r) => r.id)))) : [];
  const inv = rts.length ? await db().select().from(inventoryDays).where(and(eq(inventoryDays.hotelId, hotel.id), inArray(inventoryDays.roomTypeId, rts.map((r) => r.id)), sql`${inventoryDays.night} BETWEEN ${today}::date AND ${last}::date`)) : [];
  const rates = rps.length ? await db().select().from(ratesDays).where(and(eq(ratesDays.hotelId, hotel.id), inArray(ratesDays.ratePlanId, rps.map((r) => r.id)), sql`${ratesDays.night} BETWEEN ${today}::date AND ${last}::date`)) : [];
  const rule = await taxRuleFor(hotel, today);
  const included = hotel.touristTaxIncludedInPrice;
  // Pflicht-Zusatzleistungen (z. B. Endreinigung) gehen als Gebühr an Google; nur für Zimmer, die es gibt
  const mand = await db().select().from(extras).where(and(eq(extras.hotelId, hotel.id), eq(extras.active, true), eq(extras.mandatory, true)));
  const roomIds = new Set(rts.map((r) => r.id));
  const fees: FeeModel[] = mand
    .map((x) => ({ unit: x.unit, rappen: x.priceRappen, roomIds: x.roomTypeIds.filter((r) => roomIds.has(r)), restricted: x.roomTypeIds.length > 0 }))
    .filter((x) => !x.restricted || x.roomIds.length > 0)
    .map(({ unit, rappen, roomIds: ids }) => ({ unit, rappen, roomIds: ids.sort() }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const separate = pricesBeforeTax(rule, included, fees);

  const rooms: RoomModel[] = rts.map((r) => ({
    id: r.id, name: r.name, description: r.description ?? "", photos: r.photos, maxOccupancy: r.maxOccupancy, maxAdults: r.maxAdults, maxChildren: r.maxChildren,
    planIds: rps.filter((p) => p.roomTypeId === r.id).map((p) => p.id),
  }));
  const plans: PlanModel[] = rps.map((p) => ({
    id: p.id, name: p.name, description: p.name, freeCancelHours: p.freeCancelHours, checkinTime: hotel.checkinTime,
    breakfast: p.board !== "none", dinner: p.board === "half" || p.board === "full",
  }));
  const maxAdultsOf = new Map(rts.map((r) => [r.id, r.maxAdults]));
  const roomOf = new Map(rps.map((p) => [p.id, p.roomTypeId]));
  const item = <T>(key: string, value: T, extra: unknown = null): Item<T> => ({ key, value, hash: sha({ value, extra }) });
  return {
    property: { hash: sha({ rooms, plans, lang: hotel.defaultLanguage }), rooms, plans },
    taxes: { hash: sha({ rule, included, fees, currency: hotel.currency }), rule, included, fees },
    separate,
    roomOf,
    inventory: rts.map((r) => item(r.id, inventoryRuns(inv.filter((i) => i.roomTypeId === r.id), true, days))),
    rate: rps.map((p) => item(p.id, rateRuns(rates.filter((x) => x.ratePlanId === p.id), p, maxAdultsOf.get(p.roomTypeId) ?? p.baseOccupancy, days), { separate, currency: hotel.currency })),
    availability: rps.map((p) => item(p.id, availRuns(rates.filter((x) => x.ratePlanId === p.id), p, days))),
  };
}

// ---------------------------------------------------------------- Senden

/** Produkte (Zimmer bzw. Tarife) je Nachricht, damit eine Nachricht klein bleibt (Empfehlung von Google: höchstens 5 MB) */
const PRODUCTS_PER_REQUEST = 10;

export type Sender = (kind: GoogleKind, xml: string) => Promise<GoogleReply>;
export type SyncResult = { hotelId: string; sent: Record<string, number>; failed: string | null; dryRun: boolean };

type Job = { kind: GoogleKind; stateKind: "property" | "taxes" | "inventory" | "rate" | "availability"; keys: { key: string; hash: string }[]; xml: string };

/** Nachrichten für alles, was sich gegenüber dem gespeicherten Stand geändert hat (leerer Stand = alles) */
function buildJobs(hotel: Hotel, snap: Snapshot, state: Map<string, string | null>, now: Date): Job[] {
  const stamp = now.getTime().toString(36);
  const metaOf = (kind: string, n: number): Meta => ({ ts: now, id: `${kind}-${hotel.id.slice(0, 8)}-${stamp}-${n}`, partner: partnerKey() });
  const changed = <T,>(kind: string, items: Item<T>[]) => items.filter((i) => state.get(`${kind}|${i.key}`) !== i.hash);
  const chunks = <T,>(list: T[]): T[][] => Array.from({ length: Math.ceil(list.length / PRODUCTS_PER_REQUEST) }, (_, i) => list.slice(i * PRODUCTS_PER_REQUEST, (i + 1) * PRODUCTS_PER_REQUEST));
  const jobs: Job[] = [];
  if (state.get(`property|${hotel.id}`) !== snap.property.hash) {
    jobs.push({ kind: "property", stateKind: "property", keys: [{ key: hotel.id, hash: snap.property.hash }], xml: propertyDataMessage(metaOf("prop", 0), hotel.id, snap.property.rooms, snap.property.plans, hotel.defaultLanguage) });
  }
  if (state.get(`taxes|${hotel.id}`) !== snap.taxes.hash) {
    jobs.push({ kind: "taxes", stateKind: "taxes", keys: [{ key: hotel.id, hash: snap.taxes.hash }], xml: taxFeeMessage(metaOf("tax", 0), hotel.id, snap.taxes.rule, snap.taxes.included, hotel.currency, snap.taxes.fees) });
  }
  chunks(changed("inventory", snap.inventory)).forEach((c, n) => jobs.push({ kind: "inventory", stateKind: "inventory", keys: c.map(({ key, hash }) => ({ key, hash })), xml: inventoryMessage(metaOf("inv", n), hotel.id, c.map((i) => ({ roomId: i.key, runs: i.value }))) }));
  chunks(changed("rate", snap.rate)).forEach((c, n) => jobs.push({ kind: "rate", stateKind: "rate", keys: c.map(({ key, hash }) => ({ key, hash })), xml: rateMessage(metaOf("rate", n), hotel.id, c.map((i) => ({ roomId: snap.roomOf.get(i.key)!, planId: i.key, runs: i.value })), hotel.currency, snap.separate) }));
  chunks(changed("availability", snap.availability)).forEach((c, n) => jobs.push({ kind: "availability", stateKind: "availability", keys: c.map(({ key, hash }) => ({ key, hash })), xml: availabilityMessage(metaOf("avail", n), hotel.id, c.map((i) => ({ roomId: snap.roomOf.get(i.key)!, planId: i.key, runs: i.value }))) }));
  return jobs;
}

/** Alle Nachrichten eines Betriebs, wie sie an Google gingen (zum Prüfen gegen die Schemas von Google, z. B. mit xmllint, und für die Zertifizierung) */
export async function previewMessages(hotel: Hotel, now = new Date()): Promise<{ kind: GoogleKind; xml: string }[]> {
  return buildJobs(hotel, await buildSnapshot(hotel, now), new Map(), now).map((j) => ({ kind: j.kind, xml: j.xml }));
}

/**
 * Einen Betrieb abgleichen: nur geänderte Bausteine senden, in der Reihenfolge Property Data → Kurtaxe → Bestand → Preise → Einschränkungen.
 * `send` = null: Trockenlauf (erzeugt die Nachrichten und zählt sie, sendet und speichert nichts).
 * Der Stand wird nur nach einer Antwort ohne Fehler gespeichert; sonst wird beim nächsten Durchlauf alles Offene nochmals gesendet.
 */
export async function syncHotel(hotel: Hotel, send: Sender | null, now = new Date()): Promise<SyncResult> {
  const result: SyncResult = { hotelId: hotel.id, sent: {}, failed: null, dryRun: send === null };
  const e = await listingEligibility(hotel, now);
  if (!e.ok) return { ...result, failed: `nicht zugelassen: ${e.missing.join("; ")}` };
  const snap = await buildSnapshot(hotel, now);
  const state = new Map((await db().select().from(googleAriState).where(eq(googleAriState.hotelId, hotel.id))).map((s) => [`${s.kind}|${s.key}`, s.hash]));
  const jobs = buildJobs(hotel, snap, state, now);

  for (const j of jobs) {
    if (!send) {
      result.sent[j.kind] = (result.sent[j.kind] ?? 0) + j.keys.length;
      continue;
    }
    let reply: GoogleReply;
    try {
      reply = await send(j.kind, j.xml);
    } catch (err) {
      reply = { ok: false, warnings: [], errors: [(err as Error).message] };
      if (!(err instanceof GoogleHttpError)) console.error("[google-hotels]", err);
    }
    if (reply.ok) {
      for (const k of j.keys) {
        await db().insert(googleAriState).values({ hotelId: hotel.id, kind: j.stateKind, key: k.key, hash: k.hash, sentAt: now })
          .onConflictDoUpdate({ target: [googleAriState.hotelId, googleAriState.kind, googleAriState.key], set: { hash: k.hash, sentAt: now, failedAt: null, lastError: reply.warnings.join("; ").slice(0, 2000) || null } });
      }
      result.sent[j.kind] = (result.sent[j.kind] ?? 0) + j.keys.length;
    } else {
      const msg = reply.errors.join("; ").slice(0, 2000);
      for (const k of j.keys) {
        await db().insert(googleAriState).values({ hotelId: hotel.id, kind: j.stateKind, key: k.key, hash: null, failedAt: now, lastError: msg })
          .onConflictDoUpdate({ target: [googleAriState.hotelId, googleAriState.kind, googleAriState.key], set: { failedAt: now, lastError: msg } });
      }
      result.failed = `${j.kind}: ${msg}`;
      // Property Data fehlt oder wurde abgelehnt → Preise für unbekannte Zimmer nicht senden
      break;
    }
  }
  if (result.failed && send) {
    await audit(db(), { hotelId: hotel.id, actor: "system:google-hotels", action: "google.sync_failed", entity: "hotels", entityId: hotel.id, details: { error: result.failed } });
    await raiseAlert(`google-sync:${hotel.id}`, `Google: Abgleich für ${hotel.name} fehlgeschlagen`, result.failed, now);
  }
  return result;
}

/** Worker-Job (jede Minute): alle Betriebe im Partnerfeed abgleichen. Ohne Partner-Schlüssel oder GOOGLE_HOTELS_SEND=1 passiert nichts. */
export async function googleHotelsJob(now = new Date(), send: Sender | null = googleSendEnabled() ? postGoogle : null): Promise<SyncResult[] | 0> {
  if (!send) return 0;
  const out: SyncResult[] = [];
  for (const h of await partnerHotels()) out.push(await syncHotel(h, send, now));
  return out.length ? out : 0;
}

// ---------------------------------------------------------------- Plattform-Übersicht

export type PartnerRow = { hotelId: string; name: string; partner: boolean; viaChannex: boolean; missing: string[]; lastSentAt: Date | null; lastError: string | null };

/** Alle Unterkünfte (live oder im Feed) mit Voraussetzungen und Stand der letzten Sendung */
export async function partnerOverview(now = new Date()): Promise<PartnerRow[]> {
  const list = await db().select().from(hotels).where(sql`${hotels.propertyType} <> 'restaurant' AND (${hotels.status} = 'live' OR ${hotels.id} IN (SELECT hotel_id FROM hotel_modules WHERE module = 'google' AND (settings->>'partner')::boolean))`);
  const out: PartnerRow[] = [];
  for (const h of list) {
    const [s, e] = await Promise.all([googleSettings(h.id), listingEligibility(h, now)]);
    const [st] = rows<{ sent: Date | null; err: string | null }>(await db().execute(sql`
      SELECT max(sent_at) AS sent, (array_agg(last_error ORDER BY failed_at DESC NULLS LAST) FILTER (WHERE failed_at IS NOT NULL))[1] AS err
        FROM google_ari_state WHERE hotel_id = ${h.id}`));
    out.push({ hotelId: h.id, name: h.name, partner: s.partner, viaChannex: s.hotelLinks === "active", missing: e.missing, lastSentAt: st?.sent ? new Date(st.sent) : null, lastError: st?.err ?? null });
  }
  return out.sort((a, b) => Number(b.partner) - Number(a.partner) || a.name.localeCompare(b.name));
}
