import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../src/db/client";
import { posPlanItems, posTables } from "../../src/db/schema";
import { saveTable } from "../../src/services/pos";
import { FloorplanError, assignWaiter, deleteArea, deleteWaiter, listWaiters, saveWaiter, listAreas, listPlanItems, saveArea, saveAreaLayout } from "../../src/services/floorplan";
import { makeHotel } from "../helpers";

afterAll(closeDb);
const room = [{ name: "Doppelzimmer", roomCount: 1, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, basePriceRappen: 15000 }];

describe("Tischplan: Räume und Elemente (SPEC 19.53)", () => {
  it("legt den ersten Raum an, weitere Räume, Layout, Löschen verschiebt Tische", async () => {
    const h = (await makeHotel({}, room)).hotel;
    const [first] = await listAreas(h.id);
    expect(first.name).toBe("Innenbereich");
    const terrace = await saveArea(h.id, null, "Terrasse", "t");
    const t1 = await saveTable(h.id, "T1", "t");
    await saveAreaLayout(h.id, terrace.id, [{ id: t1.id, x: 300, y: 400, shape: "rect", seats: 6 }], [{ kind: "wc", label: "", x: 10, y: 10, w: 80, h: 60 }], "t");
    const [row] = await db().select().from(posTables).where(eq(posTables.id, t1.id));
    expect(row).toMatchObject({ areaId: terrace.id, planX: 300, shape: "rect", seats: 6 });
    expect(await listPlanItems(h.id)).toHaveLength(1);
    await deleteArea(h.id, terrace.id, "t");
    const [moved] = await db().select().from(posTables).where(eq(posTables.id, t1.id));
    expect(moved.areaId).toBe(first.id);
    expect(moved.planX).toBeNull();
    expect(await listPlanItems(h.id)).toHaveLength(0);
    await expect(deleteArea(h.id, first.id, "t")).rejects.toBeInstanceOf(FloorplanError);
  });

  it("trennt Hotels und prüft Eingaben", async () => {
    const a = (await makeHotel({}, room)).hotel;
    const b = (await makeHotel({}, room)).hotel;
    const [areaA] = await listAreas(a.id);
    const tb = await saveTable(b.id, "B1", "t");
    await saveAreaLayout(a.id, areaA.id, [{ id: tb.id, x: 1, y: 1 }], [], "t"); // fremder Tisch: wird nicht verändert
    const [row] = await db().select().from(posTables).where(eq(posTables.id, tb.id));
    expect(row.areaId).toBeNull();
    await expect(saveAreaLayout(b.id, areaA.id, [], [], "t")).rejects.toBeInstanceOf(FloorplanError);
    await expect(saveAreaLayout(a.id, areaA.id, [{ id: tb.id, x: 1, y: null }], [], "t")).rejects.toBeInstanceOf(FloorplanError);
    await expect(saveAreaLayout(a.id, areaA.id, [], [{ kind: "bogus" as never, x: 1, y: 1, w: 50, h: 50 }], "t")).rejects.toBeInstanceOf(FloorplanError);
    expect(await db().select().from(posPlanItems).where(and(eq(posPlanItems.hotelId, a.id)))).toHaveLength(0);
  });
});

describe("Kellner (SPEC 19.54)", () => {
  it("anlegen, zuweisen, entfernen; Mandantentrennung", async () => {
    const a = (await makeHotel({}, room)).hotel;
    const b = (await makeHotel({}, room)).hotel;
    const w = await saveWaiter(a.id, null, { name: "Anna Muster" }, "t");
    const wb = await saveWaiter(b.id, null, { name: "Fremd" }, "t");
    const t = await saveTable(a.id, "T1", "t");
    await assignWaiter(a.id, [t.id], w.id, "t");
    expect((await db().select().from(posTables).where(eq(posTables.id, t.id)))[0].waiterId).toBe(w.id);
    await expect(assignWaiter(a.id, [t.id], wb.id, "t")).rejects.toBeInstanceOf(FloorplanError);
    await expect(saveWaiter(a.id, null, { name: "X", color: "rot" }, "t")).rejects.toBeInstanceOf(FloorplanError);
    await deleteWaiter(a.id, w.id, "t");
    expect((await db().select().from(posTables).where(eq(posTables.id, t.id)))[0].waiterId).toBeNull();
    expect(await listWaiters(a.id)).toHaveLength(0);
  });
});

