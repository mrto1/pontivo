import { feeShare, planPayment } from "../domain/deposit";
import { chargeVoucher, creditVoucher, takeVoucherForBooking, VoucherError } from "./vouchers";
import { t, type Locale } from "../i18n/dict";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db, rows, type Executor, type Tx } from "../db/client";
import {
  bookingExtras, bookingRooms, bookings, extras, guests, hotels, payments, ratePlans,
  type Booking, type Hotel,
} from "../db/schema";
import { ExtrasError, resolveExtras, type ExtraDef } from "../domain/extras";
import { addDays, nightsOf, todayIn, zonedToUtc } from "../domain/dates";
import { platformFee } from "../domain/pricing";
import { assertTransition } from "../domain/state-machine";
import { quoteCancellation, type CancelQuote } from "../domain/cancellation";
import { newPublicToken, newReference } from "../domain/ids";
import { enqueueAvailability } from "./outbox";
import { audit } from "./audit";
import { bookingPayload, enqueueWebhook } from "./webhooks";
import { moduleOn } from "./modules";
import { enqueueEmail } from "../email/enqueue";
import { getPaymentProvider } from "../payments/provider";
import { isBookable } from "./hotels";
import { searchOffers, type Offer } from "./search";
import { MAX_ROOMS, splitGuests } from "../domain/multiroom";
import { enqueueUpsellOffer } from "./upsell";
import { pushForBooking } from "../push/service";
import { env } from "../env";

/**
 * Hold-Dauer. SPEC 5.3 nennt 30 Minuten; Stripe Checkout verlangt expires_at >= 30 Minuten
 * NACH Erstellung der Session, die erst nach dem Commit erstellt wird.
 */
// ASSUMPTION: 32 Minuten, damit expires_at (= hold_expires_at) bei Stripe sicher gültig ist.
export const HOLD_MINUTES = 32;

/** Parameter an eine Rückkehr-Adresse hängen (bestehende bleiben) */
function withParams(url: string, p: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  return u.toString();
}

export class BookingError extends Error {
  constructor(public code: string, public httpStatus: number, message?: string) {
    super(message ?? code);
  }
}

export type GuestInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  language: Locale;
  notes?: string | null;
  marketingConsent: boolean;
};

export type CreateBookingInput = {
  /** Gutschein-Code (optional): Betrag wird angerechnet, Rest per Karte/TWINT */
  voucherCode?: string | null;
  roomTypeId: string;
  ratePlanId: string;
  checkin: string;
  checkout: string;
  adults: number;
  children: number;
  childrenAges: number[];
  guest: GuestInput;
  /** Zusatzleistungen (optional); obligatorische werden immer ergänzt */
  extras?: { id: string; quantity: number }[];
  /** Mehrere gleiche Zimmer (SPEC 19.6): adults/children sind dann die Summen, sie werden gleichmässig verteilt */
  roomCount?: number;
  /** Weitere Zimmer mit eigener Belegung (Rezeption); das erste Zimmer steht in den Feldern oben */
  extraRooms?: RoomLine[];
};

/** Ein Zimmer einer Buchung mit eigener Belegung (SPEC 19.6) */
export type RoomLine = { roomTypeId: string; ratePlanId: string; adults: number; children: number; childrenAges: number[] };

/** Zimmerzeilen einer Buchung: ein Zimmer, mehrere gleiche (roomCount) oder gemischte (extraRooms) */
export function roomLinesOf(input: { roomTypeId: string; ratePlanId: string; adults: number; children: number; childrenAges: number[]; roomCount?: number; extraRooms?: RoomLine[] }): RoomLine[] {
  const n = input.roomCount ?? 1;
  if (n > 1) {
    if (input.extraRooms?.length) throw new BookingError("invalid_rooms", 400);
    const split = splitGuests(input.adults, input.children, input.childrenAges, n);
    if (!split) throw new BookingError("occupancy", 400);
    return split.map((g) => ({ roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId, adults: g.adults, children: g.children, childrenAges: g.childrenAges.filter((a): a is number => a !== null) }));
  }
  const lines: RoomLine[] = [{ roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId, adults: input.adults, children: input.children, childrenAges: input.childrenAges }, ...(input.extraRooms ?? [])];
  if (lines.length > MAX_ROOMS) throw new BookingError("too_many_rooms", 400);
  return lines;
}

/** Summen über alle Zimmer: Personen und Kinderalter der Buchung */
export function lineTotals(lines: RoomLine[]) {
  return { adults: lines.reduce((a, l) => a + l.adults, 0), children: lines.reduce((a, l) => a + l.children, 0), childrenAges: lines.flatMap((l) => l.childrenAges) };
}

