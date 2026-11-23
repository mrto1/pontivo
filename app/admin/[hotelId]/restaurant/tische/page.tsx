import { Notice } from "@/components/admin/Notice";
import { DownloadLink } from "@/components/admin/DownloadLink";
import { TableEditor } from "@/components/admin/TableEditor";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { PosError, importTables, listTables, saveTable, saveTableDetails, saveTablePlan } from "@/src/services/pos";
import { parsePosTables } from "@/src/domain/pos-import";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const here = (h: string, msg: string) => redirect(`/admin/${h}/restaurant/tische?msg=${encodeURIComponent(msg)}`);

async function guard(f: FormData) {
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "restaurant");
  return c;
}
async function table(f: FormData) {
  "use server";
  const c = await guard(f);
  try { await saveTable(c.hotel.id, s(f, "name"), c.actor); } catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, `Nicht angelegt: ${e.message}`); }
  here(c.hotel.id, "Tisch angelegt.");
}
async function tablesSave(f: FormData) {
  "use server";
  const c = await guard(f);
  try {
    const raw = JSON.parse(s(f, "tables")) as { id: string; seats: number; shape: string; x: number | null; y: number | null }[];
    if (!Array.isArray(raw)) throw new PosError("Eingabe ungültig.");
    for (const t of raw) await saveTableDetails(c.hotel.id, String(t.id), { seats: Number(t.seats), shape: t.shape === "round" ? "round" : "square" }, c.actor);
    await saveTablePlan(c.hotel.id, raw.map((p) => ({ id: String(p.id), x: p.x === null ? null : Number(p.x), y: p.y === null ? null : Number(p.y) })), c.actor);
  } catch (e) { if (!(e instanceof PosError) && !(e instanceof SyntaxError)) throw e; here(c.hotel.id, `Nicht gespeichert: ${e instanceof PosError ? e.message : "Eingabe ungültig."}`); }
  here(c.hotel.id, "Tische gespeichert.");
}
async function csvTables(f: FormData) {
  "use server";
  const c = await guard(f);
  const file = f.get("file");
  if (!(file instanceof File) || !file.size) return here(c.hotel.id, "Nicht importiert: Bitte eine CSV-Datei wählen.");
  if (file.size > 1_000_000) return here(c.hotel.id, "Nicht importiert: Die Datei ist zu gross (höchstens 1 MB).");
  const r = parsePosTables(await file.text());
  if (r.problems.length) return here(c.hotel.id, `Nicht importiert (${r.problems.length} Fehler, es wurde nichts gespeichert). ${r.problems.slice(0, 3).map((p) => `Zeile ${p.row}: ${p.message}`).join(" ")}`);
  const res = await importTables(c.hotel.id, r.names, c.actor);
  here(c.hotel.id, `${res.created} Tische importiert${res.skipped ? `, ${res.skipped} übersprungen (gab es schon)` : ""}.`);
}

/** Tischplan (SPEC 20.1, Zahnrad → Gastronomie): Tische anlegen, Plätze und Form, Plan, Import per CSV */
export default async function TablesSettingsPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager");
  await requireModule(hotel.id, "restaurant");
  const tables = await listTables(hotel.id);
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  return (
    <div className="stack">
      <h1>Tischplan</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <form action={table} className="card stack">{H}<h2>Tische ({tables.length})</h2><div><label htmlFor="tname">Neuer Tisch</label><input id="tname" name="name" required maxLength={30} /></div><div><button className="btn secondary">Anlegen</button></div></form>
      {tables.length ? (
        <section className="card stack" id="tischplan" data-testid="table-plan">
          <h2>Plätze, Form und Plan</h2>
          <p className="small muted">Plätze und Form je Tisch festlegen, dann die Tische im Plan an ihren Ort ziehen. Der Plan erscheint unter Reservierungen → Tischplan (und bei «Tische» mit der Kasse) mit dem aktuellen Zustand.</p>
          <TableEditor tables={tables.map((t) => ({ id: t.id, name: t.name, seats: t.seats, shape: t.shape, x: t.planX, y: t.planY }))} action={tablesSave} hotelId={hotel.id} />
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
