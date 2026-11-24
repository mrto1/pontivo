import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { bookings, folioItems, goods, type FolioItem, type Good } from "../db/schema";
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
export async function sellToBooking(hotelId: string, bookingId: string, goodId: string, quantity: number, actor: string): Promise<FolioItem> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new GoodsError("Ungültige Menge.");
  return db().transaction(async (tx) => {
    const [g] = await tx.select().from(goods).where(and(eq(goods.id, goodId), eq(goods.hotelId, hotelId))).for("update");
    if (!g || !g.active || !g.sellable) throw new GoodsError("Artikel nicht verkäuflich.");
    const [b] = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)));
    if (!b) throw new GoodsError("Buchung nicht gefunden.");
    const { vatKind, vatBpsOverride } = folioVat(g.vat);
    const [item] = await tx.insert(folioItems).values({
      hotelId, bookingId, description: g.name, quantity, unitPriceRappen: g.priceRappen, vatKind, vatBpsOverride, source: `shop:${g.id}`, createdBy: actor,
    }).returning();
    if (g.trackStock) await tx.update(goods).set({ stock: sql`${goods.stock} - ${quantity}` }).where(eq(goods.id, g.id));
    await audit(tx, { hotelId, actor, action: "folio.add", entity: "booking", entityId: bookingId, details: { description: g.name, amount: quantity * g.priceRappen, goodId: g.id } });
    return item;
  });
}
