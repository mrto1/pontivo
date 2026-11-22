import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { hotelModules, hotels, inquiries, users } from "../../src/db/schema";
import { addDays, todayIn } from "../../src/domain/dates";
import { createReservation, getSettings, saveSettings } from "../../src/services/reservations";
import { markSeen, openTaskCounts, unseenCounts } from "../../src/services/unseen";
import { makeHotel, uid } from "../helpers";

const newUser = async () => (await db().insert(users).values({ email: `u-${uid()}@example.ch` }).returning())[0].id;

afterAll(closeDb);

describe("Ungesehenes je Person (SPEC 20.1)", () => {
  it("zählt nur, was nach dem letzten Öffnen eingegangen ist; je Person getrennt; je Betrieb getrennt", async () => {
    const a = await makeHotel();
    const b = await makeHotel();
    await db().insert(hotelModules).values({ hotelId: a.hotel.id, module: "restaurant", enabled: true });
    await saveSettings(a.hotel.id, { ...(await getSettings(a.hotel.id)), onlineEnabled: true, leadHours: 0, windows: [{ from: "18:00", to: "21:00" }] }, "t");
    const [h] = await db().select().from(hotels).where(eq(hotels.id, a.hotel.id));
    const day = addDays(todayIn(h.timezone), 3);
    const p1 = await newUser();
    const p2 = await newUser();

    // erster Blick legt «jetzt» als gesehen an: keine Altlast
    expect(await unseenCounts(p1, a.hotel.id, ["reservations", "inbox"])).toEqual({ reservations: 0, inbox: 0 });
    await new Promise((r) => setTimeout(r, 20));

    await createReservation(h, { day, time: "18:00", party: 2, name: "Online", phone: "1" }, "online", "guest");
    await createReservation(h, { day, time: "19:00", party: 2, name: "Telefon", phone: "2" }, "admin", "staff"); // selbst erfasst: zählt nicht
    await db().insert(inquiries).values({ hotelId: a.hotel.id, kind: "group", name: "X", email: "x@example.ch", message: "Hallo", status: "new" } as never);

    expect(await unseenCounts(p1, a.hotel.id, ["reservations", "inbox"])).toEqual({ reservations: 1, inbox: 1 });
    // andere Person: eigener Stand (erster Blick = jetzt), sieht die vorhandenen nicht als neu
    expect(await unseenCounts(p2, a.hotel.id, ["reservations"])).toEqual({ reservations: 0 });
    // anderer Betrieb: nichts
    expect(await unseenCounts(p1, b.hotel.id, ["reservations"])).toEqual({ reservations: 0 });

    // Liste geöffnet: Zahl weg, nur diese Art
    await markSeen(p1, a.hotel.id, "reservations");
    expect(await unseenCounts(p1, a.hotel.id, ["reservations", "inbox"])).toEqual({ reservations: 0, inbox: 1 });
  });
  it("Offene Aufgaben: gemeinsame Zahl je Betrieb, bleibt nach dem Ansehen; verschwindet mit dem Erledigen", async () => {
    const a = await makeHotel();
    const b = await makeHotel();
    const [h] = await db().select().from(hotels).where(eq(hotels.id, a.hotel.id));
    const p1 = await newUser();
    expect(await openTaskCounts(h, ["inbox", "orders", "overdue"])).toEqual({ inbox: 0, orders: 0, overdue: 0 });
    const [inq] = await db().insert(inquiries).values({ hotelId: a.hotel.id, kind: "group", name: "X", email: "x@example.ch", message: "Hallo", status: "new" } as never).returning();
    expect((await openTaskCounts(h, ["inbox"])).inbox).toBe(1);
    await markSeen(p1, a.hotel.id, "inbox"); // Person hat gesehen: die Aufgabe bleibt offen
    expect((await openTaskCounts(h, ["inbox"])).inbox).toBe(1);
    const [hb] = await db().select().from(hotels).where(eq(hotels.id, b.hotel.id));
    expect((await openTaskCounts(hb, ["inbox"])).inbox).toBe(0); // anderer Betrieb
    await db().update(inquiries).set({ status: "done" }).where(eq(inquiries.id, inq.id));
    expect((await openTaskCounts(h, ["inbox"])).inbox).toBe(0);
  });
});