/** Jedes Zimmer wie bei der Einzelbuchung serverseitig bepreisen (Verfügbarkeit: bei gleichem Typ mehrfach nötig) */
export async function priceRoomLines(hotel: Hotel, stay: { checkin: string; checkout: string }, lines: RoomLine[], lang: Locale, now: Date | undefined, ex?: Executor): Promise<Offer[]> {
  const offers: Offer[] = [];
  for (const l of lines) {
    const need = lines.filter((x) => x.roomTypeId === l.roomTypeId).length;
    const search = await searchOffers(hotel, { ...stay, adults: l.adults, children: l.children, childrenAges: l.childrenAges }, { lang, roomTypeId: l.roomTypeId, ratePlanId: l.ratePlanId, now, ex, needRooms: need });
    if (!search.ok) throw new BookingError(search.error, 400);
    const offer = search.offers[0];
    if (!offer) {
      const reason = search.rejected[0]?.reason;
      if (reason === "sold_out") throw new BookingError("sold_out", 409);
      if (!reason) throw new BookingError("offer_not_found", 404);
      throw new BookingError(reason, 400);
    }
    offers.push(offer);
  }
  return offers;
}

/**
 * Zusatzleistungen: Gewählte (ganze Buchung, alle Personen) und obligatorische je Zimmer. Bei einem Zimmer wie bisher.
 * Die Summe der obligatorischen Leistungen steckt schon in den Angeboten (offer.totalRappen).
 */
export function resolveBookingExtras<T extends ExtraDef>(defs: T[], selection: { id: string; quantity: number }[], lines: RoomLine[], nights: number) {
  const persons = lineTotals(lines);
  const chosen = resolveExtras(defs, selection, { roomTypeId: lines[0].roomTypeId, nights, persons: persons.adults + persons.children });
  if (lines.length === 1) return chosen;
  const picked = chosen.lines.filter((l) => !l.extra.mandatory);
  const mand = lines.flatMap((l) => resolveExtras(defs, [], { roomTypeId: l.roomTypeId, nights, persons: l.adults + l.children }).lines);
  const all = [...mand, ...picked];
  return { lines: all, totalRappen: all.reduce((a, l) => a + l.amountRappen, 0) };
}

// ---------------------------------------------------------------- Hold (5.3)

/** Zimmer für alle Nächte atomar belegen. Gibt false zurück, wenn nicht alle Nächte frei waren (Tx muss zurückrollen). */
export async function reserveNights(tx: Tx, roomTypeId: string, checkin: string, checkout: string): Promise<boolean> {
  const res = await tx.execute(sql`
    UPDATE inventory_days
       SET booked = booked + 1, updated_at = now()
     WHERE room_type_id = ${roomTypeId} AND night >= ${checkin}::date AND night < ${checkout}::date
       AND total - booked - blocked - external_blocked >= 1
    RETURNING night`);
  return res.rows.length === nightsOf(checkin, checkout).length;
}

export async function releaseNights(tx: Tx, hotelId: string, roomTypeId: string, checkin: string, checkout: string) {
  await tx.execute(sql`
    UPDATE inventory_days
       SET booked = booked - 1, updated_at = now()
     WHERE hotel_id = ${hotelId} AND room_type_id = ${roomTypeId}
       AND night >= ${checkin}::date AND night < ${checkout}::date`);
  await enqueueAvailability(tx, hotelId, roomTypeId, checkin, addDays(checkout, -1));
}

/** «2 × Doppelzimmer, Einzelzimmer» */
export function roomsLabel(names: string[]): string {
  const count = new Map<string, number>();
  for (const n of names) count.set(n, (count.get(n) ?? 0) + 1);
  return [...count].map(([n, c]) => (c > 1 ? `${c} × ${n}` : n)).join(", ");
}

export class RollbackSoldOut extends Error {}

/**
 * POST /api/bookings: Preis serverseitig neu berechnen, Hold anlegen, Checkout-Session erstellen.
 * Wirft BookingError (409 bei ausgebucht).
 */
