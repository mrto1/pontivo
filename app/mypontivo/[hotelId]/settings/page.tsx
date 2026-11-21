import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { taxRuleFor } from "@/src/services/hotels";
import { confirmTouristTax, goLiveProblems, setHotelStatus, updateHotelSettings } from "@/src/services/settings";
import { todayIn } from "@/src/domain/dates";
import { decimalToRappen, formatChf } from "@/src/domain/money";

export const dynamic = "force-dynamic";

const back = (hotelId: string, msg: string) => redirect(`/mypontivo/${hotelId}/settings?msg=${encodeURIComponent(msg)}`);
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

async function changeStatus(f: FormData) {
  "use server";
  const { hotel, actor } = await requireHotel(s(f, "hotelId"), "owner");
  const status = s(f, "status") as "live" | "paused" | "draft";
  try {
    await setHotelStatus(hotel, status, actor);
  } catch (e) {
    back(hotel.id, `Nicht möglich: ${(e as Error).message}`);
  }
  back(hotel.id, `Status: ${status}`);
}

export default async function Settings({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const isManager = atLeast(role, "manager");
  const isOwner = atLeast(role, "owner");
  const rule = await taxRuleFor(hotel, todayIn(hotel.timezone));
  const problems = await goLiveProblems(hotel);
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;

  return (
    <div className="stack">
      <h1>Grunddaten</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}

      {isManager ? (
        <form action={saveHotel} className="card stack">
          <h2>Betriebsdaten</h2>
          {hidden}
          <div className="form-grid">
            <div><label>Name</label><input name="name" defaultValue={hotel.name} required /></div>
            <div><label>Firma (Rechnungsname)</label><input name="legalName" defaultValue={hotel.legalName ?? ""} /></div>
            <div><label>Adresse</label><input name="addressLine" defaultValue={hotel.addressLine ?? ""} /></div>
            <div><label>PLZ</label><input name="postalCode" defaultValue={hotel.postalCode ?? ""} /></div>
            <div><label>Ort</label><input name="city" defaultValue={hotel.city ?? ""} /></div>
            <div><label>E-Mail (Buchungen)</label><input name="contactEmail" type="email" defaultValue={hotel.contactEmail} required /></div>
            <div><label>Telefon</label><input name="contactPhone" defaultValue={hotel.contactPhone ?? ""} /></div>
            <div><label>Check-in ab</label><input name="checkinTime" type="time" defaultValue={hotel.checkinTime.slice(0, 5)} required /></div>
            <div><label>Check-out bis</label><input name="checkoutTime" type="time" defaultValue={hotel.checkoutTime.slice(0, 5)} required /></div>
            <div><label>Standardsprache</label><select name="defaultLanguage" defaultValue={hotel.defaultLanguage}><option value="de">Deutsch</option><option value="en">Englisch</option></select></div>
          </div>
          <label className="check"><input type="checkbox" name="taxIncluded" defaultChecked={hotel.touristTaxIncludedInPrice} />Kurtaxe ist im Zimmerpreis inbegriffen</label>
          <button className="btn">Speichern</button>
        </form>
      ) : null}

      <section className="card stack">
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
            <form action={saveTax} className="stack" style={{ marginTop: 12 }}>
              {hidden}
              <div className="inline-form">
                <div><label>Erwachsene CHF/Nacht</label><input name="adult" required inputMode="decimal" defaultValue={rule?.adultRappen != null ? (rule.adultRappen / 100).toFixed(2) : ""} /></div>
                <div><label>Reduziert CHF</label><input name="reduced" inputMode="decimal" defaultValue={rule?.reducedRappen != null ? (rule.reducedRappen / 100).toFixed(2) : ""} /></div>
                <div><label>Reduziert unter Alter</label><input name="reducedUnder" type="number" min={0} defaultValue={rule?.reducedUnderAge ?? ""} /></div>
                <div><label>Befreit unter Alter</label><input name="freeUnder" type="number" min={0} defaultValue={rule?.freeUnderAge ?? 0} /></div>
              </div>
              <button className="btn">Bestätigen (gültig ab heute)</button>
            </form>
          </details>
        ) : null}
      </section>

      <section className="card stack">
        <h2>Online-Buchung</h2>
        <p>Status: <span className={`badge ${hotel.status === "live" ? "" : "warn"}`}>{hotel.status}</span> {hotel.primaryDomain ? <span className="muted small">· Domain {hotel.primaryDomain}</span> : null}</p>
        {problems.length ? <ul className="notice warn">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
        {isOwner ? (
          <div className="inline-form">
            {hotel.status !== "live" ? <form action={changeStatus}>{hidden}<input type="hidden" name="status" value="live" /><button className="btn" disabled={problems.length > 0}>Live schalten</button></form> : null}
            {hotel.status === "live" ? <form action={changeStatus}>{hidden}<input type="hidden" name="status" value="paused" /><button className="btn secondary">Pausieren</button></form> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
