/** Tagesabrechnung der Online-Verkäufe (SPEC 20.8): reine Logik */
export type SaleReceipt = { day: string; totalRappen: number; vat: { bps: number; grossRappen: number; vatRappen: number; netRappen: number }[]; payments: { method: string; amountRappen: number }[]; feeRappen: number };
export type SaleDay = { day: string; count: number; totalRappen: number; cardRappen: number; cashRappen: number; feeRappen: number; vat: { bps: number; grossRappen: number; vatRappen: number; netRappen: number }[] };

export function salesByDay(list: SaleReceipt[]): SaleDay[] {
  const days = new Map<string, SaleDay>();
  for (const r of list) {
    const d = days.get(r.day) ?? { day: r.day, count: 0, totalRappen: 0, cardRappen: 0, cashRappen: 0, feeRappen: 0, vat: [] };
    d.count++; d.totalRappen += r.totalRappen; d.feeRappen += r.feeRappen;
    for (const p of r.payments) if (p.method === "cash") d.cashRappen += p.amountRappen; else d.cardRappen += p.amountRappen;
    for (const v of r.vat) {
      const row = d.vat.find((x) => x.bps === v.bps);
      if (row) { row.grossRappen += v.grossRappen; row.vatRappen += v.vatRappen; row.netRappen += v.netRappen; } else d.vat.push({ ...v });
    }
    days.set(r.day, d);
  }
  return [...days.values()].map((d) => ({ ...d, vat: d.vat.sort((a, b) => b.bps - a.bps) })).sort((a, b) => a.day.localeCompare(b.day));
}

/** Summe über mehrere Tage (Fusszeile) */
export function salesTotal(days: SaleDay[]): Omit<SaleDay, "day"> {
  const t = salesByDay(days.map((d) => ({ day: "", totalRappen: d.totalRappen, feeRappen: d.feeRappen, vat: d.vat, payments: [{ method: "card", amountRappen: d.cardRappen }, { method: "cash", amountRappen: d.cashRappen }] })))[0];
  const count = days.reduce((a, d) => a + d.count, 0);
  return t ? { ...t, count } : { count: 0, totalRappen: 0, cardRappen: 0, cashRappen: 0, feeRappen: 0, vat: [] };
}

const chf = (r: number) => (r / 100).toFixed(2);
const q = (s: string | number) => { const v = String(s); return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };

/** CSV je Tag und MWST-Satz (Semikolon, UTF-8 mit BOM) */
export function salesCsv(days: SaleDay[]): string {
  const head = ["Datum", "Bestellungen", "Total", "Online bezahlt", "Bar", "MWST-Satz %", "Brutto Satz", "Netto Satz", "MWST", "Plattformgebühr"];
  const body: string[] = [];
  for (const d of days) {
    const rows = d.vat.length ? d.vat : [{ bps: 0, grossRappen: d.totalRappen, vatRappen: 0, netRappen: d.totalRappen }];
    rows.forEach((v, i) => body.push([d.day, i ? "" : d.count, i ? "" : chf(d.totalRappen), i ? "" : chf(d.cardRappen), i ? "" : chf(d.cashRappen), (v.bps / 100).toFixed(1), chf(v.grossRappen), chf(v.netRappen), chf(v.vatRappen), i ? "" : chf(d.feeRappen)].map(q).join(";")));
  }
  return "﻿" + [head.join(";"), ...body].join("\r\n") + "\r\n";
}
