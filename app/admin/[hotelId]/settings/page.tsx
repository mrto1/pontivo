import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { taxRuleFor } from "@/src/services/hotels";
import { confirmTouristTax, updateHotelSettings } from "@/src/services/settings";
import { FormSwitch } from "@/components/admin/FormSwitch";
import { moduleRows } from "@/src/services/modules";
import { isOn } from "@/src/domain/modules";
import { WEEKDAYS_DE, hoursText, parseHoursText } from "@/src/domain/reservations";
import { getSettings, saveOpeningHours } from "@/src/services/reservations";
import { todayIn } from "@/src/domain/dates";
import { decimalToRappen, formatChf } from "@/src/domain/money";

export const dynamic = "force-dynamic";

const back = (hotelId: string, msg: string) => redirect(`/admin/${hotelId}/settings?msg=${encodeURIComponent(msg)}`);
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function saveHotel(f: FormData) {
  "use server";
  const { hotel, actor } = await requireHotel(s(f, "hotelId"), "manager");
  try {
    await updateHotelSettings(hotel, {
      name: s(f, "name"), legalName: s(f, "legalName"), addressLine: s(f, "addressLine"), postalCode: s(f, "postalCode"), city: s(f, "city"),
      contactEmail: s(f, "contactEmail"), contactPhone: s(f, "contactPhone"), checkinTime: s(f, "checkinTime").slice(0, 5), checkoutTime: s(f, "checkoutTime").slice(0, 5),
      defaultLanguage: s(f, "defaultLanguage") === "en" ? "en" : "de", touristTaxIncludedInPrice: f.get("taxIncluded") === "on",
    }, actor);
  } catch (e) {
    back(hotel.id, `Fehler: ${(e as Error).message}`);
  }
  back(hotel.id, "Gespeichert");
}

async function saveTax(f: FormData) {
  "use server";
  const { hotel, actor } = await requireHotel(s(f, "hotelId"), "manager");
  const opt = (k: string) => (s(f, k) === "" ? null : s(f, k));
  try {
    await confirmTouristTax(hotel, {
      adultRappen: decimalToRappen(s(f, "adult").replace(",", ".")),
      reducedRappen: opt("reduced") === null ? null : decimalToRappen(opt("reduced")!.replace(",", ".")),
      freeUnderAge: Number(s(f, "freeUnder") || 0),
      reducedUnderAge: opt("reducedUnder") === null ? null : Number(opt("reducedUnder")),
    }, actor);
  } catch (e) {
    back(hotel.id, `Fehler: ${(e as Error).message}`);
  }
  back(hotel.id, "Kurtaxe bestätigt");
}

/** Gastronomie: Bezeichnung im Umschalter und Öffnungszeiten (SPEC 20.1) */
async function saveDining(f: FormData) {
  "use server";
  const { hotel, actor } = await requireHotel(s(f, "hotelId"), "manager");
  try {
    let hours: Record<string, { from: string; to: string }[]> | null = null;
    if (f.get("useHours") === "on") {
      hours = {};
      for (let d = 0; d < 7; d++) {
        const w = parseHoursText(s(f, `h${d}`));
        if (!w) throw new Error(`${WEEKDAYS_DE[d]}: bitte so schreiben: 11:30-14:00, 17:30-22:00 (leer = Ruhetag).`);
        hours[String(d)] = w;
      }
    }
    await saveOpeningHours(hotel.id, hours, actor);
  } catch (e) {
    back(hotel.id, `Nicht gespeichert: ${(e as Error).message}`);
  }
  back(hotel.id, "Gespeichert");
}

