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
import { chargeQr } from "@/src/services/billing";
import { formatQrReference } from "@/src/domain/invoice";

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
  const b = billMonth({ feesRappen: c.feesRappen, minimumRappen: c.minimumRappen, aiRappen: c.aiModuleRappen + c.aiPacksRappen, vatBps: c.vatBps, uncollectedRappen: c.uncollectedFeesRappen, smsRappen: c.smsRappen });
  const feeLabel = `Plattformgebühr ${hotel.platformFeeBps / 100} % auf Direktbuchungen, Gutscheine und Online-Bestellungen`;
  const lines: { label: string; net: number }[] = [
    ...(c.feesRappen > 0 ? [{ label: feeLabel, net: c.feesRappen }] : []),
    ...(b.shortfallRappen > 0 ? [{ label: `Ergänzung auf die Mindestgebühr (${formatChf(c.minimumRappen)} pro Monat)`, net: b.shortfallRappen }] : []),
    ...(c.aiModuleRappen > 0 ? [{ label: "KI-Chat, Modul", net: c.aiModuleRappen }] : []),
    ...(c.aiPacksRappen > 0 ? [{ label: "KI-Chat, Zusatzpakete", net: c.aiPacksRappen }] : []),
    ...(c.smsRappen > 0 ? [{ label: "SMS an Gäste (Selbstkosten)", net: c.smsRappen }] : []),
  ];
  const qr = await chargeQr(hotel, c);
  const status = c.method === "qr" && c.status === "succeeded" ? `Bezahlt am ${c.paidAt ? fmtDay(c.paidAt.toISOString().slice(0, 10)) : ""}. Vielen Dank.`
    : c.status === "invoiced" ? `Zahlbar bis ${c.dueDate ? fmtDay(c.dueDate) : ""} mit dem Zahlteil unten (QR-Rechnung).`
    : c.status === "succeeded" ? `Bezahlt per Karte ${hotel.billingCardLabel ?? ""}`.trim()
    : c.status === "none" ? "Nichts zu bezahlen: die Plattformgebühren wurden bereits bei den Buchungen über Stripe einbehalten."
    : c.status === "pending" ? `Wird der hinterlegten Karte ${hotel.billingCardLabel ?? ""} belastet.`.replace("  ", " ")
    : `Belastung der Karte fehlgeschlagen (${c.attempts} Versuche). Bitte im Admin unter Einstellungen eine gültige Karte hinterlegen.`;
  return (
    <div className="print-page">
      <style>{`.admin-head{display:none} @media print{.no-print{display:none} body{background:#fff;color:#000} .table th,.table td{font-size:10pt;padding:4px}} .inv-right{text-align:right}
        .qr-slip{display:grid;grid-template-columns:62mm 1fr;border-top:1px dashed #111;margin-top:10mm;min-height:105mm;font-size:9px;background:#fff;color:#000}
        .qr-slip>div{padding:5mm} .qr-slip>div:first-child{border-right:1px dashed #111} .qr-slip h4{font-size:11px;margin:0 0 3mm}
        .qr-slip .qr{width:46mm;height:46mm} .qr-slip .qr svg{width:100%;height:100%} .qr-slip .lbl{font-size:6.5pt;font-weight:700;margin-top:2mm} .qr-slip p{margin:0;font-size:8pt}`}</style>
      <div className="no-print" style={{ margin: "16px 0" }}><PrintButton /></div>
      <div className="stack">
        <p style={{ margin: 0 }}><strong>{p.operator}</strong><br />{p.address}{env().PLATFORM_UID ? <><br />UID {env().PLATFORM_UID}</> : null}{c.vatNumber ? <><br />MWST-Nr. {c.vatNumber}</> : null}<br />{p.email}</p>
        <p style={{ margin: "16px 0 0" }}>{hotel.legalName ?? hotel.name}<br />{hotel.addressLine ?? ""}{hotel.addressLine ? <br /> : null}{[hotel.postalCode, hotel.city].filter(Boolean).join(" ")}</p>
        <h1>Rechnung {c.invoiceNo}</h1>
        <div className="kv small">
          <span className="muted">Rechnungsdatum</span><span>{c.invoiceDate ? fmtDay(c.invoiceDate) : ""}</span>
          <span className="muted">Leistungszeitraum</span><span>{fmtDay(`${c.month}-01`)} bis {fmtDay(monthEnd(c.month))}</span>
          <span className="muted">Betrieb</span><span>{hotel.name}</span>
          {c.dueDate ? <><span className="muted">Zahlbar bis</span><span>{fmtDay(c.dueDate)}</span></> : null}
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
            {b.withheldRappen > 0 ? <tr><td>Abzüglich bereits über Stripe einbehaltene Plattformgebühren</td><td className="inv-right">−{formatChf(b.withheldRappen)}</td></tr> : null}
            {c.uncollectedFeesRappen > 0 ? <tr><td className="small muted">davon nicht einbehalten (Online-Bestellungen bar): {formatChf(c.uncollectedFeesRappen)}</td><td /></tr> : null}
            <tr><td><strong>{c.method === "qr" ? "Zu bezahlen" : "Von der Karte zu belasten"}</strong></td><td className="inv-right"><strong>{formatChf(c.chargeRappen)}</strong></td></tr>
          </tfoot>
        </table>
        {c.vatBps === 0 ? <p className="small muted">Der Rechnungssteller ist nicht mehrwertsteuerpflichtig, es wird keine MWST ausgewiesen.</p> : null}
        <p className="small">{status}</p>
        <p className="small muted">Preise und Bedingungen: Bedingungen für Gastgeber der {p.name}.</p>
        {qr && "missing" in qr ? <p className="notice warn small">{qr.missing}</p> : null}
        {qr && "svg" in qr ? (
          <div className="qr-slip" data-testid="platform-qr">
            <div>
              <h4>Empfangsschein</h4>
              <div className="lbl">Konto / Zahlbar an</div>
              <p>{qr.iban.replace(/(.{4})/g, "$1 ").trim()}<br />{qr.creditor.name}<br />{qr.creditor.street}<br />{qr.creditor.zip} {qr.creditor.city}</p>
              {qr.reference ? <><div className="lbl">Referenz</div><p>{formatQrReference(qr.reference)}</p></> : null}
              <div className="lbl">Zahlbar durch</div><p>{hotel.legalName ?? hotel.name}<br />{hotel.addressLine}<br />{hotel.postalCode} {hotel.city}</p>
              <div className="lbl">Währung / Betrag</div><p>{formatChf(c.chargeRappen)}</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "51mm 1fr", gap: "5mm" }}>
              <div>
                <h4>Zahlteil</h4>
                <div className="qr" dangerouslySetInnerHTML={{ __html: qr.svg }} />
                <div className="lbl">Währung / Betrag</div><p>{formatChf(c.chargeRappen)}</p>
              </div>
              <div>
                <div className="lbl" style={{ marginTop: 8 }}>Konto / Zahlbar an</div>
                <p>{qr.iban.replace(/(.{4})/g, "$1 ").trim()}<br />{qr.creditor.name}<br />{qr.creditor.street}<br />{qr.creditor.zip} {qr.creditor.city}</p>
                {qr.reference ? <><div className="lbl">Referenz</div><p>{formatQrReference(qr.reference)}</p></> : null}
                <div className="lbl">Zusätzliche Informationen</div><p>Rechnung {c.invoiceNo}</p>
                <div className="lbl">Zahlbar durch</div><p>{hotel.legalName ?? hotel.name}<br />{hotel.addressLine}<br />{hotel.postalCode} {hotel.city}</p>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
