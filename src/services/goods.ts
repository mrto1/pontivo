import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { bookings, folioItems, goods, minibarRefills, rooms, type FolioItem, type Good } from "../db/schema";
import { folioVat, needsReorder } from "../domain/goods";
import { audit } from "./audit";

/** Shop & Lager (SPEC 19.51). Jede Abfrage nach hotel_id. */
export class GoodsError extends Error {}

export type GoodInput = {
  name: string; category: string; priceRappen: number; vat: Good["vat"]; sellable: boolean; active: boolean;
  minibar: boolean; minibarPar: number; trackStock: boolean; stock: number; minStock: number;
};

export const listGoods = (hotelId: string, opts: { onlySellable?: boolean } = {}) =>
  db().select().from(goods)
    .where(opts.onlySellable ? and(eq(goods.hotelId, hotelId), eq(goods.active, true), eq(goods.sellable, true)) : eq(goods.hotelId, hotelId))
    .orderBy(asc(goods.category), asc(goods.name));

/** Artikel unter dem Mindestbestand (nur mit Lager), knappste zuerst */
export async function reorderList(hotelId: string): Promise<Good[]> {
  return (await listGoods(hotelId)).filter(needsReorder).sort((a, b) => a.stock - a.minStock - (b.stock - b.minStock));
}

/**
 * `minibarAllowed`: false in reinen Restaurants, dort gibt es keine Minibar (die Zuweisung wird verworfen).
 */
export async function saveGood(hotelId: string, id: string | null, i: GoodInput, actor: string, minibarAllowed: boolean): Promise<Good> {
  const name = i.name.trim().slice(0, 100);
  if (!name) throw new GoodsError("Der Name fehlt.");
  if (!["standard", "reduced", "none"].includes(i.vat)) throw new GoodsError("Ungültige MWST-Art.");
  if (!Number.isInteger(i.priceRappen) || i.priceRappen < 0 || i.priceRappen > 10_000_000) throw new GoodsError("Preis ungültig.");
  if (!Number.isInteger(i.stock) || Math.abs(i.stock) > 1_000_000) throw new GoodsError("Bestand ungültig.");
  if (!Number.isInteger(i.minStock) || i.minStock < 0 || i.minStock > 1_000_000) throw new GoodsError("Mindestbestand ungültig.");
  const minibar = minibarAllowed && i.minibar;
  if (minibar && (!Number.isInteger(i.minibarPar) || i.minibarPar < 1 || i.minibarPar > 99)) throw new GoodsError("Sollmenge der Minibar: 1 bis 99.");
  const v = {
    name, category: i.category.trim().slice(0, 60), priceRappen: i.priceRappen, vat: i.vat, sellable: i.sellable, active: i.active,
    minibar, minibarPar: minibar ? i.minibarPar : 0, trackStock: i.trackStock, stock: i.trackStock ? i.stock : 0, minStock: i.trackStock ? i.minStock : 0,
  };
  return db().transaction(async (tx) => {
    let g: Good;
    if (id) {
      [g] = await tx.update(goods).set(v).where(and(eq(goods.id, id), eq(goods.hotelId, hotelId))).returning();
      if (!g) throw new GoodsError("Artikel nicht gefunden.");
    } else {
      [g] = await tx.insert(goods).values({ hotelId, ...v }).returning();
    }
    await audit(tx, { hotelId, actor, action: id ? "good.update" : "good.create", entity: "good", entityId: g.id });
    return g;
  });
}

export async function deleteGood(hotelId: string, id: string, actor: string): Promise<void> {
  const [g] = await db().select().from(goods).where(and(eq(goods.id, id), eq(goods.hotelId, hotelId)));
  if (!g) throw new GoodsError("Artikel nicht gefunden.");
  // Gebuchte Posten tragen Namen und Preis als Kopie; der Artikel darf gelöscht werden
  await db().delete(goods).where(eq(goods.id, id));
  await audit(db(), { hotelId, actor, action: "good.delete", entity: "good", entityId: id, details: { name: g.name } });
}

