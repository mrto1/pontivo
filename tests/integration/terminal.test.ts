import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, hotels, onsitePayments, terminalPayments } from "../../src/db/schema";
import { confirmBooking, createDirectBooking } from "../../src/services/bookings";
import { addFolioItem, bookingBalance, InvoiceError } from "../../src/services/invoicing";
import { setStripeClient, type Stripe } from "../../src/integrations/stripe/client";
import { cancelTerminalPayment, checkTerminalPayment, registerReader, settleTerminalPayment, startTerminalPayment } from "../../src/services/terminal";
import { handleStripeEvent } from "../../src/integrations/stripe/webhooks";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);
afterEach(() => setStripeClient(null));

function fake(opts: { piStatus?: string; processError?: string } = {}) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const rec = (fn: string, ret: unknown) => async (...args: unknown[]) => { calls.push({ fn, args }); return ret; };
  const s = {
    terminal: {
      locations: { create: rec("location", { id: "tml_1" }) },
      readers: {
        create: async (...args: unknown[]) => { calls.push({ fn: "reader", args }); return { id: "tmr_" + Math.random().toString(36).slice(2) }; },
        processPaymentIntent: async (...args: unknown[]) => { calls.push({ fn: "process", args }); if (opts.processError) throw Object.assign(new Error("x"), { code: opts.processError }); return {}; },
        retrieve: rec("readerGet", { action: null }),
        cancelAction: rec("cancelAction", {}),
      },
    },
    paymentIntents: {
      create: async (p: { amount: number }, o: unknown) => { calls.push({ fn: "pi", args: [p, o] }); return { id: "pi_" + Math.random().toString(36).slice(2), amount: p.amount }; },
      retrieve: async (id: string) => { const c = calls.find((x) => x.fn === "pi")!.args[0] as { amount: number }; return { id, status: opts.piStatus ?? "succeeded", amount: c.amount, amount_received: c.amount }; },
      cancel: rec("piCancel", {}),
    },
  };
  setStripeClient(s as unknown as Stripe);
  return calls;
}

