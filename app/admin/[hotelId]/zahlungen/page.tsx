import { Notice } from "@/components/admin/Notice";
import { requireHotel } from "@/src/auth/guard";
import { atLeast } from "@/src/auth/session";
import { setDeposit } from "@/src/services/settings";
import { onboardingLink, refreshAccountStatus } from "@/src/integrations/stripe/onboarding";
import { chargesOf, setBillingMethod, startCardSetup } from "@/src/services/billing";
import { billingReady, chargeStatusText } from "@/src/domain/platform-invoice";
import { todayIn } from "@/src/domain/dates";
import { getPlatformBilling } from "@/src/services/platform-settings";
import { formatChf } from "@/src/domain/money";
import { env } from "@/src/env";
import { StripeOnboarding } from "@/components/admin/StripeOnboarding";
import { paymentUi, setPaymentUi, type PaymentUi } from "@/src/services/payment-settings";
import { s } from "@/src/lib/form";
import { hotelAction, userErrorText, type ActionResult, type HotelCtx } from "@/src/lib/hotel-action";
import { isStripeError, viaStripe } from "@/src/integrations/stripe/errors";
import { applyStripeBranding } from "@/src/integrations/stripe/branding";
import { domainStates, domainSummary, methodStates, registerDomains, setMethods, type DomainState, type MethodState } from "@/src/integrations/stripe/payment-methods";

export const dynamic = "force-dynamic";

/** Rückkehr auf diese Seite; Stripe-Meldungen erscheinen als «Stripe: …» (viaStripe) */
const run = (f: FormData, role: "manager" | "owner", fn: (c: HotelCtx) => Promise<ActionResult>) =>
  hotelAction(f, { page: "zahlungen", role, fail: "Nicht möglich" }, fn);
/** Meldung eines Teilschritts, der scheitern darf, ohne das Speichern rückgängig zu machen */
function soft(e: unknown): string {
  if (isStripeError(e)) return `Stripe: ${e.message}`;
  const t = userErrorText(e);
  if (t === null) throw e;
  return t;
}

async function saveDeposit(f: FormData) {
  "use server";
  await run(f, "manager", async ({ hotel, actor }) => { await setDeposit(hotel, { percent: Number(s(f, "percent")), dueDays: Number(s(f, "dueDays")) }, actor); });
}

async function savePaymentUi(f: FormData) {
  "use server";
  await run(f, "owner", async ({ hotel, actor }) => {
    const ui = s(f, "ui");
    const next: PaymentUi = ui === "element" || ui === "embedded" ? (ui as PaymentUi) : "hosted";
    await setPaymentUi(hotel, next, actor);
    // Apple Pay braucht bei Formular und eingebettetem Checkout die Domain im Stripe-Konto des Hotels (gehostet nicht): gleich eintragen
    if (next !== "hosted" && hotel.stripeAccountId) return `Gespeichert. ${await registerDomains(hotel, actor).then(domainSummary, (e) => `Domain-Eintrag fehlgeschlagen: ${soft(e)}`)}`;
  });
}

async function saveMethods(f: FormData) {
  "use server";
  await run(f, "owner", ({ hotel, actor }) => viaStripe(async () => {
    await setMethods(hotel, { apple_pay: s(f, "apple_pay") === "on", google_pay: s(f, "google_pay") === "on", twint: s(f, "twint") === "on" }, actor);
    return `Zahlarten gespeichert. ${domainSummary(await registerDomains(hotel, actor))}`;
  }));
}

async function registerDomainsAction(f: FormData) {
  "use server";
  await run(f, "owner", ({ hotel, actor }) => viaStripe(async () => domainSummary(await registerDomains(hotel, actor))));
}

async function stripeOnboarding(f: FormData) {
  "use server";
  await run(f, "owner", async ({ hotel, actor }) => ({ to: await viaStripe(() => onboardingLink(hotel, actor)) }));
}

async function cardSetup(f: FormData) {
  "use server";
  await run(f, "owner", async ({ hotel }) => ({ to: await viaStripe(() => startCardSetup(hotel, `/admin/${hotel.id}/zahlungen`), "Karte") }));
}

