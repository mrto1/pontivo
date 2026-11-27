import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { db, rows } from "../db/client";
import {
  deliveryFlags, deliveryZones, hotels, onlineOrderSettings, onlineOrders, orderScreens, posDevices, posItems, posOrderLines, posOrders,
  type DeliveryZone, type Hotel, type OnlineOrder, type OnlineOrderItem, type OnlineOrderSettings,
} from "../db/schema";
import { addDays, todayIn, zonedToUtc } from "../domain/dates";
import { PILOT_CAP_RAPPEN, PILOT_SLOTS, flatForMonth, introUntil, orderFee, pilotUntilFor, type OrderFeeState } from "../domain/order-fee";
import { INTRO_NOTICE_DAYS, PILOT_TERMS_VERSION } from "../legal/pilot-terms";
import { feePercentText } from "../domain/fee";
import { formatChf } from "../domain/money";
import { checkChoice, composeLine, NOTE_MAX } from "../domain/pos-options";
import { acceptsOrders, addressKey, cleanAllergens, deliveryFee, goLiveProblems, openNow, orderNumber, orderSlots, zoneFor, type OrderSlot } from "../domain/online-order";
import { enqueueEmail } from "../email/enqueue";
import { env } from "../env";
import { isLocale } from "../i18n/dict";
import { getPaymentProvider } from "../payments/provider";
import { enqueuePush } from "../push/service";
import { audit } from "./audit";
import { getHotelById } from "./hotels";
import { invoicingSettings } from "./invoicing";
import { PosError, addLines, catalogGroups, createDevice, groupsOfItem, pay } from "./pos";
import { getSettings as resSettings } from "./reservations";
import { orderFeeModel } from "./platform-settings";
import { enqueueSms } from "./sms";

/**
 * Online-Bestellung mit Abholung und Lieferung (SPEC 20.4, 20.5). Jede Abfrage nach hotel_id.
 * Die Bestellung lebt in `online_orders`; erst bei der Annahme entsteht die `pos_order` (Küche, Bon).
 */
const clean = (v: string, max: number) => v.replace(/\s+/g, " ").trim().slice(0, max);
export const ACCEPT_ALARM_MIN = 5;
export const ACCEPT_EXPIRE_MIN = 10;
export const UNPAID_EXPIRE_MIN = 35;
export const HEARTBEAT_STALE_MIN = 3;

export const DEFAULT_ORDER_SETTINGS: Omit<OnlineOrderSettings, "hotelId" | "updatedAt"> = {
  enabled: false, pickup: true, delivery: false, slotMinutes: 15, maxPerSlot: 5, deliveryPerSlot: 3, leadMin: 20, cutoffMin: 15,
  cashPickup: false, cashDelivery: false, cashMaxRappen: null, guestSms: false, pausedUntil: null, autoPaused: false, testPassedAt: null, startedOn: null, pilotUntil: null, termsVersion: null, termsAcceptedAt: null, introNoticeAt: null,
};

export async function orderSettings(hotelId: string): Promise<OnlineOrderSettings> {
  const [r] = await db().select().from(onlineOrderSettings).where(eq(onlineOrderSettings.hotelId, hotelId));
  return r ?? { hotelId, updatedAt: new Date(0), ...DEFAULT_ORDER_SETTINGS };
}

async function upsertSettings(hotelId: string, v: Partial<OnlineOrderSettings>) {
  const cur = await orderSettings(hotelId);
  const { hotelId: _h, updatedAt: _u, ...rest } = { ...cur, ...v };
  await db().insert(onlineOrderSettings).values({ hotelId, ...rest }).onConflictDoUpdate({ target: onlineOrderSettings.hotelId, set: { ...rest, updatedAt: new Date() } });
}

export type OrderSettingsInput = Pick<OnlineOrderSettings, "pickup" | "delivery" | "slotMinutes" | "maxPerSlot" | "deliveryPerSlot" | "leadMin" | "cutoffMin" | "cashPickup" | "cashDelivery" | "cashMaxRappen" | "guestSms">;

export async function saveOrderSettings(hotelId: string, i: OrderSettingsInput, actor: string) {
  const r: [number, number, number, string][] = [[i.slotMinutes, 5, 60, "Zeitraster"], [i.maxPerSlot, 1, 100, "Bestellungen je Zeitfenster"], [i.deliveryPerSlot, 1, 100, "Lieferungen je Zeitfenster"], [i.leadMin, 0, 240, "Vorlauf"], [i.cutoffMin, 0, 240, "Bestellschluss"]];
  for (const [v, lo, hi, n] of r) if (!Number.isInteger(v) || v < lo || v > hi) throw new PosError(`${n}: ${lo} bis ${hi}.`);
  if (i.cashMaxRappen !== null && (!Number.isInteger(i.cashMaxRappen) || i.cashMaxRappen <= 0)) throw new PosError("Höchstbetrag bar ungültig.");
  await upsertSettings(hotelId, i);
  await audit(db(), { hotelId, actor, action: "orders.settings", entity: "online_order_settings", entityId: hotelId });
}

const stripeReady = (h: Hotel) => env().PAYMENT_PROVIDER !== "stripe" || !!(h.stripeAccountId && h.stripeChargesEnabled);

/** Was fehlt bis zum Live-Gang? (leer = bereit) */
export async function orderReadiness(hotel: Hotel) {
  const [s, rs, items, zones] = await Promise.all([
    orderSettings(hotel.id), resSettings(hotel.id),
    db().select({ id: posItems.id }).from(posItems).where(and(eq(posItems.hotelId, hotel.id), eq(posItems.active, true), eq(posItems.online, true))),
    db().select({ id: deliveryZones.id }).from(deliveryZones).where(and(eq(deliveryZones.hotelId, hotel.id), eq(deliveryZones.active, true))),
  ]);
  const hasHours = !!rs.openingHours && Object.values(rs.openingHours).some((w) => w.length);
  return goLiveProblems({ hasOpeningHours: hasHours, onlineItems: items.length, stripeReady: stripeReady(hotel), testPassed: !!s.testPassedAt, pickup: s.pickup, delivery: s.delivery, activeZones: zones.length });
}

/** Online-Bestellung ein- oder ausschalten; einschalten nur, wenn alles bereit ist (SPEC 20.4) */
export async function setOrdersEnabled(hotel: Hotel, on: boolean, actor: string, opts: { acceptTerms?: boolean } = {}) {
  if (on) {
    const p = await orderReadiness(hotel);
    if (p.length) throw new PosError(`Noch nicht möglich: ${p.map((x) => x.text).join(" ")}`);
    // Erstes Einschalten: Pilotbedingungen (Preis, Sonderangebot, Pilotbetrieb) bestätigen
    if (!(await orderSettings(hotel.id)).startedOn && !opts.acceptTerms) throw new PosError("Bitte die Pilotbedingungen der Online-Bestellung bestätigen.");
  }
  await upsertSettings(hotel.id, { enabled: on, ...(on ? { pausedUntil: null, autoPaused: false } : {}) });
  await audit(db(), { hotelId: hotel.id, actor, action: on ? "orders.enable" : "orders.disable", entity: "online_order_settings", entityId: hotel.id });
  if (on) await markOrderStart(hotel, actor);
}

