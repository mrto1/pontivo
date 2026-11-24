/** Shop & Lager (SPEC 19.51): reine Logik ohne I/O */
export type GoodVat = "standard" | "reduced" | "none";

/** Reduzierter MWST-Satz in Basispunkten (Lebensmittel; ASSUMPTION: Alkohol und Non-Food gehören auf «Normalsatz») */
export const REDUCED_VAT_BPS = 260;

export const VAT_LABEL: Record<GoodVat, string> = { standard: "Normalsatz", reduced: "Reduziert (Lebensmittel)", none: "Ohne MWST" };

/** Wie ein Posten aufs Zimmer gebucht wird: Art der MWST und ggf. fester Satz */
export function folioVat(v: GoodVat): { vatKind: "standard" | "none"; vatBpsOverride: number | null } {
  if (v === "none") return { vatKind: "none", vatBpsOverride: null };
  return { vatKind: "standard", vatBpsOverride: v === "reduced" ? REDUCED_VAT_BPS : null };
}

/** Muss nachbestellt werden? Nur Waren mit Lager; bei Mindestbestand 0 erst, wenn nichts mehr da ist */
export const needsReorder = (g: { trackStock: boolean; active: boolean; stock: number; minStock: number }): boolean => g.trackStock && g.active && g.stock <= g.minStock;

/** Menge, die bis zur Sollmenge fehlt (Minibar-Nachfüllen); nie negativ */
export const refillCount = (par: number, present: number): number => Math.max(0, par - Math.max(0, present));
