import { extraAmount, perPerson, type ExtraUnit } from "./extras";

/** Upselling (SPEC 14d): reine Logik für Auswahl und Provision */

/** Provision auf Upselling-Verkäufe: 5 % (Basispunkte). ASSUMPTION: gilt ab Einschalten, Änderungen mit 60 Tagen Frist (Gastgeber-Bedingungen). */
export const UPSELL_PROVISION_BPS = 500;

export class UpsellError extends Error {
  constructor(public code: "not_available" | "invalid_selection" | "empty" | "not_found") {
    super(code);
  }
}

export type UpsellDef = { id: string; priceRappen: number; unit: ExtraUnit; maxQuantity: number; active: boolean };

/** Auswahl prüfen und bepreisen. Mengen über dem Maximum, unbekannte oder inaktive Angebote → Fehler. Menge 0 wird ignoriert. */
export function priceSelection<T extends UpsellDef>(
  defs: T[], selection: { id: string; quantity: number }[], ctx: { nights: number; persons: number },
): { lines: { item: T; quantity: number; amountRappen: number }[]; totalRappen: number } {
  const lines: { item: T; quantity: number; amountRappen: number }[] = [];
  const seen = new Set<string>();
  for (const s of selection) {
    if (!Number.isInteger(s.quantity) || s.quantity < 0) throw new UpsellError("invalid_selection");
    if (s.quantity === 0) continue;
    if (seen.has(s.id)) throw new UpsellError("invalid_selection");
    seen.add(s.id);
    const item = defs.find((d) => d.id === s.id && d.active);
    if (!item) throw new UpsellError("invalid_selection");
    const max = perPerson(item.unit) ? ctx.persons : item.maxQuantity;
    if (s.quantity > max) throw new UpsellError("invalid_selection");
    lines.push({ item, quantity: s.quantity, amountRappen: extraAmount(item, s.quantity, ctx.nights) });
  }
  if (!lines.length) throw new UpsellError("empty");
  return { lines, totalRappen: lines.reduce((a, l) => a + l.amountRappen, 0) };
}

/** Provision in Rappen (kaufmännisch gerundet) */
export function upsellFee(amountRappen: number, bps: number): number {
  return Math.round((amountRappen * bps) / 10_000);
}
