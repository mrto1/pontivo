import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireHotel } from "@/src/auth/guard";
import { db } from "@/src/db/client";
import { platformCharges } from "@/src/db/schema";
import { formatChf } from "@/src/domain/money";
import { formatBps } from "@/src/domain/invoice";
import { billMonth, monthEnd } from "@/src/domain/platform-invoice";
import { platformInfo } from "@/src/legal/texts";
import { env } from "@/src/env";
import { PrintButton } from "@/components/admin/PrintButton";

export const dynamic = "force-dynamic";

const fmtDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** Rechnung der Plattform an das Hotel (SPEC 19.30): Druckansicht → im Browser «Als PDF speichern» */
// ASSUMPTION: PDF über die Druckfunktion des Browsers (wie bei der Monatsabrechnung), keine serverseitige PDF-Erzeugung.
export default async function PlatformInvoice({ params }: { params: Promise<{ hotelId: string; chargeId: string }> }) {
  const { hotelId, chargeId } = await params;
  const { hotel } = await requireHotel(hotelId, "owner");
  const [c] = await db().select().from(platformCharges).where(and(eq(platformCharges.id, chargeId), eq(platformCharges.hotelId, hotel.id)));
  if (!c || !c.invoiceNo) notFound();
  const p = platformInfo();
  const b = billMonth({ feesRappen: c.feesRappen, minimumRappen: c.minimumRappen, aiRappen: c.aiModuleRappen + c.aiPacksRappen, vatBps: c.vatBps });
  const feeLabel = `Plattformgebühr ${hotel.platformFeeBps / 100} % auf Direktbuchungen und Gutscheine`;
  const lines: { label: string; net: number }[] = [
    ...(c.feesRappen > 0 ? [{ label: feeLabel, net: c.feesRappen }] : []),
    ...(b.shortfallRappen > 0 ? [{ label: `Ergänzung auf die Mindestgebühr (${formatChf(c.minimumRappen)} pro Monat)`, net: b.shortfallRappen }] : []),
    ...(c.aiModuleRappen > 0 ? [{ label: "KI-Chat, Modul", net: c.aiModuleRappen }] : []),
    ...(c.aiPacksRappen > 0 ? [{ label: "KI-Chat, Zusatzpakete", net: c.aiPacksRappen }] : []),
  ];
  const status = c.status === "succeeded" ? `Bezahlt per Karte ${hotel.billingCardLabel ?? ""}`.trim()
    : c.status === "none" ? "Nichts zu bezahlen: die Plattformgebühren wurden bereits bei den Buchungen über Stripe einbehalten."
    : c.status === "pending" ? `Wird der hinterlegten Karte ${hotel.billingCardLabel ?? ""} belastet.`.replace("  ", " ")
    : `Belastung der Karte fehlgeschlagen (${c.attempts} Versuche). Bitte im Admin unter Einstellungen eine gültige Karte hinterlegen.`;
  return (
    <div className="print-page">
      <style>{`.admin-head{display:none} @media print{.no-print{display:none} body{background:#fff;color:#000} .table th,.table td{font-size:10pt;padding:4px}} .inv-right{text-align:right}`}</style>
      <div className="no-print" style={{ margin: "16px 0" }}><PrintButton /></div>
      <div className="stack">
        <p style={{ margin: 0 }}><strong>{p.operator}</strong><br />{p.address}{env().PLATFORM_UID ? <><br />UID {env().PLATFORM_UID}</> : null}{c.vatNumber ? <><br />MWST-Nr. {c.vatNumber}</> : null}<br />{p.email}</p>
        <p style={{ margin: "16px 0 0" }}>{hotel.legalName ?? hotel.name}<br />{hotel.addressLine ?? ""}{hotel.addressLine ? <br /> : null}{[hotel.postalCode, hotel.city].filter(Boolean).join(" ")}</p>
        <h1>Rechnung {c.invoiceNo}</h1>
        <div className="kv small">
          <span className="muted">Rechnungsdatum</span><span>{c.invoiceDate ? fmtDay(c.invoiceDate) : ""}</span>
          <span className="muted">Leistungszeitraum</span><span>{fmtDay(`${c.month}-01`)} bis {fmtDay(monthEnd(c.month))}</span>
          <span className="muted">Betrieb</span><span>{hotel.name}</span>
        </div>
        <table className="table">
          <thead><tr><th>Leistung</th><th className="inv-right">Betrag ohne MWST</th></tr></thead>
          <tbody>
            {lines.map((l) => <tr key={l.label}><td>{l.label}</td><td className="inv-right">{formatChf(l.net)}</td></tr>)}
          </tbody>
          <tfoot>
            <tr><td><strong>Total ohne MWST</strong></td><td className="inv-right"><strong>{formatChf(b.netRappen)}</strong></td></tr>
            {c.vatBps > 0 ? <tr><td>MWST {formatBps(c.vatBps)}</td><td className="inv-right">{formatChf(c.vatRappen)}</td></tr> : null}
            <tr><td><strong>Rechnungsbetrag</strong></td><td className="inv-right"><strong>{formatChf(b.grossRappen)}</strong></td></tr>
            {c.feesRappen > 0 ? <tr><td>Abzüglich bereits über Stripe einbehaltene Plattformgebühren</td><td className="inv-right">−{formatChf(c.feesRappen)}</td></tr> : null}
            <tr><td><strong>Von der Karte zu belasten</strong></td><td className="inv-right"><strong>{formatChf(c.chargeRappen)}</strong></td></tr>
          </tfoot>
        </table>
        {c.vatBps === 0 ? <p className="small muted">Der Rechnungssteller ist nicht mehrwertsteuerpflichtig, es wird keine MWST ausgewiesen.</p> : null}
        <p className="small">{status}</p>
        <p className="small muted">Preise und Bedingungen: Bedingungen für Gastgeber der {p.name}.</p>
      </div>
    </div>
  );
}
