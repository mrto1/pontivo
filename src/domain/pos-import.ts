import { parseChf, parseCsv, toCsv } from "./import-csv";

/**
 * CSV-Import für die Restaurantkasse (SPEC 19.48): Artikel und Tische. Alles oder nichts: bei einem Fehler wird nichts importiert.
 * Erkennt ; oder , und die Kopfzeile unabhängig von Gross-/Kleinschreibung und Umlauten.
 */
export type PosItemRow = { row: number; category: string; name: string; priceRappen: number; vatDineInBps: number; vatTakeawayBps: number; dailySpecial: boolean };
export type PosProblem = { row: number; message: string };
export const POS_IMPORT_MAX = 500;
export const DEFAULT_VAT_DINE_IN_BPS = 810;
export const DEFAULT_VAT_TAKEAWAY_BPS = 260;

const norm = (h: string) => h.trim().toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const col = (header: string[], ...names: string[]) => header.findIndex((h) => names.includes(h));

/** «8.1», «8,1 %» → 810; leer → Standard */
function vat(s: string, dflt: number): number | null {
  const t = s.replace(/[%\s]/g, "").replace(",", ".");
  if (t === "") return dflt;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  const bps = Math.round(Number(t) * 100);
  return bps <= 2500 ? bps : null;
}
const yes = (s: string) => /^(1|ja|j|x|yes|true|wahr)$/i.test(s.trim());

export function parsePosItems(text: string): { rows: PosItemRow[]; problems: PosProblem[] } {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], problems: [{ row: 1, message: "Die Datei ist leer." }] };
  const header = table[0].map(norm);
  const ci = { cat: col(header, "kategorie", "gruppe"), name: col(header, "name", "artikel", "bezeichnung"), price: col(header, "preis", "preis_chf", "preis_in_chf"), dine: col(header, "mwst_haus", "mwst_im_haus", "mwst_vor_ort"), take: col(header, "mwst_takeaway", "mwst_take_away"), special: col(header, "tagesangebot", "tagesmenue") };
  if (ci.name < 0 || ci.price < 0) return { rows: [], problems: [{ row: 1, message: "Die Kopfzeile braucht mindestens «name» und «preis» (siehe Vorlage)." }] };
  const body = table.slice(1);
  if (!body.length) return { rows: [], problems: [{ row: 1, message: "Die Datei enthält keine Artikel." }] };
  if (body.length > POS_IMPORT_MAX) return { rows: [], problems: [{ row: 1, message: `Höchstens ${POS_IMPORT_MAX} Zeilen pro Datei.` }] };
  const rows: PosItemRow[] = [], problems: PosProblem[] = [];
  body.forEach((r, i) => {
    const row = i + 2, g = (k: number) => (k >= 0 ? (r[k] ?? "").trim() : "");
    const name = g(ci.name), price = parseChf(g(ci.price)), dine = vat(g(ci.dine), DEFAULT_VAT_DINE_IN_BPS), take = vat(g(ci.take), DEFAULT_VAT_TAKEAWAY_BPS);
    if (!name) return void problems.push({ row, message: "Der Name fehlt." });
    if (name.length > 120) return void problems.push({ row, message: "Der Name ist zu lang (höchstens 120 Zeichen)." });
    if (price === null || price < 0 || price > 10_000_000) return void problems.push({ row, message: `Preis «${g(ci.price)}» ungültig.` });
    if (dine === null) return void problems.push({ row, message: "MWST im Haus ungültig (0 bis 25)." });
    if (take === null) return void problems.push({ row, message: "MWST Take-away ungültig (0 bis 25)." });
    rows.push({ row, category: g(ci.cat).slice(0, 60), name, priceRappen: price, vatDineInBps: dine, vatTakeawayBps: take, dailySpecial: yes(g(ci.special)) });
  });
  return { rows, problems };
}

export function parsePosTables(text: string): { names: string[]; problems: PosProblem[] } {
  const table = parseCsv(text);
  if (!table.length) return { names: [], problems: [{ row: 1, message: "Die Datei ist leer." }] };
  const header = table[0].map(norm);
  const c = col(header, "name", "tisch", "bezeichnung");
  if (c < 0) return { names: [], problems: [{ row: 1, message: "Die Kopfzeile braucht die Spalte «name» (siehe Vorlage)." }] };
  const body = table.slice(1);
  if (body.length > POS_IMPORT_MAX) return { names: [], problems: [{ row: 1, message: `Höchstens ${POS_IMPORT_MAX} Zeilen pro Datei.` }] };
  const names: string[] = [], problems: PosProblem[] = [];
  body.forEach((r, i) => {
    const n = (r[c] ?? "").trim();
    if (!n) return void problems.push({ row: i + 2, message: "Der Name fehlt." });
    if (n.length > 30) return void problems.push({ row: i + 2, message: "Der Name ist zu lang (höchstens 30 Zeichen)." });
    if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
  });
  return { names, problems };
}

export const posItemsTemplate = () => toCsv(["kategorie", "name", "preis", "mwst_haus", "mwst_takeaway", "tagesangebot"], [
  ["Getränke", "Mineralwasser 5 dl", "4.50", "8.1", "2.6", ""],
  ["Essen", "Rösti mit Spiegelei", "21.50", "8.1", "2.6", "ja"],
]);
export const posTablesTemplate = () => toCsv(["name"], [["1"], ["2"], ["Terrasse 1"]]);
