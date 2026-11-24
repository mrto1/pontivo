import { Notice } from "@/components/admin/Notice";
import { PeriodNav } from "@/components/admin/PeriodNav";
import { redirect } from "next/navigation";
import Link from "next/link";
import { InfoTip } from "@/components/admin/InfoTip";
import { Drawer, DrawerActions } from "@/components/admin/Drawer";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { assignRoom, autoAssign, createRoom, deleteRoom, FrontdeskError, listRooms, moveRoom, planBookings, seedRooms, updateRoom, type PlanBooking } from "@/src/services/frontdesk";
import { addDays, diffDays, isDay, todayIn, weekday } from "@/src/domain/dates";
import { formatDay } from "@/src/i18n/dict";
import { db } from "@/src/db/client";
import { roomTypes } from "@/src/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const DAYS = 14;
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function act(f: FormData, fn: (c: Awaited<ReturnType<typeof requireHotel>>) => Promise<string>, reopen = "") {
  const c = await requireHotelModule("frontdesk", s(f, "hotelId"), "staff", "plan");
  let msg: string;
  try {
    msg = await fn(c);
  } catch (e) {
    if (!(e instanceof FrontdeskError)) throw e;
    msg = `Nicht geändert: ${e.message}`;
    // bei einem Fehler bleibt die Seitenleiste offen (reopen = «room=<id>» bzw. «room=neu»)
    return redirect(`/admin/${c.hotel.id}/plan?from=${encodeURIComponent(s(f, "from"))}${reopen ? `&${reopen}` : ""}&msg=${encodeURIComponent(msg)}`);
  }
  redirect(`/admin/${c.hotel.id}/plan?from=${encodeURIComponent(s(f, "from"))}&msg=${encodeURIComponent(msg)}`);
}

