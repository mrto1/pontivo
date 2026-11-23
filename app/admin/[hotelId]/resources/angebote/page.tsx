import { Notice } from "@/components/admin/Notice";
import { InfoTip } from "@/components/admin/InfoTip";
import { DrawerKeys } from "@/components/admin/DrawerKeys";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { ResourceError, listResources, saveResource } from "@/src/services/resources";
import { hhmm } from "@/src/domain/resources";
import { formatChf } from "@/src/domain/money";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function saveRes(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "resources");
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
  const { hotel } = await requireHotel(hotelId, "manager");
  await requireModule(hotel.id, "resources");
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
      <ul className="plan-list">
        {list.map((x) => (
          <li key={x.id}>
            <Link href={`${base}?r=${x.id}`} scroll={false} className="plan-row" aria-label={`${x.name} bearbeiten`}>
              <span><strong>{x.name}</strong><br /><span className="muted small">{KINDS[x.kind as keyof typeof KINDS] ?? x.kind} · {hhmm(x.openFrom)}–{hhmm(x.openTo)} · {x.capacity} Plätze · {x.slotMinutes} Min. · {formatChf(x.priceRappen)}{x.pricePerPerson ? " p. P." : ""}</span></span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>{x.active ? null : <span className="badge warn">inaktiv</span>}<span className="rt-arrow" aria-hidden="true">›</span></span>
            </Link>
          </li>
        ))}
      </ul>
      <div><Link className="btn secondary" href={`${base}?r=neu`} scroll={false}>+ Neues Angebot</Link></div>

      {drawerOpen ? (
        <div className="drawer-wrap">
          <Link className="drawer-backdrop" href={base} scroll={false} aria-label="Schliessen" tabIndex={-1} />
          <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabIndex={-1}>
            <header className="drawer-head">
              <h2 id="drawer-title">{r ? r.name : "Neues Angebot"}</h2>
              <Link className="drawer-close" href={base} scroll={false} aria-label="Schliessen">✕</Link>
            </header>
            <div className="drawer-body stack">
              {sp.msg ? <Notice text={sp.msg} /> : null}
              <form action={saveRes} className="stack">
                <input type="hidden" name="hotelId" value={hotel.id} />{r ? <input type="hidden" name="id" value={r.id} /> : null}
                <div><label>Name</label><input name="name" defaultValue={r?.name ?? ""} required placeholder="z. B. Sauna" /></div>
                <div><label>Art</label><select name="kind" defaultValue={r?.kind ?? "wellness"}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div className="form-grid">
                  <div><label>Plätze pro Zeitfenster</label><input name="capacity" type="number" min={1} defaultValue={r?.capacity ?? 4} /></div>
                  <div><label>Zeitfenster (Minuten)</label><input name="slotMinutes" type="number" min={15} step={15} defaultValue={r?.slotMinutes ?? 60} /></div>
                  <div><label>Geöffnet von</label><input name="openFrom" defaultValue={r ? hhmm(r.openFrom) : "08:00"} /></div>
                  <div><label>Geöffnet bis</label><input name="openTo" defaultValue={r ? hhmm(r.openTo) : "20:00"} /></div>
                  <div><label>Preis CHF je Zeitfenster</label><input name="price" inputMode="decimal" defaultValue={r ? r.priceRappen / 100 : 0} /></div>
                  <div><label>MWST</label><select name="vatKind" defaultValue={r?.vatKind ?? "standard"}><option value="standard">Normalsatz</option><option value="stay">Beherbergungssatz</option><option value="none">keine</option></select></div>
                </div>
                <label className="check"><input type="checkbox" name="pricePerPerson" defaultChecked={r?.pricePerPerson} />Preis gilt pro Person</label>
                <label className="check"><input type="checkbox" name="active" defaultChecked={r?.active ?? true} />Aktiv (buchbar)</label>
                <div className="drawer-actions"><button className="btn">{r ? "Speichern" : "Angebot anlegen"}</button><Link className="btn secondary" href={base} scroll={false}>Abbrechen</Link></div>
              </form>
            </div>
          </aside>
          <DrawerKeys closeHref={base} />
        </div>
      ) : null}
    </div>
  );
}
