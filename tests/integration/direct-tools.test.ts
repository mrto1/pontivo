import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, emailOutbox, hotels, payments, ratePlans, ratesDays, waitlistEntries } from "../../src/db/schema";
import { BookingError, cancelBooking, createDirectBooking, expireHolds, releaseHold } from "../../src/services/bookings";
import { searchOffers } from "../../src/services/search";
import { setPaymentProvider, type PaymentProvider } from "../../src/payments/provider";
import { setModule } from "../../src/services/modules";
import { saveCompany } from "../../src/services/debtors";
import {
  DirectError, cancelWaitlistByToken, joinWaitlist, listGaps, recoveryJob, resolveCode, saveCode, saveDirectSettings, waitlistJob,
} from "../../src/services/direct-tools";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel, cardStubs } from "../helpers";

afterAll(async () => {
  setPaymentProvider(null);
  await closeDb();
});

const holdOnly: PaymentProvider = {
  name: "fake", confirmsImmediately: false, ...cardStubs,
  async createCheckout(a) { return { url: "https://checkout.test/" + a.booking.id, sessionId: "cs_" + a.booking.id }; },
  async createPaymentCheckout(a) { return { url: "https://checkout.test/" + a.idempotencyKey, sessionId: "cs_" + a.idempotencyKey }; },
  async refund() { return { refundId: "re_1" }; },
};

const fresh = async (id: string) => (await db().select().from(hotels).where(eq(hotels.id, id)))[0];

/** Ein Zimmer, 18000 Rappen pro Nacht, bei Bedarf Mindestaufenthalt */
async function oneRoom(minStay = 1) {
  const h = await makeHotel({}, [{ name: "Suite", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 18000 }]);
  const rt = h.rooms[0].roomType, rp = h.rooms[0].plans[0];
  if (minStay > 1) {
    await db().update(ratePlans).set({ minNights: minStay }).where(eq(ratePlans.hotelId, h.hotel.id));
    await db().update(ratesDays).set({ minStayArrival: minStay }).where(eq(ratesDays.hotelId, h.hotel.id));
  }
  const input = (checkin: string, checkout: string, over: Record<string, unknown> = {}) => ({
    roomTypeId: rt.id, ratePlanId: rp.id, checkin, checkout, adults: 2, children: 0, childrenAges: [], guest: { ...guest, email: `g-${Math.random().toString(36).slice(2)}@example.ch` }, ...over,
  });
  return { ...h, rt, rp, input };
}

describe("Lückenfüller", () => {
  it("kurze Lücke: Mindestaufenthalt entfällt, Rabatt gilt nur für genau diese Lücke", async () => {
    const s = await oneRoom(3);
    // belegt: Nächte 9-11 und 14-16, frei: Nächte 12 und 13 (Lücke von 2 Nächten)
    await createDirectBooking(s.hotel, s.input(inDays(9), inDays(12)));
    await createDirectBooking(s.hotel, s.input(inDays(14), inDays(17)));
    const search = (h: typeof s.hotel, a: number, b: number) => searchOffers(h, { checkin: inDays(a), checkout: inDays(b), adults: 2, children: 0 });

    // ohne Lückenfüller: 2 Nächte unter Mindestaufenthalt 3
    let r = await search(await fresh(s.hotel.id), 12, 14);
    expect(r.ok && r.offers).toHaveLength(0);
    expect(r.ok && r.rejected.every((x) => x.reason === "min_stay")).toBe(true);

    await saveDirectSettings(s.hotel.id, { gaps: { enabled: true, maxNights: 2, discountBps: 1000, relaxMinStay: true } }, "t");
    const h = await fresh(s.hotel.id);
    r = await search(h, 12, 14);
    if (!r.ok) throw new Error("search");
    const o = r.offers.find((x) => x.ratePlan.id === s.rp.id)!;
    expect(o.adjustment).toEqual({ kind: "gap", bps: 1000 });
    expect(o.roomsTotalRappen).toBe(2 * 16200);
    expect(o.discountRappen).toBe(2 * 1800);

    // nur eine der beiden Nächte füllt die Lücke nicht genau: Mindestaufenthalt gilt wieder
    const one = await search(h, 12, 13);
    expect(one.ok && one.offers).toHaveLength(0);

    // Anzeige im Admin
    const gaps = await listGaps(h);
    expect(gaps.map((g) => [g.from, g.nights])).toEqual([[inDays(12), 2]]);
  });
});

