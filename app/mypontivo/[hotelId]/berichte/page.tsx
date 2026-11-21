import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { ExportCard } from "@/components/admin/ExportCard";
import { cantonRule, guestsModuleEnabled } from "@/src/services/guests";
import { moduleOn } from "@/src/services/modules";
import { addDays, todayIn } from "@/src/domain/dates";
import { shiftMonth } from "@/src/services/overview";

export const dynamic = "force-dynamic";

/**
 * Berichte (SPEC 19.46): alle Exporte an einem Ort, jeder mit gleichem Aufbau (Titel, Satz, Zeitraum, Knöpfe).
 * Karten erscheinen nur, wenn die jeweilige Funktion an ist und die Rolle es erlaubt.
 */
export default async function Berichte({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  const { hotel, role } = await requireHotel(hotelId, "staff", "reports");
  const base = `/mypontivo/${hotel.id}`;
  const today = todayIn(hotel.timezone);
  const initial = { month: shiftMonth(today.slice(0, 7), -1), from: addDays(today, -30), to: today };
  const manager = atLeast(role, "manager");
  const owner = atLeast(role, "owner"); // Buchungsabrechnung: wie die Seiten unter /report
  const [guestsOn, statsOn, acctOn] = await Promise.all([guestsModuleEnabled(hotel.id), moduleOn(hotel.id, "statistics"), moduleOn(hotel.id, "accountingexport")]);
  const rule = guestsOn ? await cantonRule(hotel.canton) : null;
  return (
    <div className="stack">
      <h1>Berichte</h1>
      <p className="muted">Listen und Exporte für Gemeinde, Polizei, Statistik und Buchhaltung. Jeder Export wird protokolliert.</p>
      <div className="report-grid">
        {owner ? (
          <ExportCard title="Buchungsabrechnung" lead="Je Buchung Umsatz, Kurtaxe, Erstattungen und Plattformgebühr, nach Bestätigung der Buchung." kinds={["month"]} initial={initial}
            actions={[{ label: "CSV für Excel", path: `${base}/report/csv`, param: "month" }, { label: "PDF / Drucken", path: `${base}/report/print`, param: "month", target: "_blank", primary: false }]} />
        ) : null}
        {manager && guestsOn ? (
          <ExportCard title="Kurtaxe-Liste" lead="Pro Monat oder Quartal für die Abrechnung mit der Gemeinde." kinds={["quarter", "month"]} initial={initial}
            actions={[{ label: "CSV", path: `${base}/guests/tax`, param: { month: "month", quarter: "quarter" }, extra: { format: "csv" } }, { label: "PDF / Drucken", path: `${base}/guests/tax`, param: { month: "month", quarter: "quarter" }, extra: { format: "pdf" }, target: "_blank", primary: false }]} />
        ) : null}
        {guestsOn ? (
          <ExportCard title="Gästeregister" lead={`Meldescheine für die Polizei auf Verlangen, mit Geburtsdatum und Ausweisnummer.${rule ? ` Aufbewahrung ${rule.retentionYears} Jahre nach Abreise (Kanton ${hotel.canton}), danach automatisch gelöscht.` : ""}`} kinds={["range"]} initial={initial}
            actions={[{ label: "CSV", path: `${base}/guests/register`, param: "from", extra: { format: "csv" } }, { label: "PDF / Drucken", path: `${base}/guests/register`, param: "from", extra: { format: "pdf" }, target: "_blank", primary: false }]} />
        ) : null}
        {statsOn ? (
          <ExportCard title="Beherbergungsstatistik (HESTA)" lead="Monatszahlen für das Bundesamt für Statistik." kinds={["month"]} initial={initial}
            actions={[{ label: "CSV", path: `${base}/statistics/hesta/csv`, param: "month" }, { label: "Ansehen", path: `${base}/statistics/hesta`, param: "month", primary: false }]} />
        ) : null}
        {acctOn ? (
          <ExportCard title="Buchhaltung" lead="Rechnungen und Zahlungen als Buchungsliste für den Treuhänder. Die Kontenzuordnung stellen Sie unter Finanzen → Buchhaltung ein." kinds={["month", "quarter", "year"]} initial={initial}
            actions={[{ label: "CSV Journal", path: `${base}/buchhaltung/csv`, param: "p", extra: { f: "journal" } }, { label: "CSV Abacus", path: `${base}/buchhaltung/csv`, param: "p", extra: { f: "abacus" }, primary: false }]} />
        ) : null}
      </div>
    </div>
  );
}
