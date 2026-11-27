import { UserError } from "../domain/errors";
import crypto from "node:crypto";
import { insertFolioItem } from "./folio";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { apiKeys, bookings, folioItems, type ApiKey, type FolioItem } from "../db/schema";
import { KEY_PREFIX, sameItem, type FolioItemRequest } from "../domain/posbridge";
import { todayIn } from "../domain/dates";
import { audit } from "./audit";
import { hotels } from "../db/schema";

/** PosBridge (SPEC 19.15): Schlüssel je Betrieb und Posten aufs Zimmer buchen. Jede Abfrage nach hotel_id aus dem Schlüssel. */
export class PosBridgeError extends UserError {
  constructor(public code: "not_found" | "ambiguous" | "conflict" | "invalid", message: string) { super(message); }
}

const hash = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

/** Neuen Schlüssel anlegen. Der Klartext wird nur hier zurückgegeben und nie gespeichert. */
export async function createApiKey(hotelId: string, label: string, actor: string, scope: ApiKey["scope"] = "pos", opts: { expiresAt?: Date | null; allowedIps?: string[] } = {}): Promise<{ key: string; row: ApiKey }> {
  const l = label.trim().slice(0, 80);
  if (!l) throw new PosBridgeError("invalid", "Bitte eine Bezeichnung angeben (z. B. Name der Kasse).");
  const key = `${KEY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  return db().transaction(async (tx) => {
    const [row] = await tx.insert(apiKeys).values({ hotelId, label: l, keyHash: hash(key), prefix: key.slice(0, 10), scope, createdBy: actor, expiresAt: opts.expiresAt ?? null, allowedIps: opts.allowedIps ?? [] }).returning();
    await audit(tx, { hotelId, actor, action: "apikey.create", entity: "api_key", entityId: row.id, details: { label: l, scope } });
    return { key, row };
  });
}

export const listApiKeys = (hotelId: string, scope: ApiKey["scope"] = "pos") => db().select().from(apiKeys).where(and(eq(apiKeys.hotelId, hotelId), eq(apiKeys.scope, scope))).orderBy(desc(apiKeys.createdAt));

export async function revokeApiKey(hotelId: string, id: string, actor: string) {
  await db().transaction(async (tx) => {
    const [r] = await tx.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), eq(apiKeys.hotelId, hotelId), isNull(apiKeys.revokedAt))).returning({ id: apiKeys.id });
    if (r) await audit(tx, { hotelId, actor, action: "apikey.revoke", entity: "api_key", entityId: id });
  });
}

/** Schlüssel prüfen: gültig, nicht widerrufen; setzt «zuletzt benutzt» */
export async function authenticate(key: string): Promise<ApiKey | null> {
  const [k] = await db().select().from(apiKeys).where(and(eq(apiKeys.keyHash, hash(key)), isNull(apiKeys.revokedAt)));
  if (!k) return null;
  if (k.expiresAt && k.expiresAt.getTime() <= Date.now()) return null;
  await db().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, k.id));
  return k;
}

/** Buchung zur Zimmernummer: Gast im Haus (Anreise bis vor Abreise), sonst Abreise heute. Mehrdeutig → Fehler. */
async function bookingByRoom(hotelId: string, room: string): Promise<string> {
  const [h] = await db().select({ tz: hotels.timezone }).from(hotels).where(eq(hotels.id, hotelId));
  const today = todayIn(h.tz);
  const found = rows<{ booking_id: string; from_day: string; to_day: string }>(await db().execute(sql`
    SELECT DISTINCT rs.booking_id, rs.from_day::text, rs.to_day::text FROM room_stays rs
      JOIN rooms r ON r.id = rs.room_id AND r.hotel_id = rs.hotel_id
      JOIN bookings b ON b.id = rs.booking_id AND b.hotel_id = rs.hotel_id
     WHERE rs.hotel_id = ${hotelId} AND r.number = ${room} AND b.status = 'confirmed'
       AND rs.from_day <= ${today} AND rs.to_day >= ${today}`));
  const inHouse = [...new Set(found.filter((f) => f.to_day > today).map((f) => f.booking_id))];
  const leaving = [...new Set(found.filter((f) => f.to_day === today).map((f) => f.booking_id))];
  const ids = inHouse.length ? inHouse : leaving;
  if (!ids.length) throw new PosBridgeError("not_found", `Kein Gast im Zimmer ${room}.`);
  if (ids.length > 1) throw new PosBridgeError("ambiguous", `Mehrere Buchungen im Zimmer ${room}; bitte booking_reference senden.`);
  return ids[0];
}

/**
 * Posten aufs Zimmer buchen. Idempotent über die externe Beleg-ID: dieselbe Anfrage liefert den bestehenden Posten (created=false),
 * ein anderer Inhalt mit gleicher Beleg-ID ist ein Konflikt. Nur bestätigte Buchungen des eigenen Betriebs.
 */
export async function addItemFromPos(key: ApiKey, req: FolioItemRequest): Promise<{ item: FolioItem; created: boolean; bookingReference: string }> {
  const hotelId = key.hotelId;
  const bookingId = req.booking_reference
    ? (await db().select({ id: bookings.id, status: bookings.status }).from(bookings).where(and(eq(bookings.hotelId, hotelId), eq(bookings.reference, req.booking_reference.toUpperCase()))).then((r) => {
        if (!r[0] || r[0].status !== "confirmed") throw new PosBridgeError("not_found", "Buchung nicht gefunden oder nicht bestätigt.");
        return r[0].id;
      }))
    : await bookingByRoom(hotelId, req.room_number!);
  const v = { description: req.description, quantity: req.quantity, unitPriceRappen: req.unit_price_rappen, vatKind: req.vat };
  return db().transaction(async (tx) => {
    const created = await insertFolioItem(tx, { hotelId, bookingId, ...v, externalId: req.external_id, source: `pos:${key.id}`, createdBy: `api:${key.id}` }, { ignoreConflict: true });
    const ins = created ? [created] : [];
    const [b] = await tx.select({ reference: bookings.reference }).from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)));
    if (ins.length) {
      await audit(tx, { hotelId, actor: `api:${key.id}`, action: "folio.add", entity: "booking", entityId: bookingId, details: { description: v.description, amount: v.quantity * v.unitPriceRappen, externalId: req.external_id, label: key.label } });
      return { item: ins[0], created: true, bookingReference: b.reference };
    }
    const [ex] = await tx.select().from(folioItems).where(and(eq(folioItems.hotelId, hotelId), eq(folioItems.externalId, req.external_id)));
    if (!ex || ex.bookingId !== bookingId || !sameItem(ex, v)) throw new PosBridgeError("conflict", "Diese external_id wurde schon mit anderem Inhalt oder für eine andere Buchung gebucht.");
    return { item: ex, created: false, bookingReference: b.reference };
  });
}

/** Gäste im Haus für eine Kasse (SPEC 20.10): Buchungsnummer, Zimmer, «Nachname V.»; heute im Haus oder Abreise heute, nur bestätigte */
export async function inHouseForBridge(hotelId: string): Promise<{ booking_reference: string; room: string | null; name: string }[]> {
  const [h] = await db().select({ tz: hotels.timezone }).from(hotels).where(eq(hotels.id, hotelId));
  const today = todayIn(h.tz);
  const list = rows<{ reference: string; room: string | null; first: string | null; last: string | null }>(await db().execute(sql`
    SELECT b.reference, min(r.number) AS room, g.first_name AS first, g.last_name AS last FROM bookings b
      LEFT JOIN guests g ON g.id = b.guest_id AND g.hotel_id = b.hotel_id
      LEFT JOIN room_stays rs ON rs.booking_id = b.id AND rs.hotel_id = b.hotel_id AND rs.from_day <= ${today} AND rs.to_day >= ${today}
      LEFT JOIN rooms r ON r.id = rs.room_id AND r.hotel_id = rs.hotel_id
     WHERE b.hotel_id = ${hotelId} AND b.status = 'confirmed' AND b.checkin <= ${today} AND b.checkout >= ${today}
     GROUP BY b.id, b.reference, g.first_name, g.last_name ORDER BY min(r.number) NULLS LAST, b.reference LIMIT 400`));
  return list.map((g) => ({ booking_reference: g.reference, room: g.room, name: [g.last?.trim(), g.first?.trim() ? `${g.first.trim()[0]}.` : ""].filter(Boolean).join(" ") }));
}

/** Summe der von einem Schlüssel gebuchten Posten je Monat (Abrechnung mit dem Pächter, SPEC 20.10) */
export async function bridgeTotals(hotelId: string, months = 3): Promise<{ keyId: string; month: string; count: number; totalRappen: number }[]> {
  const [h] = await db().select({ tz: hotels.timezone }).from(hotels).where(eq(hotels.id, hotelId));
  return rows<{ key_id: string; month: string; n: number; total: number }>(await db().execute(sql`
    SELECT substr(source, 5) AS key_id, to_char(created_at AT TIME ZONE ${h.tz}, 'YYYY-MM') AS month, count(*)::int AS n, coalesce(sum(quantity * unit_price_rappen), 0)::int AS total
      FROM folio_items WHERE hotel_id = ${hotelId} AND source LIKE 'pos:%' AND source <> 'pos' AND created_at > now() - (${months} || ' months')::interval
     GROUP BY 1, 2 ORDER BY 2 DESC`)).map((r) => ({ keyId: r.key_id, month: r.month, count: r.n, totalRappen: r.total }));
}
