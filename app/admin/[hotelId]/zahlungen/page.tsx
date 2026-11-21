import { Notice } from "@/components/admin/Notice";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { setDeposit } from "@/src/services/settings";
import { onboardingLink, refreshAccountStatus } from "@/src/integrations/stripe/onboarding";
import { BillingError, chargesOf, setBillingMethod, startCardSetup } from "@/src/services/billing";
import { billingReady, chargeStatusText } from "@/src/domain/platform-invoice";
import { todayIn } from "@/src/domain/dates";
import { getPlatformBilling } from "@/src/services/platform-settings";
import { formatChf } from "@/src/domain/money";
import { env } from "@/src/env";
import { StripeOnboarding } from "@/components/admin/StripeOnboarding";
import { setEmbeddedCheckout } from "@/src/services/payment-settings";

export const dynamic = "force-dynamic";

const back = (hotelId: string, msg: string) => redirect(`/admin/${hotelId}/zahlungen?msg=${encodeURIComponent(msg)}`);
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function saveDeposit(f: FormData) {
  "use server";
  const { hotel, actor } = await requireHotel(s(f, "hotelId"), "manager");
  try {
    await setDeposit(hotel, { percent: Number(s(f, "percent")), dueDays: Number(s(f, "dueDays")) }, actor);
  } catch (e) {
    if (e instanceof ZodError) back(hotel.id, `Fehler: ${e.issues.map((i) => i.message).join(", ")}`);
    throw e;
  }
  back(hotel.id, "Gespeichert");
}

async function saveEmbedded(f: FormData) {
  "use server";
  const { hotel, actor } = await requireHotel(s(f, "hotelId"), "owner");
  await setEmbeddedCheckout(hotel, s(f, "embedded") === "on", actor);
  back(hotel.id, "Gespeichert");
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
    url = await startCardSetup(hotel, `/admin/${hotel.id}/zahlungen`);
  } catch (e) {
    back(hotel.id, `Karte: ${(e as Error).message}`);
  }
  redirect(url);
}

