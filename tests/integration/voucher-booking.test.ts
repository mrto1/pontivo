import { afterAll, afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { bookings, hotels, payments, voucherRedemptions, vouchers } from "../../src/db/schema";
import { BookingError, cancelBooking, confirmBooking, createDirectBooking, releaseHold } from "../../src/services/bookings";
import { buyVoucher, markVoucherPaid, updateVoucherSettings } from "../../src/services/vouchers";
import { setPaymentProvider, type PaymentProvider, type RefundArgs } from "../../src/payments/provider";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, inv, makeHotel } from "../helpers";
import { terms } from "../../src/legal/texts";

afterAll(closeDb);
afterEach(() => setPaymentProvider(null));

/** Zahlungsanbieter wie Stripe: Checkout offen bis zum Webhook; merkt sich Beträge und Rückerstattungen */
function stripeLike() {
  const checkouts: { amount: number; fee: number }[] = [];
  const refunds: RefundArgs[] = [];
  const p: PaymentProvider = {
    name: "fake",
    confirmsImmediately: false,
    async createCheckout(a) {
      checkouts.push({ amount: a.booking.totalRappen - a.booking.voucherRappen, fee: a.booking.platformFeeRappen });
      return { url: "https://checkout.test/" + a.booking.id, sessionId: "cs_" + a.booking.id };
    },
    async createPaymentCheckout(a) { return { url: a.successUrl, sessionId: "cs_v_" + a.idempotencyKey }; },
    async refund(a) { refunds.push(a); return { refundId: "re_" + refunds.length }; },
  };
  setPaymentProvider(p);
  return { checkouts, refunds };
}

/** Hotel mit verkauftem, bezahltem Gutschein (Fake-Zahlung beim Kauf) */
async function hotelWithVoucher(amountRappen: number) {
  const h = await makeHotel();
  await updateVoucherSettings(h.hotel.id, { enabled: true, amounts: [amountRappen], minRappen: 1000, maxRappen: 500000, validityYears: 3 }, "t");
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  const { voucher } = await buyVoucher(hotel, { amountRappen, buyerName: "Peter", buyerEmail: "peter@example.ch" });
  await markVoucherPaid(voucher.id, { sessionId: null, paymentIntentId: null }); // Kauf bezahlt (Webhook)
  return { ...h, hotel, voucher };
}
const remaining = async (id: string) => (await db().select().from(vouchers).where(eq(vouchers.id, id)))[0].remainingRappen;

const input = (h: Awaited<ReturnType<typeof hotelWithVoucher>>, d: string, code: string | null, nights = 2, plan = 0) => ({
  roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[plan].id, checkin: d, checkout: addDays(d, nights),
  adults: 2, children: 0, childrenAges: [], guest, voucherCode: code,
});

