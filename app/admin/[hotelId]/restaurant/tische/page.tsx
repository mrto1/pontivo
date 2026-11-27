import { Notice } from "@/components/admin/Notice";
import { DownloadLink } from "@/components/admin/DownloadLink";
import { TableEditor } from "@/components/admin/TableEditor";
import { requireHotelModule } from "@/src/auth/guard";
import { PosError, importTables, listTables, saveTable } from "@/src/services/pos";
import { deleteArea, deleteWaiter, listAreas, listPlanItems, listWaiters, saveArea, saveAreaLayout, saveWaiter } from "@/src/services/floorplan";
import { parsePosTables } from "@/src/domain/pos-import";
import { s } from "@/src/lib/form";
import { hotelAction, type ActionResult, type HotelCtx } from "@/src/lib/hotel-action";

export const dynamic = "force-dynamic";
/** Aktionen des Tischplans: Modul Restaurant, Manager */
const run = (f: FormData, fn: (c: HotelCtx) => Promise<ActionResult>, fail = "Nicht gespeichert") =>
  hotelAction(f, { page: "restaurant/tische", module: "restaurant", role: "manager", fail }, fn);

async function table(f: FormData) {
  "use server";
  await run(f, async (c) => { await saveTable(c.hotel.id, s(f, "name"), c.actor); return "Tisch angelegt."; }, "Nicht angelegt");
}
async function tablesSave(f: FormData) {
  "use server";
  await run(f, async (c) => {
    let raw: { tables: { id: string; areaId: string; waiterId?: string | null; online?: boolean; seats: number; shape: string; x: number | null; y: number | null }[]; items: { areaId: string; kind: string; label: string; x: number; y: number; w: number; h: number }[] };
    try { raw = JSON.parse(s(f, "layout")); } catch { throw new PosError("Eingabe ungültig."); }
    if (!raw || !Array.isArray(raw.tables) || !Array.isArray(raw.items)) throw new PosError("Eingabe ungültig.");
    const areas = await listAreas(c.hotel.id);
    for (const a of areas) {
      await saveAreaLayout(c.hotel.id, a.id,
        raw.tables.filter((t) => t.areaId === a.id).map((t) => ({ id: String(t.id), seats: Number(t.seats), waiterId: t.waiterId ? String(t.waiterId) : null, online: t.online !== false, shape: (t.shape === "round" ? "round" : t.shape === "rect" ? "rect" : "square") as "square" | "round" | "rect", x: t.x === null ? null : Number(t.x), y: t.y === null ? null : Number(t.y) })),
        raw.items.filter((i) => i.areaId === a.id).map((i) => ({ kind: i.kind as import("@/src/db/schema").PlanItemKind, label: String(i.label ?? ""), x: Number(i.x), y: Number(i.y), w: Number(i.w), h: Number(i.h) })),
        c.actor);
    }
    return "Tischplan gespeichert.";
  });
}
async function waiterSave(f: FormData) {
  "use server";
  const id = s(f, "waiterId") || null;
  await run(f, async (c) => { await saveWaiter(c.hotel.id, id, { name: s(f, "name"), color: s(f, "color") || undefined }, c.actor); return id ? "Kellner gespeichert." : "Kellner angelegt."; });
}
async function waiterDelete(f: FormData) {
  "use server";
  await run(f, async (c) => { await deleteWaiter(c.hotel.id, s(f, "waiterId"), c.actor); return "Kellner entfernt, seine Tische sind nicht mehr zugewiesen."; }, "Nicht gelöscht");
}
async function areaSave(f: FormData) {
  "use server";
  const id = s(f, "areaId") || null;
  await run(f, async (c) => { await saveArea(c.hotel.id, id, s(f, "name"), c.actor, f.get("online") === "on"); return id ? "Raum umbenannt." : "Raum angelegt."; });
}
async function areaDelete(f: FormData) {
  "use server";
  await run(f, async (c) => { await deleteArea(c.hotel.id, s(f, "areaId"), c.actor); return "Raum gelöscht. Die Tische sind im ersten Raum, ohne Platz im Plan."; }, "Nicht gelöscht");
}
async function csvTables(f: FormData) {
  "use server";
  await run(f, async (c) => {
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) throw new PosError("Bitte eine CSV-Datei wählen.");
    if (file.size > 1_000_000) throw new PosError("Die Datei ist zu gross (höchstens 1 MB).");
    const r = parsePosTables(await file.text());
    if (r.problems.length) throw new PosError(`${r.problems.length} Fehler, es wurde nichts gespeichert. ${r.problems.slice(0, 3).map((p) => `Zeile ${p.row}: ${p.message}`).join(" ")}`);
    const res = await importTables(c.hotel.id, r.names, c.actor);
    return `${res.created} Tische importiert${res.skipped ? `, ${res.skipped} übersprungen (gab es schon)` : ""}.`;
  }, "Nicht importiert");
}

