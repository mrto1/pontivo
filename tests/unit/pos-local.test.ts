import { describe, expect, it } from "vitest";
import { afterPay, checkPay, isOpen, lineFor, mergeServer, openTotal, type CatalogItem, type LocalOrder } from "../../src/domain/pos-local";
import { nextBonNo, syncOp } from "../../src/domain/pos-offline";

const soup: CatalogItem = { id: crypto.randomUUID(), category: "Essen", name: "Suppe", priceRappen: 1000, vatDineInBps: 810, vatTakeawayBps: 260, dailySpecial: false };
const order = (): LocalOrder => ({ id: crypto.randomUUID(), tableId: null, label: "", lines: [lineFor(soup, 2, "dine_in", crypto.randomUUID(), true), lineFor(soup, 1, "takeaway", crypto.randomUUID(), true)], receipts: [] });

describe("Offline-Kasse lokal", () => {
  it("Sätze aus Artikel und Art, nicht MWST-pflichtig = 0", () => {
    expect(lineFor(soup, 1, "takeaway", "x", true).vatBps).toBe(260);
    expect(lineFor(soup, 1, "dine_in", "x", false).vatBps).toBe(0);
  });
  it("Auswahl prüfen, bezahlen, offen sinkt", () => {
    const o = order();
    expect(openTotal(o)).toBe(3000);
    expect(checkPay(o, [])).toEqual({ error: "Nichts zum Bezahlen gewählt." });
    expect(checkPay(o, [{ lineId: o.lines[0].id, quantity: 3 }])).toMatchObject({ error: expect.stringContaining("höchstens 2") });
    expect(checkPay(o, [{ lineId: "nope", quantity: 1 }])).toEqual({ error: "Zeile unbekannt." });
    const sel = [{ lineId: o.lines[0].id, quantity: 1 }];
    const c = checkPay(o, sel);
    expect(c).toEqual({ totalRappen: 1000 });
    const p = afterPay(o, sel, { number: "T1-000001", totalRappen: 1000 });
    expect(openTotal(p)).toBe(2000);
    expect(isOpen(afterPay(p, [{ lineId: p.lines[0].id, quantity: 1 }, { lineId: p.lines[1].id, quantity: 1 }], { number: "T1-000002", totalRappen: 2000 }))).toBe(false);
  });
  it("Server-Stand übernehmen, ausser bei nicht übertragenen Vorgängen", () => {
    const a = order(), b = order();
    const server = [{ id: b.id, tableId: null, label: "", lines: [] }, { id: "neu", tableId: null, label: "", lines: [] }];
    const m = mergeServer([a, b], server, new Set([a.id]));
    expect(m.map((o) => o.id)).toEqual([a.id, b.id, "neu"]);
    expect(m[1].lines).toEqual([]); // vom Server überschrieben
    expect(m[0]).toBe(a);
  });
  it("Bon-Nummer geht vom höheren Stand weiter", () => {
    expect(nextBonNo(0, 0)).toBe(1);
    expect(nextBonNo(5, 3)).toBe(6);
    expect(nextBonNo(3, 9)).toBe(10);
  });
  it("Vorgänge werden streng geprüft", () => {
    const id = crypto.randomUUID();
    expect(syncOp.safeParse({ kind: "order", id, tableId: null, label: "x", at: 1 }).success).toBe(true);
    expect(syncOp.safeParse({ kind: "order", id: "nein", tableId: null, label: "x", at: 1 }).success).toBe(false);
    expect(syncOp.safeParse({ kind: "pay", id, orderId: id, receiptId: id, bonNo: 0, at: 1, selection: [{ lineId: id, quantity: 1 }], payments: [{ method: "cash", amountRappen: 100 }], tipRappen: 0, bookingReference: "" }).success).toBe(false);
    expect(syncOp.safeParse({ kind: "lines", id, orderId: id, at: 1, lines: [{ id, itemId: id, quantity: 1, mode: "dine_in", description: "A", unitPriceRappen: -5, vatBps: 810 }] }).success).toBe(false);
  });
});
