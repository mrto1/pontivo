import { Notice } from "@/components/admin/Notice";
import { FormSwitch } from "@/components/admin/FormSwitch";
import { CopyBox } from "@/components/admin/CopyBox";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { requireHotel } from "@/src/auth/guard";
import { requireModule } from "@/src/services/modules";
import { PosError } from "@/src/services/pos";
import { listZones, orderReadiness, orderSettings, publicUrl, saveOrderSettings, saveZone, screensOf, setOrdersEnabled, startTestOrder } from "@/src/services/online-orders";
import { parsePostalCodes } from "@/src/domain/online-order";
import { formatChf } from "@/src/domain/money";

export const dynamic = "force-dynamic";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const chf = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);
const here = (h: string, msg: string): never => redirect(`/mypontivo/${h}/restaurant/bestellung-einstellungen?msg=${encodeURIComponent(msg)}`);

async function guard(f: FormData) {
  const c = await requireHotel(s(f, "hotelId"), "manager");
  await requireModule(c.hotel.id, "restaurant");
  return c;
}
async function run(f: FormData, fn: (c: Awaited<ReturnType<typeof guard>>) => Promise<string>) {
  const c = await guard(f);
  let msg: string;
  try { msg = await fn(c); } catch (e) { if (!(e instanceof PosError)) throw e; return here(c.hotel.id, `Nicht möglich: ${e.message}`); }
  here(c.hotel.id, msg);
}
async function settings(f: FormData) {
  "use server";
  await run(f, async (c) => {
    await saveOrderSettings(c.hotel.id, {
      pickup: f.get("pickup") === "on", delivery: f.get("delivery") === "on", slotMinutes: Number(s(f, "slotMinutes")), maxPerSlot: Number(s(f, "maxPerSlot")), deliveryPerSlot: Number(s(f, "deliveryPerSlot")),
      leadMin: Number(s(f, "leadMin")), cutoffMin: Number(s(f, "cutoffMin")), cashPickup: f.get("cashPickup") === "on", cashDelivery: f.get("cashDelivery") === "on",
      cashMaxRappen: s(f, "cashMax") ? chf(s(f, "cashMax")) : null, guestSms: f.get("guestSms") === "on",
    }, c.actor);
    return "Gespeichert.";
  });
}
async function zone(f: FormData) {
  "use server";
  await run(f, async (c) => {
    const codes = parsePostalCodes(s(f, "codes"));
    if (!codes) throw new PosError("Postleitzahlen: 4 Ziffern, mit Komma getrennt.");
    await saveZone(c.hotel.id, s(f, "id") || null, { name: s(f, "name"), postalCodes: codes, minOrderRappen: chf(s(f, "min") || "0"), feeRappen: chf(s(f, "fee") || "0"), freeFromRappen: s(f, "free") ? chf(s(f, "free")) : null, extraMinutes: Number(s(f, "extra") || 0), active: s(f, "active") !== "0" }, c.actor);
    return "Liefergebiet gespeichert.";
  });
}
async function test(f: FormData) {
  "use server";
  const c = await guard(f);
  try { await startTestOrder(c.hotel, c.actor); } catch (e) { if (!(e instanceof PosError)) throw e; here(c.hotel.id, `Nicht möglich: ${e.message}`); }
  redirect(`/mypontivo/${c.hotel.id}/restaurant/bestellungen?probe=1`);
}
async function toggle(f: FormData) {
  "use server";
  await run(f, async (c) => { await setOrdersEnabled(c.hotel, s(f, "on") === "1", c.actor); return s(f, "on") === "1" ? "Die Online-Bestellung ist live." : "Die Online-Bestellung ist ausgeschaltet."; });
}

