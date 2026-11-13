import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { hotels, platformCharges } from "../db/schema";
import { rappenToDecimal } from "../domain/money";
import { env } from "../env";
import { shiftMonth } from "./overview";
import { feesForMonth } from "./billing";

/**
 * Buchhaltung des Betreibers (SPEC 14c): Erträge von Pontivo als Buchungsdatei für Banana Buchhaltung.
 * Format: Textdatei mit Spaltenüberschriften, Tabulator, Datum yyyy-mm-dd, UTF-8 (Banana: «In Buchhaltung importieren»).
 * Pro Monat und Hotel höchstens eine Zeile je Ertragsart. Nicht MWST-pflichtig (ohne VatCode).
 */

const HEADER = ["Date", "DocInvoice", "Description", "AccountDebit", "AccountCredit", "Amount", "ExternalReference"];

export type AccountingLine = { date: string; doc: string; text: string; debit: string; credit: string; rappen: number; ref: string };
export type AccountingExport = { month: string; lines: AccountingLine[]; skipped: { hotel: string; reason: string; rappen: number }[]; tsv: string };

const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();

function lastDayOf(month: string): string {
  const next = shiftMonth(month, 1);
  return new Date(Date.UTC(+next.slice(0, 4), +next.slice(5, 7) - 1, 0)).toISOString().slice(0, 10);
}

export function toTsv(lines: AccountingLine[]): string {
  const body = lines.map((l) => [l.date, l.doc, clean(l.text), l.debit, l.credit, rappenToDecimal(l.rappen), l.ref].join("\t"));
  return [HEADER.join("\t"), ...body].join("\n") + "\n";
}

/**
 * Erträge eines Monats (YYYY-MM):
 * - Plattformgebühr (Provision) laut Monatsabrechnung, netto nach Rückerstattungen. Sie wird bei der Buchung über Stripe eingezogen.
 * - Mindestgebühr-Differenz, KI-Modul, KI-Zusatzpakete aus `platform_charges`, nur wenn die Karte tatsächlich belastet wurde (status succeeded).
 * Offene oder fehlgeschlagene Belastungen erscheinen in `skipped`, nicht in der Datei.
 */
export async function accountingExport(month: string): Promise<AccountingExport> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Monat im Format JJJJ-MM angeben");
  const e = env();
  const date = lastDayOf(month);
  const all = await db().select().from(hotels).orderBy(asc(hotels.createdAt));
  const charges = await db().select().from(platformCharges).where(eq(platformCharges.month, month));
  const lines: AccountingLine[] = [];
  const skipped: AccountingExport["skipped"] = [];
  const add = (h: { id: string; name: string }, kind: string, label: string, credit: string, rappen: number) => {
    if (rappen <= 0) return;
    lines.push({ date, doc: `PON-${month.replace("-", "")}-${h.id.slice(0, 8)}-${kind}`, text: `${label} ${month} ${h.name}`, debit: e.BANANA_ACCOUNT_STRIPE, credit, rappen, ref: `pontivo-${month}-${h.id}-${kind}` });
  };
  for (const h of all) {
    add(h, "fee", "Plattformgebühr", e.BANANA_ACCOUNT_REV_FEES, await feesForMonth(h, month));
    for (const c of charges.filter((x) => x.hotelId === h.id && x.chargeRappen > 0)) {
      if (c.status !== "succeeded") {
        skipped.push({ hotel: h.name, reason: `Belastung ${c.status === "failed" ? "fehlgeschlagen" : "noch offen"}`, rappen: c.chargeRappen });
        continue;
      }
      add(h, "min", "Mindestgebühr (Differenz)", e.BANANA_ACCOUNT_REV_MINIMUM, c.chargeRappen - c.aiModuleRappen - c.aiPacksRappen);
      add(h, "ai", "KI-Chat Modul", e.BANANA_ACCOUNT_REV_AI, c.aiModuleRappen);
      add(h, "aipk", "KI-Chat Zusatzpakete", e.BANANA_ACCOUNT_REV_AI, c.aiPacksRappen);
    }
  }
  return { month, lines, skipped, tsv: toTsv(lines) };
}

/** Datei in den Ablageordner schreiben (Dateiname pontivo-JJJJ-MM.txt). Ohne Ordner in den Einstellungen: nichts tun. */
export async function writeAccountingFile(month: string, dir = env().ACCOUNTING_EXPORT_DIR): Promise<{ path: string; lines: number; skipped: number } | null> {
  if (!dir) return null;
  const x = await accountingExport(month);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `pontivo-${month}.txt`);
  writeFileSync(path, x.tsv, { mode: 0o644 });
  if (x.skipped.length) console.warn(`[buchhaltung] ${month}: ${x.skipped.length} Belastung(en) noch nicht bezahlt und nicht in der Datei`);
  return { path, lines: x.lines.length, skipped: x.skipped.length };
}

/** Worker: am 5. jedes Monats den Vormonat schreiben (Belastungen sind dann abgeschlossen, Wiederholungen nach 3 Tagen) */
export async function monthlyAccountingJob(now = new Date()) {
  const month = shiftMonth(now.toISOString().slice(0, 7), -1);
  return writeAccountingFile(month);
}