/**
 * Erstes Einschalten: Beginn des Sonderangebots; die ersten 10 Betriebe werden Pilotbetrieb (SPEC 20.4).
 * ASSUMPTION: automatisch beim ersten Einschalten; Plattform-Admin kann den Status entziehen oder vergeben.
 */
async function markOrderStart(hotel: Hotel, actor: string) {
  await db().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('order-pilot'))`);
    const [s] = await tx.select().from(onlineOrderSettings).where(eq(onlineOrderSettings.hotelId, hotel.id));
    if (!s || s.startedOn) return;
    const day = todayIn(hotel.timezone);
    const [{ n }] = rows<{ n: number }>(await tx.execute(sql`SELECT count(*)::int AS n FROM online_order_settings WHERE pilot_until IS NOT NULL`));
    const pilotUntil = n < PILOT_SLOTS ? pilotUntilFor(day) : null;
    await tx.update(onlineOrderSettings).set({ startedOn: day, pilotUntil, termsVersion: PILOT_TERMS_VERSION, termsAcceptedAt: new Date() }).where(eq(onlineOrderSettings.hotelId, hotel.id));
    await audit(tx, { hotelId: hotel.id, actor, action: "orders.start", entity: "online_order_settings", entityId: hotel.id, details: { startedOn: day, pilotUntil, terms: PILOT_TERMS_VERSION } });
  });
}

/**
 * Hinweis vor Ende des Sonderangebots (Pilotbedingungen Ziffer 2): einmal, ab 30 Tage vor Ende, nur wenn danach wirklich der Normalpreis gilt
 * (Modell «percent»; im Modell «fixed» läuft die Pauschale weiter, die Umstellung wird separat angekündigt).
 */
export async function introNoticeJob(now = new Date()): Promise<number> {
  if ((await orderFeeModel()) !== "percent") return 0;
  const list = await db().select({ s: onlineOrderSettings, h: hotels }).from(onlineOrderSettings).innerJoin(hotels, eq(hotels.id, onlineOrderSettings.hotelId))
    .where(and(isNotNull(onlineOrderSettings.startedOn), isNull(onlineOrderSettings.introNoticeAt)));
  let sent = 0;
  for (const { s, h } of list) {
    const today = todayIn(h.timezone, now);
    const end = introUntil(s.startedOn!);
    if (today >= end || today < addDays(end, -INTRO_NOTICE_DAYS)) continue;
    await db().transaction(async (tx) => {
      const r = await tx.update(onlineOrderSettings).set({ introNoticeAt: now }).where(and(eq(onlineOrderSettings.hotelId, h.id), isNull(onlineOrderSettings.introNoticeAt))).returning({ id: onlineOrderSettings.hotelId });
      if (!r.length) return;
      const pilot = s.pilotUntil && end < s.pilotUntil ? addDays(s.pilotUntil, -1) : "";
      await enqueueEmail(tx, { hotelId: h.id, template: "host_order_intro_ending", to: h.contactEmail, language: "de",
        data: { last: addDays(end, -1), from: end, fee: feePercentText(h.platformFeeBps), cap: formatChf(PILOT_CAP_RAPPEN), pilotUntil: pilot } });
      sent++;
    });
  }
  return sent;
}

export const pilotSlotsLeft = async (): Promise<number> => {
  const [{ n }] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM online_order_settings WHERE pilot_until IS NOT NULL`));
  return Math.max(0, PILOT_SLOTS - n);
};

/** Pilotbetriebe für die Plattform-Verwaltung */
export async function listOrderPilots() {
  return rows<{ hotel_id: string; name: string; started_on: string | null; pilot_until: string | null; enabled: boolean }>(await db().execute(sql`
    SELECT s.hotel_id, h.name, s.started_on::text, s.pilot_until::text, s.enabled FROM online_order_settings s JOIN hotels h ON h.id = s.hotel_id
     WHERE s.started_on IS NOT NULL ORDER BY s.pilot_until IS NULL, s.started_on, h.name`));
}

