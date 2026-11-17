import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { auditLog, bookings, channexOutbox, emailOutbox, guests, hotels, inventoryDays, onsitePayments, payments } from "../../src/db/schema";
import { createImportCheck, exportFiles, getImport, ImportError, runImport, setInvoiceStart, undoImport } from "../../src/services/migration";
import { createInvoiceDraft, issueInvoice } from "../../src/services/invoicing";
import { addDays, todayIn } from "../../src/domain/dates";
import { importTemplate, parseImport } from "../../src/domain/import-csv";
import { zipStore } from "../../src/domain/zip";
import { inDays, makeHotel } from "../helpers";

afterAll(closeDb);

const HEAD = "externe_nummer;anreise;abreise;zimmertyp;tarif;erwachsene;kinder;vorname;nachname;email;telefon;sprache;preis_total;bezahlt;status;bemerkung";
const line = (ref: string, from: number, nights: number, type = "Doppelzimmer", extra: Partial<Record<string, string>> = {}) =>
  [ref, inDays(from), inDays(from + nights), type, "", "2", "0", extra.first ?? "Anna", extra.last ?? `Muster${ref}`, extra.email ?? `g-${ref}@example.ch`, "", "de", extra.total ?? "300.00", extra.paid ?? "100.00", extra.status ?? "bestaetigt", ""].join(";");
const csv = (...l: string[]) => [HEAD, ...l].join("\n");
const fresh = async (id: string) => (await db().select().from(hotels).where(eq(hotels.id, id)))[0];
const count = async (hotelId: string) => Number((await db().select({ n: sql<number>`count(*)` }).from(bookings).where(eq(bookings.hotelId, hotelId)))[0].n);
const booked = async (roomTypeId: string, night: string) => (await db().select().from(inventoryDays).where(and(eq(inventoryDays.roomTypeId, roomTypeId), eq(inventoryDays.night, night))))[0]?.booked ?? 0;