/** Wareneingang (positiv) oder Korrektur (negativ); nur bei Artikeln mit Lager */
export async function adjustStock(hotelId: string, id: string, delta: number, actor: string, reason = "Wareneingang"): Promise<Good> {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000) throw new GoodsError("Menge ungültig.");
  return db().transaction(async (tx) => {
    const [g] = await tx.update(goods).set({ stock: sql`${goods.stock} + ${delta}` })
      .where(and(eq(goods.id, id), eq(goods.hotelId, hotelId), eq(goods.trackStock, true))).returning();
    if (!g) throw new GoodsError("Artikel nicht gefunden oder ohne Lager.");
    await audit(tx, { hotelId, actor, action: "good.stock", entity: "good", entityId: id, details: { delta, reason, stock: g.stock } });
    return g;
  });
}

/**
 * Artikel aufs Zimmer buchen: ein Posten in der Buchung (Name, Preis, MWST als Kopie), Bestand sinkt in derselben Transaktion.
 * ASSUMPTION: Der Bestand darf unter 0 fallen (verkauft ist verkauft); die Liste «Nachbestellen» zeigt es, die Inventur korrigiert.
 */
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

async function sellInTx(tx: Tx, hotelId: string, bookingId: string, goodId: string, quantity: number, actor: string, source = "shop"): Promise<FolioItem> {
  const [g] = await tx.select().from(goods).where(and(eq(goods.id, goodId), eq(goods.hotelId, hotelId))).for("update");
  if (!g || !g.active || !g.sellable) throw new GoodsError("Artikel nicht verkäuflich.");
  const [b] = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)));
  if (!b) throw new GoodsError("Buchung nicht gefunden.");
  const { vatKind, vatBpsOverride } = folioVat(g.vat);
  const [item] = await tx.insert(folioItems).values({
    hotelId, bookingId, description: g.name, quantity, unitPriceRappen: g.priceRappen, vatKind, vatBpsOverride, source: `${source}:${g.id}`, createdBy: actor,
  }).returning();
  if (g.trackStock) await tx.update(goods).set({ stock: sql`${goods.stock} - ${quantity}` }).where(eq(goods.id, g.id));
  await audit(tx, { hotelId, actor, action: "folio.add", entity: "booking", entityId: bookingId, details: { description: g.name, amount: quantity * g.priceRappen, goodId: g.id, source } });
  return item;
}

/**
 * Artikel aufs Zimmer buchen: ein Posten in der Buchung (Name, Preis, MWST als Kopie), Bestand sinkt in derselben Transaktion.
 * ASSUMPTION: Der Bestand darf unter 0 fallen (verkauft ist verkauft); die Liste «Nachbestellen» zeigt es, die Inventur korrigiert.
 */
export async function sellToBooking(hotelId: string, bookingId: string, goodId: string, quantity: number, actor: string): Promise<FolioItem> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new GoodsError("Ungültige Menge.");
  return db().transaction((tx) => sellInTx(tx, hotelId, bookingId, goodId, quantity, actor));
}

/** Artikel der Minibar (aktiv, verkäuflich) */
export const minibarGoods = (hotelId: string) =>
  db().select().from(goods).where(and(eq(goods.hotelId, hotelId), eq(goods.minibar, true), eq(goods.active, true), eq(goods.sellable, true))).orderBy(asc(goods.category), asc(goods.name));

/**
 * Minibar-Zählung durch die Reinigung: je Artikel die vorhandene Menge. Fehlendes (Sollmenge − vorhanden) wird dem Gast verrechnet,
 * der das Zimmer bewohnt oder heute verlässt. ASSUMPTION: massgebend ist der Aufenthalt, der vor `day` begann und am frühesten endet;
 * gibt es keinen, wird nichts gebucht (Fehlermeldung), ausser nichts fehlt.
 */
