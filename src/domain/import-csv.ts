import { isDay } from "./dates";

/**
 * Generisches Pontivo-CSV für die Datenübernahme und den Gesamtexport (PMS-ERSATZ 2.4, 2.9). Reine Logik ohne I/O.
 * Trennzeichen ; oder , (wird erkannt), Anführungszeichen "…", UTF-8 (mit oder ohne BOM).
 */
export const IMPORT_COLUMNS = [
  { key: "externe_nummer", help: "Buchungsnummer in der bisherigen Software (Pflicht, eindeutig)" },
  { key: "anreise", help: "Anreisetag, JJJJ-MM-TT oder TT.MM.JJJJ (Pflicht)" },
  { key: "abreise", help: "Abreisetag (Pflicht)" },
  { key: "zimmertyp", help: "Name des Zimmertyps, genau wie in Pontivo (Pflicht)" },
  { key: "tarif", help: "Name des Tarifs wie in Pontivo (leer = ohne Tarif)" },
  { key: "erwachsene", help: "Anzahl Erwachsene (leer = 1)" },
  { key: "kinder", help: "Anzahl Kinder (leer = 0)" },
  { key: "vorname", help: "Vorname (Pflicht)" },
  { key: "nachname", help: "Nachname (Pflicht)" },
  { key: "email", help: "E-Mail-Adresse (leer erlaubt)" },
  { key: "telefon", help: "Telefon" },
  { key: "sprache", help: "de, en, fr oder it (leer = de)" },
  { key: "preis_total", help: "Vereinbarter Gesamtpreis in CHF, z. B. 1250.50 (Pflicht)" },
  { key: "bezahlt", help: "Bereits bezahlt in CHF (leer = 0)" },
  { key: "status", help: "bestaetigt oder storniert (leer = bestaetigt)" },
  { key: "bemerkung", help: "Bemerkung" },
] as const;
export type ImportKey = (typeof IMPORT_COLUMNS)[number]["key"];

export type ImportRow = {
  row: number; // Zeile in der Datei (Kopfzeile = 1)
  ref: string; checkin: string; checkout: string; roomType: string; ratePlan: string; adults: number; children: number;
  firstName: string; lastName: string; email: string; phone: string; language: string; totalRappen: number; paidRappen: number; cancelled: boolean; note: string;
};
export type RowProblem = { row: number; message: string };

/** CSV-Text → Zeilen aus Feldern (RFC-4180-artig, erkennt ; und ,) */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const firstLine = t.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const out: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) out.push(row);
  return out;
}