async function billingMethod(f: FormData) {
  "use server";
  const { hotel, actor } = await requireHotel(s(f, "hotelId"), "owner");
  try { await setBillingMethod(hotel, s(f, "method") === "qr" ? "qr" : "card", actor); } catch (e) { if (!(e instanceof BillingError)) throw e; back(hotel.id, e.message); }
  back(hotel.id, s(f, "method") === "qr" ? "Grundgebühr per QR-Rechnung: gilt ab der nächsten Monatsrechnung." : "Grundgebühr per Karte: gilt ab der nächsten Monatsrechnung.");
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

/** Zahlungsmethoden (SPEC 19.47): Stripe-Konto (Karte, TWINT), Anzahlung, Grundgebühr und Karte des Betriebs. Früher unter Grunddaten. */
export default async function Zahlungen({ params, searchParams }: { params: Promise<{ hotelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { hotelId } = await params;
  const sp = await searchParams;
  const { hotel, role } = await requireHotel(hotelId, "manager");
  const isManager = atLeast(role, "manager");
  const isOwner = atLeast(role, "owner");
  const provider = env().PAYMENT_PROVIDER;
  const hidden = <input type="hidden" name="hotelId" value={hotel.id} />;
  const [charges, terms] = await Promise.all([chargesOf(hotel.id), getPlatformBilling()]);

  return (
    <div className="stack">
      <h1>Zahlungsmethoden</h1>
      {sp.msg ? <Notice text={sp.msg} /> : null}
      {sp.stripe === "return" ? <p className="notice">Zurück von Stripe. Der Status wird per Webhook aktualisiert – oder „Status neu laden“ klicken.</p> : null}

      <section className="card stack">
        <h2>Zahlungen (Stripe)</h2>
        {provider === "fake" ? <p className="notice warn small">Entwicklungsmodus: <code>PAYMENT_PROVIDER=fake</code>. Buchungen werden ohne Zahlung bestätigt.</p> : null}
        <div className="kv">
          <span className="muted">Stripe-Konto</span><span>{hotel.stripeAccountId ?? "noch keines"}</span>
          <span className="muted">Zahlungen möglich</span><span>{hotel.stripeChargesEnabled ? "ja" : "nein"}</span>
          <span className="muted">TWINT aktiv</span><span>{hotel.stripeTwintActive ? "ja" : "nein"}</span>
          <span className="muted">Plattformgebühr</span><span>{hotel.platformFeeBps / 100} % pro Direktbuchung</span>
        </div>
        {isOwner && provider === "stripe" && env().STRIPE_PUBLISHABLE_KEY ? (
          <form action={saveEmbedded} className="stack">
            {hidden}
            <label className="check"><input type="checkbox" name="embedded" defaultChecked={hotel.content.payment?.embedded === true} /> Zahlung auf Ihrer Website einbetten (der Gast bleibt auf der Seite)</label>
            <p className="muted small">Die Karteneingabe liegt in einem Rahmen von Stripe, Pontivo sieht keine Kartendaten. Erst nach einer Testbuchung einschalten. Aus: Weiterleitung auf die Stripe-Seite wie bisher.</p>
            <button className="btn secondary small">Speichern</button>
          </form>
        ) : null}
        {isOwner && provider === "stripe" && !hotel.stripeChargesEnabled && env().STRIPE_PUBLISHABLE_KEY && sp.stripe !== "return" ? (
          <StripeOnboarding
            hotelId={hotel.id}
            publishableKey={env().STRIPE_PUBLISHABLE_KEY!}
            privacyUrl={`${env().APP_BASE_URL}/datenschutz`}
            returnTo={`/admin/${hotel.id}/zahlungen?stripe=return`}
          />
        ) : null}
        {isOwner ? (
          <div className="inline-form">
            <form action={stripeOnboarding}>{hidden}<button className={!hotel.stripeChargesEnabled && env().STRIPE_PUBLISHABLE_KEY && provider === "stripe" ? "btn secondary small" : "btn"}>{hotel.stripeChargesEnabled || !env().STRIPE_PUBLISHABLE_KEY || provider !== "stripe" ? (hotel.stripeAccountId ? "Stripe-Einrichtung fortsetzen" : "Stripe-Konto einrichten") : "Lieber auf der Stripe-Seite einrichten"}</button></form>
            {hotel.stripeAccountId ? <form action={stripeRefresh}>{hidden}<button className={!hotel.stripeChargesEnabled && env().STRIPE_PUBLISHABLE_KEY && provider === "stripe" ? "btn secondary small" : "btn secondary"}>Status neu laden</button></form> : null}
          </div>
        ) : <p className="muted small">Nur Inhaber können Stripe einrichten.</p>}
      </section>

      {isManager ? (
        <form action={saveDeposit} className="card stack">
          <h2>Anzahlung</h2>
          {hidden}
          <p className="small muted">Der Gast zahlt bei der Buchung nur einen Teil, den Rest zahlt er online vor der Anreise (er bekommt dafür eine Mail mit Link). Liegt die Anreise näher als die Fälligkeit des Rests, muss er gleich alles zahlen. 100 % = ganze Summe sofort, wie bisher. Bei einer Stornierung wird höchstens zurückerstattet, was der Gast bezahlt hat, abzüglich der Stornogebühr.</p>
          <div className="form-grid">
            <div><label>Anzahlung in Prozent</label><input name="percent" type="number" min={10} max={100} step={1} defaultValue={Math.round(hotel.depositBps / 100)} required /></div>
            <div><label>Rest fällig (Tage vor Anreise)</label><input name="dueDays" type="number" min={1} max={60} step={1} defaultValue={hotel.balanceDueDays} required /></div>
          </div>
          <button className="btn">Speichern</button>
        </form>

      ) : null}

      {(
        <section className="card stack" id="karte">
          <h2>Grundgebühr und Abrechnung</h2>
          {hotel.monthlyMinimumRappen > 0 ? <p className="small">{hotel.platformFeeBps / 100} % pro Direktbuchung, mindestens {formatChf(hotel.monthlyMinimumRappen)} pro Monat. Liegen die {hotel.platformFeeBps / 100} % darunter, verrechnen wir Anfang des Folgemonats die Differenz{hotel.liveSince ? "" : " (ab dem ersten vollen Monat nach dem Live-Gang)"}.</p> : <p className="small">Die Abrechnung betrifft Module (z. B. KI-Chat) und Gebühren der Plattform.</p>}
          <form action={billingMethod} className="stack" data-testid="billing-method">{hidden}
            <fieldset><legend className="small">Wie möchten Sie bezahlen?</legend>
              <label className="opt-row"><input type="radio" name="method" value="card" defaultChecked={hotel.billingMethod !== "qr"} disabled={!isOwner} /> Karte: wird Anfang Monat automatisch belastet</label>
              <label className="opt-row"><input type="radio" name="method" value="qr" defaultChecked={hotel.billingMethod === "qr"} disabled={!isOwner} /> QR-Rechnung: per Mail, zahlbar innert {terms.paymentDays} Tagen im E-Banking (ohne Stripe)</label>
            </fieldset>
            {isOwner ? <div><button className="btn secondary small">Zahlungsart speichern</button></div> : null}
          </form>
          {!billingReady(hotel) ? <p className="notice warn small">Noch nicht eingerichtet: Karte hinterlegen oder QR-Rechnung wählen.</p> : null}
          <div className="kv">
            <span className="muted">Zahlungsart</span><span>{hotel.billingMethod === "qr" ? "QR-Rechnung" : "Karte"}</span>
            <span className="muted">Karte</span><span>{hotel.billingCardLabel ?? (hotel.billingMethod === "qr" ? "–" : <span className="badge warn">keine hinterlegt</span>)}</span>
            <span className="muted">Bedingungen</span><span><a href="/gastgeber-bedingungen" target="_blank">Version {hotel.hostTermsVersion ?? "–"}</a>{hotel.hostTermsAcceptedAt ? `, akzeptiert am ${hotel.hostTermsAcceptedAt.toISOString().slice(0, 10)}` : ""}</span>
          </div>
          {isOwner && hotel.billingMethod !== "qr" ? <form action={cardSetup}>{hidden}<button className="btn secondary">{hotel.billingCardLabel ? "Andere Karte hinterlegen" : "Karte hinterlegen"}</button></form> : null}
          {charges.length ? (
            <table className="table small">
              <thead><tr><th>Monat</th><th>Gebühr</th><th>Minimum</th><th>KI-Chat</th><th>MWST</th><th>Betrag</th><th>Status</th><th>Rechnung</th></tr></thead>
              <tbody>{charges.map((c) => (
                <tr key={c.id}><td>{c.month}</td><td>{formatChf(c.feesRappen)}</td><td>{formatChf(c.minimumRappen)}</td><td>{formatChf(c.aiModuleRappen + c.aiPacksRappen)}</td><td>{c.vatRappen ? formatChf(c.vatRappen) : "–"}</td><td>{formatChf(c.chargeRappen)}</td>
                  <td>{((st) => (st.warn ? <span className="badge warn">{st.text}</span> : st.text))(chargeStatusText(c, todayIn(hotel.timezone)))}</td>
                  <td>{c.invoiceNo ? <a href={`/admin/${hotel.id}/plattform-rechnung/${c.id}`} target="_blank">{c.invoiceNo}</a> : "–"}</td></tr>
              ))}</tbody>
            </table>
          ) : null}
        </section>
      )}
    </div>
  );
}