export async function createDirectBooking(
  hotel: Hotel,
  input: CreateBookingInput,
  opts: { now?: Date; ip?: string; /** Rückkehr-Adresse der eigenen Website (SPEC 19.22), vom Aufrufer gegen die erlaubten Ursprünge geprüft */ returnUrl?: string; /** SPEC 19.25: eingebettetes Checkout anfordern (liefert clientSecret statt Weiterleitung) */ embedded?: boolean } = {},
): Promise<{ booking: Booking; checkoutUrl: string; clientSecret?: string; stripeAccountId?: string }> {
  const provider = await getPaymentProvider();
  if (!isBookable(hotel, provider.name)) throw new BookingError("hotel_not_bookable", 403);

  const lines = roomLinesOf(input);
  const tot = lineTotals(lines);
  const stay = { checkin: input.checkin, checkout: input.checkout };
  const offers = await priceRoomLines(hotel, stay, lines, input.guest.language, opts.now);
  const offer = offers[0];
  const now = opts.now ?? new Date();
  const today = todayIn(hotel.timezone, now);
  const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);
  // Zusatzleistungen serverseitig bepreisen; der Angebotspreis enthält schon die obligatorischen
  const extraDefs = await db().select().from(extras).where(and(eq(extras.hotelId, hotel.id), eq(extras.active, true))).orderBy(extras.sortOrder, extras.createdAt);
  let chosen: ReturnType<typeof resolveBookingExtras<(typeof extraDefs)[number]>>;
  try {
    chosen = resolveBookingExtras(extraDefs, input.extras ?? [], lines, nightsOf(input.checkin, input.checkout).length);
  } catch (e) {
    if (e instanceof ExtrasError) throw new BookingError(e.code, 400);
    throw e;
  }
  const sum = (f: (o: Offer) => number) => offers.reduce((a, o) => a + f(o), 0);
  const roomsTotal = sum((o) => o.roomsTotalRappen);
  const taxTotal = sum((o) => o.touristTaxRappen);
  const totalRappen = sum((o) => o.totalRappen) - sum((o) => o.extrasRappen) + chosen.totalRappen;

  let booking: Booking | null = null;
  for (let attempt = 0; attempt < 3 && !booking; attempt++) {
    try {
      booking = await db().transaction(async (tx) => {
        for (const l of lines) if (!(await reserveNights(tx, l.roomTypeId, input.checkin, input.checkout))) throw new RollbackSoldOut();
        // Gutschein sperren und anrechnen; Plattformgebühr (Standard 1,9 %) nur auf den Teil, der per Karte/TWINT bezahlt wird
        // (am Gutschein hat Pontivo beim Verkauf schon verdient)
        const vt = input.voucherCode?.trim() ? await takeVoucherForBooking(tx, hotel, input.voucherCode, totalRappen, today) : null;
        const voucherRappen = vt?.amountRappen ?? 0;
        const fee = platformFee(totalRappen - voucherRappen, hotel.platformFeeBps);
        // Anzahlung statt voller Zahlung, wenn das Hotel sie eingeschaltet hat und die Anreise weit genug weg ist (SPEC 5.9)
        const plan = planPayment(hotel, totalRappen - voucherRappen, input.checkin, today);
        const [g] = await tx
          .insert(guests)
          .values({
            hotelId: hotel.id,
            firstName: input.guest.firstName,
            lastName: input.guest.lastName,
            email: input.guest.email.toLowerCase(),
            phone: input.guest.phone ?? null,
            language: input.guest.language,
            marketingConsent: input.guest.marketingConsent,
            marketingConsentAt: input.guest.marketingConsent ? now : null,
          })
          .returning();
        const [b] = await tx
          .insert(bookings)
          .values({
            hotelId: hotel.id,
            reference: newReference(),
            publicToken: newPublicToken(),
            source: "direct",
            status: "hold",
            checkin: input.checkin,
            checkout: input.checkout,
            adults: tot.adults,
            children: tot.children,
            childrenAges: tot.childrenAges,
            language: input.guest.language,
            guestId: g.id,
            roomsTotalRappen: roomsTotal,
            extrasRappen: chosen.totalRappen,
            touristTaxRappen: taxTotal,
            totalRappen,
            platformFeeRappen: fee,
            balanceRappen: plan.kind === "deposit" ? plan.balanceRappen : 0,
            balanceDueOn: plan.kind === "deposit" ? plan.balanceDueOn : null,
            voucherId: vt?.voucher.id ?? null,
            voucherRappen,
            holdExpiresAt,
            guestNotes: input.guest.notes ?? null,
          })
          .returning();
        await tx.insert(bookingRooms).values(lines.map((l, i) => ({
          bookingId: b.id,
          hotelId: hotel.id,
          roomTypeId: l.roomTypeId,
          ratePlanId: l.ratePlanId,
          adults: l.adults,
          children: l.children,
          nightlyPrices: offers[i].nightlyPrices,
          amountRappen: offers[i].roomsTotalRappen,
        })));
        if (chosen.lines.length) {
          await tx.insert(bookingExtras).values(chosen.lines.map((l, position) => ({ position,
            bookingId: b.id, hotelId: hotel.id, extraId: l.extra.id, name: l.extra.name, unit: l.extra.unit,
            unitPriceRappen: l.extra.priceRappen, quantity: l.quantity, amountRappen: l.amountRappen,
          })));
        }
        if (vt) await chargeVoucher(tx, vt.voucher, b.id, voucherRappen, `Buchung ${b.reference}`, "guest");
        for (const rt of new Set(lines.map((l) => l.roomTypeId))) await enqueueAvailability(tx, hotel.id, rt, input.checkin, addDays(input.checkout, -1));
        await audit(tx, {
          hotelId: hotel.id, actor: "guest", action: "booking.hold", entity: "booking", entityId: b.id,
          details: { rooms: lines.length, total: totalRappen, extras: chosen.totalRappen, fee, voucher: voucherRappen, ip: opts.ip ?? null },
        });
        return b;
      });
    } catch (e) {
      if (e instanceof RollbackSoldOut) throw new BookingError("sold_out", 409);
      if (e instanceof VoucherError) throw new BookingError(e.message, 400);
      // Referenz-Kollision (sehr selten) → neu versuchen
      if (String((e as { code?: string }).code) === "23505" && attempt < 2) continue;
      throw e;
    }
  }
  if (!booking) throw new BookingError("internal", 500);

  const base = env().APP_BASE_URL;
  const lang = input.guest.language;
  const cardTotal = booking.totalRappen - booking.voucherRappen;
  const cardRappen = cardTotal - booking.balanceRappen; // heute zu zahlen (Anzahlung oder alles)
  if (cardRappen <= 0) {
    await confirmBooking(booking.id, { method: "voucher", actor: "guest" });
    return { booking, checkoutUrl: `${base}/b/${booking.publicToken}?paid=1` };
  }
  let checkout: { url: string; sessionId: string; clientSecret?: string };
  try {
    checkout = await provider.createCheckout({
      hotel,
      booking,
      guestEmail: input.guest.email,
      lang,
      successUrl: opts.returnUrl ? withParams(opts.returnUrl, { reference: booking.reference, result: "paid" }) : `${base}/b/${booking.publicToken}?paid=1`,
      cancelUrl: opts.returnUrl ? withParams(opts.returnUrl, { reference: booking.reference, result: "cancelled" }) : `${base}/b/${booking.publicToken}?cancelled_payment=1`,
      description: `${t(lang).stay} ${hotel.name}, ${input.checkin} – ${input.checkout}`,
      embedded: opts.embedded,
    });
  } catch (e) {
    await releaseHold(booking.id, { reason: "checkout_failed", actor: "system" });
    throw new BookingError("payment_unavailable", 502, (e as Error).message);
  }

  await db().insert(payments).values({
    hotelId: hotel.id,
    bookingId: booking.id,
    stripeCheckoutSessionId: checkout.sessionId,
    amountRappen: cardRappen,
    applicationFeeRappen: feeShare(booking.platformFeeRappen, cardTotal, cardRappen),
    kind: booking.balanceRappen > 0 ? "deposit" : "full",
    status: "pending",
  });

  if (provider.confirmsImmediately) {
    await confirmBooking(booking.id, { sessionId: checkout.sessionId, method: provider.name, actor: "system" });
  }
  return { booking, checkoutUrl: checkout.url, ...(checkout.clientSecret ? { clientSecret: checkout.clientSecret, stripeAccountId: hotel.stripeAccountId ?? undefined } : {}) };
}