export async function countMinibar(hotelId: string, roomId: string, day: string, counts: { goodId: string; present: number }[], actor: string): Promise<{ billed: { name: string; quantity: number }[]; bookingId: string | null }> {
  const list = await minibarGoods(hotelId);
  const missing: { goodId: string; qty: number }[] = [];
  for (const c of counts) {
    const g = list.find((x) => x.id === c.goodId);
    if (!g) continue;
    if (!Number.isInteger(c.present) || c.present < 0 || c.present > 999) throw new GoodsError("Menge ungültig.");
    if (c.present < g.minibarPar) missing.push({ goodId: g.id, qty: g.minibarPar - c.present });
  }
  if (!missing.length) return { billed: [], bookingId: null };
  return db().transaction(async (tx) => {
    const [room] = await tx.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.id, roomId), eq(rooms.hotelId, hotelId)));
    if (!room) throw new GoodsError("Zimmer nicht gefunden.");
    const found = rows<{ bookingId: string }>(await tx.execute(sql`
      SELECT rs.booking_id AS "bookingId" FROM room_stays rs JOIN bookings b ON b.id = rs.booking_id
       WHERE rs.hotel_id = ${hotelId} AND rs.room_id = ${roomId} AND b.status = 'confirmed' AND rs.from_day < ${day}::date AND rs.to_day >= ${day}::date
       ORDER BY rs.to_day ASC LIMIT 1`));
    if (!found.length) throw new GoodsError("Keine Buchung zum Verrechnen in diesem Zimmer.");
    const billed: { name: string; quantity: number }[] = [];
    for (const m of missing) {
      const it = await sellInTx(tx, hotelId, found[0].bookingId, m.goodId, m.qty, actor, "minibar");
      billed.push({ name: it.description, quantity: m.qty });
    }
    // Nachfüllen: offener Posten je Ware; eine frühere offene Zeile derselben Ware wird ersetzt, denn die Zählung zeigt den aktuellen Fehlbestand
    for (const m of missing) {
      await tx.update(minibarRefills).set({ doneAt: new Date() }).where(and(eq(minibarRefills.hotelId, hotelId), eq(minibarRefills.roomId, roomId), eq(minibarRefills.goodId, m.goodId), isNull(minibarRefills.doneAt)));
      await tx.insert(minibarRefills).values({ hotelId, roomId, goodId: m.goodId, quantity: m.qty });
    }
    await audit(tx, { hotelId, actor, action: "minibar.count", entity: "room", entityId: roomId, details: { missing } });
    return { billed, bookingId: found[0].bookingId };
  });
}

export type RefillRoom = { roomId: string; number: string; items: { id: string; name: string; quantity: number }[] };

/** Nachfüllliste: offene Posten je Zimmer, sortiert nach Zimmernummer */
export async function refillList(hotelId: string): Promise<RefillRoom[]> {
  const r = await db().select({ id: minibarRefills.id, roomId: minibarRefills.roomId, number: rooms.number, name: goods.name, quantity: minibarRefills.quantity })
    .from(minibarRefills).innerJoin(rooms, eq(rooms.id, minibarRefills.roomId)).innerJoin(goods, eq(goods.id, minibarRefills.goodId))
    .where(and(eq(minibarRefills.hotelId, hotelId), isNull(minibarRefills.doneAt))).orderBy(asc(rooms.sortOrder), asc(rooms.number), asc(goods.name));
  const out: RefillRoom[] = [];
  for (const x of r) {
    let g = out.find((o) => o.roomId === x.roomId);
    if (!g) out.push((g = { roomId: x.roomId, number: x.number, items: [] }));
    g.items.push({ id: x.id, name: x.name, quantity: x.quantity });
  }
  return out;
}

/** Zimmer ist aufgefüllt: alle offenen Posten des Zimmers erledigt */
export async function markRefilled(hotelId: string, roomId: string, actor: string): Promise<number> {
  const done = await db().update(minibarRefills).set({ doneAt: new Date() })
    .where(and(eq(minibarRefills.hotelId, hotelId), eq(minibarRefills.roomId, roomId), isNull(minibarRefills.doneAt))).returning({ id: minibarRefills.id });
  if (done.length) await audit(db(), { hotelId, actor, action: "minibar.refilled", entity: "room", entityId: roomId, details: { count: done.length } });
  return done.length;
}
