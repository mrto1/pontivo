import { and, eq, isNull, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { hotels, roomLinks, type ApiKey, type PosReceipt, type PosReceiptItem, type RoomLink } from "../db/schema";
import { bearer, KEY_PREFIX } from "../domain/posbridge";
import { decryptField, encryptField } from "../lib/guest-crypto";
import { rateLimit } from "../lib/rate-limit";
import { audit } from "./audit";
import { PosBridgeError, addItemFromPos, authenticate, inHouseForBridge } from "./posbridge";

/**
 * R6 (SPEC 20.10): Ein verpachtetes Restaurant (eigener Betrieb) bucht über den Kassen-Schlüssel des Hotels aufs Zimmer.
 * Kein direkter Zugriff zwischen Betrieben: jeder Schritt geht über die Funktionen der Schnittstelle, das Hotel kommt aus dem Schlüssel.
 */
export class RoomLinkError extends Error {}

// Modul-Prüfung ohne services/modules (das zieht next/navigation nach und bricht Skripte und Playwright-Tests, die die Kasse laden)
async function moduleOn(hotelId: string, key: string): Promise<boolean> {
  const [m] = rows<{ on: boolean }>(await db().execute(sql`SELECT enabled AS on FROM hotel_modules WHERE hotel_id = ${hotelId} AND module = ${key}`));
  return !!m?.on;
}

/** Schlüssel prüfen wie die Schnittstelle selbst: gültig, Zweck Kasse, Modul beim Hotel an, Grenze 120/Minute */
async function useKey(plain: string, ownHotelId: string): Promise<ApiKey> {
  if (!bearer(`Bearer ${plain}`)) throw new RoomLinkError(`Der Schlüssel muss mit «${KEY_PREFIX}» beginnen.`);
  const k = await authenticate(plain);
  if (!k) throw new RoomLinkError("Der Schlüssel des Hotels ist ungültig oder widerrufen.");
  if (k.scope !== "pos") throw new RoomLinkError("Das ist ein Schlüssel der Website-Schnittstelle. Bitte einen Schlüssel der Kassen-Schnittstelle verwenden.");
  if (k.hotelId === ownHotelId) throw new RoomLinkError("Das ist ein Schlüssel Ihres eigenen Betriebs. «Aufs Zimmer» im eigenen Betrieb geht ohne Verbindung.");
  if (!(await moduleOn(k.hotelId, "posbridge"))) throw new RoomLinkError("Beim Hotel ist die Kassen-Schnittstelle nicht eingeschaltet.");
  if (!rateLimit(`posbridge:${k.id}`, 120, 60_000)) throw new RoomLinkError("Zu viele Anfragen an das Hotel. Bitte gleich nochmals.");
  return k;
}

export const activeLink = async (hotelId: string): Promise<RoomLink | null> =>
  (await db().select().from(roomLinks).where(and(eq(roomLinks.hotelId, hotelId), isNull(roomLinks.revokedAt))))[0] ?? null;

/** Hotel verbinden: Schlüssel prüfen, verschlüsselt speichern; ersetzt eine bestehende Verbindung */
export async function connectRoomLink(hotelId: string, plain: string, actor: string): Promise<RoomLink> {
  const key = plain.trim();
  const k = await useKey(key, hotelId);
  const [partner] = await db().select({ name: hotels.name }).from(hotels).where(eq(hotels.id, k.hotelId));
  return db().transaction(async (tx) => {
    await tx.update(roomLinks).set({ revokedAt: new Date() }).where(and(eq(roomLinks.hotelId, hotelId), isNull(roomLinks.revokedAt)));
    const [l] = await tx.insert(roomLinks).values({ hotelId, label: partner?.name ?? k.label, keyEnc: encryptField(key), keyPrefix: key.slice(0, 10), createdBy: actor }).returning();
    await audit(tx, { hotelId, actor, action: "roomlink.connect", entity: "room_link", entityId: l.id, details: { prefix: l.keyPrefix, partner: l.label } });
    return l;
  });
}

export async function disconnectRoomLink(hotelId: string, actor: string) {
  await db().transaction(async (tx) => {
    const r = await tx.update(roomLinks).set({ revokedAt: new Date() }).where(and(eq(roomLinks.hotelId, hotelId), isNull(roomLinks.revokedAt))).returning({ id: roomLinks.id });
    for (const x of r) await audit(tx, { hotelId, actor, action: "roomlink.disconnect", entity: "room_link", entityId: x.id });
  });
}

async function keyOf(link: RoomLink): Promise<ApiKey> {
  const k = await useKey(decryptField(link.keyEnc) ?? "", link.hotelId);
  await db().update(roomLinks).set({ lastUsedAt: new Date() }).where(eq(roomLinks.id, link.id));
  return k;
}

/** Gäste im Haus beim verbundenen Hotel (für die Auswahl an der Kasse); ohne Verbindung oder bei Fehler leer */
export async function remoteGuests(hotelId: string): Promise<{ reference: string; name: string; room: string | null }[]> {
  const link = await activeLink(hotelId);
  if (!link) return [];
  try {
    const k = await keyOf(link);
    return (await inHouseForBridge(k.hotelId)).map((g) => ({ reference: g.booking_reference, name: `${g.name} · ${link.label}`, room: g.room }));
  } catch (e) {
    if (e instanceof RoomLinkError) return [];
    throw e;
  }
}

const vatOf = (bps: number) => (bps > 0 ? "standard" as const : "none" as const);

/**
 * Bon «aufs Zimmer» beim verbundenen Hotel buchen: je Zeile ein Posten, Trinkgeld ohne MWST. Gegenbon (reversal) mit negativen Mengen.
 * Idempotent über die externe Id (Wiederholung bucht nichts doppelt). Fehler → RoomLinkError (nichts beim Hotel gebucht, ausser bei
 * Abbruch mitten in der Liste: dann holt die Wiederholung mit derselben Bon-Id den Rest nach).
 */
export async function chargeRemote(hotelId: string, restaurantName: string, reference: string, receipt: Pick<PosReceipt, "id" | "number" | "kind">, items: PosReceiptItem[], tipRappen: number, origReceiptId?: string, expectedLinkId?: string): Promise<{ linkId: string; reference: string }> {
  const link = await activeLink(hotelId);
  if (!link) throw new RoomLinkError("Keine Verbindung zu einem Hotel.");
  if (expectedLinkId && link.id !== expectedLinkId) throw new RoomLinkError("Die Verbindung zum Hotel wurde seither geändert. Bitte die Gegenbuchung mit dem Hotel absprechen.");
  const k = await keyOf(link);
  const ref = reference.trim().toUpperCase();
  const rev = receipt.kind === "reversal";
  // Externe Id höchstens 100 Zeichen: Bon-Id (weltweit eindeutig) und Position der Zeile
  const base = `pontivo:${origReceiptId ?? receipt.id}`;
  const tag = (x: string | number) => `${base}:${x}${rev ? ":rev" : ""}`;
  const posts = [
    ...items.map((it, i) => ({ external_id: tag(i + 1), description: `${it.description} (Restaurant ${restaurantName} ${receipt.number})`, quantity: it.quantity, unit_price_rappen: it.unitPriceRappen, vat: vatOf(it.vatBps) })),
    ...(tipRappen ? [{ external_id: tag("tip"), description: `Trinkgeld (Restaurant ${restaurantName} ${receipt.number})`, quantity: rev ? -1 : 1, unit_price_rappen: tipRappen, vat: "none" as const }] : []),
  ];
  try {
    let out = ref;
    for (const p of posts) out = (await addItemFromPos(k, { booking_reference: ref, ...p, description: p.description.slice(0, 200) })).bookingReference;
    return { linkId: link.id, reference: out };
  } catch (e) {
    if (e instanceof PosBridgeError) throw new RoomLinkError(`Hotel: ${e.message}`);
    throw e;
  }
}

/** Summe «aufs Zimmer» an verbundene Hotels je Monat (Grundlage für die Rechnung des Pächters an das Hotel) */
export async function roomLinkTotals(hotelId: string, months = 3): Promise<{ month: string; label: string; count: number; totalRappen: number }[]> {
  return rows<{ month: string; label: string; n: number; total: number }>(await db().execute(sql`
    SELECT substr(r.business_day::text, 1, 7) AS month, l.label, count(*)::int AS n, coalesce(sum(p.amount_rappen), 0)::int AS total
      FROM pos_payments p JOIN pos_receipts r ON r.id = p.receipt_id AND r.hotel_id = p.hotel_id JOIN room_links l ON l.id = p.remote_link_id AND l.hotel_id = p.hotel_id
     WHERE p.hotel_id = ${hotelId} AND p.remote_link_id IS NOT NULL AND r.business_day > (current_date - (${months} || ' months')::interval)
     GROUP BY 1, 2 ORDER BY 1 DESC`)).map((r) => ({ month: r.month, label: r.label, count: r.n, totalRappen: r.total }));
}
