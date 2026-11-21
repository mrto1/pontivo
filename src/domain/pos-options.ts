/**
 * Optionen, Sonderwünsche, Menüs (SPEC 19.49). Reine Logik ohne I/O: gilt auf dem Server und auf dem Offline-Gerät gleich.
 * Menüs und Kombis sind Artikel mit Pflicht-Gruppen; der Aufpreis einer Option kommt zum Artikelpreis.
 */
export type OptionDef = { id: string; name: string; priceRappen: number };
export type GroupDef = { id: string; name: string; required: boolean; maxChoices: number; options: OptionDef[] };
export type ChosenOption = { group: string; name: string; priceRappen: number };
export const NOTE_MAX = 120;

export type Composed = { description: string; unitPriceRappen: number; options: ChosenOption[]; note: string };

/** Auswahl prüfen: Optionen müssen zu den Gruppen des Artikels gehören; Pflicht, Einzel- und Mehrfachwahl. Fehlertexte oder null. */
export function checkChoice(groups: GroupDef[], optionIds: string[]): string | null {
  const known = new Map(groups.flatMap((g) => g.options.map((o) => [o.id, g.id] as const)));
  if (new Set(optionIds).size !== optionIds.length) return "Eine Option ist doppelt gewählt.";
  for (const id of optionIds) if (!known.has(id)) return "Diese Option gehört nicht zum Artikel.";
  const missing: string[] = [];
  for (const g of groups) {
    const n = g.options.filter((o) => optionIds.includes(o.id)).length;
    if (g.required && n === 0) missing.push(g.name);
    if (n > g.maxChoices) return g.maxChoices === 1 ? `«${g.name}»: bitte nur eine Option wählen.` : `«${g.name}»: höchstens ${g.maxChoices} Optionen.`;
  }
  return missing.length ? `Bitte wählen: ${missing.join(", ")}.` : null;
}

/** Zeilentext und Preis: «Entrecôte · medium · ohne Zwiebeln», Artikelpreis plus Aufpreise */
export function composeLine(item: { name: string; priceRappen: number }, groups: GroupDef[], optionIds: string[], note = ""): Composed {
  const chosen: ChosenOption[] = groups.flatMap((g) => g.options.filter((o) => optionIds.includes(o.id)).map((o) => ({ group: g.name, name: o.name, priceRappen: o.priceRappen })));
  const n = note.trim().slice(0, NOTE_MAX);
  const description = [item.name, ...chosen.map((c) => c.name), ...(n ? [n] : [])].join(" · ").slice(0, 120);
  return { description, unitPriceRappen: item.priceRappen + chosen.reduce((a, c) => a + c.priceRappen, 0), options: chosen, note: n };
}

export const hasRequiredGroup = (groups: GroupDef[]) => groups.some((g) => g.required);
