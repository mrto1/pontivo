import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { posAreas, posPlanItems, posTables, type PlanItemKind, type PosArea, type PosPlanItem } from "../db/schema";
import { PLAN_ITEM_KINDS, clampPlan } from "../domain/floorplan";
import { audit } from "./audit";

/** Tischplan: Räume und Orientierungselemente (SPEC 19.53). Jede Abfrage nach hotel_id. */
export class FloorplanError extends Error {}

const clean = (s: string | undefined, n: number) => (s ?? "").trim().slice(0, n);

/** Aktive Räume; gibt es noch keinen, wird "Innenbereich" angelegt. Tische ohne Raum gehören zum ersten Raum. */
export async function listAreas(hotelId: string): Promise<PosArea[]> {
  const get = () => db().select().from(posAreas).where(and(eq(posAreas.hotelId, hotelId), eq(posAreas.active, true))).orderBy(asc(posAreas.sortOrder), asc(posAreas.name));
  let a = await get();
  if (!a.length) {
    await db().insert(posAreas).values({ hotelId, name: "Innenbereich", sortOrder: 0 });
    a = await get();
  }
  return a;
}

export async function saveArea(hotelId: string, id: string | null, name: string, actor: string): Promise<PosArea> {
  const n = clean(name, 40);
  if (!n) throw new FloorplanError("Der Name fehlt.");
  return db().transaction(async (tx) => {
    let a: PosArea;
    if (id) {
      [a] = await tx.update(posAreas).set({ name: n }).where(and(eq(posAreas.id, id), eq(posAreas.hotelId, hotelId))).returning();
      if (!a) throw new FloorplanError("Raum nicht gefunden.");
    } else {
      const count = (await tx.select({ id: posAreas.id }).from(posAreas).where(eq(posAreas.hotelId, hotelId))).length;
      [a] = await tx.insert(posAreas).values({ hotelId, name: n, sortOrder: count }).returning();
    }
    await audit(tx, { hotelId, actor, action: id ? "pos.area_update" : "pos.area_create", entity: "pos_area", entityId: a.id });
    return a;
  });
}

/** Raum entfernen: Tische bleiben erhalten und wandern in den ersten übrigen Raum, Elemente werden gelöscht. Der letzte Raum bleibt. */
export async function deleteArea(hotelId: string, id: string, actor: string) {
  const areas = await listAreas(hotelId);
  if (areas.length < 2) throw new FloorplanError("Der letzte Raum kann nicht gelöscht werden.");
  const target = areas.find((a) => a.id !== id);
  if (!areas.some((a) => a.id === id) || !target) throw new FloorplanError("Raum nicht gefunden.");
  await db().transaction(async (tx) => {
    await tx.update(posTables).set({ areaId: target.id, planX: null, planY: null }).where(and(eq(posTables.hotelId, hotelId), eq(posTables.areaId, id)));
    await tx.delete(posPlanItems).where(and(eq(posPlanItems.hotelId, hotelId), eq(posPlanItems.areaId, id)));
    await tx.update(posAreas).set({ active: false }).where(and(eq(posAreas.id, id), eq(posAreas.hotelId, hotelId)));
    await audit(tx, { hotelId, actor, action: "pos.area_delete", entity: "pos_area", entityId: id });
  });
}

export const listPlanItems = (hotelId: string): Promise<PosPlanItem[]> =>
  db().select().from(posPlanItems).where(eq(posPlanItems.hotelId, hotelId)).orderBy(asc(posPlanItems.createdAt));

export type PlanItemInput = { id?: string; kind: PlanItemKind; label?: string; x: number; y: number; w: number; h: number };
export type TablePlacement = { id: string; x: number | null; y: number | null; shape?: "square" | "round" | "rect"; seats?: number };

/**
 * Layout eines Raums speichern (alles oder nichts): Tische (Lage, Form, Plätze, Raumzuordnung) und Elemente.
 * Elemente des Raums werden durch die übergebene Liste ersetzt.
 */
export async function saveAreaLayout(hotelId: string, areaId: string, tables: TablePlacement[], items: PlanItemInput[], actor: string) {
  const [area] = await db().select().from(posAreas).where(and(eq(posAreas.id, areaId), eq(posAreas.hotelId, hotelId)));
  if (!area) throw new FloorplanError("Raum nicht gefunden.");
  for (const t of tables) {
    const ok = (v: number | null) => v === null || (Number.isInteger(v) && v >= 0 && v <= 1000);
    if (!ok(t.x) || !ok(t.y) || (t.x === null) !== (t.y === null)) throw new FloorplanError("Position ungültig.");
    if (t.shape && !["square", "round", "rect"].includes(t.shape)) throw new FloorplanError("Form ungültig.");
    if (t.seats !== undefined && (!Number.isInteger(t.seats) || t.seats < 1 || t.seats > 50)) throw new FloorplanError("Plätze: 1 bis 50.");
  }
  for (const i of items) {
    if (!(PLAN_ITEM_KINDS as readonly string[]).includes(i.kind)) throw new FloorplanError("Element ungültig.");
    if (![i.x, i.y, i.w, i.h].every(Number.isFinite)) throw new FloorplanError("Position ungültig.");
  }
  await db().transaction(async (tx) => {
    for (const t of tables) {
      const set: Partial<typeof posTables.$inferInsert> = { areaId, planX: t.x, planY: t.y };
      if (t.shape) set.shape = t.shape;
      if (t.seats !== undefined) set.seats = t.seats;
      await tx.update(posTables).set(set).where(and(eq(posTables.id, t.id), eq(posTables.hotelId, hotelId)));
    }
    await tx.delete(posPlanItems).where(and(eq(posPlanItems.hotelId, hotelId), eq(posPlanItems.areaId, areaId)));
    for (const i of items) {
      await tx.insert(posPlanItems).values({
        hotelId, areaId, kind: i.kind, label: clean(i.label, 40),
        planX: clampPlan(i.x), planY: clampPlan(i.y),
        w: Math.max(10, Math.min(1000, Math.round(i.w))), h: Math.max(10, Math.min(1000, Math.round(i.h))),
      });
    }
    await audit(tx, { hotelId, actor, action: "pos.area_layout", entity: "pos_area", entityId: areaId, details: { tables: tables.length, items: items.length } });
  });
}
