/** Auswertung Restaurant (SPEC 19.56): reine Aggregation, ohne I/O. Geld in Rappen. */
export interface StatReceipt { orderId: string; totalRappen: number; tipRappen: number; paidAt: Date }
export interface StatOrder { id: string; tableId: string | null; openedAt: Date }
export interface StatTable { id: string; name: string; waiterId: string | null }
export interface StatWaiter { id: string; name: string }
export interface StatRes { time: string; party: number; status: string }
export interface StatFeedback { stars: number; comment: string }

export interface Row { id: string; name: string; revenueRappen: number; tipRappen: number; receipts: number; avgStayMin: number | null }
export interface DiningStats {
  totalRappen: number; tipRappen: number; receipts: number;
  tables: Row[]; waiters: Row[]; avgStayMin: number | null;
  guestsByHour: { hour: number; guests: number }[];
  reservations: { total: number; noShow: number; noShowPct: number };
  feedback: { count: number; avgStars: number | null; low: StatFeedback[] };
}

/** Bestellungen länger offen als dies zählen nicht zur Verweildauer (vergessene Bestellungen). ASSUMPTION */
export const MAX_STAY_MIN = 480;
const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);

export function aggregate(i: { receipts: StatReceipt[]; orders: StatOrder[]; tables: StatTable[]; waiters: StatWaiter[]; reservations: StatRes[]; feedback: StatFeedback[] }): DiningStats {
  const orderOf = new Map(i.orders.map((o) => [o.id, o]));
  const tableOf = new Map(i.tables.map((t) => [t.id, t]));
  const rev = new Map<string, { rev: number; tip: number; n: number }>();
  const lastPaid = new Map<string, Date>();
  let total = 0, tips = 0;
  for (const r of i.receipts) {
    total += r.totalRappen; tips += r.tipRappen;
    const o = orderOf.get(r.orderId);
    const lp = lastPaid.get(r.orderId);
    if (!lp || r.paidAt > lp) lastPaid.set(r.orderId, r.paidAt);
    if (!o?.tableId) continue;
    const cur = rev.get(o.tableId) ?? { rev: 0, tip: 0, n: 0 };
    cur.rev += r.totalRappen; cur.tip += r.tipRappen; cur.n += 1;
    rev.set(o.tableId, cur);
  }
  const stays = new Map<string, number[]>();
  for (const [oid, paid] of lastPaid) {
    const o = orderOf.get(oid);
    if (!o?.tableId) continue;
    const m = (paid.getTime() - o.openedAt.getTime()) / 60000;
    if (m < 1 || m > MAX_STAY_MIN) continue;
    stays.set(o.tableId, [...(stays.get(o.tableId) ?? []), m]);
  }
  const tableRows: Row[] = [...rev.entries()].map(([id, v]) => ({ id, name: tableOf.get(id)?.name ?? "?", revenueRappen: v.rev, tipRappen: v.tip, receipts: v.n, avgStayMin: avg(stays.get(id) ?? []) }))
    .sort((a, b) => b.revenueRappen - a.revenueRappen);
  const wRows = new Map<string, { rev: number; tip: number; n: number; stays: number[] }>();
  for (const r of tableRows) {
    const wid = tableOf.get(r.id)?.waiterId ?? "";
    const c = wRows.get(wid) ?? { rev: 0, tip: 0, n: 0, stays: [] };
    c.rev += r.revenueRappen; c.tip += r.tipRappen; c.n += r.receipts;
    c.stays.push(...(stays.get(r.id) ?? []));
    wRows.set(wid, c);
  }
  const wName = new Map(i.waiters.map((w) => [w.id, w.name]));
  const waiters: Row[] = [...wRows.entries()].map(([id, v]) => ({ id, name: id ? wName.get(id) ?? "?" : "Ohne Kellner", revenueRappen: v.rev, tipRappen: v.tip, receipts: v.n, avgStayMin: avg(v.stays) }))
    .sort((a, b) => b.revenueRappen - a.revenueRappen);
  const hours = new Map<number, number>();
  let resTotal = 0, noShow = 0;
  for (const r of i.reservations) {
    if (r.status === "cancelled") continue;
    resTotal++;
    if (r.status === "noshow") noShow++; else hours.set(Number(r.time.slice(0, 2)), (hours.get(Number(r.time.slice(0, 2))) ?? 0) + r.party);
  }
  const allStays = [...stays.values()].flat();
  return {
    totalRappen: total, tipRappen: tips, receipts: i.receipts.length, tables: tableRows, waiters, avgStayMin: avg(allStays),
    guestsByHour: [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([hour, guests]) => ({ hour, guests })),
    reservations: { total: resTotal, noShow, noShowPct: resTotal ? Math.round((noShow / resTotal) * 1000) / 10 : 0 },
    feedback: { count: i.feedback.length, avgStars: i.feedback.length ? Math.round((i.feedback.reduce((a, f) => a + f.stars, 0) / i.feedback.length) * 10) / 10 : null, low: i.feedback.filter((f) => f.stars <= 3 && f.comment).slice(0, 10) },
  };
}
