import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { PosError, importItems, importTables, listItems, listTables, saveItem, saveTable } from "@/src/services/pos";
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
    await saveItem(c.hotel.id, s(f, "id") || null, { category: s(f, "category"), name: s(f, "name"), priceRappen: Math.round(Number(s(f, "price").replace(",", ".")) * 100), vatDineInBps: bps(s(f, "vatDineIn")), vatTakeawayBps: bps(s(f, "vatTakeaway")), dailySpecial: f.get("dailySpecial") === "on", active: f.get("active") !== "off" }, c.actor);
  } catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, `Nicht gespeichert: ${e.message}`); }
  here(c.hotel.id, "Gespeichert.");
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
  const [items, tables] = await Promise.all([listItems(hotel.id), listTables(hotel.id)]);
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
        <div><label><input type="checkbox" name="dailySpecial" /> Tagesangebot</label></div>
        <div><button className="btn">Speichern</button></div>
        <p className="small muted">Die Sätze legt Ihr Treuhänder fest. Hotelzimmer-Posten beim Restaurant: Getränke und Speisen im Haus 8,1 %, Take-away 2,6 % (Stand der Standardsätze; bitte prüfen).</p>
      </form>
      <section className="card">
        <h2>Artikel</h2>
        {items.length ? <table className="table"><thead><tr><th>Name</th><th>Preis</th><th>Haus</th><th>Take-away</th><th /></tr></thead><tbody>
          {items.map((i) => <tr key={i.id}><td>{i.category ? `${i.category}: ` : ""}{i.name}{i.dailySpecial ? " ★" : ""}{i.active ? "" : " (aus)"}</td><td>{formatChf(i.priceRappen)}</td><td>{(i.vatDineInBps / 100).toFixed(1)} %</td><td>{(i.vatTakeawayBps / 100).toFixed(1)} %</td>
            <td><form action={toggle}>{H}<input type="hidden" name="id" value={i.id} /><button className="btn secondary small">{i.active ? "Ausblenden" : "Einblenden"}</button></form></td></tr>)}
        </tbody></table> : <p className="muted">Noch kein Artikel.</p>}
      </section>
      <form action={table} className="card stack">{H}<h2>Tische ({tables.length})</h2><p className="small muted">{tables.map((t) => t.name).join(", ")}</p><div><label>Neuer Tisch</label><input name="name" required maxLength={30} /></div><div><button className="btn secondary">Anlegen</button></div></form>
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
