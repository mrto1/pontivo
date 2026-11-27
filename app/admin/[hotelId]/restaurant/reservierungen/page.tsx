import Link from "next/link";
import { SeenMark } from "@/components/admin/SeenMark";
import { Notice } from "@/components/admin/Notice";
import { PeriodNav } from "@/components/admin/PeriodNav";
import { redirect } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { atLeast } from "@/src/domain/roles";
import { requireModule } from "@/src/services/modules";
import { PosError, listTables } from "@/src/services/pos";
import { assignTables, autoAssignDay, createReservation, getSettings, reservationsOfDay, setReservationStatus, waitlistOfDay } from "@/src/services/reservations";
import { addDays, isDay, todayIn } from "@/src/domain/dates";
import { coversAt } from "@/src/domain/reservations";
import { formatDay } from "@/src/i18n/dict";
import { formatChf } from "@/src/domain/money";
import { moduleRows } from "@/src/services/modules";
import { isOn } from "@/src/domain/modules";
import { REGULAR_VISITS, restaurantVisits } from "@/src/services/guest-notes";
import { guestProfiles } from "@/src/db/schema";
import { db } from "@/src/db/client";
import { and, eq, inArray } from "drizzle-orm";
import { s } from "@/src/lib/form";
import { hotelAction, type HotelCtx } from "@/src/lib/hotel-action";

export const dynamic = "force-dynamic";
const here = (h: string, day: string, msg: string) => redirect(`/admin/${h}/restaurant/reservierungen?day=${day}&msg=${encodeURIComponent(msg)}`);
const STATUS = { pending: "Zahlung offen", confirmed: "bestätigt", seated: "am Tisch", cancelled: "storniert", noshow: "nicht erschienen" } as const;

/** Zurück zum Tag der Liste (ungültiger Tag → heute) */
const run = (f: FormData, fail: string, fn: (c: HotelCtx) => Promise<string>) =>
  hotelAction(f, { page: "restaurant/reservierungen", module: "restaurant", area: "reservations", fail, keep: { day: isDay(s(f, "day")) ? s(f, "day") : "" } }, fn);

async function create(f: FormData) {
  "use server";
  await run(f, "Nicht gespeichert", async (c) => {
    await createReservation(c.hotel, { day: s(f, "day"), time: s(f, "time"), party: Number(s(f, "party")), name: s(f, "name"), phone: s(f, "phone"), email: s(f, "email"), note: s(f, "note"), tableId: s(f, "tableId") || null }, "admin", c.actor);
    return "Reservation gespeichert.";
  });
}
async function status(f: FormData) {
  "use server";
  await run(f, "Nicht gespeichert", async (c) => {
    const st = s(f, "status") as "confirmed" | "seated" | "cancelled" | "noshow";
    if (!["confirmed", "seated", "cancelled", "noshow"].includes(st)) throw new PosError("Status ungültig.");
    await setReservationStatus(c.hotel.id, s(f, "id"), st, c.actor);
    return "Gespeichert.";
  });
}
async function table(f: FormData) {
  "use server";
  await run(f, "Nicht zugewiesen", async (c) => { await assignTables(c.hotel.id, s(f, "id"), [s(f, "tableId"), s(f, "tableId2")].filter(Boolean), c.actor); return "Tisch zugewiesen."; });
}
async function autoAssign(f: FormData) {
  "use server";
  await run(f, "Nicht zugeteilt", async (c) => {
    const n = await autoAssignDay(c.hotel.id, s(f, "day"), c.actor);
    return n ? `${n} Reservationen einem Tisch zugeteilt.` : "Nichts zuzuteilen: alle haben einen Tisch oder es passt keiner.";
  });
}

