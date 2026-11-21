import { MODULES, moduleDef, type ModuleRow } from "./modules";

/**
 * Funktionswahl in Alltagssprache (Wizard-Schritt «Was brauchen Sie?») und Auflösung der Abhängigkeiten.
 * Reine Logik ohne I/O.
 */
export type Choice = { key: string; question: string; modules: string[] };
export const CHOICES: Choice[] = [
  { key: "frontdesk", question: "Wir haben eine Rezeption (Tagesliste, Zimmerplan, Zimmernummern)", modules: ["frontdesk"] },
  { key: "housekeeping", question: "Reinigungspersonal arbeitet mit einer Liste am Handy", modules: ["housekeeping"] },
  { key: "restaurant", question: "Wir haben ein Restaurant oder Café (Tischreservierung, Speisekarte, Küche)", modules: ["restaurant"] },
  { key: "pos", question: "Wir wollen die Kasse von Pontivo nutzen (Bestellen, Kassieren, aufs Zimmer; CHF 29 pro Monat)", modules: ["pos"] },
  { key: "posbridge", question: "Unsere eigene Restaurantkasse soll Posten aufs Zimmer buchen", modules: ["posbridge"] },
  { key: "debtors", question: "Firmenkunden bezahlen auf Rechnung", modules: ["debtors"] },
  { key: "owners", question: "Wir verwalten Wohnungen für Eigentümer", modules: ["owners"] },
  { key: "resources", question: "Wellness, Sauna, Seminarraum oder Tennisplatz zum Buchen", modules: ["resources"] },
  { key: "groups", question: "Gruppen mit Zimmerblock und Rooming-Liste", modules: ["groups"] },
  { key: "access", question: "Türschlösser von Nuki mit automatischen Codes", modules: ["access"] },
  { key: "marketing", question: "Newsletter an Gäste, die zugestimmt haben", modules: ["marketing"] },
];

/** Standard-Funktionen beim Start je Betriebstyp, als feste Einträge (spätere Änderungen der Standardwerte lassen bestehende Betriebe unberührt) */
export function startModules(wholeUnit: boolean, restaurant = false): Record<string, boolean> {
  const m = Object.fromEntries(MODULES.map((x) => [x.key, x.defaultOn])) as Record<string, boolean>;
  if (wholeUnit) m.frontdesk = false; // Ferienwohnungen brauchen meist keine Rezeption
  if (restaurant) {
    // Reines Restaurant (SPEC 20.1): ohne Zimmer, Rezeption, Housekeeping, Meldeschein, Gruppen und Zimmer-Statistik
    Object.assign(m, { restaurant: true, frontdesk: false, housekeeping: false, statistics: false, guests: false, groups: false });
  }
  return m;
}

/** Fragen im Assistenten für reine Restaurants (ohne Zimmer-Fragen) */
export const RESTAURANT_CHOICES = ["pos", "marketing", "debtors"];

/** Ist die Auswahl an? (alle Funktionen dahinter laufen) */
export const choiceOn = (rows: ModuleRow[], c: Choice, isOn: (rows: ModuleRow[], key: string) => boolean) => c.modules.every((k) => isOn(rows, k));

/**
 * Gewünschte Änderungen mit Abhängigkeiten auflösen: wer eingeschaltet wird, zieht seine Voraussetzungen mit;
 * wer ausgeschaltet wird, nimmt Funktionen mit, die ihn brauchen (ausser sie wurden ausdrücklich gewünscht, dann gewinnt «an»).
 * `current`: Stand aller Funktionen. Rückgabe: nur die Funktionen, die sich ändern.
 */
export function resolveModules(current: Record<string, boolean>, wanted: Record<string, boolean>): Record<string, boolean> {
  const state = { ...current, ...wanted };
  // 1) Ausdrücklich Gewünschtes zieht seine Voraussetzungen mit (gewinnt gegen «aus»)
  for (let i = 0; i < MODULES.length; i++) {
    for (const m of MODULES) if (state[m.key] && wanted[m.key] === true) for (const d of moduleDef(m.key)!.deps) state[d] = true;
    for (const m of MODULES) if (state[m.key]) for (const d of moduleDef(m.key)!.deps) if (!state[d] && wanted[d] !== false) state[d] = true;
  }
  // 2) Was eine ausgeschaltete Voraussetzung braucht, geht mit aus
  for (let i = 0; i < MODULES.length; i++) for (const m of MODULES) if (state[m.key] && moduleDef(m.key)!.deps.some((d) => !state[d])) state[m.key] = false;
  return Object.fromEntries(Object.entries(state).filter(([k, v]) => v !== current[k]));
}
