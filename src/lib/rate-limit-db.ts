import { pool } from "../db/client";

/**
 * Rate-Limit in der Datenbank (überlebt Neustarts, gilt über mehrere Instanzen): festes Zeitfenster je Schlüssel.
 * Atomar in einem Statement. Gibt true zurück, wenn die Anfrage noch erlaubt ist.
 * Schlüssel enthalten bei E-Mail-Adressen nur den Hash (keine Klartext-Adressen in der Tabelle).
 */
export async function rateLimitDb(key: string, limit: number, windowMs: number, now = new Date()): Promise<boolean> {
  const r = await pool().query(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $3, 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= $3::timestamptz - make_interval(secs => $2::double precision / 1000) THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= $3::timestamptz - make_interval(secs => $2::double precision / 1000) THEN $3::timestamptz ELSE rate_limits.window_start END
     RETURNING count`,
    [key, windowMs, now],
  );
  // gelegentlich aufräumen (1 %): alles älter als ein Tag
  if (Math.random() < 0.01) await pool().query(`DELETE FROM rate_limits WHERE window_start < $1::timestamptz - interval '1 day'`, [now]).catch(() => {});
  return r.rows[0].count <= limit;
}
