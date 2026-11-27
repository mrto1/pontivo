import { Notice } from "@/components/admin/Notice";
import { FormSwitch } from "@/components/admin/FormSwitch";
import { requireHotelModule } from "@/src/auth/guard";
import { getSettings, saveSettings, saveSmsReminder } from "@/src/services/reservations";
import { smsConfigured } from "@/src/integrations/sms/aspsms";
import { billableSmsCount } from "@/src/services/sms";
import { env } from "@/src/env";
import { formatChf } from "@/src/domain/money";
import { todayIn } from "@/src/domain/dates";
import { publicBase } from "@/src/services/brand";
import QRCode from "qrcode";
import { s } from "@/src/lib/form";
import { hotelAction, type HotelCtx } from "@/src/lib/hotel-action";

export const dynamic = "force-dynamic";
const run = (f: FormData, fn: (c: HotelCtx) => Promise<string>, anchor = "") =>
  hotelAction(f, { page: "restaurant/einstellungen", module: "restaurant", role: "manager", fail: "Einstellungen nicht gespeichert", anchor }, fn);

async function settings(f: FormData) {
  "use server";
  const windows = [1, 2].flatMap((n) => (s(f, `from${n}`) && s(f, `to${n}`) ? [{ from: s(f, `from${n}`), to: s(f, `to${n}`) }] : []));
  await run(f, async (c) => {
    await saveSettings(c.hotel.id, { onlineEnabled: f.get("onlineEnabled") === "on", windows, durationMin: Number(s(f, "durationMin")), depositPerPersonRappen: Math.round(Number((s(f, "deposit") || "0").replace(",", ".")) * 100), depositFromParty: Number(s(f, "depositFromParty") || 1), cancelHours: Number(s(f, "cancelHours") || 0), reminderHours: Number(s(f, "reminderHours") || 0), autoAssign: f.get("autoAssign") === "on", preorderEnabled: f.get("preorderEnabled") === "on", combineTables: f.get("combineTables") === "on", slotMaxGuests: Math.max(0, Math.floor(Number(s(f, "slotMaxGuests") || 0))), halfboardEnabled: f.get("halfboardEnabled") === "on", halfboardTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(s(f, "halfboardTime")) ? s(f, "halfboardTime") : "19:00", preorderLeadMin: Math.min(240, Math.max(0, Math.floor(Number(s(f, "preorderLeadMin") || 0)))), preorderRequiredFrom: Math.max(0, Math.floor(Number(s(f, "preorderRequiredFrom") || 0))), maxParty: Number(s(f, "maxParty")), capacity: Number(s(f, "capacity")), leadHours: Number(s(f, "leadHours")), horizonDays: Number(s(f, "horizonDays")) }, c.actor);
    return "Einstellungen gespeichert.";
  });
}

async function smsSave(f: FormData) {
  "use server";
  await run(f, async (c) => {
    const on = f.get("smsReminder") === "on";
    await saveSmsReminder(c.hotel.id, { on, hours: Number(s(f, "smsHours") || 3), acceptCosts: f.get("acceptCosts") === "on" }, c.actor);
    return on ? "SMS-Erinnerung eingeschaltet." : "SMS-Erinnerung ausgeschaltet.";
  }, "#sms");
}

