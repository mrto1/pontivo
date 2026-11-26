import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotelModules, hotels, posOrderLines, posReceipts, posReservations } from "../../src/db/schema";
import { addDays, todayIn } from "../../src/domain/dates";
import { FakePaymentProvider } from "../../src/payments/fake";
import { setPaymentProvider } from "../../src/payments/provider";
import { PosError, saveItem, saveOption, saveOptionGroup, saveTable, setGroupItems } from "../../src/services/pos";
import { saveItemOnline } from "../../src/services/online-orders";
import { assignTable, createReservation, saveSettings, setReservationStatus } from "../../src/services/reservations";
import { makeHotel } from "../helpers";

afterAll(closeDb);
afterEach(() => setPaymentProvider(null));

async function setup(extra: Partial<Parameters<typeof saveSettings>[1]> = {}) {
  const fake = new FakePaymentProvider();
  setPaymentProvider(fake);
  const { hotel } = await makeHotel({}, []);
  await db().update(hotels).set({ stripeAccountId: `acct_${crypto.randomUUID()}`, stripeChargesEnabled: true }).where(eq(hotels.id, hotel.id));
  await db().insert(hotelModules).values({ hotelId: hotel.id, module: "restaurant", enabled: true });
  const [h] = await db().select().from(hotels).where(eq(hotels.id, hotel.id));
  const day = addDays(todayIn(h.timezone), 3);
  await saveSettings(h.id, { onlineEnabled: true, windows: [{ from: "18:00", to: "20:00" }], durationMin: 90, maxParty: 12, capacity: 50, leadHours: 0, horizonDays: 30, depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 24, autoAssign: true, preorderEnabled: true, preorderRequiredFrom: 8, ...extra }, "t");
  const soup = await saveItem(h.id, null, { category: "Vorspeise", name: "Suppe", priceRappen: 1000, vatDineInBps: 810, vatTakeawayBps: 260 }, "t");
  await saveItemOnline(h.id, soup.id, { online: true, description: "", photoUrl: null, allergens: [] }, "t");
  const table = await saveTable(h.id, "T1", "t");
  return { h, day, soup, table, fake };
}
const guest = (day: string, party: number, preorder?: { itemId: string; quantity: number }[]) => ({ day, time: "18:00", party, name: "Gruppe Muster", email: "g@example.ch", preorder: preorder?.map((l) => ({ ...l, optionIds: [], note: "" })) });

describe("Vorbestellung (SPEC 19.57)", () => {
  it("online mit Vorbestellung: bezahlt vorab, beim Platzieren Bestellung und Bon", async () => {
    const { h, day, soup, table } = await setup();
    const { reservation } = await createReservation(h, guest(day, 4, [{ itemId: soup.id, quantity: 4 }]), "online", "guest");
    expect(reservation).toMatchObject({ status: "confirmed", depositStatus: "paid", depositRappen: 4000, preorderRappen: 4000 });
    expect(reservation.preorder).toHaveLength(1);
    await assignTable(h.id, reservation.id, table.id, "t");
    await setReservationStatus(h.id, reservation.id, "seated", "t");
    const [r] = await db().select().from(posReservations).where(eq(posReservations.id, reservation.id));
    expect(r.preorderOrderId).toBeTruthy();
    const lines = await db().select().from(posOrderLines).where(eq(posOrderLines.orderId, r.preorderOrderId!));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ quantity: 4, unitPriceRappen: 1000, vatBps: 0 }); // Betrieb nicht MWST-pflichtig
    const bons = await db().select().from(posReceipts).where(eq(posReceipts.orderId, r.preorderOrderId!));
    expect(bons).toHaveLength(1);
    expect(bons[0].totalRappen).toBe(4000);
    await setReservationStatus(h.id, reservation.id, "seated", "t"); // erneut: kein zweiter Bon
    expect(await db().select().from(posReceipts).where(eq(posReceipts.orderId, r.preorderOrderId!))).toHaveLength(1);
  });

  it("Pflicht ab n Personen, Prüfungen, Storno erstattet", async () => {
    const { h, day, soup, fake } = await setup();
    await expect(createReservation(h, guest(day, 8), "online", "guest")).rejects.toBeInstanceOf(PosError);
    await expect(createReservation(h, guest(day, 2, [{ itemId: crypto.randomUUID(), quantity: 1 }]), "online", "guest")).rejects.toBeInstanceOf(PosError);
    await expect(createReservation(h, guest(day, 2, [{ itemId: soup.id, quantity: 1 }]), "admin", "t")).rejects.toBeInstanceOf(PosError);
    const { reservation } = await createReservation(h, guest(day, 8, [{ itemId: soup.id, quantity: 8 }]), "online", "guest");
    expect(reservation.preorderRappen).toBe(8000);
    await setReservationStatus(h.id, reservation.id, "cancelled", "t");
    expect(fake.refunds).toHaveLength(1);
    expect(fake.refunds[0].amountRappen).toBe(8000);
  });

  it("Artikel mit Pflicht-Option ist nicht vorbestellbar; ausgeschaltet geht es nicht", async () => {
    const { h, day, soup } = await setup();
    const g = await saveOptionGroup(h.id, null, { name: "Grösse", required: true, maxChoices: 1 }, "t");
    await saveOption(h.id, g.id, { name: "gross", priceRappen: 200 }, "t");
    await setGroupItems(h.id, g.id, [soup.id], "t");
    await expect(createReservation(h, guest(day, 2, [{ itemId: soup.id, quantity: 1 }]), "online", "guest")).rejects.toBeInstanceOf(PosError);
    await saveSettings(h.id, { onlineEnabled: true, windows: [{ from: "18:00", to: "20:00" }], durationMin: 90, maxParty: 12, capacity: 50, leadHours: 0, horizonDays: 30, depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 24, autoAssign: true, preorderEnabled: false }, "t");
    await expect(createReservation(h, guest(day, 2, [{ itemId: soup.id, quantity: 1 }]), "online", "guest")).rejects.toBeInstanceOf(PosError);
  });
});
