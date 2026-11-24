import { Notice } from "@/components/admin/Notice";
import { InfoTip } from "@/components/admin/InfoTip";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { env } from "@/src/env";
import { LIMITS, setupImportGate, type Draft } from "@/src/domain/setup-import";
import { adoptImport, discardImport, getImport, importFromPdf, importFromUrl, importsThisMonth, listImports, setupImportEnabled, SetupImportError } from "@/src/services/setup-import";
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";

const back = (hotelId: string, q: string): never => redirect(`/admin/${hotelId}/ki-einrichten?${q}`);
const msg = (hotelId: string, m: string, id?: string): never => back(hotelId, `msg=${encodeURIComponent(m)}${id ? `&draft=${id}` : ""}`);

async function run(f: FormData, fn: (c: Awaited<ReturnType<typeof requireHotel>>) => Promise<string>) {
  const c = await requireHotel(s(f, "hotelId"), "manager");
  let target: string;
  try { target = await fn(c); } catch (e) {
    if (e instanceof SetupImportError) return msg(c.hotel.id, `Nicht möglich: ${e.message}`);
    throw e;
  }
  return back(c.hotel.id, target);
}

async function fromUrl(f: FormData) {
  "use server";
  await run(f, async (c) => `draft=${await importFromUrl(c.hotel, s(f, "url"), c.actor)}`);
}
async function fromPdf(f: FormData) {
  "use server";
  await run(f, async (c) => {
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) throw new SetupImportError("Bitte eine PDF-Datei wählen.");
    return `draft=${await importFromPdf(c.hotel, new Uint8Array(await file.arrayBuffer()), file.name, c.actor)}`;
  });
}
async function adopt(f: FormData) {
  "use server";
  await run(f, async (c) => {
    const nums = (k: string) => f.getAll(k).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0);
    const r = await adoptImport(c.hotel, s(f, "id"), { intro: f.get("intro") === "on", rooms: nums("room"), faq: nums("faq") }, c.actor);
    const parts = [`${r.rooms} Zimmer angelegt${r.skippedRooms ? ` (${r.skippedRooms} schon vorhanden, übersprungen)` : ""}`, `${r.faq} Fragen auf die Startseite gesetzt`, r.intro ? "Einleitung übernommen" : ""].filter(Boolean);
    return `msg=${encodeURIComponent(`Übernommen: ${parts.join(", ")}. Nächster Schritt: Preise bei den Zimmern eintragen.`)}`;
  });
}
async function discard(f: FormData) {
  "use server";
  await run(f, async (c) => { await discardImport(c.hotel.id, s(f, "id"), c.actor); return `msg=${encodeURIComponent("Entwurf verworfen.")}`; });
}

