import { METHODS, selectionTotal, type Method, type Selection } from "./pos";

/**
 * Lokaler Stand der Offline-Kasse (Browser): Bestellungen mit Zeilen und noch offenen Mengen. Reine Funktionen, damit sie testbar sind.
 * Der Server bleibt massgebend; das Gerät rechnet mit denselben Regeln (Preise und Sätze wie dem Gast gezeigt).
 */
export type LocalLine = { id: string; itemId: string | null; description: string; quantity: number; unitPriceRappen: number; vatBps: number; mode: "dine_in" | "takeaway"; openQuantity: number };
export type LocalOrder = { id: string; tableId: string | null; label: string; lines: LocalLine[]; receipts: { number: string; totalRappen: number }[] };
export type CatalogItem = { id: string; category: string | null; name: string; priceRappen: number; vatDineInBps: number; vatTakeawayBps: number; dailySpecial: boolean };

export const openTotal = (o: LocalOrder) => o.lines.reduce((a, l) => a + l.openQuantity * l.unitPriceRappen, 0);
export const isOpen = (o: LocalOrder) => o.lines.some((l) => l.openQuantity > 0);

/** Satz einer Zeile aus dem Artikel; nicht MWST-pflichtige Betriebe: 0 */
export function lineFor(item: CatalogItem, quantity: number, mode: "dine_in" | "takeaway", id: string, vatLiable: boolean): LocalLine {
  return { id, itemId: item.id, description: item.name, quantity, unitPriceRappen: item.priceRappen, vatBps: vatLiable ? (mode === "takeaway" ? item.vatTakeawayBps : item.vatDineInBps) : 0, mode, openQuantity: quantity };
}

/** Auswahl prüfen und Total berechnen; Fehlertext oder Summe */
export function checkPay(o: LocalOrder, sel: Selection[]): { error: string } | { totalRappen: number } {
  if (!sel.length) return { error: "Nichts zum Bezahlen gewählt." };
  const byId = new Map(o.lines.map((l) => [l.id, l]));
  for (const s of sel) {
    const l = byId.get(s.lineId);
    if (!l) return { error: "Zeile unbekannt." };
    if (!Number.isInteger(s.quantity) || s.quantity < 1 || s.quantity > l.openQuantity) return { error: `«${l.description}»: höchstens ${l.openQuantity} offen.` };
  }
  const total = selectionTotal(sel.map((s) => ({ ...byId.get(s.lineId)!, reversesLineId: null })), sel).totalRappen;
  return total > 0 ? { totalRappen: total } : { error: "Der Betrag muss grösser als 0 sein." };
}

export const afterPay = (o: LocalOrder, sel: Selection[], receipt: { number: string; totalRappen: number }): LocalOrder => ({
  ...o,
  lines: o.lines.map((l) => { const s = sel.find((x) => x.lineId === l.id); return s ? { ...l, openQuantity: l.openQuantity - s.quantity } : l; }),
  receipts: [...o.receipts, receipt],
});

/**
 * Stand vom Server übernehmen: Bestellungen mit noch nicht übertragenen Vorgängen (`dirty`) bleiben lokal, alle anderen kommen vom Server.
 * Lokale, schon übertragene Bestellungen ohne offenen Betrag fallen weg.
 */
export function mergeServer(local: LocalOrder[], server: Omit<LocalOrder, "receipts">[], dirty: ReadonlySet<string>): LocalOrder[] {
  const keep = local.filter((o) => dirty.has(o.id));
  const have = new Set(keep.map((o) => o.id));
  return [...keep, ...server.filter((o) => !have.has(o.id)).map((o) => ({ ...o, receipts: [] }))];
}

export const validMethod = (m: string): m is Method => (METHODS as readonly string[]).includes(m);