import { assignTables, createReservation, saveSettings, reservationsOfDay, autoAssignDay } from "../../src/services/reservations";
import { hotelModules } from "../../src/db/schema";
import { addDays, todayIn } from "../../src/domain/dates";
describe("Zusammengelegte Tische (SPEC 19.58)", () => {
  it("von Hand und automatisch; belegte Tische sind gesperrt", async () => {
    const { hotel } = await makeHotel({}, room);
    await db().insert(hotelModules).values({ hotelId: hotel.id, module: "restaurant", enabled: true });
    const [h0] = await db().select().from((await import("../../src/db/schema")).hotels).where(eq((await import("../../src/db/schema")).hotels.id, hotel.id));
    const day = addDays(todayIn(h0.timezone), 3);
    const s = { onlineEnabled: true, windows: [{ from: "18:00", to: "20:00" }], durationMin: 90, maxParty: 12, capacity: 50, leadHours: 0, horizonDays: 30, depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 24, autoAssign: true, combineTables: true };
    await saveSettings(hotel.id, s, "t");
    const t1 = await saveTable(hotel.id, "T1", "t"), t2 = await saveTable(hotel.id, "T2", "t"), t3 = await saveTable(hotel.id, "T3", "t");
    for (const t of [t1, t2, t3]) await saveAreaLayout(hotel.id, (await listAreas(hotel.id))[0].id, [{ id: t.id, x: 100 * Number(t.name.slice(1)), y: 100, seats: 4 }], [], "t");
    const g = await createReservation(h0, { day, time: "18:00", party: 7, name: "Gruppe", email: "g@example.ch" }, "online", "guest");
    expect(g.reservation.tableId).toBeTruthy();
    expect(g.reservation.extraTableIds).toHaveLength(1);
    const used = [g.reservation.tableId!, ...g.reservation.extraTableIds];
    const free = [t1, t2, t3].find((t) => !used.includes(t.id))!;
    // zweite Gruppe passt nur noch an den freien Tisch
    const h = await createReservation(h0, { day, time: "18:00", party: 3, name: "Klein", email: "k@example.ch" }, "online", "guest");
    expect(h.reservation.tableId).toBe(free.id);
    // Handzuweisung auf belegten Tisch scheitert, auf freien Zeitpunkt geht
    const late = await createReservation(h0, { day, time: "20:00", party: 2, name: "Spät", email: "s@example.ch" }, "admin", "t");
    await expect(assignTables(hotel.id, late.reservation.id, [used[0], used[1]], "t")).resolves.toBeUndefined();
    const all = await reservationsOfDay(hotel.id, day);
    expect(all.find((r) => r.id === late.reservation.id)!.extraTableIds).toHaveLength(1);
    const mid = await createReservation(h0, { day, time: "18:30", party: 2, name: "Mitte", email: "m@example.ch" }, "admin", "t");
    await expect(assignTables(hotel.id, mid.reservation.id, [used[0]], "t")).rejects.toBeInstanceOf(Error);
    expect(await autoAssignDay(hotel.id, day, "t")).toBeGreaterThanOrEqual(0);
  });
});

import { slotsFor } from "../../src/services/reservations";
describe("Online-Buchung steuern (SPEC 19.59)", () => {
  it("nur online buchbare Tische und Räume zählen; Räume ausnehmbar", async () => {
    const { hotel } = await makeHotel({}, room);
    await db().insert(hotelModules).values({ hotelId: hotel.id, module: "restaurant", enabled: true });
    const hs = (await import("../../src/db/schema")).hotels;
    const [h0] = await db().select().from(hs).where(eq(hs.id, hotel.id));
    const day = addDays(todayIn(h0.timezone), 3);
    await saveSettings(hotel.id, { onlineEnabled: true, windows: [{ from: "18:00", to: "19:00" }], durationMin: 90, maxParty: 8, capacity: 50, leadHours: 0, horizonDays: 30, depositPerPersonRappen: 0, depositFromParty: 1, cancelHours: 24, reminderHours: 24, autoAssign: true }, "t");
    const [inside] = await listAreas(hotel.id);
    const terrace = await saveArea(hotel.id, null, "Terrasse", "t", false);
    const t1 = await saveTable(hotel.id, "T1", "t"), t2 = await saveTable(hotel.id, "T2", "t");
    await saveAreaLayout(hotel.id, inside.id, [{ id: t1.id, x: 100, y: 100, seats: 4 }], [], "t");
    await saveAreaLayout(hotel.id, terrace.id, [{ id: t2.id, x: 100, y: 100, seats: 4 }], [], "t");
    // Terrasse ausgenommen: nur T1 online
    const r1 = await createReservation(h0, { day, time: "18:00", party: 2, name: "A", email: "a@example.ch" }, "online", "guest");
    expect(r1.reservation.tableId).toBe(t1.id);
    // T1 belegt, Terrasse nicht online: keine Zeit mehr frei, Buchung wird abgelehnt
    expect((await slotsFor(h0, day, 2)).every((x) => !x.ok)).toBe(true);
    await expect(createReservation(h0, { day, time: "18:00", party: 2, name: "B", email: "b@example.ch" }, "online", "guest")).rejects.toBeInstanceOf(Error);
    // Terrasse online schalten: wieder frei
    await saveArea(hotel.id, terrace.id, "Terrasse", "t", true);
    expect((await slotsFor(h0, day, 2)).some((x) => x.ok)).toBe(true);
    // Intern darf man trotzdem auf die Terrasse setzen
    const r3 = await createReservation(h0, { day, time: "18:00", party: 2, name: "C", tableId: t2.id }, "admin", "t");
    expect(r3.reservation.tableId).toBe(t2.id);
  });
});