describe("Firmencode", () => {
  async function setup() {
    const s = await oneRoom();
    await setModule(s.hotel.id, "debtors", true, "t");
    const company = await saveCompany(s.hotel.id, null, { name: "Muster AG" }, "t");
    return { ...s, company };
  }

  it("Rabatt auf die Zimmerpreise, Plattformgebühr wie bei Direktbuchung", async () => {
    const s = await setup();
    const code = await saveCode(s.hotel.id, null, { companyId: s.company.id, code: "muster-2030", discountPct: 10, payOnInvoice: false }, "t");
    expect(code.code).toBe("MUSTER-2030");
    const { booking } = await createDirectBooking(s.hotel, s.input(inDays(30), inDays(32), { companyCode: "muster-2030" }));
    expect(booking.roomsTotalRappen).toBe(2 * 16200);
    expect(booking.discountRappen).toBe(2 * 1800);
    expect(booking.discountKind).toBe("company");
    expect(booking.companyId).toBe(s.company.id);
    expect(booking.companyCodeId).toBe(code.id);
    expect(booking.platformFeeRappen).toBeGreaterThan(0);
    expect((await db().select().from(payments).where(eq(payments.bookingId, booking.id))).length).toBe(1);
  });

  it("ungültig, abgelaufen, aus, fremder Betrieb: Fehler statt stillem Normalpreis", async () => {
    const s = await setup();
    const other = await setup();
    await saveCode(s.hotel.id, null, { companyId: s.company.id, code: "ABGELAUFEN", discountPct: 5, payOnInvoice: false, validUntil: inDays(5) }, "t");
    const off = await saveCode(s.hotel.id, null, { companyId: s.company.id, code: "AUSGESCHALTET", discountPct: 5, payOnInvoice: false }, "t");
    await saveCode(s.hotel.id, off.id, { companyId: s.company.id, code: "AUSGESCHALTET", discountPct: 5, payOnInvoice: false, active: false }, "t");
    await saveCode(other.hotel.id, null, { companyId: other.company.id, code: "FREMD-CODE", discountPct: 50, payOnInvoice: false }, "t");
    for (const c of ["ABGELAUFEN", "AUSGESCHALTET", "FREMD-CODE", "NIEEXISTENT", "ab"]) {
      await expect(createDirectBooking(s.hotel, s.input(inDays(30), inDays(32), { companyCode: c }))).rejects.toMatchObject({ code: "code_invalid" });
    }
    expect(await resolveCode(s.hotel, "ABGELAUFEN", inDays(4))).not.toBeNull();
    expect(await resolveCode(s.hotel, "ABGELAUFEN", inDays(6))).toBeNull();
  });

  it("auf Rechnung: sofort bestätigt, keine Zahlung, keine Plattformgebühr, Firma an der Buchung", async () => {
    const s = await setup();
    await saveCode(s.hotel.id, null, { companyId: s.company.id, code: "RECHNUNG-1", discountPct: 0, payOnInvoice: true }, "t");
    const { booking } = await createDirectBooking(s.hotel, s.input(inDays(40), inDays(42), { companyCode: "RECHNUNG-1" }));
    expect(booking.status).toBe("confirmed");
    expect(booking.companyId).toBe(s.company.id);
    expect(booking.platformFeeRappen).toBe(0);
    expect(booking.discountRappen).toBe(0);
    expect(await db().select().from(payments).where(eq(payments.bookingId, booking.id))).toHaveLength(0);
    // mit Gutschein zusammen nicht möglich
    await expect(createDirectBooking(s.hotel, s.input(inDays(50), inDays(52), { companyCode: "RECHNUNG-1", voucherCode: "GS-AAAA-BBBB" }))).rejects.toMatchObject({ code: "voucher_not_with_invoice" });
  });

  it("«auf Rechnung» braucht das Modul Debitoren", async () => {
    const s = await oneRoom();
    const co = await db().insert((await import("../../src/db/schema")).companies).values({ hotelId: s.hotel.id, name: "X AG" }).returning();
    await expect(saveCode(s.hotel.id, null, { companyId: co[0].id, discountPct: 0, payOnInvoice: true }, "t")).rejects.toBeInstanceOf(DirectError);
    // Code einer Firma eines anderen Betriebs
    const o = await setup();
    await expect(saveCode(s.hotel.id, null, { companyId: o.company.id, discountPct: 5, payOnInvoice: false }, "t")).rejects.toBeInstanceOf(DirectError);
  });
});

