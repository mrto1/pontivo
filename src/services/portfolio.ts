import { sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import type { Hotel } from "../db/schema";
import { todayIn } from "../domain/dates";

/** Übersicht für Gastgeber mit mehreren Betrieben (SPEC 9): eine Zeile pro Betrieb, nur für die übergebenen (zugänglichen) Betriebe. */
export type PortfolioRow = {
  hotelId: string;
  name: string;
  status: string;
  arrivals: number;
  departures: number;
  inHouse: number;
  newInquiries: number;
  monthBookings: number;
  monthRevenueRappen: number;
  setupOpen: boolean;
};

export async function portfolio(list: { hotel: Hotel }[], now = new Date()): Promise<PortfolioRow[]> {
  const out: PortfolioRow[] = [];
  for (const { hotel: h } of list) {
    const today = todayIn(h.timezone, now);
    const month = today.slice(0, 7);
    const [b] = rows<{ arrivals: number; departures: number; in_house: number; m_n: number; m_sum: number }>(await db().execute(sql`
      SELECT count(*) FILTER (WHERE status = 'confirmed' AND checkin = ${today}::date)::int AS arrivals,
             count(*) FILTER (WHERE status = 'confirmed' AND checkout = ${today}::date)::int AS departures,
             count(*) FILTER (WHERE status = 'confirmed' AND checkin <= ${today}::date AND checkout > ${today}::date)::int AS in_house,
             count(*) FILTER (WHERE status = 'confirmed' AND to_char(confirmed_at AT TIME ZONE ${h.timezone}, 'YYYY-MM') = ${month})::int AS m_n,
             coalesce(sum(total_rappen) FILTER (WHERE status = 'confirmed' AND to_char(confirmed_at AT TIME ZONE ${h.timezone}, 'YYYY-MM') = ${month}), 0)::bigint AS m_sum
        FROM bookings WHERE hotel_id = ${h.id}`));
    const [q] = rows<{ n: number }>(await db().execute(sql`SELECT count(*)::int AS n FROM inquiries WHERE hotel_id = ${h.id} AND status = 'new'`));
    out.push({
      hotelId: h.id, name: h.name, status: h.status,
      arrivals: b.arrivals, departures: b.departures, inHouse: b.in_house, newInquiries: q.n,
      monthBookings: b.m_n, monthRevenueRappen: Number(b.m_sum),
      setupOpen: !!h.onboarding.startedAt && !h.onboarding.completedAt,
    });
  }
  return out;
}
