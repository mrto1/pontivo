import type { Metadata } from "next";
import { PlatformFrame } from "@/components/marketing/Chrome";
import { MAX_ROOMS, SOFTWARE, SOFTWARE_LABEL, suitability, type Software } from "@/src/domain/suitability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Passt Pontivo zu Ihrem Haus?", robots: { index: true } };

/** Eignungs-Check (SPEC 19.14): drei Fragen per GET, nichts wird gespeichert. */
export default async function Eignung({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const rooms = Math.floor(Number(sp.rooms));
  const software = SOFTWARE.includes(sp.software as Software) ? (sp.software as Software) : null;
  const answered = Number.isFinite(rooms) && rooms >= 1 && rooms <= 1000 && software !== null && (sp.restaurant === "yes" || sp.restaurant === "no");
  const r = answered ? suitability({ rooms, restaurantWithPos: sp.restaurant === "yes", software: software! }) : null;
  return (
    <PlatformFrame narrow>
    <main className="register u-p-8px-0-56px">
      <h1>Passt Pontivo zu Ihrem Haus?</h1>
      <p className="muted">Drei Fragen, eine ehrliche Antwort. Wir speichern nichts.</p>
      <form method="get" className="card stack">
        <div><label htmlFor="rooms">Wie viele Zimmer oder Einheiten haben Sie?</label><input id="rooms" name="rooms" type="number" min={1} max={1000} required defaultValue={answered ? rooms : undefined} /></div>
        <fieldset className="plain"><legend className="small muted">Haben Sie ein Restaurant mit eigener Kasse?</legend>
          <div className="yn-pick">
            <label><input type="radio" name="restaurant" value="no" required defaultChecked={sp.restaurant !== "yes"} /><span>Nein</span></label>
            <label><input type="radio" name="restaurant" value="yes" defaultChecked={sp.restaurant === "yes"} /><span>Ja</span></label>
          </div>
        </fieldset>
        <div><label htmlFor="software">Welche Software nutzen Sie jetzt?</label>
          <select id="software" name="software" required defaultValue={software ?? ""}><option value="" disabled>wählen</option>{SOFTWARE.map((s) => <option key={s} value={s}>{SOFTWARE_LABEL[s]}</option>)}</select></div>
        <div><button className="btn">Antwort anzeigen</button></div>
      </form>
      {r ? (
        <section className="card stack" aria-live="polite">
          <h2 className="m0">{r.title}</h2>
          <p>{r.text}</p>
          {r.reasons.length ? <ul>{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul> : null}
          <p className="small muted">Pontivo ist für Häuser bis etwa {MAX_ROOMS} Zimmer gedacht (Hotel garni, B&amp;B, Ferienwohnungen, Berggasthaus).</p>
          <p><a className="btn" href="/registrieren">Registrieren</a></p>
        </section>
      ) : null}
    </main>
    </PlatformFrame>
  );
}