describe("Direktvorteile", () => {
  it("werden mit der Buchung festgehalten, später geänderte Texte ändern nichts", async () => {
    const s = await oneRoom();
    await saveDirectSettings(s.hotel.id, { benefits: { enabled: true, items: [{ id: "a", text: { de: "Late Check-out" } }, { id: "b", text: { de: "Wein" }, minNights: 3 }] } }, "t");
    const h = await fresh(s.hotel.id);
    const { booking } = await createDirectBooking(h, s.input(inDays(20), inDays(22)));
    expect(booking.directBenefits).toEqual([{ de: "Late Check-out" }]); // «Wein» erst ab 3 Nächten
    await saveDirectSettings(s.hotel.id, { benefits: { enabled: false, items: [] } }, "t");
    const [again] = await db().select().from(bookings).where(eq(bookings.id, booking.id));
    expect(again.directBenefits).toEqual([{ de: "Late Check-out" }]);
    const longer = await createDirectBooking(h, s.input(inDays(30), inDays(33)));
    expect(longer.booking.directBenefits).toHaveLength(2);
  });
});

describe("Warteliste", () => {
  it("benachrichtigt einmalig, sobald etwas frei wird", async () => {
    const s = await oneRoom();
    const { booking } = await createDirectBooking(s.hotel, s.input(inDays(25), inDays(27)));
    const h = await fresh(s.hotel.id);
    const w = await joinWaitlist(h, { email: "Wart@Example.ch ", name: "Wart", language: "fr", checkin: inDays(25), checkout: inDays(27), adults: 2 });
    expect(w.email).toBe("wart@example.ch");
    // gleicher Eintrag nochmals: kein Duplikat
    const again = await joinWaitlist(h, { email: "wart@example.ch", language: "fr", checkin: inDays(25), checkout: inDays(27), adults: 2 });
    expect(again.id).toBe(w.id);

    expect(await waitlistJob()).toMatchObject({ notified: expect.any(Number) });
    expect((await db().select().from(waitlistEntries).where(eq(waitlistEntries.id, w.id)))[0].status).toBe("waiting"); // noch ausgebucht

    await cancelBooking(booking.id, { by: "hotel", actor: "t" });
    await waitlistJob();
    const mails = await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, h.id), eq(emailOutbox.template, "waitlist_available")));
    expect(mails).toHaveLength(1);
    expect(mails[0].toEmail).toBe("wart@example.ch");
    expect(mails[0].language).toBe("fr");
    expect(String(mails[0].data.url)).toContain(`/fr/book?checkin=${inDays(25)}&checkout=${inDays(27)}`);
    // zweiter Lauf: keine zweite Mail
    await waitlistJob();
    expect(await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, h.id), eq(emailOutbox.template, "waitlist_available")))).toHaveLength(1);
    expect((await db().select().from(waitlistEntries).where(eq(waitlistEntries.id, w.id)))[0].status).toBe("notified");
  });

  it("Abmelden per Link, Grenzen und Ausschalten", async () => {
    const s = await oneRoom();
    const h = await fresh(s.hotel.id);
    const w = await joinWaitlist(h, { email: "a@example.ch", checkin: inDays(25), checkout: inDays(26), adults: 1 });
    expect(await cancelWaitlistByToken(w.token)).toMatchObject({ hotelId: h.id });
    expect((await db().select().from(waitlistEntries).where(eq(waitlistEntries.id, w.id)))[0].status).toBe("cancelled");
    expect(await cancelWaitlistByToken("gibt-es-nicht")).toBeNull();
    await expect(joinWaitlist(h, { email: "kaputt", checkin: inDays(25), checkout: inDays(26), adults: 1 })).rejects.toBeInstanceOf(DirectError);
    await expect(joinWaitlist(h, { email: "a@example.ch", checkin: inDays(-2), checkout: inDays(1), adults: 1 })).rejects.toBeInstanceOf(DirectError);
    for (let i = 0; i < 5; i++) await joinWaitlist(h, { email: "viele@example.ch", checkin: inDays(30 + i), checkout: inDays(31 + i), adults: 1 });
    await expect(joinWaitlist(h, { email: "viele@example.ch", checkin: inDays(40), checkout: inDays(41), adults: 1 })).rejects.toBeInstanceOf(DirectError);
    await saveDirectSettings(h.id, { waitlist: { enabled: false } }, "t");
    await expect(joinWaitlist(await fresh(h.id), { email: "neu@example.ch", checkin: inDays(25), checkout: inDays(26), adults: 1 })).rejects.toBeInstanceOf(DirectError);
  });
});