// ---------------------------------------------------------------- Bestätigung (5.4)

export type ConfirmResult = "confirmed" | "already_confirmed" | "ignored" | "refund_required";

export async function confirmBooking(
  bookingId: string,
  pay: {
    sessionId?: string | null;
    paymentIntentId?: string | null;
    method?: string | null;
    amountRappen?: number | null;
    actor: string;
    now?: Date;
  },
): Promise<ConfirmResult> {
  const now = pay.now ?? new Date();
  return db().transaction(async (tx) => {
    const [b] = rows<{ id: string; status: string }>(
      await tx.execute(sql`SELECT id, status FROM bookings WHERE id = ${bookingId} FOR UPDATE`),
    );
    if (!b) throw new BookingError("not_found", 404);
    if (b.status === "confirmed") return "already_confirmed";
    if (b.status === "cancelled" || b.status === "no_show") return "ignored";

    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    const roomRows = await tx.select().from(bookingRooms).where(eq(bookingRooms.bookingId, bookingId));

    if (b.status === "expired") {
      // Späte Zahlung: Zimmer erneut belegen, falls noch frei.
      // Savepoint: reserveNights kann einzelne Nächte belegen, obwohl andere voll sind → dann zurückrollen.
      let ok = true;
      try {
        await tx.transaction(async (sp) => {
          for (const r of roomRows) if (!(await reserveNights(sp, r.roomTypeId, booking.checkin, booking.checkout))) throw new RollbackSoldOut();
          if (booking.voucherId && booking.voucherRappen > 0) {
            try {
              await chargeVoucher(sp, { id: booking.voucherId, hotelId: booking.hotelId }, booking.id, booking.voucherRappen, `Buchung ${booking.reference} (späte Zahlung)`, pay.actor);
            } catch (e) {
              if (e instanceof VoucherError) throw new RollbackSoldOut();
              throw e;
            }
          }
        });
      } catch (e) {
        if (!(e instanceof RollbackSoldOut)) throw e;
        ok = false;
      }
      if (!ok) {
        await setPaymentInfo(tx, booking, pay, "succeeded");
        await audit(tx, { hotelId: booking.hotelId, actor: pay.actor, action: "booking.late_payment_no_room", entity: "booking", entityId: booking.id });
        return "refund_required";
      }
      for (const rt of new Set(roomRows.map((r) => r.roomTypeId))) await enqueueAvailability(tx, booking.hotelId, rt, booking.checkin, addDays(booking.checkout, -1));
    }

    assertTransition(b.status, "confirmed");
    await tx
      .update(bookings)
      .set({ status: "confirmed", confirmedAt: now, holdExpiresAt: null, updatedAt: now })
      .where(eq(bookings.id, bookingId));
    await setPaymentInfo(tx, booking, pay, "succeeded");
    await audit(tx, { hotelId: booking.hotelId, actor: pay.actor, action: "booking.confirm", entity: "booking", entityId: booking.id, details: { from: b.status } });
    await enqueueBookingEmails(tx, { ...booking, status: "confirmed" }, now);
    await enqueueWebhook(tx, booking.hotelId, "booking.confirmed", bookingPayload({ ...booking, status: "confirmed" }), now);
    return "confirmed";
  });
}

