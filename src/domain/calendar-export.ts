import { addDays, weekday } from "./dates";

export type CalExportData = {
  roomTypes: { id: string; name: string }[];
  ratePlans: { id: string; roomTypeId: string; name: string }[];
  inventory: { roomTypeId: string; night: string; total: number; booked: number; blocked: number; externalBlocked: number }[];
  rates: { ratePlanId: string; night: string; priceRappen: number; minStayArrival: number; closedToArrival: boolean; closedToDeparture: boolean; stopSell: boolean }[];
};

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const q = (s: string | number) => { const v = String(s); return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
const yn = (b: boolean) => (b ? "ja" : "nein");

/** CSV (Semikolon, UTF-8 mit BOM): eine Zeile je Tag und Rateplan, Zimmerzahlen je Zimmertyp wiederholt. Preise mit Punkt. */
export function calendarCsv(d: CalExportData, from: string, to: string): string {
  const head = ["Datum", "Wochentag", "Zimmertyp", "Zimmer gesamt", "gebucht", "gesperrt", "extern belegt", "frei", "Rateplan", "Preis", "Mindestnächte", "Anreise gesperrt", "Abreise gesperrt", "Verkaufsstopp"];
  const inv = new Map(d.inventory.map((i) => [`${i.roomTypeId}|${i.night}`, i]));
  const rate = new Map(d.rates.map((r) => [`${r.ratePlanId}|${r.night}`, r]));
  const lines: string[] = [head.join(";")];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    for (const rt of d.roomTypes) {
      const i = inv.get(`${rt.id}|${day}`);
      const base = [day, WD[weekday(day)], rt.name, i ? i.total : "", i ? i.booked : "", i ? i.blocked : "", i ? i.externalBlocked : "", i ? i.total - i.booked - i.blocked - i.externalBlocked : ""];
      const plans = d.ratePlans.filter((p) => p.roomTypeId === rt.id);
      if (!plans.length) lines.push([...base, "", "", "", "", "", ""].map(q).join(";"));
      for (const p of plans) {
        const r = rate.get(`${p.id}|${day}`);
        lines.push([...base, p.name, r ? (r.priceRappen / 100).toFixed(2) : "", r ? r.minStayArrival : "", r ? yn(r.closedToArrival) : "", r ? yn(r.closedToDeparture) : "", r ? yn(r.stopSell) : ""].map(q).join(";"));
      }
    }
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
