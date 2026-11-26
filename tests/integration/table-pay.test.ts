import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotels, posReceipts, tablePayments } from "../../src/db/schema";
import { FakePaymentProvider } from "../../src/payments/fake";
import { setPaymentProvider } from "../../src/payments/provider";
import { PosError, addLines, createDevice, openOrder, saveItem, saveTable } from "../../src/services/pos";
import { assignWaiter, saveWaiter } from "../../src/services/floorplan";
import { ensureQrToken, feedbackOf, markTablePaid, paymentByToken, startTablePayment, submitFeedback, tableBill, tableByQr } from "../../src/services/table-pay";
import { makeHotel } from "../helpers";

afterAll(closeDb);
afterEach(() => setPaymentProvider(null));

async function setup() {
  const { hotel } = await makeHotel({}, []);
  await db().update(hotels).set({ stripeAccountId: `acct_${crypto.randomUUID()}`, stripeChargesEnabled: true }).where(eq(hotels.id, hotel.id));
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  const dev = await createDevice(h.id, "K1", "Kasse", "t");
  const item = await saveItem(h.id, null, { category: "Pizza", name: "Margherita", priceRappen: 1800, vatDineInBps: 810, vatTakeawayBps: 260 }, "t");
  const table = await saveTable(h.id, "T1", "t");
  const order = await openOrder(h.id, { tableId: table.id, deviceId: dev.id }, "t");
  const lines = await addLines(h, order.id, [{ itemId: item.id, quantity: 2 }], "t");
  return { h, table, order, lines };
}

describe("Zahlung am Tisch per QR (SPEC 19.55)", () => {
  it("Token, offene Posten, Zahlung mit Trinkgeld bucht Bon und merkt den Kellner", async () => {
    setPaymentProvider(new FakePaymentProvider());
    const { h, table, order, lines } = await setup();
    const w = await saveWaiter(h.id, null, { name: "Anna Muster" }, "t");
    await assignWaiter(h.id, [table.id], w.id, "t");
    const qr = await ensureQrToken(h.id, table.id);
    expect(await tableByQr(qr)).toMatchObject({ table: { id: table.id } });
    expect(await tableByQr("0".repeat(24))).toBeNull();
    const bill = await tableBill(h.id, table.id);
    expect(bill.totalRappen).toBe(3600);
    expect(bill.lines[0]).toMatchObject({ openQty: 2 });
    const t = (await tableByQr(qr))!.table;
    const { payment } = await startTablePayment(h, t, { orderId: order.id, selection: [{ lineId: lines[0].id, quantity: 1 }], tipRappen: 300 });
    const done = (await paymentByToken(payment.publicToken))!;
    expect(done).toMatchObject({ status: "paid", itemsRappen: 1800, tipRappen: 300, waiterId: w.id });
    const [r] = await db().select().from(posReceipts).where(eq(posReceipts.id, done.receiptId!));
    expect(r).toMatchObject({ totalRappen: 1800, tipRappen: 300 });
    expect((await tableBill(h.id, table.id)).totalRappen).toBe(1800);
    expect(await markTablePaid(done.id, { sessionId: null, paymentIntentId: null })).toBe("already");
  });

  it("prüft Eingaben, fremde Bestellung, Bewertung einmal", async () => {
    const fake = new FakePaymentProvider();
    setPaymentProvider(fake);
    const { h, table, order, lines } = await setup();
    const t = (await tableByQr(await ensureQrToken(h.id, table.id)))!.table;
    await expect(startTablePayment(h, t, { orderId: order.id, selection: [{ lineId: lines[0].id, quantity: 3 }], tipRappen: 0 })).rejects.toBeInstanceOf(PosError);
    await expect(startTablePayment(h, t, { orderId: order.id, selection: [{ lineId: lines[0].id, quantity: 1 }], tipRappen: -1 })).rejects.toBeInstanceOf(PosError);
    await expect(startTablePayment(h, t, { orderId: crypto.randomUUID(), selection: [], tipRappen: 0 })).rejects.toBeInstanceOf(PosError);
    const { payment } = await startTablePayment(h, t, { orderId: order.id, selection: [{ lineId: lines[0].id, quantity: 2 }], tipRappen: 0 });
    await submitFeedback(payment.publicToken, 5, "super");
    await submitFeedback(payment.publicToken, 1, "doch nicht");
    expect(await feedbackOf(payment.id)).toMatchObject({ stars: 5, comment: "super" });
    await expect(submitFeedback(payment.publicToken, 9, "")).rejects.toBeInstanceOf(PosError);
    expect(await db().select().from(tablePayments).where(eq(tablePayments.hotelId, h.id))).toHaveLength(1);
  });

  it("Zahlung nach schon bezahlten Posten wird zurückerstattet", async () => {
    const fake = new FakePaymentProvider();
    setPaymentProvider(fake);
    const { h, table, order, lines } = await setup();
    const t = (await tableByQr(await ensureQrToken(h.id, table.id)))!.table;
    // Vorgang offen halten: direkt eintragen, dann Posten anderweitig bezahlen
    const [p] = await db().insert(tablePayments).values({ hotelId: h.id, tableId: table.id, orderId: order.id, publicToken: "tok-late", selection: [{ lineId: lines[0].id, quantity: 2 }], itemsRappen: 3600, tipRappen: 0 }).returning();
    const dev = await createDevice(h.id, "K2", "Kasse 2", "t").catch(() => null);
    expect(t.id).toBe(table.id);
    const { pay } = await import("../../src/services/pos");
    await pay(h, { orderId: order.id, deviceId: dev!.id, selection: [{ lineId: lines[0].id, quantity: 2 }], payments: [{ method: "cash", amountRappen: 3600 }] }, "t");
    expect(await markTablePaid(p.id, { sessionId: "s", paymentIntentId: "pi" })).toBe("refunded");
    expect(fake.refunds).toHaveLength(1);
    expect((await paymentByToken("tok-late"))!.status).toBe("failed");
  });
});
