import { Notice } from "@/components/admin/Notice";
import { FormSwitch } from "@/components/admin/FormSwitch";
import { redirect } from "next/navigation";
import { requireHotel, requireHotelModule } from "@/src/auth/guard";
import { PosError } from "@/src/services/pos";
import { getSettings, saveSettings } from "@/src/services/reservations";
import { publicBase } from "@/src/services/brand";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const here = (h: string, msg: string) => redirect(`/admin/${h}/restaurant/einstellungen?msg=${encodeURIComponent(msg)}`);

async function guard(f: FormData) {
  const c = await requireHotelModule("restaurant", s(f, "hotelId"), "manager");
  return c;
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

/** Reservierung (SPEC 20.1, Zahnrad → Gastronomie): Einstellungen der Online-Reservierung. Tische und Plan: Seite «Tischplan» (restaurant/tische) */
export default async function RestaurantSettingsPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("restaurant", hotelId, "manager");
  const cfg = await getSettings(hotel.id);
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  const publicUrl = `${publicBase(hotel)}/${hotel.defaultLanguage}/tisch`;
  const qr = cfg.onlineEnabled ? await QRCode.toDataURL(publicUrl, { margin: 1, width: 180 }) : null;
  return (
    <div className="stack">
      <h1>Reservierung</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
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
