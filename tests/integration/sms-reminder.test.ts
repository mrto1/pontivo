import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotelModules, hotels, posReservations, smsOutbox } from "../../src/db/schema";
import { todayIn, zonedToUtc } from "../../src/domain/dates";
import { smsReminderText } from "../../src/domain/reservations";
import { createReservation, getSettings, saveSettings, saveSmsReminder, smsReminderJob } from "../../src/services/reservations";
import { PosError } from "../../src/services/pos";
import { makeHotel } from "../helpers";

afterAll(closeDb);

/** Restaurant mit Reservation heute 19:00 (Betriebszeit); «jetzt» = 17:30 */
async function setup() {
  const h = await makeHotel({}, []);
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  await db().insert(hotelModules).values({ hotelId: hotel.id, module: "restaurant", enabled: true });
  await saveSettings(hotel.id, { onlineEnabled: true, windows: [{ from: "11:00", to: "22:00" }], durationMin: 90, maxParty: 8, capacity: 40, leadHours: 0, horizonDays: 30, depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 0, autoAssign: false }, "t");
  const day = todayIn(hotel.timezone);
  const { reservation } = await createReservation(hotel, { day, time: "19:00", party: 4, name: "Meier", phone: "079 123 45 67" }, "admin", "t");
  const now = zonedToUtc(day, "17:30", hotel.timezone);
  return { hotel, reservation, now };
}

describe("SMS-Erinnerung (SPEC 19.68)", () => {
  it("nur nach Zustimmung zu den Kosten, einmal je Reservation, als verrechenbare Gast-SMS", async () => {
    const { hotel, reservation, now } = await setup();
    // aus: nichts
    expect(await smsReminderJob(now)).toBe(0);
    // einschalten ohne Zustimmung geht nicht
    await expect(saveSmsReminder(hotel.id, { on: true, hours: 3, acceptCosts: false }, "t")).rejects.toThrow(PosError);
    await saveSmsReminder(hotel.id, { on: true, hours: 3, acceptCosts: true }, "t");
    const s = await getSettings(hotel.id);
    expect(s.smsReminder).toBe(true);
    expect(s.smsReminderAcceptedAt).toBeInstanceOf(Date);
    // 1,5 Std. vorher, Fenster 3 Std.: senden; zweiter Lauf: nicht nochmals
    expect(await smsReminderJob(now)).toBe(1);
    expect(await smsReminderJob(now)).toBe(0);
    const sms = await db().select().from(smsOutbox).where(eq(smsOutbox.hotelId, hotel.id));
    expect(sms).toHaveLength(1);
    expect(sms[0].kind).toBe("guest");
    expect(sms[0].billable).toBe(true);
    expect(sms[0].text).toContain("heute um 19:00");
    expect(sms[0].text).toContain(`/tisch/${reservation.publicToken}`);
    const [r] = await db().select().from(posReservations).where(eq(posReservations.id, reservation.id));
    expect(r.smsReminderSentAt).not.toBeNull();
    // Ausschalten behält die Zustimmung (erneutes Einschalten ohne Häkchen möglich)
    await saveSmsReminder(hotel.id, { on: false, hours: 3, acceptCosts: false }, "t");
    await saveSmsReminder(hotel.id, { on: true, hours: 2, acceptCosts: false }, "t");
    expect((await getSettings(hotel.id)).smsReminderHours).toBe(2);
  });

  it("zu früh oder ohne Telefonnummer: keine SMS", async () => {
    const { hotel, now } = await setup();
    await saveSmsReminder(hotel.id, { on: true, hours: 1, acceptCosts: true }, "t");
    expect(await smsReminderJob(now)).toBe(0); // 1,5 Std. vorher, Fenster 1 Std.
    await createReservation(hotel, { day: todayIn(hotel.timezone), time: "18:15", party: 2, name: "Ohne Telefon", email: "x@example.ch" }, "admin", "t");
    expect(await smsReminderJob(now)).toBe(0);
  });

  it("Text in der Sprache des Gastes, mit Datum, wenn nicht heute", () => {
    expect(smsReminderText({ hotelName: "Rössli", day: "2026-12-24", today: "2026-12-23", time: "19:30", party: 2, link: "https://x/t", language: "fr" })).toContain("le 24.12.");
    expect(smsReminderText({ hotelName: "Rössli", day: "2026-12-24", today: "2026-12-24", time: "19:30", party: 2, link: "https://x/t", language: "xx" })).toContain("heute um 19:30");
  });
});