export default async function Settings({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const isManager = atLeast(role, "manager");
  const restaurantKind = hotel.propertyType === "restaurant";
  const rule = restaurantKind ? null : await taxRuleFor(hotel, todayIn(hotel.timezone));
  const dining = isOn(await moduleRows(hotel.id), "restaurant");
  const cfg = dining ? await getSettings(hotel.id) : null;
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;

  return (
    <div className="stack">
      <h1>Betriebsdaten</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}

      {isManager ? (
        <form action={saveHotel} className="card stack">
          <h2>Name und Adresse</h2>
          {hidden}
          <div className="form-grid">
            <div><label htmlFor="fe5a61">Name</label><input id="fe5a61" name="name" defaultValue={hotel.name} required /></div>
            <div><label htmlFor="fe5a62">Firma (Rechnungsname)</label><input id="fe5a62" name="legalName" defaultValue={hotel.legalName ?? ""} /></div>
            <div><label htmlFor="fe5a63">Adresse</label><input id="fe5a63" name="addressLine" defaultValue={hotel.addressLine ?? ""} /></div>
            <div><label htmlFor="fe5a64">PLZ</label><input id="fe5a64" name="postalCode" defaultValue={hotel.postalCode ?? ""} /></div>
            <div><label htmlFor="fe5a65">Ort</label><input id="fe5a65" name="city" defaultValue={hotel.city ?? ""} /></div>
            <div><label htmlFor="fe5a66">E-Mail (Buchungen)</label><input id="fe5a66" name="contactEmail" type="email" defaultValue={hotel.contactEmail} required /></div>
            <div><label htmlFor="fe5a67">Telefon</label><input id="fe5a67" name="contactPhone" defaultValue={hotel.contactPhone ?? ""} /></div>
            {restaurantKind ? <><input type="hidden" name="checkinTime" value={hotel.checkinTime.slice(0, 5)} /><input type="hidden" name="checkoutTime" value={hotel.checkoutTime.slice(0, 5)} /></> : <>
            <div><label htmlFor="fe5a68">Check-in ab</label><input id="fe5a68" name="checkinTime" type="time" defaultValue={hotel.checkinTime.slice(0, 5)} required /></div>
            <div><label htmlFor="fe5a69">Check-out bis</label><input id="fe5a69" name="checkoutTime" type="time" defaultValue={hotel.checkoutTime.slice(0, 5)} required /></div></>}
            <div><label htmlFor="fe5a610">Standardsprache</label><select id="fe5a610" name="defaultLanguage" defaultValue={hotel.defaultLanguage}><option value="de">Deutsch</option><option value="en">Englisch</option></select></div>
          </div>
          {restaurantKind ? null : <label className="check"><input type="checkbox" name="taxIncluded" defaultChecked={hotel.touristTaxIncludedInPrice} />Kurtaxe ist im Zimmerpreis inbegriffen</label>}
          <button className="btn">Speichern</button>
        </form>
      ) : null}

      {dining && isManager && cfg ? (
        <form action={saveDining} className="card stack" id="gastronomie" data-testid="dining-settings">
          {hidden}
          <h2>{restaurantKind ? "Öffnungszeiten" : "Öffnungszeiten Restaurant"}</h2>
          <FormSwitch name="useHours" defaultOn={!!cfg.openingHours} label="Öffnungszeiten verwenden" hint="Online-Reservierungen gibt es dann nur zu diesen Zeiten; leerer Tag = Ruhetag. Aus = jeden Tag in den Zeitfenstern der Online-Reservierung." />
          <div className="form-grid">
            {WEEKDAYS_DE.map((d, i) => ({ d, i })).slice(1).concat({ d: WEEKDAYS_DE[0], i: 0 }).map(({ d, i }) => (
              <div key={i}><label htmlFor={`h${i}`}>{d}</label><input id={`h${i}`} name={`h${i}`} defaultValue={hoursText(cfg.openingHours?.[String(i)])} placeholder="11:30-14:00, 17:30-22:00" /></div>
            ))}
          </div>
          <div><button className="btn">Speichern</button></div>
        </form>
      ) : null}

      {restaurantKind ? null : <section className="card stack">
        <h2>Kurtaxe</h2>
        <p className="small">Gemeinde: <strong>{hotel.municipality ?? "–"}</strong> ({hotel.canton}), Kategorie {hotel.touristTaxCategory}</p>
        {rule ? (
          <div className="kv small">
            <span className="muted">Status</span><span><span className={`badge ${rule.status === "verified" ? "" : "warn"}`}>{rule.status}</span> (gültig ab {rule.validFrom})</span>
            <span className="muted">Erwachsene</span><span>{rule.adultRappen === null ? "unbekannt" : formatChf(rule.adultRappen)} pro Nacht</span>
            <span className="muted">Reduziert</span><span>{rule.reducedRappen === null ? "–" : `${formatChf(rule.reducedRappen)} unter ${rule.reducedUnderAge} Jahren`}</span>
            <span className="muted">Befreit</span><span>{rule.freeUnderAge ? `unter ${rule.freeUnderAge} Jahren` : "–"}</span>
            <span className="muted">Abrechnung</span><span>{rule.reportingSystem ?? "–"}</span>
            <span className="muted">Hinweis</span><span>{rule.notes ?? "–"} {rule.sourceUrl ? <a href={rule.sourceUrl} target="_blank">Quelle</a> : null}</span>
          </div>
        ) : <p className="notice warn">Keine Regel für diese Gemeinde hinterlegt.</p>}
        {isManager ? (
          <details>
            <summary className="btn secondary small">Satz bestätigen / korrigieren</summary>
            <form action={saveTax} className="stack mt12">
              {hidden}
              <div className="inline-form">
                <div><label htmlFor="fe5a611">Erwachsene CHF/Nacht</label><input id="fe5a611" name="adult" required inputMode="decimal" defaultValue={rule?.adultRappen != null ? (rule.adultRappen / 100).toFixed(2) : ""} /></div>
                <div><label htmlFor="fe5a612">Reduziert CHF</label><input id="fe5a612" name="reduced" inputMode="decimal" defaultValue={rule?.reducedRappen != null ? (rule.reducedRappen / 100).toFixed(2) : ""} /></div>
                <div><label htmlFor="fe5a613">Reduziert unter Alter</label><input id="fe5a613" name="reducedUnder" type="number" min={0} defaultValue={rule?.reducedUnderAge ?? ""} /></div>
                <div><label htmlFor="fe5a614">Befreit unter Alter</label><input id="fe5a614" name="freeUnder" type="number" min={0} defaultValue={rule?.freeUnderAge ?? 0} /></div>
              </div>
              <button className="btn">Bestätigen (gültig ab heute)</button>
            </form>
          </details>
        ) : null}
      </section>}

    </div>
  );
}
