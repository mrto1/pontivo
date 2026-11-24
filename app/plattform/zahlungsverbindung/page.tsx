import { requirePlatformAdmin } from "@/src/auth/guard";
import { getPlatformBilling } from "@/src/services/platform-settings";
import { isQrIban } from "@/src/domain/invoice";
import { splitAddress } from "@/src/domain/platform-invoice";
import { formatChf } from "@/src/domain/money";
import { platformInfo } from "@/src/legal/texts";
import { orderFeeSwitch, orderPilotSet, saveBilling } from "../actions";
import { listOrderPilots } from "@/src/services/online-orders";
import { PILOT_CAP_RAPPEN, PILOT_SLOTS, introUntil } from "@/src/domain/order-fee";
import { orderFeeModel } from "@/src/services/platform-settings";
import { Flash, PageHead } from "../Flash";

export const dynamic = "force-dynamic";
const TO = "/plattform/zahlungsverbindung";

/** Zahlungsverbindung der Plattform für QR-Rechnungen an die Betriebe (SPEC 20.6) */
export default async function Zahlungsverbindung({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const [b, model, pilots] = await Promise.all([getPlatformBilling(), orderFeeModel(), listOrderPilots()]);
  const used = pilots.filter((x) => x.pilot_until).length;
  const dmy = (d: string) => d.split("-").reverse().join(".");
  const p = platformInfo();
  const addr = splitAddress(p.address);
  return (
    <div className="stack gap24">
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
      <section className="card stack" data-testid="order-fee-model">
        <h2>Preismodell Online-Bestellung</h2>
        <p>Aktuell: <strong>{model === "fixed" ? "alle Betriebe CHF 59 pro Monat (Sonderangebot verlängert), keine Gebühr pro Bestellung" : "1,9 % pro Bestellung; CHF 59 pro Monat nur im Sonderangebot (erste 3 Monate ab Einschalten)"}</strong>.</p>
        <p className="small muted">Kommuniziert wird: Normalpreis 1,9 %, Sonderangebot 3 Monate pauschal, Pilotbetriebe mit Kostendach. Vorerst zahlen alle pauschal, weil die Plattformbesteuerung (Art. 20a MWSTG) bei umsatzabhängiger Gebühr nicht geklärt ist (Anfrage bei der ESTV). Auf 1,9 % erst umstellen, wenn die ESTV schriftlich bestätigt hat, dass Pontivo keine Plattform im Sinne von Art. 20a ist, und nach Ankündigung an die Betriebe gemäss Bedingungen für Gastgeber.</p>
        <form action={orderFeeSwitch}><input type="hidden" name="to" value={TO} /><input type="hidden" name="model" value={model === "fixed" ? "percent" : "fixed"} />
          <button className="btn secondary small">{model === "fixed" ? "Auf 1,9 % pro Bestellung umstellen" : "Zurück auf CHF 59 pro Monat"}</button></form>
      </section>
      <section className="card stack" data-testid="order-pilots">
        <h2>Pilotbetriebe Online-Bestellung</h2>
        <p className="small muted">Die ersten {PILOT_SLOTS} Betriebe, die die Online-Bestellung einschalten, werden automatisch Pilotbetrieb: 12 Monate ab Start höchstens {formatChf(PILOT_CAP_RAPPEN)} Gebühren pro Monat (wirkt erst mit 1,9 % pro Bestellung). Vergeben: {used} von {PILOT_SLOTS}. Entziehen gibt den Platz frei (Gründe: <a href="/pilot-bedingungen" target="_blank">Pilotbedingungen</a> Ziffer 3). Vor Ende des Sonderangebots geht 30 Tage vorher automatisch ein Hinweis an den Betrieb, wenn das Modell auf 1,9 % steht. Die Umstellung des Modells mindestens 60 Tage vorher ankündigen (Ziffer 2).</p>
        {pilots.length ? (
          <table className="table">
            <thead><tr><th>Betrieb</th><th>Start</th><th>Sonderangebot bis</th><th>Pilot bis</th><th /></tr></thead>
            <tbody>{pilots.map((x) => (
              <tr key={x.hotel_id}>
                <td>{x.name}{x.enabled ? null : <span className="badge">aus</span>}</td>
                <td>{x.started_on ? dmy(x.started_on) : "–"}</td>
                <td>{x.started_on ? dmy(introUntil(x.started_on)) + " (exkl.)" : "–"}</td>
                <td>{x.pilot_until ? dmy(x.pilot_until) + " (exkl.)" : "–"}</td>
                <td><form action={orderPilotSet}><input type="hidden" name="to" value={TO} /><input type="hidden" name="hotelId" value={x.hotel_id} /><input type="hidden" name="on" value={x.pilot_until ? "0" : "1"} />
                  <button className="btn secondary small" disabled={!x.pilot_until && used >= PILOT_SLOTS}>{x.pilot_until ? "Pilotstatus entziehen" : "Zum Pilotbetrieb machen"}</button></form></td>
              </tr>))}</tbody>
          </table>
        ) : <p className="small">Noch kein Betrieb hat die Online-Bestellung eingeschaltet.</p>}
      </section>
    </div>
  );
}
