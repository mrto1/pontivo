import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, rows } from "../db/client";
import { hotels, type Hotel } from "../db/schema";
import { bpsOf } from "../domain/money";
import { todayIn } from "../domain/dates";
import { audit } from "./audit";

/**
 * Übersicht «Ihr Nutzen»: Direktbuchungen, gesparte Portal-Provision, Direktanteil.
 *
 * Ersparnis = Zimmerumsatz der Direktbuchungen × Portal-Provision − Pontivo-Gebühr (netto nach Rückerstattung).
 */
// ASSUMPTION: Gezählt wird wie in der Monatsabrechnung nach Bestätigungsmonat (Hotelzeitzone), nur Buchungen mit
// Status confirmed oder no_show (stornierte zählen nicht). Grundlage der Provision ist der Zimmerpreis ohne Kurtaxe.
// Kartengebühren (Stripe) werden nicht abgezogen, weil sie bei Portalen oft ebenfalls anfallen.

export const PERIODS = ["month", "last", "year", "12m"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABEL: Record<Period, string> = { month: "Dieser Monat", last: "Letzter Monat", year: "Dieses Jahr", "12m": "Letzte 12 Monate" };

export const DEFAULT_OTA_COMMISSION_BPS = 1500;
export const otaCommissionBps = (h: Hotel) => h.content.otaCommissionBps ?? DEFAULT_OTA_COMMISSION_BPS;

const PORTALS = ["booking_com", "expedia", "airbnb", "other_ota"];

export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Monate (YYYY-MM, aufsteigend) eines Zeitraums, bezogen auf heute in der Hotelzeitzone */
export function periodMonths(period: Period, today: string): string[] {
  const cur = today.slice(0, 7);
  if (period === "month") return [cur];
  if (period === "last") return [shiftMonth(cur, -1)];
  const n = period === "year" ? Number(cur.slice(5, 7)) : 12;
  return Array.from({ length: n }, (_, i) => shiftMonth(cur, i - n + 1));
}

export type MonthRow = { month: string; direct: number; portal: number; admin: number };

export type Overview = {
  period: Period;
  months: string[];
  commissionBps: number;
  direct: { bookings: number; nights: number; roomsRappen: number; totalRappen: number; feeRappen: number };
  portal: { bookings: number; nights: number; roomsRappen: number };
  admin: { bookings: number };
  /** gesparte Provision gegenüber Portal, nach Abzug der Pontivo-Gebühr */
  savedRappen: number;
  /** Anteil Direktbuchungen an Online-Buchungen (direkt + Portale) in Prozent, null ohne Buchungen */
  directSharePct: number | null;
  vouchers: { sold: number; rappen: number };
  inquiries: number;
  /** immer die letzten 12 Monate, für die Grafik */
  chart: MonthRow[];
};

export async function overview(hotel: Hotel, period: Period): Promise<Overview> {
  const today = todayIn(hotel.timezone);
  const months = periodMonths(period, today);
  const chartMonths = periodMonths("12m", today);
  const from = [months[0], chartMonths[0]].sort()[0];
  const to = months[months.length - 1];

  const lines = rows<{ month: string; source: string; nights: number; rooms_total_rappen: number; total_rappen: number; fee_rappen: number; refunded_rappen: number }>(
    await db().execute(sql`
      SELECT to_char(b.confirmed_at AT TIME ZONE h.timezone, 'YYYY-MM') AS month, b.source,
             (b.checkout - b.checkin)::int AS nights, b.rooms_total_rappen, b.total_rappen, b.platform_fee_rappen AS fee_rappen,
             coalesce((SELECT sum(p.refunded_rappen) FROM payments p WHERE p.booking_id = b.id), 0)::int AS refunded_rappen
        FROM bookings b JOIN hotels h ON h.id = b.hotel_id
       WHERE b.hotel_id = ${hotel.id}
         AND b.status IN ('confirmed', 'no_show')
         AND b.confirmed_at IS NOT NULL
         AND to_char(b.confirmed_at AT TIME ZONE h.timezone, 'YYYY-MM') BETWEEN ${from} AND ${to}`),
  );

  const inPeriod = new Set(months);
  const o: Overview = {
    period, months, commissionBps: otaCommissionBps(hotel),
    direct: { bookings: 0, nights: 0, roomsRappen: 0, totalRappen: 0, feeRappen: 0 },
    portal: { bookings: 0, nights: 0, roomsRappen: 0 },
    admin: { bookings: 0 },
    savedRappen: 0, directSharePct: null,
    vouchers: { sold: 0, rappen: 0 }, inquiries: 0,
    chart: chartMonths.map((month) => ({ month, direct: 0, portal: 0, admin: 0 })),
  };
  const chartBy = new Map(o.chart.map((r) => [r.month, r]));

  for (const l of lines) {
    const kind = l.source === "direct" ? "direct" : PORTALS.includes(l.source) ? "portal" : "admin";
    const c = chartBy.get(l.month);
    if (c) c[kind]++;
    if (!inPeriod.has(l.month)) continue;
    if (kind === "direct") {
      const netFee = l.total_rappen > 0 ? l.fee_rappen - bpsOf(l.fee_rappen, Math.round((l.refunded_rappen * 10000) / l.total_rappen)) : l.fee_rappen;
      o.direct.bookings++;
      o.direct.nights += l.nights;
      o.direct.roomsRappen += l.rooms_total_rappen;
      o.direct.totalRappen += l.total_rappen;
      o.direct.feeRappen += netFee;
    } else if (kind === "portal") {
      o.portal.bookings++;
      o.portal.nights += l.nights;
      o.portal.roomsRappen += l.rooms_total_rappen;
    } else o.admin.bookings++;
  }
  o.savedRappen = Math.max(0, bpsOf(o.direct.roomsRappen, o.commissionBps) - o.direct.feeRappen);
  const online = o.direct.bookings + o.portal.bookings;
  o.directSharePct = online ? Math.round((o.direct.bookings * 100) / online) : null;

  const [v] = rows<{ sold: number; rappen: number }>(
    await db().execute(sql`
      SELECT count(*)::int AS sold, coalesce(sum(v.amount_rappen), 0)::int AS rappen
        FROM vouchers v JOIN hotels h ON h.id = v.hotel_id
       WHERE v.hotel_id = ${hotel.id} AND v.paid_at IS NOT NULL
         AND to_char(v.paid_at AT TIME ZONE h.timezone, 'YYYY-MM') BETWEEN ${months[0]} AND ${to}`),
  );
  o.vouchers = v;
  const [q] = rows<{ n: number }>(
    await db().execute(sql`
      SELECT count(*)::int AS n FROM inquiries i JOIN hotels h ON h.id = i.hotel_id
       WHERE i.hotel_id = ${hotel.id}
         AND to_char(i.created_at AT TIME ZONE h.timezone, 'YYYY-MM') BETWEEN ${months[0]} AND ${to}`),
  );
  o.inquiries = q.n;
  return o;
}

export async function setOtaCommission(hotelId: string, bps: number, actor: string) {
  const v = z.number().int().min(0).max(3000).parse(bps);
  await db().transaction(async (tx) => {
    const [h] = await tx.select().from(hotels).where(eq(hotels.id, hotelId)).for("update");
    await tx.update(hotels).set({ content: { ...h.content, otaCommissionBps: v }, updatedAt: new Date() }).where(eq(hotels.id, hotelId));
    await audit(tx, { hotelId, actor, action: "hotel.ota_commission", entity: "hotel", entityId: hotelId, details: { from: h.content.otaCommissionBps ?? null, to: v } });
  });
}
