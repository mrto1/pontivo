import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { PosError, importItems, listItems, listOptionGroups, saveItem, saveOption, saveOptionGroup, setGroupItems, setOptionActive } from "@/src/services/pos";
import { FormSwitch } from "@/components/admin/FormSwitch";
import { env } from "@/src/env";
import { LIMITS, setupImportGate } from "@/src/domain/setup-import";
import { priceToRappen, type MenuDraft } from "@/src/domain/menu-import";
import { SetupImportError, adoptMenu, discardImport, getImport, importMenuFromPdf, importMenuFromUrl, importsThisMonth, setupImportEnabled } from "@/src/services/setup-import";
import { formatChf } from "@/src/domain/money";
import { parsePosItems } from "@/src/domain/pos-import";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const here = (h: string, msg: string) => redirect(`/mypontivo/${h}/restaurant/artikel?msg=${encodeURIComponent(msg)}`);
const bps = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);

async function guard(f: FormData) {
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "restaurant");
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
const kiBack = (h: string, q: string): never => redirect(`/mypontivo/${h}/restaurant/artikel?${q}#ki`);
async function kiRun(f: FormData, fn: (c: Awaited<ReturnType<typeof guard>>) => Promise<string>) {
  const c = await guard(f);
  let target: string;
  try { target = await fn(c); } catch (e) {
    if (e instanceof SetupImportError || e instanceof PosError) return kiBack(c.hotel.id, `msg=${encodeURIComponent(`Nicht möglich: ${e.message}`)}`);
    throw e;
  }
  return kiBack(c.hotel.id, target);
}
async function menuUrl(f: FormData) {
  "use server";
  await kiRun(f, async (c) => `draft=${await importMenuFromUrl(c.hotel, s(f, "url"), c.actor)}`);
}
async function menuPdf(f: FormData) {
  "use server";
  await kiRun(f, async (c) => {
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) throw new SetupImportError("Bitte eine PDF-Datei wählen.");
    return `draft=${await importMenuFromPdf(c.hotel, new Uint8Array(await file.arrayBuffer()), file.name, c.actor)}`;
  });
}
async function menuAdopt(f: FormData) {
  "use server";
  await kiRun(f, async (c) => {
    const picks = f.getAll("pick").map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0).map((i) => ({ index: i, category: s(f, `cat_${i}`), name: s(f, `name_${i}`), priceRappen: priceToRappen(s(f, `price_${i}`)) ?? -1 }));
    if (picks.some((p) => p.priceRappen < 0)) throw new PosError("Ein Preis ist ungültig.");
    const r = await adoptMenu(c.hotel, s(f, "id"), picks, c.actor);
    return `msg=${encodeURIComponent(`${r.created} Artikel übernommen${r.skipped ? `, ${r.skipped} übersprungen (gab es schon)` : ""}. MWST-Sätze und Stationen bitte kurz prüfen.`)}`;
  });
}
async function menuDiscard(f: FormData) {
  "use server";
  await kiRun(f, async (c) => { await discardImport(c.hotel.id, s(f, "id"), c.actor); return `msg=${encodeURIComponent("Entwurf verworfen.")}`; });
}
async function csvImport(f: FormData) {
  "use server";
  const c = await guard(f);
  const file = f.get("file");
  if (!(file instanceof File) || !file.size) return here(c.hotel.id, "Nicht importiert: Bitte eine CSV-Datei wählen.");
  if (file.size > 1_000_000) return here(c.hotel.id, "Nicht importiert: Die Datei ist zu gross (höchstens 1 MB).");
  const text = await file.text();
  const r = parsePosItems(text);
  if (r.problems.length) {
    const first = r.problems.slice(0, 3).map((p) => `Zeile ${p.row}: ${p.message}`).join(" ");
    return here(c.hotel.id, `Nicht importiert (${r.problems.length} Fehler, es wurde nichts gespeichert). ${first}${r.problems.length > 3 ? " …" : ""}`);
  }
  const res = await importItems(c.hotel.id, r.rows, c.actor);
  here(c.hotel.id, `${res.created} Artikel importiert${res.skipped ? `, ${res.skipped} übersprungen (gab es schon)` : ""}.`);
}

