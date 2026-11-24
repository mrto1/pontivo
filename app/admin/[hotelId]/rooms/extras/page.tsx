import { Notice } from "@/components/admin/Notice";
import { InfoTip } from "@/components/admin/InfoTip";
import { Drawer, DrawerActions } from "@/components/admin/Drawer";
import { RowList } from "@/components/admin/RowList";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import Link from "next/link";
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
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";

const UNIT: Record<string, string> = { per_booking: "pro Aufenthalt", per_night: "pro Nacht", per_person: "pro Person", per_person_night: "pro Person und Nacht" };

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
  // bei einem Fehler bleibt die Seitenleiste offen
  const reopen = msg.startsWith("Nicht gespeichert") ? `e=${s(f, "id") || "neu"}&` : "";
  redirect(`/admin/${c.hotel.id}/rooms/extras?${reopen}msg=${encodeURIComponent(msg)}`);
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
  const base = `/admin/${hotel.id}/rooms/extras`;
  const open = canEdit ? list.find((x) => x.id === sp.e) : undefined;
  const creating = canEdit && sp.e === "neu";
  const drawerOpen = creating || !!open;

  const form = (e: Extra | null) => (
    <form action={save} className="stack">
      {hidden}
      {e ? <input type="hidden" name="id" value={e.id} /> : null}
      <div className="form-grid">
        {langs.map((l) => (
          <div key={l}><label htmlFor={`ex-name-${l}`}>Name {l === "de" ? "" : LOCALE_NAMES[l]}</label><input id={`ex-name-${l}`} name={`name.${l}`} defaultValue={e?.name[l] ?? ""} required={l === "de"} maxLength={80} placeholder={l === "de" ? "z. B. Hund" : ""} /></div>
        ))}
      </div>
      <div className="form-grid">
        {langs.map((l) => (
          <div key={l}><label htmlFor={`ex-desc-${l}`}>Beschreibung {l === "de" ? "(optional)" : LOCALE_NAMES[l]}</label><input id={`ex-desc-${l}`} name={`description.${l}`} defaultValue={e?.description[l] ?? ""} maxLength={300} /></div>
        ))}
      </div>
      <div className="form-grid">
        <div><label htmlFor="f08441">Preis CHF</label><input id="f08441" name="price" inputMode="decimal" required defaultValue={e ? (e.priceRappen / 100).toFixed(2) : ""} placeholder="15.00" /></div>
        <div><label htmlFor="f08442">Berechnung</label><select id="f08442" name="unit" defaultValue={e?.unit ?? "per_booking"}>{EXTRA_UNITS.map((u) => <option key={u} value={u}>{UNIT[u]}</option>)}</select></div>
        <div><label htmlFor="f08443">Höchstens wählbar (nicht bei «pro Person»)</label><input id="f08443" name="max" type="number" min={1} max={20} defaultValue={e?.maxQuantity ?? 1} /></div>
      </div>
      {rooms.length > 1 ? (
        <fieldset className="plain"><legend className="small muted">Nur für diese Zimmer (keines gewählt = alle)</legend>
          <div className="weekdays">{rooms.map((r) => <label key={r.roomType.id}><input type="checkbox" name="rooms" value={r.roomType.id} defaultChecked={e?.roomTypeIds.includes(r.roomType.id)} />{r.roomType.name}</label>)}</div>
        </fieldset>
      ) : null}
      <label className="check"><input type="checkbox" name="mandatory" defaultChecked={e?.mandatory} />Obligatorisch – immer im Preis enthalten (z. B. Endreinigung)</label>
      {e ? <label className="check"><input type="checkbox" name="active" defaultChecked={e.active} />Aktiv (Gäste können es buchen)</label> : <input type="hidden" name="active" value="on" />}
      <DrawerActions submit={e ? "Speichern" : "Hinzufügen"} cancelHref={base} />
    </form>
  );

  return (
    <div className="stack">
            <h1>Zusatzleistungen</h1>
      <div><InfoTip label="Worum geht es hier?">Gäste wählen Zusatzleistungen bei der Online-Buchung dazu, der Betrag wird gleich mitbezahlt. Obligatorische Leistungen sind im angezeigten Gesamtpreis bereits enthalten (Preisbekanntgabe). Bei einer Stornierung werden Zusatzleistungen immer zurückerstattet; die Stornogebühr gilt nur für den Zimmerpreis.</InfoTip></div>
      {hotel.channexEnabled ? <p className="notice warn small">Buchungen über Booking.com &amp; Co. enthalten diese Zusatzleistungen nicht. Obligatorische Gebühren wie eine Endreinigung bitte zusätzlich im Extranet des Portals eintragen.</p> : null}

      {sp.msg && !drawerOpen ? <Notice text={sp.msg} /> : null}
      {list.length ? (
        <RowList rows={list.map((e) => ({
          id: e.id, href: canEdit ? `${base}?e=${e.id}` : base, label: `${e.name.de} bearbeiten`, title: e.name.de ?? "",
          detail: `${formatChf(e.priceRappen)} ${UNIT[e.unit]}${!perPerson(e.unit) && e.maxQuantity > 1 ? ` · bis ${e.maxQuantity}×` : ""} · ${e.roomTypeIds.length ? rooms.filter((r) => e.roomTypeIds.includes(r.roomType.id)).map((r) => r.roomType.name).join(", ") : "alle Zimmer"}`,
          badges: [...(e.mandatory ? [{ text: "obligatorisch" }] : []), ...(e.active ? [] : [{ text: "inaktiv" }])],
        }))} />
      ) : <p className="notice">Noch keine Zusatzleistungen. Beispiele: {EXAMPLES.map((x) => `${x.name} (CHF ${x.price} ${x.note})`).join(", ")}.</p>}
      {canEdit ? <div><Link className="btn secondary" href={`${base}?e=neu`} scroll={false}>+ Neue Zusatzleistung</Link></div> : null}

      {drawerOpen ? (
        <Drawer title={open ? (open.name.de ?? "") : "Neue Zusatzleistung"} closeHref={base}>
          {sp.msg ? <Notice text={sp.msg} /> : null}
          {form(open ?? null)}
          {open ? (
            <div className="stack">
              <div className="inline-form">
                <form action={move}>{hidden}<input type="hidden" name="id" value={open.id} /><input type="hidden" name="dir" value="up" /><button className="btn secondary small" disabled={list[0]?.id === open.id}>▲ Weiter oben anzeigen</button></form>
                <form action={move}>{hidden}<input type="hidden" name="id" value={open.id} /><input type="hidden" name="dir" value="down" /><button className="btn secondary small" disabled={list[list.length - 1]?.id === open.id}>▼ Weiter unten anzeigen</button></form>
              </div>
              <form action={remove}>{hidden}<input type="hidden" name="id" value={open.id} /><ConfirmButton ask={`«${open.name.de}» wirklich löschen?`} className="btn secondary small danger-text">Löschen</ConfirmButton> <span className="small muted">Bestehende Buchungen behalten Name und Preis.</span></form>
            </div>
          ) : null}
        </Drawer>
      ) : null}
    </div>
  );
}
