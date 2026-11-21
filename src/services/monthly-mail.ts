import { and, eq, sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { auditLog, hotelMembers, hotelModules, hotels, users, type Hotel } from "../db/schema";
import { addDays, todayIn } from "../domain/dates";
import { formatChf } from "../domain/money";
import { changePct, monthLabelDe, summarize, worthSending, type MonthStats } from "../domain/monthly";
import { enqueueEmail } from "../email/enqueue";
import { audit } from "./audit";
import { shiftMonth } from "./overview";
import { monthlyReport } from "./report";

/** Auswertung eines Monats nur für Direktbuchungen: bestätigte Buchungen, Zimmerumsatz ohne Kurtaxe nach Rückerstattung, Plattformgebühr netto */
export async function monthStats(hotelId: string, month: string): Promise<MonthStats> {
  const r = await monthlyReport(hotelId, month);
  const d = r.summary.find((s) => s.source === "direct");
  if (!d) return { bookings: 0, nights: 0, revenueRappen: 0, feeRappen: 0 };
  const lines = r.lines.filter((l) => l.source === "direct" && l.status === "confirmed");
  return {
    bookings: lines.length,
    nights: lines.reduce((n, l) => n + l.nights, 0),
    revenueRappen: Math.max(0, d.revenue_rappen - d.tourist_tax_rappen - d.refunded_rappen),
    feeRappen: d.net_fee_rappen,
  };
}

/** Monatsmail ist eine Funktion (Einstellungen → Funktionen, Modul `monthlymail`, Standard aus; SPEC 19.47) */
export async function monthlyMailEnabled(hotelId: string): Promise<boolean> {
  const [m] = await db().select({ enabled: hotelModules.enabled }).from(hotelModules).where(and(eq(hotelModules.hotelId, hotelId), eq(hotelModules.module, "monthlymail")));
  return !!m?.enabled;
}

export async function setMonthlyMail(hotel: Pick<Hotel, "id">, on: boolean, actor: string) {
  await db().transaction(async (tx) => {
    await tx.insert(hotelModules).values({ hotelId: hotel.id, module: "monthlymail", enabled: on }).onConflictDoUpdate({ target: [hotelModules.hotelId, hotelModules.module], set: { enabled: on } });
    await audit(tx, { hotelId: hotel.id, actor, action: `module.monthlymail.${on ? "on" : "off"}`, entity: "hotel", entityId: hotel.id, details: { on } });
  });
}

/**
 * Job «monthly-mail» (am 2. des Monats): an die Inhaber jedes online geschalteten Betriebs eine kurze Auswertung des Vormonats.
 * Einmal je Betrieb und Monat (Eintrag im Protokoll), nicht wenn der Betrieb sie ausgeschaltet hat oder nichts zu berichten ist.
 */
export async function monthlyMailJob(now = new Date()): Promise<{ hotels: number; mails: number }> {
  const month = shiftMonth(todayIn("Europe/Zurich", now).slice(0, 7), -1);
  const list = await db().select().from(hotels).where(eq(hotels.status, "live"));
  let sentHotels = 0, mails = 0;
  for (const h of list) {
    if (!(await monthlyMailEnabled(h.id))) continue;
    const [done] = await db().select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.hotelId, h.id), eq(auditLog.action, "mail.monthly"), sql`${auditLog.details}->>'month' = ${month}`));
    if (done) continue;
    const today = todayIn(h.timezone, now);
    const [up] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM bookings WHERE hotel_id = ${h.id} AND status = 'confirmed' AND checkin >= ${today}::date AND checkin <= ${addDays(today, 30)}::date`));
    const s = summarize(month, await monthStats(h.id, month), await monthStats(h.id, shiftMonth(month, -1)), up.n);
    if (!worthSending(s)) continue;
    const owners = await db().select({ email: users.email, name: users.name }).from(hotelMembers).innerJoin(users, eq(users.id, hotelMembers.userId))
      .where(and(eq(hotelMembers.hotelId, h.id), eq(hotelMembers.role, "owner")));
    const recipients = owners.length ? owners : [{ email: h.contactEmail, name: null }];
    await db().transaction(async (tx) => {
      for (const o of recipients) {
        await enqueueEmail(tx, { hotelId: h.id, template: "host_monthly", to: o.email, language: "de", data: {
          month: monthLabelDe(month), monthKey: month, name: o.name ?? "", bookings: s.cur.bookings, nights: s.cur.nights, revenue: formatChf(s.cur.revenueRappen), fee: formatChf(s.cur.feeRappen),
          prevBookings: s.prev.bookings, change: changePct(s.cur.bookings, s.prev.bookings), saved: s.savedRappen > 0 ? formatChf(s.savedRappen) : "", upcoming: s.upcomingArrivals,
        } });
        mails++;
      }
      await audit(tx, { hotelId: h.id, actor: "system", action: "mail.monthly", entity: "hotel", entityId: h.id, details: { month, recipients: recipients.length } });
    });
    sentHotels++;
  }
  return { hotels: sentHotels, mails };
}
