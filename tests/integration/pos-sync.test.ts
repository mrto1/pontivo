import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { folioItems, hotels, posDevices } from "../../src/db/schema";
import { createAdminBooking } from "../../src/services/admin-bookings";
import { updateInvoicingSettings } from "../../src/services/invoicing";
import { createDevice, orderView, releaseDevice, saveItem, saveTable, verifyHotel } from "../../src/services/pos";
import { DeviceError, bootstrap, offlineWarnings, syncOps } from "../../src/services/pos-sync";
import type { SyncOp } from "../../src/domain/pos-offline";
import { addDays, todayIn } from "../../src/domain/dates";
import { makeHotel } from "../helpers";

afterAll(closeDb);
const KEY = "k".repeat(24), OTHER = "o".repeat(24);
const id = () => crypto.randomUUID();

async function setup() {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, basePriceRappen: 15000 }]);
  await updateInvoicingSettings(h.hotel, { vatLiable: true, vatNumber: "CHE-123.456.789 MWST" }, "t");
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  const soup = await saveItem(hotel.id, null, { category: "Essen", name: "Suppe", priceRappen: 1000, vatDineInBps: 810, vatTakeawayBps: 260 }, "t");
  const table = await saveTable(hotel.id, "Tisch 1", "t");
  await createDevice(hotel.id, "T1", "Tablet", "t");
  return { ...h, hotel, soup, table };
}
const orderOp = (tableId: string | null, oid = id()): SyncOp => ({ kind: "order", id: oid, tableId, label: "", at: Date.now() });
const linesOp = (orderId: string, itemId: string, lineId = id(), price = 1000, qty = 2): SyncOp => ({ kind: "lines", id: id(), orderId, at: Date.now(), lines: [{ id: lineId, itemId, quantity: qty, mode: "dine_in", description: "Suppe", unitPriceRappen: price, vatBps: 810 }] });
const payOp = (orderId: string, lineId: string, bonNo: number, amount: number, extra: Partial<Extract<SyncOp, { kind: "pay" }>> = {}): SyncOp => ({ kind: "pay", id: id(), orderId, receiptId: id(), bonNo, at: Date.now(), selection: [{ lineId, quantity: 1 }], payments: [{ method: "cash", amountRappen: amount }], tipRappen: 0, bookingReference: "", ...extra });

