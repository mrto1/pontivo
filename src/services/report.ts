import { UserError } from "../domain/errors";
import { sql } from "drizzle-orm";
import { db, rows } from "../db/client";
import { bpsOf } from "../domain/money";

/**
 * Monatsabrechnung (SPEC 9): pro Monat Buchungen nach Quelle, Umsatz, Plattformgebühr, Rückerstattungen.
 */
// ASSUMPTION: Stichtag ist der Bestätigungszeitpunkt (confirmed_at, Hotelzeitzone) – so wird auch die Plattformgebühr
// verrechnet. Rückerstattungen zählen im Monat der Stornierung. Die Gebühr wird bei Rückerstattung anteilig
// zurückgegeben (refund_application_fee), daher: Netto-Gebühr = Gebühr × (1 − erstattet / bezahlt).

export type ReportLine = {
  id: string;
  reference: string;
  source: string;
  status: string;
  checkin: string;
  checkout: string;
  nights: number;
  guest: string;
  total_rappen: number;
  tourist_tax_rappen: number;
  fee_rappen: number;
  refunded_rappen: number;
  net_fee_rappen: number;
  confirmed_local: string;
};

export type ReportSummary = {
  source: string;
  bookings: number;
  nights: number;
  revenue_rappen: number;
  tourist_tax_rappen: number;
  refunded_rappen: number;
  fee_rappen: number;
  net_fee_rappen: number;
};

export function isMonth(s: string | undefined | null): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export async function monthlyReport(hotelId: string, month: string) {
  if (!isMonth(month)) throw new UserError("Monat im Format YYYY-MM");
  const lines = rows<Omit<ReportLine, "net_fee_rappen">>(
    await db().execute(sql`
      SELECT b.id, b.reference, b.source, b.status, b.checkin::text, b.checkout::text,
             (b.checkout - b.checkin)::int AS nights,
             coalesce(g.first_name || ' ' || g.last_name, '') AS guest,
             b.total_rappen, b.tourist_tax_rappen, b.platform_fee_rappen AS fee_rappen,
             coalesce((SELECT sum(p.refunded_rappen) FROM payments p WHERE p.booking_id = b.id), 0)::int AS refunded_rappen,
             to_char(b.confirmed_at AT TIME ZONE h.timezone, 'YYYY-MM-DD HH24:MI') AS confirmed_local
        FROM bookings b
        JOIN hotels h ON h.id = b.hotel_id
        LEFT JOIN guests g ON g.id = b.guest_id
       WHERE b.hotel_id = ${hotelId}
         AND b.confirmed_at IS NOT NULL
         AND to_char(b.confirmed_at AT TIME ZONE h.timezone, 'YYYY-MM') = ${month}
       ORDER BY b.confirmed_at`),
  ).map((l) => ({
    ...l,
    net_fee_rappen: l.total_rappen > 0 ? l.fee_rappen - bpsOf(l.fee_rappen, Math.round((l.refunded_rappen * 10000) / l.total_rappen)) : l.fee_rappen,
  }));

  const bySource = new Map<string, ReportSummary>();
  for (const l of lines) {
    const s = bySource.get(l.source) ?? { source: l.source, bookings: 0, nights: 0, revenue_rappen: 0, tourist_tax_rappen: 0, refunded_rappen: 0, fee_rappen: 0, net_fee_rappen: 0 };
    s.bookings++;
    s.nights += l.nights;
    s.revenue_rappen += l.total_rappen;
    s.tourist_tax_rappen += l.tourist_tax_rappen;
    s.refunded_rappen += l.refunded_rappen;
    s.fee_rappen += l.fee_rappen;
    s.net_fee_rappen += l.net_fee_rappen;
    bySource.set(l.source, s);
  }
  const summary = [...bySource.values()].sort((a, b) => b.revenue_rappen - a.revenue_rappen);
  const total = summary.reduce(
    (t, s) => ({
      source: "total",
      bookings: t.bookings + s.bookings,
      nights: t.nights + s.nights,
      revenue_rappen: t.revenue_rappen + s.revenue_rappen,
      tourist_tax_rappen: t.tourist_tax_rappen + s.tourist_tax_rappen,
      refunded_rappen: t.refunded_rappen + s.refunded_rappen,
      fee_rappen: t.fee_rappen + s.fee_rappen,
      net_fee_rappen: t.net_fee_rappen + s.net_fee_rappen,
    }),
    { source: "total", bookings: 0, nights: 0, revenue_rappen: 0, tourist_tax_rappen: 0, refunded_rappen: 0, fee_rappen: 0, net_fee_rappen: 0 },
  );
  return { month, lines, summary, total };
}

const chf = (r: number) => (r / 100).toFixed(2);

/** CSV (Semikolon, für Excel CH) mit BOM */
export function reportCsv(r: Awaited<ReturnType<typeof monthlyReport>>): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Referenz", "Bestätigt", "Quelle", "Status", "Anreise", "Abreise", "Nächte", "Gast", "Total CHF", "davon Kurtaxe CHF", "Erstattet CHF", "Gebühr CHF", "Gebühr netto CHF"];
  const lines = r.lines.map((l) =>
    [l.reference, l.confirmed_local, l.source, l.status, l.checkin, l.checkout, l.nights, l.guest, chf(l.total_rappen), chf(l.tourist_tax_rappen), chf(l.refunded_rappen), chf(l.fee_rappen), chf(l.net_fee_rappen)].map(esc).join(";"),
  );
  const t = r.total;
  lines.push(["Total", "", "", "", "", "", t.nights, "", chf(t.revenue_rappen), chf(t.tourist_tax_rappen), chf(t.refunded_rappen), chf(t.fee_rappen), chf(t.net_fee_rappen)].map(esc).join(";"));
  return "﻿" + [head.join(";"), ...lines].join("\r\n") + "\r\n";
}