describe("Gutschein bei der Online-Buchung", () => {
  it("Teilbetrag: Gutschein angerechnet, nur der Rest per Karte, 1 % nur auf den Kartenteil", async () => {
    const pay = stripeLike();
    const h = await hotelWithVoucher(10000);
    const { booking } = await createDirectBooking(h.hotel, input(h, inDays(30), h.voucher.code.toLowerCase()));
    expect(booking.status).toBe("hold");
    expect(booking.voucherRappen).toBe(10000);
    const card = booking.totalRappen - 10000;
    expect(pay.checkouts).toEqual([{ amount: card, fee: Math.max(1, Math.round(card / 100)) }]);
    expect(await remaining(h.voucher.id)).toBe(0);
    const [p] = await db().select().from(payments).where(eq(payments.bookingId, booking.id));
    expect(p.amountRappen).toBe(card);
  });

  it("Gutschein deckt alles: keine Kartenzahlung, sofort bestätigt, Restwert bleibt", async () => {
    const pay = stripeLike();
    const h = await hotelWithVoucher(200000);
    const { booking, checkoutUrl } = await createDirectBooking(h.hotel, input(h, inDays(31), h.voucher.code));
    expect(pay.checkouts).toEqual([]);
    expect(checkoutUrl).toContain(`/b/${booking.publicToken}?paid=1`);
    const [b] = await db().select().from(bookings).where(eq(bookings.id, booking.id));
    expect(b).toMatchObject({ status: "confirmed", voucherRappen: booking.totalRappen, platformFeeRappen: 0 });
    expect(await remaining(h.voucher.id)).toBe(200000 - booking.totalRappen);
  });

  it("zwei Buchungen gleichzeitig mit demselben Gutschein: nie mehr als der Wert angerechnet", async () => {
    stripeLike();
    const h = await hotelWithVoucher(20000);
    const results = await Promise.allSettled([
      createDirectBooking(h.hotel, input(h, inDays(40), h.voucher.code)),
      createDirectBooking(h.hotel, input(h, inDays(50), h.voucher.code)),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(BookingError);
    expect(failed[0].reason.code).toBe("voucher_empty");
    expect(await remaining(h.voucher.id)).toBe(0);
    // Nächte der abgelehnten Buchung sind nicht belegt
    expect((await inv(h.rooms[0].roomType.id, inDays(50))).booked).toBe(0);
  });

  it("ungültiger Code oder Gutschein eines anderen Hotels → Fehler, Zimmer bleibt frei", async () => {
    stripeLike();
    const h = await hotelWithVoucher(10000);
    const other = await hotelWithVoucher(10000);
    await expect(createDirectBooking(h.hotel, input(h, inDays(33), "GS-FALS-CH00"))).rejects.toMatchObject({ code: "voucher_invalid" });
    await expect(createDirectBooking(h.hotel, input(h, inDays(33), other.voucher.code))).rejects.toMatchObject({ code: "voucher_invalid" });
    expect((await inv(h.rooms[0].roomType.id, inDays(33))).booked).toBe(0);
    expect(await remaining(other.voucher.id)).toBe(10000);
  });

  it("Reservierung abgelaufen → Betrag zurück auf den Gutschein; späte Zahlung zieht ihn wieder ab", async () => {
    stripeLike();
    const h = await hotelWithVoucher(10000);
    const { booking } = await createDirectBooking(h.hotel, input(h, inDays(35), h.voucher.code));
    await releaseHold(booking.id, { reason: "test", actor: "system" });
    expect(await remaining(h.voucher.id)).toBe(10000);
    const reds = await db().select().from(voucherRedemptions).where(and(eq(voucherRedemptions.voucherId, h.voucher.id), eq(voucherRedemptions.bookingId, booking.id)));
    expect(reds.map((r) => r.amountRappen).sort((a, b) => a - b)).toEqual([-10000, 10000]);
    expect(await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" })).toBe("confirmed");
    expect(await remaining(h.voucher.id)).toBe(0);
  });

  it("späte Zahlung, Gutschein inzwischen anderweitig verbraucht → Rückerstattung nötig", async () => {
    stripeLike();
    const h = await hotelWithVoucher(10000);
    const { booking } = await createDirectBooking(h.hotel, input(h, inDays(36), h.voucher.code));
    await releaseHold(booking.id, { reason: "test", actor: "system" });
    await db().update(vouchers).set({ remainingRappen: 0 }).where(eq(vouchers.id, h.voucher.id));
    expect(await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" })).toBe("refund_required");
    expect((await inv(h.rooms[0].roomType.id, inDays(36))).booked).toBe(0);
  });

  it("Storno: Rückerstattung anteilig auf Gutschein und Karte", async () => {
    const pay = stripeLike();
    const h = await hotelWithVoucher(10000);
    const { booking } = await createDirectBooking(h.hotel, input(h, inDays(45), h.voucher.code));
    await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, paymentIntentId: "pi_1", actor: "stripe" });
    const r = await cancelBooking(booking.id, { by: "guest", actor: "guest" });
    expect(r.voucherBackRappen + r.refundRappen).toBe(booking.totalRappen); // kostenlos stornierbar: alles zurück
    expect(r.voucherBackRappen).toBe(10000);
    expect(pay.refunds.map((x) => x.amountRappen)).toEqual([booking.totalRappen - 10000]);
    expect(await remaining(h.voucher.id)).toBe(10000);
  });
});

describe("AGB", () => {
  it("Abschnitt Gutscheine nur bei Hotels mit Gutscheinverkauf, mit eingestellter Gültigkeit", async () => {
    const plain = await makeHotel();
    expect(terms(plain.hotel, "de").sections.map((x) => x.h)).not.toContain("8. Gutscheine");
    const h = await hotelWithVoucher(10000);
    const de = terms(h.hotel, "de");
    const sec = de.sections.find((x) => x.h === "8. Gutscheine")!;
    expect(sec.p.join(" ")).toContain("3 Jahr(e) ab Kauf");
    expect(de.sections.at(-1)!.h).toBe("9. Anwendbares Recht und Gerichtsstand");
    expect(terms(h.hotel, "fr").sections.map((x) => x.h)).toContain("8. Gift vouchers");
  });
});
