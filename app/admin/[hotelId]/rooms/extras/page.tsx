import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { createExtra, deleteExtra, ExtraAdminError, listExtras, moveExtra, updateExtra, type ExtraInput } from "@/src/services/extras";
import { listRooms } from "@/src/services/rooms";
import { decimalToRappen, formatChf } from "@/src/domain/money";
import { EXTRA_UNITS, perPerson } from "@/src/domain/extras";
import { hotelLocales, LOCALE_NAMES } from "@/src/i18n/dict";
import type { Extra } from "@/src/db/schema";

export const dynamic = "force-dynamic";

const UNIT: Record<string, string> = { per_booking: "pro Aufenthalt", per_night: "pro Nacht", per_person: "pro Person", per_person_night: "pro Person und Nacht" };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function input(f: FormData): ExtraInput {
  const price = s(f, "price").replace(",", ".").replace(/'/g, "").replace(/\.?[–-]+$/, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(price)) throw new ExtraAdminError("Preis wie 15.00 angeben");
  const l = (k: string) => Object.fromEntries(["de", "en", "fr", "it", "nl"].map((x) => [x, s(f, `${k}.${x}`) || undefined]));
  return {
    name: l("name"), description: l("description"), priceRappen: decimalToRappen(price), unit: s(f, "unit") as ExtraInput["unit"],
    maxQuantity: Math.max(1, Math.min(20, Number(s(f, "max")) || 1)), mandatory: f.get("mandatory") === "on", active: f.get("active") === "on",
    roomTypeIds: f.getAll("rooms").map(String),
  };
}

async function run(f: FormData, fn: (hotelId: string, actor: string) => Promise<string>) {
  const c = await requireHotel(s(f, "hotelId"), "manager");
  let msg: string;
  try {
    msg = await fn(c.hotel.id, c.actor);
  } catch (e) {
    if (!(e instanceof ZodError) && !(e instanceof ExtraAdminError) && !(e instanceof Error && /Betrag/.test(e.message))) throw e;
    msg = `Nicht gespeichert: ${e instanceof ZodError ? e.issues.map((i) => i.message).join(", ") : e.message}`;
  }
  redirect(`/admin/${c.hotel.id}/rooms/extras?msg=${encodeURIComponent(msg)}`);
}

async function save(f: FormData) {
  "use server";
  await run(f, async (hotelId, actor) => {
    if (s(f, "id")) await updateExtra(hotelId, s(f, "id"), input(f), actor);
    else await createExtra(hotelId, { ...input(f), active: true }, actor);
    return "Gespeichert";
  });
}
async function remove(f: FormData) {
  "use server";
  await run(f, async (hotelId, actor) => { await deleteExtra(hotelId, s(f, "id"), actor); return "Gelöscht"; });
}
async function move(f: FormData) {
  "use server";
  await run(f, async (hotelId, actor) => { await moveExtra(hotelId, s(f, "id"), s(f, "dir") === "up" ? -1 : 1, actor); return "Reihenfolge geändert"; });
}

const EXAMPLES = [
  { name: "Hund", price: "15.00", unit: "per_night", note: "pro Nacht" },
  { name: "Parkplatz", price: "10.00", unit: "per_night", note: "pro Nacht, bis 3 Stück" },
  { name: "Frühstück", price: "18.00", unit: "per_person_night", note: "pro Person und Nacht" },
  { name: "Endreinigung", price: "80.00", unit: "per_booking", note: "obligatorisch, z. B. Ferienwohnung" },
  { name: "Late Check-out bis 14 Uhr", price: "30.00", unit: "per_booking", note: "einmalig" },
];

export default async function Extras({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const canEdit = atLeast(role, "manager");
  const list = await listExtras(hotel.id);
  const rooms = await listRooms(hotel.id);
  const langs = hotelLocales(hotel);
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;

  const form = (e: Extra | null) => (
    <form action={save} className="stack">
      {hidden}
      {e ? <input type="hidden" name="id" value={e.id} /> : null}
      <div className="form-grid">
        {langs.map((l) => (
          <div key={l}><label>Name {l === "de" ? "" : LOCALE_NAMES[l]}</label><input name={`name.${l}`} defaultValue={e?.name[l] ?? ""} required={l === "de"} maxLength={80} placeholder={l === "de" ? "z. B. Hund" : ""} /></div>
        ))}
      </div>
      <div className="form-grid">
        {langs.map((l) => (
          <div key={l}><label>Beschreibung {l === "de" ? "(optional)" : LOCALE_NAMES[l]}</label><input name={`description.${l}`} defaultValue={e?.description[l] ?? ""} maxLength={300} /></div>
        ))}
      </div>
      <div className="form-grid">
        <div><label>Preis CHF</label><input name="price" inputMode="decimal" required defaultValue={e ? (e.priceRappen / 100).toFixed(2) : ""} placeholder="15.00" /></div>
        <div><label>Berechnung</label><select name="unit" defaultValue={e?.unit ?? "per_booking"}>{EXTRA_UNITS.map((u) => <option key={u} value={u}>{UNIT[u]}</option>)}</select></div>
        <div><label>Höchstens wählbar (nicht bei «pro Person»)</label><input name="max" type="number" min={1} max={20} defaultValue={e?.maxQuantity ?? 1} /></div>
      </div>
      {rooms.length > 1 ? (
        <fieldset className="plain"><legend className="small muted">Nur für diese Zimmer (keines gewählt = alle)</legend>
          <div className="weekdays">{rooms.map((r) => <label key={r.roomType.id}><input type="checkbox" name="rooms" value={r.roomType.id} defaultChecked={e?.roomTypeIds.includes(r.roomType.id)} />{r.roomType.name}</label>)}</div>
        </fieldset>
      ) : null}
      <label className="check"><input type="checkbox" name="mandatory" defaultChecked={e?.mandatory} />Obligatorisch – immer im Preis enthalten (z. B. Endreinigung)</label>
      {e ? <label className="check"><input type="checkbox" name="active" defaultChecked={e.active} />Aktiv (Gäste können es buchen)</label> : <input type="hidden" name="active" value="on" />}
      <div><button className="btn small">{e ? "Speichern" : "Hinzufügen"}</button></div>
    </form>
  );

  return (
    <div className="stack">
      <p className="small"><a href={`/admin/${hotel.id}/rooms`}>← Zimmer und Tarife</a></p>
      <h1>Zusatzleistungen</h1>
      {sp.msg ? <p className={`notice ${sp.msg.startsWith("Nicht") ? "warn" : ""}`}>{sp.msg}</p> : null}
      <p className="muted">Gäste wählen Zusatzleistungen bei der Online-Buchung dazu, der Betrag wird gleich mitbezahlt. Obligatorische Leistungen sind im angezeigten Gesamtpreis bereits enthalten (Preisbekanntgabe). Bei einer Stornierung werden Zusatzleistungen immer zurückerstattet; die Stornogebühr gilt nur für den Zimmerpreis.</p>
      {hotel.channexEnabled ? <p className="notice warn small">Buchungen über Booking.com &amp; Co. enthalten diese Zusatzleistungen nicht. Obligatorische Gebühren wie eine Endreinigung bitte zusätzlich im Extranet des Portals eintragen.</p> : null}

      {list.length ? (
        <table className="table">
          <thead><tr><th>Leistung</th><th>Preis</th><th>Zimmer</th><th></th></tr></thead>
          <tbody>
            {list.map((e, i) => (
              <tr key={e.id}>
                <td><strong>{e.name.de}</strong>{e.mandatory ? <span className="badge" style={{ marginLeft: 8 }}>obligatorisch</span> : null}{e.active ? null : <span className="badge warn" style={{ marginLeft: 8 }}>inaktiv</span>}
                  {e.description.de ? <div className="small muted">{e.description.de}</div> : null}</td>
                <td>{formatChf(e.priceRappen)} {UNIT[e.unit]}{!perPerson(e.unit) && e.maxQuantity > 1 ? ` · bis ${e.maxQuantity}×` : ""}</td>
                <td className="small">{e.roomTypeIds.length ? rooms.filter((r) => e.roomTypeIds.includes(r.roomType.id)).map((r) => r.roomType.name).join(", ") : "alle"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {canEdit ? (<>
                    <form action={move} style={{ display: "inline" }}>{hidden}<input type="hidden" name="id" value={e.id} /><input type="hidden" name="dir" value="up" /><button className="btn secondary small" disabled={i === 0} aria-label="nach oben">↑</button></form>{" "}
                    <form action={move} style={{ display: "inline" }}>{hidden}<input type="hidden" name="id" value={e.id} /><input type="hidden" name="dir" value="down" /><button className="btn secondary small" disabled={i === list.length - 1} aria-label="nach unten">↓</button></form>
                  </>) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="notice">Noch keine Zusatzleistungen. Beispiele: {EXAMPLES.map((x) => `${x.name} (CHF ${x.price} ${x.note})`).join(", ")}.</p>}

      {canEdit ? (<>
        {list.map((e) => (
          <details key={e.id} className="card">
            <summary><strong>{e.name.de}</strong> bearbeiten</summary>
            <div style={{ marginTop: 12 }}>{form(e)}</div>
            <form action={remove} style={{ marginTop: 12 }}>{hidden}<input type="hidden" name="id" value={e.id} /><button className="btn danger small">Löschen</button> <span className="small muted">Bestehende Buchungen behalten Name und Preis.</span></form>
          </details>
        ))}
        <section className="card">
          <h2 style={{ fontSize: "1.15rem" }}>Neue Zusatzleistung</h2>
          {form(null)}
        </section>
      </>) : null}
    </div>
  );
}
