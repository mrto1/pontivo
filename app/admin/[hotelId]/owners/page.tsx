import { Notice } from "@/components/admin/Notice";
import { InfoTip } from "@/components/admin/InfoTip";
import { redirect } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { OwnerError, addCost, deleteCost, listOwners, ownerStatement, saveOwner, sendStatement } from "@/src/services/owners";
import { listRooms } from "@/src/services/rooms";
import { formatChf } from "@/src/domain/money";
import { todayIn } from "@/src/domain/dates";
import { PeriodNav } from "@/components/admin/PeriodNav";
import { shiftMonth } from "@/src/services/overview";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (h: string, month: string, msg: string) => redirect(`/admin/${h}/owners?month=${month}&msg=${encodeURIComponent(msg)}`);
const prevMonth = (tz: string) => { const t = todayIn(tz); const [y, m] = t.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

async function save(f: FormData) {
  "use server";
  const c = await requireHotelModule("owners", s(f, "hotelId"), "manager");
  let msg = "Eigentümer gespeichert.";
  try {
    await saveOwner(c.hotel.id, s(f, "id") || null, { name: s(f, "name"), email: s(f, "email"), commissionPercent: Number(s(f, "commission").replace(",", ".") || 0), roomTypeIds: f.getAll("roomTypeIds").map(String), note: s(f, "note"), active: f.get("active") === "on" }, c.actor);
  } catch (e) {
    if (!(e instanceof OwnerError)) throw e;
    msg = `Nicht gespeichert: ${e.message}`;
  }
  back(c.hotel.id, s(f, "month"), msg);
}
async function cost(f: FormData) {
  "use server";
  const c = await requireHotelModule("owners", s(f, "hotelId"), "manager");
  let msg = "Kosten erfasst.";
  try {
    await addCost(c.hotel.id, s(f, "ownerId"), s(f, "month"), s(f, "description"), Math.round(Number(s(f, "amount").replace(",", ".")) * 100), c.actor);
  } catch (e) {
    if (!(e instanceof OwnerError)) throw e;
    msg = `Nicht erfasst: ${e.message}`;
  }
  back(c.hotel.id, s(f, "month"), msg);
}
async function delCost(f: FormData) {
  "use server";
  const c = await requireHotelModule("owners", s(f, "hotelId"), "manager");
  await deleteCost(c.hotel.id, s(f, "costId"), c.actor);
  back(c.hotel.id, s(f, "month"), "Kosten gelöscht.");
}
async function send(f: FormData) {
  "use server";
  const c = await requireHotelModule("owners", s(f, "hotelId"), "manager");
  let msg = "Abrechnung wird versendet.";
  try {
    await sendStatement(c.hotel, s(f, "ownerId"), s(f, "month"), c.actor);
  } catch (e) {
    if (!(e instanceof OwnerError)) throw e;
    msg = `Nicht versendet: ${e.message}`;
  }
  back(c.hotel.id, s(f, "month"), msg);
}

export default async function OwnersPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotelModule("owners", hotelId, "staff", "owners");
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : prevMonth(hotel.timezone);
  const [list, types] = await Promise.all([listOwners(hotel.id), listRooms(hotel.id).then((r) => r.map((x) => x.roomType))]);
  const stmts = await Promise.all(list.filter((o) => o.active).map((o) => ownerStatement(hotel.id, o.id, month)));
  const canEdit = role === "owner" || role === "manager";
  return (
    <div className="stack">
      <h1>Eigentümerabrechnung</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <div><InfoTip label="Worum geht es hier?">Für Verwalter von Ferienwohnungen: Objekte (Zimmertypen) gehören Eigentümern. Umsatz = Übernachtungspreise bestätigter Buchungen, Nächte im Monat (ohne Kurtaxe und Zusatzleistungen).</InfoTip></div>
      <PeriodNav prev={`?month=${shiftMonth(month, -1)}`} next={month < todayIn(hotel.timezone).slice(0, 7) ? `?month=${shiftMonth(month, 1)}` : undefined} todayHref="?" todayActive={month === prevMonth(hotel.timezone)} todayLabel="Letzter Monat" prevLabel="Vormonat" nextLabel="Folgemonat" jump={{ kind: "month", value: month, param: "month" }} />
      {stmts.map((x) => (
        <section key={x.owner.id} className="card stack">
          <h2>{x.owner.name} · {month}</h2>
          <table className="table"><tbody>
            <tr><td>Umsatz Übernachtungen ({x.bookingsCount} Buchungen)</td><td>{formatChf(x.revenueRappen)}</td></tr>
            <tr><td>Kommission {(x.commissionBps / 100).toLocaleString("de-CH")} %</td><td>−{formatChf(x.commissionRappen)}</td></tr>
            {x.costs.map((c) => (
              <tr key={c.id}><td>{c.description}{canEdit ? <form action={delCost} style={{ display: "inline", marginLeft: 8 }}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="month" value={month} /><input type="hidden" name="costId" value={c.id} /><button className="btn secondary">Löschen</button></form> : null}</td><td>−{formatChf(c.amountRappen)}</td></tr>
            ))}
            <tr><td><strong>Auszahlung an Eigentümer</strong></td><td><strong>{formatChf(x.netRappen)}</strong></td></tr>
          </tbody></table>
          <p><a href={`/admin/${hotel.id}/owners/${x.owner.id}/${month}`} target="_blank">Druckansicht (PDF über «Drucken»)</a>{x.sentAt ? ` · versendet am ${x.sentAt.toLocaleDateString("de-CH")}` : ""}</p>
          {canEdit ? (
            <>
              <form action={cost} className="stack">
                <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="ownerId" value={x.owner.id} /><input type="hidden" name="month" value={month} />
                <div><label>Kosten (z. B. Reinigung, Reparatur)</label><input name="description" required /></div>
                <div><label>Betrag CHF</label><input name="amount" inputMode="decimal" required /></div>
                <div><button className="btn secondary">Kosten erfassen</button></div>
              </form>
              {!x.sentAt && x.owner.email ? <form action={send}><input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="ownerId" value={x.owner.id} /><input type="hidden" name="month" value={month} /><button className="btn">Per Mail senden</button></form> : null}
            </>
          ) : null}
        </section>
      ))}
      {canEdit ? [...list, null].map((o) => (
        <form key={o?.id ?? "new"} action={save} className="card stack">
          <h2>{o ? `Eigentümer: ${o.name}` : "Neuer Eigentümer"}</h2>
          <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="month" value={month} />{o ? <input type="hidden" name="id" value={o.id} /> : null}
          <div><label>Name</label><input name="name" defaultValue={o?.name ?? ""} required /></div>
          <div><label>E-Mail für die Abrechnung</label><input name="email" type="email" defaultValue={o?.email ?? ""} /></div>
          <div><label>Kommission des Hauses in %</label><input name="commission" inputMode="decimal" defaultValue={o ? o.commissionBps / 100 : 20} /></div>
          <fieldset><legend>Objekte</legend>{types.map((t) => <label key={t.id} style={{ display: "block" }}><input type="checkbox" name="roomTypeIds" value={t.id} defaultChecked={o?.roomTypeIds.includes(t.id)} /> {t.name}</label>)}</fieldset>
          <div><label>Notiz</label><input name="note" defaultValue={o?.note ?? ""} /></div>
          <label><input type="checkbox" name="active" defaultChecked={o?.active ?? true} /> aktiv</label>
          <div><button className="btn">Speichern</button></div>
        </form>
      )) : null}
    </div>
  );
}
