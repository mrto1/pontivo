import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { addTask, board, generateTasks, HousekeepingError, reportIssue, resolveIssue, setCleanStatus, type CleanStatus } from "@/src/services/housekeeping";
import { addDays, isDay, todayIn } from "@/src/domain/dates";
import { formatDay } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const LABEL: Record<CleanStatus, string> = { dirty: "schmutzig", clean: "sauber", inspected: "geprüft" };

async function act(f: FormData, fn: (c: Awaited<ReturnType<typeof requireHotel>>) => Promise<void>) {
  const c = await requireHotel(s(f, "hotelId"), "staff");
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
  const { hotel } = await requireHotel(hotelId);
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
  return (
    <div className="stack">
      <h1>Reinigung</h1>
      {sp.msg ? <p className="notice warn">{sp.msg}</p> : null}
      <p className="small">
        <a href={`?day=${addDays(day, -1)}`}>← früher</a> · <strong>{formatDay(day, "de")}</strong>{day === today ? " (heute)" : ""} · <a href={`?day=${addDays(day, 1)}`}>später →</a>
        {" · "}{counts.dirty} schmutzig · {counts.open} offene Mängel
      </p>
      {sorted.length === 0 ? <p className="muted">Noch keine Zimmer. Zimmer legen Sie unter «Zimmer» an.</p> : null}
      <div className="stack">
        {sorted.map((r) => (
          <section key={r.roomId} className="card stack" style={{ borderLeft: `6px solid ${r.status === "dirty" ? "#b3261e" : r.status === "inspected" ? "#2f5d50" : "#8a9a8f"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0 }}>Zimmer {r.number}{r.floor ? <span className="muted small"> · Etage {r.floor}</span> : null}</h2>
              <span className={`badge ${r.status === "dirty" ? "warn" : ""}`}>{LABEL[r.status]}</span>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              {r.typeName}
              {r.departing ? " · Abreise heute" : ""}{r.arriving ? " · Anreise heute" : ""}{r.occupied ? ` · belegt${r.guest ? ` (${r.guest})` : ""}` : ""}
              {r.task?.kind === "stay" ? " · Zwischenreinigung" : ""}{r.task?.kind === "other" && r.task.note ? ` · ${r.task.note}` : ""}
            </p>
            {r.issues.map((i) => (
              <form key={i.id} action={fix} className="inline-form">
                <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="day" value={day} /><input type="hidden" name="issueId" value={i.id} />
                <span className="notice warn small" style={{ flex: 1 }}>Mangel: {i.description}</span>
                <button className="btn secondary small">Erledigt</button>
              </form>
            ))}
            <div className="inline-form">
              {(["dirty", "clean", "inspected"] as CleanStatus[]).filter((x) => x !== r.status).map((x) => (
                <form key={x} action={status}>{hid(r.roomId)}<input type="hidden" name="to" value={x} /><button className={`btn ${x === "clean" ? "" : "secondary"}`} style={{ minHeight: 44 }}>{x === "clean" ? "Sauber ✓" : x === "inspected" ? "Geprüft ✓✓" : "Schmutzig"}</button></form>
              ))}
            </div>
            <details>
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
