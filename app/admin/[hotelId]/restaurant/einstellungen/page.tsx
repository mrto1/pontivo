import { Notice } from "@/components/admin/Notice";
import { FormSwitch } from "@/components/admin/FormSwitch";
import { FloorPlan } from "@/components/admin/FloorPlan";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { PosError, importTables, listTables, saveTable, saveTableDetails, saveTablePlan } from "@/src/services/pos";
import { getSettings, saveSettings } from "@/src/services/reservations";
import { parsePosTables } from "@/src/domain/pos-import";
import { publicBase } from "@/src/services/brand";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const here = (h: string, msg: string) => redirect(`/admin/${h}/restaurant/einstellungen?msg=${encodeURIComponent(msg)}`);

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
async function settings(f: FormData) {
  "use server";
  const c = await guard(f);
  const windows = [1, 2].flatMap((n) => (s(f, `from${n}`) && s(f, `to${n}`) ? [{ from: s(f, `from${n}`), to: s(f, `to${n}`) }] : []));
  try {
    await saveSettings(c.hotel.id, { onlineEnabled: f.get("onlineEnabled") === "on", windows, durationMin: Number(s(f, "durationMin")), depositPerPersonRappen: Math.round(Number((s(f, "deposit") || "0").replace(",", ".")) * 100), depositFromParty: Number(s(f, "depositFromParty") || 1), cancelHours: Number(s(f, "cancelHours") || 0), reminderHours: Number(s(f, "reminderHours") || 0), autoAssign: f.get("autoAssign") === "on", maxParty: Number(s(f, "maxParty")), capacity: Number(s(f, "capacity")), leadHours: Number(s(f, "leadHours")), horizonDays: Number(s(f, "horizonDays")) }, c.actor);
  } catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, `Einstellungen nicht gespeichert: ${e.message}`); }
  here(c.hotel.id, "Einstellungen gespeichert.");
}