async function assign(f: FormData) {
  "use server";
  await act(f, async (c) => { await assignRoom(c.hotel.id, s(f, "bookingRoomId"), s(f, "roomId") || null, c.actor); return "Zimmer zugewiesen."; });
}
async function move(f: FormData) {
  "use server";
  await act(f, async (c) => { await moveRoom(c.hotel.id, s(f, "bookingRoomId"), s(f, "roomId"), s(f, "day"), s(f, "reason"), c.actor); return "Zimmerwechsel gespeichert."; });
}
async function auto(f: FormData) {
  "use server";
  await act(f, async (c) => { const r = await autoAssign(c.hotel.id, todayIn(c.hotel.timezone), c.actor); return `${r.assigned} Buchungen zugewiesen${r.left ? `, ${r.left} ohne freies Zimmer` : ""}.`; });
}
async function saveRoom(f: FormData) {
  "use server";
  const id = s(f, "roomId");
  await act(f, async (c) => {
    if (!atLeast(c.role, "manager")) throw new FrontdeskError("Dafür braucht es die Rolle Manager.");
    const input = { roomTypeId: s(f, "roomTypeId"), number: s(f, "number"), floor: s(f, "floor"), note: s(f, "note") };
    if (id) { await updateRoom(c.hotel.id, id, { ...input, active: f.get("active") === "on" }, c.actor); return "Zimmer gespeichert."; }
    await createRoom(c.hotel.id, input, c.actor);
    return "Zimmer angelegt.";
  }, `room=${id || "neu"}`);
}
async function seed(f: FormData) {
  "use server";
  await act(f, async (c) => {
    if (!atLeast(c.role, "manager")) throw new FrontdeskError("Dafür braucht es die Rolle Manager.");
    return `${await seedRooms(c.hotel.id, s(f, "roomTypeId"), c.actor)} Zimmer angelegt.`;
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
      <td key={i} colSpan={len} className={`plan-bar ${b.status === "hold" ? "hold" : ""}`} tabIndex={0} data-tip-title={b.guest} data-tip={`Referenz\t${b.reference}\nAnreise\t${b.checkin}\nAbreise\t${b.checkout}${b.status === "hold" ? "\nStatus\treserviert (offen)" : ""}`}>
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
  const { hotel, role } = await requireHotelModule("frontdesk", hotelId, "staff", "plan");
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
  // Seitenleiste: ?room=<id> bearbeitet ein Zimmer, ?room=neu legt eines an
  const editRoom = manager && sp.room && sp.room !== "neu" ? rms.find((r) => r.id === sp.room) : undefined;
  const drawerOpen = manager && types.length > 0 && (sp.room === "neu" || !!editRoom);

  return (
    <div className="stack">
      <h1 className="sr-only">Zimmerplan</h1>
      <div>
        <InfoTip label="Wozu dient der Zimmerplan?">
          <p>Hier sehen Sie, welches Zimmer wann belegt ist und wo noch Zimmer frei sind.</p>
          <p>Weisen Sie jeder Buchung eine Zimmernummer zu, von Hand oder automatisch. So weiss die Reinigung, was zu putzen ist, und der Empfang, wohin der Gast beim Check-in geht. Zimmerwechsel ändern weder Preis noch Verfügbarkeit.</p>
          <p>Der Zimmerplan ist optional: Buchen funktioniert auch ohne.</p>
        </InfoTip>
      </div>
      {sp.msg && !drawerOpen ? <Notice text={sp.msg} /> : null}
      <PeriodNav prev={`${base}?from=${addDays(from, -7)}`} next={`${base}?from=${addDays(from, 7)}`} todayHref={base} todayActive={from === today} prevLabel="Woche zurück" nextLabel="Woche vor" jump={{ value: from, param: "from" }} />

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
                        <form action={move} className="inline-form">
                          {hid}{fromField}<input type="hidden" name="bookingRoomId" value={b.bookingRoomId} />
                          <span className="small">Wechsel ab</span>
                          <input type="date" name="day" min={b.checkin} max={b.checkout} required />
                          <select name="roomId" required>{options.filter((r) => r.id !== b.roomId).map((r) => <option key={r.id} value={r.id}>{r.number}</option>)}</select>
                          <input name="reason" placeholder="Grund (optional)" maxLength={200} />
                          <button className="btn secondary small">Zimmer wechseln</button>
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
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Zimmer verwalten</h2>
            <Link className="btn" href={`${base}?from=${from}&room=neu`} scroll={false}>+ Zimmer hinzufügen</Link>
          </div>
          <p className="small muted">Tippen Sie auf ein Zimmer, um Nummer, Etage oder Notiz zu ändern, es zu sperren (z. B. wegen Renovation) oder zu löschen. Verfügbarkeit und Portale ändern sich dadurch nicht.</p>
          {types.map((t) => {
            const have = rms.filter((r) => r.roomTypeId === t.id).length;
            const missing = t.roomCount - have;
            return missing > 0 ? (
              <form key={t.id} action={seed} className="room-missing">
                {hid}{fromField}<input type="hidden" name="roomTypeId" value={t.id} />
                <span className="small"><strong>{t.name}</strong>: {have} von {t.roomCount} Zimmern angelegt</span>
                <button className="btn secondary small">{have === 0 ? `Zimmer 1–${t.roomCount} anlegen` : `${missing} fehlende anlegen`}</button>
              </form>
            ) : null;
          })}
          {types.map((t) => {
            const rs = rms.filter((r) => r.roomTypeId === t.id);
            return rs.length ? (
              <div key={t.id} className="stack" style={{ gap: 6 }}>
                <h3 className="small muted" style={{ margin: 0 }}>{t.name}</h3>
                <ul className="plan-list">
                  {rs.map((r) => (
                    <li key={r.id}>
                      <Link href={`${base}?from=${from}&room=${r.id}`} scroll={false} className="plan-row" aria-label={`Zimmer ${r.number} bearbeiten`}>
                        <span><strong>{r.number}</strong>{r.floor ? <span className="muted small"> · {r.floor}</span> : null}{r.note ? <><br /><span className="muted small">{r.note}</span></> : null}</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>{r.active ? null : <span className="badge warn">gesperrt</span>}<span className="rt-arrow" aria-hidden="true">›</span></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null;
          })}
          {rms.length === 0 && types.length === 0 ? <p className="muted small">Legen Sie zuerst unter «Zimmer &amp; Tarife» einen Zimmertyp an.</p> : null}
        </section>
      ) : null}

      {drawerOpen ? (
        <Drawer title={editRoom ? `Zimmer ${editRoom.number}` : "Neues Zimmer"} closeHref={`${base}?from=${from}`}>
              {sp.msg ? <Notice text={sp.msg} /> : null}
              <form action={saveRoom} className="stack">
                {hid}{fromField}<input type="hidden" name="roomId" value={editRoom?.id ?? ""} />
                <div><label htmlFor="fca501">Zimmertyp</label><select id="fca501" name="roomTypeId" defaultValue={editRoom?.roomTypeId ?? types[0]?.id}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
                <div className="form-grid">
                  <div><label htmlFor="fca502">Nummer</label><input id="fca502" name="number" required maxLength={20} defaultValue={editRoom?.number} placeholder="z. B. 12" /></div>
                  <div><label htmlFor="fca503">Etage (optional)</label><input id="fca503" name="floor" maxLength={40} defaultValue={editRoom?.floor} placeholder="z. B. 2. OG" /></div>
                </div>
                <div><label htmlFor="fca504">Notiz (optional)</label><input id="fca504" name="note" maxLength={200} defaultValue={editRoom?.note} placeholder="z. B. Balkon, ruhig gelegen" /></div>
                {editRoom ? <label className="check"><input type="checkbox" name="active" defaultChecked={editRoom.active} />Zimmer ist in Betrieb (abwählen = gesperrt, z. B. wegen Renovation)</label> : null}
                <DrawerActions submit={editRoom ? "Speichern" : "Zimmer anlegen"} cancelHref={`${base}?from=${from}`} />
              </form>
              {editRoom ? (
                <form action={removeRoom} className="room-delete">
                  {hid}{fromField}<input type="hidden" name="roomId" value={editRoom.id} />
                  <p className="small muted">Zimmer, denen schon Buchungen zugewiesen waren, lassen sich nicht löschen; sperren Sie sie stattdessen.</p>
                  <ConfirmButton ask={`Zimmer ${editRoom.number} wirklich löschen?`} className="btn secondary small danger-text">Zimmer löschen</ConfirmButton>
                </form>
              ) : null}
        </Drawer>
      ) : null}
    </div>
  );
}