/** Pilotstatus vergeben (12 Monate ab Start, nur mit freiem Platz) oder entziehen (Platz wird frei) */
export async function setOrderPilot(hotelId: string, on: boolean, actor: string) {
  await db().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('order-pilot'))`);
    const [s] = await tx.select().from(onlineOrderSettings).where(eq(onlineOrderSettings.hotelId, hotelId));
    if (!s?.startedOn) throw new PosError("Der Betrieb hat die Online-Bestellung noch nie eingeschaltet.");
    if (on && !s.pilotUntil) {
      const [{ n }] = rows<{ n: number }>(await tx.execute(sql`SELECT count(*)::int AS n FROM online_order_settings WHERE pilot_until IS NOT NULL`));
      if (n >= PILOT_SLOTS) throw new PosError(`Alle ${PILOT_SLOTS} Pilotplätze sind vergeben.`);
    }
    const pilotUntil = on ? (s.pilotUntil ?? pilotUntilFor(s.startedOn)) : null;
    await tx.update(onlineOrderSettings).set({ pilotUntil }).where(eq(onlineOrderSettings.hotelId, hotelId));
    await audit(tx, { hotelId, actor, action: on ? "orders.pilot_grant" : "orders.pilot_revoke", entity: "online_order_settings", entityId: hotelId, details: { pilotUntil } });
  });
}

/** Preisstand der Online-Bestellung eines Betriebs */
export async function orderFeeState(hotelId: string): Promise<OrderFeeState> {
  const s = await orderSettings(hotelId);
  return { model: await orderFeeModel(), startedOn: s.startedOn ?? null, pilotUntil: s.pilotUntil ?? null };
}

/** Pause von Hand: Minuten (0 = fortsetzen) oder bis morgen früh */
export async function pauseOrders(hotel: Hotel, minutes: number | "tomorrow", actor: string) {
  const until = minutes === "tomorrow" ? zonedToUtc(addDays(todayIn(hotel.timezone), 1), "05:00", hotel.timezone) : minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
  await upsertSettings(hotel.id, { pausedUntil: until, ...(minutes === 0 ? { autoPaused: false } : {}) });
  await audit(db(), { hotelId: hotel.id, actor, action: "orders.pause", entity: "online_order_settings", entityId: hotel.id, details: { minutes } });
}

// ---------------------------------------------------------------- Liefergebiete

export const listZones = (hotelId: string) => db().select().from(deliveryZones).where(eq(deliveryZones.hotelId, hotelId)).orderBy(asc(deliveryZones.createdAt));

export async function saveZone(hotelId: string, id: string | null, z: { name: string; postalCodes: string[]; minOrderRappen: number; feeRappen: number; freeFromRappen: number | null; extraMinutes: number; active?: boolean }, actor: string): Promise<DeliveryZone> {
  const name = clean(z.name, 60);
  if (!name) throw new PosError("Name des Gebiets fehlt.");
  if (!z.postalCodes.length || z.postalCodes.some((p) => !/^\d{4}$/.test(p))) throw new PosError("Postleitzahlen: 4 Ziffern, mit Komma getrennt.");
  for (const v of [z.minOrderRappen, z.feeRappen]) if (!Number.isInteger(v) || v < 0 || v > 1_000_000) throw new PosError("Betrag ungültig.");
  if (z.freeFromRappen !== null && (!Number.isInteger(z.freeFromRappen) || z.freeFromRappen <= 0)) throw new PosError("«Gratis ab» ungültig.");
  if (!Number.isInteger(z.extraMinutes) || z.extraMinutes < 0 || z.extraMinutes > 180) throw new PosError("Lieferzeit: 0 bis 180 Minuten.");
  const v = { name, postalCodes: z.postalCodes, minOrderRappen: z.minOrderRappen, feeRappen: z.feeRappen, freeFromRappen: z.freeFromRappen, extraMinutes: z.extraMinutes, active: z.active ?? true };
  const [row] = id
    ? await db().update(deliveryZones).set(v).where(and(eq(deliveryZones.id, id), eq(deliveryZones.hotelId, hotelId))).returning()
    : await db().insert(deliveryZones).values({ ...v, hotelId }).returning();
  if (!row) throw new PosError("Gebiet nicht gefunden.");
  await audit(db(), { hotelId, actor, action: id ? "orders.zone_update" : "orders.zone_create", entity: "delivery_zone", entityId: row.id });
  return row;
}

// ---------------------------------------------------------------- Gästeseite

function nowIn(hotel: Hotel, d = new Date()) {
  return { day: todayIn(hotel.timezone, d), minutes: Number(formatInTimeZone(d, hotel.timezone, "H")) * 60 + Number(formatInTimeZone(d, hotel.timezone, "m")) };
}

/** Artikel für die Online-Bestellung: bestellbar, Beschreibung, Foto (nur Website-Fotos `/media/…`), Allergene (LIV Anhang 6) */
export async function saveItemOnline(hotelId: string, id: string, i: { online: boolean; description: string; photoUrl: string | null; allergens: string[] }, actor: string) {
  const photo = i.photoUrl && /^\/media\/[A-Za-z0-9/_.-]+$/.test(i.photoUrl) ? i.photoUrl : null;
  const [it] = await db().update(posItems).set({ online: i.online, description: clean(i.description, 400), photoUrl: photo, allergens: cleanAllergens(i.allergens) }).where(and(eq(posItems.id, id), eq(posItems.hotelId, hotelId))).returning();
  if (!it) throw new PosError("Artikel nicht gefunden.");
  await audit(db(), { hotelId, actor, action: "pos.item_online", entity: "pos_item", entityId: id });
  return it;
}

/** Speisekarte für die Online-Bestellung: aktive, online bestellbare Artikel mit Optionsgruppen */
export async function onlineMenu(hotelId: string) {
  const items = await db().select().from(posItems).where(and(eq(posItems.hotelId, hotelId), eq(posItems.active, true), eq(posItems.online, true))).orderBy(asc(posItems.sortOrder), asc(posItems.category), asc(posItems.name));
  const groups = await catalogGroups(hotelId, items.map((i) => i.id));
  return items.map((i) => ({ id: i.id, category: i.category, name: i.name, description: i.description, priceRappen: i.priceRappen, photoUrl: i.photoUrl, allergens: i.allergens, groups: groups.get(i.id) ?? [] }));
}

/** Online-Bestellung eingeschaltet (Modul «restaurant» an und live geschaltet); Pause zählt hier nicht (Gäste sehen dann «Zurzeit keine …») */
export async function onlineOrderingOn(hotelId: string): Promise<boolean> {
  const [m] = rows<{ on: boolean }>(await db().execute(sql`SELECT enabled AS on FROM hotel_modules WHERE hotel_id = ${hotelId} AND module = 'restaurant'`));
  return !!m?.on && (await orderSettings(hotelId)).enabled;
}

/** Gerade offen für Bestellungen? (eingeschaltet, nicht pausiert) */
export async function orderingOpen(hotel: Hotel, now = new Date()) {
  const s = await orderSettings(hotel.id);
  return acceptsOrders(s, now) ? s : null;
}

/** Freie Zeiten heute (Abholung oder Lieferung mit Zusatzminuten des Gebiets) */
export async function slotsToday(hotel: Hotel, kind: "pickup" | "delivery", extraMin = 0, now = new Date()): Promise<OrderSlot[]> {
  const s = await orderSettings(hotel.id);
  const rs = await resSettings(hotel.id);
  const n = nowIn(hotel, now);
  const taken = new Map<string, number>();
  const live = rows<{ t: string; n: number }>(await db().execute(sql`
    SELECT to_char(requested_at AT TIME ZONE ${hotel.timezone}, 'HH24:MI') AS t, count(*)::int AS n FROM online_orders
     WHERE hotel_id = ${hotel.id} AND day = ${n.day} AND kind = ${kind} AND NOT is_test AND status IN ('pending_payment','new','accepted','ready','out') GROUP BY 1`));
  for (const r of live) taken.set(r.t, r.n);
  return orderSlots({ openingHours: rs.openingHours, day: n.day, now: n, slotMinutes: s.slotMinutes, leadMin: s.leadMin, cutoffMin: s.cutoffMin, extraMin, capacity: kind === "delivery" ? s.deliveryPerSlot : s.maxPerSlot, taken });
}

export type CartLine = { itemId: string; quantity: number; optionIds: string[]; note: string };
export type OrderInput = {
  kind: "pickup" | "delivery"; time: string; payment: "card" | "cash"; name: string; phone: string; email: string; note?: string; language: string;
  /** Herkunft (SPEC 19.67) */
  referrer?: "google" | null;
  lines: CartLine[];
  address?: { street: string; houseNo: string; postalCode: string; city: string; floor?: string; bell?: string; hint?: string };
};
export type Priced = { items: OnlineOrderItem[]; subtotalRappen: number };

/** Warenkorb auf dem Server rechnen: Artikel online bestellbar, Optionen prüfen, Text und Preis wie an der Kasse, MWST Take-away */
export async function priceCart(hotel: Hotel, lines: CartLine[], mode: "takeaway" | "dine_in" = "takeaway"): Promise<Priced> {
  if (!lines.length) throw new PosError("Der Warenkorb ist leer.");
  if (lines.length > 50) throw new PosError("Zu viele Positionen.");
  const vatLiable = invoicingSettings(hotel).vatLiable;
  const items: OnlineOrderItem[] = [];
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 50) throw new PosError("Menge: 1 bis 50.");
    const [it] = await db().select().from(posItems).where(and(eq(posItems.id, l.itemId), eq(posItems.hotelId, hotel.id)));
    if (!it || !it.active || !it.online) throw new PosError("Ein Artikel ist nicht mehr bestellbar.");
    const groups = await groupsOfItem(db(), hotel.id, it.id);
    const bad = checkChoice(groups, l.optionIds);
    if (bad) throw new PosError(`${it.name}: ${bad}`);
    if ((l.note ?? "").length > NOTE_MAX) throw new PosError(`Sonderwunsch: höchstens ${NOTE_MAX} Zeichen.`);
    const c = composeLine(it, groups, l.optionIds, l.note ?? "");
    items.push({ itemId: it.id, quantity: l.quantity, optionIds: l.optionIds, note: c.note, description: c.description, unitPriceRappen: c.unitPriceRappen, vatBps: vatLiable ? (mode === "dine_in" ? it.vatDineInBps : it.vatTakeawayBps) : 0, options: c.options });
  }
  return { items, subtotalRappen: items.reduce((a, i) => a + i.unitPriceRappen * i.quantity, 0) };
}

/** Bestellung anlegen (Gast). Karte → Stripe Checkout (Rückgabe der Zahlungsseite), bar → sofort «neu». */
export async function createOnlineOrder(hotel: Hotel, i: OrderInput, opts: { test?: boolean; now?: Date } = {}): Promise<{ order: OnlineOrder; checkoutUrl: string | null }> {
  const now = opts.now ?? new Date();
  const s = await orderSettings(hotel.id);
  if (!opts.test && !acceptsOrders(s, now)) throw new PosError("Zurzeit keine Online-Bestellungen.");
  if (i.kind === "pickup" && !s.pickup && !opts.test) throw new PosError("Abholung ist nicht möglich.");
  if (i.kind === "delivery" && !s.delivery) throw new PosError("Lieferung ist nicht möglich.");
  const name = clean(i.name, 80), phone = clean(i.phone, 40), email = clean(i.email, 200).toLowerCase();
  if (!name) throw new PosError("Bitte Ihren Namen angeben.");
  if (phone.replace(/\D/g, "").length < 9) throw new PosError("Bitte eine Telefonnummer angeben.");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new PosError("E-Mail-Adresse ungültig.");
  if (i.payment === "card" && !email) throw new PosError("Für die Bestätigung brauchen wir Ihre E-Mail-Adresse.");
  const priced = await priceCart(hotel, i.lines);
  let zone: DeliveryZone | null = null, fee = 0;
  const a = i.address;
  if (i.kind === "delivery") {
    if (!a || !clean(a.street, 120) || !clean(a.houseNo, 20) || !/^\d{4}$/.test(a.postalCode.trim()) || !clean(a.city, 80)) throw new PosError("Bitte Strasse, Hausnummer, PLZ und Ort angeben.");
    zone = zoneFor(await listZones(hotel.id), a.postalCode);
    if (!zone) throw new PosError(`Wir liefern leider nicht nach ${a.postalCode.trim()}.`);
    if (priced.subtotalRappen < zone.minOrderRappen) throw new PosError(`Mindestbestellwert für ${zone.name}: CHF ${(zone.minOrderRappen / 100).toFixed(2)}.`);
    fee = deliveryFee(zone, priced.subtotalRappen);
  }
  const total = priced.subtotalRappen + fee;
  if (i.payment === "cash") {
    const allowed = opts.test || (i.kind === "pickup" ? s.cashPickup : s.cashDelivery);
    if (!allowed) throw new PosError("Barzahlung ist nicht möglich.");
    if (i.kind === "delivery" && s.cashMaxRappen !== null && total > s.cashMaxRappen) throw new PosError(`Bar höchstens bis CHF ${(s.cashMaxRappen / 100).toFixed(2)}; bitte online bezahlen.`);
  } else if (!stripeReady(hotel)) throw new PosError("Online-Zahlung ist zurzeit nicht möglich.");
  // Zeit prüfen: freies Zeitfenster heute (Probebestellung: sofort)
  let requestedAt = now;
  if (!opts.test) {
    const slots = await slotsToday(hotel, i.kind, zone?.extraMinutes ?? 0, now);
    const slot = i.time === "asap" ? slots.find((x) => x.ok) : slots.find((x) => x.time === i.time && x.ok);
    if (!slot) throw new PosError("Diese Zeit ist nicht mehr frei. Bitte eine andere wählen.");
    requestedAt = zonedToUtc(todayIn(hotel.timezone, now), slot.time, hotel.timezone);
  }
  const day = todayIn(hotel.timezone, now);
  const token = randomBytes(18).toString("base64url");
  const feeState = await orderFeeState(hotel.id); // Sonderangebot, Normalpreis, Pilot-Kostendach (SPEC 20.4)
  const order = await db().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`online-order:${hotel.id}:${day}`}))`);
    const [{ n }] = rows<{ n: number }>(await tx.execute(sql`SELECT count(*)::int + 1 AS n FROM online_orders WHERE hotel_id = ${hotel.id} AND day = ${day}`));
    // Bisherige Gebühren im Monat (Kostendach); abgelehnte und abgebrochene zählen nicht
    const [{ m }] = opts.test ? [{ m: 0 }] : rows<{ m: number }>(await tx.execute(sql`SELECT coalesce(sum(fee_rappen),0)::int AS m FROM online_orders WHERE hotel_id = ${hotel.id} AND NOT is_test
       AND to_char(day, 'YYYY-MM') = ${day.slice(0, 7)} AND status NOT IN ('rejected','expired','cancelled','not_accepted')`));
    const [o] = await tx.insert(onlineOrders).values({
      hotelId: hotel.id, day, number: opts.test ? `T-${String(n).padStart(3, "0")}` : orderNumber(n), publicToken: token, kind: i.kind,
      status: i.payment === "card" && !opts.test ? "pending_payment" : "new", payment: i.payment, name, phone, email, referrer: i.referrer ?? null, language: isLocale(i.language) ? i.language : "de",
      street: clean(a?.street ?? "", 120), houseNo: clean(a?.houseNo ?? "", 20), postalCode: (a?.postalCode ?? "").trim(), city: clean(a?.city ?? "", 80),
      floor: clean(a?.floor ?? "", 40), bell: clean(a?.bell ?? "", 60), addressHint: clean(a?.hint ?? "", 200), zoneId: zone?.id ?? null,
      items: priced.items, subtotalRappen: priced.subtotalRappen, deliveryFeeRappen: fee, totalRappen: total,
      feeRappen: opts.test ? 0 : orderFee(feeState, day, total, hotel.platformFeeBps, m), requestedAt, note: clean(i.note ?? "", 300), isTest: !!opts.test,
    }).returning();
    await audit(tx, { hotelId: hotel.id, actor: opts.test ? "test" : "guest", action: "orders.create", entity: "online_order", entityId: o.id, details: { kind: o.kind, total, payment: o.payment, test: !!opts.test } });
    if (o.status === "new") await announceNew(tx, hotel, o);
    return o;
  });
  if (order.status !== "pending_payment") return { order, checkoutUrl: null };
  try {
    const provider = await getPaymentProvider();
    const lang = isLocale(order.language) ? order.language : "de";
    const back = `${publicUrl(hotel)}/${lang}/bestellung/${token}`;
    const co = await provider.createPaymentCheckout({
      hotel, amountRappen: total, feeRappen: order.feeRappen, email, lang, description: `${hotel.name} – Bestellung ${order.number}`.slice(0, 250),
      successUrl: `${back}?paid=1`, cancelUrl: `${publicUrl(hotel)}/${lang}/bestellen?abgebrochen=1`, metadata: { online_order_id: order.id }, reference: order.number, idempotencyKey: `online-order-${order.id}`,
    });
    await db().update(onlineOrders).set({ stripeSessionId: co.sessionId }).where(eq(onlineOrders.id, order.id));
    if (provider.confirmsImmediately) {
      await markOrderPaid(order.id, { sessionId: co.sessionId, paymentIntentId: provider.name === "fake" ? `fake_pi_${order.id}` : null });
      return { order: (await orderByToken(token))!, checkoutUrl: null };
    }
    return { order, checkoutUrl: co.url };
  } catch (e) {
    await db().update(onlineOrders).set({ status: "cancelled" }).where(eq(onlineOrders.id, order.id));
    console.error("[online-order checkout]", e);
    throw new PosError("Die Zahlung konnte nicht gestartet werden. Bitte versuchen Sie es erneut.");
  }
}

