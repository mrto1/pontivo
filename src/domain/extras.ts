/**
 * Zusatzleistungen pro Buchung (reine Logik, auch im Browser für die Live-Summe).
 * Preis × Menge × (Nächte, wenn «pro Nacht»). «Pro Person»: Menge = Anzahl Personen (0 … Personen).
 * Obligatorische Leistungen (z. B. Endreinigung) sind immer dabei und stecken schon im angezeigten Preis (PBV).
 */
export const EXTRA_UNITS = ["per_booking", "per_night", "per_person", "per_person_night"] as const;
export type ExtraUnit = (typeof EXTRA_UNITS)[number];

export type ExtraDef = {
  id: string;
  priceRappen: number;
  unit: ExtraUnit;
  maxQuantity: number;
  mandatory: boolean;
  active: boolean;
  roomTypeIds: string[];
};
export type ExtraCtx = { roomTypeId: string; nights: number; persons: number };
export type ExtraLine<T extends ExtraDef = ExtraDef> = { extra: T; quantity: number; amountRappen: number };

export class ExtrasError extends Error {
  constructor(public code: "extra_invalid") {
    super(code);
  }
}

export const perPerson = (u: ExtraUnit) => u === "per_person" || u === "per_person_night";
export const perNight = (u: ExtraUnit) => u === "per_night" || u === "per_person_night";

export function extraApplies(e: ExtraDef, roomTypeId: string): boolean {
  return e.active && (e.roomTypeIds.length === 0 || e.roomTypeIds.includes(roomTypeId));
}

export function extraMaxQuantity(e: ExtraDef, persons: number): number {
  return perPerson(e.unit) ? persons : e.maxQuantity;
}

/** Menge bei obligatorischen Leistungen: pro Person alle Personen, sonst 1 */
export function mandatoryQuantity(e: ExtraDef, persons: number): number {
  return perPerson(e.unit) ? persons : 1;
}

export function extraAmount(e: Pick<ExtraDef, "priceRappen" | "unit">, quantity: number, nights: number): number {
  return e.priceRappen * quantity * (perNight(e.unit) ? nights : 1);
}

/**
 * Auswahl des Gastes prüfen und bepreisen. Obligatorische Leistungen werden immer ergänzt (Menge vom Gast ignoriert).
 * Unbekannte, inaktive, nicht passende Leistungen oder zu grosse Mengen → ExtrasError.
 */
export function resolveExtras<T extends ExtraDef>(defs: T[], selection: { id: string; quantity: number }[], ctx: ExtraCtx): { lines: ExtraLine<T>[]; totalRappen: number } {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const chosen = new Map<string, number>();
  for (const s of selection) {
    if (!Number.isInteger(s.quantity) || s.quantity < 0) throw new ExtrasError("extra_invalid");
    if (s.quantity === 0) continue;
    const e = byId.get(s.id);
    if (!e || !extraApplies(e, ctx.roomTypeId) || chosen.has(s.id)) throw new ExtrasError("extra_invalid");
    if (!e.mandatory && s.quantity > extraMaxQuantity(e, ctx.persons)) throw new ExtrasError("extra_invalid");
    chosen.set(s.id, s.quantity);
  }
  const lines: ExtraLine<T>[] = [];
  for (const e of defs) {
    if (!extraApplies(e, ctx.roomTypeId)) continue;
    const q = e.mandatory ? mandatoryQuantity(e, ctx.persons) : chosen.get(e.id) ?? 0;
    if (q > 0) lines.push({ extra: e, quantity: q, amountRappen: extraAmount(e, q, ctx.nights) });
  }
  return { lines, totalRappen: lines.reduce((s, l) => s + l.amountRappen, 0) };
}

/** Summe der obligatorischen Leistungen (für den angezeigten Gesamtpreis in der Suche) */
export function mandatoryExtrasTotal(defs: ExtraDef[], ctx: ExtraCtx): number {
  return resolveExtras(defs, [], ctx).totalRappen;
}
