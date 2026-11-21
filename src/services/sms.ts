import { and, eq, lt, sql } from "drizzle-orm";
import { db, rows, type Executor } from "../db/client";
import { smsOutbox } from "../db/schema";
import { normalizePhone, sendSms, smsConfigured } from "../integrations/sms/aspsms";

/**
 * SMS-Outbox (SPEC 20.4): wie die Mail-Outbox; `ref` verhindert Doppelversand. Alarme an das Restaurant sind inklusive,
 * SMS an Gäste werden gezählt und zum Selbstkostenpreis weiterverrechnet (`billable`).
 */
export async function enqueueSms(ex: Executor, s: { hotelId: string; to: string; text: string; kind: "alarm" | "guest"; ref?: string }) {
  const to = normalizePhone(s.to);
  await ex.insert(smsOutbox).values({
    hotelId: s.hotelId, ref: s.ref ?? null, toPhone: to ?? s.to.slice(0, 40), text: s.text.slice(0, 459), kind: s.kind, billable: s.kind === "guest",
    status: to ? "pending" : "skipped", error: to ? null : "Telefonnummer unbrauchbar",
  }).onConflictDoNothing();
}

/** Fällige SMS senden (Job jede Minute). Ohne Zugangsdaten: übersprungen, damit nichts ewig wartet. */
export async function sendDueSms(): Promise<{ sent: number; failed: number; skipped: number }> {
  const due = await db().select().from(smsOutbox).where(and(eq(smsOutbox.status, "pending"), lt(smsOutbox.attempts, 3))).limit(50);
  let sent = 0, failed = 0, skipped = 0;
  for (const m of due) {
    if (!smsConfigured()) {
      await db().update(smsOutbox).set({ status: "skipped", error: "ASPSMS nicht eingerichtet" }).where(eq(smsOutbox.id, m.id));
      skipped++;
      continue;
    }
    const r = await sendSms(m.toPhone, m.text);
    if (r.ok) { await db().update(smsOutbox).set({ status: "sent", sentAt: new Date(), attempts: m.attempts + 1 }).where(eq(smsOutbox.id, m.id)); sent++; }
    else {
      const attempts = m.attempts + 1;
      await db().update(smsOutbox).set({ attempts, error: r.error, status: attempts >= 3 ? "failed" : "pending" }).where(eq(smsOutbox.id, m.id));
      failed++;
    }
  }
  return { sent, failed, skipped };
}

/** Gesendete, verrechenbare Gast-SMS eines Betriebs in einem Monat (Zeitzone Europe/Zurich) */
export async function billableSmsCount(hotelId: string, month: string): Promise<number> {
  const [r] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM sms_outbox WHERE hotel_id = ${hotelId} AND billable AND status = 'sent' AND to_char(sent_at AT TIME ZONE 'Europe/Zurich', 'YYYY-MM') = ${month}`));
  return r?.n ?? 0;
}
