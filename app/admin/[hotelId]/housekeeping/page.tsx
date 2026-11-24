import { Notice } from "@/components/admin/Notice";
import { PeriodNav } from "@/components/admin/PeriodNav";
import { redirect } from "next/navigation";
import Link from "next/link";
import { InfoTip } from "@/components/admin/InfoTip";
import { DrawerKeys } from "@/components/admin/DrawerKeys";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { moduleOn, requireModule } from "@/src/services/modules";
import { GoodsError, countMinibar, markRefilled, minibarGoods, refillList } from "@/src/services/goods";
import { addTask, board, generateTasks, HousekeepingError, reportIssue, doneIssues, removeTask, resolveIssue, updateIssue, setCleanStatus, type CleanStatus } from "@/src/services/housekeeping";
import { addDays, isDay, todayIn } from "@/src/domain/dates";
import { formatDay } from "@/src/i18n/dict";
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";

const LABEL: Record<CleanStatus, string> = { dirty: "Schmutzig", clean: "Sauber", inspected: "Geprüft" };
const LABEL_BTN = LABEL;

async function act(f: FormData, fn: (c: Awaited<ReturnType<typeof requireHotel>>) => Promise<void>) {
  const c = await requireHotelModule("housekeeping", s(f, "hotelId"), "staff", "housekeeping");
  let msg = "";
  try { await fn(c); } catch (e) { if (!(e instanceof HousekeepingError)) throw e; msg = e.message; }
  redirect(`/admin/${c.hotel.id}/housekeeping?day=${s(f, "day")}${msg ? `&msg=${encodeURIComponent(msg)}` : ""}`);
}
async function status(f: FormData) {
  "use server";
  await act(f, (c) => setCleanStatus(c.hotel.id, s(f, "roomId"), s(f, "to") as CleanStatus, c.actor));
}
async function report(f: FormData) {
  "use server";
  // Ein Formular für beides: «Mangel» (etwas ist defekt, bleibt offen bis «Erledigt») oder «Auftrag» (zusätzliche Reinigungsaufgabe für den Tag)
  const isTask = s(f, "kind") === "task";
  await act(f, (c) => (isTask ? addTask(c.hotel.id, s(f, "roomId"), s(f, "day"), s(f, "text"), c.actor) : reportIssue(c.hotel.id, s(f, "roomId"), s(f, "text"), c.actor)));
}
async function minibar(f: FormData) {
  "use server";
  const c = await requireHotelModule("housekeeping", s(f, "hotelId"), "staff", "housekeeping");
  await requireModule(c.hotel.id, "shop");
  let msg: string;
  try {
    const counts = [...f.keys()].filter((k) => k.startsWith("n_")).map((k) => ({ goodId: k.slice(2), present: Number(s(f, k)) }));
    const r = await countMinibar(c.hotel.id, s(f, "roomId"), s(f, "day"), counts, c.actor);
    msg = r.billed.length ? `Minibar verrechnet: ${r.billed.map((b) => `${b.quantity} × ${b.name}`).join(", ")}.` : "Minibar vollständig.";
  } catch (e) {
    if (!(e instanceof GoodsError)) throw e;
    msg = `Nicht gespeichert: ${e.message}`;
  }
  redirect(`/admin/${c.hotel.id}/housekeeping?day=${s(f, "day")}&room=${s(f, "roomId")}&msg=${encodeURIComponent(msg)}`);
}
async function refilled(f: FormData) {
  "use server";
  await act(f, async (c) => {
    await requireModule(c.hotel.id, "shop");
    await markRefilled(c.hotel.id, s(f, "roomId"), c.actor);
  });
}
async function dropTask(f: FormData) {
  "use server";
  await act(f, (c) => removeTask(c.hotel.id, s(f, "roomId"), s(f, "day"), c.actor));
}
async function editIssue(f: FormData) {
  "use server";
  await act(f, (c) => updateIssue(c.hotel.id, s(f, "issueId"), s(f, "text"), c.actor));
}
async function fix(f: FormData) {
  "use server";
  await act(f, (c) => resolveIssue(c.hotel.id, s(f, "issueId"), c.actor));
}
/** Handy-Liste für das Reinigungspersonal (SPEC 17.1): grosse Karten, ein Tipp pro Statuswechsel */
export default async function Housekeeping({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("housekeeping", hotelId, "staff", "housekeeping");
  const today = todayIn(hotel.timezone);
  const day = sp.day && isDay(sp.day) ? sp.day : today;
  const stayEvery = Number((hotel.content as { housekeeping?: { stayEvery?: number } } | null)?.housekeeping?.stayEvery ?? 0) || 0;
  if (day <= today) await generateTasks(hotel.id, day, "system", stayEvery);
  const rooms = await board(hotel.id, day);
  const order = (r: (typeof rooms)[number]) => (r.status === "dirty" ? 0 : r.arriving ? 1 : r.task?.status === "open" ? 2 : 3);
  const sorted = [...rooms].filter((r) => r.active).sort((a, b) => order(a) - order(b) || a.number.localeCompare(b.number, "de", { numeric: true }));
  const counts = { dirty: rooms.filter((r) => r.status === "dirty").length, open: rooms.reduce((a, r) => a + r.issues.length, 0) };
  const hid = (id: string) => (<><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="day" value={day} /><input type="hidden" name="roomId" value={id} /></>);
  const editable = day === today; // ASSUMPTION: der Status gilt für das Zimmer jetzt, nicht je Tag; an anderen Tagen nur Vorschau/Rückblick
  const open = sp.room ? sorted.find((r) => r.roomId === sp.room) : undefined;
  const mini = open && hotel.propertyType !== "restaurant" && (await moduleOn(hotel.id, "shop")) ? await minibarGoods(hotel.id) : [];
  const shopOn = hotel.propertyType !== "restaurant" && (await moduleOn(hotel.id, "shop"));
  const done = open ? await doneIssues(hotel.id, open.roomId) : [];
  const refills = shopOn ? await refillList(hotel.id) : [];
  const n = (st: CleanStatus) => rooms.filter((r) => r.active && r.status === st).length;
  return (
    <div className="stack hk">
      <h1 className="sr-only">Reinigung</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <PeriodNav prev={`?day=${addDays(day, -1)}`} next={`?day=${addDays(day, 1)}`} todayHref="?" todayActive={day === today} prevLabel="Vortag" nextLabel="Folgetag" jump={{ value: day, param: "day" }}>
        <span className="small muted">{formatDay(day, "de")}</span>
      </PeriodNav>
      <div>
        <InfoTip label="Was heisst Sauber und Geprüft?">
          <p><strong>Schmutzig:</strong> Das Zimmer muss gereinigt werden (nach der Abreise automatisch).</p>
          <p><strong>Sauber:</strong> Die Reinigung ist fertig.</p>
          <p><strong>Geprüft:</strong> Zusätzlich hat jemand (z. B. die Leitung) das Zimmer kontrolliert und freigegeben. Wer nicht kontrolliert, nutzt nur Schmutzig und Sauber.</p>
        </InfoTip>
      </div>
      <div className="hk-summary" aria-label="Übersicht">
        {(["dirty", "clean", "inspected"] as CleanStatus[]).map((x) => (
          <span key={x} className="hk-stat" style={{ ["--c" as string]: `var(--hk-${x})` }}><span className="hk-dot" /><b>{n(x)}</b> {LABEL[x]}</span>
        ))}
        {counts.open ? <span className="hk-stat"><b>{counts.open}</b> offene Mängel</span> : null}
      </div>
      {!editable ? <p className="notice small">{day > today ? "Vorschau: Anreisen und Abreisen dieses Tages." : "Rückblick."} Den Reinigungsstatus ändern Sie nur für heute.</p> : null}
      {sorted.length === 0 ? <p className="muted">Noch keine Zimmer. Zimmer legen Sie unter Kalender → Zimmerplan an.</p> : null}
      {refills.length ? (
        <section className="card stack" id="nachfuellen" aria-label="Minibar nachfüllen">
          <h2 className="m0">Minibar nachfüllen</h2>
          <ul className="plan-list">
            {refills.map((r) => (
              <li key={r.roomId} className="plan-row" style={{ cursor: "default" }}>
                <span><strong>Zimmer {r.number}</strong><br /><span className="muted small">{r.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</span></span>
                <form action={refilled}>{hid(r.roomId)}<button className="btn secondary small">Aufgefüllt</button></form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="hk-grid">
        {sorted.map((r) => (
          <section key={r.roomId} className={`card hk-card ${r.status}`}>
            <div className="hk-head">
              <h2>Zimmer {r.number}{r.floor ? <span className="muted small"> · Etage {r.floor}</span> : null}</h2>
              <span className="hk-pill"><span className="hk-dot" />{LABEL[r.status]}</span>
            </div>
            <p className="small muted m0">{r.typeName}</p>
            <div className="hk-tags">
              {r.departing ? <span className="chip">Abreise</span> : null}{r.arriving ? <span className="chip">Anreise</span> : null}
              {r.occupied ? <span className="chip">belegt{r.guest ? ` · ${r.guest}` : ""}</span> : null}
              {r.task?.kind === "stay" ? <span className="chip">Zwischenreinigung</span> : null}{r.task?.kind === "other" && r.task.note ? <span className="chip">Auftrag: {r.task.note}</span> : null}
            </div>
            {r.issues.length ? (
              <ul className="hk-issues" aria-label="Offene Mängel">
                {r.issues.map((i) => (
                  <li key={i.id}>
                    <span className="hk-issue-text">{i.description}</span>
                    <form action={fix}>
                      <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="day" value={day} /><input type="hidden" name="issueId" value={i.id} />
                      <button className="btn secondary small">Erledigt</button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={`hk-seg${editable ? "" : " ro"}`} role="group" aria-label={`Status Zimmer ${r.number}`}>
              {(["dirty", "clean", "inspected"] as CleanStatus[]).map((x) => (
                <form key={x} action={status}>{hid(r.roomId)}<input type="hidden" name="to" value={x} /><button className={`s-${x}`} disabled={r.status === x} aria-pressed={r.status === x}>{LABEL_BTN[x]}</button></form>
              ))}
            </div>
            <Link className="btn secondary small hk-report" href={`?day=${day}&room=${r.roomId}`} scroll={false}>{r.issues.length || r.task?.kind === "other" ? "Bearbeiten / hinzufügen" : "Mangel melden / Auftrag"}</Link>
          </section>
        ))}
      </div>
      {open ? (
        <div className="drawer-wrap">
          <Link className="drawer-backdrop" href={`?day=${day}`} scroll={false} aria-label="Schliessen" tabIndex={-1} />
          <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabIndex={-1}>
            <header className="drawer-head">
              <h2 id="drawer-title">Zimmer {open.number}</h2>
              <Link className="drawer-close" href={`?day=${day}`} scroll={false} aria-label="Schliessen">✕</Link>
            </header>
            <div className="drawer-body stack">
              {open.issues.length ? (
                <div className="stack gap8">
                  <h3 className="m0">Offene Mängel</h3>
                  {open.issues.map((i) => (
                    <form key={i.id} action={editIssue} className="hk-edit">
                      <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="day" value={day} /><input type="hidden" name="issueId" value={i.id} /><input type="hidden" name="roomId" value={open.roomId} />
                      <label htmlFor={`is-${i.id}`} className="sr-only">Mangel</label>
                      <textarea id={`is-${i.id}`} name="text" rows={2} maxLength={300} required defaultValue={i.description} />
                      <div className="hk-edit-actions"><button className="btn small">Speichern</button><button className="btn secondary small" formAction={fix} formNoValidate>Erledigt</button></div>
                    </form>
                  ))}
                </div>
              ) : null}
              <form action={report} className="hk-edit">
                {hid(open.roomId)}<input type="hidden" name="kind" value="task" />
                <h3 className="m0">Extra-Auftrag heute</h3>
                <label htmlFor="hk-task" className="sr-only">Extra-Auftrag</label>
                <textarea id="hk-task" name="text" rows={2} maxLength={200} required defaultValue={open.task?.kind === "other" ? open.task.note ?? "" : ""} placeholder="z. B. Fenster putzen" />
                <div className="hk-edit-actions"><button className="btn small">Speichern</button>{open.task?.kind === "other" ? <button className="btn secondary small" formAction={dropTask} formNoValidate>Entfernen</button> : null}</div>
              </form>
              {mini.length ? (
                <form action={minibar} className="stack">
                  {hid(open.roomId)}
                  <h3 className="m0">Minibar zählen</h3>
                  <p className="small muted m0">Was ist noch im Zimmer? Fehlendes wird dem Gast verrechnet.</p>
                  {mini.map((m) => (
                    <div key={m.id} className="inline-form"><label className="flex1">{m.name} <span className="muted small">(Soll {m.minibarPar})</span></label><input name={`n_${m.id}`} type="number" min={0} max={999} defaultValue={m.minibarPar} className="w80" /></div>
                  ))}
                  <div className="drawer-actions"><button className="btn secondary">Minibar buchen</button></div>
                </form>
              ) : null}
              {done.length ? (
                <details className="hk-done">
                  <summary>Erledigte Mängel ({done.length})</summary>
                  <ul>{done.map((i) => <li key={i.id}><span>{i.description}</span><span className="muted small">{i.doneAt ? formatDay(i.doneAt.toISOString().slice(0, 10), "de") : ""}</span></li>)}</ul>
                </details>
              ) : null}
              <form action={report} className="hk-edit">
                {hid(open.roomId)}<input type="hidden" name="kind" value="issue" />
                <h3 className="m0">Mangel hinzufügen</h3>
                <label htmlFor="hk-new" className="sr-only">Mangel</label>
                <textarea id="hk-new" name="text" rows={2} maxLength={300} required placeholder="z. B. Glühbirne Nachttisch defekt" />
                <div className="hk-edit-actions"><button className="btn small">Hinzufügen</button></div>
              </form>
            </div>
          </aside>
          <DrawerKeys closeHref={`?day=${day}`} />
        </div>
      ) : null}
    </div>
  );
}
