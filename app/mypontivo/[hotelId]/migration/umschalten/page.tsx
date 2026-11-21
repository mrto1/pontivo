import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireHotel } from "@/src/auth/guard";
import { rollbackUntil } from "@/src/domain/switchover";
import { confirmSwitchItem, finishSwitchover, ImportError, setOldFuture, switchoverView } from "@/src/services/migration";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (id: string, q: string) => { revalidatePath(`/mypontivo/${id}`, "layout"); return redirect(`/mypontivo/${id}/migration/umschalten?${q}`); };
async function guard<T>(id: string, fn: () => Promise<T>): Promise<void> {
  try { await fn(); } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    back(id, `error=${encodeURIComponent(e.message)}`);
  }
}

async function confirm(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await guard(c.hotel.id, () => confirmSwitchItem(c.hotel, s(f, "key"), s(f, "on") === "1", c.actor));
  back(c.hotel.id, "");
}
async function oldCount(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await guard(c.hotel.id, () => setOldFuture(c.hotel, Number(s(f, "n")), c.actor));
  back(c.hotel.id, "");
}
async function finish(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await guard(c.hotel.id, () => finishSwitchover(c.hotel, c.actor));
  back(c.hotel.id, `msg=${encodeURIComponent("Umgeschaltet. Viel Erfolg mit Pontivo!")}`);
}

export default async function Umschalten({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager", "migration");
  const v = await switchoverView(hotel);
  const done = v.state.switchedAt;
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  return (
    <div className="stack">
      <p className="small"><a href={`/mypontivo/${hotel.id}/migration`}>← Datenübernahme</a></p>
      <h1>Umschalt-Checkliste</h1>
      <p className="muted">Gehen Sie die Punkte der Reihe nach durch. Pontivo prüft, was es prüfen kann; den Rest bestätigen Sie. Nichts ist gesperrt: Erst mit «Umschalten» endet der Parallelbetrieb.</p>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      {sp.error ? <p className="notice warn" role="alert">{sp.error}</p> : null}
      {done ? <p className="notice">Umgeschaltet am {new Date(done).toLocaleDateString("de-CH")}. Ihre Übernahmen lassen sich noch bis {rollbackUntil(done).toLocaleDateString("de-CH")} rückgängig machen (Seite «Datenübernahme»), solange nichts Wesentliches daran bearbeitet wurde.</p> : null}
      <ol className="stack" style={{ paddingLeft: 0, listStyle: "none" }}>
        {v.items.map((i, n) => (
          <li key={i.key} className="card stack">
            <h2 style={{ margin: 0 }}>{n + 1}. {i.title} {i.done ? <span className="badge">erledigt</span> : <span className="badge warn">offen</span>}{i.required ? null : <span className="muted small"> (freiwillig)</span>}</h2>
            <p style={{ margin: 0 }}>{i.help}</p>
            <p className="small muted" style={{ margin: 0 }}>{i.hint}</p>
            {i.key === "reservierungen" ? (
              <form action={oldCount} className="inline-form">{H}
                <div><label htmlFor="n">Künftige Reservierungen in der alten Software</label><input id="n" name="n" type="number" min={0} defaultValue={v.state.oldFuture ?? ""} required /></div>
                <div><button className="btn secondary small">Vergleichen</button></div>
              </form>
            ) : null}
            {i.key === "kanaele" ? <p className="small"><a href={`/mypontivo/${hotel.id}/channex`}>Zum Channel-Manager</a> · <a href={`/mypontivo/${hotel.id}/ical`}>Kalender-Abgleich</a></p> : null}
            {i.key === "rechnungsnummer" ? <p className="small"><a href={`/mypontivo/${hotel.id}/migration`}>Nächste Nummer setzen</a></p> : null}
            {i.key === "team" ? <p className="small"><a href={`/mypontivo/${hotel.id}/settings`}>Zu den Einstellungen</a></p> : null}
            {i.confirmable || i.done ? (
              <form action={confirm}>{H}<input type="hidden" name="key" value={i.key} />
                {(v.state.confirmed ?? []).includes(i.key)
                  ? <><input type="hidden" name="on" value="0" /><button className="btn secondary small">Bestätigung zurücknehmen</button></>
                  : i.done ? null : <><input type="hidden" name="on" value="1" /><button className="btn small">Erledigt, bestätigen</button></>}
              </form>
            ) : null}
          </li>
        ))}
      </ol>
      {!done ? (
        <form action={finish}>{H}
          <button className="btn" disabled={!v.ready}>Umschalten: Parallelbetrieb beenden</button>
          {!v.ready ? <span className="muted small"> Zuerst alle Pflichtpunkte erledigen.</span> : null}
        </form>
      ) : null}
    </div>
  );
}