export function publicUrl(hotel: Hotel) {
  const own = Boolean(hotel.primaryDomain) && env().NODE_ENV === "production" && !env().ENVIRONMENT_LABEL;
  return own ? `https://${hotel.primaryDomain}` : `${env().APP_BASE_URL}/h/${hotel.slug}`;
}

type Ex = Parameters<typeof enqueueEmail>[0];
/** Neue Bestellung melden: Push an alle Geräte, Mail an den Betrieb, Eingangsbestätigung an den Gast */
async function announceNew(ex: Ex, hotel: Hotel, o: OnlineOrder) {
  const kind = o.kind === "delivery" ? "Lieferung" : "Abholung";
  await enqueuePush(ex, hotel.id, `order:${o.id}`, { title: `Neue Bestellung ${o.number}${o.isTest ? " (Probe)" : ""}`, body: `${kind} · CHF ${(o.totalRappen / 100).toFixed(2)} · ${o.name}`, url: `/admin/${hotel.id}/restaurant/bestellungen`, kind: "orders" });
  if (o.email && !o.isTest) await enqueueEmail(ex, { hotelId: hotel.id, template: "order_received", to: o.email, language: o.language, data: orderMailData(hotel, o) });
}

export function orderMailData(hotel: Hotel, o: OnlineOrder) {
  const lang = isLocale(o.language) ? o.language : "de";
  return {
    orderId: o.id, number: o.number, kind: o.kind, total: o.totalRappen, payment: o.payment, name: o.name, url: `${publicUrl(hotel)}/${lang}/bestellung/${o.publicToken}`,
    time: formatInTimeZone(o.promisedAt ?? o.requestedAt, hotel.timezone, "HH:mm"), reason: o.rejectReason,
    lines: o.items.map((i) => `${i.quantity} × ${i.description}`), deliveryFee: o.deliveryFeeRappen,
  };
}