/** Felder → CSV-Zeile (Semikolon, Excel-tauglich) */
export const csvLine = (fields: (string | number | null | undefined)[]) =>
  fields.map((f) => { const s = String(f ?? ""); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(";");
export const toCsv = (header: string[], rows: (string | number | null | undefined)[][]) => "﻿" + [csvLine(header), ...rows.map(csvLine)].join("\r\n") + "\r\n";

/** «1'250.50», «1250,5», «CHF 12» → Rappen, sonst null */
export function parseChf(s: string): number | null {
  const t = s.replace(/CHF|Fr\.|[\s'’]/gi, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** «2026-12-24» oder «24.12.2026» → «2026-12-24» */
export function parseDay(s: string): string | null {
  const t = s.trim();
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  const d = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : t;
  return isDay(d) ? d : null;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function parseImport(text: string, maxRows = 2000): { rows: ImportRow[]; problems: RowProblem[]; total: number } {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], problems: [{ row: 1, message: "Die Datei ist leer." }], total: 0 };
  const header = table[0].map(norm);
  const missing = IMPORT_COLUMNS.filter((c) => ["externe_nummer", "anreise", "abreise", "zimmertyp", "vorname", "nachname", "preis_total"].includes(c.key) && !header.includes(c.key)).map((c) => c.key);
  if (missing.length) return { rows: [], problems: [{ row: 1, message: `Spalten fehlen: ${missing.join(", ")}. Bitte die Vorlage verwenden.` }], total: 0 };
  const body = table.slice(1);
  if (body.length > maxRows) return { rows: [], problems: [{ row: 1, message: `Zu viele Zeilen (${body.length}, höchstens ${maxRows} pro Datei). Bitte in mehrere Dateien teilen.` }], total: body.length };
  const rows: ImportRow[] = [], problems: RowProblem[] = [];
  body.forEach((f, idx) => {
    const row = idx + 2;
    const g = (k: ImportKey) => (f[header.indexOf(k)] ?? "").trim();
    const bad = (message: string) => problems.push({ row, message });
    const n0 = problems.length;
    const ref = g("externe_nummer");
    if (!ref) bad("Buchungsnummer fehlt.");
    const checkin = parseDay(g("anreise")), checkout = parseDay(g("abreise"));
    if (!checkin) bad(`Anreise ungültig («${g("anreise")}»).`);
    if (!checkout) bad(`Abreise ungültig («${g("abreise")}»).`);
    if (checkin && checkout && checkout <= checkin) bad("Die Abreise muss nach der Anreise liegen.");
    if (!g("zimmertyp")) bad("Zimmertyp fehlt.");
    if (!g("vorname") || !g("nachname")) bad("Vor- und Nachname sind Pflicht.");
    const total = parseChf(g("preis_total"));
    if (total === null || total < 0) bad(`Preis ungültig («${g("preis_total")}»).`);
    const paid = g("bezahlt") === "" ? 0 : parseChf(g("bezahlt"));
    if (paid === null || paid < 0) bad(`Bezahlter Betrag ungültig («${g("bezahlt")}»).`);
    if (total !== null && paid !== null && paid > total) bad("Bezahlt ist höher als der Gesamtpreis.");
    const adults = g("erwachsene") === "" ? 1 : Number(g("erwachsene")), children = g("kinder") === "" ? 0 : Number(g("kinder"));
    if (!Number.isInteger(adults) || adults < 1 || adults > 30) bad("Anzahl Erwachsene ungültig.");
    if (!Number.isInteger(children) || children < 0 || children > 20) bad("Anzahl Kinder ungültig.");
    const email = g("email").toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad(`E-Mail-Adresse ungültig («${email}»).`);
    const lang = g("sprache").toLowerCase() || "de";
    if (!["de", "en", "fr", "it"].includes(lang)) bad(`Sprache ungültig («${lang}»).`);
    const st = norm(g("status")) || "bestaetigt";
    if (!["bestaetigt", "storniert"].includes(st)) bad(`Status unbekannt («${g("status")}»): bestaetigt oder storniert.`);
    if (problems.length > n0) return;
    rows.push({ row, ref, checkin: checkin!, checkout: checkout!, roomType: g("zimmertyp"), ratePlan: g("tarif"), adults, children, firstName: g("vorname"), lastName: g("nachname"), email, phone: g("telefon"), language: lang, totalRappen: total!, paidRappen: paid!, cancelled: st === "storniert", note: g("bemerkung") });
  });
  return { rows, problems, total: body.length };
}

/** Vorlage zum Herunterladen: Kopfzeile plus zwei Beispiele */
export const importTemplate = () => toCsv(IMPORT_COLUMNS.map((c) => c.key), [
  ["A-1001", "2027-02-12", "2027-02-15", "Doppelzimmer", "Standard", 2, 0, "Anna", "Muster", "anna@example.ch", "+41 79 000 00 00", "de", "540.00", "100.00", "bestaetigt", "Ruhiges Zimmer gewünscht"],
  ["A-0987", "2026-08-01", "2026-08-04", "Doppelzimmer", "", 2, 1, "Peter", "Beispiel", "", "", "de", "720.00", "720.00", "bestaetigt", ""],
]);

// ---------------------------------------------------------------- Gäste und Gutscheine

export type ImportKind = "reservations" | "guests" | "vouchers";
export const KIND_LABEL: Record<ImportKind, string> = { reservations: "Reservationen", guests: "Gäste", vouchers: "Gutscheine" };

/** Art der Datei aus der Kopfzeile: Reservationen (externe_nummer), Gutscheine (code + restwert), sonst Gäste */
export function detectKind(text: string): ImportKind {
  const header = (parseCsv(text)[0] ?? []).map(norm);
  if (header.includes("externe_nummer")) return "reservations";
  if (header.includes("code") && header.includes("restwert")) return "vouchers";
  return "guests";
}

function readTable(text: string, required: string[], maxRows: number) {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map(norm);
  const missing = required.filter((k) => !header.includes(k));
  const body = table.slice(1);
  const fail = (message: string) => ({ ok: false as const, problems: [{ row: 1, message }], total: body.length });
  if (!table.length) return fail("Die Datei ist leer.");
  if (missing.length) return fail(`Spalten fehlen: ${missing.join(", ")}.`);
  if (body.length > maxRows) return fail(`Zu viele Zeilen (${body.length}, höchstens ${maxRows} pro Datei). Bitte in mehrere Dateien teilen.`);
  return { ok: true as const, header, body, total: body.length };
}

export type GuestRow = { row: number; firstName: string; lastName: string; email: string; phone: string; language: string; consent: boolean; consentAt: string | null };
/** Gäste-Stamm: gleiche Spalten wie «gaeste.csv» im Gesamtexport. Marketing-Einwilligung nur mit Ja und Datum (PMS-ERSATZ 2.8) */
export function parseGuests(text: string, maxRows = 5000): { rows: GuestRow[]; problems: RowProblem[]; total: number; warnings: RowProblem[] } {
  const t = readTable(text, ["vorname", "nachname"], maxRows);
  if (!t.ok) return { rows: [], problems: t.problems, total: t.total, warnings: [] };
  const rows: GuestRow[] = [], problems: RowProblem[] = [], warnings: RowProblem[] = [];
  t.body.forEach((f, idx) => {
    const row = idx + 2;
    const g = (k: string) => (f[t.header.indexOf(k)] ?? "").trim();
    const email = g("email").toLowerCase(), lang = g("sprache").toLowerCase() || "de";
    if (!g("vorname") || !g("nachname")) return void problems.push({ row, message: "Vor- und Nachname sind Pflicht." });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return void problems.push({ row, message: `E-Mail-Adresse ungültig («${email}»).` });
    if (!["de", "en", "fr", "it"].includes(lang)) return void problems.push({ row, message: `Sprache ungültig («${lang}»).` });
    const said = ["ja", "yes", "1", "true"].includes(g("marketing_einwilligung").toLowerCase());
    const at = parseDay(g("einwilligung_am"));
    if (said && !at) warnings.push({ row, message: "Marketing-Einwilligung ohne gültiges Datum wird nicht übernommen." });
    rows.push({ row, firstName: g("vorname"), lastName: g("nachname"), email, phone: g("telefon"), language: lang, consent: said && !!at, consentAt: said ? at : null });
  });
  return { rows, problems, total: t.total, warnings };
}

export type VoucherRow = { row: number; code: string; amountRappen: number; remainingRappen: number; validUntil: string; buyer: string; buyerEmail: string; recipient: string };
/** Gutscheine mit Restwert: gleiche Spalten wie «gutscheine.csv» im Gesamtexport */
export function parseVouchers(text: string, maxRows = 5000): { rows: VoucherRow[]; problems: RowProblem[]; total: number } {
  const t = readTable(text, ["code", "betrag", "restwert", "gueltig_bis"], maxRows);
  if (!t.ok) return { rows: [], problems: t.problems, total: t.total };
  const rows: VoucherRow[] = [], problems: RowProblem[] = [];
  t.body.forEach((f, idx) => {
    const row = idx + 2;
    const g = (k: string) => (f[t.header.indexOf(k)] ?? "").trim();
    const amount = parseChf(g("betrag")), rest = parseChf(g("restwert")), until = parseDay(g("gueltig_bis"));
    if (!g("code")) return void problems.push({ row, message: "Gutscheincode fehlt." });
    if (amount === null || amount <= 0) return void problems.push({ row, message: `Betrag ungültig («${g("betrag")}»).` });
    if (rest === null || rest < 0 || rest > amount) return void problems.push({ row, message: `Restwert ungültig («${g("restwert")}»): zwischen 0 und dem Betrag.` });
    if (!until) return void problems.push({ row, message: `Gültig bis ungültig («${g("gueltig_bis")}»).` });
    rows.push({ row, code: g("code").toUpperCase(), amountRappen: amount, remainingRappen: rest, validUntil: until, buyer: g("kaeufer") || "Übernahme", buyerEmail: g("kaeufer_email").toLowerCase(), recipient: g("empfaenger") });
  });
  return { rows, problems, total: t.total };
}
