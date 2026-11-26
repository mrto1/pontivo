import type { CartLine } from "@/src/services/online-orders";

/** Warenkorb aus einem Formular lesen (SPEC 19.57/19.61): «p_<artikel>» (Menge) oder «p_<artikel>.<n>» mit Optionen «o_<artikel>.<n>.<gruppe>» und Sonderwunsch «n_<artikel>.<n>» */
export function parseCartForm(f: FormData): CartLine[] {
  const out: CartLine[] = [];
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("p_")) continue;
    const quantity = Math.floor(Number(v) || 0);
    if (quantity < 1) continue;
    const [itemId, slot] = k.slice(2).split(".");
    const optionIds = slot === undefined ? [] : [...f.entries()].filter(([ok, ov]) => ok.startsWith(`o_${itemId}.${slot}.`) && String(ov)).map(([, ov]) => String(ov));
    const note = slot === undefined ? "" : String(f.get(`n_${itemId}.${slot}`) ?? "").slice(0, 120);
    out.push({ itemId, quantity, optionIds, note });
  }
  return out;
}
