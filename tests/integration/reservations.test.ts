import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { emailOutbox, hotels } from "../../src/db/schema";
import { addDays, todayIn } from "../../src/domain/dates";
import { PosError, saveTable, saveTableDetails, saveTablePlan, listTables } from "../../src/services/pos";
import { assignTable, cancelByToken, createReservation, getSettings, reservationByToken, saveSettings, slotsFor } from "../../src/services/reservations";
import { makeHotel } from "../helpers";

afterAll(closeDb);

async function setup() {
  const h = await makeHotel({}, [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, basePriceRappen: 15000 }]);
  const [hotel] = await db().select().from(hotels).where(eq(hotels.id, h.hotel.id));
  const day = addDays(todayIn(hotel.timezone), 3);
  await saveSettings(hotel.id, { onlineEnabled: true, windows: [{ from: "18:00", to: "20:00" }], durationMin: 90, maxParty: 6, capacity: 10, leadHours: 0, horizonDays: 30 }, "t");
  return { hotel, day };
}

describe("Tischreservierung (SPEC 19.49 C)", () => {
  it("online reservieren, Mail, Kapazität, Gruppengrösse, Storno per Link", async () => {
    const { hotel, day } = await setup();
    const r = await createReservation(hotel, { day, time: "18:00", party: 4, name: "Meier", email: "meier@example.ch" }, "online", "guest");
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
    const r1 = await createReservation(a.hotel, { day: a.day, time: "18:00", party: 2, name: "A", tableId: t.id }, "admin", "t");
    await expect(createReservation(a.hotel, { day: a.day, time: "19:00", party: 2, name: "B", tableId: t.id }, "admin", "t")).rejects.toThrow(/schon reserviert/);
    const r2 = await createReservation(a.hotel, { day: a.day, time: "19:30", party: 2, name: "C" }, "admin", "t");
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
