import { Notice } from "@/components/admin/Notice";
import { InfoTip } from "@/components/admin/InfoTip";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { isOn, MODULE_GROUPS, moduleDef } from "@/src/domain/modules";
import { applyModules, ModuleError, moduleRows, setModule } from "@/src/services/modules";
import { setDiningLabel } from "@/src/services/settings";
import { DINING_LABEL, DINING_LABELS } from "@/src/admin/nav";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function toggle(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  let msg = "Gespeichert.";
  try {
    const key = s(f, "module");
    if (f.get("on") === "1") {
      // Einschalten zieht die Voraussetzungen automatisch mit
      const changed = Object.keys(await applyModules(c.hotel.id, { [key]: true }, c.actor)).filter((k) => k !== key);
      if (changed.length) msg = `Gespeichert. Zusätzlich eingeschaltet: ${changed.map((k) => moduleDef(k)?.label ?? k).join(", ")}.`;
    } else await setModule(c.hotel.id, key, false, c.actor);
  } catch (e) {
    if (!(e instanceof ModuleError)) throw e;
    msg = `Nicht geändert: ${e.message}`;
  }
  redirect(`/admin/${c.hotel.id}/funktionen?msg=${encodeURIComponent(msg)}`);
}

async function saveLook(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  let msg = "Gespeichert.";
  try {
    await setDiningLabel(c.hotel, s(f, "diningLabel"), c.actor);
  } catch (e) {
    msg = `Nicht gespeichert: ${(e as Error).message}`;
  }
  redirect(`/admin/${c.hotel.id}/funktionen?msg=${encodeURIComponent(msg)}`);
}

export default async function Funktionen({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const canEdit = atLeast(role, "manager");
  const rows = await moduleRows(hotel.id);
  return (
    <div className="stack">
      <h1>Funktionen<InfoTip>Schalten Sie aus, was Sie nicht brauchen. Es verschwindet dann aus dem Menü. Ihre Daten bleiben erhalten und sind wieder da, wenn Sie die Funktion einschalten. KI-Chat und Upselling schalten Sie auf ihren eigenen Seiten ein.</InfoTip></h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      {isOn(rows, "restaurant") && hotel.propertyType !== "restaurant" ? (
        <section className="card stack" id="darstellung">
          <div>
            <h2 className="m0">Darstellung</h2>
            <p className="small muted" style={{ margin: "2px 0 0" }}>Wie der Restaurant-Bereich im Umschalter oben (Bett | Besteck) heisst.</p>
          </div>
          <form action={saveLook} className="stack">
            <input type="hidden" name="hotelId" value={hotel.id} />
            <div><label htmlFor="diningLabel">Bezeichnung im Umschalter (Besteck-Symbol)</label>
              <select id="diningLabel" name="diningLabel" defaultValue={hotel.diningLabel} disabled={!canEdit}>{DINING_LABELS.map((k) => <option key={k} value={k}>{DINING_LABEL[k].de}</option>)}</select></div>
            {canEdit ? <div><button className="btn">Speichern</button></div> : null}
          </form>
        </section>
      ) : null}
      {MODULE_GROUPS.map((g) => (
        <section key={g.title} className="card stack">
          <div>
            <h2 className="m0">{g.title}</h2>
            <p className="small muted" style={{ margin: "2px 0 0" }}>{g.lead}</p>
          </div>
          {g.keys.map((key) => {
            const m = moduleDef(key)!;
            const on = isOn(rows, m.key);
            return (
              <form key={m.key} action={toggle} className="module-row">
                <input type="hidden" name="hotelId" value={hotel.id} />
                <input type="hidden" name="module" value={m.key} />
                <input type="hidden" name="on" value={on ? "0" : "1"} />
                <div className="module-text">
                  <strong id={`m-${m.key}`}>{m.label}</strong>
                  <div className="small muted">{m.description}</div>
                </div>
                <button type="submit" className="switch" role="switch" aria-checked={on} aria-labelledby={`m-${m.key}`} disabled={!canEdit} title={on ? "Ausschalten" : "Einschalten"}>
                  <span className="switch-state">{on ? "An" : "Aus"}</span>
                </button>
              </form>
            );
          })}
        </section>
      ))}
    </div>
  );
}