async function setPaymentInfo(
  tx: Tx,
  booking: Booking,
  pay: { sessionId?: string | null; paymentIntentId?: string | null; method?: string | null; amountRappen?: number | null },
  status: "succeeded" | "failed",
) {
  const set = {
    status,
    updatedAt: new Date(),
    ...(pay.paymentIntentId ? { stripePaymentIntentId: pay.paymentIntentId } : {}),
    ...(pay.method ? { method: pay.method } : {}),
    ...(pay.amountRappen != null ? { amountRappen: pay.amountRappen } : {}),
  };
  const where = pay.sessionId
    ? and(eq(payments.bookingId, booking.id), eq(payments.stripeCheckoutSessionId, pay.sessionId))
    : eq(payments.bookingId, booking.id);
  const updated = await tx.update(payments).set(set).where(where).returning({ id: payments.id });
  if (updated.length === 0 && pay.sessionId) {
    await tx.insert(payments).values({
      hotelId: booking.hotelId,
      bookingId: booking.id,
      stripeCheckoutSessionId: pay.sessionId,
      stripePaymentIntentId: pay.paymentIntentId ?? null,
      method: pay.method ?? null,
      amountRappen: pay.amountRappen ?? booking.totalRappen - booking.voucherRappen - booking.balanceRappen,
      applicationFeeRappen: feeShare(booking.platformFeeRappen, booking.totalRappen - booking.voucherRappen, pay.amountRappen ?? booking.totalRappen - booking.voucherRappen - booking.balanceRappen),
      kind: booking.balanceRappen > 0 ? "deposit" : "full",
      status,
    });
  }
}

