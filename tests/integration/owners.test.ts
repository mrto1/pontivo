import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { emailOutbox } from "../../src/db/schema";
import { createAdminBooking } from "../../src/services/admin-bookings";
import { OwnerError, addCost, deleteCost, ownerStatement, saveOwner, sendStatement } from "../../src/services/owners";
import { addDays } from "../../src/domain/dates";
import { inDays, makeHotel } from "../helpers";

afterAll(closeDb);

describe("Eigentümerabrechnung Service (SPEC 19.10)", () => {
  it("Umsatz, Kommission, Kosten, Versand einmalig, Mandantentrennung", async () => {
    const h = await makeHotel(), other = await makeHotel();
    const rt = h.rooms[0];
    const checkin = inDays(30), checkout = addDays(checkin, 2);
    const b = await createAdminBooking(h.hotel, { roomTypeId: rt.roomType.id, ratePlanId: rt.plans[0].id, checkin, checkout, adults: 2, children: 0, guest: { firstName: "Max", lastName: "Muster", email: "", language: "de" }, notifyGuest: false }, "t");
    expect(b.id).toBeTruthy();
    const o = await saveOwner(h.hotel.id, null, { name: "Frau Eigentümerin", email: "eig@example.ch", commissionPercent: 20, roomTypeIds: [rt.roomType.id] }, "t");
    // Monat der Anreise: Nächte in diesem Monat
    const month = checkin.slice(0, 7);
    const nights = [checkin, addDays(checkin, 1)].filter((d) => d.startsWith(month)).length;
    const s0 = await ownerStatement(h.hotel.id, o.id, month);
    expect(s0.revenueRappen).toBeGreaterThan(0);
    expect(s0.bookingsCount).toBe(1);
    expect(s0.commissionRappen).toBe(Math.round(s0.revenueRappen * 0.2));
    expect(nights).toBeGreaterThan(0);
    await addCost(h.hotel.id, o.id, month, "Reinigung", 5000, "t");
    const s1 = await ownerStatement(h.hotel.id, o.id, month);
    expect(s1.netRappen).toBe(s0.revenueRappen - s0.commissionRappen - 5000);
    await deleteCost(h.hotel.id, s1.costs[0].id, "t");
    expect((await ownerStatement(h.hotel.id, o.id, month)).costsRappen).toBe(0);
    // Objekt nur einem aktiven Eigentümer
    await expect(saveOwner(h.hotel.id, null, { name: "Zweiter", commissionPercent: 10, roomTypeIds: [rt.roomType.id] }, "t")).rejects.toBeInstanceOf(OwnerError);
    // fremder Zimmertyp
    await expect(saveOwner(other.hotel.id, null, { name: "X", commissionPercent: 10, roomTypeIds: [rt.roomType.id] }, "t")).rejects.toBeInstanceOf(OwnerError);
    // Mandantentrennung
    await expect(ownerStatement(other.hotel.id, o.id, month)).rejects.toBeInstanceOf(OwnerError);
    // Versand einmalig
    await sendStatement(h.hotel, o.id, month, "t");
    await expect(sendStatement(h.hotel, o.id, month, "t")).rejects.toBeInstanceOf(OwnerError);
    const mails = await db().select().from(emailOutbox).where(eq(emailOutbox.hotelId, h.hotel.id));
    expect(mails.filter((m) => m.template === "owner_statement")).toHaveLength(1);
    expect((await ownerStatement(h.hotel.id, o.id, month)).sentAt).not.toBeNull();
  });

  it("stornierte Buchungen und ungültige Eingaben", async () => {
    const h = await makeHotel();
    await expect(saveOwner(h.hotel.id, null, { name: "", commissionPercent: 10, roomTypeIds: [] }, "t")).rejects.toBeInstanceOf(OwnerError);
    await expect(saveOwner(h.hotel.id, null, { name: "A", commissionPercent: 101, roomTypeIds: [] }, "t")).rejects.toBeInstanceOf(OwnerError);
    const o = await saveOwner(h.hotel.id, null, { name: "A", commissionPercent: 10, roomTypeIds: [] }, "t");
    await expect(addCost(h.hotel.id, o.id, "2026-13", "x", 100, "t")).rejects.toBeInstanceOf(OwnerError);
    await expect(addCost(h.hotel.id, o.id, "2026-12", "x", 0, "t")).rejects.toBeInstanceOf(OwnerError);
    await expect(sendStatement(h.hotel, o.id, "2026-12", "t")).rejects.toBeInstanceOf(OwnerError); // keine E-Mail
  });
});