export async function orderByToken(token: string): Promise<OnlineOrder | null> {
  const [o] = await db().select().from(onlineOrders).where(eq(onlineOrders.publicToken, token));
  return o ?? null;
}

/** Zahlung bestätigt (Webhook oder Fake): Bestellung wird «neu» und meldet sich. Kam die Zahlung nach Ablauf: zurückerstatten. */
export async function markOrderPaid(id: string, p: { sessionId: string | null; paymentIntentId: string | null }) {
  const late = await db().transaction(async (tx) => {
    const [o] = await tx.select().from(onlineOrders).where(eq(onlineOrders.id, id)).for("update");
    if (!o || o.stripePaymentIntentId) return null;
    await tx.update(onlineOrders).set({ stripePaymentIntentId: p.paymentIntentId, stripeSessionId: p.sessionId ?? o.stripeSessionId }).where(eq(onlineOrders.id, id));
    if (o.status !== "pending_payment") return o.status === "cancelled" || o.status === "expired" ? o : null;
    const hotel = (await getHotelById(o.hotelId, tx))!;
    const [u] = await tx.update(onlineOrders).set({ status: "new" }).where(eq(onlineOrders.id, id)).returning();
    await audit(tx, { hotelId: o.hotelId, actor: "payment", action: "orders.paid", entity: "online_order", entityId: id, details: { total: o.totalRappen } });
    await announceNew(tx, hotel, u);
    return null;
  });
  if (late) await refundOrder(id, "late_payment");
}

/** Zahlungsseite abgelaufen/gescheitert */
export async function cancelUnpaidOrder(id: string) {
  await db().update(onlineOrders).set({ status: "cancelled" }).where(and(eq(onlineOrders.id, id), eq(onlineOrders.status, "pending_payment")));
}

async function refundOrder(id: string, reason: string): Promise<boolean> {
  const [o] = await db().select().from(onlineOrders).where(eq(onlineOrders.id, id));
  if (!o || o.payment !== "card" || o.refundedAt || !o.stripePaymentIntentId) return false;
  const hotel = await getHotelById(o.hotelId);
  if (!hotel) return false;
  await (await getPaymentProvider()).refund({ hotel, booking: { id: o.id }, paymentIntentId: o.stripePaymentIntentId, amountRappen: o.totalRappen });
  await db().update(onlineOrders).set({ refundedAt: new Date() }).where(eq(onlineOrders.id, id));
  await audit(db(), { hotelId: o.hotelId, actor: "payment", action: "orders.refund", entity: "online_order", entityId: id, details: { amount: o.totalRappen, reason } });
  return true;
}

// ---------------------------------------------------------------- Bestellbildschirm

const ACTIVE = ["new", "accepted", "ready", "out"] as const;