async function enqueueBookingEmails(tx: Tx, booking: Booking, now: Date) {
  const [hotel] = await tx.select().from(hotels).where(eq(hotels.id, booking.hotelId));
  const [guest] = booking.guestId ? await tx.select().from(guests).where(eq(guests.id, booking.guestId)) : [];
  const data = { bookingId: booking.id };
  if (guest?.email) {
    await enqueueEmail(tx, { hotelId: hotel.id, bookingId: booking.id, template: "booking_confirmed", to: guest.email, language: booking.language, data });
    // pre_arrival: 3 Tage vor Anreise, 10:00 Hotelzeit (nur wenn Anreise in der Zukunft liegt)
    if (booking.checkin > todayIn(hotel.timezone, now)) {
      const at = zonedToUtc(addDays(booking.checkin, -3), "10:00", hotel.timezone);
      await enqueueEmail(tx, { hotelId: hotel.id, bookingId: booking.id, template: "pre_arrival", to: guest.email, language: booking.language, data, sendAfter: at < now ? now : at });
    }
    await enqueueUpsellOffer(tx, hotel, booking, guest, now);
    if (guest.marketingConsent) {
      const at = zonedToUtc(addDays(booking.checkout, 1), "10:00", hotel.timezone);
      await enqueueEmail(tx, { hotelId: hotel.id, bookingId: booking.id, template: "post_stay", to: guest.email, language: booking.language, data: { ...data, feedback: await moduleOn(hotel.id, "feedback") }, sendAfter: at });
    }
  }
  await enqueueEmail(tx, { hotelId: hotel.id, bookingId: booking.id, template: "hotel_new_booking", to: hotel.contactEmail, language: hotel.defaultLanguage, data });
  await pushForBooking(tx, hotel.id, booking.id, "new");
}

// ---------------------------------------------------------------- Ablauf und Freigabe (5.5)

/** Gibt einen Hold frei (abgelaufen, Session abgelaufen, Zahlung fehlgeschlagen). Idempotent. */
export async function releaseHold(
  bookingId: string,
  opts: { reason: string; actor: string; paymentFailed?: boolean; now?: Date },
): Promise<boolean> {
  const now = opts.now ?? new Date();
  return db().transaction(async (tx) => {
    const [b] = rows<{ status: string }>(await tx.execute(sql`SELECT status FROM bookings WHERE id = ${bookingId} FOR UPDATE`));
    if (!b || b.status !== "hold") return false;
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    for (const r of await tx.select().from(bookingRooms).where(eq(bookingRooms.bookingId, bookingId))) await releaseNights(tx, booking.hotelId, r.roomTypeId, booking.checkin, booking.checkout);
    assertTransition("hold", "expired");
    await tx.update(bookings).set({ status: "expired", holdExpiresAt: null, updatedAt: now }).where(eq(bookings.id, bookingId));
    if (booking.voucherId && booking.voucherRappen > 0) {
      await creditVoucher(tx, booking.voucherId, booking.hotelId, booking.id, booking.voucherRappen, `Reservierung ${booking.reference} nicht bezahlt`, opts.actor);
    }
    if (opts.paymentFailed) {
      await tx.update(payments).set({ status: "failed", updatedAt: now }).where(and(eq(payments.bookingId, bookingId), eq(payments.status, "pending")));
    }
    await audit(tx, { hotelId: booking.hotelId, actor: opts.actor, action: "booking.expire", entity: "booking", entityId: bookingId, details: { reason: opts.reason } });
    await enqueueWebhook(tx, booking.hotelId, "booking.expired", bookingPayload({ ...booking, status: "expired" }), now);
    return true;
  });
}

/** Job alle 60 s: abgelaufene Holds freigeben */
export async function expireHolds(now: Date = new Date()): Promise<number> {
  const due = await db()
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.status, "hold"), lt(bookings.holdExpiresAt, now)));
  let n = 0;
  for (const { id } of due) {
    if (await releaseHold(id, { reason: "hold_expired", actor: "system", now })) n++;
  }
  return n;
}

// ---------------------------------------------------------------- Stornierung (5.7)

async function loadForCancel(ex: Executor, bookingId: string, hotelId?: string) {
  const where = hotelId ? and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)) : eq(bookings.id, bookingId);
  const [booking] = await ex.select().from(bookings).where(where);
  if (!booking) throw new BookingError("not_found", 404);
  const [hotel] = await ex.select().from(hotels).where(eq(hotels.id, booking.hotelId));
  const roomRows = await ex.select().from(bookingRooms).where(eq(bookingRooms.bookingId, booking.id)).orderBy(bookingRooms.id);
  const room = roomRows[0]; // ASSUMPTION (SPEC 19.6): Bei mehreren Zimmern gilt die Stornoregel des ersten Zimmers für die ganze Buchung
  const [plan] = room?.ratePlanId ? await ex.select().from(ratePlans).where(eq(ratePlans.id, room.ratePlanId)) : [];
  // Bei Anzahlung gibt es bis zu zwei Zahlungen (Anzahlung, Rest); neueste zuerst
  const paid = await ex.select().from(payments).where(and(eq(payments.bookingId, booking.id), inArray(payments.status, ["succeeded", "partially_refunded"]))).orderBy(desc(payments.createdAt));
  return { booking, hotel, room, rooms: roomRows, plan, paid };
}

