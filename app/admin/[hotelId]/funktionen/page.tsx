import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { isOn, MODULES } from "@/src/domain/modules";
import { ModuleError, moduleRows, setModule } from "@/src/services/modules";

export const dynamic = "force-dynamic";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function toggle(f: FormData) {
  "use server";
  const c = await requireHotel(s(f, "hotelId"), "manager");
  let msg = "Gespeichert.";
  try {
    await setModule(c.hotel.id, s(f, "module"), f.get("on") === "1", c.actor);
  } catch (e) {
    if (!(e instanceof ModuleError)) throw e;
    msg = `Nicht geändert: ${e.message}`;
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
      <h1>Funktionen</h1>
      <p className="muted small">Schalten Sie aus, was Sie nicht brauchen. Es verschwindet dann aus dem Menü. Ihre Daten bleiben erhalten und sind wieder da, wenn Sie die Funktion einschalten. KI-Chat und Upselling schalten Sie auf ihren eigenen Seiten ein.</p>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      <section className="card stack">
        {MODULES.map((m) => {
          const on = isOn(rows, m.key);
          return (
            <form key={m.key} action={toggle} className="inline-form" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <input type="hidden" name="hotelId" value={hotel.id} />
              <input type="hidden" name="module" value={m.key} />
              <input type="hidden" name="on" value={on ? "0" : "1"} />
              <div style={{ flex: "1 1 320px" }}>
                <strong>{m.label}</strong> {on ? <span className="badge">an</span> : <span className="badge warn">aus</span>}
                <div className="small muted">{m.description}</div>
              </div>
              {canEdit ? <button className="btn secondary small">{on ? "Ausschalten" : "Einschalten"}</button> : null}
            </form>
          );
        })}
      </section>
    </div>
  );
}
