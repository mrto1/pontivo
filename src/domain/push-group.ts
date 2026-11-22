/**
 * Mitteilungen zusammenfassen (SPEC 20.1): Kommen im selben Versandlauf (Worker: jede Minute) mehrere gleichartige Meldungen
 * für einen Betrieb, geht eine Sammelmeldung raus («5 neue Bestellungen») statt fünf einzelner. Reine Logik.
 * Dringendes bleibt einzeln: Erinnerung «Bestellung wartet», Überbuchung, Storno und alles Sonstige.
 */
import type { PushKind } from "./push-kinds";

export type PushRowLite = { id: number; hotelId: string; dedupeKey: string; kind: PushKind; title: string; body: string; url: string; attempts: number };
export type PushUnit = { ids: number[]; hotelId: string; kind: PushKind; title: string; body: string; url: string; tag: string; attempts: number };

/** Nur «neue …»-Ereignisse werden zusammengefasst */
const GROUPABLE = ["order:", "reservation:", "inquiry:", "inbox:", "guest_request:", "booking_new:"];
const NOUN: Record<Exclude<PushKind, "other">, [string, string]> = {
  orders: ["neue Bestellung", "neue Bestellungen"],
  reservations: ["neue Reservierung", "neue Reservierungen"],
  bookings: ["neue Buchung", "neue Buchungen"],
  inbox: ["neue Anfrage oder Nachricht", "neue Anfragen und Nachrichten"],
  dininginbox: ["neue Tischanfrage", "neue Tischanfragen"],
};
const LIST: Record<Exclude<PushKind, "other">, string> = { orders: "restaurant/bestellungen", reservations: "restaurant/reservierungen", bookings: "bookings", inbox: "inbox", dininginbox: "inbox?bereich=restaurant" };

export function groupPushes(rows: PushRowLite[], minGroup = 2): PushUnit[] {
  const groups = new Map<string, PushRowLite[]>();
  const units: { first: number; unit: PushUnit }[] = [];
  const single = (r: PushRowLite): PushUnit => ({ ids: [r.id], hotelId: r.hotelId, kind: r.kind, title: r.title, body: r.body, url: r.url, tag: r.dedupeKey, attempts: r.attempts });
  for (const r of rows) {
    if (r.kind !== "other" && GROUPABLE.some((p) => r.dedupeKey.startsWith(p))) {
      const k = `${r.hotelId}|${r.kind}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    } else units.push({ first: r.id, unit: single(r) });
  }
  for (const g of groups.values()) {
    if (g.length < minGroup) {
      for (const r of g) units.push({ first: r.id, unit: single(r) });
      continue;
    }
    const kind = g[0].kind as Exclude<PushKind, "other">;
    units.push({
      first: g[0].id,
      unit: {
        ids: g.map((r) => r.id), hotelId: g[0].hotelId, kind,
        title: `${g.length} ${NOUN[kind][1]}`, body: "Tippen, um die Liste zu öffnen.",
        url: `/admin/${g[0].hotelId}/${LIST[kind]}`, tag: `group:${g[0].hotelId}:${kind}`, attempts: Math.max(...g.map((r) => r.attempts)),
      },
    });
  }
  return units.sort((a, b) => a.first - b.first).map((x) => x.unit);
}
