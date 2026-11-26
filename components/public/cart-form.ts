import type { CartLine } from "@/src/services/online-orders";

/**
 * Warenkorb aus einem Formular lesen (SPEC 19.57/19.61): «p_<artikel>» (Menge) oder «p_<artikel>.<n>» mit Optionen «o_<artikel>.<n>.<gruppe>»
 * und Sonderwunsch «n_<artikel>.<n>». Hat der Gast bei einer Variante etwas gewählt, die Anzahl aber auf 0 gelassen, gilt 1 Stück
 * (sonst ginge die Wahl stillschweigend verloren).
 */
export function parseCartForm(f: FormData): CartLine[] {
  const out: CartLine[] = [];
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("p_")) continue;
    let quantity = Math.floor(Number(v) || 0);
    const [itemId, slot] = k.slice(2).split(".");
    const optionIds = slot === undefined ? [] : [...f.entries()].filter(([ok, ov]) => ok.startsWith(`o_${itemId}.${slot}.`) && String(ov)).map(([, ov]) => String(ov));
    const note = slot === undefined ? "" : String(f.get(`n_${itemId}.${slot}`) ?? "").trim().slice(0, 120);
    if (quantity < 1 && slot !== undefined && (optionIds.length || note)) quantity = 1;
    if (quantity < 1) continue;
    out.push({ itemId, quantity, optionIds, note });
  }
  return out;
}