/** Kartei-Notiz und Tags zum Gast der Reservation (SPEC 20.2, gleiche Kartei wie bei Hotelbuchungen) */
/** Tischreservationen (SPEC 19.49 Etappe C): Liste je Tag, Tisch zuweisen, Status, neue Reservation, Online-Einstellungen */
export default async function ReservationsPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotelModule("restaurant", hotelId, "staff", "reservations");
  const today = todayIn(hotel.timezone);
  const day = sp.day && isDay(sp.day) ? sp.day : today;
  const [list, tables, cfg, wait] = await Promise.all([reservationsOfDay(hotel.id, day), listTables(hotel.id), getSettings(hotel.id), waitlistOfDay(hotel.id, day)]);
  const tname = new Map(tables.map((t) => [t.id, t.name]));
  // Kartei (SPEC 20.2): Besuche, Stammgast, Tags und Notiz je E-Mail
  const notes = isOn(await moduleRows(hotel.id), "guestnotes");
  const emails = [...new Set(list.map((r) => r.email.toLowerCase()).filter(Boolean))];
  const [visits, profiles] = await Promise.all([
    restaurantVisits(hotel.id, emails),
    notes && emails.length ? db().select().from(guestProfiles).where(and(eq(guestProfiles.hotelId, hotel.id), inArray(guestProfiles.email, emails))) : Promise.resolve([]),
  ]);
  const prof = new Map(profiles.map((p) => [p.email, p]));
  const live = list.filter((r) => r.status === "confirmed" || r.status === "seated");
  const guests = live.reduce((a, r) => a + r.party, 0);
  const peak = Math.max(0, ...live.map((r) => coversAt(list, r.time, cfg.durationMin)));
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  const D = <input type="hidden" name="day" value={day} />;
  return (
    <div className="stack">
      <SeenMark hotelId={hotel.id} kind="reservations" />
      <h1 className="sr-only">Tischreservationen</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <PeriodNav prev={`?day=${addDays(day, -1)}`} next={`?day=${addDays(day, 1)}`} todayHref="?" todayActive={day === today} prevLabel="Vortag" nextLabel="Folgetag" jump={{ value: day, param: "day" }}>
        <span className="small muted">{formatDay(day, "de")} · {live.length} Reservationen, {guests} Gäste{peak ? `, gleichzeitig bis zu ${peak} von ${cfg.capacity} Plätzen` : ""}</span>
      </PeriodNav>
      {!tables.length ? <p className="notice">Noch keine Tische angelegt. {atLeast(role, "manager") ? <a href={`/admin/${hotel.id}/restaurant/tische`}>Tische anlegen</a> : "Bitte die Leitung, Tische anzulegen."}</p> : atLeast(role, "manager") ? <p className="small muted m0"><a href={`/admin/${hotel.id}/restaurant/tische`}>Tische bearbeiten</a></p> : null}
      <section className="card">
        {list.length ? (
          <table className="table" data-testid="res-list"><thead><tr><th>Zeit</th><th>Pers.</th><th>Gast</th><th>Tisch</th><th>Status</th><th /></tr></thead><tbody>
            {list.map((r) => (
              <tr key={r.id} className={r.status === "cancelled" || r.status === "noshow" ? "muted" : undefined}>
                <td>{r.time}</td><td>{r.party}</td>
                <td>{r.name}{r.source === "online" ? " (online)" : ""}
                  {(visits.get(r.email.toLowerCase())?.visits ?? 0) >= REGULAR_VISITS ? <> <span className="badge">Stammgast</span></> : null}
                  {prof.get(r.email.toLowerCase())?.tags.map((t) => <span key={t} className="badge u-ml-4px">{t}</span>)}
                  <div className="small muted">{[r.phone, r.email, r.note].filter(Boolean).join(" · ")}</div>
                  {r.preorder?.length ? <div className="small" data-testid="preorder-lines"><strong>Vorbestellung{r.depositStatus === "paid" ? " (bezahlt)" : ""}:</strong> {r.preorder.map((l) => `${l.quantity}× ${l.description}`).join(", ")} · {formatChf(r.preorderRappen)}{!r.tableId && !r.preorderOrderId && r.status === "confirmed" ? <span className="badge warn ml8">Tisch fehlt: geht erst mit Tisch in die Küche</span> : null}</div> : null}
                  {prof.get(r.email.toLowerCase())?.note ? <div className="small">Kartei: {prof.get(r.email.toLowerCase())!.note.slice(0, 120)}</div> : null}
                  {notes && r.email ? <div className="small"><Link href={`/admin/${hotel.id}/guestbook?gast=${encodeURIComponent(r.email.toLowerCase())}&zurueck=${encodeURIComponent(`/admin/${hotel.id}/restaurant/reservierungen?day=${day}`)}`}>Kartei</Link></div> : null}
                </td>
                <td><form action={table} className="res-table">{H}{D}<input type="hidden" name="id" value={r.id} />
                  <select name="tableId" defaultValue={r.tableId ?? ""} aria-label={`Tisch ${r.name}`}><option value="">–</option>{tables.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.seats})</option>)}</select>
                  <select name="tableId2" defaultValue={r.extraTableIds?.[0] ?? ""} aria-label={`Zusätzlicher Tisch ${r.name}`}><option value="">+ Tisch</option>{tables.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.seats})</option>)}</select><button className="btn secondary small">Setzen</button></form>
                  {r.tableId ? <span className="small muted">{[r.tableId, ...(r.extraTableIds ?? [])].map((x) => tname.get(x)).join(" + ")}</span> : null}</td>
                <td>{STATUS[r.status]}{r.depositStatus !== "none" ? <div className="small muted">Anzahlung {formatChf(r.depositRappen)}: {r.depositStatus === "paid" ? "bezahlt (bei der Rechnung abziehen)" : r.depositStatus === "refunded" ? "zurückerstattet" : "offen"}</div> : null}</td>
                <td className="res-actions">{r.status === "pending" ? null : (["seated", "noshow", "cancelled"] as const).filter((x) => x !== r.status).map((x) => (
                  <form className="u-d-contents" key={x} action={status}>{H}{D}<input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value={x} /><button className={x === "seated" ? "btn small" : "linklike"}>{x === "seated" ? "Am Tisch" : x === "noshow" ? "Nicht erschienen" : "Stornieren"}</button></form>
                ))}</td>
              </tr>
            ))}
          </tbody></table>
        ) : <p className="muted">Keine Reservationen an diesem Tag.</p>}
      </section>
      {live.some((r) => !r.tableId) && tables.length ? (
        <form action={autoAssign}>{H}{D}<button className="btn secondary">Offene automatisch einem Tisch zuteilen</button></form>
      ) : null}
      {wait.length ? <p className="small"><a href={`/admin/${hotel.id}/restaurant/warteliste?day=${day}`}>Warteliste an diesem Tag: {wait.length}</a></p> : null}
      <form action={create} className="card stack">
        {H}{D}
        <h2>Neue Reservation</h2>
        <div className="inline-form">
          <div><label htmlFor="time">Zeit</label><input id="time" name="time" type="time" step={900} required /></div>
          <div><label htmlFor="party">Personen</label><input id="party" name="party" type="number" min={1} max={50} defaultValue={2} required className="w80" /></div>
          <div><label htmlFor="tableId">Tisch</label><select id="tableId" name="tableId"><option value="">noch offen</option>{tables.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.seats})</option>)}</select></div>
        </div>
        <div><label htmlFor="name">Name</label><input id="name" name="name" required maxLength={80} /></div>
        <div className="inline-form">
          <div><label htmlFor="phone">Telefon</label><input id="phone" name="phone" maxLength={40} /></div>
          <div><label htmlFor="email">E-Mail (für Bestätigung)</label><input id="email" name="email" type="email" maxLength={200} /></div>
        </div>
        <div><label htmlFor="note">Notiz</label><input id="note" name="note" maxLength={300} placeholder="Kinderstuhl, Geburtstag …" /></div>
        <div><button className="btn">Speichern</button></div>
      </form>
    </div>
  );
}