/** Reservation (SPEC 20.1, Zahnrad → Gastronomie): Einstellungen der Online-Reservation. Tische und Plan: Seite «Tischplan» (restaurant/tische) */
export default async function RestaurantSettingsPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotelModule("restaurant", hotelId, "manager");
  const cfg = await getSettings(hotel.id);
  const smsPrice = env().SMS_GUEST_PRICE_RAPPEN;
  const smsMonth = await billableSmsCount(hotel.id, todayIn("Europe/Zurich").slice(0, 7));
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  const publicUrl = `${publicBase(hotel)}/${hotel.defaultLanguage}/tisch`;
  const qr = cfg.onlineEnabled ? await QRCode.toDataURL(publicUrl, { margin: 1, width: 180 }) : null;
  return (
    <div className="stack">
      <h1>Reservation</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
        <form action={settings} className="card stack" id="online">
          {H}
          <h2>Online-Reservation für Gäste</h2>
          <FormSwitch name="onlineEnabled" defaultOn={cfg.onlineEnabled} label="Gäste können online reservieren" hint={<>Formular unter <a href={publicUrl}>{publicUrl}</a> (der Knopf «Tisch reservieren» auf Ihrer Website führt dorthin).</>} />
          {qr ? <div className="inline-form"><img src={qr} alt="QR-Code zur Tischreservation" width={120} height={120} /><span className="small muted">QR-Code für Tischkarten, Schaufenster oder Flyer (Rechtsklick → Bild speichern).</span></div> : null}
          <h3>Zeiten und Plätze</h3>
          <p className="small muted">Zeitfenster, in denen Gäste einen Tisch beginnen können (im Raster von 30 Minuten):</p>
          <div className="inline-form">
            {[1, 2].map((n) => { const w = cfg.windows[n - 1]; return (
              <div key={n} className="inline-form"><label htmlFor={`from${n}`}>Fenster {n} von</label><input id={`from${n}`} name={`from${n}`} type="time" defaultValue={w?.from ?? ""} /><label htmlFor={`to${n}`}>bis</label><input id={`to${n}`} name={`to${n}`} type="time" defaultValue={w?.to ?? ""} /></div>
            ); })}
          </div>
          <div className="inline-form">
            <div><label htmlFor="durationMin">Dauer (Min.)</label><input id="durationMin" name="durationMin" type="number" min={30} max={480} defaultValue={cfg.durationMin} className="w90" /></div>
            <div><label htmlFor="capacity">Plätze online</label><input id="capacity" name="capacity" type="number" min={1} max={1000} defaultValue={cfg.capacity} className="w90" /></div>
            <div><label htmlFor="maxParty">Grösste Gruppe</label><input id="maxParty" name="maxParty" type="number" min={1} max={50} defaultValue={cfg.maxParty} className="w90" /></div>
            <div><label htmlFor="leadHours">Vorlauf (Std.)</label><input id="leadHours" name="leadHours" type="number" min={0} max={168} defaultValue={cfg.leadHours} className="w90" /></div>
            <div><label htmlFor="horizonDays">Vorschau (Tage)</label><input id="horizonDays" name="horizonDays" type="number" min={1} max={365} defaultValue={cfg.horizonDays} className="w90" /></div>
          </div>
          <div><label htmlFor="slotMaxGuests">Küchentakt: höchstens Gäste je Beginnzeit online (0 = ohne Grenze)</label><input id="slotMaxGuests" name="slotMaxGuests" type="number" min={0} max={1000} defaultValue={cfg.slotMaxGuests ?? 0} className="w90" /><p className="small muted m0">Verteilt die Ankünfte, damit nicht alle Gäste gleichzeitig kommen und die Küche nicht überlastet ist.</p></div>
          <h3>Tische</h3>
          <FormSwitch name="autoAssign" defaultOn={cfg.autoAssign} label="Tisch automatisch zuteilen" hint="Der kleinste freie Tisch mit genug Plätzen." />
          <FormSwitch name="combineTables" defaultOn={!!cfg.combineTables} label="Tische zusammenlegen" hint="Passt keine Gruppe an einen Tisch, werden bis zu 4 freie, nahe Tische im selben Raum zusammengelegt. Von Hand geht es immer (zweiter Tisch in der Reservationsliste)." />
          <h3>Vorbestellung</h3>
          <FormSwitch name="preorderEnabled" defaultOn={!!cfg.preorderEnabled} label="Vorbestellung zulassen" hint="Gäste wählen bei der Online-Reservation schon Gerichte und bezahlen sie vorab (nur mit Stripe). Beim Platzieren des Gastes erscheint die Bestellung am Tisch, und der Betrag ist als Bon gebucht. Angeboten werden alle Artikel, die «online» bestellbar sind, auch mit Optionen wie Garstufe. Die Vorbestellung ersetzt die Anzahlung." />
          <div><label htmlFor="preorderRequiredFrom">Vorbestellung Pflicht ab Personen (0 = nie)</label><input id="preorderRequiredFrom" name="preorderRequiredFrom" type="number" min={0} max={50} defaultValue={cfg.preorderRequiredFrom ?? 0} className="w90" /></div>
          <div><label htmlFor="preorderLeadMin">Küchenvorlauf: Vorbestellung erscheint so viele Minuten vor Ankunft in der Küche (0 = erst beim Platzieren)</label><input id="preorderLeadMin" name="preorderLeadMin" type="number" min={0} max={240} defaultValue={cfg.preorderLeadMin ?? 0} className="w90" /><p className="small muted m0">Nur mit zugewiesenem Tisch und bezahlter Vorbestellung. Die Küche sieht die Zeilen mit Optionen (z. B. Garstufe).</p></div>
          <h3>Anzahlung, Storno und Erinnerung</h3>
          <div className="inline-form">
            <div><label htmlFor="deposit">Anzahlung je Person CHF (0 = keine)</label><input id="deposit" name="deposit" inputMode="decimal" defaultValue={(cfg.depositPerPersonRappen / 100).toString()} className="w90" /></div>
            <div><label htmlFor="depositFromParty">ab Personen</label><input id="depositFromParty" name="depositFromParty" type="number" min={1} max={50} defaultValue={cfg.depositFromParty} className="w90" /></div>
            <div><label htmlFor="cancelHours">Gratis stornieren bis (Std. vorher)</label><input id="cancelHours" name="cancelHours" type="number" min={0} max={168} defaultValue={cfg.cancelHours} className="w90" /></div>
            <div><label htmlFor="reminderHours">Erinnerung (Std. vorher, 0 = aus)</label><input id="reminderHours" name="reminderHours" type="number" min={0} max={72} defaultValue={cfg.reminderHours} className="w90" /></div>
          </div>
          <p className="small muted">Die Anzahlung wird online über Stripe bezahlt (Ihr verbundenes Konto, keine Plattformgebühr) und bei rechtzeitiger Stornierung zurückerstattet. Sie gilt erst, wenn Stripe Ihr Konto freigegeben hat; bis dahin wird ohne Anzahlung reserviert. Storniert der Betrieb, kommt sie immer zurück; bei «nicht erschienen» bleibt sie. Den bezahlten Betrag ziehen Sie bei der Rechnung ab.</p>
          {hotel.propertyType !== "restaurant" ? <>
            <h3>Hotelgäste</h3>
            <FormSwitch name="halfboardEnabled" defaultOn={!!cfg.halfboardEnabled} label="Halbpension mit Tisch" hint="Hotelgäste mit Halbpension oder Vollpension (Tarif) bekommen für jede Nacht automatisch eine Reservation mit Tisch. Das Personal sieht sie im Plan und in der Liste und kann Zeit und Tisch ändern." />
            <div><label htmlFor="halfboardTime">Uhrzeit Abendessen (Halbpension)</label><input id="halfboardTime" name="halfboardTime" type="time" defaultValue={cfg.halfboardTime ?? "19:00"} className="w90" /></div>
          </> : null}
          <div><button className="btn">Speichern</button></div>
        </form>
        <form action={smsSave} className="card stack" id="sms" data-testid="sms-reminder">{H}
          <h2 className="m0">SMS-Erinnerung</h2>
          <p className="muted small m0">Gäste mit Handynummer bekommen vor der Reservation eine SMS mit Link zum Absagen oder Ändern. Das senkt die Zahl der Gäste, die nicht erscheinen. Die E-Mail-Erinnerung oben bleibt unabhängig davon.</p>
          <FormSwitch name="smsReminder" defaultOn={!!cfg.smsReminder} label="SMS-Erinnerung senden" hint={`Kosten: ${formatChf(smsPrice)} je SMS (Selbstkosten), auf Ihrer Monatsrechnung von Pontivo. Diesen Monat: ${smsMonth} SMS an Gäste (${formatChf(smsMonth * smsPrice)}).`} />
          <div><label htmlFor="smsHours">Zeitpunkt (Stunden vor Beginn)</label><input id="smsHours" name="smsHours" type="number" min={1} max={48} defaultValue={cfg.smsReminderHours ?? 3} className="w90" /></div>
          {cfg.smsReminderAcceptedAt ? <p className="small muted m0">Kosten bestätigt am {cfg.smsReminderAcceptedAt.toLocaleDateString("de-CH")}.</p> : (
            <label className="check"><input type="checkbox" name="acceptCosts" />Ich bin einverstanden, dass jede gesendete SMS mit {formatChf(smsPrice)} auf der Monatsrechnung erscheint.</label>
          )}
          {!smsConfigured() ? <p className="notice warn small m0">Der SMS-Versand ist bei Pontivo noch nicht eingerichtet. Bis dahin wird nichts gesendet und nichts verrechnet.</p> : null}
          <div><button className="btn">Speichern</button></div>
        </form>
    </div>
  );
}
