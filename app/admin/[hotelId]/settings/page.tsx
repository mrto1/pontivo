import { redirect } from "next/navigation";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { taxRuleFor } from "@/src/services/hotels";
import { addMember, confirmTouristTax, goLiveProblems, listMembers, removeMember, setHotelStatus, updateHotelSettings } from "@/src/services/settings";
import { onboardingLink, refreshAccountStatus } from "@/src/integrations/stripe/onboarding";
import { chargesOf, startCardSetup } from "@/src/services/billing";
import { todayIn } from "@/src/domain/dates";
import { decimalToRappen, formatChf } from "@/src/domain/money";
import { env } from "@/src/env";

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
      headlineDe: s(f, "headlineDe"), introDe: s(f, "introDe"), headlineEn: s(f, "headlineEn"), introEn: s(f, "introEn"),
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

async function stripeOnboarding(f: FormData) {
  "use server";
  const { hotel, actor } = await requireHotel(s(f, "hotelId"), "owner");
  let url: string;
  try {
    url = await onboardingLink(hotel, actor);
  } catch (e) {
    back(hotel.id, `Stripe: ${(e as Error).message}`);
    return;
  }
  redirect(url);
}

async function cardSetup(f: FormData) {
  "use server";
  const { hotel } = await requireHotel(s(f, "hotelId"), "owner");
  let url = "";
  try {
    url = await startCardSetup(hotel, `/admin/${hotel.id}/settings`);
  } catch (e) {
    back(hotel.id, `Karte: ${(e as Error).message}`);
  }
  redirect(url);
}

