import type pg from "pg";
import { pool } from "../db/client";

/** Plattform-Verwaltung (nur Plattform-Admin): Betriebe und Benutzer übersehen und endgültig löschen. */

type Fk = { child: string; childCol: string; parentCol: string };

async function fksTo(c: pg.PoolClient, table: string): Promise<Fk[]> {
  const r = await c.query(
    `SELECT cl.relname AS child, ca.attname AS child_col, pa.attname AS parent_col
       FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid
       JOIN pg_class pc ON pc.oid = con.confrelid
       JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = con.conkey[1]
       JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
      WHERE con.contype = 'f' AND pc.relname = $1 AND array_length(con.conkey, 1) = 1`,
    [table],
  );
  return r.rows.map((x) => ({ child: x.child, childCol: x.child_col, parentCol: x.parent_col }));
}

/**
 * Zeilen von `table` (Bedingung `where`) samt aller abhängigen Zeilen löschen (über die Fremdschlüssel, einspaltig).
 * Neue Tabellen mit Fremdschlüssel werden automatisch erfasst.
 */
async function purge(c: pg.PoolClient, table: string, where: string, params: unknown[], counts: Map<string, number>, depth = 0): Promise<void> {
  if (depth > 8) throw new Error(`Zu tiefe Abhängigkeit bei ${table}`);
  for (const fk of await fksTo(c, table)) {
    if (fk.child === table) continue;
    await purge(c, fk.child, `"${fk.childCol}" IN (SELECT "${fk.parentCol}" FROM "${table}" WHERE ${where})`, params, counts, depth + 1);
  }
  const r = await c.query(`DELETE FROM "${table}" WHERE ${where}`, params);
  if (r.rowCount) counts.set(table, (counts.get(table) ?? 0) + r.rowCount);
}

async function inTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const record = (c: pg.PoolClient, actor: string, action: string, entityId: string, details: Record<string, unknown>) =>
  // hotel_id bleibt leer: der Betrieb ist weg, der Eintrag soll bleiben
  c.query(`INSERT INTO audit_log (hotel_id, actor, action, entity, entity_id, details) VALUES (NULL, $1, $2, $3, $4, $5)`, [actor, action, action.split(".")[0], entityId, JSON.stringify(details)]);

export type HotelRow = { id: string; name: string; status: string; createdAt: Date; members: { userId: string; email: string; role: string }[]; bookings: number; invoices: number };
export type UserRow = { id: string; email: string; name: string | null; isPlatformAdmin: boolean; emailLoginDisabled: boolean; createdAt: Date; hotels: { id: string; name: string; role: string }[]; passkeys: number; totp: boolean };

export async function platformOverview(): Promise<{ hotels: HotelRow[]; users: UserRow[] }> {
  const q = (s: string, p: unknown[] = []) => pool().query(s, p).then((r) => r.rows);
  const [hotels, members, bk, inv, users, pk, totp] = await Promise.all([
    q(`SELECT id, name, status, created_at FROM hotels ORDER BY created_at DESC`),
    q(`SELECT m.hotel_id, m.user_id, m.role, u.email FROM hotel_members m JOIN users u ON u.id = m.user_id`),
    q(`SELECT hotel_id, count(*)::int AS n FROM bookings GROUP BY hotel_id`),
    q(`SELECT hotel_id, count(*)::int AS n FROM invoices GROUP BY hotel_id`),
    q(`SELECT id, email, name, is_platform_admin, email_login_disabled, created_at FROM users ORDER BY created_at DESC`),
    q(`SELECT user_id, count(*)::int AS n FROM user_passkeys GROUP BY user_id`),
    q(`SELECT user_id FROM user_totp WHERE confirmed_at IS NOT NULL`),
  ]);
  const byHotel = (rows: { hotel_id: string; n: number }[]) => new Map(rows.map((r) => [r.hotel_id, r.n]));
  const b = byHotel(bk), i = byHotel(inv);
  const hotelName = new Map(hotels.map((h) => [h.id, h.name as string]));
  return {
    hotels: hotels.map((h) => ({
      id: h.id, name: h.name, status: h.status, createdAt: h.created_at,
      members: members.filter((m) => m.hotel_id === h.id).map((m) => ({ userId: m.user_id, email: m.email, role: m.role })),
      bookings: b.get(h.id) ?? 0, invoices: i.get(h.id) ?? 0,
    })),
    users: users.map((u) => ({
      id: u.id, email: u.email, name: u.name, isPlatformAdmin: u.is_platform_admin, emailLoginDisabled: u.email_login_disabled, createdAt: u.created_at,
      hotels: members.filter((m) => m.user_id === u.id).map((m) => ({ id: m.hotel_id, name: hotelName.get(m.hotel_id) ?? "?", role: m.role })),
      passkeys: pk.find((p) => p.user_id === u.id)?.n ?? 0,
      totp: totp.some((t) => t.user_id === u.id),
    })),
  };
}