async function setup() {
  const h = await makeHotel();
  await db().update(hotels).set({ stripeAccountId: "acct_" + h.hotel.id.slice(0, 8), addressLine: "Seestrasse 1", postalCode: "8750", city: "Glarus" }).where(eq(hotels.id, h.hotel.id));
  const hotel = (await db().select().from(hotels).where(eq(hotels.id, h.hotel.id)))[0];
  const checkin = inDays(20);
  const { booking } = await createDirectBooking(hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin, checkout: addDays(checkin, 2), adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
  await confirmBooking(booking.id, { sessionId: "cs_" + booking.id, actor: "stripe" });
  const b = (await db().select().from(bookings).where(eq(bookings.id, booking.id)))[0];
  await addFolioItem(hotel.id, b.id, { description: "Abendessen", quantity: 1, unitPriceRappen: 12000, vatKind: "standard" }, "t"); // offener Betrag
  return { hotel, b };
}

describe("Stripe Terminal (SPEC 18.4)", () => {
  it("Reader registrieren: Location + Reader im Konto des Hotels", async () => {
    const calls = fake();
    const { hotel } = await setup();
    const r = await registerReader(hotel, { registrationCode: "abc-def", label: "Empfang" }, "t");
    expect(r.stripeReaderId).toMatch(/^tmr_/);
    expect(calls.map((c) => c.fn)).toEqual(["location", "reader"]);
    expect((calls[0].args[1] as { stripeAccount: string }).stripeAccount).toBe(hotel.stripeAccountId);
    await expect(registerReader(hotel, { registrationCode: " ", label: "" }, "t")).rejects.toThrow(InvoiceError);
  });

  it("Zahlung: starten, am Leser verarbeiten, Webhook bucht genau einmal als Kartenzahlung", async () => {
    const calls = fake();
    const { hotel, b } = await setup();
    const r = await registerReader(hotel, { registrationCode: "c", label: "Empfang" }, "t");
    const open = (await bookingBalance(db(), hotel.id, b.id)).openRappen;
    expect(open).toBeGreaterThan(0);
    const tp = await startTerminalPayment(hotel, b.id, r.id, open, "t");
    expect(tp.status).toBe("pending");
    const pi = calls.find((c) => c.fn === "pi")!.args[0] as Record<string, unknown>;
    expect(pi.allowed_payment_method_types).toEqual(["card_present"]);
    expect(pi.currency).toBe("chf");
    expect(calls.find((c) => c.fn === "process")!.args[0]).toBe(r.stripeReaderId);
    // zweite Zahlung auf demselben Leser, solange eine läuft
    await expect(startTerminalPayment(hotel, b.id, r.id, 100, "t")).rejects.toThrow(/läuft noch/);
    const piId = (await db().select().from(terminalPayments).where(eq(terminalPayments.id, tp.id)))[0].paymentIntentId!;
    const ev = { id: "evt_" + tp.id, type: "terminal.reader.action_succeeded", account: hotel.stripeAccountId, data: { object: { action: { type: "process_payment_intent", process_payment_intent: { payment_intent: piId } } } } } as unknown as Stripe.Event;
    await handleStripeEvent(ev);
    expect(await settleTerminalPayment(piId, hotel.stripeAccountId!)).toBe("succeeded"); // wiederholt: keine Doppelbuchung
    const pays = await db().select().from(onsitePayments).where(eq(onsitePayments.bookingId, b.id));
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ method: "card", amountRappen: open });
    expect((await bookingBalance(db(), hotel.id, b.id)).openRappen).toBe(0);
  });

  it("Fremdes Konto im Ereignis wird abgelehnt; Betrag über offen und Leser offline", async () => {
    fake();
    const { hotel, b } = await setup();
    const r = await registerReader(hotel, { registrationCode: "c", label: "E" }, "t");
    const open = (await bookingBalance(db(), hotel.id, b.id)).openRappen;
    await expect(startTerminalPayment(hotel, b.id, r.id, open + 1, "t")).rejects.toThrow(/höher/);
    const tp = await startTerminalPayment(hotel, b.id, r.id, 100, "t");
    const piId = (await db().select().from(terminalPayments).where(eq(terminalPayments.id, tp.id)))[0].paymentIntentId!;
    await expect(settleTerminalPayment(piId, "acct_fremd")).rejects.toThrow(/passt nicht/);
    fake({ processError: "terminal_reader_offline" });
    await cancelTerminalPayment(hotel, tp.id, "t").catch(() => undefined);
    await db().update(terminalPayments).set({ status: "canceled" }).where(eq(terminalPayments.id, tp.id));
    await expect(startTerminalPayment(hotel, b.id, r.id, 100, "t")).rejects.toThrow(/offline/);
    expect((await db().select().from(terminalPayments).where(eq(terminalPayments.bookingId, b.id))).filter((x) => x.status === "failed")).toHaveLength(1);
  });

  it("Status prüfen und Abbrechen; anderer Betrieb sieht fremde Zahlung nicht", async () => {
    fake({ piStatus: "requires_payment_method" });
    const { hotel, b } = await setup();
    const r = await registerReader(hotel, { registrationCode: "c", label: "E" }, "t");
    const tp = await startTerminalPayment(hotel, b.id, r.id, 100, "t");
    expect(await checkTerminalPayment(hotel, tp.id)).toMatch(/Noch in Bearbeitung/);
    const o = await setup();
    await expect(checkTerminalPayment(o.hotel, tp.id)).rejects.toThrow(/nicht gefunden/);
    await cancelTerminalPayment(hotel, tp.id, "t");
    expect((await db().select().from(terminalPayments).where(eq(terminalPayments.id, tp.id)))[0].status).toBe("canceled");
  });
});
