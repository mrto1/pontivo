import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { PosError, importItems, importTables, listItems, listOptionGroups, listTables, saveItem, saveOption, saveOptionGroup, saveTable, saveTableDetails, saveTablePlan, setGroupItems, setOptionActive } from "@/src/services/pos";
import { FormSwitch } from "@/components/admin/FormSwitch";
import { FloorPlan } from "@/components/admin/FloorPlan";
import { formatChf } from "@/src/domain/money";
import { parsePosItems, parsePosTables } from "@/src/domain/pos-import";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const here = (h: string, msg: string) => redirect(`/mypontivo/${h}/restaurant/artikel?msg=${encodeURIComponent(msg)}`);
const bps = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);

async function guard(f: FormData) {
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "pos");
  return c;
}
async function item(f: FormData) {
  "use server";
  const c = await guard(f);
  try {
    await saveItem(c.hotel.id, s(f, "id") || null, { category: s(f, "category"), name: s(f, "name"), priceRappen: Math.round(Number(s(f, "price").replace(",", ".")) * 100), vatDineInBps: bps(s(f, "vatDineIn")), vatTakeawayBps: bps(s(f, "vatTakeaway")), dailySpecial: f.get("dailySpecial") === "on", active: f.get("active") !== "off", station: stationOf(s(f, "station")) }, c.actor);
  } catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, `Nicht gespeichert: ${e.message}`); }
  here(c.hotel.id, "Gespeichert.");
}
const stationOf = (v: string) => (v === "bar" || v === "none" ? v : "kitchen") as "kitchen" | "bar" | "none";
const STATION = { kitchen: "Küche", bar: "Bar", none: "Keine" } as const;
async function station(f: FormData) {
  "use server";
  const c = await guard(f);
  const it = (await listItems(c.hotel.id)).find((i) => i.id === s(f, "id"));
  if (it) await saveItem(c.hotel.id, it.id, { ...it, category: it.category ?? "", station: stationOf(s(f, "station")) }, c.actor);
  here(c.hotel.id, "Station gespeichert.");
}
async function toggle(f: FormData) {
  "use server";
  const c = await guard(f);
  const it = (await listItems(c.hotel.id)).find((i) => i.id === s(f, "id"));
  if (it) await saveItem(c.hotel.id, it.id, { ...it, category: it.category ?? "", active: !it.active }, c.actor);
  here(c.hotel.id, it?.active ? "Ausgeblendet." : "Eingeblendet.");
}
async function table(f: FormData) {
  "use server";
  const c = await guard(f);
  try { await saveTable(c.hotel.id, s(f, "name"), c.actor); } catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, `Nicht angelegt: ${e.message}`); }
  here(c.hotel.id, "Tisch angelegt.");
}
async function group(f: FormData) {
  "use server";
  const c = await guard(f);
  try { await saveOptionGroup(c.hotel.id, s(f, "id") || null, { name: s(f, "name"), required: f.get("required") === "on", maxChoices: Number(s(f, "maxChoices") || 1) }, c.actor); }
  catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, `Gruppe nicht gespeichert: ${e.message}`); }
  here(c.hotel.id, "Gruppe gespeichert.");
}
async function option(f: FormData) {
  "use server";
  const c = await guard(f);
  try { await saveOption(c.hotel.id, s(f, "groupId"), { name: s(f, "name"), priceRappen: s(f, "price") ? Math.round(Number(s(f, "price").replace(",", ".")) * 100) : 0 }, c.actor); }
  catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, `Option nicht gespeichert: ${e.message}`); }
  here(c.hotel.id, "Option gespeichert.");
}
async function optionToggle(f: FormData) {
  "use server";
  const c = await guard(f);
  try { await setOptionActive(c.hotel.id, s(f, "id"), s(f, "active") === "1", c.actor); } catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, e.message); }
  here(c.hotel.id, "Gespeichert.");
}
async function groupItems(f: FormData) {
  "use server";
  const c = await guard(f);
  try { await setGroupItems(c.hotel.id, s(f, "groupId"), f.getAll("itemId").map(String), c.actor); }
  catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, e.message); }
  here(c.hotel.id, "Zuordnung gespeichert.");
}
async function tableDetails(f: FormData) {
  "use server";
  const c = await guard(f);
  try { await saveTableDetails(c.hotel.id, s(f, "id"), { seats: Number(s(f, "seats")), shape: s(f, "shape") === "round" ? "round" : "square" }, c.actor); }
  catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, `Nicht gespeichert: ${e.message}`); }
  here(c.hotel.id, "Tisch gespeichert.");
}
async function planSave(f: FormData) {
  "use server";
  const c = await guard(f);
  try {
    const raw = JSON.parse(s(f, "positions")) as { id: string; x: number | null; y: number | null }[];
    if (!Array.isArray(raw)) throw new PosError("Plan ungültig.");
    await saveTablePlan(c.hotel.id, raw.map((p) => ({ id: String(p.id), x: p.x === null ? null : Number(p.x), y: p.y === null ? null : Number(p.y) })), c.actor);
  } catch (e) { if (!(e instanceof PosError) && !(e instanceof SyntaxError)) throw e; here(c.hotel.id, "Plan nicht gespeichert."); }
  here(c.hotel.id, "Tischplan gespeichert.");
}
async function csvImport(f: FormData) {
  "use server";
  const c = await guard(f);
  const file = f.get("file");
  if (!(file instanceof File) || !file.size) return here(c.hotel.id, "Nicht importiert: Bitte eine CSV-Datei wählen.");
  if (file.size > 1_000_000) return here(c.hotel.id, "Nicht importiert: Die Datei ist zu gross (höchstens 1 MB).");
  const text = await file.text();
  const tables = s(f, "kind") === "tables";
  const r = tables ? parsePosTables(text) : parsePosItems(text);
  if (r.problems.length) {
    const first = r.problems.slice(0, 3).map((p) => `Zeile ${p.row}: ${p.message}`).join(" ");
    return here(c.hotel.id, `Nicht importiert (${r.problems.length} Fehler, es wurde nichts gespeichert). ${first}${r.problems.length > 3 ? " …" : ""}`);
  }
  const res = tables ? await importTables(c.hotel.id, (r as ReturnType<typeof parsePosTables>).names, c.actor) : await importItems(c.hotel.id, (r as ReturnType<typeof parsePosItems>).rows, c.actor);
  here(c.hotel.id, `${res.created} ${tables ? "Tische" : "Artikel"} importiert${res.skipped ? `, ${res.skipped} übersprungen (gab es schon)` : ""}.`);
}

