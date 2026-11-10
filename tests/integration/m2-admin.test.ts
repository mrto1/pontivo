import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, closeDb } from "../../src/db/client";
import { emailOutbox, hotels } from "../../src/db/schema";
import { atLeast, consumeLoginToken, createSessionValue, hotelsForUser, readSessionValue, requestLoginLink, roleIn } from "../../src/auth/session";
import { createUser } from "../../src/services/setup";
import { listBookings, bookingDetail } from "../../src/services/admin-bookings";
import { createDirectBooking, markNoShow, cancelBooking } from "../../src/services/bookings";
import { confirmTouristTax, goLiveProblems, setHotelStatus } from "../../src/services/settings";
import { searchOffers } from "../../src/services/search";
import { sendDueEmails, setMailer } from "../../src/email/send";
import { addDays } from "../../src/domain/dates";
import { guest, inDays, makeHotel, uid } from "../helpers";

afterAll(async () => {
  setMailer(null);
  await closeDb();
});

describe("Magic-Link-Login", () => {
  it("Token ist einmalig und 15 Minuten gültig", async () => {
    const u = await createUser(`login-${uid()}@example.ch`);
    const link = await requestLoginLink(u.email);
    expect(link).toMatch(/\/api\/auth\/callback\?token=/);
    const token = new URL(link!).searchParams.get("token")!;
    expect(await consumeLoginToken(token)).toBe(u.id);
    expect(await consumeLoginToken(token)).toBeNull(); // zweites Mal
    const link2 = await requestLoginLink(u.email);
    const t2 = new URL(link2!).searchParams.get("token")!;
    expect(await consumeLoginToken(t2, new Date(Date.now() + 16 * 60_000))).toBeNull(); // abgelaufen
    expect(await requestLoginLink("unbekannt@example.ch")).toBeNull();
    const mails = await db().select().from(emailOutbox).where(eq(emailOutbox.toEmail, u.email));
    expect(mails.every((m) => m.template === "login_link")).toBe(true);
  });

  it("Session-Cookie ist signiert und läuft ab", () => {
    const v = createSessionValue("11111111-1111-1111-1111-111111111111");
    expect(readSessionValue(v)).toBe("11111111-1111-1111-1111-111111111111");
    expect(readSessionValue(v.replace("1111", "2222"))).toBeNull();
    expect(readSessionValue(v, Date.now() + 31 * 86400_000)).toBeNull();
    expect(readSessionValue("kaputt")).toBeNull();
  });
});

describe("Admin-Mandantentrennung und Rollen", () => {
  it("Mitglied von Hotel A hat keinen Zugriff auf Hotel B", async () => {
    const a = await makeHotel();
    const b = await makeHotel();
    const u = await createUser(`owner-${uid()}@example.ch`, { hotelId: a.hotel.id, role: "owner" });
    expect(await roleIn(u.id, a.hotel.id)).toBe("owner");
    expect(await roleIn(u.id, b.hotel.id)).toBeNull();
    const visible = (await hotelsForUser(u.id)).map((x) => x.hotel.id);
    expect(visible).toEqual([a.hotel.id]);

    // Buchung bei B ist über A nicht sichtbar
    const d = inDays(15);
    const { booking } = await createDirectBooking(b.hotel, { roomTypeId: b.rooms[0].roomType.id, ratePlanId: b.rooms[0].plans[0].id, checkin: d, checkout: addDays(d, 1), adults: 2, children: 0, childrenAges: [], guest });
    expect(await bookingDetail(a.hotel.id, booking.id)).toBeNull();
    expect((await listBookings(a.hotel.id, {})).some((r) => r.b.id === booking.id)).toBe(false);
    expect((await listBookings(b.hotel.id, {})).some((r) => r.b.id === booking.id)).toBe(true);
    await expect(cancelBooking(booking.id, { by: "hotel", actor: "x", hotelId: a.hotel.id })).rejects.toMatchObject({ httpStatus: 404 });
    await expect(markNoShow(a.hotel.id, booking.id, "x")).rejects.toMatchObject({ httpStatus: 404 });
  });

  it("Rollenrangfolge", () => {
    expect(atLeast("owner", "manager")).toBe(true);
    expect(atLeast("staff", "manager")).toBe(false);
    expect(atLeast(null, "staff")).toBe(false);
  });

  it("Plattform-Admin sieht alle Hotels", async () => {
    // unabhängig von der Reihenfolge der Testdateien: mindestens drei Hotels anlegen
    await Promise.all([makeHotel(), makeHotel(), makeHotel()]);
    const u = await createUser(`pa-${uid()}@example.ch`, { platformAdmin: true });
    expect((await hotelsForUser(u.id)).length).toBeGreaterThan(2);
  });

  it("No-Show frühestens am Tag nach Anreise", async () => {
    const h = await makeHotel();
    const d = inDays(0);
    const { booking } = await createDirectBooking(h.hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin: d, checkout: addDays(d, 1), adults: 2, children: 0, childrenAges: [], guest });
    await expect(markNoShow(h.hotel.id, booking.id, "x")).rejects.toMatchObject({ code: "too_early" });
    await markNoShow(h.hotel.id, booking.id, "x", new Date(Date.now() + 2 * 86400_000));
    const [b] = (await listBookings(h.hotel.id, {})).map((r) => r.b);
    expect(b.status).toBe("no_show");
  });
});

