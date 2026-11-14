import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { requireModule } from "@/src/services/modules";
import { assignRoom, autoAssign, createRoom, deleteRoom, FrontdeskError, listRooms, planBookings, seedRooms, setRoomActive, type PlanBooking } from "@/src/services/frontdesk";
import { addDays, diffDays, isDay, todayIn, weekday } from "@/src/domain/dates";
import { formatDay } from "@/src/i18n/dict";
import { db } from "@/src/db/client";
import { roomTypes } from "@/src/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const DAYS = 14;
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function act(f: FormData, fn: (c: Awaited<ReturnType<typeof requireHotel>>) => Promise<string>) {
  const c = await requireHotel(s(f, "hotelId"), "staff");
  await requireModule(c.hotel.id, "frontdesk");
  let msg: string;
  try {
    msg = await fn(c);
  } catch (e) {
    if (!(e instanceof FrontdeskError)) throw e;
    msg = `Nicht geändert: ${e.message}`;
  }
  redirect(`/admin/${c.hotel.id}/plan?from=${encodeURIComponent(s(f, "from"))}&msg=${encodeURIComponent(msg)}`);
}

async function assign(f: FormData) {
  "use server";
  await act(f, async (c) => { await assignRoom(c.hotel.id, s(f, "bookingRoomId"), s(f, "roomId") || null, c.actor); return "Zimmer zugewiesen."; });
}
async function auto(f: FormData) {
  "use server";
  await act(f, async (c) => { const r = await autoAssign(c.hotel.id, todayIn(c.hotel.timezone), c.actor); return `${r.assigned} Buchungen zugewiesen${r.left ? `, ${r.left} ohne freies Zimmer` : ""}.`; });
}
async function addRoom(f: FormData) {
  "use server";
  await act(f, async (c) => {
    if (!atLeast(c.role, "manager")) throw new FrontdeskError("Dafür braucht es die Rolle Manager.");
    await createRoom(c.hotel.id, { roomTypeId: s(f, "roomTypeId"), number: s(f, "number"), floor: s(f, "floor"), note: s(f, "note") }, c.actor);
    return "Zimmer angelegt.";
  });
}
async function seed(f: FormData) {
  "use server";
  await act(f, async (c) => {
    if (!atLeast(c.role, "manager")) throw new FrontdeskError("Dafür braucht es die Rolle Manager.");
    return `${await seedRooms(c.hotel.id, s(f, "roomTypeId"), c.actor)} Zimmer angelegt.`;
  });
}
async function toggleRoom(f: FormData) {
  "use server";
  await act(f, async (c) => {
    if (!atLeast(c.role, "manager")) throw new FrontdeskError("Dafür braucht es die Rolle Manager.");
    await setRoomActive(c.hotel.id, s(f, "roomId"), f.get("active") === "1", c.actor);
    return "Gespeichert.";
  });
}
async function removeRoom(f: FormData) {
  "use server";
  await act(f, async (c) => {
    if (!atLeast(c.role, "manager")) throw new FrontdeskError("Dafür braucht es die Rolle Manager.");
    await deleteRoom(c.hotel.id, s(f, "roomId"), c.actor);
    return "Zimmer gelöscht.";
  });
}

/** Balken einer Zeile: Zellen pro Nacht, Buchungen als zusammengefasste Zelle */
function cells(bs: PlanBooking[], from: string, hotelId: string) {
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < DAYS) {
    const day = addDays(from, i);
    const b = bs.find((x) => x.checkin <= day && x.checkout > day);
    if (!b) { out.push(<td key={i} className="plan-free" />); i++; continue; }
    const len = Math.min(DAYS - i, diffDays(day, b.checkout));
    out.push(
      <td key={i} colSpan={len} className={`plan-bar ${b.status === "hold" ? "hold" : ""}`} title={`${b.guest} · ${b.reference}`}>
        <a href={`/admin/${hotelId}/bookings/${b.bookingId}`}>{b.guest}</a>
      </td>,
    );
    i += len;
  }
  return out;
}

