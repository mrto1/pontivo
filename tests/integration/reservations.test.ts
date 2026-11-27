import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { emailOutbox, hotels } from "../../src/db/schema";
import { addDays, todayIn } from "../../src/domain/dates";
import { PosError, saveTable, saveTableDetails, saveTablePlan, listTables } from "../../src/services/pos";
import { assignTable, autoAssignDay, cancelByToken, cancelUnpaid, createReservation, getSettings, joinWaitlist, markReservationPaid, notifyWaitlist, reservationByToken, reservationsOfDay, saveSettings, slotsFor, tableJob, waitlistOfDay } from "../../src/services/reservations";
import { FakePaymentProvider } from "../../src/payments/fake";
import { setPaymentProvider } from "../../src/payments/provider";
import { posReservations, hotels as hotelsTable } from "../../src/db/schema";
import { hotelModules as hotelModulesT } from "../../src/db/schema";
import { makeHotel } from "../helpers";

afterAll(closeDb);

async function setup() {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, basePriceRappen: 15000 }]);
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  const day = addDays(todayIn(hotel.timezone), 3);
  await db().insert(hotelModulesT).values({ hotelId: hotel.id, module: "restaurant", enabled: true }); // SPEC 20.2: Online braucht das Modul
  await saveSettings(hotel.id, { onlineEnabled: true, windows: [{ from: "18:00", to: "20:00" }], durationMin: 90, maxParty: 6, capacity: 10, leadHours: 0, horizonDays: 30, depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 24, autoAssign: true }, "t");
  return { hotel, day };
}

describe("Tischreservation (SPEC 19.49 C)", () => {
  it("online reservieren, Mail, Kapazität, Gruppengrösse, Storno per Link", async () => {
    const { hotel, day } = await setup();
    const r = (await createReservation(hotel, { day, time: "18:00", party: 4, name: "Meier", email: "meier@example.ch" }, "online", "guest")).reservation;
    expect(r.status).toBe("confirmed");
    const mails = await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, hotel.id), eq(emailOutbox.template, "table_reserved")));
    expect(mails).toHaveLength(1);
    expect(mails[0].toEmail).toBe("meier@example.ch");
    await createReservation(hotel, { day, time: "18:30", party: 6, name: "Huber", phone: "079 111" }, "online", "guest"); // 4 + 6 = 10
    await expect(createReservation(hotel, { day, time: "19:00", party: 2, name: "Zu viel", phone: "1" }, "online", "guest")).rejects.toThrow(/nicht mehr frei/);
    await expect(createReservation(hotel, { day, time: "20:00", party: 7, name: "Gross", phone: "1" }, "online", "guest")).rejects.toThrow(/anrufen/);
    await expect(createReservation(hotel, { day, time: "17:00", party: 2, name: "Früh", phone: "1" }, "online", "guest")).rejects.toThrow(/nicht mehr frei/); // ausserhalb Fenster
    await expect(createReservation(hotel, { day, time: "20:00", party: 2, name: "Ohne Kontakt" }, "online", "guest")).rejects.toThrow(/E-Mail oder Telefon/);
    // intern darf überbucht werden
    await createReservation(hotel, { day, time: "19:00", party: 4, name: "Stammgast" }, "admin", "chef");
    expect((await slotsFor(hotel, day, 2)).find((x) => x.time === "19:00")!.ok).toBe(false);
    await cancelByToken(r.publicToken);
    expect((await reservationByToken(r.publicToken))!.status).toBe("cancelled");
    await expect(cancelByToken(r.publicToken)).rejects.toBeInstanceOf(PosError);
  });

  it("Online aus: keine Zeiten, keine Buchung; Einstellungen prüfen", async () => {
    const { hotel, day } = await setup();
    await saveSettings(hotel.id, { ...(await getSettings(hotel.id)), onlineEnabled: false }, "t");
    expect(await slotsFor(hotel, day, 2)).toEqual([]);
    await expect(createReservation(hotel, { day, time: "18:00", party: 2, name: "X", phone: "1" }, "online", "guest")).rejects.toBeInstanceOf(PosError);
    await expect(saveSettings(hotel.id, { ...(await getSettings(hotel.id)), windows: [{ from: "20:00", to: "18:00" }] }, "t")).rejects.toThrow(/vor/);
  });

  it("Tisch zuweisen: Kollision, Mandantentrennung; Plan speichern", async () => {
    const a = await setup(), b = await setup();
    const t = await saveTable(a.hotel.id, "Tisch 1", "t");
    const r1 = (await createReservation(a.hotel, { day: a.day, time: "18:00", party: 2, name: "A", tableId: t.id }, "admin", "t")).reservation;
    await expect(createReservation(a.hotel, { day: a.day, time: "19:00", party: 2, name: "B", tableId: t.id }, "admin", "t")).rejects.toThrow(/schon reserviert/);
    const r2 = (await createReservation(a.hotel, { day: a.day, time: "19:30", party: 2, name: "C" }, "admin", "t")).reservation;
    await assignTable(a.hotel.id, r2.id, t.id, "t"); // 19:30 beginnt nach Ende 18:00+90
    await assignTable(a.hotel.id, r1.id, null, "t");
    await expect(assignTable(b.hotel.id, r2.id, t.id, "t")).rejects.toThrow(/nicht gefunden/); // fremder Betrieb
    await saveTableDetails(a.hotel.id, t.id, { seats: 6, shape: "round" }, "t");
    await saveTablePlan(a.hotel.id, [{ id: t.id, x: 250, y: 400 }], "t");
    const [tt] = await listTables(a.hotel.id);
    expect(tt).toMatchObject({ seats: 6, shape: "round", planX: 250, planY: 400 });
    await expect(saveTablePlan(a.hotel.id, [{ id: t.id, x: 2000, y: 1 }], "t")).rejects.toThrow(/ungültig/);
    await expect(saveTablePlan(a.hotel.id, [{ id: t.id, x: 5, y: null }], "t")).rejects.toThrow(/ungültig/);
  });
});

