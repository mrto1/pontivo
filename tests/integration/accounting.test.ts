import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { bookings, hotels, platformCharges } from "../../src/db/schema";
import { accountingExport, writeAccountingFile } from "../../src/services/accounting";
import { createDirectBooking } from "../../src/services/bookings";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

async function hotelWithFee(month: string, feeRappen: number) {
  const h = await makeHotel();
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  const d = inDays(30);
  const { booking } = await createDirectBooking(hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin: d, checkout: addDays(d, 2), adults: 2, children: 0, childrenAges: [], guest, voucherCode: null });
  await db().update(bookings).set({ status: "confirmed", confirmedAt: new Date(`${month}-10T10:00:00Z`), platformFeeRappen: feeRappen }).where(eq(bookings.id, booking.id));
  return hotel;
}

describe("Buchhaltungsexport für Banana", () => {
  it("Provision und bezahlte Belastungen als Zeilen, offene ausgelassen, Format stimmt", async () => {
    const month = "2020-03";
    const a = await hotelWithFee(month, 1234);
    const b = await hotelWithFee(month, 500);
    await db().insert(platformCharges).values([
      { hotelId: a.id, month, feesRappen: 1234, minimumRappen: 5000, chargeRappen: 4766 + 2900 + 490, aiModuleRappen: 2900, aiPacksRappen: 490, status: "succeeded" },
      { hotelId: b.id, month, feesRappen: 500, minimumRappen: 5000, chargeRappen: 4500, status: "failed" },
    ]);
    const x = await accountingExport(month);
    const mine = x.lines.filter((l) => l.ref.includes(a.id) || l.ref.includes(b.id));
    const by = (id: string, kind: string) => mine.find((l) => l.ref === `pontivo-${month}-${id}-${kind}`);
    expect(by(a.id, "fee")).toMatchObject({ rappen: 1234, date: "2020-03-31", credit: "3000", debit: "1090" });
    expect(by(a.id, "min")?.rappen).toBe(4766);
    expect(by(a.id, "ai")).toMatchObject({ rappen: 2900, credit: "3002" });
    expect(by(a.id, "aipk")?.rappen).toBe(490);
    expect(by(b.id, "fee")?.rappen).toBe(500); // Provision ist bereits eingezogen
    expect(by(b.id, "min")).toBeUndefined(); // fehlgeschlagene Belastung nicht als Ertrag
    expect(x.skipped).toContainEqual({ hotel: b.name, reason: "Belastung fehlgeschlagen", rappen: 4500 });

    const lines = x.tsv.split("\n");
    expect(lines[0]).toBe("Date\tDocInvoice\tDescription\tAccountDebit\tAccountCredit\tAmount\tExternalReference");
    expect(x.tsv.endsWith("\n")).toBe(true);
    const row = lines.find((l) => l.includes(`${a.id}-fee`))!.split("\t");
    expect(row).toHaveLength(7);
    expect(row[0]).toBe("2020-03-31");
    expect(row[5]).toBe("12.34");
    expect(x.tsv).not.toMatch(/,\d{2}\t/); // Punkt als Dezimaltrennzeichen
  });

  it("Tabulator im Hotelnamen zerstört keine Spalten; Datei wird geschrieben; ohne Ordner nichts; falscher Monat", async () => {
    const month = "2020-04";
    const h = await hotelWithFee(month, 700);
    await db().update(hotels).set({ name: "Gasthof\tZum\nBären" }).where(eq(hotels.id, h.id));
    const dir = mkdtempSync(join(tmpdir(), "bana-"));
    const r = await writeAccountingFile(month, dir);
    expect(r?.path).toBe(join(dir, "pontivo-2020-04.txt"));
    const text = readFileSync(r!.path, "utf8");
    const row = text.split("\n").find((l) => l.includes(`${h.id}-fee`))!;
    expect(row.split("\t")).toHaveLength(7);
    expect(row).toContain("Gasthof Zum Bären");
    expect(await writeAccountingFile(month, undefined)).toBeNull();
    await expect(accountingExport("2020-13")).rejects.toThrow(/JJJJ-MM/);
  });
});
