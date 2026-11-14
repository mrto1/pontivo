import { notFound } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { invoiceView, invoicingSettings } from "@/src/services/invoicing";
import { formatChf } from "@/src/domain/money";
import { formatBps } from "@/src/domain/invoice";
import { formatDay } from "@/src/i18n/dict";
import { PrintButton } from "@/components/public/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

/** Druckansicht A4 (im Browser «Als PDF speichern»): Rechnung, Quittung oder Gutschrift, unten der Zahlteil der QR-Rechnung */
export default async function PrintInvoice({ params }: { params: Promise<{ hotelId: string; invoiceId: string }> }) {
  const { hotelId, invoiceId } = await params;
  const { hotel } = await requireHotel(hotelId);
  await requireModule(hotel.id, "invoicing");
  const v = await invoiceView(hotel, invoiceId);
  if (!v || v.invoice.status !== "issued") notFound();
  const { invoice: inv } = v;
  const set = invoicingSettings(hotel);
  const credit = inv.kind === "credit_note";
  const receipt = !credit && v.openRappen <= 0;
  const title = credit ? "Gutschrift" : receipt ? "Quittung" : "Rechnung";
  const r = inv.recipient;
  const address = [[hotel.addressLine], [hotel.postalCode, hotel.city].filter(Boolean).join(" ")].flat().filter(Boolean);
  return (
    <div className="invoice-sheet">
      <style>{`
        .invoice-sheet { max-width: 210mm; margin: 0 auto; padding: 12mm 14mm; background: #fff; color: #111; font: 13px/1.45 Arial, sans-serif; }
        .invoice-sheet h1 { font-size: 22px; margin: 0 0 4px; }
        .invoice-sheet table { border-collapse: collapse; width: 100%; }
        .invoice-sheet th, .invoice-sheet td { padding: 4px 6px; text-align: left; vertical-align: top; }
        .invoice-sheet td.n, .invoice-sheet th.n { text-align: right; white-space: nowrap; }
        .invoice-sheet thead th { border-bottom: 1px solid #111; }
        .invoice-sheet .tot td { border-top: 1px solid #111; font-weight: 700; }
        .qr-slip { display: grid; grid-template-columns: 62mm 1fr; border-top: 1px dashed #111; margin-top: 10mm; min-height: 105mm; font-size: 9px; }
        .qr-slip > div { padding: 5mm; }
        .qr-slip > div:first-child { border-right: 1px dashed #111; }
        .qr-slip h4 { font-size: 11px; margin: 0 0 3mm; }
        .qr-slip .qr { width: 46mm; height: 46mm; }
        .qr-slip .qr svg { width: 100%; height: 100%; }
        .qr-slip .lbl { font-size: 6.5pt; font-weight: 700; margin-top: 2mm; }
        .qr-slip p { margin: 0; font-size: 8pt; }
        @media print { .invoice-sheet { padding: 0; } .admin-head, .section-tabs, .no-print { display: none !important; } @page { size: A4; margin: 10mm; } }
      `}</style>
      <div className="no-print" style={{ marginBottom: 12 }}><PrintButton label="Drucken / als PDF speichern" /></div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 24 }}>
        <div>
          <strong>{hotel.name}</strong><br />{address.map((a) => <span key={a}>{a}<br /></span>)}
          {hotel.contactPhone ? <>{hotel.contactPhone}<br /></> : null}{hotel.contactEmail}
          {set.vatLiable && set.vatNumber ? <><br />{set.vatNumber}</> : null}
        </div>
        <div style={{ textAlign: "right" }}>
          <h1>{title}</h1>
          Nr. {inv.number}<br />Datum {inv.issuedOn ? formatDay(inv.issuedOn, "de") : ""}
          {!credit && inv.dueOn && v.openRappen > 0 ? <><br />Zahlbar bis {formatDay(inv.dueOn, "de")}</> : null}
          {v.booking ? <><br />Buchung {v.booking.reference}</> : null}
        </div>
      </div>
      <p style={{ margin: "10mm 0 6mm" }}>
        {r.company ? <>{r.company}<br /></> : null}{r.name ? <>{r.name}<br /></> : null}{r.street ? <>{r.street}<br /></> : null}
        {[r.zip, r.city].filter(Boolean).join(" ")}{r.country && r.country !== "CH" ? `, ${r.country}` : ""}{r.vatId ? <><br />MWST-/UID-Nr. {r.vatId}</> : null}
      </p>
      {v.booking ? <p>Aufenthalt {formatDay(v.booking.checkin, "de")} bis {formatDay(v.booking.checkout, "de")}</p> : null}
      <table>
        <thead><tr><th>Beschreibung</th><th className="n">Menge</th><th className="n">Preis</th>{set.vatLiable ? <th className="n">MWST</th> : null}<th className="n">Betrag CHF</th></tr></thead>
        <tbody>
          {v.lines.map((l) => (
            <tr key={l.id}><td>{l.description}</td><td className="n">{l.quantity}</td><td className="n">{formatChf(l.unitPriceRappen)}</td>{set.vatLiable ? <td className="n">{l.vatBps ? formatBps(l.vatBps) : "–"}</td> : null}<td className="n">{formatChf(l.amountRappen)}</td></tr>
          ))}
          <tr className="tot"><td colSpan={set.vatLiable ? 4 : 3}>Total {set.vatLiable ? "inkl. MWST " : ""}CHF</td><td className="n">{formatChf(inv.totalRappen)}</td></tr>
        </tbody>
      </table>
      {set.vatLiable ? (
        <table style={{ marginTop: 8, width: "auto" }}>
          <thead><tr><th>MWST-Satz</th><th className="n">Netto</th><th className="n">MWST</th><th className="n">Brutto</th></tr></thead>
          <tbody>
            {v.vat.rows.map((x) => <tr key={x.bps}><td>{x.bps ? formatBps(x.bps) : "ohne MWST"}</td><td className="n">{formatChf(x.netRappen)}</td><td className="n">{formatChf(x.vatRappen)}</td><td className="n">{formatChf(x.grossRappen)}</td></tr>)}
          </tbody>
        </table>
      ) : null}
      {!credit && v.payments.length ? (
        <>
          <p style={{ marginTop: 10, marginBottom: 2 }}><strong>Zahlungen</strong></p>
          <table style={{ width: "auto" }}><tbody>{v.payments.map((p, i) => <tr key={i}><td>{formatDay(p.date, "de")}</td><td>{p.label}</td><td className="n">{formatChf(p.amountRappen)}</td></tr>)}</tbody></table>
        </>
      ) : null}
      {!credit ? <p style={{ marginTop: 8 }}><strong>{v.openRappen > 0 ? `Offener Betrag CHF ${formatChf(v.openRappen)}` : "Der Betrag ist vollständig bezahlt. Vielen Dank."}</strong></p> : null}
      {inv.note ? <p>{inv.note}</p> : null}
      {set.footer ? <p className="muted">{set.footer}</p> : null}

      {v.qrSvg ? (
        <div className="qr-slip">
          <div>
            <h4>Empfangsschein</h4>
            <div className="lbl">Konto / Zahlbar an</div>
            <p>{set.iban.replace(/(.{4})/g, "$1 ").trim()}<br />{hotel.name}<br />{hotel.addressLine}<br />{hotel.postalCode} {hotel.city}</p>
            {r.name || r.company ? <><div className="lbl">Zahlbar durch</div><p>{r.company || r.name}<br />{r.street}<br />{r.zip} {r.city}</p></> : null}
            <div className="lbl">Währung / Betrag</div><p>CHF {formatChf(v.openRappen)}</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "51mm 1fr", gap: "5mm" }}>
            <div>
              <h4>Zahlteil</h4>
              <div className="qr" dangerouslySetInnerHTML={{ __html: v.qrSvg }} />
              <div className="lbl">Währung / Betrag</div><p>CHF {formatChf(v.openRappen)}</p>
            </div>
            <div>
              <div className="lbl" style={{ marginTop: 8 }}>Konto / Zahlbar an</div>
              <p>{set.iban.replace(/(.{4})/g, "$1 ").trim()}<br />{hotel.name}<br />{hotel.addressLine}<br />{hotel.postalCode} {hotel.city}</p>
              <div className="lbl">Zusätzliche Informationen</div><p>Rechnung {inv.number}</p>
              {r.name || r.company ? <><div className="lbl">Zahlbar durch</div><p>{r.company || r.name}<br />{r.street}<br />{r.zip} {r.city}</p></> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
