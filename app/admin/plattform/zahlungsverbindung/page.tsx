import { requirePlatformAdmin } from "@/src/auth/guard";
import { getPlatformBilling } from "@/src/services/platform-settings";
import { isQrIban } from "@/src/domain/invoice";
import { splitAddress } from "@/src/domain/platform-invoice";
import { platformInfo } from "@/src/legal/texts";
import { saveBilling } from "../actions";
import { Flash, PageHead } from "../Flash";

export const dynamic = "force-dynamic";
const TO = "/admin/plattform/zahlungsverbindung";

/** Zahlungsverbindung der Plattform für QR-Rechnungen an die Betriebe (SPEC 20.6) */
export default async function Zahlungsverbindung({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const b = await getPlatformBilling();
  const p = platformInfo();
  const addr = splitAddress(p.address);
  return (
    <div className="stack" style={{ gap: 24 }}>
      <PageHead title="Zahlungsverbindung">Konto für die QR-Rechnungen an Betriebe, die die Grundgebühr per QR-Rechnung bezahlen. Mit einer QR-IBAN erhalten die Rechnungen eine QR-Referenz, und Zahlungen lassen sich mit der Bankdatei (camt.054) automatisch zuordnen; mit einer gewöhnlichen IBAN steht die Rechnungsnummer als Mitteilung im Zahlteil.</PageHead>
      <Flash sp={sp} />
      <section className="card stack">
        <form action={saveBilling} className="stack" style={{ maxWidth: 460 }}>
          <input type="hidden" name="to" value={TO} />
          <label>IBAN oder QR-IBAN<input name="iban" defaultValue={b.iban.replace(/(.{4})/g, "$1 ").trim()} placeholder="CH44 3199 9123 0008 8901 2" /></label>
          <label>Zahlungsfrist in Tagen<input name="days" type="number" min={5} max={90} defaultValue={b.paymentDays} /></label>
          <div><button className="btn">Speichern</button></div>
        </form>
        <p className="small">{b.iban ? <>Aktuell: <strong>{isQrIban(b.iban) ? "QR-IBAN (Referenz QRR, Bankdatei ordnet zu)" : "IBAN (ohne Referenz; Zahlungen von Hand erfassen)"}</strong>, Frist {b.paymentDays} Tage.</> : <span className="badge warn">Keine IBAN: QR-Rechnungen entstehen ohne Zahlteil.</span>}</p>
        <p className="small muted">Zahlungsempfänger im Zahlteil: {p.operator}, {addr ? `${addr.street}, ${addr.zip} ${addr.city}` : <span className="badge warn">Adresse unvollständig (PLATFORM_ADDRESS)</span>}.</p>
      </section>
    </div>
  );
}