describe("Datenübernahme (PMS-ERSATZ 2.10)", () => {
  it("1+2: 200 Reservierungen im Trockenlauf melden Fehler, schreiben nichts; zweimal importieren = keine Dubletten", async () => {
    const { hotel, rooms } = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 300, maxAdults: 2, maxChildren: 2, maxOccupancy: 4, basePriceRappen: 18000 }]);
    const rt = rooms[0].roomType.id;
    const lines = Array.from({ length: 200 }, (_, i) => line(`A-${i}`, 10 + (i % 50), 2));
    const check = await createImportCheck(hotel, csv(...lines), "alt.csv", "t");
    expect(check.summary).toMatchObject({ total: 200, created: 200, errors: 0, future: 200 });
    expect(check.summary.sample).toHaveLength(10);
    expect(await count(hotel.id)).toBe(0); // Trockenlauf schreibt nichts
    expect(await booked(rt, inDays(10))).toBe(0);

    const bad = await createImportCheck(hotel, csv(line("B-1", 10, 2), line("B-1", 10, 2), line("B-2", 10, 2, "Suite"), "B-3;31.02.2027;x;Doppelzimmer;;;;A;B;;;;10;;;"), "fehler.csv", "t");
    expect(bad.summary.errors).toBeGreaterThanOrEqual(3);
    expect(bad.summary.issues.map((i) => i.message).join(" ")).toMatch(/mehrfach.*|Suite.*gibt es in Pontivo nicht|Anreise ungültig/);

    const run = await runImport(hotel, check.id, "t");
    expect(run.status).toBe("done");
    expect(run.csv).toBeNull(); // Datei wird nach dem Import gelöscht
    expect(await count(hotel.id)).toBe(200);
    // gleiche Datei nochmal prüfen: alles übersprungen, keine Dubletten
    const again = await createImportCheck(hotel, csv(...lines), "alt.csv", "t");
    expect(again.summary).toMatchObject({ created: 0, skipped: 200, errors: 0 });
    await runImport(hotel, again.id, "t");
    expect(await count(hotel.id)).toBe(200);
  }, 60000);

  it("3+5: Import belegt Nächte, schreibt channex_outbox und audit; keine Mails, keine Kartenzahlung", async () => {
    const { hotel, rooms } = await makeHotel();
    const rt = rooms[0].roomType.id;
    const job = await createImportCheck(hotel, csv(line("C-1", 20, 3), line("C-2", 21, 1, "Doppelzimmer", { paid: "0" })), "a.csv", "t");
    await runImport(hotel, job.id, "t");
    expect(await booked(rt, inDays(20))).toBe(1);
    expect(await booked(rt, inDays(21))).toBe(2);
    expect(await booked(rt, inDays(23))).toBe(0);
    expect((await db().select().from(channexOutbox).where(eq(channexOutbox.hotelId, hotel.id))).length).toBeGreaterThan(0);
    expect((await db().select().from(auditLog).where(and(eq(auditLog.hotelId, hotel.id), eq(auditLog.action, "booking.import")))).length).toBe(2);
    expect(await db().select().from(emailOutbox).where(eq(emailOutbox.hotelId, hotel.id))).toHaveLength(0);
    expect(await db().select().from(payments).where(eq(payments.hotelId, hotel.id))).toHaveLength(0);
    const paid = await db().select().from(onsitePayments).where(eq(onsitePayments.hotelId, hotel.id));
    expect(paid.map((p) => p.amountRappen)).toEqual([10000]); // «bezahlt» als Zahlung vor Ort vermerkt
    const [b] = await db().select().from(bookings).where(and(eq(bookings.hotelId, hotel.id), eq(bookings.sourceRef, "C-1")));
    expect(b.totalRappen).toBe(30000);
    expect(b.source).toBe("import");
  });

  it("4: Überbuchung verhindert den Import", async () => {
    const { hotel, rooms } = await makeHotel(); // 3 Zimmer
    const job = await createImportCheck(hotel, csv(...[1, 2, 3, 4].map((i) => line(`D-${i}`, 15, 2))), "a.csv", "t");
    expect(job.summary.errors).toBe(1);
    expect(job.summary.issues[0].message).toMatch(/Überbuchung/);
    await expect(runImport(hotel, job.id, "t")).rejects.toThrow(ImportError);
    expect(await count(hotel.id)).toBe(0);
    expect(await booked(rooms[0].roomType.id, inDays(15))).toBe(0);
  });

  it("6: Rückgängig entfernt Buchungen und Gäste, gibt Nächte frei; mit späterer Zahlung bleibt die Buchung", async () => {
    const { hotel, rooms } = await makeHotel();
    const rt = rooms[0].roomType.id;
    const job = await createImportCheck(hotel, csv(line("E-1", 30, 2), line("E-2", 30, 2), line("E-3", -9, 2), line("E-4", 40, 2, "Doppelzimmer", { status: "storniert" })), "a.csv", "t");
    await runImport(hotel, job.id, "t");
    expect(await booked(rt, inDays(30))).toBe(2);
    const [e2] = await db().select().from(bookings).where(and(eq(bookings.hotelId, hotel.id), eq(bookings.sourceRef, "E-2")));
    await db().insert(onsitePayments).values({ hotelId: hotel.id, bookingId: e2.id, amountRappen: 5000, method: "cash", receivedOn: inDays(0), actor: "user:x" });
    const undone = await undoImport(hotel, job.id, "t");
    expect(undone.status).toBe("undone");
    expect(undone.summary.undone?.removed).toBe(3);
    expect(undone.summary.undone?.kept).toEqual([{ ref: "E-2", reason: expect.stringContaining("Zahlungen") }]);
    expect(await count(hotel.id)).toBe(1);
    expect(await booked(rt, inDays(30))).toBe(1); // nur E-2 belegt noch
    expect(await db().select().from(guests).where(eq(guests.hotelId, hotel.id))).toHaveLength(1);
  });

  it("7: Mandantentrennung", async () => {
    const a = await makeHotel(), b = await makeHotel();
    const job = await createImportCheck(a.hotel, csv(line("F-1", 20, 2)), "a.csv", "t");
    await expect(getImport(b.hotel.id, job.id)).rejects.toThrow(ImportError);
    await expect(runImport(b.hotel, job.id, "t")).rejects.toThrow(ImportError);
    await runImport(a.hotel, job.id, "t");
    await expect(undoImport(b.hotel, job.id, "t")).rejects.toThrow(ImportError);
    expect(await count(b.hotel.id)).toBe(0);
  });

  it("8: Gesamtexport nur des eigenen Betriebs, im Trockenlauf wieder lesbar; ZIP", async () => {
    const a = await makeHotel(), other = await makeHotel();
    await runImport(a.hotel, (await createImportCheck(a.hotel, csv(line("G-1", 20, 2, "Doppelzimmer", { last: "Eigener" })), "a.csv", "t")).id, "t");
    await runImport(other.hotel, (await createImportCheck(other.hotel, csv(line("G-9", 20, 2, "Doppelzimmer", { last: "Fremder" })), "b.csv", "t")).id, "t");
    const files = await exportFiles(a.hotel);
    expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(["reservierungen.csv", "gaeste.csv", "zimmertypen.csv", "tarife.csv", "rechnungen.csv", "gutscheine.csv"]));
    const all = files.map((f) => f.csv).join("\n");
    expect(all).toContain("Eigener");
    expect(all).not.toContain("Fremder");
    const re = await createImportCheck(a.hotel, files.find((f) => f.name === "reservierungen.csv")!.csv, "export.csv", "t");
    expect(re.summary).toMatchObject({ total: 1, errors: 0, skipped: 1 });
    const zip = zipStore(files.map((f) => ({ name: f.name, data: Buffer.from(f.csv) })));
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.includes(Buffer.from("reservierungen.csv"))).toBe(true);
  });

  it("9: Rechnungsnummer: Startwert, lückenlos weiter, nie rückwärts", async () => {
    const { hotel, rooms } = await makeHotel();
    const h = await fresh(hotel.id);
    const year = Number(todayIn(h.timezone).slice(0, 4));
    await setInvoiceStart(h, year, 1234, "t");
    const job = await createImportCheck(h, csv(line("H-1", 20, 2), line("H-2", 25, 2)), "a.csv", "t");
    await runImport(h, job.id, "t");
    const bs = await db().select().from(bookings).where(eq(bookings.hotelId, h.id)).orderBy(bookings.checkin);
    const i1 = await issueInvoice(h, (await createInvoiceDraft(h, bs[0].id, "t")).id, "t");
    const i2 = await issueInvoice(h, (await createInvoiceDraft(h, bs[1].id, "t")).id, "t");
    expect([i1.number, i2.number]).toEqual([`${year}-1234`, `${year}-1235`]);
    await expect(setInvoiceStart(h, year, 1000, "t")).rejects.toThrow(ImportError);
    expect(rooms.length).toBe(1);
  });

  it("Vorlage ist selbst gültig", () => {
    const r = parseImport(importTemplate());
    expect(r.problems).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(addDays("2027-01-01", 1)).toBe("2027-01-02");
  });
});