/** Online-Bestellung & Lieferung (SPEC 20.4/20.5): Live-Prüfung, Einstellungen, Liefergebiete, Probebestellung */
export default async function OrderSettingsPage({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel } = await requireHotel(hotelId, "manager");
  await requireModule(hotel.id, "restaurant");
  const [cfg, problems, zones, screens] = await Promise.all([orderSettings(hotel.id), orderReadiness(hotel), listZones(hotel.id), screensOf(hotel.id)]);
  const H = <input type="hidden" name="hotelId" value={hotel.id} />;
  const base = `/mypontivo/${hotel.id}`;
  const link = `${publicUrl(hotel)}/${hotel.defaultLanguage}/bestellen`;
  const fix: Record<string, string> = { hours: `${base}/settings#gastronomie`, items: `${base}/restaurant/artikel`, zones: "#gebiete", stripe: `${base}/zahlungen`, test: "#probe", kind: "#einstellungen" };
  return (
    <div className="stack">
      <h1>Online-Bestellung & Lieferung</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      <section className="card stack" data-testid="orders-live">
        <h2>Status</h2>
        {cfg.enabled ? (
          <>
            <p><span className="badge">live</span> {cfg.autoPaused ? <span className="badge warn">automatisch pausiert: kein Bestellbildschirm erreichbar</span> : cfg.pausedUntil && cfg.pausedUntil > new Date() ? <span className="badge warn">pausiert bis {cfg.pausedUntil.toLocaleTimeString("de-CH", { timeZone: hotel.timezone, hour: "2-digit", minute: "2-digit" })}</span> : null}</p>
            <CopyBox text={link} label="Link zur Online-Bestellung" />
            <img src={await QRCode.toDataURL(link, { margin: 1, width: 160 })} alt="QR-Code zur Online-Bestellung" width={160} height={160} />
            <form action={toggle}>{H}<input type="hidden" name="on" value="0" /><button className="btn secondary small">Online-Bestellung ausschalten</button></form>
          </>
        ) : problems.length ? (
          <>
            <p>Bevor Gäste bestellen können, fehlt noch:</p>
            <ul className="list">{problems.map((p) => <li key={p.key}><a href={fix[p.key]}>{p.text}</a></li>)}</ul>
            <p className="small muted">Reservierung und Website laufen schon; die Online-Bestellung kommt dazu, sobald alles bereit ist.</p>
          </>
        ) : <form action={toggle}>{H}<input type="hidden" name="on" value="1" /><button className="btn">Online-Bestellung live schalten</button></form>}
      </section>

      <section className="card stack" id="probe">
        <h2>Probebestellung</h2>
        <p className="small muted">Pflicht vor dem Start: Öffnen Sie den Bestellbildschirm auf dem Gerät im Restaurant (Tablet empfohlen, am Ladekabel). Starten Sie dann eine Probebestellung, nehmen Sie sie an und melden Sie «bereit». Probebestellungen kosten nichts und erscheinen nicht im Abschluss.</p>
        <p>{cfg.testPassedAt ? <span className="badge">✓ bestanden am {cfg.testPassedAt.toLocaleDateString("de-CH")}</span> : <span className="badge warn">noch nicht bestanden</span>}</p>
        <p className="small">Bestellbildschirme: {screens.length ? screens.map((x) => `${x.label || "Gerät"} (zuletzt ${x.lastSeenAt.toLocaleTimeString("de-CH", { timeZone: hotel.timezone, hour: "2-digit", minute: "2-digit" })}${x.battery !== null ? `, Akku ${x.battery} %` : ""})`).join(", ") : "noch keiner"} · <a href={`${base}/restaurant/bestellungen`}>Bestellbildschirm öffnen</a></p>
        <form action={test}>{H}<button className="btn secondary">Probebestellung starten</button></form>
      </section>

      <form action={settings} className="card stack" id="einstellungen">
        {H}
        <h2>Einstellungen</h2>
        <FormSwitch name="pickup" defaultOn={cfg.pickup} label="Abholung" />
        <FormSwitch name="delivery" defaultOn={cfg.delivery} label="Lieferung mit eigenen Fahrern" hint="Liefergebiete unten festlegen; Fahrer bekommen die Rolle «Fahrer» unter Team & Rollen." />
        <div className="inline-form">
          <div><label htmlFor="slotMinutes">Zeitraster (Min.)</label><input id="slotMinutes" name="slotMinutes" type="number" min={5} max={60} defaultValue={cfg.slotMinutes} style={{ width: 90 }} /></div>
          <div><label htmlFor="maxPerSlot">Abholungen je Zeitfenster</label><input id="maxPerSlot" name="maxPerSlot" type="number" min={1} max={100} defaultValue={cfg.maxPerSlot} style={{ width: 90 }} /></div>
          <div><label htmlFor="deliveryPerSlot">Lieferungen je Zeitfenster</label><input id="deliveryPerSlot" name="deliveryPerSlot" type="number" min={1} max={100} defaultValue={cfg.deliveryPerSlot} style={{ width: 90 }} /></div>
          <div><label htmlFor="leadMin">Vorlauf (Min.)</label><input id="leadMin" name="leadMin" type="number" min={0} max={240} defaultValue={cfg.leadMin} style={{ width: 90 }} /></div>
          <div><label htmlFor="cutoffMin">Bestellschluss vor Schliessung (Min.)</label><input id="cutoffMin" name="cutoffMin" type="number" min={0} max={240} defaultValue={cfg.cutoffMin} style={{ width: 90 }} /></div>
        </div>
        <FormSwitch name="cashPickup" defaultOn={cfg.cashPickup} label="Bar bei Abholung erlauben" />
        <FormSwitch name="cashDelivery" defaultOn={cfg.cashDelivery} label="Bar bei Lieferung erlauben" hint="Telefon ist Pflicht; Adressen mit früherer Nicht-Annahme werden markiert. Die Gebühr von 1,9 % gilt auch bar (kommt auf die Monatsrechnung)." />
        <div><label htmlFor="cashMax">Höchstbetrag bar CHF (leer = ohne)</label><input id="cashMax" name="cashMax" inputMode="decimal" defaultValue={cfg.cashMaxRappen ? (cfg.cashMaxRappen / 100).toString() : ""} style={{ width: 120 }} /></div>
        <FormSwitch name="guestSms" defaultOn={cfg.guestSms} label="SMS an Gäste («bereit», «unterwegs»)" hint="Zusätzlich zur Mail. Kosten zum Selbstkostenpreis auf der Monatsrechnung (ca. 8 Rappen je SMS). Alarme an Sie sind inklusive." />
        <p className="small muted">Bestellt werden kann innerhalb der Öffnungszeiten (Grunddaten). Gäste bezahlen online mit Karte oder TWINT; Sie nehmen jede Bestellung auf dem Bestellbildschirm an. Nicht angenommene Bestellungen lösen nach 5 Minuten einen Alarm aus und werden nach 10 Minuten automatisch storniert und erstattet.</p>
        <div><button className="btn">Speichern</button></div>
      </form>

      <section className="card stack" id="gebiete">
        <h2>Liefergebiete</h2>
        {zones.length ? (
          <table className="table"><thead><tr><th>Gebiet</th><th>PLZ</th><th>Mindestwert</th><th>Gebühr</th><th>Gratis ab</th><th>+ Min.</th></tr></thead><tbody>
            {zones.map((z) => <tr key={z.id} className={z.active ? undefined : "muted"}><td>{z.name}{z.active ? "" : " (aus)"}</td><td className="small">{z.postalCodes.join(", ")}</td><td>{formatChf(z.minOrderRappen)}</td><td>{formatChf(z.feeRappen)}</td><td>{z.freeFromRappen ? formatChf(z.freeFromRappen) : "–"}</td><td>{z.extraMinutes}</td></tr>)}
          </tbody></table>
        ) : <p className="muted small">Noch kein Liefergebiet.</p>}
        <form action={zone} className="stack">{H}
          <h3>Neues Gebiet</h3>
          <div className="inline-form">
            <div><label htmlFor="zname">Name</label><input id="zname" name="name" required maxLength={60} placeholder="Stadt" /></div>
            <div><label htmlFor="zcodes">Postleitzahlen</label><input id="zcodes" name="codes" required placeholder="9000, 9008, 9010" /></div>
          </div>
          <div className="inline-form">
            <div><label htmlFor="zmin">Mindestbestellwert CHF</label><input id="zmin" name="min" inputMode="decimal" defaultValue="0" style={{ width: 90 }} /></div>
            <div><label htmlFor="zfee">Liefergebühr CHF</label><input id="zfee" name="fee" inputMode="decimal" defaultValue="0" style={{ width: 90 }} /></div>
            <div><label htmlFor="zfree">Gratis ab CHF</label><input id="zfree" name="free" inputMode="decimal" style={{ width: 90 }} /></div>
            <div><label htmlFor="zextra">Zusätzliche Minuten</label><input id="zextra" name="extra" type="number" min={0} max={180} defaultValue={20} style={{ width: 90 }} /></div>
          </div>
          <div><button className="btn secondary">Gebiet anlegen</button></div>
        </form>
      </section>
    </div>
  );
}
