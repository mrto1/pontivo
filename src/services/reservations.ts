import { randomBytes } from "node:crypto";
import { and, asc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { db, rows } from "../db/client";
import { posReservations, posTables, posWaitlist, restaurantSettings, type Hotel, type PosReservation } from "../db/schema";
import { addDays, diffDays, isDay, todayIn, zonedToUtc } from "../domain/dates";
import { TIME_RE, checkOpeningHours, checkWindows, coversAt, depositFor, onlineSlots, refundable, suggestTable, tableFree, type ResSettings, type Slot, PENDING_MINUTES } from "../domain/reservations";
import { enqueueEmail } from "../email/enqueue";
import { env } from "../env";
import { getPaymentProvider } from "../payments/provider";
import { isLocale } from "../i18n/dict";
import { enqueuePush } from "../push/service";
import { audit } from "./audit";
import { getHotelById } from "./hotels";
import { PosError, addLines, createDevice, openOrder, pay } from "./pos";
import { priceCart, type CartLine } from "./online-orders";
import { posDevices, type OnlineOrderItem } from "../db/schema";

/** Tischreservierungen, intern und online (SPEC 19.49 Etappe C). Jede Abfrage nach hotel_id. */
const clean = (v: string, max: number) => v.replace(/\s+/g, " ").trim().slice(0, max);

export const DEFAULT_SETTINGS: ResSettings = {
  onlineEnabled: false, windows: [{ from: "11:30", to: "13:30" }, { from: "18:00", to: "21:00" }], durationMin: 90, maxParty: 8, capacity: 40, leadHours: 2, horizonDays: 60,
  depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 24, autoAssign: true,
};

/** Online-Reservierung für Gäste möglich? (Modul «restaurant» an und Online-Reservierung eingeschaltet, SPEC 20.2) */
export async function tableReservationOnline(hotelId: string): Promise<boolean> {
  const [m] = rows<{ on: boolean }>(await db().execute(sql`SELECT enabled AS on FROM hotel_modules WHERE hotel_id = ${hotelId} AND module = 'restaurant'`));
  return !!m?.on && (await getSettings(hotelId)).onlineEnabled;
}

export async function getSettings(hotelId: string): Promise<ResSettings> {
  const [r] = await db().select().from(restaurantSettings).where(eq(restaurantSettings.hotelId, hotelId));
  if (!r) return DEFAULT_SETTINGS;
  const { hotelId: _h, updatedAt: _u, ...s } = r;
  return s;
}

export async function saveSettings(hotelId: string, s: ResSettings, actor: string) {
  const bad = checkWindows(s.windows);
  if (bad) throw new PosError(bad);
  const ranges: [number, number, number, string][] = [
    [s.durationMin, 30, 480, "Dauer"], [s.maxParty, 1, 50, "Grösste Gruppe"], [s.capacity, 1, 1000, "Plätze"], [s.leadHours, 0, 168, "Vorlauf"], [s.horizonDays, 1, 365, "Vorschau"],
    [s.depositPerPersonRappen, 0, 100_000, "Anzahlung"], [s.depositFromParty, 1, 50, "Anzahlung ab Personen"], [s.cancelHours, 0, 168, "Gratis-Storno bis"], [s.reminderHours, 0, 72, "Erinnerung"],
  ];
  for (const [v, lo, hi, n] of ranges) if (!Number.isInteger(v) || v < lo || v > hi) throw new PosError(`${n}: ${lo} bis ${hi}.`);
  if (s.depositPerPersonRappen > 0) {
    const h = await getHotelById(hotelId);
    if (!h?.stripeAccountId) throw new PosError("Für die Anzahlung braucht der Betrieb ein verbundenes Stripe-Konto (Einstellungen → Zahlungsmethoden).");
  }
  await db().transaction(async (tx) => {
    await tx.insert(restaurantSettings).values({ hotelId, ...s }).onConflictDoUpdate({ target: restaurantSettings.hotelId, set: { ...s, updatedAt: new Date() } });
    await audit(tx, { hotelId, actor, action: "restaurant.settings", entity: "restaurant_settings", entityId: hotelId });
  });
}

/** Öffnungszeiten speichern (Grunddaten, SPEC 20.1); null = keine Einschränkung */
export async function saveOpeningHours(hotelId: string, h: Record<string, { from: string; to: string }[]> | null, actor: string) {
  if (h) { const bad = checkOpeningHours(h); if (bad) throw new PosError(bad); }
  await db().transaction(async (tx) => {
    const cur = await getSettings(hotelId);
    await tx.insert(restaurantSettings).values({ hotelId, ...cur, openingHours: h }).onConflictDoUpdate({ target: restaurantSettings.hotelId, set: { openingHours: h, updatedAt: new Date() } });
    await audit(tx, { hotelId, actor, action: "restaurant.opening_hours", entity: "restaurant_settings", entityId: hotelId });
  });
}

/** Online-Reservierungen, die heute eingegangen sind (Punkt am Umschalter, SPEC 20.1) */
export async function onlineReservationsToday(hotel: Hotel): Promise<number> {
  const start = zonedToUtc(todayIn(hotel.timezone), "00:00", hotel.timezone);
  const [r] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM pos_reservations WHERE hotel_id = ${hotel.id} AND source = 'online' AND status IN ('confirmed','pending') AND created_at >= ${start}`));
  return r?.n ?? 0;
}

/** Mitteilung «Neue Reservierung» (nur Online-Reservierungen; ohne Namen, die Mitteilung erscheint auf dem Sperrbildschirm) */
async function pushNewReservation(ex: Parameters<typeof enqueuePush>[0], hotelId: string, r: PosReservation) {
  if (r.source !== "online") return;
  await enqueuePush(ex, hotelId, `reservation:${r.id}`, { title: "Neue Reservierung", body: `${r.day} ${r.time} · ${r.party} ${r.party === 1 ? "Person" : "Personen"}`, url: `/admin/${hotelId}/restaurant/reservierungen`, kind: "reservations" });
}

export const reservationsOfDay = (hotelId: string, day: string) =>
  db().select().from(posReservations).where(and(eq(posReservations.hotelId, hotelId), eq(posReservations.day, day))).orderBy(asc(posReservations.time), asc(posReservations.createdAt));

/** Reservierungen im Zeitraum */
export const reservationsBetween = (hotelId: string, from: string, to: string) =>
  db().select().from(posReservations).where(and(eq(posReservations.hotelId, hotelId), gte(posReservations.day, from), lte(posReservations.day, to))).orderBy(asc(posReservations.day), asc(posReservations.time));

function nowIn(hotel: Hotel) {
  const d = new Date();
  return { day: todayIn(hotel.timezone, d), minutes: Number(formatInTimeZone(d, hotel.timezone, "H")) * 60 + Number(formatInTimeZone(d, hotel.timezone, "m")) };
}

/** Öffentliche Adresse einer Reservierung (eigene Domain im Betrieb, sonst Vorschau unter /h/<slug>) */
export function reservationUrl(hotel: Hotel, locale: string, token: string): string {
  const own = Boolean(hotel.primaryDomain) && env().NODE_ENV === "production" && !env().ENVIRONMENT_LABEL;
  return `${own ? `https://${hotel.primaryDomain}` : `${env().APP_BASE_URL}/h/${hotel.slug}`}/${locale}/tisch/${token}`;
}

/** Freie Zeiten für Gäste an einem Tag */
export async function slotsFor(hotel: Hotel, day: string, party: number): Promise<Slot[]> {
  if (!isDay(day) || !(await tableReservationOnline(hotel.id))) return [];
  const [s, ex] = await Promise.all([getSettings(hotel.id), reservationsOfDay(hotel.id, day)]);
  const now = nowIn(hotel);
  return onlineSlots(s, day, party, ex, now, diffDays(now.day, day));
}

export type ReservationInput = { day: string; time: string; party: number; name: string; phone?: string; email?: string; note?: string; tableId?: string | null; language?: string; /** Vorbestellung (nur online, SPEC 19.57) */ preorder?: CartLine[] };
export type Created = { reservation: PosReservation; /** nur bei Anzahlung: Zahlungsseite, auf die der Gast weitergeleitet wird */ checkoutUrl: string | null };

/**
 * Reservierung anlegen. `online`: Zeitfenster, Vorlauf, Kapazität und Gruppengrösse gelten; intern darf der Betrieb überbuchen.
 * Online mit Anzahlung: Status «pending» (hält die Plätze 35 Minuten), bestätigt wird erst nach der Zahlung. Ohne Tisch wird bei «autoAssign» der passende gewählt.
 */
export async function createReservation(hotel: Hotel, i: ReservationInput, source: "admin" | "online", actor: string): Promise<Created> {
  const name = clean(i.name, 80);
  if (!name) throw new PosError("Der Name fehlt.");
  if (!isDay(i.day)) throw new PosError("Datum ungültig.");
  if (!TIME_RE.test(i.time)) throw new PosError("Uhrzeit ungültig.");
  if (!Number.isInteger(i.party) || i.party < 1 || i.party > 50) throw new PosError("Personen: 1 bis 50.");
  const email = clean(i.email ?? "", 200).toLowerCase();
  const phone = clean(i.phone ?? "", 40);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new PosError("E-Mail-Adresse ungültig.");
  if (source === "online" && !email && !phone) throw new PosError("Bitte E-Mail oder Telefon angeben.");
  const s = await getSettings(hotel.id);
  // Anzahlung erst, wenn Stripe Zahlungen freigegeben hat (Konzept 7a: Prüfung blockiert nur Zahlungen, nicht die Reservierung)
  const stripeOk = env().PAYMENT_PROVIDER !== "stripe" || !!(hotel.stripeAccountId && hotel.stripeChargesEnabled);
  // Vorbestellung (SPEC 19.57): wird ganz vorab bezahlt und ersetzt die Anzahlung (ASSUMPTION: Summe der Vorbestellung = Anzahlung)
  const pre = (i.preorder ?? []).filter((l) => l.quantity > 0);
  const preRequired = source === "online" && !!s.preorderEnabled && !!s.preorderRequiredFrom && i.party >= s.preorderRequiredFrom;
  if (pre.length && (source !== "online" || !s.preorderEnabled)) throw new PosError("Vorbestellung ist hier nicht möglich.");
  if (preRequired && !pre.length) throw new PosError(`Ab ${s.preorderRequiredFrom} Personen bitte eine Vorbestellung aufgeben.`);
  let preItems: OnlineOrderItem[] | null = null;
  let preTotal = 0;
  if (pre.length) {
    if (!stripeOk) throw new PosError("Vorbestellung ist nur mit Online-Zahlung möglich.");
    const priced = await priceCart(hotel, pre, "dine_in");
    preItems = priced.items; preTotal = priced.subtotalRappen;
  }
  const deposit = source === "online" && stripeOk ? (preTotal > 0 ? preTotal : depositFor(s, i.party)) : 0;
  if (deposit > 0 && !email) throw new PosError(preTotal > 0 ? "Für die Vorbestellung brauchen wir Ihre E-Mail-Adresse." : "Für die Anzahlung brauchen wir Ihre E-Mail-Adresse.");

  const token = randomBytes(18).toString("base64url");
  const r = await db().transaction(async (tx) => {
    const existing = await tx.select().from(posReservations).where(and(eq(posReservations.hotelId, hotel.id), eq(posReservations.day, i.day)));
    if (source === "online") {
      const now = nowIn(hotel);
      const slot = onlineSlots(s, i.day, i.party, existing, now, diffDays(now.day, i.day)).find((x) => x.time === i.time);
      if (!s.onlineEnabled || !(await tableReservationOnline(hotel.id))) throw new PosError("Online-Reservierung ist nicht aktiv.");
      if (i.party > s.maxParty) throw new PosError(`Für Gruppen ab ${s.maxParty + 1} Personen bitte anrufen.`);
      if (!slot || !slot.ok) throw new PosError("Diese Zeit ist leider nicht mehr frei. Bitte eine andere wählen.");
    }
    const tables = await tx.select().from(posTables).where(and(eq(posTables.hotelId, hotel.id), eq(posTables.active, true))).orderBy(asc(posTables.sortOrder), asc(posTables.name));
    let tableId: string | null = null;
    if (i.tableId) {
      const t = tables.find((x) => x.id === i.tableId);
      if (!t) throw new PosError("Tisch nicht gefunden.");
      if (!tableFree(existing, t.id, i.time, s.durationMin)) throw new PosError(`${t.name} ist zu dieser Zeit schon reserviert.`);
      tableId = t.id;
    } else if (s.autoAssign) tableId = suggestTable(tables, existing, i.party, i.time, s.durationMin);
    const [row] = await tx.insert(posReservations).values({
      hotelId: hotel.id, day: i.day, time: i.time, party: i.party, name, phone, email, note: clean(i.note ?? "", 300), tableId, source, language: i.language ?? hotel.defaultLanguage, publicToken: token,
      status: deposit > 0 ? "pending" : "confirmed", depositRappen: deposit, depositStatus: deposit > 0 ? "pending" : "none",
      preorder: preItems, preorderRappen: preTotal,
    }).returning();
    await audit(tx, { hotelId: hotel.id, actor, action: "reservation.create", entity: "pos_reservation", entityId: row.id, details: { source, day: row.day, time: row.time, party: row.party, deposit, preorder: preTotal } });
    if (!deposit && email) await sendConfirmation(tx, hotel, row);
    // ASSUMPTION: Mit Anzahlung kommt die Mitteilung erst, wenn bezahlt ist (unbezahlte laufen ab)
    if (!deposit) await pushNewReservation(tx, hotel.id, row);
    return row;
  });
  if (!deposit) return { reservation: r, checkoutUrl: null };
  // Zahlungsseite ausserhalb der Transaktion; schlägt sie fehl, wird die Reservierung wieder freigegeben
  try {
    const provider = await getPaymentProvider();
    const lang = isLocale(r.language) ? r.language : "de";
    const back = reservationUrl(hotel, lang, token);
    const co = await provider.createPaymentCheckout({
      hotel, amountRappen: deposit, feeRappen: 0, email, lang, description: `${hotel.name} – ${preTotal > 0 ? "Vorbestellung" : `${i.party} × Tischreservierung`} ${i.day} ${i.time}`.slice(0, 250),
      successUrl: `${back}?new=1`, cancelUrl: `${back}`, metadata: { reservation_id: r.id }, reference: r.id.slice(0, 8), idempotencyKey: `table-${r.id}`,
    });
    await db().update(posReservations).set({ stripeSessionId: co.sessionId }).where(eq(posReservations.id, r.id));
    if (provider.confirmsImmediately) {
      await markReservationPaid(r.id, { sessionId: co.sessionId, paymentIntentId: provider.name === "fake" ? `fake_pi_${r.id}` : null });
      return { reservation: (await reservationByToken(token))!, checkoutUrl: null };
    }
    return { reservation: r, checkoutUrl: co.url };
  } catch (e) {
    await db().update(posReservations).set({ status: "cancelled", depositStatus: "none" }).where(eq(posReservations.id, r.id));
    console.error("[reservation checkout]", e);
    throw new PosError("Die Zahlung konnte nicht gestartet werden. Bitte versuchen Sie es erneut oder rufen Sie uns an.");
  }
}

type Ex = Parameters<typeof enqueueEmail>[0];
async function sendConfirmation(ex: Ex, hotel: Hotel, r: PosReservation) {
  if (!r.email) return;
  await enqueueEmail(ex, { hotelId: hotel.id, template: "table_reserved", to: r.email, language: r.language, data: { name: r.name, day: r.day, time: r.time, party: r.party, token: r.publicToken, reservationId: r.id, depositRappen: r.depositStatus === "paid" ? r.depositRappen : 0 } });
}

/** Zahlung der Anzahlung bestätigt (Webhook oder Fake): Reservierung gilt, Mail geht raus. Kam die Zahlung zu spät, wird zurückerstattet. Wiederholung unschädlich. */
export async function markReservationPaid(id: string, p: { sessionId: string | null; paymentIntentId: string | null }): Promise<void> {
  const late = await db().transaction(async (tx) => {
    const [r] = await tx.select().from(posReservations).where(eq(posReservations.id, id)).for("update");
    if (!r || r.depositStatus === "paid" || r.depositStatus === "refunded") return null;
    const hotel = await getHotelById(r.hotelId, tx);
    if (!hotel) return null;
    if (r.status === "cancelled") return r; // Zahlung nach Ablauf: unten zurückerstatten
    const [u] = await tx.update(posReservations).set({ status: "confirmed", depositStatus: "paid", stripePaymentIntentId: p.paymentIntentId, stripeSessionId: p.sessionId ?? r.stripeSessionId }).where(eq(posReservations.id, id)).returning();
    await audit(tx, { hotelId: r.hotelId, actor: "payment", action: "reservation.deposit_paid", entity: "pos_reservation", entityId: id, details: { amount: r.depositRappen } });
    await sendConfirmation(tx, hotel, u);
    await pushNewReservation(tx, hotel.id, u);
    return null;
  });
  if (late) {
    await db().update(posReservations).set({ stripePaymentIntentId: p.paymentIntentId }).where(eq(posReservations.id, id));
    await refundDeposit(id, "late_payment");
  }
}

/** Zahlungsseite abgelaufen oder gescheitert: nicht bezahlte Reservierung freigeben */
export async function cancelUnpaid(id: string): Promise<void> {
  const [r] = await db().update(posReservations).set({ status: "cancelled", depositStatus: "none" }).where(and(eq(posReservations.id, id), eq(posReservations.status, "pending"))).returning();
  if (r) {
    await audit(db(), { hotelId: r.hotelId, actor: "payment", action: "reservation.unpaid_released", entity: "pos_reservation", entityId: id });
    await notifyWaitlist(r.hotelId, r.day);
  }
}

/** Anzahlung zurückerstatten (nur wenn bezahlt und noch nicht erstattet) */
async function refundDeposit(id: string, reason: string): Promise<boolean> {
  const [r] = await db().select().from(posReservations).where(eq(posReservations.id, id));
  if (!r || r.depositStatus === "refunded" || (r.depositStatus !== "paid" && reason !== "late_payment") || !r.stripePaymentIntentId) return false;
  const hotel = await getHotelById(r.hotelId);
  if (!hotel) return false;
  const provider = await getPaymentProvider();
  await provider.refund({ hotel, booking: { id: r.id }, paymentIntentId: r.stripePaymentIntentId, amountRappen: r.depositRappen });
  await db().update(posReservations).set({ depositStatus: "refunded" }).where(eq(posReservations.id, id));
  await audit(db(), { hotelId: r.hotelId, actor: "payment", action: "reservation.deposit_refunded", entity: "pos_reservation", entityId: id, details: { amount: r.depositRappen, reason } });
  return true;
}

export async function reservationByToken(token: string): Promise<PosReservation | null> {
  const [r] = await db().select().from(posReservations).where(eq(posReservations.publicToken, token));
  return r ?? null;
}
export async function reservationForSession(sessionId: string): Promise<PosReservation | null> {
  const [r] = await db().select().from(posReservations).where(eq(posReservations.stripeSessionId, sessionId));
  return r ?? null;
}

/** Gast storniert über seinen Link. Anzahlung kommt zurück, wenn bis `cancelHours` vor Beginn storniert wird; später bleibt sie beim Betrieb. */
export async function cancelByToken(token: string): Promise<{ reservation: PosReservation; refunded: boolean }> {
  const [r] = await db().update(posReservations).set({ status: "cancelled" }).where(and(eq(posReservations.publicToken, token), eq(posReservations.status, "confirmed"))).returning();
  if (!r) throw new PosError("Diese Reservierung kann nicht mehr storniert werden.");
  await audit(db(), { hotelId: r.hotelId, actor: "guest", action: "reservation.cancel", entity: "pos_reservation", entityId: r.id });
  let refunded = false;
  if (r.depositStatus === "paid") {
    const hotel = await getHotelById(r.hotelId);
    const s = await getSettings(r.hotelId);
    if (hotel && refundable(s, zonedToUtc(r.day, r.time, hotel.timezone), new Date())) refunded = await refundDeposit(r.id, "guest_cancel");
  }
  await notifyWaitlist(r.hotelId, r.day);
  return { reservation: (await reservationByToken(token))!, refunded };
}

/** Betrieb setzt den Status. Storniert der Betrieb, kommt die Anzahlung immer zurück; «nicht erschienen» behält sie. */
export async function setReservationStatus(hotelId: string, id: string, status: "confirmed" | "seated" | "cancelled" | "noshow", actor: string) {
  const [r] = await db().update(posReservations).set({ status }).where(and(eq(posReservations.id, id), eq(posReservations.hotelId, hotelId), ne(posReservations.status, "pending"))).returning();
  if (!r) throw new PosError("Reservierung nicht gefunden.");
  await audit(db(), { hotelId, actor, action: "reservation.status", entity: "pos_reservation", entityId: id, details: { status } });
  if (status === "seated") await seatPreorder(hotelId, r, actor);
  if (status === "cancelled") {
    if (r.depositStatus === "paid") await refundDeposit(id, "hotel_cancel");
    await notifyWaitlist(hotelId, r.day);
  }
}

/** Tisch zuweisen oder lösen (null); der Tisch muss zur Zeit frei sein */
export async function assignTable(hotelId: string, id: string, tableId: string | null, actor: string) {
  const [r] = await db().select().from(posReservations).where(and(eq(posReservations.id, id), eq(posReservations.hotelId, hotelId)));
  if (!r) throw new PosError("Reservierung nicht gefunden.");
  if (tableId) {
    const [t] = await db().select().from(posTables).where(and(eq(posTables.id, tableId), eq(posTables.hotelId, hotelId)));
    if (!t) throw new PosError("Tisch nicht gefunden.");
    const s = await getSettings(hotelId);
    const others = await db().select().from(posReservations).where(and(eq(posReservations.hotelId, hotelId), eq(posReservations.day, r.day), ne(posReservations.id, id)));
    if (!tableFree(others, t.id, r.time, s.durationMin)) throw new PosError(`${t.name} ist zu dieser Zeit schon reserviert.`);
  }
  const [u] = await db().update(posReservations).set({ tableId }).where(eq(posReservations.id, id)).returning();
  await audit(db(), { hotelId, actor, action: "reservation.table", entity: "pos_reservation", entityId: id, details: { tableId } });
  if (u.status === "seated") await seatPreorder(hotelId, u, actor); // Gast sass schon, Tisch kam erst jetzt
}

/** Alle Reservierungen eines Tages ohne Tisch zuteilen: grosse Gruppen zuerst, dann nach Zeit. Gibt die Zahl der zugeteilten zurück. */
export async function autoAssignDay(hotelId: string, day: string, actor: string): Promise<number> {
  const s = await getSettings(hotelId);
  const tables = await db().select().from(posTables).where(and(eq(posTables.hotelId, hotelId), eq(posTables.active, true))).orderBy(asc(posTables.sortOrder), asc(posTables.name));
  const all = await reservationsOfDay(hotelId, day);
  const todo = all.filter((r) => !r.tableId && (r.status === "confirmed" || r.status === "pending")).sort((a, b) => b.party - a.party || a.time.localeCompare(b.time));
  let n = 0;
  for (const r of todo) {
    const t = suggestTable(tables, all, r.party, r.time, s.durationMin, r.id);
    if (!t) continue;
    await db().update(posReservations).set({ tableId: t }).where(eq(posReservations.id, r.id));
    r.tableId = t; n++;
  }
  if (n) await audit(db(), { hotelId, actor, action: "reservation.auto_assign", entity: "restaurant_settings", entityId: hotelId, details: { day, assigned: n } });
  return n;
}

/** Plätze, die zu einer Zeit noch frei sind (Anzeige intern) */
export async function freeSeats(hotelId: string, day: string, time: string) {
  const [s, ex] = await Promise.all([getSettings(hotelId), reservationsOfDay(hotelId, day)]);
  return s.capacity - coversAt(ex, time, s.durationMin);
}

// ---------------------------------------------------------------- Warteliste

/** Gast trägt sich für einen vollen Tag ein; er bekommt eine Mail, sobald online wieder ein Platz frei ist */
export async function joinWaitlist(hotel: Hotel, i: { day: string; party: number; name: string; email: string; language?: string }): Promise<void> {
  const name = clean(i.name, 80), email = clean(i.email, 200).toLowerCase();
  if (!name) throw new PosError("Der Name fehlt.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new PosError("E-Mail-Adresse ungültig.");
  if (!isDay(i.day) || !Number.isInteger(i.party) || i.party < 1 || i.party > 50) throw new PosError("Angaben ungültig.");
  const s = await getSettings(hotel.id);
  if (!s.onlineEnabled) throw new PosError("Online-Reservierung ist nicht aktiv.");
  const today = todayIn(hotel.timezone);
  if (i.day < today || diffDays(today, i.day) > s.horizonDays) throw new PosError("Datum ungültig.");
  const open = await db().select({ id: posWaitlist.id }).from(posWaitlist).where(and(eq(posWaitlist.hotelId, hotel.id), eq(posWaitlist.day, i.day), eq(posWaitlist.email, email), isNull(posWaitlist.notifiedAt)));
  if (open.length >= 1) return; // schon eingetragen
  await db().insert(posWaitlist).values({ hotelId: hotel.id, day: i.day, party: i.party, name, email, language: i.language ?? hotel.defaultLanguage });
}

export const waitlistOfDay = (hotelId: string, day: string) =>
  db().select().from(posWaitlist).where(and(eq(posWaitlist.hotelId, hotelId), eq(posWaitlist.day, day))).orderBy(asc(posWaitlist.createdAt));

/** Wartende eines Tages benachrichtigen, deren Gruppe jetzt online einen freien Zeitpunkt hat (einmal je Eintrag, älteste zuerst) */
export async function notifyWaitlist(hotelId: string, day: string): Promise<number> {
  const hotel = await getHotelById(hotelId);
  if (!hotel) return 0;
  const entries = (await waitlistOfDay(hotelId, day)).filter((w) => !w.notifiedAt);
  let n = 0;
  for (const w of entries) {
    if (!(await slotsFor(hotel, day, w.party)).some((x) => x.ok)) continue;
    const [u] = await db().update(posWaitlist).set({ notifiedAt: new Date() }).where(and(eq(posWaitlist.id, w.id), isNull(posWaitlist.notifiedAt))).returning();
    if (!u) continue;
    const lang = isLocale(w.language) ? w.language : "de";
    const base = reservationUrl(hotel, lang, "x").replace(/\/tisch\/x$/, "/tisch");
    await enqueueEmail(db(), { hotelId, template: "table_waitlist", to: w.email, language: w.language, data: { name: w.name, day: w.day, party: w.party, url: `${base}?date=${w.day}&party=${w.party}` } });
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- Job: Erinnerung, Wartelisten, unbezahlte freigeben

/** Läuft alle 5 Minuten: unbezahlte Reservierungen freigeben, Wartelisten prüfen, Erinnerungen senden */
export async function tableJob(now = new Date()): Promise<{ released: number; waitlist: number; reminders: number }> {
  const stale = rows<{ id: string }>(await db().execute(sql`
    SELECT id FROM pos_reservations WHERE status = 'pending' AND created_at < ${new Date(now.getTime() - PENDING_MINUTES * 60_000)}`));
  for (const r of stale) await cancelUnpaid(r.id);

  let waitlist = 0;
  const days = rows<{ hotel_id: string; day: string }>(await db().execute(sql`SELECT DISTINCT hotel_id, day::text AS day FROM pos_waitlist WHERE notified_at IS NULL AND day >= current_date - 1`));
  for (const d of days) waitlist += await notifyWaitlist(d.hotel_id, d.day);

  let reminders = 0;
  const due = rows<{ id: string }>(await db().execute(sql`
    SELECT r.id FROM pos_reservations r JOIN restaurant_settings s ON s.hotel_id = r.hotel_id
     WHERE r.status = 'confirmed' AND r.email <> '' AND r.reminder_sent_at IS NULL AND s.reminder_hours > 0
       AND r.day BETWEEN current_date - 1 AND current_date + 4`));
  for (const x of due) {
    const [r] = await db().select().from(posReservations).where(eq(posReservations.id, x.id));
    const hotel = r && (await getHotelById(r.hotelId));
    if (!r || !hotel) continue;
    const s = await getSettings(r.hotelId);
    const start = zonedToUtc(r.day, r.time, hotel.timezone).getTime();
    if (start <= now.getTime() || start - now.getTime() > s.reminderHours * 3_600_000) continue;
    const [u] = await db().update(posReservations).set({ reminderSentAt: now }).where(and(eq(posReservations.id, r.id), isNull(posReservations.reminderSentAt))).returning();
    if (!u) continue;
    await enqueueEmail(db(), { hotelId: hotel.id, template: "table_reminder", to: r.email, language: r.language, data: { name: r.name, day: r.day, time: r.time, party: r.party, token: r.publicToken, reservationId: r.id } });
    reminders++;
  }
  return { released: stale.length, waitlist, reminders };
}

/**
 * Gast wird platziert: die bezahlte Vorbestellung wird zur Bestellung am Tisch (Küche sieht sie) und der Betrag als Bon gebucht
 * (Zahlart Karte, Gerät «RSV»). Einmalig je Reservierung. Ohne Tisch bleibt die Vorbestellung in der Liste, bis ein Tisch zugewiesen ist.
 */
async function seatPreorder(hotelId: string, r: PosReservation, actor: string): Promise<void> {
  if (!r.preorder?.length || r.depositStatus !== "paid" || r.preorderOrderId || !r.tableId) return;
  const [claimed] = await db().update(posReservations).set({ preorderOrderId: crypto.randomUUID() }).where(and(eq(posReservations.id, r.id), isNull(posReservations.preorderOrderId))).returning();
  if (!claimed) return;
  try {
  const hotel = await getHotelById(hotelId);
  if (!hotel) return;
  const [d0] = await db().select().from(posDevices).where(and(eq(posDevices.hotelId, hotelId), eq(posDevices.code, "RSV")));
  const dev = d0 ?? (await createDevice(hotelId, "RSV", "Vorbestellung", "system"));
  const order = await openOrder(hotelId, { id: claimed.preorderOrderId!, tableId: r.tableId, deviceId: dev.id, label: `Vorbestellung ${r.name}` }, actor);
  const lines = await addLines(hotel, order.id, r.preorder.map((l) => ({ itemId: l.itemId, quantity: l.quantity, mode: "dine_in" as const, optionIds: l.optionIds, note: l.note, snapshot: { description: l.description, unitPriceRappen: l.unitPriceRappen, vatBps: l.vatBps }, optionsSnapshot: l.options })), actor);
  await pay(hotel, { orderId: order.id, deviceId: dev.id, selection: lines.map((l) => ({ lineId: l.id, quantity: l.quantity })), payments: [{ method: "card", amountRappen: r.preorderRappen }] }, actor);
  await audit(db(), { hotelId, actor, action: "reservation.preorder_seated", entity: "pos_reservation", entityId: r.id, details: { orderId: order.id, amount: r.preorderRappen } });
  } catch (e) {
    await db().update(posReservations).set({ preorderOrderId: null }).where(eq(posReservations.id, r.id)); // nächster Versuch beim erneuten Platzieren
    throw e;
  }
}