/** Tischplan (SPEC 20.1, Zahnrad → Gastronomie): Tische anlegen, Plätze und Form, Plan, Import per CSV */
export default async function TablesSettingsPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("restaurant", hotelId, "manager");
  const [tables, areas, items, waiters] = await Promise.all([listTables(hotel.id), listAreas(hotel.id), listPlanItems(hotel.id), listWaiters(hotel.id)]);
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  return (
    <div className="stack">
      <h1>Tischplan</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <form action={table} className="card stack">{H}<h2>Tische ({tables.length})</h2><div><label htmlFor="tname">Neuer Tisch</label><input id="tname" name="name" required maxLength={30} /></div><div><button className="btn secondary">Anlegen</button></div></form>
      <section className="card stack" id="raeume" data-testid="areas">
        <h2>Räume ({areas.length})</h2>
        <p className="small muted">Jeder Raum (z. B. Hauptsaal, Terrasse) hat seinen eigenen Plan; im Tischplan schaltet man per Tab um. Nicht gespeicherte Änderungen am Plan zuerst speichern.</p>
        {areas.map((a) => (
          <form key={a.id} action={areaSave} className="inline-form">{H}<input type="hidden" name="areaId" value={a.id} />
            <div><label htmlFor={`an-${a.id}`}>Name</label><input id={`an-${a.id}`} name="name" defaultValue={a.name} required maxLength={40} /></div>
            <label className="te-plan"><input type="checkbox" name="online" defaultChecked={a.online} /><span className="small">Online buchbar</span></label>
            <button className="btn secondary small">Speichern</button>
            {areas.length > 1 ? <button className="btn secondary small" formAction={areaDelete}>Löschen</button> : null}
          </form>
        ))}
        <form action={areaSave} className="inline-form">{H}<div><label htmlFor="newarea">Neuer Raum</label><input id="newarea" name="name" required maxLength={40} placeholder="z. B. Terrasse" /></div><label className="te-plan"><input type="checkbox" name="online" defaultChecked /><span className="small">Online buchbar</span></label><button className="btn secondary small">Raum anlegen</button></form>
      </section>
      <section className="card stack" id="kellner" data-testid="waiters">
        <h2>Kellner ({waiters.length})</h2>
        <p className="small muted">Kellner bekommen Tische zugewiesen (im Plan unten, Spalte «Kellner»). Auf dem Plan erscheinen ihre Initialen in ihrer Farbe.</p>
        {waiters.map((w) => (
          <form key={w.id} action={waiterSave} className="inline-form">{H}<input type="hidden" name="waiterId" value={w.id} />
            <div><label htmlFor={`wn-${w.id}`}>Name</label><input id={`wn-${w.id}`} name="name" defaultValue={w.name} required maxLength={40} /></div>
            <div><label htmlFor={`wc-${w.id}`}>Farbe</label><input id={`wc-${w.id}`} name="color" type="color" defaultValue={w.color} /></div>
            <button className="btn secondary small">Speichern</button>
            <button className="btn secondary small" formAction={waiterDelete}>Entfernen</button>
          </form>
        ))}
        <form action={waiterSave} className="inline-form">{H}<div><label htmlFor="newwaiter">Neuer Kellner</label><input id="newwaiter" name="name" required maxLength={40} /></div><button className="btn secondary small">Kellner anlegen</button></form>
      </section>
      {tables.length ? (
        <section className="card stack" id="tischplan" data-testid="table-plan">
          <h2>Plätze, Form und Plan</h2>
          <p className="small muted">Plätze und Form je Tisch festlegen, dann die Tische im Plan an ihren Ort ziehen. Der Plan erscheint unter Reservationen → Tischplan mit dem aktuellen Zustand; mit der Kasse eröffnen Sie dort auch Bestellungen.</p>
          <TableEditor key={`${areas.length}-${tables.length}-${waiters.length}`} waiters={waiters.map((w) => ({ id: w.id, name: w.name, color: w.color }))} areas={areas.map((a) => ({ id: a.id, name: a.name }))} tables={tables.map((t) => ({ id: t.id, name: t.name, seats: t.seats, shape: t.shape, x: t.planX, y: t.planY, areaId: t.areaId ?? areas[0].id, waiterId: t.waiterId, online: t.online }))} items={items.filter((i) => areas.some((a) => a.id === i.areaId)).map((i) => ({ key: i.id, areaId: i.areaId, kind: i.kind, label: i.label, x: i.planX, y: i.planY, w: i.w, h: i.h }))} action={tablesSave} hotelId={hotel.id} />
        </section>
      ) : null}
      <form action={csvTables} className="card stack">{H}
        <h2>Tische per CSV importieren</h2>
        <div className="inline-form">
          <div><label htmlFor="tfile">CSV-Datei</label><input id="tfile" name="file" type="file" accept=".csv,text/csv" required /></div>
          <button className="btn secondary">Importieren</button>
        </div>
        <p className="small"><DownloadLink href={`/admin/${hotel.id}/restaurant/vorlage?kind=tables`}>Vorlage Tische (CSV)</DownloadLink></p>
      </form>
    </div>
  );
}