export default async function PosItemsPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager");
  await requireModule(hotel.id, "pos");
  const [items, tables, groups] = await Promise.all([listItems(hotel.id), listTables(hotel.id), listOptionGroups(hotel.id)]);
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  return (
    <div className="stack">
      <h1>Restaurant: Artikel und Tische</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <form action={item} className="card stack">
        {H}
        <h2>Neuer Artikel</h2>
        <div><label>Name</label><input name="name" required maxLength={120} /></div>
        <div><label>Kategorie</label><input name="category" maxLength={60} placeholder="Essen, Getränke …" /></div>
        <div><label>Preis CHF</label><input name="price" inputMode="decimal" required /></div>
        <div><label>MWST im Haus %</label><input name="vatDineIn" inputMode="decimal" defaultValue="8.1" /></div>
        <div><label>MWST Take-away %</label><input name="vatTakeaway" inputMode="decimal" defaultValue="2.6" /></div>
        <div><label htmlFor="nstation">Station (Küchenbildschirm)</label><select id="nstation" name="station" defaultValue="kitchen">{Object.entries(STATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label><input type="checkbox" name="dailySpecial" /> Tagesangebot</label></div>
        <div><button className="btn">Speichern</button></div>
        <p className="small muted">Die Sätze legt Ihr Treuhänder fest. Hotelzimmer-Posten beim Restaurant: Getränke und Speisen im Haus 8,1 %, Take-away 2,6 % (Stand der Standardsätze; bitte prüfen).</p>
      </form>
      <section className="card">
        <h2>Artikel</h2>
        {items.length ? <table className="table"><thead><tr><th>Name</th><th>Preis</th><th>Haus</th><th>Take-away</th><th>Station</th><th /></tr></thead><tbody>
          {items.map((i) => <tr key={i.id}><td>{i.category ? `${i.category}: ` : ""}{i.name}{i.dailySpecial ? " ★" : ""}{i.active ? "" : " (aus)"}</td><td>{formatChf(i.priceRappen)}</td><td>{(i.vatDineInBps / 100).toFixed(1)} %</td><td>{(i.vatTakeawayBps / 100).toFixed(1)} %</td>
            <td><form action={station} className="inline-form">{H}<input type="hidden" name="id" value={i.id} /><select name="station" defaultValue={i.station} aria-label={`Station ${i.name}`}>{Object.entries(STATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select> <button className="btn secondary small">Setzen</button></form></td>
            <td><form action={toggle}>{H}<input type="hidden" name="id" value={i.id} /><button className="btn secondary small">{i.active ? "Ausblenden" : "Einblenden"}</button></form></td></tr>)}
        </tbody></table> : <p className="muted">Noch kein Artikel.</p>}
      </section>
      <section className="card stack" id="optionen" data-testid="option-groups">
        <h2>Optionen und Menüs</h2>
        <p className="small muted">Garstufe, Beilage, «ohne Zwiebeln» oder ein Menü aus Vorspeise, Hauptgang und Dessert: Legen Sie eine Gruppe an (z. B. «Garstufe», Pflicht, eine Wahl), fügen Sie Optionen mit Aufpreis hinzu und ordnen Sie die Gruppe Artikeln zu. Ein Menü ist ein Artikel mit Pflichtgruppen.</p>
        {groups.map((g) => (
          <div key={g.id} className="card stack">
            <h3>{g.name} <span className="small muted">{g.required ? "Pflicht" : "optional"} · höchstens {g.maxChoices}</span></h3>
            <ul>{g.options.map((o) => (
              <li key={o.id}>{o.name}{o.priceRappen ? ` (+${formatChf(o.priceRappen)})` : ""}{o.active ? "" : " (aus)"}
                <form action={optionToggle} style={{ display: "inline" }}>{H}<input type="hidden" name="id" value={o.id} /><input type="hidden" name="active" value={o.active ? "0" : "1"} /> <button className="btn secondary small">{o.active ? "Ausblenden" : "Einblenden"}</button></form></li>
            ))}</ul>
            <form action={option} className="inline-form">{H}<input type="hidden" name="groupId" value={g.id} />
              <div><label htmlFor={`on-${g.id}`}>Neue Option</label><input id={`on-${g.id}`} name="name" required maxLength={60} /></div>
              <div><label htmlFor={`op-${g.id}`}>Aufpreis CHF</label><input id={`op-${g.id}`} name="price" inputMode="decimal" placeholder="0" /></div>
              <button className="btn secondary">Hinzufügen</button></form>
            <form action={groupItems} className="stack">{H}<input type="hidden" name="groupId" value={g.id} />
              <strong className="small">Gilt für</strong>
              <div className="opt-grid">{items.map((i) => <label key={i.id} className="opt-row"><input type="checkbox" name="itemId" value={i.id} defaultChecked={g.itemIds.includes(i.id)} /> {i.name}</label>)}</div>
              <div><button className="btn secondary small">Zuordnung speichern</button></div></form>
          </div>
        ))}
        <form action={group} className="stack">{H}
          <h3>Neue Gruppe</h3>
          <div><label htmlFor="gname">Name</label><input id="gname" name="name" required maxLength={60} placeholder="Garstufe, Beilage, Menü-Vorspeise …" /></div>
          <div><label htmlFor="gmax">Höchstens wählbar</label><input id="gmax" name="maxChoices" type="number" min={1} max={20} defaultValue={1} /></div>
          <FormSwitch name="required" defaultOn={false} label="Auswahl ist Pflicht" />
          <div><button className="btn">Gruppe anlegen</button></div>
        </form>
      </section>
      <form action={table} className="card stack">{H}<h2>Tische ({tables.length})</h2><div><label htmlFor="tname">Neuer Tisch</label><input id="tname" name="name" required maxLength={30} /></div><div><button className="btn secondary">Anlegen</button></div></form>
      {tables.length ? (
        <section className="card stack" id="tischplan" data-testid="table-plan">
          <h2>Tischplan</h2>
          <p className="small muted">Plätze und Form je Tisch festlegen, dann die Tische im Plan an ihren Ort ziehen. Der Plan erscheint bei «Restaurant» mit dem aktuellen Zustand (frei, offen, reserviert).</p>
          <div className="stack">
            {tables.map((t) => (
              <form key={t.id} action={tableDetails} className="inline-form">{H}<input type="hidden" name="id" value={t.id} />
                <strong style={{ minWidth: 90 }}>{t.name}</strong>
                <label htmlFor={`seats-${t.id}`} className="small">Plätze</label><input id={`seats-${t.id}`} name="seats" type="number" min={1} max={50} defaultValue={t.seats} style={{ width: 70 }} />
                <label htmlFor={`shape-${t.id}`} className="small">Form</label><select id={`shape-${t.id}`} name="shape" defaultValue={t.shape}><option value="square">eckig</option><option value="round">rund</option></select>
                <button className="btn secondary small">Speichern</button></form>
            ))}
          </div>
          <FloorPlan tables={tables.map((t) => ({ id: t.id, name: t.name, seats: t.seats, shape: t.shape, x: t.planX, y: t.planY }))} editable action={planSave} hotelId={hotel.id} />
        </section>
      ) : null}
      <form action={csvImport} className="card stack">{H}
        <h2>Per CSV importieren</h2>
        <p className="small muted">Speisekarte oder Tischliste aus Excel oder Ihrer bisherigen Kasse übernehmen. Alles oder nichts: Bei einem Fehler wird nichts gespeichert und die Zeile genannt. Was es schon gibt (gleicher Name), wird übersprungen.</p>
        <div className="inline-form">
          <div><label htmlFor="kind">Was</label><select id="kind" name="kind"><option value="items">Artikel</option><option value="tables">Tische</option></select></div>
          <div><label htmlFor="file">CSV-Datei</label><input id="file" name="file" type="file" accept=".csv,text/csv" required /></div>
          <button className="btn">Importieren</button>
        </div>
        <p className="small"><a href={`/mypontivo/${hotel.id}/restaurant/vorlage?kind=items`}>Vorlage Artikel (CSV)</a> · <a href={`/mypontivo/${hotel.id}/restaurant/vorlage?kind=tables`}>Vorlage Tische (CSV)</a></p>
      </form>
    </div>
  );
}