async function stripeRefresh(f: FormData) {
  "use server";
  const { hotel } = await requireHotel(s(f, "hotelId"), "owner");
  try {
    await refreshAccountStatus(hotel);
  } catch (e) {
    back(hotel.id, `Stripe: ${(e as Error).message}`);
  }
  back(hotel.id, "Stripe-Status aktualisiert");
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

async function memberAdd(f: FormData) {
  "use server";
  const { hotel, actor } = await requireHotel(s(f, "hotelId"), "owner");
  try {
    await addMember(hotel.id, s(f, "email"), (s(f, "role") || "staff") as "owner" | "manager" | "staff", actor);
  } catch (e) {
    back(hotel.id, `Fehler: ${(e as Error).message}`);
  }
  back(hotel.id, "Mitglied gespeichert");
}

async function memberRemove(f: FormData) {
  "use server";
  const { hotel, actor, user } = await requireHotel(s(f, "hotelId"), "owner");
  if (s(f, "userId") === user.id) back(hotel.id, "Sie können sich nicht selbst entfernen");
  await removeMember(hotel.id, s(f, "userId"), actor);
  back(hotel.id, "Mitglied entfernt");
}

export default async function Settings({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId);
  const isManager = atLeast(role, "manager");
  const isOwner = atLeast(role, "owner");
  const rule = await taxRuleFor(hotel, todayIn(hotel.timezone));
  const problems = await goLiveProblems(hotel);
  const members = isOwner ? await listMembers(hotel.id) : [];
  const provider = env().PAYMENT_PROVIDER;
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;
  const charges = hotel.monthlyMinimumRappen > 0 ? await chargesOf(hotel.id) : [];

  return (
    <div className="stack">
      <h1>Einstellungen</h1>
      {sp.msg ? <p className="notice">{sp.msg}</p> : null}
      {sp.stripe === "return" ? <p className="notice">Zurück von Stripe. Der Status wird per Webhook aktualisiert – oder „Status neu laden“ klicken.</p> : null}

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

      <section className="card stack">
        <h2>Zahlungen (Stripe)</h2>
        {provider === "fake" ? <p className="notice warn small">Entwicklungsmodus: <code>PAYMENT_PROVIDER=fake</code>. Buchungen werden ohne Zahlung bestätigt.</p> : null}
        <div className="kv">
          <span className="muted">Stripe-Konto</span><span>{hotel.stripeAccountId ?? "noch keines"}</span>
          <span className="muted">Zahlungen möglich</span><span>{hotel.stripeChargesEnabled ? "ja" : "nein"}</span>
          <span className="muted">TWINT aktiv</span><span>{hotel.stripeTwintActive ? "ja" : "nein"}</span>
          <span className="muted">Plattformgebühr</span><span>{hotel.platformFeeBps / 100} % pro Direktbuchung</span>
        </div>
        {isOwner ? (
          <div className="inline-form">
            <form action={stripeOnboarding}>{hidden}<button className="btn">{hotel.stripeAccountId ? "Stripe-Einrichtung fortsetzen" : "Stripe-Konto einrichten"}</button></form>
            {hotel.stripeAccountId ? <form action={stripeRefresh}>{hidden}<button className="btn secondary">Status neu laden</button></form> : null}
          </div>
        ) : <p className="muted small">Nur Inhaber können Stripe einrichten.</p>}
      </section>

      {hotel.monthlyMinimumRappen > 0 ? (
        <section className="card stack" id="karte">
          <h2>Grundgebühr und Karte</h2>
          <p className="small">{hotel.platformFeeBps / 100} % pro Direktbuchung, mindestens {formatChf(hotel.monthlyMinimumRappen)} pro Monat. Liegen die {hotel.platformFeeBps / 100} % darunter, wird Anfang des Folgemonats die Differenz der Karte belastet{hotel.liveSince ? "" : " (ab dem ersten vollen Monat nach dem Live-Gang)"}.</p>
          <div className="kv">
            <span className="muted">Karte</span><span>{hotel.billingCardLabel ?? <span className="badge warn">keine hinterlegt</span>}</span>
            <span className="muted">Bedingungen</span><span><a href="/gastgeber-bedingungen" target="_blank">Version {hotel.hostTermsVersion ?? "–"}</a>{hotel.hostTermsAcceptedAt ? `, akzeptiert am ${hotel.hostTermsAcceptedAt.toISOString().slice(0, 10)}` : ""}</span>
          </div>
          {isOwner ? <form action={cardSetup}>{hidden}<button className="btn secondary">{hotel.billingCardLabel ? "Andere Karte hinterlegen" : "Karte hinterlegen"}</button></form> : null}
          {charges.length ? (
            <table className="table small">
              <thead><tr><th>Monat</th><th>1 %</th><th>Minimum</th><th>Belastet</th><th>Status</th></tr></thead>
              <tbody>{charges.map((c) => (
                <tr key={c.id}><td>{c.month}</td><td>{formatChf(c.feesRappen)}</td><td>{formatChf(c.minimumRappen)}</td><td>{formatChf(c.chargeRappen)}</td>
                  <td>{c.status === "succeeded" ? "bezahlt" : c.status === "none" ? "nichts fällig" : c.status === "pending" ? "offen" : <span className="badge warn">fehlgeschlagen ({c.attempts}×)</span>}</td></tr>
              ))}</tbody>
            </table>
          ) : null}
        </section>
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

      {isManager ? (
        <form action={saveHotel} className="card stack">
          <h2>Hotel und Website</h2>
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
          <div className="form-grid">
            <div><label>Titel (DE)</label><input name="headlineDe" defaultValue={hotel.content?.de?.headline ?? ""} /></div>
            <div><label>Titel (EN)</label><input name="headlineEn" defaultValue={hotel.content?.en?.headline ?? ""} /></div>
            <div><label>Einleitung (DE)</label><textarea name="introDe" rows={3} defaultValue={hotel.content?.de?.intro ?? ""} /></div>
            <div><label>Einleitung (EN)</label><textarea name="introEn" rows={3} defaultValue={hotel.content?.en?.intro ?? ""} /></div>
          </div>
          <button className="btn">Speichern</button>
        </form>
      ) : null}

      {isOwner ? (
        <section className="card stack">
          <h2>Mitglieder</h2>
          <table className="table">
            <tbody>
              {members.map((m) => (
                <tr key={m.user.id}>
                  <td>{m.user.email}</td><td>{m.role}</td>
                  <td><form action={memberRemove}>{hidden}<input type="hidden" name="userId" value={m.user.id} /><button className="btn secondary small">Entfernen</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={memberAdd} className="inline-form">
            {hidden}
            <div><label>E-Mail</label><input name="email" type="email" required /></div>
            <div><label>Rolle</label><select name="role" defaultValue="staff"><option value="owner">Inhaber</option><option value="manager">Manager</option><option value="staff">Mitarbeitende</option></select></div>
            <button className="btn">Hinzufügen</button>
          </form>
          <p className="muted small">Inhaber: alles. Manager: alles ausser Mitglieder und Stripe. Mitarbeitende: Kalender und Buchungen lesen, No-Show.</p>
        </section>
      ) : null}
    </div>
  );
}
