import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { addMember, changeBlock, GroupError, groupDetail, releaseGroup } from "@/src/services/groups";
import { BookingError } from "@/src/services/bookings";
import { bookingErrorText } from "@/src/services/admin-bookings";
import { db } from "@/src/db/client";
import { ratePlans, roomTypes } from "@/src/db/schema";
import { formatChf } from "@/src/domain/money";
import { formatDay } from "@/src/i18n/dict";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function act(f: FormData, fn: (c: Awaited<ReturnType<typeof requireHotel>>, groupId: string) => Promise<string>) {
  const c = await requireHotel(s(f, "hotelId"), "staff", "groups");
  await requireModule(c.hotel.id, "groups");
  const id = s(f, "groupId");
  let msg: string;
  try { msg = await fn(c, id); } catch (e) {
    msg = e instanceof GroupError ? e.message : e instanceof BookingError ? bookingErrorText(e.message) : e instanceof ZodError ? e.issues[0]?.message ?? "Eingabe prüfen" : "";
    if (!msg) throw e;
  }
  redirect(`/admin/${c.hotel.id}/groups/${id}?msg=${encodeURIComponent(msg)}`);
}
async function block(f: FormData) {
  "use server";
  await act(f, async (c, id) => { await changeBlock(c.hotel, id, s(f, "roomTypeId"), Number(s(f, "delta")), c.actor); return "Block geändert."; });
}
async function release(f: FormData) {
  "use server";
  await act(f, async (c, id) => `${await releaseGroup(c.hotel, id, c.actor)} Zimmernächte freigegeben.`);
}
async function member(f: FormData) {
  "use server";
  await act(f, async (c, id) => {
    const roomTypeId = s(f, "roomTypeId");
    const [plan] = await db().select().from(ratePlans).where(and(eq(ratePlans.hotelId, c.hotel.id), eq(ratePlans.roomTypeId, roomTypeId))).orderBy(asc(ratePlans.createdAt)).limit(1);
    if (!plan) throw new GroupError("Für diesen Zimmertyp gibt es keinen Tarif.");
    const b = await addMember(c.hotel, id, {
      roomTypeId, ratePlanId: plan.id, checkin: s(f, "checkin"), checkout: s(f, "checkout"), adults: Number(s(f, "adults")) || 1, children: 0, childrenAges: [],
      guest: { firstName: s(f, "firstName"), lastName: s(f, "lastName"), email: s(f, "email"), language: "de" }, notifyGuest: false,
    } as never, c.actor);
    return `Teilnehmer erfasst (${b.reference}).`;
  });
}

