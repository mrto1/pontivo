import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { PosError, createDevice, listDevices, releaseDevice } from "@/src/services/pos";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const here = (h: string, msg: string) => redirect(`/mypontivo/${h}/restaurant/geraete?msg=${encodeURIComponent(msg)}`);

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

/** Kassen-Geräte (Einstellungen → Technik → Geräte & Kasse): jedes Gerät hat einen eigenen, lückenlosen Bon-Nummernkreis */
export default async function PosDevicesPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager");
  await requireModule(hotel.id, "pos");
  const devices = await listDevices(hotel.id);
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  return (
    <div className="stack">
      <h1>Kassen-Geräte</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <form action={device} className="card stack">{H}<h2>Geräte</h2><p className="small muted">Jedes Gerät hat einen eigenen, lückenlosen Nummernkreis. Die Weboberfläche nutzt «W1».</p>{devices.length ? <table className="table"><tbody>{devices.map((d) => <tr key={d.id}><td>{d.code} {d.label}</td><td>{d.claimedKey ? "belegt" : "frei"}{d.pendingOps ? `, ${d.pendingOps} offen` : ""}</td><td>{d.claimedKey ? <button className="btn secondary small" formNoValidate formAction={release} name="id" value={d.id}>Freigeben</button> : null}</td></tr>)}</tbody></table> : <p>noch keines</p>}
        <div><label>Code (A–Z, 0–9, bis 6 Zeichen)</label><input name="code" required maxLength={6} /></div><div><label>Bezeichnung</label><input name="label" maxLength={60} /></div><div><button className="btn secondary">Gerät anlegen</button></div></form>
    </div>
  );
}