describe("Offline-Kasse Übertragung (SPEC 19.16)", () => {
  it("Gerät gehört einem Browser; Freigabe", async () => {
    const s = await setup();
    const b = await bootstrap(s.hotel, KEY, "T1");
    expect(b.device).toEqual({ code: "T1", lastBon: 0 });
    expect(b.items).toHaveLength(1);
    expect(b.tables).toHaveLength(1);
    await expect(bootstrap(s.hotel, OTHER, "T1")).rejects.toBeInstanceOf(DeviceError);
    await expect(syncOps(s.hotel, OTHER, "T1", 0, [], "x")).rejects.toBeInstanceOf(DeviceError);
    expect((await bootstrap(s.hotel, OTHER)).devices[0]).toMatchObject({ code: "T1", mine: false, free: false });
    const [d] = await db().select().from(posDevices).where(eq(posDevices.hotelId, s.hotel.id));
    await releaseDevice(s.hotel.id, d.id, "m");
    expect((await bootstrap(s.hotel, OTHER, "T1")).device?.code).toBe("T1");
    await expect(bootstrap(s.hotel, KEY, "NOPE")).rejects.toBeInstanceOf(DeviceError);
  });

  it("Vorgänge übernehmen, Wiederholung bucht nichts doppelt, Preis wie am Gerät", async () => {
    const s = await setup();
    await bootstrap(s.hotel, KEY, "T1");
    const o = orderOp(s.table.id);
    const lineId = id();
    const ops = [o, linesOp(o.id, s.soup.id, lineId, 900), payOp(o.id, lineId, 1, 900)];
    // Preis wurde inzwischen geändert: gilt trotzdem der Preis, den der Gast offline gesehen hat
    await saveItem(s.hotel.id, s.soup.id, { category: "Essen", name: "Suppe", priceRappen: 1200, vatDineInBps: 810, vatTakeawayBps: 260 }, "t");
    const r1 = await syncOps(s.hotel, KEY, "T1", 3, ops, "u");
    expect(r1.every((r) => r.ok)).toBe(true);
    const r2 = await syncOps(s.hotel, KEY, "T1", 3, ops, "u"); // Verbindung brach vor der Antwort ab
    expect(r2.every((r) => r.ok)).toBe(true);
    const v = await orderView(s.hotel.id, o.id);
    expect(v!.lines).toHaveLength(1);
    expect(v!.lines[0].line.unitPriceRappen).toBe(900);
    expect(v!.lines[0].openQuantity).toBe(1);
    expect(v!.receipts).toHaveLength(1);
    expect(v!.receipts[0].number).toBe("T1-000001");
    expect(await verifyHotel(s.hotel.id)).toEqual({ receipts: 1, brokenAtSeq: null, gaps: [] });
    // Nummernkreis des Geräts geht auf dem Server weiter
    expect((await bootstrap(s.hotel, KEY, "T1")).device?.lastBon).toBe(1);
  });

  it("abgelehnter Bon: Lücke bleibt erklärbar, andere Vorgänge laufen weiter", async () => {
    const s = await setup();
    await bootstrap(s.hotel, KEY, "T1");
    const o = orderOp(null);
    const l = id();
    const ops: SyncOp[] = [o, linesOp(o.id, s.soup.id, l, 1000, 1), payOp(o.id, l, 1, 1000), payOp(o.id, l, 2, 1000) /* zweites Gerät hat dieselbe Zeile schon bezahlt */, payOp(id(), l, 3, 1000)];
    const r = await syncOps(s.hotel, KEY, "T1", 5, ops, "u");
    expect(r.map((x) => x.ok)).toEqual([true, true, true, false, false]);
    const w = await offlineWarnings(s.hotel.id);
    expect(w.rejected.map((x) => x.number).sort()).toEqual(["T1-000002", "T1-000003"]);
    expect((await verifyHotel(s.hotel.id)).gaps).toEqual([]); // Nummer 1 ist die letzte übernommene
    expect(w.unsynced).toEqual([{ code: "T1", pending: 2, lastSeenAt: expect.any(Date) }]); // 5 gesendet, 3 übernommen
  });

  it("aufs Zimmer offline: bekannte Buchung wird gebucht, unbekannte bleibt als Warnung stehen", async () => {
    const s = await setup();
    const today = todayIn(s.hotel.timezone);
    const bk = await createAdminBooking(s.hotel, { roomTypeId: s.rooms[0].roomType.id, ratePlanId: s.rooms[0].plans[0].id, checkin: today, checkout: addDays(today, 2), adults: 2, children: 0, guest: { firstName: "Max", lastName: "Muster", email: "", language: "de" }, notifyGuest: false }, "t");
    const boot = await bootstrap(s.hotel, KEY, "T1");
    expect(boot.guests?.some((g) => g.reference === bk.reference && g.name === "Max Muster")).toBe(true);
    const o = orderOp(null);
    const l = id();
    const r = await syncOps(s.hotel, KEY, "T1", 4, [o, linesOp(o.id, s.soup.id, l, 1000, 2), payOp(o.id, l, 1, 1000, { payments: [{ method: "room", amountRappen: 1000 }], bookingReference: bk.reference }), payOp(o.id, l, 2, 1000, { payments: [{ method: "room", amountRappen: 1000 }], bookingReference: "ABGEREIST" })], "u");
    expect(r.every((x) => x.ok)).toBe(true);
    expect(await db().select().from(folioItems).where(eq(folioItems.bookingId, bk.id))).toHaveLength(1);
    const w = await offlineWarnings(s.hotel.id);
    expect(w.unassigned).toEqual([{ number: "T1-000002", total: 1000, day: expect.any(String) }]);
  });

  it("Mandantentrennung: Bestellung eines anderen Betriebs ist nicht zugänglich", async () => {
    const a = await setup(), b = await setup();
    await bootstrap(a.hotel, KEY, "T1"); await bootstrap(b.hotel, KEY, "T1");
    const o = orderOp(null);
    await syncOps(a.hotel, KEY, "T1", 1, [o], "u");
    const r = await syncOps(b.hotel, KEY, "T1", 1, [linesOp(o.id, b.soup.id)], "u");
    expect(r[0].ok).toBe(false);
    expect((await bootstrap(b.hotel, KEY, "T1")).orders).toEqual([]);
  });
});