describe("Anzahlung, Warteliste, Erinnerung, Zuteilung (SPEC 19.49 C2)", () => {
  const fake = new FakePaymentProvider();
  class Slow extends FakePaymentProvider { readonly confirmsImmediately = false as never; async createPaymentCheckout() { return { url: "https://pay.example/x", sessionId: "cs_test_1" }; } }

  /** Betrieb mit (Test-)Stripe-Konto; Zeile frisch lesen */
  async function withStripe(h: typeof hotelsTable.$inferSelect) {
    const [u] = await db().update(hotelsTable).set({ stripeAccountId: `acct_${crypto.randomUUID().slice(0, 12)}` }).where(eq(hotelsTable.id, h.id)).returning();
    return u;
  }

  it("Anzahlung online: Zahlungsseite, erst nach Zahlung bestätigt, Mail danach; Storno rechtzeitig erstattet", async () => {
    const s0 = await setup();
    const hotel = await withStripe(s0.hotel), day = s0.day;
    await saveSettings(hotel.id, { ...(await getSettings(hotel.id)), depositPerPersonRappen: 1000, depositFromParty: 4 }, "t");
    setPaymentProvider(new Slow());
    try {
      const c = await createReservation(hotel, { day, time: "18:00", party: 4, name: "Gruppe", email: "g@example.ch" }, "online", "guest");
      expect(c.checkoutUrl).toBe("https://pay.example/x");
      expect(c.reservation).toMatchObject({ status: "pending", depositRappen: 4000, depositStatus: "pending" });
      expect(await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, hotel.id), eq(emailOutbox.template, "table_reserved")))).toHaveLength(0);
      expect((await slotsFor(hotel, day, 7)).length).toBe(0); // grösser als maxParty
      await markReservationPaid(c.reservation.id, { sessionId: "cs_test_1", paymentIntentId: "pi_1" });
      await markReservationPaid(c.reservation.id, { sessionId: "cs_test_1", paymentIntentId: "pi_1" }); // zweimal unschädlich
      expect(await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, hotel.id), eq(emailOutbox.template, "table_reserved")))).toHaveLength(1);
      expect((await reservationByToken(c.reservation.publicToken))).toMatchObject({ status: "confirmed", depositStatus: "paid", stripePaymentIntentId: "pi_1" });
      const fp = new FakePaymentProvider(); setPaymentProvider(fp);
      const out = await cancelByToken(c.reservation.publicToken); // Tag liegt 3 Tage voraus, Gratis-Storno bis 24 h
      expect(out.refunded).toBe(true);
      expect(fp.refunds).toHaveLength(1);
      expect(fp.refunds[0]).toMatchObject({ paymentIntentId: "pi_1", amountRappen: 4000 });
    } finally { setPaymentProvider(null); }
  });

  it("späte Storno behält die Anzahlung; nicht bezahlt wird freigegeben; Zahlung nach Ablauf wird erstattet", async () => {
    const hotel = await withStripe((await setup()).hotel);
    const today = todayIn(hotel.timezone);
    await saveSettings(hotel.id, { ...(await getSettings(hotel.id)), depositPerPersonRappen: 500, depositFromParty: 2, cancelHours: 168, leadHours: 0, windows: [{ from: "00:00", to: "23:30" }] }, "t");
    setPaymentProvider(new Slow());
    try {
      const day = addDays(today, 2);
      const c = await createReservation(hotel, { day, time: "19:00", party: 2, name: "Spät", email: "s@example.ch" }, "online", "guest");
      await markReservationPaid(c.reservation.id, { sessionId: "cs", paymentIntentId: "pi_2" });
      const fp = new FakePaymentProvider(); setPaymentProvider(fp);
      const out = await cancelByToken(c.reservation.publicToken); // 168 h Frist, Termin in < 168 h → keine Erstattung
      expect(out.refunded).toBe(false);
      expect(fp.refunds).toHaveLength(0);
      expect((await reservationByToken(c.reservation.publicToken))!.depositStatus).toBe("paid");

      setPaymentProvider(new Slow());
      const c2 = await createReservation(hotel, { day, time: "20:00", party: 2, name: "Offen", email: "o@example.ch" }, "online", "guest");
      await cancelUnpaid(c2.reservation.id);
      expect((await reservationByToken(c2.reservation.publicToken))!.status).toBe("cancelled");
      const fp2 = new FakePaymentProvider(); setPaymentProvider(fp2);
      await markReservationPaid(c2.reservation.id, { sessionId: "cs2", paymentIntentId: "pi_3" }); // zu spät bezahlt
      expect(fp2.refunds[0]).toMatchObject({ paymentIntentId: "pi_3", amountRappen: 1000 });
      expect((await reservationByToken(c2.reservation.publicToken))!.depositStatus).toBe("refunded");
    } finally { setPaymentProvider(null); }
  });

  it("Anzahlung braucht Stripe-Konto", async () => {
    const { hotel } = await setup();
    await expect(saveSettings(hotel.id, { ...(await getSettings(hotel.id)), depositPerPersonRappen: 500 }, "t")).rejects.toThrow(/Stripe/);
  });

  it("Warteliste: Eintrag, Benachrichtigung bei Storno, nur einmal", async () => {
    const { hotel, day } = await setup();
    await saveSettings(hotel.id, { ...(await getSettings(hotel.id)), capacity: 4 }, "t");
    const full = (await createReservation(hotel, { day, time: "18:00", party: 4, name: "Voll", phone: "1" }, "online", "guest")).reservation;
    expect((await slotsFor(hotel, day, 2)).filter((x) => x.ok && x.time <= "19:00")).toHaveLength(0);
    await saveSettings(hotel.id, { ...(await getSettings(hotel.id)), windows: [{ from: "18:00", to: "19:00" }], capacity: 4 }, "t");
    expect((await slotsFor(hotel, day, 2)).some((x) => x.ok)).toBe(false);
    await joinWaitlist(hotel, { day, party: 2, name: "Wartet", email: "w@example.ch" });
    await joinWaitlist(hotel, { day, party: 2, name: "Wartet", email: "w@example.ch" }); // doppelt
    expect(await waitlistOfDay(hotel.id, day)).toHaveLength(1);
    expect(await notifyWaitlist(hotel.id, day)).toBe(0); // noch voll
    await cancelByToken(full.publicToken); // Storno benachrichtigt von selbst
    const mails = await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, hotel.id), eq(emailOutbox.template, "table_waitlist")));
    expect(mails).toHaveLength(1);
    expect(await notifyWaitlist(hotel.id, day)).toBe(0); // nur einmal
  });

  it("Erinnerung: einmal, nur im Zeitfenster; unbezahlte Altlasten frei", async () => {
    const s0 = await setup();
    const hotel = s0.hotel, day = addDays(todayIn(hotel.timezone), 2);
    await saveSettings(hotel.id, { ...(await getSettings(hotel.id)), reminderHours: 72 }, "t");
    const r = (await createReservation(hotel, { day, time: "19:00", party: 2, name: "Erinnerung", email: "e@example.ch" }, "online", "guest")).reservation;
    const res1 = await tableJob();
    expect(res1.reminders).toBeGreaterThanOrEqual(1);
    const mails = await db().select().from(emailOutbox).where(and(eq(emailOutbox.hotelId, hotel.id), eq(emailOutbox.template, "table_reminder")));
    expect(mails).toHaveLength(1);
    expect((await tableJob()).reminders).toBe(0);
    expect((await reservationByToken(r.publicToken))!.reminderSentAt).not.toBeNull();
    // alte unbezahlte Reservation wird freigegeben
    await db().update(posReservations).set({ status: "pending", depositStatus: "pending", createdAt: new Date(Date.now() - 60 * 60_000) }).where(eq(posReservations.id, r.id));
    expect((await tableJob()).released).toBeGreaterThanOrEqual(1);
    expect((await reservationByToken(r.publicToken))!.status).toBe("cancelled");
  });

  it("automatische Zuteilung: online und für den Tag", async () => {
    const { hotel, day } = await setup();
    const small = await saveTable(hotel.id, "Klein", "t"), big = await saveTable(hotel.id, "Gross", "t");
    await saveTableDetails(hotel.id, small.id, { seats: 2, shape: "round" }, "t");
    await saveTableDetails(hotel.id, big.id, { seats: 6, shape: "square" }, "t");
    const a = (await createReservation(hotel, { day, time: "18:00", party: 2, name: "Zwei", phone: "1" }, "online", "guest")).reservation;
    const b = (await createReservation(hotel, { day, time: "18:00", party: 4, name: "Vier", phone: "1" }, "online", "guest")).reservation;
    expect(a.tableId).toBe(small.id);
    expect(b.tableId).toBe(big.id);
    await saveSettings(hotel.id, { ...(await getSettings(hotel.id)), autoAssign: false }, "t");
    const c = (await createReservation(hotel, { day, time: "19:30", party: 2, name: "Manuell", phone: "1" }, "online", "guest")).reservation;
    expect(c.tableId).toBeNull();
    expect(await autoAssignDay(hotel.id, day, "t")).toBe(1);
    expect((await reservationsOfDay(hotel.id, day)).find((x) => x.id === c.id)!.tableId).toBe(small.id);
  });
});
