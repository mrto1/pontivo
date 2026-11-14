/**
 * Modul-Register (SPEC 16.1). Ein Modul ist eine Funktion, die ein Betrieb ein- oder ausschalten kann.
 * Ausgeschaltet = unsichtbar (Menü, Seiten, Übersicht); Daten bleiben erhalten.
 * Gespeichert in hotel_modules (hotel_id, module, enabled). Keine Zeile = Standard.
 * Kostenpflichtige Module (ai_chat, upsell) haben einen eigenen Einschalt-Ablauf mit Konditionen und stehen hier nicht.
 */
export type ModuleDef = {
  key: string;
  label: string;
  description: string;
  /** Module, die laufen müssen, damit dieses Sinn ergibt */
  deps: string[];
  defaultOn: boolean;
  /** Menüpunkte (Schlüssel aus src/admin/nav.ts), die bei «aus» verschwinden */
  navKeys: string[];
};

export const MODULES: ModuleDef[] = [
  { key: "frontdesk", label: "Rezeption", description: "Tagesliste (Anreisen, Abreisen, im Haus), Zimmerplan und Zimmernummern. Sinnvoll für Hotels; Ferienwohnungen brauchen es meist nicht.", deps: [], defaultOn: true, navKeys: ["frontdesk", "plan"] },
  { key: "housekeeping", label: "Housekeeping", description: "Reinigungsstatus je Zimmer, Tagesaufträge nach Abreise, Handy-Liste für das Reinigungspersonal und Meldungen zu Mängeln.", deps: ["frontdesk"], defaultOn: false, navKeys: ["housekeeping"] },
  { key: "guestnotes", label: "Gäste-Notizen", description: "Notizen und Tags zu Gästen (z. B. Stammgast, Wunsch Zimmer oben), sichtbar bei der Buchung, mit Suche. Bitte keine Gesundheits- oder sonstigen heiklen Angaben notieren.", deps: [], defaultOn: false, navKeys: ["guestbook"] },
  { key: "invoicing", label: "Rechnung & Kasse", description: "Rechnungen und Quittungen mit MWST und QR-Rechnung, Zahlungen vor Ort verbuchen.", deps: [], defaultOn: true, navKeys: ["invoices"] },
  { key: "vouchers", label: "Gutscheine", description: "Gutscheine online verkaufen und im Haus einlösen.", deps: [], defaultOn: true, navKeys: ["vouchers"] },
  { key: "inquiries", label: "Anfragen", description: "Anfragen von der Website und aus dem Chat (z. B. Gruppen, Sonderwünsche).", deps: [], defaultOn: true, navKeys: ["inquiries"] },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);
export const moduleDef = (key: string) => MODULES.find((m) => m.key === key);

export type ModuleRow = { module: string; enabled: boolean };

/** Ist das Modul an? Fehlt die Zeile, gilt der Standard. Unbekannte Module sind aus. */
export function isOn(rows: ModuleRow[], key: string): boolean {
  const def = moduleDef(key);
  if (!def) return false;
  const r = rows.find((x) => x.module === key);
  return r ? r.enabled : def.defaultOn;
}

/** Menüpunkte, die wegen ausgeschalteter Module verschwinden */
export function hiddenNavKeys(rows: ModuleRow[]): Set<string> {
  return new Set(MODULES.filter((m) => !isOn(rows, m.key)).flatMap((m) => m.navKeys));
}

/** Prüft, ob ein Wechsel erlaubt ist. Gibt eine Erklärung zurück, wenn nicht. */
export function switchProblem(rows: ModuleRow[], key: string, on: boolean): string | null {
  const def = moduleDef(key);
  if (!def) return "Unbekannte Funktion.";
  if (on) {
    const missing = def.deps.filter((d) => !isOn(rows, d)).map((d) => moduleDef(d)?.label ?? d);
    return missing.length ? `«${def.label}» braucht zuerst: ${missing.join(", ")}.` : null;
  }
  const users = MODULES.filter((m) => m.deps.includes(key) && isOn(rows, m.key)).map((m) => m.label);
  return users.length ? `«${def.label}» wird noch gebraucht von: ${users.join(", ")}. Bitte zuerst dort ausschalten.` : null;
}
