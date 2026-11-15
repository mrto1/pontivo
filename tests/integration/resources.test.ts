import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { folioItems } from "../../src/db/schema";
import { createAdminBooking } from "../../src/services/admin-bookings";
import { ResourceError, cancelResourceBooking, createResourceBooking, listDay, saveResource } from "../../src/services/resources";
import { createInvoiceDraft } from "../../src/services/invoicing";
import { addDays } from "../../src/domain/dates";
import { inDays, makeHotel } from "../helpers";

afterAll(closeDb);
const def = { name: "Sauna", kind: "wellness" as const, capacity: 4, slotMinutes: 60, openFrom: "10:00", openTo: "20:00", priceRappen: 2000, pricePerPerson: true, vatKind: "standard" as const };

describe("Angebote vor Ort Service (SPEC 19.11)", () => {
  it("Plätze, Raster, Mandantentrennung", async () => {
    const h = await makeHotel(), other = await makeHotel();
    const r = await saveResource(h.hotel.id, null, def, "t");
    const day = inDays(5);
    const b = (persons: number, start = "10:00", end = "11:00", name = "Gast") => createResourceBooking(h.hotel.id, { resourceId: r.id, day, start, end, persons, guestName: name }, "t");
    await b(3);
    await expect(b(2)).rejects.toBeInstanceOf(ResourceError); // nur 1 frei
    await b(1); // genau voll
    await expect(b(1)).rejects.toBeInstanceOf(ResourceError);
    await b(4, "11:00", "12:00");
    await expect(b(1, "10:30", "11:30")).rejects.toBeInstanceOf(ResourceError); // Raster
    await expect(b(5, "13:00", "14:00")).rejects.toBeInstanceOf(ResourceError); // mehr als Plätze
    await expect(b(1, "09:00", "10:00")).rejects.toBeInstanceOf(ResourceError); // vor Öffnung
    await expect(createResourceBooking(h.hotel.id, { resourceId: r.id, day, start: "13:00", end: "14:00", persons: 1, guestName: "" }, "t")).rejects.toBeInstanceOf(ResourceError); // Name fehlt
    expect(await listDay(h.hotel.id, day)).toHaveLength(3);
    expect(await listDay(other.hotel.id, day)).toHaveLength(0);
    await expect(createResourceBooking(other.hotel.id, { resourceId: r.id, day, start: "13:00", end: "14:00", persons: 1, guestName: "X" }, "t")).rejects.toBeInstanceOf(ResourceError);
  });

  it("gleichzeitige Buchungen überbuchen nicht", async () => {
    const h = await makeHotel();
    const r = await saveResource(h.hotel.id, null, { ...def, capacity: 2 }, "t");
    const day = inDays(6);
    const res = await Promise.allSettled([1, 2, 3, 4].map((i) => createResourceBooking(h.hotel.id, { resourceId: r.id, day, start: "10:00", end: "11:00", persons: 1, guestName: `G${i}` }, "t")));
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(2);
  });

  it("Seminarraum ist exklusiv", async () => {
    const h = await makeHotel();
    const r = await saveResource(h.hotel.id, null, { ...def, name: "Saal", kind: "seminar", capacity: 30, priceRappen: 15000, pricePerPerson: false }, "t");
    const day = inDays(7);
    await createResourceBooking(h.hotel.id, { resourceId: r.id, day, start: "10:00", end: "11:00", persons: 5, guestName: "Firma" }, "t");
    await expect(createResourceBooking(h.hotel.id, { resourceId: r.id, day, start: "10:00", end: "11:00", persons: 5, guestName: "Andere" }, "t")).rejects.toBeInstanceOf(ResourceError);
  });

  it("Posten aufs Zimmer, Storno entfernt ihn, nach Rechnung nicht mehr", async () => {
    const h = await makeHotel();
    const r = await saveResource(h.hotel.id, null, def, "t");
    const checkin = inDays(10);
    const bk = await createAdminBooking(h.hotel, { roomTypeId: h.rooms[0].roomType.id, ratePlanId: h.rooms[0].plans[0].id, checkin, checkout: addDays(checkin, 2), adults: 2, children: 0, guest: { firstName: "Max", lastName: "Muster", email: "", language: "de" }, notifyGuest: false }, "t");
    const rb = await createResourceBooking(h.hotel.id, { resourceId: r.id, day: checkin, start: "10:00", end: "12:00", persons: 2, guestName: "", bookingReference: bk.reference.toLowerCase() }, "t");
    expect(rb.guestName).toBe("Max Muster");
    expect(rb.priceRappen).toBe(2 * 2000 * 2);
    const items = await db().select().from(folioItems).where(eq(folioItems.bookingId, bk.id));
    expect(items).toHaveLength(1);
    expect(items[0].unitPriceRappen).toBe(8000);
    await cancelResourceBooking(h.hotel.id, rb.id, "t");
    expect(await db().select().from(folioItems).where(eq(folioItems.bookingId, bk.id))).toHaveLength(0);
    expect(await listDay(h.hotel.id, checkin)).toHaveLength(0);
    // zweite Buchung, dann Rechnung → Storno gesperrt
    const rb2 = await createResourceBooking(h.hotel.id, { resourceId: r.id, day: checkin, start: "10:00", end: "11:00", persons: 1, guestName: "", bookingReference: bk.reference }, "t");
    await createInvoiceDraft(h.hotel, bk.id, "t");
    await expect(cancelResourceBooking(h.hotel.id, rb2.id, "t")).rejects.toBeInstanceOf(ResourceError);
    await expect(createResourceBooking(h.hotel.id, { resourceId: r.id, day: checkin, start: "12:00", end: "13:00", persons: 1, guestName: "", bookingReference: "ZZZZZZ" }, "t")).rejects.toBeInstanceOf(ResourceError);
    void and;
  });

  it("Angebot prüfen", async () => {
    const h = await makeHotel();
    await expect(saveResource(h.hotel.id, null, { ...def, name: "" }, "t")).rejects.toBeInstanceOf(ResourceError);
    await expect(saveResource(h.hotel.id, null, { ...def, openFrom: "20:00", openTo: "10:00" }, "t")).rejects.toBeInstanceOf(ResourceError);
    await expect(saveResource(h.hotel.id, null, { ...def, slotMinutes: 10 }, "t")).rejects.toBeInstanceOf(ResourceError);
  });
});
