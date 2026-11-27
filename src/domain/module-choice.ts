import { MODULES, moduleDef, type ModuleRow } from "./modules";

/**
 * Funktionswahl in Alltagssprache (Wizard-Schritt «Was brauchen Sie?») und Auflösung der Abhängigkeiten.
 * Reine Logik ohne I/O.
 */
export type Choice = { key: string; question: string; /** Eine Zeile Erklärung unter der Frage (für Fachbegriffe) */ hint?: string; modules: string[]; /** angekreuzt, sobald eine der Funktionen läuft (bestehende Betriebe mit nur einer davon bleiben angekreuzt) */ anyOn?: boolean };
export const CHOICES: Choice[] = [
  { key: "staff", question: "Wir arbeiten mit Personal in Rezeption und Reinigung (Tagesliste, Zimmerplan, Reinigungsliste am Handy)", modules: ["frontdesk", "housekeeping"], anyOn: true },
  { key: "restaurant", question: "Wir haben ein Restaurant oder Café (Tischreservation, Speisekarte, Küche)", modules: ["restaurant"] },
  { key: "pos", question: "Wir wollen die Kasse von Pontivo nutzen (Bestellen, Kassieren, aufs Zimmer; CHF 29 pro Monat)", modules: ["pos"] },
  { key: "posbridge", question: "Unsere eigene Restaurantkasse soll Posten aufs Zimmer buchen", hint: "Nur wenn Sie bereits eine andere Kasse haben und deren Rechnungen aufs Zimmer gehen sollen.", modules: ["posbridge"] },
  { key: "shop", question: "Wir verkaufen Waren (Getränke, Snacks, Minibar) oder führen ein Lager", modules: ["shop"] },
  { key: "debtors", question: "Firmenkunden bezahlen auf Rechnung", hint: "Sie stellen die Rechnung aus und sehen, wer noch offen ist und wann Mahnungen fällig sind.", modules: ["debtors"] },
  { key: "owners", question: "Wir vermieten Ferienwohnungen im Auftrag der Eigentümer", hint: "Sie verwalten Wohnungen, die anderen gehören, und rechnen monatlich mit ihnen ab (Umsatz, Ihre Kommission, Kosten).", modules: ["owners"] },
  { key: "resources", question: "Gäste können Wellness, Sauna, Seminarraum oder Tennisplatz buchen", hint: "Räume und Plätze mit Zeitfenstern, getrennt von den Zimmern.", modules: ["resources"] },
  { key: "groups", question: "Wir nehmen Gruppenbuchungen an (Reisegruppen, Vereine, Hochzeiten)", hint: "Sie reservieren mehrere Zimmer auf einmal und tragen die Namen der Teilnehmer erst später ein; die Zimmer werden automatisch freigegeben, wenn die Gruppe nicht rechtzeitig bestätigt.", modules: ["groups"] },
  { key: "access", question: "Türschlösser von Nuki mit automatischen Codes", modules: ["access"] },
  { key: "marketing", question: "Newsletter an Gäste, die zugestimmt haben", modules: ["marketing"] },
];

/** Standard-Funktionen beim Start je Betriebstyp, als feste Einträge (spätere Änderungen der Standardwerte lassen bestehende Betriebe unberührt) */
export function startModules(wholeUnit: boolean, restaurant = false): Record<string, boolean> {
  const m = Object.fromEntries(MODULES.map((x) => [x.key, x.defaultOn])) as Record<string, boolean>;
  if (wholeUnit) m.frontdesk = false; // Ferienwohnungen brauchen meist keine Rezeption
  if (restaurant) {
    // Reines Restaurant (SPEC 20.1): ohne Zimmer, Rezeption, Housekeeping, Meldeschein, Gruppen und Zimmer-Statistik
    Object.assign(m, { restaurant: true, guestnotes: true, frontdesk: false, housekeeping: false, statistics: false, guests: false, groups: false });
  }
  return m;
}

/** Fragen im Assistenten für reine Restaurants (ohne Zimmer-Fragen) */
export const RESTAURANT_CHOICES = ["pos", "shop", "marketing", "debtors"];
/** Nur für Verwalter ganzer Wohnungen sinnvoll: in Hotels und B&Bs nicht angeboten */
const WHOLE_UNIT_ONLY = ["owners"];

/** Fragen für diesen Betriebstyp: Restaurants ohne Zimmer-Fragen, Hotels und B&Bs ohne Eigentümerabrechnung */
export function choicesFor(kind: { restaurant: boolean; wholeUnit: boolean }): Choice[] {
  if (kind.restaurant) return CHOICES.filter((c) => RESTAURANT_CHOICES.includes(c.key));
  return kind.wholeUnit ? CHOICES : CHOICES.filter((c) => !WHOLE_UNIT_ONLY.includes(c.key));
}

/** Ist die Auswahl an? (alle Funktionen dahinter laufen) */
export const choiceOn = (rows: ModuleRow[], c: Choice, isOn: (rows: ModuleRow[], key: string) => boolean) => (c.anyOn ? c.modules.some((k) => isOn(rows, k)) : c.modules.every((k) => isOn(rows, k)));

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