describe("Kurtaxe bestätigen und live schalten", () => {
  it("Gemeinde mit unbestätigtem Satz: erst nach Bestätigung live und buchbar", async () => {
    const h = await makeHotel({ canton: "AR", municipality: "Hundwil", status: "draft" });
    expect(await goLiveProblems(h.hotel)).toContain("Kurtaxe-Satz für die Gemeinde ist nicht bestätigt.");
    await expect(setHotelStatus(h.hotel, "live", "x")).rejects.toThrow();
    await confirmTouristTax(h.hotel, { adultRappen: 150, reducedRappen: null, freeUnderAge: 12, reducedUnderAge: null }, "user:x");
    expect(await goLiveProblems(h.hotel)).toEqual([]);
    await setHotelStatus(h.hotel, "live", "x");
    const [fresh] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
    const d = inDays(5);
    const r = await searchOffers(fresh, { checkin: d, checkout: addDays(d, 2), adults: 2, children: 1, childrenAges: [8] });
    expect(r.ok && r.offers[0].touristTaxRappen).toBe(150 * 2 * 2);
  });
});

describe("E-Mail-Outbox", () => {
  it("sendet fällige E-Mails einmal, wiederholt Fehler bis 3×", async () => {
    const h = await makeHotel();
    const d = inDays(25);
    const email = `mail-${uid()}@example.ch`;
    await createDirectBooking(h.hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin: d, checkout: addDays(d, 2), adults: 2, children: 0, childrenAges: [], guest: { ...guest, email } });
    const sent: { to: string; subject: string; text: string }[] = [];
    setMailer(async (m) => { sent.push(m); });
    // hohes Limit: die Test-Datenbank enthält auch Mails anderer Tests
    await sendDueEmails(new Date(), 100_000);
    // nur Mails dieses Tests (an den Gast oder ans Hotel)
    const mine = sent.filter((m) => m.to === email || m.to === h.hotel.contactEmail);
    const subjects = mine.map((m) => m.subject);
    expect(subjects.some((s) => s.startsWith("Buchungsbestätigung"))).toBe(true);
    expect(subjects.some((s) => s.startsWith("Neue Buchung"))).toBe(true);
    expect(subjects.some((s) => s.startsWith("Bald ist es so weit"))).toBe(false); // pre_arrival erst 3 Tage vorher
    const confirm = mine.find((m) => m.subject.startsWith("Buchungsbestätigung"))!;
    expect(confirm.text).toContain("Kurtaxe");
    expect(confirm.text).toContain("/b/");
    const n = sent.length;
    await sendDueEmails(new Date(), 100_000);
    expect(sent.length).toBe(n);

    // Fehler: 3 Versuche, dann failed
    const preArrival = new Date(Date.now() + 30 * 86400_000);
    setMailer(async () => { throw new Error("SMTP kaputt"); });
    let r = await sendDueEmails(preArrival, 100_000);
    expect(r.failed).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) r = await sendDueEmails(new Date(preArrival.getTime() + (i + 1) * 3600_000), 100_000);
    // nur Mails dieses Tests prüfen (die Test-Datenbank enthält auch Mails anderer Tests)
    const failed = await db().select().from(emailOutbox).where(and(eq(emailOutbox.status, "failed"), eq(emailOutbox.hotelId, h.hotel.id)));
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((f) => f.attempts === 3)).toBe(true);
  });
});