describe("Abbruch-Mail", () => {
  async function abandoned(enabled: boolean) {
    const s = await oneRoom();
    if (enabled) await saveDirectSettings(s.hotel.id, { recovery: { enabled: true } }, "t");
    setPaymentProvider(holdOnly);
    const h = await fresh(s.hotel.id);
    const email = `abbruch-${Math.random().toString(36).slice(2)}@example.ch`;
    const { booking } = await createDirectBooking(h, s.input(inDays(20), inDays(22), { guest: { ...guest, email, language: "en" } }));
    const old = new Date(Date.now() - 2 * 3_600_000);
    await releaseHold(booking.id, { reason: "hold_expired", actor: "system", now: old });
    setPaymentProvider(null);
    return { ...s, hotel: h, booking, email };
  }
  const mails = (hotelId: string) => db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, hotelId), eq(emailOutbox.template, "booking_recovery")));

  it("sendet einmalig mit Link zurück zur Suche", async () => {
    const s = await abandoned(true);
    expect(await recoveryJob()).toMatchObject({ sent: expect.any(Number) });
    const m = await mails(s.hotel.id);
    expect(m).toHaveLength(1);
    expect(m[0].toEmail).toBe(s.email);
    expect(m[0].language).toBe("en");
    expect(String(m[0].data.url)).toContain(`/en/book?checkin=${inDays(20)}&checkout=${inDays(22)}&adults=2`);
    await recoveryJob();
    expect(await mails(s.hotel.id)).toHaveLength(1);
    expect((await db().select().from(bookings).where(eq(bookings.id, s.booking.id)))[0].recoverySentAt).not.toBeNull();
  });

  it("nicht, wenn ausgeschaltet", async () => {
    const s = await abandoned(false);
    await recoveryJob();
    expect(await mails(s.hotel.id)).toHaveLength(0);
  });

  it("nicht, wenn der Gast inzwischen für diese Zeit gebucht hat", async () => {
    const s = await abandoned(true);
    await createDirectBooking(s.hotel, s.input(inDays(20), inDays(22), { guest: { ...guest, email: s.email } }));
    await recoveryJob();
    expect(await mails(s.hotel.id)).toHaveLength(0);
  });

  it("nicht, wenn für die Daten nichts mehr frei ist", async () => {
    const s = await abandoned(true);
    await createDirectBooking(s.hotel, s.input(inDays(20), inDays(22))); // anderer Gast belegt das einzige Zimmer
    await recoveryJob();
    expect(await mails(s.hotel.id)).toHaveLength(0);
  });
});

describe("abgelaufene Reservierung: Warteliste und Code bleiben unberührt", () => {
  it("expireHolds läuft weiter wie bisher", async () => {
    const s = await oneRoom();
    setPaymentProvider(holdOnly);
    const { booking } = await createDirectBooking(s.hotel, s.input(inDays(20), inDays(22)));
    setPaymentProvider(null);
    expect(await expireHolds(new Date(Date.now() + 60 * 60_000))).toBeGreaterThanOrEqual(1);
    expect((await db().select().from(bookings).where(eq(bookings.id, booking.id)))[0].status).toBe("expired");
  });
});