export default async function KiEinrichten({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager");
  const gate = setupImportGate(hotel, setupImportEnabled());
  const [used, imports] = await Promise.all([importsThisMonth(hotel.id), listImports(hotel.id)]);
  const left = Math.max(0, env().SETUP_RUNS_PER_MONTH - used);
  const open = sp.draft ? await getImport(hotel.id, sp.draft) : null;
  const d = open?.status === "draft" ? (open.draft as unknown as Draft) : null;
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;

  return (
    <div className="stack">
      <h1>Einrichten mit KI</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <div><InfoTip label="Worum geht es hier?">Die KI liest Ihre bestehende Website (oder ein PDF, z. B. Hausprospekt) und macht daraus einen <strong>Entwurf</strong>: Zimmer, eine kurze Einleitung und häufige Fragen. Nichts wird ohne Ihre Prüfung übernommen. Preise, Telefonnummern, Links und Codes liest die KI bewusst nicht aus: die tragen Sie selbst ein.</InfoTip></div>

      <p className="notice small">Bitte nur Quellen angeben, an denen Sie die Rechte haben (Ihre eigene Website oder eigene Unterlagen). Texte fremder Websites, Portale oder Agenturen können urheberrechtlich geschützt sein, siehe <a href="/gastgeber-bedingungen" target="_blank">Bedingungen für Gastgeber, Ziffer 9</a>.</p>
      {!gate.ok ? <p className="notice warn">{gate.reason}</p> : (
        <>
          <p className="small muted">Noch {left} von {env().SETUP_RUNS_PER_MONTH} Läufen in diesem Monat. Gelesen werden höchstens {LIMITS.maxPages} Seiten Ihrer Website bzw. ein PDF bis {LIMITS.pdfBytes / 1_000_000} MB und {LIMITS.pdfPages} Seiten. Der gelesene Text wird nicht gespeichert, nur der Entwurf.</p>
          <div className="row">
            <form action={fromUrl} className="card stack flex1">
              {hidden}
              <h2>Aus Ihrer Website</h2>
              <div><label htmlFor="fff281">Adresse (https://…)</label><input id="fff281" name="url" type="url" placeholder="https://www.mein-hotel.ch" required /></div>
              <div><button className="btn" disabled={left === 0}>Entwurf erstellen</button></div>
            </form>
            <form action={fromPdf} className="card stack flex1" encType="multipart/form-data">
              {hidden}
              <h2>Aus einem PDF</h2>
              <div><label htmlFor="fff282">Datei (Prospekt, Zimmerliste)</label><input id="fff282" name="file" type="file" accept="application/pdf" required /></div>
              <div><button className="btn" disabled={left === 0}>Entwurf erstellen</button></div>
            </form>
          </div>
        </>
      )}

      {d ? (
        <form action={adopt} className="card stack">
          {hidden}<input type="hidden" name="id" value={open!.id} />
          <h2>Entwurf prüfen</h2>
          <p className="muted small">Haken setzen, was Sie übernehmen möchten. Alles lässt sich danach im normalen Admin ändern. Die KI kann sich irren: bitte jede Angabe kontrollieren.</p>
          {d.intro ? <label className="check"><input type="checkbox" name="intro" defaultChecked /> <span><strong>Einleitung</strong> (nur wenn bei Ihnen noch keine steht): {d.intro}</span></label> : null}
          {d.rooms?.length ? <fieldset><legend>Zimmer ({d.rooms.length}), ohne Preise</legend>
            {d.rooms.map((r, i) => <label key={i} className="check"><input type="checkbox" name="room" value={i} defaultChecked /> <span><strong>{r.name}</strong>, {r.maxAdults} Erw.{r.maxChildren ? ` + ${r.maxChildren} Kinder` : ""}, {r.roomCount}× vorhanden{r.description ? `. ${r.description}` : ""}</span></label>)}
          </fieldset> : null}
          {d.faq?.length ? <fieldset><legend>Häufige Fragen ({d.faq.length})</legend>
            {d.faq.map((x, i) => <label key={i} className="check"><input type="checkbox" name="faq" value={i} defaultChecked /> <span><strong>{x.q}</strong> {x.a}</span></label>)}
          </fieldset> : null}
          <div className="row"><button className="btn">Gewähltes übernehmen</button></div>
        </form>
      ) : null}
      {d ? <form action={discard}>{hidden}<input type="hidden" name="id" value={open!.id} /><button className="btn secondary">Entwurf verwerfen</button></form> : null}

      {imports.length ? (
        <section className="stack"><h2>Bisherige Läufe</h2>
          <table className="table small"><tbody>
            {imports.map((x) => <tr key={x.id}><td>{x.createdAt.toLocaleDateString("de-CH")}</td><td>{x.kind === "url" ? "Website" : "PDF"}</td><td>{x.source}</td>
              <td>{{ running: "läuft", draft: "Entwurf offen", adopted: "übernommen", discarded: "verworfen", failed: "fehlgeschlagen" }[x.status]}</td>
              <td>{x.status === "draft" ? <a href={`?draft=${x.id}`}>ansehen</a> : null}</td></tr>)}
          </tbody></table>
        </section>
      ) : null}
    </div>
  );
}
