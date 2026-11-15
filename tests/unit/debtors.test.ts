import { describe, expect, it } from "vitest";
import { bucketOf, matchByReference, nextDunningLevel, parseCamt054 } from "../../src/domain/debtors";
import { qrReference } from "../../src/domain/invoice";

const entry = (o: { ind?: string; amt?: string; date?: string; ref?: string; bank?: string }) => `
<Ntry><NtryRef>1</NtryRef><Amt Ccy="CHF">${o.amt ?? "100.50"}</Amt><CdtDbtInd>${o.ind ?? "CRDT"}</CdtDbtInd>
<BookgDt><Dt>${o.date ?? "2026-11-02"}</Dt></BookgDt>${o.bank ? `<AcctSvcrRef>${o.bank}</AcctSvcrRef>` : ""}
<NtryDtls><TxDtls><RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Prtry>QRR</Prtry></CdOrPrtry></Tp><Ref>${o.ref ?? ""}</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry>`;
const doc = (...e: string[]) => `<?xml version="1.0"?><Document xmlns="urn:iso:std:62020:camt.054"><BkToCstmrDbtCdtNtfctn><Ntfctn>${e.join("")}</Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;

describe("Debitoren (SPEC 19.7)", () => {
  it("Alterungsstufen", () => {
    expect([-3, 0, 1, 30, 31, 60, 61].map(bucketOf)).toEqual(["not_due", "not_due", "d1_30", "d1_30", "d31_60", "d31_60", "d60_plus"]);
  });
  it("Mahnstufen: Reihenfolge, Fristen, höchstens drei", () => {
    expect(nextDunningLevel(4, 0)).toBeNull();
    expect(nextDunningLevel(5, 0)).toBe(1);
    expect(nextDunningLevel(10, 1)).toBeNull();
    expect(nextDunningLevel(20, 1)).toBe(2);
    expect(nextDunningLevel(40, 0)).toBe(1); // nie Stufen überspringen
    expect(nextDunningLevel(35, 2)).toBe(3);
    expect(nextDunningLevel(99, 3)).toBeNull();
  });
  it("camt.054: nur Gutschriften, Betrag in Rappen, Referenz ohne Leerzeichen", () => {
    const r = parseCamt054(doc(entry({ amt: "1234.5", ref: "21 00000 00003 13947 14300 09017", bank: "A1" }), entry({ ind: "DBIT" }), entry({ amt: "0.00" })));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ amountRappen: 123450, bookedOn: "2026-11-02", reference: "210000000003139471430009017", dedupeKey: "ref:A1" });
  });
  it("camt.054: Namensräume mit Präfix und fehlendes Datum", () => {
    const x = doc(entry({})).replace(/<(\/?)(\w)/g, "<$1ns:$2");
    expect(parseCamt054(x)).toHaveLength(1);
    expect(parseCamt054(doc(entry({ date: "kein" })))).toHaveLength(0);
  });
  it("Zuordnung über die QR-Referenz der Rechnungsnummer", () => {
    const list = [{ number: "2026-0001" }, { number: "2026-0002" }, { number: null }];
    expect(matchByReference(qrReference("2026-0002"), list)).toBe(list[1]);
    expect(matchByReference(qrReference("2026-0002").replace(/(.{5})/g, "$1 "), list)).toBe(list[1]);
    expect(matchByReference("123", list)).toBeNull();
    expect(matchByReference("", list)).toBeNull();
  });
});