export async function cancellationPreview(
  bookingId: string,
  opts: { by: "guest" | "hotel"; hotelId?: string; now?: Date },
): Promise<CancelQuote & { cancellable: boolean; reason?: string }> {
  const { booking, hotel, plan } = await loadForCancel(db(), bookingId, opts.hotelId);
  const quote = quoteCancellation({
    totalRappen: booking.totalRappen,
    roomsTotalRappen: booking.roomsTotalRappen,
    freeCancelHours: plan?.freeCancelHours ?? null,
    cancelFeeBps: plan?.cancelFeeBps ?? 10000,
    checkin: booking.checkin,
    checkinTime: hotel.checkinTime,
    timezone: hotel.timezone,
    now: opts.now ?? new Date(),
    byHotel: opts.by === "hotel",
  });
  if (booking.status !== "confirmed") return { ...quote, cancellable: false, reason: "status_" + booking.status };
  if (booking.source !== "direct" && booking.source !== "admin") return { ...quote, cancellable: false, reason: "cancel_in_ota_portal" };
  if (opts.by === "guest" && booking.checkin < todayIn(hotel.timezone, opts.now)) return { ...quote, cancellable: false, reason: "past" };
  return { ...quote, cancellable: true };
}

export async function cancelBooking(
  bookingId: string,
  opts: { by: "guest" | "hotel"; actor: string; hotelId?: string; reason?: string; now?: Date },
): Promise<{ refundRappen: number; voucherBackRappen: number; feeRappen: number; feeOpenRappen: number }> {
  const now = opts.now ?? new Date();
  const preview = await cancellationPreview(bookingId, { by: opts.by, hotelId: opts.hotelId, now });
  if (!preview.cancellable) throw new BookingError(preview.reason ?? "not_cancellable", 409);
  const { booking, hotel, rooms: roomRows, paid } = await loadForCancel(db(), bookingId, opts.hotelId);

  // Rückerstattet wird höchstens, was der Gast tatsächlich bezahlt hat, abzüglich der Stornogebühr (bei Anzahlung kann das weniger sein als «Total minus Gebühr»)
  const cardPaid = paid.reduce((n, p) => n + p.amountRappen - p.refundedRappen, 0);
  const paidTotal = booking.voucherRappen + cardPaid;
  const refundTotal = Math.min(preview.refundRappen, Math.max(0, paidTotal - preview.feeRappen));
  const feeOpen = Math.max(0, preview.feeRappen - paidTotal); // Gebühr, die über das Bezahlte hinausgeht: Hotel muss sie selbst einfordern
  // Mit Gutschein bezahlt: Rückerstattung anteilig auf Gutschein und Karte
  const voucherBack = booking.voucherRappen > 0 && paidTotal > 0 ? Math.round((refundTotal * booking.voucherRappen) / paidTotal) : 0;
  let cardBack = refundTotal - voucherBack;

  // 1. Rückerstattung beim Zahlungsanbieter (vor der DB-Änderung, SPEC 5.7), neueste Zahlung zuerst
  const refundsDone: { id: string; amount: number }[] = [];
  const provider = await getPaymentProvider();
  for (const p of paid) {
    if (cardBack <= 0) break;
    const part = Math.min(cardBack, p.amountRappen - p.refundedRappen);
    if (part <= 0) continue;
    await provider.refund({ hotel, booking, paymentIntentId: p.stripePaymentIntentId, amountRappen: part });
    refundsDone.push({ id: p.id, amount: part });
    cardBack -= part;
  }
  const refunded = refundsDone.reduce((n, r) => n + r.amount, 0);

  // 2. Nächte freigeben, Status, Outbox, E-Mails
  await db().transaction(async (tx) => {
    const [b] = rows<{ status: string }>(await tx.execute(sql`SELECT status FROM bookings WHERE id = ${bookingId} FOR UPDATE`));
    if (b.status === "cancelled") return; // parallel bereits storniert
    assertTransition(b.status, "cancelled");
    for (const r of roomRows) await releaseNights(tx, booking.hotelId, r.roomTypeId, booking.checkin, booking.checkout);
    await tx
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: now, cancelReason: opts.reason ?? `by_${opts.by}`, updatedAt: now })
      .where(eq(bookings.id, bookingId));
    for (const r of refundsDone) {
      const p = paid.find((x) => x.id === r.id)!;
      const total = p.refundedRappen + r.amount;
      await tx
        .update(payments)
        .set({ refundedRappen: total, status: total >= p.amountRappen ? "refunded" : "partially_refunded", updatedAt: now })
        .where(eq(payments.id, p.id));
    }
    if (booking.voucherId && voucherBack > 0) {
      await creditVoucher(tx, booking.voucherId, booking.hotelId, booking.id, voucherBack, `Storno ${booking.reference}`, opts.actor);
    }
    // Ausstehende Erinnerungen nicht mehr senden
    await tx.execute(sql`UPDATE email_outbox SET status = 'cancelled' WHERE booking_id = ${bookingId} AND status = 'pending' AND template IN ('pre_arrival','post_stay','checkin_link','balance_due','balance_reminder','upsell_offer')`);
    const [guest] = booking.guestId ? await tx.select().from(guests).where(eq(guests.id, booking.guestId)) : [];
    const data = { bookingId, refundRappen: refunded, voucherBackRappen: voucherBack, feeRappen: preview.feeRappen, feeOpenRappen: feeOpen };
    if (guest) await enqueueEmail(tx, { hotelId: hotel.id, bookingId, template: "booking_cancelled", to: guest.email, language: booking.language, data });
    await enqueueEmail(tx, { hotelId: hotel.id, bookingId, template: "booking_cancelled", to: hotel.contactEmail, language: hotel.defaultLanguage, data });
    await pushForBooking(tx, hotel.id, bookingId, "cancelled");
    await enqueueWebhook(tx, hotel.id, "booking.cancelled", { ...bookingPayload({ ...booking, status: "cancelled" }), refund_rappen: refunded, fee_rappen: preview.feeRappen }, now);
    await audit(tx, { hotelId: hotel.id, actor: opts.actor, action: "booking.cancel", entity: "booking", entityId: bookingId, details: { by: opts.by, refund: refunded, voucherBack, fee: preview.feeRappen, feeOpen } });
  });
  return { refundRappen: refunded, voucherBackRappen: voucherBack, feeRappen: preview.feeRappen, feeOpenRappen: feeOpen };
}