/** Offene Bestellungen und die letzten erledigten von heute */
export async function screenOrders(hotelId: string) {
  const open = await db().select().from(onlineOrders).where(and(eq(onlineOrders.hotelId, hotelId), inArray(onlineOrders.status, [...ACTIVE]))).orderBy(asc(onlineOrders.requestedAt));
  const done = await db().select().from(onlineOrders).where(and(eq(onlineOrders.hotelId, hotelId), inArray(onlineOrders.status, ["completed", "rejected", "expired", "not_accepted"]), gte(onlineOrders.createdAt, new Date(Date.now() - 16 * 3_600_000)))).orderBy(desc(onlineOrders.createdAt)).limit(30);
  const keys = open.filter((o) => o.kind === "delivery").map((o) => addressKey(o.street, o.houseNo, o.postalCode));
  const flags = keys.length ? await db().select().from(deliveryFlags).where(and(eq(deliveryFlags.hotelId, hotelId), inArray(deliveryFlags.addressKey, keys))) : [];
  return { open, done, flagged: new Set(flags.map((f) => f.addressKey)) };
}

async function onlineDevice(hotelId: string) {
  const [d] = await db().select().from(posDevices).where(and(eq(posDevices.hotelId, hotelId), eq(posDevices.code, "ONL")));
  return d ?? createDevice(hotelId, "ONL", "Online-Bestellung", "system");
}

async function load(hotelId: string, id: string) {
  const [o] = await db().select().from(onlineOrders).where(and(eq(onlineOrders.id, id), eq(onlineOrders.hotelId, hotelId)));
  if (!o) throw new PosError("Bestellung nicht gefunden.");
  return o;
}

/** Annehmen: Zeit zusagen, pos_order mit Zeilen anlegen (Küche), Kartenzahlung als Bon buchen */
export async function acceptOrder(hotel: Hotel, id: string, extraMinutes: number, actor: string): Promise<OnlineOrder> {
  const o = await load(hotel.id, id);
  if (o.status !== "new") throw new PosError("Diese Bestellung ist nicht mehr neu.");
  if (![0, 10, 20, 30, 45, 60].includes(extraMinutes)) throw new PosError("Zeit ungültig.");
  const promised = new Date(Math.max(o.requestedAt.getTime(), Date.now()) + extraMinutes * 60_000);
  const [claimed] = await db().update(onlineOrders).set({ status: "accepted", acceptedAt: new Date(), promisedAt: promised }).where(and(eq(onlineOrders.id, id), eq(onlineOrders.status, "new"))).returning();
  if (!claimed) throw new PosError("Diese Bestellung ist nicht mehr neu.");
  let posOrderId: string | null = null, receiptId: string | null = null;
  if (!o.isTest) {
    const dev = await onlineDevice(hotel.id);
    const label = `${o.kind === "delivery" ? "Lieferung" : "Abholung"} ${formatInTimeZone(promised, hotel.timezone, "HH:mm")} · ${o.number}`;
    posOrderId = crypto.randomUUID();
    await db().insert(posOrders).values({ id: posOrderId, hotelId: hotel.id, tableId: null, deviceId: dev.id, label: label.slice(0, 60), openedBy: actor }).onConflictDoNothing();
    const lines = await addLines(hotel, posOrderId, o.items.map((l) => ({ itemId: l.itemId, quantity: l.quantity, mode: "takeaway" as const, optionIds: l.optionIds, note: l.note, snapshot: { description: l.description, unitPriceRappen: l.unitPriceRappen, vatBps: l.vatBps }, optionsSnapshot: l.options })), actor);
    const all = [...lines];
    if (o.deliveryFeeRappen > 0) {
      // Liefergebühr als eigene Zeile (MWST wie Speisen; ASSUMPTION, Treuhänder)
      const [fl] = await db().insert(posOrderLines).values({ id: crypto.randomUUID(), hotelId: hotel.id, orderId: posOrderId, description: "Liefergebühr", quantity: 1, unitPriceRappen: o.deliveryFeeRappen, vatBps: invoicingSettings(hotel).vatLiable ? 260 : 0, mode: "takeaway", createdBy: actor }).returning();
      all.push(fl);
    }
    if (o.payment === "card") {
      const r = await pay(hotel, { orderId: posOrderId, deviceId: dev.id, selection: all.map((l) => ({ lineId: l.id, quantity: l.quantity })), payments: [{ method: "card", amountRappen: o.totalRappen }] }, actor);
      receiptId = r.id;
    }
    await db().update(onlineOrders).set({ posOrderId, receiptId }).where(eq(onlineOrders.id, id));
  }
  await audit(db(), { hotelId: hotel.id, actor, action: "orders.accept", entity: "online_order", entityId: id, details: { extraMinutes } });
  const u = await load(hotel.id, id);
  if (u.email && !u.isTest) await enqueueEmail(db(), { hotelId: hotel.id, template: "order_accepted", to: u.email, language: u.language, data: orderMailData(hotel, u) });
  return u;
}

/** Ablehnen mit Grund: Karte zurückerstatten, Gast informieren */
export async function rejectOrder(hotel: Hotel, id: string, reason: string, actor: string, status: "rejected" | "expired" = "rejected") {
  const why = clean(reason, 200);
  if (status === "rejected" && !why) throw new PosError("Bitte einen Grund angeben.");
  const [o] = await db().update(onlineOrders).set({ status, rejectReason: why }).where(and(eq(onlineOrders.id, id), eq(onlineOrders.hotelId, hotel.id), eq(onlineOrders.status, "new"))).returning();
  if (!o) throw new PosError("Diese Bestellung ist nicht mehr neu.");
  await refundOrder(id, status);
  await audit(db(), { hotelId: hotel.id, actor, action: `orders.${status}`, entity: "online_order", entityId: id, details: { reason: why } });
  if (o.email && !o.isTest) await enqueueEmail(db(), { hotelId: hotel.id, template: "order_rejected", to: o.email, language: o.language, data: { ...orderMailData(hotel, o), refunded: o.payment === "card" } });
}

async function guestSms(hotel: Hotel, o: OnlineOrder, text: string, ref: string) {
  const s = await orderSettings(hotel.id);
  if (s.guestSms && !o.isTest) await enqueueSms(db(), { hotelId: hotel.id, to: o.phone, text, kind: "guest", ref });
}

/** «Bereit»: Küchenzeilen fertig, Mail (und SMS, wenn eingeschaltet) an den Gast. Probebestellung: bestanden. */
export async function readyOrder(hotel: Hotel, id: string, actor: string) {
  const [o] = await db().update(onlineOrders).set({ status: "ready", readyAt: new Date() }).where(and(eq(onlineOrders.id, id), eq(onlineOrders.hotelId, hotel.id), eq(onlineOrders.status, "accepted"))).returning();
  if (!o) throw new PosError("Diese Bestellung ist nicht angenommen.");
  if (o.posOrderId) await db().execute(sql`INSERT INTO pos_line_done (line_id, hotel_id, done_by) SELECT id, hotel_id, ${actor} FROM pos_order_lines WHERE order_id = ${o.posOrderId} AND hotel_id = ${hotel.id} ON CONFLICT DO NOTHING`);
  if (o.isTest) {
    await upsertSettings(hotel.id, { testPassedAt: new Date() });
    await db().update(onlineOrders).set({ status: "completed", completedAt: new Date() }).where(eq(onlineOrders.id, id));
    await audit(db(), { hotelId: hotel.id, actor, action: "orders.test_passed", entity: "online_order", entityId: id });
    return;
  }
  await audit(db(), { hotelId: hotel.id, actor, action: "orders.ready", entity: "online_order", entityId: id });
  if (o.kind === "pickup") {
    if (o.email) await enqueueEmail(db(), { hotelId: hotel.id, template: "order_ready", to: o.email, language: o.language, data: orderMailData(hotel, o) });
    await guestSms(hotel, o, `${hotel.name}: Ihre Bestellung ${o.number} ist bereit zur Abholung.`, `order-ready:${o.id}`);
  }
}