export default async function Plan({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  await requireModule(hotel.id, "frontdesk");
  const today = todayIn(hotel.timezone);
  const from = sp.from && isDay(sp.from) ? sp.from : today;
  const manager = atLeast(role, "manager");
  const rms = await listRooms(hotel.id);
  const bookings = await planBookings(hotel.id, from, DAYS);
  const types = await db().select().from(roomTypes).where(eq(roomTypes.hotelId, hotel.id)).orderBy(roomTypes.sortOrder, roomTypes.name);
  const unassigned = bookings.filter((b) => !b.roomId);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(from, i));
  const hid = <input type="hidden" name="hotelId" value={hotel.id} />;
  const fromField = <input type="hidden" name="from" value={from} />;
  const base = `/admin/${hotel.id}/plan`;

  return (
    <div className="stack">
      <h1>Zimmerplan</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      <p className="small">
        <a href={`${base}?from=${addDays(from, -7)}`}>← Woche zurück</a> · <a href={base}>Heute</a> · <a href={`${base}?from=${addDays(from, 7)}`}>Woche vor →</a>
      </p>

      {rms.length === 0 ? (
        <section className="card stack">
          <p>Noch keine Zimmer angelegt. Der Zimmerplan ist optional: Ohne Zimmernummern läuft alles wie bisher. Wer Zimmer zuweisen will, legt sie unten an (ein Klick pro Zimmertyp).</p>
        </section>
      ) : (
        <div className="scroll-x">
          <table className="plan">
            <thead>
              <tr><th>Zimmer</th>{days.map((d) => <th key={d} className={weekday(d) === 0 || weekday(d) === 6 ? "we" : ""}>{WD[weekday(d)]}<br />{d.slice(8)}.{d.slice(5, 7)}.</th>)}</tr>
            </thead>
            <tbody>
              {types.map((t) => {
                const rs = rms.filter((r) => r.roomTypeId === t.id);
                if (!rs.length) return null;
                return [
                  <tr key={`h${t.id}`}><th colSpan={DAYS + 1} className="plan-type">{t.name}</th></tr>,
                  ...rs.map((r) => (
                    <tr key={r.id} className={r.active ? "" : "plan-off"}>
                      <th>{r.number}{r.floor ? <span className="muted small"> · {r.floor}</span> : null}</th>
                      {r.active ? cells(bookings.filter((b) => b.roomId === r.id), from, hotel.id) : <td colSpan={DAYS} className="muted small">gesperrt{r.note ? `: ${r.note}` : ""}</td>}
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="card stack">
        <h2>Nicht zugewiesen ({unassigned.length})</h2>
        {unassigned.length ? (
          <>
            <div className="scroll-x"><table className="table">
              <thead><tr><th>Gast</th><th>Aufenthalt</th><th>Zimmertyp</th><th>Zimmer wählen</th></tr></thead>
              <tbody>
                {unassigned.map((b) => {
                  const options = rms.filter((r) => r.active && r.roomTypeId === b.roomTypeId);
                  return (
                    <tr key={b.bookingRoomId}>
                      <td><a href={`/admin/${hotel.id}/bookings/${b.bookingId}`}>{b.guest}</a><br /><span className="muted small">{b.reference}{b.status === "hold" ? " · reserviert" : ""}</span></td>
                      <td className="small">{formatDay(b.checkin, "de")} – {formatDay(b.checkout, "de")}</td>
                      <td className="small">{types.find((t) => t.id === b.roomTypeId)?.name}</td>
                      <td>
                        {options.length ? (
                          <form action={assign} className="inline-form">
                            {hid}{fromField}<input type="hidden" name="bookingRoomId" value={b.bookingRoomId} />
                            <select name="roomId" required>{options.map((r) => <option key={r.id} value={r.id}>{r.number}</option>)}</select>
                            <button className="btn secondary small">Zuweisen</button>
                          </form>
                        ) : <span className="muted small">keine Zimmer dieses Typs</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            <form action={auto}>{hid}{fromField}<button className="btn small">Automatisch zuweisen (nächste 14 Tage)</button></form>
          </>
        ) : <p className="muted small">Alle Buchungen in diesem Zeitraum haben ein Zimmer{rms.length ? "" : " (oder es gibt noch keine Zimmer)"}.</p>}
        {rms.length ? (
          <details>
            <summary className="small">Zugewiesenes Zimmer ändern oder aufheben</summary>
            <div className="scroll-x"><table className="table">
              <tbody>
                {bookings.filter((b) => b.roomId).map((b) => {
                  const options = rms.filter((r) => r.active && r.roomTypeId === b.roomTypeId);
                  return (
                    <tr key={b.bookingRoomId}>
                      <td className="small">{b.guest} · {formatDay(b.checkin, "de")} – {formatDay(b.checkout, "de")}</td>
                      <td>
                        <form action={assign} className="inline-form">
                          {hid}{fromField}<input type="hidden" name="bookingRoomId" value={b.bookingRoomId} />
                          <select name="roomId" defaultValue={b.roomId ?? ""}><option value="">(keines)</option>{options.map((r) => <option key={r.id} value={r.id}>{r.number}</option>)}</select>
                          <button className="btn secondary small">Speichern</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </details>
        ) : null}
      </section>

      {manager ? (
        <section className="card stack">
          <h2>Zimmer verwalten</h2>
          <p className="small muted">Pro Zimmertyp einen Klick legt die Zimmer 1, 2, 3 … passend zur Anzahl an. Danach können Sie Zimmer einzeln ergänzen oder sperren (z. B. wegen Renovation). Verfügbarkeit und Portale ändern sich dadurch nicht.</p>
          <div className="inline-form">
            {types.map((t) => (
              <form key={t.id} action={seed}>{hid}{fromField}<input type="hidden" name="roomTypeId" value={t.id} /><button className="btn secondary small">{t.name}: Zimmer anlegen ({t.roomCount})</button></form>
            ))}
          </div>
          <form action={addRoom} className="inline-form">
            {hid}{fromField}
            <div><label>Zimmertyp</label><select name="roomTypeId">{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            <div><label>Nummer</label><input name="number" required maxLength={20} placeholder="z. B. 12" /></div>
            <div><label>Etage (optional)</label><input name="floor" maxLength={40} /></div>
            <div><label>Notiz (optional)</label><input name="note" maxLength={200} /></div>
            <button className="btn small">Zimmer hinzufügen</button>
          </form>
          {rms.length ? (
            <div className="scroll-x"><table className="table">
              <thead><tr><th>Nr.</th><th>Typ</th><th>Etage</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rms.map((r) => (
                  <tr key={r.id}>
                    <td>{r.number}</td><td className="small">{r.typeName}</td><td className="small">{r.floor}</td>
                    <td>{r.active ? <span className="badge">aktiv</span> : <span className="badge warn">gesperrt</span>}</td>
                    <td>
                      <div className="inline-form">
                        <form action={toggleRoom}>{hid}{fromField}<input type="hidden" name="roomId" value={r.id} /><input type="hidden" name="active" value={r.active ? "0" : "1"} /><button className="btn secondary small">{r.active ? "Sperren" : "Freigeben"}</button></form>
                        <form action={removeRoom}>{hid}{fromField}<input type="hidden" name="roomId" value={r.id} /><button className="btn secondary small">Löschen</button></form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
