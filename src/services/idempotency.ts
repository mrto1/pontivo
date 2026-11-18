import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { apiIdempotency, type ApiKey } from "../db/schema";

/**
 * Schutz gegen doppelte Aufrufe (SPEC 19.22): Header `Idempotency-Key` bei POST /bookings.
 * Gleicher Schlüssel und gleiche Anfrage → gleiche Antwort wie beim ersten Mal (nichts wird doppelt angelegt).
 * Gleicher Schlüssel, anderer Inhalt → 422. Läuft die erste Anfrage noch → 409. Gespeichert werden nur erfolgreiche Antworten (2xx);
 * nach einem Fehler darf mit demselben Schlüssel erneut versucht werden.
 */
export const IDEM_KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
export type IdemResult = { status: number; body: unknown; replayed: boolean };
const STALE_MS = 120_000;

export async function withIdempotency(key: ApiKey, idemKey: string | null, rawBody: string, run: () => Promise<{ status: number; body: unknown }>, now = new Date()): Promise<IdemResult> {
  if (!idemKey) return { ...(await run()), replayed: false };
  if (!IDEM_KEY_RE.test(idemKey)) return { status: 400, body: { error: "invalid_idempotency_key", message: "Idempotency-Key: 8 bis 128 Zeichen (Buchstaben, Ziffern, _ . : -)." }, replayed: false };
  const hash = crypto.createHash("sha256").update(rawBody).digest("hex");
  const claim = await db().insert(apiIdempotency).values({ hotelId: key.hotelId, keyId: key.id, idemKey, requestHash: hash }).onConflictDoNothing().returning({ id: apiIdempotency.id });
  let rowId = claim[0]?.id;
  if (!rowId) {
    const [row] = await db().select().from(apiIdempotency).where(and(eq(apiIdempotency.keyId, key.id), eq(apiIdempotency.idemKey, idemKey)));
    if (!row) return withIdempotency(key, idemKey, rawBody, run, now); // zwischenzeitlich gelöscht: neu versuchen
    if (row.requestHash !== hash) return { status: 422, body: { error: "idempotency_key_reused", message: "Dieser Idempotency-Key wurde mit anderem Inhalt verwendet." }, replayed: false };
    if (row.statusCode !== null) return { status: row.statusCode, body: row.response, replayed: true };
    if (now.getTime() - row.createdAt.getTime() < STALE_MS) return { status: 409, body: { error: "idempotency_in_progress", message: "Die erste Anfrage mit diesem Schlüssel läuft noch." }, replayed: false };
    // Erste Anfrage ist abgestürzt: übernehmen
    const took = await db().update(apiIdempotency).set({ createdAt: now }).where(and(eq(apiIdempotency.id, row.id), eq(apiIdempotency.createdAt, row.createdAt))).returning({ id: apiIdempotency.id });
    if (!took.length) return { status: 409, body: { error: "idempotency_in_progress", message: "Die erste Anfrage mit diesem Schlüssel läuft noch." }, replayed: false };
    rowId = row.id;
  }
  try {
    const r = await run();
    if (r.status >= 200 && r.status < 300) await db().update(apiIdempotency).set({ statusCode: r.status, response: r.body }).where(eq(apiIdempotency.id, rowId));
    else await db().execute(sql`DELETE FROM api_idempotency WHERE id = ${rowId}`);
    return { ...r, replayed: false };
  } catch (e) {
    await db().execute(sql`DELETE FROM api_idempotency WHERE id = ${rowId}`);
    throw e;
  }
}
