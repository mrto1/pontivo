import { UserError } from "../domain/errors";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, rows, type Executor } from "../db/client";
import { dayCloses, type DayClose, type DayTotals, type Hotel } from "../db/schema";
import { todayIn } from "../domain/dates";
import { audit } from "./audit";

/**
 * Tagesabschluss (SPEC 19.1): Summen eines Tages (Zahlungen vor Ort, Online-Zahlungen, ausgestellte Rechnungen mit MWST),
 * Kassenzählung (Bargeld) mit Differenz. Ein abgeschlossener Tag ist gesperrt: keine neuen Zahlungen und Rechnungen mit diesem Datum.
 * Korrekturen gehören auf den heutigen Tag (Gegenbuchung, Gutschrift). Abschlüsse werden nie geändert oder gelöscht.
 */
export class DayCloseError extends UserError {}
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function isDayClosed(ex: Executor, hotelId: string, day: string): Promise<boolean> {
  const [r] = await ex.select({ id: dayCloses.id }).from(dayCloses).where(and(eq(dayCloses.hotelId, hotelId), eq(dayCloses.day, day)));
  return !!r;
}

/** Wirft, wenn der Tag abgeschlossen ist (wird bei Zahlung vor Ort und beim Ausstellen von Rechnungen aufgerufen). */
export async function assertDayOpen(ex: Executor, hotelId: string, day: string): Promise<void> {
  if (await isDayClosed(ex, hotelId, day)) throw new DayCloseError(`Der Tag ${day} ist abgeschlossen. Bitte auf den heutigen Tag buchen (Gegenbuchung bzw. Gutschrift).`);
}

export async function dayTotals(ex: Executor, hotel: Pick<Hotel, "id" | "timezone">, day: string): Promise<DayTotals> {
  if (!DAY.test(day)) throw new DayCloseError("Ungültiges Datum.");
  const onsiteRows = rows<{ method: string; sum: string }>(await ex.execute(sql`
    SELECT method, SUM(amount_rappen)::text AS sum FROM onsite_payments WHERE hotel_id = ${hotel.id} AND received_on = ${day}::date GROUP BY method`));
  const onsite: Record<string, number> = {};
  for (const r of onsiteRows) onsite[r.method] = Number(r.sum);
  // Online (Stripe): erfolgreiche Zahlungen, nach Datum im Zeitzonen des Betriebs, abzüglich Rückerstattungen am selben Eintrag
  const [on] = rows<{ sum: string | null }>(await ex.execute(sql`
    SELECT COALESCE(SUM(amount_rappen - refunded_rappen), 0)::text AS sum FROM payments
    WHERE hotel_id = ${hotel.id} AND status = 'succeeded' AND (created_at AT TIME ZONE ${hotel.timezone})::date = ${day}::date`));
  const inv = rows<{ kind: string; n: string }>(await ex.execute(sql`
    SELECT kind, COUNT(*)::text AS n FROM invoices WHERE hotel_id = ${hotel.id} AND status = 'issued' AND issued_on = ${day}::date GROUP BY kind`));
  const lines = rows<{ vat_bps: number; gross: string }>(await ex.execute(sql`
    SELECT l.vat_bps, SUM(l.amount_rappen)::text AS gross FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
    WHERE i.hotel_id = ${hotel.id} AND i.status = 'issued' AND i.issued_on = ${day}::date GROUP BY l.vat_bps`));
  const vatByBps: Record<string, number> = {};
  let gross = 0;
  for (const l of lines) {
    const g = Number(l.gross);
    gross += g;
    vatByBps[String(l.vat_bps)] = l.vat_bps > 0 ? Math.round((g * l.vat_bps) / (10000 + l.vat_bps)) : 0;
  }
  return {
    onsite,
    online: Number(on?.sum ?? 0),
    invoices: { count: Number(inv.find((r) => r.kind === "invoice")?.n ?? 0), creditNotes: Number(inv.find((r) => r.kind === "credit_note")?.n ?? 0), grossRappen: gross, vatByBps },
  };
}

export async function closeDay(hotel: Hotel, day: string, input: { cashCountedRappen: number | null; note?: string }, actor: string, now = new Date()): Promise<DayClose> {
  if (!DAY.test(day)) throw new DayCloseError("Ungültiges Datum.");
  if (day > todayIn(hotel.timezone, now)) throw new DayCloseError("Ein Tag in der Zukunft kann nicht abgeschlossen werden.");
  if (input.cashCountedRappen !== null && (!Number.isInteger(input.cashCountedRappen) || input.cashCountedRappen < 0 || input.cashCountedRappen > 100_000_000)) throw new DayCloseError("Ungültiger Betrag für die Kassenzählung.");
  return db().transaction(async (tx) => {
    // Pro Betrieb nacheinander: verhindert zwei gleichzeitige Abschlüsse
    await tx.execute(sql`SELECT id FROM hotels WHERE id = ${hotel.id} FOR UPDATE`);
    if (await isDayClosed(tx, hotel.id, day)) throw new DayCloseError("Dieser Tag ist schon abgeschlossen.");
    const totals = await dayTotals(tx, hotel, day);
    const expected = totals.onsite.cash ?? 0;
    const diff = input.cashCountedRappen === null ? 0 : input.cashCountedRappen - expected;
    const [row] = await tx.insert(dayCloses).values({
      hotelId: hotel.id, day, totals, cashExpectedRappen: expected, cashCountedRappen: input.cashCountedRappen, differenceRappen: diff,
      note: (input.note ?? "").trim().slice(0, 500), closedBy: actor, closedAt: now,
    }).returning();
    await audit(tx, { hotelId: hotel.id, actor, action: "day.close", entity: "day_close", entityId: row.id, details: { day, difference: diff } });
    return row;
  });
}

export async function listDayCloses(hotelId: string, limit = 60): Promise<DayClose[]> {
  return db().select().from(dayCloses).where(eq(dayCloses.hotelId, hotelId)).orderBy(desc(dayCloses.day)).limit(limit);
}
export async function getDayClose(hotelId: string, day: string): Promise<DayClose | null> {
  const [r] = await db().select().from(dayCloses).where(and(eq(dayCloses.hotelId, hotelId), eq(dayCloses.day, day)));
  return r ?? null;
}
