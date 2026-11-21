import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { PosError, createDevice, listDevices, releaseDevice } from "@/src/services/pos";
import { RoomLinkError, activeLink, connectRoomLink, disconnectRoomLink, roomLinkTotals } from "@/src/services/room-link";
import { formatChf } from "@/src/domain/money";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const here = (h: string, msg: string) => redirect(`/admin/${h}/restaurant/geraete?msg=${encodeURIComponent(msg)}`);

async function guard(f: FormData) {
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "pos");
  return c;
}
async function release(f: FormData) {
  "use server";
  const c = await guard(f);
  try { await releaseDevice(c.hotel.id, s(f, "id"), c.actor); } catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, `Nicht freigegeben: ${e.message}`); }
  here(c.hotel.id, "Gerät freigegeben. Das nächste Tablet kann es wählen.");
}
async function device(f: FormData) {
  "use server";
  const c = await guard(f);
  try { await createDevice(c.hotel.id, s(f, "code"), s(f, "label"), c.actor); } catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, `Nicht angelegt: ${e.message}`); }
  here(c.hotel.id, "Gerät angelegt.");
}

async function link(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "owner");
  await requireModule(c.hotel.id, "pos");
  if (s(f, "do") === "off") { await disconnectRoomLink(c.hotel.id, c.actor); here(c.hotel.id, "Verbindung zum Hotel getrennt."); }
  try { const l = await connectRoomLink(c.hotel.id, s(f, "key"), c.actor); here(c.hotel.id, `Verbunden mit ${l.label}. «Aufs Zimmer» bucht jetzt auf die Hotelrechnung.`); }
  catch (e) { if (!(e instanceof RoomLinkError)) throw e; here(c.hotel.id, `Nicht verbunden: ${e.message}`); }
}

/** Kassen-Geräte (Einstellungen → Gastronomie → Kasse): jedes Gerät hat einen eigenen, lückenlosen Bon-Nummernkreis */
export default async function PosDevicesPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager");
  await requireModule(hotel.id, "pos");
  const [devices, conn, totals] = await Promise.all([listDevices(hotel.id), activeLink(hotel.id), roomLinkTotals(hotel.id)]);
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  return (
    <div className="stack">
      <h1>Kassen-Geräte</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <form action={device} className="card stack">{H}<h2>Geräte</h2><p className="small muted">Jedes Gerät hat einen eigenen, lückenlosen Nummernkreis. Die Weboberfläche nutzt «W1».</p>{devices.length ? <table className="table"><tbody>{devices.map((d) => <tr key={d.id}><td>{d.code} {d.label}</td><td>{d.claimedKey ? "belegt" : "frei"}{d.pendingOps ? `, ${d.pendingOps} offen` : ""}</td><td>{d.claimedKey ? <button className="btn secondary small" formNoValidate formAction={release} name="id" value={d.id}>Freigeben</button> : null}</td></tr>)}</tbody></table> : <p>noch keines</p>}
        <div><label>Code (A–Z, 0–9, bis 6 Zeichen)</label><input name="code" required maxLength={6} /></div><div><label>Bezeichnung</label><input name="label" maxLength={60} /></div><div><button className="btn secondary">Gerät anlegen</button></div></form>
      <section className="card stack" id="hotel" data-testid="room-link">
        <h2>Hotel verbinden (aufs Zimmer)</h2>
        <p className="small muted">Für ein verpachtetes Restaurant: Das Hotel erstellt bei sich unter «Kassen-Schnittstelle» einen Schlüssel und gibt ihn Ihnen. Danach wählen Sie an der Kasse bei «Aufs Zimmer» die Gäste des Hotels; die Posten erscheinen auf der Hotelrechnung. Der Schlüssel wird verschlüsselt gespeichert, das Hotel kann ihn jederzeit widerrufen.</p>
        {conn ? (
          <>
            <p>Verbunden mit <strong>{conn.label}</strong> (Schlüssel <code>{conn.keyPrefix}…</code>, seit {conn.createdAt.toLocaleDateString("de-CH")}{conn.lastUsedAt ? `, zuletzt benutzt ${conn.lastUsedAt.toLocaleString("de-CH")}` : ""}).</p>
            <form action={link}>{H}<input type="hidden" name="do" value="off" /><button className="btn secondary small">Verbindung trennen</button></form>
          </>
        ) : null}
        <form action={link} className="inline-form">{H}
          <div style={{ flex: 1 }}><label htmlFor="key">{conn ? "Neuer Schlüssel des Hotels" : "Schlüssel des Hotels"}</label><input id="key" name="key" required autoComplete="off" placeholder="pnt_…" /></div>
          <div><button className="btn">{conn ? "Ersetzen" : "Verbinden"}</button></div>
        </form>
        {totals.length ? (
          <table className="table small"><caption className="small muted" style={{ textAlign: "left" }}>Aufs Zimmer gebucht (Grundlage für Ihre Abrechnung mit dem Hotel)</caption>
            <thead><tr><th>Monat</th><th>Hotel</th><th>Bons</th><th>Betrag</th></tr></thead>
            <tbody>{totals.map((t) => <tr key={`${t.month}-${t.label}`}><td>{t.month}</td><td>{t.label}</td><td>{t.count}</td><td>{formatChf(t.totalRappen)}</td></tr>)}</tbody></table>
        ) : null}
      </section>
    </div>
  );
}
