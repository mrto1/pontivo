import { requirePlatformAdmin } from "@/src/auth/guard";
import { getPlatformVat } from "@/src/services/platform-settings";
import { formatBps } from "@/src/domain/invoice";
import { todayIn } from "@/src/domain/dates";
import { saveVat } from "../actions";
import { Flash, PageHead } from "../Flash";

export const dynamic = "force-dynamic";
const TO = "/plattform/mwst";

export default async function Mwst({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const vat = await getPlatformVat();
  return (
    <div className="stack gap24">
      <PageHead title="MWST der Plattform">Ab wann ist Lynxora MWST-pflichtig? Ab diesem Datum weisen neue Rechnungen an die Betriebe die MWST aus und belasten sie zusätzlich (die Preise verstehen sich ohne MWST, Bedingungen für Gastgeber Ziffer 2). Massgebend ist der letzte Tag des Leistungsmonats; beginnt die Pflicht mitten im Monat, gilt sie für den ganzen Monat. Bereits ausgestellte Rechnungen ändern sich nicht.</PageHead>
      <Flash sp={sp} />
      <section className="card stack">
        <form action={saveVat} className="stack u-maxw-460px">
          <input type="hidden" name="to" value={TO} />
          <label className="check"><input type="checkbox" name="liable" defaultChecked={!!vat.liableFrom} /> MWST-pflichtig</label>
          <label>ab Datum<input type="date" name="from" defaultValue={vat.liableFrom ?? todayIn("Europe/Zurich")} /></label>
          <label>Satz in % (Normalsatz seit 2024: 8,1)<input name="rate" inputMode="decimal" defaultValue={String(vat.bps / 100)} /></label>
          <label>MWST-Nummer<input name="number" placeholder="CHE-123.456.789 MWST" defaultValue={vat.number} /></label>
          <div><button className="btn">Speichern</button></div>
        </form>
        <p className="small">{vat.liableFrom ? <>Aktuell: <strong>MWST-pflichtig ab {vat.liableFrom}</strong>, Satz {formatBps(vat.bps)}.</> : <>Aktuell: <strong>nicht MWST-pflichtig</strong>, Rechnungen ohne MWST.</>}</p>
      </section>
    </div>
  );
}