export default async function PosItemsPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager");
  await requireModule(hotel.id, "restaurant");
  const [items, groups] = await Promise.all([listItems(hotel.id), listOptionGroups(hotel.id)]);
  const gate = setupImportGate(hotel, setupImportEnabled());
  const runsLeft = Math.max(0, env().SETUP_RUNS_PER_MONTH - (await importsThisMonth(hotel.id, new Date(), "menu")));
  const open = sp.draft ? await getImport(hotel.id, sp.draft) : null;
  const menu = open && open.purpose === "menu" && open.status === "draft" ? (open.draft as unknown as MenuDraft) : null;
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  return (
    <div className="stack">
      <h1>Speisekarte</h1>
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
      <section className="card stack" id="ki" data-testid="menu-ki">
        <h2>Speisekarte mit KI einlesen</h2>
        <p className="small muted">Die KI liest Ihre Speisekarte (Website oder PDF) und macht daraus einen <strong>Entwurf</strong> der Artikel mit Preisen. Sie prüfen und ändern ihn, erst dann wird übernommen. Die MWST-Sätze setzt die KI nicht: es gelten die Standardsätze, die Sie danach prüfen.</p>
        {!gate.ok ? <p className="notice warn">{gate.reason}</p> : menu ? (
          <form action={menuAdopt} className="stack" data-testid="menu-draft">
            {H}<input type="hidden" name="id" value={open!.id} />
            <p className="small">{menu.items.length} Artikel gefunden. Häkchen weg = nicht übernehmen; Name, Kategorie und Preis (CHF) können Sie ändern.</p>
            <table className="table"><thead><tr><th /><th>Kategorie</th><th>Name</th><th>Preis CHF</th></tr></thead><tbody>
              {menu.items.map((x, i) => (
                <tr key={i}><td><input type="checkbox" name="pick" value={i} defaultChecked aria-label={`${x.name} übernehmen`} /></td>
                  <td><input name={`cat_${i}`} defaultValue={x.category} maxLength={60} aria-label={`Kategorie ${x.name}`} /></td>
                  <td><input name={`name_${i}`} defaultValue={x.name} maxLength={120} aria-label={`Name ${x.name}`} />{x.description ? <div className="small muted">{x.description}</div> : null}</td>
                  <td><input name={`price_${i}`} defaultValue={(x.priceRappen / 100).toFixed(2)} inputMode="decimal" style={{ width: 90 }} aria-label={`Preis ${x.name}`} /></td></tr>
              ))}
            </tbody></table>
            <div><button className="btn">Ausgewählte übernehmen</button></div>
          </form>
        ) : (
          <>
            <p className="small muted">Noch {runsLeft} von {env().SETUP_RUNS_PER_MONTH} Läufen in diesem Monat. Höchstens {LIMITS.maxPages} Seiten Ihrer Website bzw. ein PDF bis {LIMITS.pdfBytes / 1_000_000} MB und {LIMITS.pdfPages} Seiten. Bitte nur eigene Speisekarten verwenden. Der gelesene Text wird nicht gespeichert, nur der Entwurf.</p>
            <div className="row">
              <form action={menuUrl} className="stack" style={{ flex: 1 }}>{H}<div><label htmlFor="murl">Adresse der Speisekarte (https://…)</label><input id="murl" name="url" type="url" required placeholder="https://www.mein-restaurant.ch/speisekarte" /></div><div><button className="btn" disabled={runsLeft === 0}>Von der Website lesen</button></div></form>
              <form action={menuPdf} className="stack" style={{ flex: 1 }} encType="multipart/form-data">{H}<div><label htmlFor="mpdf">PDF der Speisekarte</label><input id="mpdf" name="file" type="file" accept="application/pdf" required /></div><div><button className="btn" disabled={runsLeft === 0}>Aus dem PDF lesen</button></div></form>
            </div>
          </>
        )}
        {menu ? <form action={menuDiscard}>{H}<input type="hidden" name="id" value={open!.id} /><button className="btn secondary small">Entwurf verwerfen</button></form> : null}
      </section>
      <form action={csvImport} className="card stack">{H}
        <h2>Per CSV importieren</h2>
        <p className="small muted">Speisekarte aus Excel oder Ihrer bisherigen Kasse übernehmen. Alles oder nichts: Bei einem Fehler wird nichts gespeichert und die Zeile genannt. Was es schon gibt (gleicher Name), wird übersprungen.</p>
        <div className="inline-form">
          <div><label htmlFor="file">CSV-Datei</label><input id="file" name="file" type="file" accept=".csv,text/csv" required /></div>
          <button className="btn">Importieren</button>
        </div>
        <p className="small"><a href={`/mypontivo/${hotel.id}/restaurant/vorlage?kind=items`}>Vorlage Artikel (CSV)</a></p>
      </form>
    </div>
  );
}
