/**
 * Testkonto samt Betrieb(en) vollständig löschen (nur für Tests, nicht rückgängig zu machen).
 *   node --import tsx scripts/delete-test-account.ts <email>          zeigt nur, was gelöscht würde
 *   node --import tsx scripts/delete-test-account.ts <email> --yes    löscht
 * Betriebe, in denen noch andere Personen Mitglied sind, bleiben erhalten (nur die Mitgliedschaft fällt weg).
 * Betriebe im Status «live» werden nur mit --include-live gelöscht.
 */
import type pg from "pg";
import { closeDb, pool } from "../src/db/client";

const [email, ...flags] = process.argv.slice(2);
const yes = flags.includes("--yes");
const includeLive = flags.includes("--include-live");
if (!email || !/@/.test(email)) {
  console.error("Aufruf: node --import tsx scripts/delete-test-account.ts <email> [--yes] [--include-live]");
  process.exit(1);
}

type Fk = { child: string; childCol: string; parentCol: string };

/** Fremdschlüssel, die auf `table` zeigen (einspaltig; reicht für dieses Schema) */
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

/** Zeilen von `table` (Bedingung `where`) samt aller abhängigen Zeilen löschen; zählt je Tabelle */
async function purge(c: pg.PoolClient, table: string, where: string, params: unknown[], counts: Map<string, number>, depth = 0): Promise<void> {
  if (depth > 8) throw new Error(`Zu tiefe Abhängigkeit bei ${table}`);
  for (const fk of await fksTo(c, table)) {
    if (fk.child === table) continue; // Selbstbezug: wird mit der Zeile selbst gelöscht
    await purge(c, fk.child, `"${fk.childCol}" IN (SELECT "${fk.parentCol}" FROM "${table}" WHERE ${where})`, params, counts, depth + 1);
  }
  const r = await c.query(`DELETE FROM "${table}" WHERE ${where}`, params);
  if (r.rowCount) counts.set(table, (counts.get(table) ?? 0) + r.rowCount);
}

async function main() {
  const c = await pool().connect();
  try {
    const u = (await c.query(`SELECT id, email, is_platform_admin FROM users WHERE lower(email) = lower($1)`, [email])).rows[0];
    if (!u) { console.log(`Kein Konto mit ${email}.`); return; }
    if (u.is_platform_admin) { console.error("Das ist ein Plattform-Admin. Das Skript löscht so ein Konto nicht."); process.exit(1); }

    const hotels = (await c.query(
      `SELECT h.id, h.name, h.status,
              (SELECT count(*) FROM hotel_members m2 WHERE m2.hotel_id = h.id AND m2.user_id <> $1)::int AS others
         FROM hotel_members m JOIN hotels h ON h.id = m.hotel_id WHERE m.user_id = $1`, [u.id])).rows;
    const del = hotels.filter((h) => h.others === 0 && (includeLive || h.status !== "live"));
    console.log(`Konto: ${u.email}`);
    for (const h of hotels) console.log(`  Betrieb «${h.name}» (${h.status}): ${del.includes(h) ? "wird gelöscht" : h.others > 0 ? "bleibt (andere Mitglieder)" : "bleibt (live, --include-live nötig)"}`);
    if (!yes) { console.log("\nNichts gelöscht. Zum Löschen --yes anhängen."); return; }

    await c.query("BEGIN");
    const counts = new Map<string, number>();
    for (const h of del) await purge(c, "hotels", `id = $1`, [h.id], counts);
    await purge(c, "users", `id = $1`, [u.id], counts);
    await c.query("COMMIT");
    console.log("\nGelöscht:");
    for (const [t, n] of [...counts].sort()) console.log(`  ${t}: ${n}`);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

main().then(closeDb, async (e) => { console.error(e); await closeDb(); process.exit(1); });
