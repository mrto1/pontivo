/**
 * Buchungsdatei für Banana von Hand erzeugen:  npm run export:banana -- 2026-11 [Zielordner]
 * Ohne Zielordner wird ACCOUNTING_EXPORT_DIR benutzt, sonst die Datei auf der Konsole ausgegeben.
 */
import { accountingExport, writeAccountingFile } from "../src/services/accounting";
import { closeDb } from "../src/db/client";

const [month, dir] = process.argv.slice(2);
if (!month) {
  console.error("Aufruf: npm run export:banana -- JJJJ-MM [Zielordner]");
  process.exit(1);
}
const r = await writeAccountingFile(month, dir || process.env.ACCOUNTING_EXPORT_DIR);
if (r) console.log(`Geschrieben: ${r.path} (${r.lines} Buchungen, ${r.skipped} nicht bezahlte Belastungen ausgelassen)`);
else {
  const x = await accountingExport(month);
  process.stdout.write(x.tsv);
  for (const s of x.skipped) console.error(`Ausgelassen: ${s.hotel}: ${s.reason}`);
}
await closeDb();
