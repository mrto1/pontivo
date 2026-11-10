import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db, closeDb, rows } from "../../src/db/client";
import { auditLog, bookings, emailOutbox, guestRegistrations } from "../../src/db/schema";
import { createDirectBooking } from "../../src/services/bookings";
import {
  arrivals, CheckinError, enqueueCheckinLinks, logRegisterExport, purgeExpiredRegistrations, registerCsv, registerRows,
  retentionUntil, setGuestsModule, submitCheckin, touristTaxList, verifyRegistration,
} from "../../src/services/guests";
import { decryptField, encryptField } from "../../src/lib/guest-crypto";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel } from "../helpers";

afterAll(closeDb);

const PNG = "data:image/png;base64," + "iVBORw0KGgo".padEnd(400, "A") + "=";
const adult = (first: string, birthDate = "1980-05-17") => ({
  firstName: first, lastName: "Muster", birthDate, nationality: "CH", street: "Dorfstrasse 1", postalCode: "8750", city: "Glarus", country: "CH",
  docType: "id_card", docNumber: `C${first.length}234567`, sameAddress: false,
});

async function hotelWithBooking(opts: { canton?: string; municipality?: string; adults?: number; children?: number; ages?: number[]; checkin?: string; module?: boolean; maxOcc?: number } = {}) {
  const maxOcc = opts.maxOcc ?? 4;
  const h = await makeHotel({ canton: opts.canton ?? "GL", municipality: opts.municipality ?? "Glarus" }, [
    { name: "Familienzimmer", roomCount: 3, maxAdults: maxOcc, maxChildren: 2, maxOccupancy: maxOcc, basePriceRappen: 20000 },
  ]);
  if (opts.module !== false) await setGuestsModule(h.hotel.id, true, "t");
  const checkin = opts.checkin ?? inDays(5);
  const { booking: held } = await createDirectBooking(h.hotel, {
    roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin, checkout: addDays(checkin, 2),
    adults: opts.adults ?? 2, children: opts.children ?? 0, childrenAges: opts.ages ?? [], guest,
  });
  const [booking] = await db().select().from(bookings).where(eq(bookings.id, held.id));
  expect(booking.status).toBe("confirmed");
  return { ...h, booking };
}