/** Tischplan & Reservierung online (SPEC 20.1, Zahnrad → Gastronomie): Tische, Plätze, Plan, Einstellungen der Online-Reservierung */
export default async function RestaurantSettingsPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager");
  await requireModule(hotel.id, "restaurant");
  const [tables, cfg] = await Promise.all([listTables(hotel.id), getSettings(hotel.id)]);
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  const publicUrl = `${publicBase(hotel)}/${hotel.defaultLanguage}/tisch`;
  const qr = cfg.onlineEnabled ? await QRCode.toDataURL(publicUrl, { margin: 1, width: 180 }) : null;
  return (
    <div className="stack">
      <h1>Tischplan & Reservierung online</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <form action={table} className="card stack">{H}<h2>Tische ({tables.length})</h2><div><label htmlFor="tname">Neuer Tisch</label><input id="tname" name="name" required maxLength={30} /></div><div><button className="btn secondary">Anlegen</button></div></form>
      {tables.length ? (
        <section className="card stack" id="tischplan" data-testid="table-plan">
          <h2>Tischplan</h2>
          <p className="small muted">Plätze und Form je Tisch festlegen, dann die Tische im Plan an ihren Ort ziehen. Der Plan erscheint unter Reservierungen → Tischplan (und bei «Tische» mit der Kasse) mit dem aktuellen Zustand.</p>
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
      <form action={csvTables} className="card stack">{H}
        <h2>Tische per CSV importieren</h2>
        <div className="inline-form">
          <div><label htmlFor="tfile">CSV-Datei</label><input id="tfile" name="file" type="file" accept=".csv,text/csv" required /></div>
          <button className="btn secondary">Importieren</button>
        </div>
        <p className="small"><a href={`/admin/${hotel.id}/restaurant/vorlage?kind=tables`}>Vorlage Tische (CSV)</a></p>
      </form>
        <form action={settings} className="card stack" id="online">
          {H}
          <h2>Online-Reservierung für Gäste</h2>
          <FormSwitch name="onlineEnabled" defaultOn={cfg.onlineEnabled} label="Gäste können online reservieren" hint={<>Formular unter <a href={publicUrl}>{publicUrl}</a> (der Knopf «Tisch reservieren» auf Ihrer Website führt dorthin).</>} />
          {qr ? <div className="inline-form"><img src={qr} alt="QR-Code zur Tischreservierung" width={120} height={120} /><span className="small muted">QR-Code für Tischkarten, Schaufenster oder Flyer (Rechtsklick → Bild speichern).</span></div> : null}
          <p className="small muted">Zeitfenster, in denen Gäste einen Tisch beginnen können (im Raster von 30 Minuten):</p>
          <div className="inline-form">
            {[1, 2].map((n) => { const w = cfg.windows[n - 1]; return (
              <div key={n} className="inline-form"><label htmlFor={`from${n}`}>Fenster {n} von</label><input id={`from${n}`} name={`from${n}`} type="time" defaultValue={w?.from ?? ""} /><label htmlFor={`to${n}`}>bis</label><input id={`to${n}`} name={`to${n}`} type="time" defaultValue={w?.to ?? ""} /></div>
            ); })}
          </div>
          <div className="inline-form">
            <div><label htmlFor="durationMin">Dauer (Min.)</label><input id="durationMin" name="durationMin" type="number" min={30} max={480} defaultValue={cfg.durationMin} style={{ width: 90 }} /></div>
            <div><label htmlFor="capacity">Plätze online</label><input id="capacity" name="capacity" type="number" min={1} max={1000} defaultValue={cfg.capacity} style={{ width: 90 }} /></div>
            <div><label htmlFor="maxParty">Grösste Gruppe</label><input id="maxParty" name="maxParty" type="number" min={1} max={50} defaultValue={cfg.maxParty} style={{ width: 90 }} /></div>
            <div><label htmlFor="leadHours">Vorlauf (Std.)</label><input id="leadHours" name="leadHours" type="number" min={0} max={168} defaultValue={cfg.leadHours} style={{ width: 90 }} /></div>
            <div><label htmlFor="horizonDays">Vorschau (Tage)</label><input id="horizonDays" name="horizonDays" type="number" min={1} max={365} defaultValue={cfg.horizonDays} style={{ width: 90 }} /></div>
          </div>
          <FormSwitch name="autoAssign" defaultOn={cfg.autoAssign} label="Tisch automatisch zuteilen" hint="Der kleinste freie Tisch mit genug Plätzen. Kein Zusammenstellen mehrerer Tische." />
          <div className="inline-form">
            <div><label htmlFor="deposit">Anzahlung je Person CHF (0 = keine)</label><input id="deposit" name="deposit" inputMode="decimal" defaultValue={(cfg.depositPerPersonRappen / 100).toString()} style={{ width: 90 }} /></div>
            <div><label htmlFor="depositFromParty">ab Personen</label><input id="depositFromParty" name="depositFromParty" type="number" min={1} max={50} defaultValue={cfg.depositFromParty} style={{ width: 90 }} /></div>
            <div><label htmlFor="cancelHours">Gratis stornieren bis (Std. vorher)</label><input id="cancelHours" name="cancelHours" type="number" min={0} max={168} defaultValue={cfg.cancelHours} style={{ width: 90 }} /></div>
            <div><label htmlFor="reminderHours">Erinnerung (Std. vorher, 0 = aus)</label><input id="reminderHours" name="reminderHours" type="number" min={0} max={72} defaultValue={cfg.reminderHours} style={{ width: 90 }} /></div>
          </div>
          <p className="small muted">Die Anzahlung wird online über Stripe bezahlt (Ihr verbundenes Konto, keine Plattformgebühr) und bei rechtzeitiger Stornierung zurückerstattet. Sie gilt erst, wenn Stripe Ihr Konto freigegeben hat; bis dahin wird ohne Anzahlung reserviert. Storniert der Betrieb, kommt sie immer zurück; bei «nicht erschienen» bleibt sie. Den bezahlten Betrag ziehen Sie bei der Rechnung ab.</p>
          <div><button className="btn">Speichern</button></div>
        </form>
    </div>
  );
}
