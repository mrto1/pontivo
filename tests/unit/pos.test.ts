import { describe, expect, it } from "vitest";
import { bonGaps, businessDay, checkSelection, dayReport, effectiveQuantities, openTotalRappen, outstanding, receiptNumber, selectionTotal, type Line } from "../../src/domain/pos";
import { GENESIS_HASH, hashReceipt, verifyChain, type ChainRecord } from "../../src/domain/pos-chain";

const L = (id: string, q: number, price: number, bps = 810, rev: string | null = null): Line => ({ id, quantity: q, unitPriceRappen: price, vatBps: bps, reversesLineId: rev });

describe("Kasse: offene Posten (SPEC 19.16)", () => {
  const lines = [L("a", 2, 1000), L("b", 1, 2600, 260), L("s", -1, 1000, 810, "a")];
  it("Stornozeile mindert die wirksame Menge", () => {
    expect(effectiveQuantities(lines).get("a")).toBe(1);
    expect(effectiveQuantities(lines).has("s")).toBe(false);
  });
  it("offen = wirksam minus bezahlt, Gegenbon (negativ) macht wieder offen", () => {
    expect(outstanding(lines, []).get("a")).toBe(1);
    expect(outstanding(lines, [{ lineId: "a", quantity: 1 }]).get("a")).toBe(0);
    expect(outstanding(lines, [{ lineId: "a", quantity: 1 }, { lineId: "a", quantity: -1 }]).get("a")).toBe(1);
    expect(openTotalRappen(lines, [])).toBe(1000 + 2600);
    expect(openTotalRappen(lines, [{ lineId: "b", quantity: 1 }])).toBe(1000);
  });
  it("Auswahl prüfen: nicht mehr als offen, keine Duplikate, keine 0", () => {
    expect(checkSelection(lines, [], [{ lineId: "a", quantity: 1 }])).toBeNull();
    expect(checkSelection(lines, [], [{ lineId: "a", quantity: 2 }])).not.toBeNull();
    expect(checkSelection(lines, [], [{ lineId: "a", quantity: 1 }, { lineId: "a", quantity: 1 }])).not.toBeNull();
    expect(checkSelection(lines, [], [{ lineId: "a", quantity: 0 }])).not.toBeNull();
    expect(checkSelection(lines, [], [{ lineId: "x", quantity: 1 }])).not.toBeNull();
    expect(checkSelection(lines, [], [])).not.toBeNull();
    expect(checkSelection(lines, [{ lineId: "a", quantity: 1 }], [{ lineId: "a", quantity: 1 }])).not.toBeNull();
  });
  it("Rabattzeile (negativ) darf ganz mit", () => {
    const d = [L("a", 1, 5000), L("r", 1, -500)];
    expect(checkSelection(d, [], [{ lineId: "r", quantity: 1 }])).toBeNull(); // 1 offen, positive Menge mit negativem Preis
  });
  it("Summe und MWST je Satz", () => {
    const t = selectionTotal(lines, [{ lineId: "a", quantity: 1 }, { lineId: "b", quantity: 1 }]);
    expect(t.totalRappen).toBe(3600);
    expect(t.vat.map((v) => v.bps)).toEqual([260, 810]);
    expect(t.vatRappen).toBe(t.vat.reduce((a, v) => a + v.vatRappen, 0));
  });
});

describe("Kasse: Hash-Kette (Art. 3 GeBüV)", () => {
  const rec = (seq: number): ChainRecord => ({ hotelId: "h", number: receiptNumber("T1", seq), seq, kind: "sale", reversesReceiptId: null, items: [{ lineId: "a", quantity: 1 }], totalRappen: 1000, vat: [], tipRappen: 0, businessDay: "2026-11-15", cashier: "u", paidAt: "2026-11-15T10:00:00.000Z" });
  const chain = () => { const out: (ChainRecord & { prevHash: string; hash: string })[] = []; let prev = GENESIS_HASH; for (const s of [1, 2, 3]) { const r = rec(s); const hash = hashReceipt(prev, r); out.push({ ...r, prevHash: prev, hash }); prev = hash; } return out; };
  it("intakte Kette", () => expect(verifyChain(chain())).toBeNull());
  it("geänderter Betrag wird erkannt", () => { const c = chain(); c[1] = { ...c[1], totalRappen: 900 }; expect(verifyChain(c)).toBe(2); });
  it("gelöschter Bon wird erkannt", () => { const c = chain(); c.splice(1, 1); expect(verifyChain(c)).toBe(3); });
  it("Nummer mit Gerätecode", () => expect(receiptNumber("T1", 42)).toBe("T1-000042"));
});

describe("Kasse: Tag und Z-Bericht", () => {
  it("verspäteter Bon eines abgeschlossenen Tages zählt am ersten offenen Tag, markiert", () => {
    expect(businessDay("2026-11-14", "2026-11-15", (d) => d === "2026-11-14")).toEqual({ day: "2026-11-15", late: true });
    expect(businessDay("2026-11-15", "2026-11-15", (d) => d === "2026-11-15")).toEqual({ day: "2026-11-16", late: true }); // nach dem Z-Bericht kassiert
    expect(businessDay("2026-11-14", "2026-11-15", (d) => d <= "2026-11-15")).toEqual({ day: "2026-11-16", late: true });
    expect(businessDay("2026-11-15", "2026-11-15", () => false)).toEqual({ day: "2026-11-15", late: false });
  });
  it("Z-Bericht: Zahlarten, Gegenbon mindert, Bargeld inkl. Trinkgeld, MWST je Satz", () => {
    const r = dayReport([
      { kind: "sale", totalRappen: 5000, tipRappen: 300, late: false, vat: [{ bps: 810, grossRappen: 5000, vatRappen: 375, netRappen: 4625 }], payments: [{ method: "cash", amountRappen: 5000 }] },
      { kind: "sale", totalRappen: 2000, tipRappen: 0, late: true, vat: [{ bps: 260, grossRappen: 2000, vatRappen: 51, netRappen: 1949 }], payments: [{ method: "room", amountRappen: 2000 }] },
      { kind: "reversal", totalRappen: -1000, tipRappen: 0, late: false, vat: [{ bps: 810, grossRappen: -1000, vatRappen: -75, netRappen: -925 }], payments: [{ method: "cash", amountRappen: -1000 }] },
    ]);
    expect(r).toMatchObject({ receipts: 2, reversals: 1, late: 1, totalRappen: 6000, expectedCashRappen: 4300 });
    expect(r.byMethod).toEqual({ cash: 4000, card: 0, twint: 0, room: 2000 });
    expect(r.vat.find((v) => v.bps === 810)?.grossRappen).toBe(4000);
  });
  it("Lücken im Nummernkreis", () => {
    expect(bonGaps([1, 2, 4, 5])).toEqual([3]);
    expect(bonGaps([1, 2, 3])).toEqual([]);
    expect(bonGaps([])).toEqual([]);
  });
});