describe("M4 Modul Gäste", () => {
  it("Verschlüsselung: Rundweg, zufälliger IV, Manipulation wird erkannt", () => {
    const a = encryptField("1980-05-17");
    expect(a).not.toContain("1980");
    expect(encryptField("1980-05-17")).not.toBe(a);
    expect(decryptField(a)).toBe("1980-05-17");
    const parts = a.split(":");
    parts[3] = Buffer.from("x").toString("base64url");
    expect(() => decryptField(parts.join(":"))).toThrow();
  });

  it("GL verlangt Unterschrift; Formular erscheint in der Tagesliste; Personal bestätigt, danach gesperrt", async () => {
    const { hotel, booking } = await hotelWithBooking();
    const input = { persons: [adult("Anna"), { ...adult("Beat"), sameAddress: true, street: "", postalCode: "", city: "", country: "" }], confirm: true };
    await expect(submitCheckin(booking.publicToken, input)).rejects.toMatchObject({ code: "signature" });

    await submitCheckin(booking.publicToken, { ...input, signature: PNG });
    const list = await arrivals(hotel.id, booking.checkin);
    const a = list.find((x) => x.bookingId === booking.id)!;
    expect(a.registered).toBe(2);
    expect(a.verified).toBe(false);
    expect(a.names).toEqual(["Anna Muster", "Beat Muster"]);

    // sensible Felder verschlüsselt in der DB, Adresse von Person 1 übernommen
    const regs = await db().select().from(guestRegistrations).where(eq(guestRegistrations.bookingId, booking.id));
    const p1 = regs.find((r) => r.isPrimary)!;
    const p2 = regs.find((r) => !r.isPrimary)!;
    expect(p1.birthDateEnc).not.toContain("1980");
    expect(p1.idDocumentNumberEnc).not.toContain("234567");
    expect(decryptField(p1.signaturePngEnc)).toBe(PNG);
    expect(p2.signaturePngEnc).toBeNull();
    expect(p2.city).toBe("Glarus");
    // GL: 3 Jahre Aufbewahrung ab Abreise
    expect(p1.retentionUntil).toBe(retentionUntil(booking.checkout, 3));

    // Korrektur ersetzt den Meldeschein
    await submitCheckin(booking.publicToken, { ...input, persons: [adult("Anna"), adult("Carla")], signature: PNG });
    expect((await arrivals(hotel.id, booking.checkin)).find((x) => x.bookingId === booking.id)!.names).toEqual(["Anna Muster", "Carla Muster"]);

    await verifyRegistration(hotel.id, booking.id, "user:staff");
    expect((await arrivals(hotel.id, booking.checkin)).find((x) => x.bookingId === booking.id)!.verified).toBe(true);
    await expect(submitCheckin(booking.publicToken, { ...input, signature: PNG })).rejects.toMatchObject({ code: "locked" });
  });

  it("SG verlangt keine Unterschrift; Pflichtfelder werden geprüft; Kinder ohne Ausweis erlaubt", async () => {
    const { booking } = await hotelWithBooking({ canton: "SG", municipality: "St. Gallen", adults: 1, children: 1, ages: [8] });
    // fehlende Nationalität und Ausweisnummer beim Erwachsenen
    const err = await submitCheckin(booking.publicToken, { persons: [{ ...adult("Anna"), nationality: "", docNumber: "" }, { ...adult("Tim", addDays(booking.checkin, -8 * 366)), sameAddress: true, docType: "", docNumber: "" }], confirm: true })
      .catch((e) => e);
    expect(err).toBeInstanceOf(CheckinError);
    expect(err.code).toBe("invalid");
    expect(err.fields).toEqual(expect.arrayContaining(["persons.0.nationality"]));
    // falsche Personenzahl
    await expect(submitCheckin(booking.publicToken, { persons: [adult("Anna")], confirm: true })).rejects.toMatchObject({ code: "invalid" });
    // ohne Bestätigung
    const tim = { ...adult("Tim", addDays(booking.checkin, -8 * 366)), sameAddress: true, docType: "", docNumber: "" };
    await expect(submitCheckin(booking.publicToken, { persons: [adult("Anna"), tim], confirm: false })).rejects.toMatchObject({ code: "confirm" });

    const ok = await submitCheckin(booking.publicToken, { persons: [adult("Anna"), { ...adult("Tim", addDays(booking.checkin, -8 * 366)), sameAddress: true, docType: "", docNumber: "" }], confirm: true });
    expect(ok.persons).toBe(2);
    const regs = await db().select().from(guestRegistrations).where(eq(guestRegistrations.bookingId, booking.id));
    expect(regs.every((r) => r.signaturePngEnc === null)).toBe(true);
    // SG: unter 16 befreit
    expect(regs.find((r) => r.firstName === "Tim")!.touristTaxLiable).toBe(false);
    expect(regs.find((r) => r.firstName === "Anna")!.touristTaxLiable).toBe(true);
  });

  it("SG-Gruppe ab 6 Personen: Kontaktperson plus Teilnehmerliste", async () => {
    const { booking } = await hotelWithBooking({ canton: "SG", municipality: "St. Gallen", adults: 6, maxOcc: 6 });
    const participants = ["Beat", "Carla", "Dario", "Eva", "Fritz"].map((n) => ({ firstName: n, lastName: "Gruppe", birthDate: "1990-01-01", nationality: "DE" }));
    await submitCheckin(booking.publicToken, { persons: [adult("Anna")], participants, confirm: true });
    const regs = await db().select().from(guestRegistrations).where(eq(guestRegistrations.bookingId, booking.id));
    expect(regs).toHaveLength(6);
    expect(regs.filter((r) => r.listOnly)).toHaveLength(5);
    // GL erlaubt keine Teilnehmerliste: dort muss jede Person ausgefüllt werden
    const gl = await hotelWithBooking({ adults: 6, maxOcc: 6 });
    await expect(submitCheckin(gl.booking.publicToken, { persons: [adult("Anna")], participants, confirm: true, signature: PNG })).rejects.toMatchObject({ code: "invalid" });
  });

  it("Export CSV enthält alle Pflichtfelder für den Zeitraum und steht im audit_log", async () => {
    const { hotel, booking } = await hotelWithBooking();
    await submitCheckin(booking.publicToken, { persons: [{ ...adult("Anna"), vehiclePlate: "GL 1234" }, adult("Beat", "1975-12-01")], confirm: true, signature: PNG });
    const list = await registerRows(hotel.id, booking.checkin, booking.checkin);
    expect(list).toHaveLength(2);
    const csv = registerCsv(list);
    for (const head of ["Nachname", "Vorname", "Geburtsdatum", "Nationalität", "Strasse", "PLZ", "Ort", "Land", "Ausweistyp", "Ausweisnummer", "Anreise", "Abreise", "Autokennzeichen"]) {
      expect(csv.split("\r\n")[0]).toContain(head);
    }
    expect(csv).toContain("1980-05-17");
    expect(csv).toContain("1975-12-01");
    expect(csv).toContain("C4234567");
    expect(csv).toContain("Identitätskarte");
    expect(csv).toContain(booking.checkin);
    expect(csv).toContain("GL 1234");
    // anderer Zeitraum: leer
    expect(await registerRows(hotel.id, addDays(booking.checkin, 1), addDays(booking.checkin, 9))).toHaveLength(0);

    await logRegisterExport(hotel.id, booking.checkin, booking.checkin, "csv", list.length, "user:x");
    const logs = await db().select().from(auditLog).where(and(eq(auditLog.hotelId, hotel.id), eq(auditLog.action, "guest.register_export")));
    expect(logs).toHaveLength(1);
    expect(logs[0].details).toMatchObject({ from: booking.checkin, to: booking.checkin, format: "csv", count: 2 });
    const regs = await db().select().from(guestRegistrations).where(eq(guestRegistrations.bookingId, booking.id));
    expect(regs.every((r) => r.exportedAt)).toBe(true);
  });

  it("Löschjob entfernt Einträge nach Ablauf, nicht vorher", async () => {
    const a = await hotelWithBooking();
    const b = await hotelWithBooking();
    for (const x of [a, b]) await submitCheckin(x.booking.publicToken, { persons: [adult("Anna"), adult("Beat")], confirm: true, signature: PNG });
    const now = new Date();
    const today = new Date(now.getTime()).toISOString().slice(0, 10);
    // a: Frist lief gestern ab → löschen; b: Frist ist heute → bleibt
    await db().update(guestRegistrations).set({ retentionUntil: addDays(today, -2) }).where(eq(guestRegistrations.bookingId, a.booking.id));
    await db().update(guestRegistrations).set({ retentionUntil: addDays(today, 1) }).where(eq(guestRegistrations.bookingId, b.booking.id));
    expect(await purgeExpiredRegistrations(now)).toBeGreaterThanOrEqual(2);
    expect(await db().select().from(guestRegistrations).where(eq(guestRegistrations.bookingId, a.booking.id))).toHaveLength(0);
    expect(await db().select().from(guestRegistrations).where(eq(guestRegistrations.bookingId, b.booking.id))).toHaveLength(2);
    const logs = await db().select().from(auditLog).where(and(eq(auditLog.hotelId, a.hotel.id), eq(auditLog.action, "guest.retention_purge")));
    expect(logs[0].details).toMatchObject({ deleted: 2 });
    // ein Tag später als die Frist von b: noch nicht (Frist = letzter Aufbewahrungstag)
    await purgeExpiredRegistrations(new Date(now.getTime() + 864e5));
    expect(await db().select().from(guestRegistrations).where(eq(guestRegistrations.bookingId, b.booking.id))).toHaveLength(2);
    await purgeExpiredRegistrations(new Date(now.getTime() + 3 * 864e5));
    expect(await db().select().from(guestRegistrations).where(eq(guestRegistrations.bookingId, b.booking.id))).toHaveLength(0);
  });

  it("Aufbewahrungsfrist: Abreise plus Jahre, 29. Februar wird 1. März", () => {
    expect(retentionUntil("2026-11-12", 5)).toBe("2031-11-12");
    expect(retentionUntil("2028-02-29", 3)).toBe("2031-03-01");
  });

  it("Check-in-Link: 7 Tage vor Anreise 10:00, bei späterer Buchung sofort, nur mit eingeschaltetem Modul", async () => {
    const soon = await hotelWithBooking({ checkin: inDays(3) });
    const later = await hotelWithBooking({ checkin: inDays(7) });
    const far = await hotelWithBooking({ checkin: inDays(20) });
    const off = await hotelWithBooking({ checkin: inDays(3), module: false });
    const now = new Date();
    await enqueueCheckinLinks(now);
    const mail = async (id: string) => (await db().select().from(emailOutbox).where(and(eq(emailOutbox.bookingId, id), eq(emailOutbox.template, "checkin_link"))))[0];
    expect((await mail(soon.booking.id)).sendAfter.getTime()).toBeLessThanOrEqual(now.getTime() + 1000);
    const l = await mail(later.booking.id);
    expect(l).toBeTruthy();
    expect(await mail(far.booking.id)).toBeUndefined();
    expect(await mail(off.booking.id)).toBeUndefined();
    // zweiter Lauf reiht nichts doppelt ein
    await enqueueCheckinLinks(now);
    expect((await db().select().from(emailOutbox).where(and(eq(emailOutbox.bookingId, soon.booking.id), eq(emailOutbox.template, "checkin_link"))))).toHaveLength(1);
  });

  it("Kurtaxe-Liste: Nächte im Monat, Alter aus Meldeschein, Portalbuchungen nach Buchung", async () => {
    const { hotel, booking } = await hotelWithBooking({ adults: 2, children: 2, ages: [10, 4] });
    await submitCheckin(booking.publicToken, {
      persons: [adult("Anna"), adult("Beat"), { ...adult("Tim", addDays(booking.checkin, -10 * 366)), sameAddress: true, docType: "", docNumber: "" }, { ...adult("Mia", addDays(booking.checkin, -4 * 366)), sameAddress: true, docType: "", docNumber: "" }],
      confirm: true, signature: PNG,
    });
    // Portalbuchung ohne Meldeschein im selben Hotel, 1 Erwachsener
    await db().insert(bookings).values({ hotelId: hotel.id, reference: `OTA-${booking.reference}`, publicToken: `ota-${booking.publicToken}`, source: "booking_com", status: "confirmed",
      checkin: booking.checkin, checkout: addDays(booking.checkin, 1), adults: 1, children: 0, confirmedAt: new Date() });
    const month = booking.checkin.slice(0, 7);
    const r = await touristTaxList(hotel, month);
    const mine = r.lines.find((l) => l.bookingId === booking.id)!;
    const nights = Math.min(2, Math.round((Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1) - Date.parse(booking.checkin)) / 864e5));
    expect(mine.fromRegister).toBe(true);
    expect(mine.nightsInMonth).toBe(nights);
    // GL: Erwachsene 4.40, Kind 10 Jahre 2.20, Kind 4 Jahre befreit
    expect(mine.liable).toBe(3);
    expect(mine.exempt).toBe(1);
    expect(mine.amountRappen).toBe((440 * 2 + 220) * nights);
    const ota = r.lines.find((l) => l.reference === `OTA-${booking.reference}`)!;
    expect(ota.fromRegister).toBe(false);
    expect(ota.liable).toBe(1);
    expect(ota.amountRappen).toBe(440);
  });

  it("Datenbank enthält kein Geburtsdatum im Klartext", async () => {
    const r = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM guest_registrations WHERE birth_date_enc LIKE '%1980%'`));
    expect(r[0].n).toBe(0);
  });
});