/** Betrieb mit allen Daten löschen (Buchungen, Rechnungen, Gäste, Mails, Mitgliedschaften). Benutzer bleiben bestehen. */
export async function deleteHotelCascade(hotelId: string, actor: string): Promise<Map<string, number>> {
  return inTx(async (c) => {
    const h = (await c.query(`SELECT id, name, status FROM hotels WHERE id = $1`, [hotelId])).rows[0];
    if (!h) throw new Error("Betrieb nicht gefunden");
    const counts = new Map<string, number>();
    await purge(c, "hotels", "id = $1", [hotelId], counts);
    await record(c, actor, "hotel.deleted", hotelId, { name: h.name, status: h.status, rows: Object.fromEntries(counts) });
    return counts;
  });
}

/** Benutzer löschen (samt Passkeys, 2FA, Mitgliedschaften). Betriebe bleiben bestehen. Plattform-Admins nie. */
export async function deleteUserAccount(userId: string, actor: string): Promise<Map<string, number>> {
  return inTx(async (c) => {
    const u = (await c.query(`SELECT id, email, is_platform_admin FROM users WHERE id = $1`, [userId])).rows[0];
    if (!u) throw new Error("Benutzer nicht gefunden");
    if (u.is_platform_admin) throw new Error("Plattform-Admins werden nicht gelöscht");
    const counts = new Map<string, number>();
    await purge(c, "users", "id = $1", [userId], counts);
    await record(c, actor, "user.deleted", userId, { email: u.email, rows: Object.fromEntries(counts) });
    return counts;
  });
}

export const findUserByEmail = async (email: string) =>
  (await pool().query(`SELECT id, email, is_platform_admin FROM users WHERE lower(email) = lower($1)`, [email])).rows[0] as { id: string; email: string; is_platform_admin: boolean } | undefined;

export const soleHotelsOf = async (userId: string) =>
  (await pool().query(
    `SELECT h.id, h.name, h.status FROM hotel_members m JOIN hotels h ON h.id = m.hotel_id
      WHERE m.user_id = $1 AND NOT EXISTS (SELECT 1 FROM hotel_members m2 WHERE m2.hotel_id = h.id AND m2.user_id <> $1)`, [userId])).rows as { id: string; name: string; status: string }[];

/**
 * Sicherheit eines Benutzers zurücksetzen (Support, z. B. Handy und Wiederherstellungscodes verloren):
 * Passkeys, Authenticator-App und Wiederherstellungscodes werden entfernt, «Nur Passkey» wird aufgehoben.
 * Danach kommt die Person wieder per E-Mail-Link hinein und richtet alles neu ein.
 */
export async function resetUserSecurity(userId: string, actor: string): Promise<void> {
  await inTx(async (c) => {
    const u = (await c.query(`SELECT email FROM users WHERE id = $1`, [userId])).rows[0];
    if (!u) throw new Error("Benutzer nicht gefunden");
    await c.query(`DELETE FROM user_passkeys WHERE user_id = $1`, [userId]);
    await c.query(`DELETE FROM user_totp WHERE user_id = $1`, [userId]);
    await c.query(`DELETE FROM user_recovery_codes WHERE user_id = $1`, [userId]);
    await c.query(`UPDATE users SET email_login_disabled = false WHERE id = $1`, [userId]);
    await record(c, actor, "user.security_reset", userId, { email: u.email });
  });
}