async function billingMethod(f: FormData) {
  "use server";
  await run(f, "owner", async ({ hotel, actor }) => {
    await setBillingMethod(hotel, s(f, "method") === "qr" ? "qr" : "card", actor);
    return s(f, "method") === "qr" ? "Grundgebühr per QR-Rechnung: gilt ab der nächsten Monatsrechnung." : "Grundgebühr per Karte: gilt ab der nächsten Monatsrechnung.";
  });
}

async function brandingApply(f: FormData) {
  "use server";
  await run(f, "owner", ({ hotel, actor }) => viaStripe(async () => {
    const r = await applyStripeBranding(hotel, actor);
    return `Auf Stripe übernommen: Farbe ${r.color}${r.logo ? ", Logo" : ""}${r.icon ? " und Icon" : ""}.`;
  }));
}

async function stripeRefresh(f: FormData) {
  "use server";
  await run(f, "owner", ({ hotel }) => viaStripe(async () => { await refreshAccountStatus(hotel); return "Stripe-Status aktualisiert"; }));
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
  // Stand bei Stripe (Zahlarten, Domains); darf die Seite nie blockieren oder zum Absturz bringen
  const live = isOwner && provider === "stripe" && hotel.stripeAccountId
    ? await Promise.race([
        Promise.all([methodStates(hotel), domainStates(hotel)]).then(([m, d]) => ({ m, d, error: null as string | null }), (e: Error) => ({ m: [] as MethodState[], d: [] as DomainState[], error: e.message })),
        new Promise<{ m: MethodState[]; d: DomainState[]; error: string }>((r) => setTimeout(() => r({ m: [], d: [], error: "Stripe antwortet nicht" }), 6000)),
      ])
    : null;
  const stateOf = (k: string) => live?.m.find((x) => x.key === k);

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
          <form action={savePaymentUi} className="stack" id="zahlungsseite">
            {hidden}
            <fieldset className="plain"><legend className="small muted">So bezahlt der Gast auf Ihrer Pontivo-Website</legend>
              <div className="mode-pick">
                {([
                  ["element", "Im Formular Ihrer Website", "Die Zahlung erscheint in Ihrem Design (Farben, Schrift, Dunkelmodus), der Gast bleibt auf der Seite. Karte, Apple Pay, Google Pay und TWINT."],
                  ["embedded", "Eingebettete Stripe-Seite", "Stripe-Zahlungsseite im Rahmen Ihrer Website. Erscheinung über das Stripe-Branding (siehe unten)."],
                  ["hosted", "Weiterleitung zu Stripe", "Der Gast wechselt auf die Stripe-Seite und kommt danach zurück. Der einfachste und robusteste Weg."],
                ] as const).map(([v, title, text]) => (
                  <label key={v}><input type="radio" name="ui" value={v} defaultChecked={paymentUi(hotel) === v} /><span><strong>{title}</strong><span className="small muted">{text}</span></span></label>
                ))}
              </div>
            </fieldset>
            <p className="muted small">Die Karteneingabe liegt immer in einem Rahmen von Stripe, Pontivo sieht keine Kartendaten. Erst nach einer Testbuchung einschalten. Geht bei einer Variante etwas schief, stellen Sie hier auf «Weiterleitung» zurück, die anderen bleiben unverändert.</p>
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

      {isOwner && provider === "stripe" && hotel.stripeAccountId ? (
          <section className="card stack" id="zahlarten">
            <h2>Zahlarten bei Stripe</h2>
            <p className="muted small">Pontivo schaltet die Zahlarten direkt im Stripe-Konto Ihres Betriebs ein oder aus. Karte ist immer dabei. Apple Pay und Google Pay laufen über die Karte.</p>
            {live?.error ? <p className="notice warn small" role="alert">Stand von Stripe nicht abrufbar: {live.error}. Sie können es später erneut versuchen.</p> : null}
            <form action={saveMethods} className="stack">
              {hidden}
              {([
                ["apple_pay", "Apple Pay", "Safari auf iPhone, iPad und Mac. Braucht die Domain bei Stripe (wird automatisch eingetragen)."],
                ["google_pay", "Google Pay", "Chrome und Android."],
                ["twint", "TWINT", hotel.stripeTwintActive ? "Beliebt in der Schweiz, bis CHF 5'000 pro Zahlung." : "Noch nicht freigeschaltet: Stripe prüft die Fähigkeit TWINT, sobald das Konto vollständig ist."],
              ] as const).map(([k, title, hint]) => {
                const st = stateOf(k);
                return (
                  <label key={k} className="check"><input type="checkbox" name={k} defaultChecked={st ? st.value === "on" : false} disabled={!live || !st || (k === "twint" && !hotel.stripeTwintActive)} />
                    <strong>{title}</strong> <span className="small muted">{st ? (st.available ? "aktiv" : st.value === "on" ? "eingeschaltet, noch nicht verfügbar" : "aus") : ""}</span>
                    <span className="small muted block">{hint}</span>
                  </label>
                );
              })}
              <button className="btn secondary small" disabled={!live || !!live.error}>Speichern und Domains eintragen</button>
            </form>
            <div>
              <h3>Domains für Apple Pay und Google Pay</h3>
              {live && live.d.length ? (
                <ul className="small">
                  {live.d.map((d) => (
                    <li key={d.domain}><code>{d.domain}</code>: {"error" in d ? <span className="muted">{d.error}</span> : `${d.enabled ? "eingetragen" : "ausgeschaltet"}, Apple Pay ${d.apple === "active" ? "aktiv" : "inaktiv"}, Google Pay ${d.google === "active" ? "aktiv" : "inaktiv"}`}</li>
                  ))}
                </ul>
              ) : <p className="small muted">Noch keine Domain bekannt.</p>}
              <form action={registerDomainsAction}>{hidden}<button className="btn secondary small">Domains neu eintragen und prüfen</button></form>
              <p className="small muted mt8">Apple Pay erscheint nur, wenn die Domain bei Stripe aktiv ist. Beim Weiterleiten zu Stripe ist das nicht nötig.</p>
            </div>
          </section>
        ) : null}
        {isOwner && provider === "stripe" && hotel.stripeAccountId ? (
        <section className="card stack" id="aussehen">
          <h2>Aussehen der Zahlungsseite</h2>
          <p className="small muted">Pontivo übernimmt Ihr Logo und Ihre Hauptfarbe (unter «Website &amp; Buchung») auf Ihr Stripe-Konto. Die Zahlungsseite, Belege und Stripe-Mails an Ihre Gäste erscheinen dann in Ihrem Auftritt. Nach einer Änderung von Logo oder Farbe den Knopf nochmals drücken.</p>
          <div className="kv">
            <span className="muted">Hauptfarbe</span><span>{hotel.content.brand?.color ?? "Standard"}</span>
            <span className="muted">Logo</span><span>{hotel.content.brand?.logoUrl ? "vorhanden" : "noch keines (unter «Website & Buchung» hochladen)"}</span>
          </div>
          <form action={brandingApply}>{hidden}<button className="btn secondary small">Auf Stripe übernehmen</button></form>
        </section>
      ) : null}

      {isManager ? (
        <form action={saveDeposit} className="card stack">
          <h2>Anzahlung</h2>
          {hidden}
          <p className="small muted">Der Gast zahlt bei der Buchung nur einen Teil, den Rest zahlt er online vor der Anreise (er bekommt dafür eine Mail mit Link). Liegt die Anreise näher als die Fälligkeit des Rests, muss er gleich alles zahlen. 100 % = ganze Summe sofort, wie bisher. Bei einer Stornierung wird höchstens zurückerstattet, was der Gast bezahlt hat, abzüglich der Stornogebühr.</p>
          <div className="form-grid">
            <div><label htmlFor="fcfdc1">Anzahlung in Prozent</label><input id="fcfdc1" name="percent" type="number" min={10} max={100} step={1} defaultValue={Math.round(hotel.depositBps / 100)} required /></div>
            <div><label htmlFor="fcfdc2">Rest fällig (Tage vor Anreise)</label><input id="fcfdc2" name="dueDays" type="number" min={1} max={60} step={1} defaultValue={hotel.balanceDueDays} required /></div>
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