// ---------------------------------------------------------------- No-Show (5.8)

export async function markNoShow(hotelId: string, bookingId: string, actor: string, now: Date = new Date()) {
  await db().transaction(async (tx) => {
    const [b] = rows<{ status: string; checkin: string; hotel_id: string }>(
      await tx.execute(sql`SELECT status, checkin, hotel_id FROM bookings WHERE id = ${bookingId} AND hotel_id = ${hotelId} FOR UPDATE`),
    );
    if (!b) throw new BookingError("not_found", 404);
    const [hotel] = await tx.select().from(hotels).where(eq(hotels.id, hotelId));
    if (todayIn(hotel.timezone, now) <= b.checkin) throw new BookingError("too_early", 409, "No-Show frühestens am Tag nach der Anreise");
    assertTransition(b.status, "no_show");
    await tx.update(bookings).set({ status: "no_show", updatedAt: now }).where(eq(bookings.id, bookingId));
    await audit(tx, { hotelId, actor, action: "booking.no_show", entity: "booking", entityId: bookingId });
  });
}

// ---------------------------------------------------------------- Lesen

export async function getBookingByToken(token: string) {
  const [booking] = await db().select().from(bookings).where(eq(bookings.publicToken, token));
  if (!booking) return null;
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, booking.hotelId));
  const [room] = await db().select().from(bookingRooms).where(eq(bookingRooms.bookingId, booking.id));
  const { roomTypes } = await import("../db/schema");
  const [roomType] = room ? await db().select().from(roomTypes).where(eq(roomTypes.id, room.roomTypeId)) : [];
  const [plan] = room?.ratePlanId ? await db().select().from(ratePlans).where(eq(ratePlans.id, room.ratePlanId)) : [];
  const [guest] = booking.guestId ? await db().select().from(guests).where(eq(guests.id, booking.guestId)) : [];
  const all = await db().select({ rt: roomTypes }).from(bookingRooms).innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId)).where(eq(bookingRooms.bookingId, booking.id)).orderBy(bookingRooms.id);
  // Mehrere Zimmer (SPEC 19.6): Name = alle Zimmertypen, damit Seite und Mails nichts verschweigen
  const label = all.length > 1 ? { ...roomType, name: roomsLabel(all.map((x) => x.rt.name)), i18n: {} } : roomType;
  return { booking, hotel, room, rooms: all.length, roomType: label, plan, guest };
}
