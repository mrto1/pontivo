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