export default async function GroupPage({ params, searchParams }: { params: Promise<{ hotelId: string; groupId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId, groupId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "staff", "groups");
  await requireModule(hotel.id, "groups");
  let d: Awaited<ReturnType<typeof groupDetail>>;
  try { d = await groupDetail(hotel.id, groupId); } catch (e) { if (e instanceof GroupError) notFound(); throw e; }
  const { group: g } = d;
  const types = await db().select().from(roomTypes).where(and(eq(roomTypes.hotelId, hotel.id), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sortOrder), asc(roomTypes.name));
  const hid = <><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="groupId" value={g.id} /></>;
  const active = g.status === "active";
  return (
    <div className="stack">
      <h1>{g.name}</h1>
      {sp.msg ? <p className="notice">{sp.msg}</p> : null}
      <p className="small"><a href={`/admin/${hotel.id}/groups`}>← Alle Gruppen</a> · {formatDay(g.arrival, "de")} – {formatDay(g.departure, "de")}
        {g.releaseOn ? ` · Freigabe ${formatDay(g.releaseOn, "de")}` : ""} · {g.status === "active" ? "Block aktiv" : g.status === "released" ? "Block freigegeben" : "abgesagt"}</p>
      {g.company || g.contactName ? <p className="small muted">Rechnung an: {[g.company, g.contactName, g.street, [g.zip, g.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</p> : null}

      <section className="card stack">
        <h2>Zimmerblock</h2>
        <p className="small muted">Reservierte Zimmer sind für den Verkauf gesperrt (auch in Portalen). Teilnehmer nehmen sie aus dem Block. Nicht belegte Zimmer gehen zur Freigabefrist automatisch zurück.</p>
        {d.blocks.length ? (
          <table className="table"><thead><tr><th>Zimmertyp</th><th>Frei im Block</th><th></th></tr></thead>
            <tbody>{d.blocks.map((b) => (
              <tr key={b.roomTypeId}><td>{b.name}</td><td>{b.minLeft === b.maxLeft ? b.minLeft : `${b.minLeft}–${b.maxLeft}`}</td>
                <td>{active ? (<div className="inline-form">
                  <form action={block}>{hid}<input type="hidden" name="roomTypeId" value={b.roomTypeId} /><input type="hidden" name="delta" value="1" /><button className="btn secondary small">+1</button></form>
                  <form action={block}>{hid}<input type="hidden" name="roomTypeId" value={b.roomTypeId} /><input type="hidden" name="delta" value="-1" /><button className="btn secondary small">−1</button></form>
                </div>) : null}</td></tr>))}</tbody></table>
        ) : <p className="muted small">Noch kein Block.</p>}
        {active ? (
          <form action={block} className="inline-form">{hid}
            <div><label>Zimmertyp</label><select name="roomTypeId">{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            <div><label>Zimmer</label><input name="delta" type="number" min={1} max={200} defaultValue={1} style={{ width: 90 }} /></div>
            <button className="btn small">Reservieren</button>
          </form>
        ) : null}
        {active ? <form action={release}>{hid}<button className="btn secondary small">Block jetzt freigeben</button></form> : null}
      </section>

      <section className="card stack">
        <h2>Rooming-Liste ({d.rooming.length})</h2>
        {d.rooming.length ? (
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Name</th><th>Zimmertyp</th><th>Aufenthalt</th><th>Pers.</th><th>Betrag</th><th>Buchung</th></tr></thead>
            <tbody>{d.rooming.map((r) => (
              <tr key={r.bookingId}><td>{r.guest}</td><td>{r.roomType}</td><td className="small">{formatDay(r.checkin, "de")} – {formatDay(r.checkout, "de")}</td><td>{r.adults + r.children}</td><td>{formatChf(r.totalRappen)}</td>
                <td><a href={`/admin/${hotel.id}/bookings/${r.bookingId}`}>{r.reference}</a></td></tr>))}</tbody>
          </table></div>
        ) : <p className="muted small">Noch keine Teilnehmer.</p>}
        {d.rooming.length ? <p><a className="btn secondary small" href={`/admin/${hotel.id}/groups/${g.id}/rooming`}>Als CSV (Excel)</a></p> : null}
        {active && d.blocks.length ? (
          <form action={member} className="stack">{hid}
            <h3 style={{ margin: 0 }}>Teilnehmer hinzufügen</h3>
            <div className="form-grid">
              <div><label>Vorname</label><input name="firstName" required /></div>
              <div><label>Nachname</label><input name="lastName" required /></div>
              <div><label>E-Mail (optional)</label><input name="email" type="email" /></div>
              <div><label>Zimmertyp</label><select name="roomTypeId">{d.blocks.map((b) => <option key={b.roomTypeId} value={b.roomTypeId}>{b.name}</option>)}</select></div>
              <div><label>Anreise</label><input name="checkin" type="date" defaultValue={g.arrival} min={g.arrival} max={g.departure} required /></div>
              <div><label>Abreise</label><input name="checkout" type="date" defaultValue={g.departure} min={g.arrival} max={g.departure} required /></div>
              <div><label>Personen</label><input name="adults" type="number" min={1} max={10} defaultValue={1} /></div>
            </div>
            <div><button className="btn small">Hinzufügen</button></div>
          </form>
        ) : null}
        <p className="small muted">Rechnung: bei jeder Buchung unter «Rechnung &amp; Kasse». Sie geht an die Firma der Gruppe. Eine einzige Sammelrechnung für alle Teilnehmer gibt es noch nicht.</p>
      </section>
    </div>
  );
}
