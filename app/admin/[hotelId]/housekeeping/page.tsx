import { Notice } from "@/components/admin/Notice";
import { PeriodNav } from "@/components/admin/PeriodNav";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { addTask, board, generateTasks, HousekeepingError, reportIssue, resolveIssue, setCleanStatus, type CleanStatus } from "@/src/services/housekeeping";
import { addDays, isDay, todayIn } from "@/src/domain/dates";
import { formatDay } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const LABEL: Record<CleanStatus, string> = { dirty: "Schmutzig", clean: "Sauber", inspected: "Geprüft" };
const LABEL_BTN = LABEL;

async function act(f: FormData, fn: (c: Awaited<ReturnType<typeof requireHotel>>) => Promise<void>) {
  const c = await requireHotel(s(f, "hotelId"), "staff", "housekeeping");
  await requireModule(c.hotel.id, "housekeeping");
  let msg = "";
  try { await fn(c); } catch (e) { if (!(e instanceof HousekeepingError)) throw e; msg = e.message; }
  redirect(`/admin/${c.hotel.id}/housekeeping?day=${s(f, "day")}${msg ? `&msg=${encodeURIComponent(msg)}` : ""}`);
}
async function status(f: FormData) {
  "use server";
  await act(f, (c) => setCleanStatus(c.hotel.id, s(f, "roomId"), s(f, "to") as CleanStatus, c.actor));
}
async function issue(f: FormData) {
  "use server";
  await act(f, (c) => reportIssue(c.hotel.id, s(f, "roomId"), s(f, "text"), c.actor));
}
async function fix(f: FormData) {
  "use server";
  await act(f, (c) => resolveIssue(c.hotel.id, s(f, "issueId"), c.actor));
}
async function task(f: FormData) {
  "use server";
  await act(f, (c) => addTask(c.hotel.id, s(f, "roomId"), s(f, "day"), s(f, "text"), c.actor));
}

/** Handy-Liste für das Reinigungspersonal (SPEC 17.1): grosse Karten, ein Tipp pro Statuswechsel */
export default async function Housekeeping({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "staff", "housekeeping");
  await requireModule(hotel.id, "housekeeping");
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
  const n = (st: CleanStatus) => rooms.filter((r) => r.active && r.status === st).length;
  return (
    <div className="stack hk">
      <h1 className="sr-only">Reinigung</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <PeriodNav prev={`?day=${addDays(day, -1)}`} next={`?day=${addDays(day, 1)}`} todayHref="?" todayActive={day === today} prevLabel="Vortag" nextLabel="Folgetag" jump={{ value: day, param: "day" }}>
        <span className="small muted">{formatDay(day, "de")}</span>
      </PeriodNav>
      <div className="hk-summary" aria-label="Übersicht">
        {(["dirty", "clean", "inspected"] as CleanStatus[]).map((x) => (
          <span key={x} className="hk-stat" style={{ ["--c" as string]: `var(--hk-${x})` }}><span className="hk-dot" /><b>{n(x)}</b> {LABEL[x]}</span>
        ))}
        {counts.open ? <span className="hk-stat"><b>{counts.open}</b> offene Mängel</span> : null}
      </div>
      {!editable ? <p className="notice small">{day > today ? "Vorschau: Anreisen und Abreisen dieses Tages." : "Rückblick."} Den Reinigungsstatus ändern Sie nur für heute.</p> : null}
      {sorted.length === 0 ? <p className="muted">Noch keine Zimmer. Zimmer legen Sie unter Kalender → Zimmerplan an.</p> : null}
      <div className="hk-grid">
        {sorted.map((r) => (
          <section key={r.roomId} className={`card hk-card ${r.status}`}>
            <div className="hk-head">
              <h2>Zimmer {r.number}{r.floor ? <span className="muted small"> · Etage {r.floor}</span> : null}</h2>
              <span className="hk-pill"><span className="hk-dot" />{LABEL[r.status]}</span>
            </div>
            <p className="small muted" style={{ margin: 0 }}>{r.typeName}</p>
            <div className="hk-tags">
              {r.departing ? <span className="chip">Abreise</span> : null}{r.arriving ? <span className="chip">Anreise</span> : null}
              {r.occupied ? <span className="chip">belegt{r.guest ? ` · ${r.guest}` : ""}</span> : null}
              {r.task?.kind === "stay" ? <span className="chip">Zwischenreinigung</span> : null}{r.task?.kind === "other" && r.task.note ? <span className="chip">{r.task.note}</span> : null}
            </div>
            {r.issues.map((i) => (
              <form key={i.id} action={fix} className="inline-form">
                <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="day" value={day} /><input type="hidden" name="issueId" value={i.id} />
                <span className="notice warn small" style={{ flex: 1 }}>Mangel: {i.description}</span>
                <button className="btn secondary small">Erledigt</button>
              </form>
            ))}
            <div className={`hk-seg${editable ? "" : " ro"}`} role="group" aria-label={`Status Zimmer ${r.number}`}>
              {(["dirty", "clean", "inspected"] as CleanStatus[]).map((x) => (
                <form key={x} action={status}>{hid(r.roomId)}<input type="hidden" name="to" value={x} /><button className={`s-${x}`} disabled={r.status === x} aria-pressed={r.status === x}>{LABEL_BTN[x]}</button></form>
              ))}
            </div>
            <details className="hk-more">
              <summary className="small">Mangel melden / Auftrag</summary>
              <form action={issue} className="inline-form" style={{ marginTop: 8 }}>{hid(r.roomId)}<input name="text" placeholder="z. B. Glühbirne defekt" maxLength={300} required /><button className="btn secondary small">Melden</button></form>
              <form action={task} className="inline-form" style={{ marginTop: 8 }}>{hid(r.roomId)}<input name="text" placeholder="Extra-Auftrag, z. B. Fenster putzen" maxLength={200} /><button className="btn secondary small">Auftrag</button></form>
            </details>
          </section>
        ))}
      </div>
    </div>
  );
}
