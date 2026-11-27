import { Notice } from "@/components/admin/Notice";
import { InfoTip } from "@/components/admin/InfoTip";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { isOn, MODULE_GROUPS, moduleDef } from "@/src/domain/modules";
import { applyModules, ModuleError, moduleRows, setModule } from "@/src/services/modules";
import { s } from "@/src/lib/form";
import { hotelAction } from "@/src/lib/hotel-action";
import { isRestaurant, isWholeUnit } from "@/src/services/onboarding";
import { packagesFor, packageState, wantedForToggle } from "@/src/domain/packages";

export const dynamic = "force-dynamic";


async function toggle(f: FormData) {
  "use server";
  await hotelAction(f, { page: "funktionen", role: "manager", fail: "Nicht geändert" }, async (c) => {
    const key = s(f, "module");
    if (f.get("on") !== "1") { await setModule(c.hotel.id, key, false, c.actor); return "Gespeichert."; }
    // Einschalten zieht die Voraussetzungen automatisch mit
    const changed = Object.keys(await applyModules(c.hotel.id, { [key]: true }, c.actor)).filter((k) => k !== key);
    return changed.length ? `Gespeichert. Zusätzlich eingeschaltet: ${changed.map((k) => moduleDef(k)?.label ?? k).join(", ")}.` : "Gespeichert.";
  });
}

/** Ein ganzes Paket ein- oder ausschalten (SPEC 19.69) */
async function togglePackage(f: FormData) {
  "use server";
  await hotelAction(f, { page: "funktionen", role: "manager", fail: "Nicht geändert" }, async (c) => {
    const shown = packagesFor(kindOf(c.hotel.propertyType));
    const on = f.get("on") === "1";
    const p = shown.find((x) => x.key === s(f, "package"));
    if (!p) throw new ModuleError("Paket unbekannt.");
    await applyModules(c.hotel.id, wantedForToggle(shown, p.key, on, await moduleRows(c.hotel.id), isOn), c.actor);
    return on ? `Paket «${p.name}» eingeschaltet.` : `Paket «${p.name}» ausgeschaltet.`;
  });
}

const kindOf = (t: string) => ({ restaurantOnly: isRestaurant(t), wholeUnit: isWholeUnit(t) });
const STATE = { on: "An", partial: "Teilweise", off: "Aus" } as const;

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
      <section className="card stack" data-testid="packages">
        <div>
          <h2 className="m0">Pakete</h2>
          <p className="small muted m-2-0-0">Schalten mehrere Funktionen auf einmal. Darunter können Sie jede Funktion einzeln ein- oder ausschalten.</p>
        </div>
        <div>
          {packagesFor(kindOf(hotel.propertyType)).map((p) => {
            const st = packageState(p, rows, isOn);
            return (
              <form key={p.key} action={togglePackage} className="pkg-row">
                <input type="hidden" name="hotelId" value={hotel.id} /><input type="hidden" name="package" value={p.key} /><input type="hidden" name="on" value={st === "on" ? "0" : "1"} />
                <div className="pkg-text">
                  <span className="pkg-name">{p.name}{p.price ? <span className="badge">{p.price}</span> : null}<span className={`badge${st === "on" ? "" : " muted"}`}>{STATE[st]}</span></span>
                  <span className="small muted">{p.promise}</span>
                  <span className="small muted">Enthält: {p.modules.map((m) => moduleDef(m)?.label ?? m).join(", ")}</span>
                </div>
                {canEdit ? <button className="btn secondary small">{st === "on" ? "Ausschalten" : "Einschalten"}</button> : null}
              </form>
            );
          })}
        </div>
      </section>
      {MODULE_GROUPS.map((g) => (
        <section key={g.title} className="card stack">
          <div>
            <h2 className="m0">{g.title}</h2>
            <p className="small muted m-2-0-0">{g.lead}</p>
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