/** Lieferung: Fahrer fährt los (Mail/SMS «unterwegs») */
export async function outForDelivery(hotel: Hotel, id: string, driver: string, actor: string) {
  const [o] = await db().update(onlineOrders).set({ status: "out", outAt: new Date(), driver: clean(driver, 80) }).where(and(eq(onlineOrders.id, id), eq(onlineOrders.hotelId, hotel.id), eq(onlineOrders.kind, "delivery"), inArray(onlineOrders.status, ["accepted", "ready"]))).returning();
  if (!o) throw new PosError("Diese Lieferung kann nicht losfahren.");
  await audit(db(), { hotelId: hotel.id, actor, action: "orders.out", entity: "online_order", entityId: id });
  if (o.email) await enqueueEmail(db(), { hotelId: hotel.id, template: "order_out", to: o.email, language: o.language, data: orderMailData(hotel, o) });
  await guestSms(hotel, o, `${hotel.name}: Ihre Bestellung ${o.number} ist unterwegs.`, `order-out:${o.id}`);
}

/** Abgeholt bzw. geliefert: bei Barzahlung entsteht jetzt der Bon (Fahrer im Bon vermerkt) */
export async function completeOrder(hotel: Hotel, id: string, actor: string) {
  const o = await load(hotel.id, id);
  if (!["accepted", "ready", "out"].includes(o.status)) throw new PosError("Diese Bestellung ist nicht offen.");
  let receiptId = o.receiptId;
  if (o.payment === "cash" && o.posOrderId && !receiptId) {
    const dev = await onlineDevice(hotel.id);
    const lines = await db().select().from(posOrderLines).where(and(eq(posOrderLines.orderId, o.posOrderId), eq(posOrderLines.hotelId, hotel.id)));
    const r = await pay(hotel, { orderId: o.posOrderId, deviceId: dev.id, selection: lines.filter((l) => !l.reversesLineId).map((l) => ({ lineId: l.id, quantity: l.quantity })), payments: [{ method: "cash", amountRappen: o.totalRappen }] }, o.driver ? `driver:${o.driver}` : actor);
    receiptId = r.id;
  }
  await db().update(onlineOrders).set({ status: "completed", completedAt: new Date(), receiptId }).where(eq(onlineOrders.id, id));
  await audit(db(), { hotelId: hotel.id, actor, action: "orders.complete", entity: "online_order", entityId: id, details: { payment: o.payment, driver: o.driver } });
}

/** Lieferung nicht angenommen: Adresse markieren; Bestellung endet ohne Bon (bar) */
export async function notAccepted(hotel: Hotel, id: string, actor: string) {
  const [o] = await db().update(onlineOrders).set({ status: "not_accepted", completedAt: new Date() }).where(and(eq(onlineOrders.id, id), eq(onlineOrders.hotelId, hotel.id), eq(onlineOrders.kind, "delivery"), inArray(onlineOrders.status, ["accepted", "ready", "out"]))).returning();
  if (!o) throw new PosError("Diese Lieferung ist nicht offen.");
  await db().insert(deliveryFlags).values({ hotelId: hotel.id, addressKey: addressKey(o.street, o.houseNo, o.postalCode), reason: `${o.number} nicht angenommen` }).onConflictDoNothing();
  await audit(db(), { hotelId: hotel.id, actor, action: "orders.not_accepted", entity: "online_order", entityId: id });
}

/** Probebestellung (SPEC 20.4): ein Artikel, bar, ohne Gebühr und Bon; bestanden, wenn sie auf dem Bestellbildschirm «bereit» gemeldet wird */
export async function startTestOrder(hotel: Hotel, actor: string) {
  const [it] = await db().select().from(posItems).where(and(eq(posItems.hotelId, hotel.id), eq(posItems.active, true))).orderBy(asc(posItems.sortOrder)).limit(1);
  if (!it) throw new PosError("Für die Probebestellung braucht es mindestens einen Artikel.");
  const groups = await groupsOfItem(db(), hotel.id, it.id);
  const optionIds = groups.filter((g) => g.required).map((g) => g.options[0]?.id).filter(Boolean) as string[];
  const r = await createOnlineOrder(hotel, { kind: "pickup", time: "asap", payment: "cash", name: "Probebestellung", phone: hotel.contactPhone || "0000000000", email: "", language: "de", lines: [{ itemId: it.id, quantity: 1, optionIds, note: "Probe" }] }, { test: true });
  await audit(db(), { hotelId: hotel.id, actor, action: "orders.test_start", entity: "online_order", entityId: r.order.id });
  return r.order;
}

// ---------------------------------------------------------------- Herzschlag und Absicherung

/** Bestellbildschirm meldet sich (jede Minute). Endet eine automatische Pause, wenn wieder ein Gerät da ist. */
export async function heartbeat(hotelId: string, deviceKey: string, info: { battery?: number | null; charging?: boolean | null; soundOk?: boolean; label?: string }) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceKey)) throw new PosError("Gerät ungültig.");
  const battery = info.battery === null || info.battery === undefined ? null : Math.max(0, Math.min(100, Math.round(info.battery)));
  const set = { lastSeenAt: new Date(), battery, charging: info.charging ?? null, ...(info.soundOk ? { soundOkAt: new Date() } : {}), ...(info.label ? { label: clean(info.label, 40) } : {}) };
  await db().insert(orderScreens).values({ hotelId, deviceKey, ...set }).onConflictDoUpdate({ target: [orderScreens.hotelId, orderScreens.deviceKey], set });
  const s = await orderSettings(hotelId);
  if (s.autoPaused) {
    await upsertSettings(hotelId, { autoPaused: false });
    await audit(db(), { hotelId, actor: "system", action: "orders.auto_resume", entity: "online_order_settings", entityId: hotelId });
  }
}

export const screensOf = (hotelId: string) => db().select().from(orderScreens).where(eq(orderScreens.hotelId, hotelId)).orderBy(desc(orderScreens.lastSeenAt));

