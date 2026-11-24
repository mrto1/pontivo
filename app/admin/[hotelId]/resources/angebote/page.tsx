import { Notice } from "@/components/admin/Notice";
import { InfoTip } from "@/components/admin/InfoTip";
import { Drawer, DrawerActions } from "@/components/admin/Drawer";
import { RowList } from "@/components/admin/RowList";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { ResourceError, listResources, saveResource } from "@/src/services/resources";
import { hhmm } from "@/src/domain/resources";
import { formatChf } from "@/src/domain/money";
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";

async function saveRes(f: FormData) {
  "use server";
  const c = await requireHotelModule("resources", s(f, "hotelId"), "manager");
  const id = s(f, "id");
  let msg = "Angebot gespeichert.";
  let ok = true;
  try {
    await saveResource(c.hotel.id, id || null, {
      name: s(f, "name"), kind: s(f, "kind") as "other", capacity: Number(s(f, "capacity")), slotMinutes: Number(s(f, "slotMinutes")), openFrom: s(f, "openFrom"), openTo: s(f, "openTo"),
      priceRappen: Math.round(Number(s(f, "price").replace(",", ".") || 0) * 100), pricePerPerson: f.get("pricePerPerson") === "on", vatKind: s(f, "vatKind") as "standard", active: f.get("active") === "on",
    }, c.actor);
  } catch (e) {
    if (!(e instanceof ResourceError)) throw e;
    msg = `Nicht gespeichert: ${e.message}`;
    ok = false;
  }
  // bei einem Fehler bleibt die Seitenleiste offen
  redirect(`/admin/${c.hotel.id}/resources/angebote?${ok ? "" : `r=${id || "neu"}&`}msg=${encodeURIComponent(msg)}`);
}

const KINDS = { wellness: "Wellness / Sauna", seminar: "Seminarraum (exklusiv)", sport: "Sport (Tennis …)", other: "Anderes" };

/** Stammdaten der Angebote vor Ort (Einstellungen): Liste, Bearbeiten in der Seitenleiste, «Neues Angebot» zuunterst */
export default async function ResourceSettings({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("resources", hotelId, "manager");
  const list = await listResources(hotel.id);
  const base = `/admin/${hotel.id}/resources/angebote`;
  const creating = sp.r === "neu";
  const open = list.find((r) => r.id === sp.r);
  const drawerOpen = creating || !!open;
  const r = open;
  return (
    <div className="stack">
      <h1>Angebote vor Ort<InfoTip>Wellness, Sauna, Seminarraum oder Tennisplatz, die Gäste in Zeitfenstern buchen. Hier legen Sie fest, was es gibt, wie viele Plätze, wie lange ein Zeitfenster dauert und was es kostet. Gebucht wird unter Buchungen → Angebote vor Ort.</InfoTip></h1>
      {sp.msg && !drawerOpen ? <Notice text={sp.msg} /> : null}
      {list.length === 0 ? <p className="muted">Noch kein Angebot.</p> : null}
      <RowList rows={list.map((x) => ({ id: x.id, href: `${base}?r=${x.id}`, label: `${x.name} bearbeiten`, title: x.name, badges: x.active ? [] : [{ text: "inaktiv" }],
        detail: `${KINDS[x.kind as keyof typeof KINDS] ?? x.kind} · ${hhmm(x.openFrom)}–${hhmm(x.openTo)} · ${x.capacity} Plätze · ${x.slotMinutes} Min. · ${formatChf(x.priceRappen)}${x.pricePerPerson ? " p. P." : ""}` }))} />
      <div><Link className="btn secondary" href={`${base}?r=neu`} scroll={false}>+ Neues Angebot</Link></div>

      {drawerOpen ? (
        <Drawer title={r ? r.name : "Neues Angebot"} closeHref={base}>
              {sp.msg ? <Notice text={sp.msg} /> : null}
              <form action={saveRes} className="stack">
                <input type="hidden" name="hotelId" value={hotel.id} />{r ? <input type="hidden" name="id" value={r.id} /> : null}
                <div><label htmlFor="fd1c91">Name</label><input id="fd1c91" name="name" defaultValue={r?.name ?? ""} required placeholder="z. B. Sauna" /></div>
                <div><label htmlFor="fd1c92">Art</label><select id="fd1c92" name="kind" defaultValue={r?.kind ?? "wellness"}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div className="form-grid">
                  <div><label htmlFor="fd1c93">Plätze pro Zeitfenster</label><input id="fd1c93" name="capacity" type="number" min={1} defaultValue={r?.capacity ?? 4} /></div>
                  <div><label htmlFor="fd1c94">Zeitfenster (Minuten)</label><input id="fd1c94" name="slotMinutes" type="number" min={15} step={15} defaultValue={r?.slotMinutes ?? 60} /></div>
                  <div><label htmlFor="fd1c95">Geöffnet von</label><input id="fd1c95" name="openFrom" defaultValue={r ? hhmm(r.openFrom) : "08:00"} /></div>
                  <div><label htmlFor="fd1c96">Geöffnet bis</label><input id="fd1c96" name="openTo" defaultValue={r ? hhmm(r.openTo) : "20:00"} /></div>
                  <div><label htmlFor="fd1c97">Preis CHF je Zeitfenster</label><input id="fd1c97" name="price" inputMode="decimal" defaultValue={r ? r.priceRappen / 100 : 0} /></div>
                  <div><label htmlFor="fd1c98">MWST</label><select id="fd1c98" name="vatKind" defaultValue={r?.vatKind ?? "standard"}><option value="standard">Normalsatz</option><option value="stay">Beherbergungssatz</option><option value="none">keine</option></select></div>
                </div>
                <label className="check"><input type="checkbox" name="pricePerPerson" defaultChecked={r?.pricePerPerson} />Preis gilt pro Person</label>
                <label className="check"><input type="checkbox" name="active" defaultChecked={r?.active ?? true} />Aktiv (buchbar)</label>
                <DrawerActions submit={r ? "Speichern" : "Angebot anlegen"} cancelHref={base} />
              </form>
        </Drawer>
      ) : null}
    </div>
  );
}