/** Job jede Minute: Alarm nach 5 Min., Storno nach 10 Min., unbezahlte verfallen, Herzschlag prüfen */
export async function onlineOrdersJob(now = new Date()): Promise<{ alarmed: number; expired: number; unpaid: number; paused: number }> {
  let alarmed = 0, expired = 0, paused = 0;
  const unpaid = await db().update(onlineOrders).set({ status: "cancelled" }).where(and(eq(onlineOrders.status, "pending_payment"), lt(onlineOrders.createdAt, new Date(now.getTime() - UNPAID_EXPIRE_MIN * 60_000)))).returning({ id: onlineOrders.id });
  const fresh = await db().select().from(onlineOrders).where(and(eq(onlineOrders.status, "new"), eq(onlineOrders.isTest, false), lt(onlineOrders.createdAt, new Date(now.getTime() - ACCEPT_ALARM_MIN * 60_000))));
  for (const o of fresh) {
    const hotel = await getHotelById(o.hotelId);
    if (!hotel) continue;
    const age = (now.getTime() - (o.stripePaymentIntentId && o.payment === "card" ? o.createdAt.getTime() : o.createdAt.getTime())) / 60_000;
    if (age >= ACCEPT_EXPIRE_MIN) {
      try { await rejectOrder(hotel, o.id, "Das Restaurant hat die Bestellung nicht rechtzeitig angenommen.", "system", "expired"); expired++; } catch { /* inzwischen angenommen */ }
      continue;
    }
    if (o.alarmedAt) continue;
    const [u] = await db().update(onlineOrders).set({ alarmedAt: now }).where(and(eq(onlineOrders.id, o.id), isNull(onlineOrders.alarmedAt))).returning();
    if (!u) continue;
    const text = `${hotel.name}: Bestellung ${o.number} wartet seit ${ACCEPT_ALARM_MIN} Minuten. Bitte annehmen, sonst wird sie nach ${ACCEPT_EXPIRE_MIN} Minuten storniert.`;
    // ASSUMPTION: Alarme gehen an das Telefon des Betriebs (Grunddaten) und an die Kontakt-Mail
    if (hotel.contactPhone) await enqueueSms(db(), { hotelId: hotel.id, to: hotel.contactPhone, text, kind: "alarm", ref: `order-alarm:${o.id}` });
    await enqueueEmail(db(), { hotelId: hotel.id, template: "order_alarm", to: hotel.contactEmail, language: "de", data: { number: o.number, text } });
    await enqueuePush(db(), hotel.id, `order-alarm:${o.id}`, { title: `Bestellung ${o.number} wartet`, body: text, url: `/admin/${hotel.id}/restaurant/bestellungen`, kind: "orders" });
    alarmed++;
  }
  // Herzschlag: während der Öffnungszeit muss ein Bestellbildschirm erreichbar sein
  const live = await db().select().from(onlineOrderSettings).where(and(eq(onlineOrderSettings.enabled, true), eq(onlineOrderSettings.autoPaused, false)));
  for (const s of live) {
    if (s.pausedUntil && s.pausedUntil.getTime() > now.getTime()) continue;
    const hotel = await getHotelById(s.hotelId);
    if (!hotel) continue;
    const rs = await resSettings(hotel.id);
    if (!openNow(rs.openingHours, nowIn(hotel, now))) continue;
    const [seen] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM order_screens WHERE hotel_id = ${hotel.id} AND last_seen_at > ${new Date(now.getTime() - HEARTBEAT_STALE_MIN * 60_000)}`));
    if (seen.n > 0) continue;
    await upsertSettings(hotel.id, { autoPaused: true });
    await audit(db(), { hotelId: hotel.id, actor: "system", action: "orders.auto_pause", entity: "online_order_settings", entityId: hotel.id });
    const text = `${hotel.name}: Kein Bestellbildschirm erreichbar. Die Online-Bestellung ist pausiert, bis ein Gerät wieder online ist.`;
    const ref = `screen-offline:${hotel.id}:${formatInTimeZone(now, hotel.timezone, "yyyy-MM-dd'T'HH")}`;
    if (hotel.contactPhone) await enqueueSms(db(), { hotelId: hotel.id, to: hotel.contactPhone, text, kind: "alarm", ref });
    await enqueueEmail(db(), { hotelId: hotel.id, template: "order_alarm", to: hotel.contactEmail, language: "de", data: { number: "", text } });
    paused++;
  }
  return { alarmed, expired, unpaid: unpaid.length, paused };
}

/** Bargeld je Fahrer heute (Tagesübersicht) */
export async function cashByDriver(hotel: Hotel) {
  const day = todayIn(hotel.timezone);
  return rows<{ driver: string; n: number; total: number }>(await db().execute(sql`
    SELECT driver, count(*)::int AS n, coalesce(sum(total_rappen),0)::int AS total FROM online_orders
     WHERE hotel_id = ${hotel.id} AND day = ${day} AND kind = 'delivery' AND payment = 'cash' AND status = 'completed' AND NOT is_test GROUP BY driver ORDER BY driver`));
}

/** Gebühren der Online-Bestellungen eines Monats: Karte ab Annahme (über Stripe einbehalten), bar beim Abschluss (nicht einbehalten, kommt auf die Monatsrechnung) */
export async function orderFeesForMonth(hotel: Hotel, month: string): Promise<{ total: number; uncollected: number }> {
  const [r] = rows<{ total: number; cash: number }>(await db().execute(sql`
    SELECT coalesce(sum(fee_rappen),0)::int AS total, coalesce(sum(fee_rappen) FILTER (WHERE payment = 'cash'),0)::int AS cash FROM online_orders
     WHERE hotel_id = ${hotel.id} AND NOT is_test AND (
       (payment = 'card' AND status IN ('accepted','ready','out','completed') AND to_char(accepted_at AT TIME ZONE ${hotel.timezone}, 'YYYY-MM') = ${month})
       OR (payment = 'cash' AND status = 'completed' AND to_char(completed_at AT TIME ZONE ${hotel.timezone}, 'YYYY-MM') = ${month}))`));
  return { total: r?.total ?? 0, uncollected: r?.cash ?? 0 };
}

/** Monatspauschale Online-Bestellung (SPEC 20.4): fällig im Sonderangebot (oder Modell «fixed»), wenn die Online-Bestellung beim Abrechnen eingeschaltet ist oder im Monat echte Bestellungen hatte */
export async function orderModuleFee(hotel: Hotel, month: string): Promise<number> {
  const { ORDER_MODULE_RAPPEN } = await import("../domain/platform-invoice");
  if (!flatForMonth(await orderFeeState(hotel.id), month)) return 0;
  if ((await orderSettings(hotel.id)).enabled) return ORDER_MODULE_RAPPEN;
  const [r] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM online_orders WHERE hotel_id = ${hotel.id} AND NOT is_test AND status IN ('accepted','ready','out','completed') AND to_char(created_at AT TIME ZONE ${hotel.timezone}, 'YYYY-MM') = ${month}`));
  return r?.n ? ORDER_MODULE_RAPPEN : 0;
}
