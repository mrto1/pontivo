import type { Metadata } from "next";
import { feePercentText } from "@/src/domain/fee";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { PlatformFrame } from "@/components/marketing/Chrome";
import { AccountExistsError, CANTONS, PROPERTY_LABEL, PROPERTY_TYPES, registerHost } from "@/src/services/onboarding";
import { getHotelByHost } from "@/src/services/hotels";
import { clientIp } from "@/src/lib/rate-limit";
import { checkPublicForm, limitByIpAndEmail } from "@/src/lib/public-form";
import { DisposableEmailError } from "@/src/services/onboarding";
import { FormGuard } from "@/components/FormGuard";
import { Turnstile } from "@/components/Turnstile";
import { turnstileEnabled } from "@/src/integrations/turnstile";
import { env } from "@/src/env";
import { requestLoginLink } from "@/src/auth/session";
import { currentUserId } from "@/src/auth/guard";
import { s } from "@/src/lib/form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Registrieren – Direktbuchung für Ihren Betrieb", robots: { index: true } };


async function register(f: FormData) {
  "use server";
  const h = await headers();
  const ip = clientIp(new Request("http://x", { headers: h }));
  // Bots (Honeypot, zu schnell) sehen dieselbe «Danke»-Seite, es passiert aber nichts
  const check = await checkPublicForm(f, ip, { minMs: 3000 });
  if (check === "bot") redirect("/registrieren/danke");
  if (check === "retry") redirect("/registrieren?error=" + encodeURIComponent("Das ging zu schnell oder die Seite war zu lange offen. Bitte das Formular nochmals absenden."));
  if (check === "turnstile") redirect("/registrieren?error=" + encodeURIComponent("Die Sicherheitsprüfung ist fehlgeschlagen. Bitte die Seite neu laden und nochmals versuchen."));
  // je IP 5 Registrierungen pro 10 Minuten, je E-Mail-Adresse 3 pro Stunde (Datenbank)
  if (!(await limitByIpAndEmail("register", ip, s(f, "email"), { ipLimit: 5, ipWindowMs: 600_000, emailLimit: 3, emailWindowMs: 3_600_000 }))) {
    redirect("/registrieren?error=" + encodeURIComponent("Zu viele Versuche. Bitte später nochmals."));
  }
  let link: string | null = null;
  try {
    const r = await registerHost({
      propertyType: s(f, "propertyType") as never, name: s(f, "name"), contactName: s(f, "contactName"), email: s(f, "email"), password: s(f, "password"),
      canton: s(f, "canton") as never, municipality: s(f, "municipality"),
      mode: s(f, "mode") === "booking_only" ? "booking_only" : "website", websiteUrl: s(f, "websiteUrl"), acceptTerms: f.get("terms") === "on" ? true : (false as never),
    });
    link = r.loginLink;
  } catch (e) {
    // Konto gibt es schon: kein zweites Konto. Wir schicken nur einen Login-Link; die Antwort ist dieselbe wie bei einer neuen Adresse (keine Auskunft, ob die Adresse bekannt ist).
    if (e instanceof AccountExistsError) {
      const existing = await requestLoginLink(e.email);
      const dev0 = existing && env().NODE_ENV !== "production" && !env().POSTMARK_SERVER_TOKEN;
      redirect(dev0 ? `/registrieren/danke?dev=${encodeURIComponent(existing)}` : "/registrieren/danke");
    }
    if (e instanceof DisposableEmailError) redirect("/registrieren?error=" + encodeURIComponent("Bitte eine dauerhafte E-Mail-Adresse verwenden (Wegwerf-Adressen sind nicht möglich)."));
    if (e instanceof ZodError) redirect("/registrieren?error=" + encodeURIComponent(e.issues.map((i) => i.message).join(" · ")));
    throw e;
  }
  const dev = link && env().NODE_ENV !== "production" && !env().POSTMARK_SERVER_TOKEN;
  redirect(dev ? `/registrieren/danke?dev=${encodeURIComponent(link!)}` : "/registrieren/danke");
}

export default async function Register({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await getHotelByHost((await headers()).get("host"))) redirect("/");
  // Wer angemeldet ist, registriert sich nicht neu: weiterer Betrieb im selben Konto
  if (await currentUserId()) redirect("/admin/neu");
  const sp = await searchParams;
  const forRestaurant = sp.art === "restaurant";
  const talk = env().PLATFORM_CONTACT_EMAIL ? `mailto:${env().PLATFORM_CONTACT_EMAIL}?subject=${encodeURIComponent("Pontivo: Frage vor der Registrierung")}` : "/#kontakt";
  const helpCard = (
    <div className="card register-help" data-testid="register-help">
      <strong>Noch Fragen?</strong> Wir beantworten sie gern, bevor Sie sich entscheiden. <a className="btn secondary small" href={talk}>Gespräch vereinbaren</a>
    </div>
  );
  return (
    <PlatformFrame hideSignup>
    <main className="register u-p-8px-0-56px">
      <div className="register-grid">
        <section>
          {forRestaurant ? (<>
            <h1>Ihr Restaurant online – in 20 Minuten eingerichtet</h1>
            <p className="muted">Website, Tischreservation, Online-Bestellung mit Abholung und Lieferung und auf Wunsch Kasse, für Restaurants, Cafés und Take-aways in der Schweiz.</p>
            {helpCard}
            <ol className="register-steps">
              <li><strong>Registrieren</strong> – Sie bestätigen Ihre E-Mail-Adresse und melden sich mit Passwort an.</li>
              <li><strong>Reservation live</strong> – Öffnungszeiten und Tische angeben, Gäste reservieren sofort über Website, Link oder QR-Code.</li>
              <li><strong>Speisekarte</strong> – aus Ihrer Website oder einem PDF einlesen, prüfen, fertig.</li>
              <li><strong>Online-Bestellung</strong> – sobald Stripe Ihre Zahlungen freigibt, mit Probebestellung live schalten.</li>
            </ol>
            <div className="card small">
              <strong>Preis:</strong> mindestens CHF 19 pro Monat (Reservation und Website inklusive), Online-Bestellung CHF 59 pro Monat ohne Gebühr pro Bestellung, Kasse CHF 29 pro Monat. Keine Gebühr pro Gast, keine Einrichtungsgebühr, monatlich kündbar.
            </div>
          </>) : (<>
          <h1>Direktbuchung für Ihren Betrieb – in 20 Minuten eingerichtet</h1>
          <p className="muted">Online-Buchung mit TWINT und Kartenzahlung für Hotels, B&amp;Bs, Ferienwohnungen und Chalets in der Schweiz – mit neuer Website oder eingebaut in Ihre bestehende.</p>
          {helpCard}
          <ol className="register-steps">
            <li><strong>Registrieren</strong> – Sie bestätigen Ihre E-Mail-Adresse und melden sich mit Passwort an.</li>
            <li><strong>Einrichten</strong> – der Assistent fragt Angaben, Kurtaxe, Preise und Fotos ab. Unterbrechen jederzeit möglich.</li>
            <li><strong>Zahlungen aktivieren</strong> – Konto bei Stripe eröffnen, Geld geht direkt an Sie.</li>
            <li><strong>Online gehen</strong> – sofort buchbar. Mit eigener Website: Link oder Knopf «Buchen» einbauen, wir zeigen wie.</li>
          </ol>
          <p className="small muted">Unsicher, ob es zu Ihrem Haus passt? <a href="/eignung">Drei Fragen, eine ehrliche Antwort</a>.</p>
          <div className="card small">
            <strong>Preis, mit oder ohne Website gleich:</strong> {feePercentText()} % pro Direktbuchung, mindestens CHF 19 pro Monat (ab dem ersten vollen Monat nach dem Live-Gang). Liegen die {feePercentText()} % darunter, wird nur die Differenz belastet. Keine Einrichtungsgebühr, monatlich kündbar.
          </div>
          </>)}
        </section>
        <form action={register} className="card stack">
          <h2 className="m0">Registrieren</h2>
          {sp.error ? <p className="notice warn" role="alert">{sp.error}</p> : null}
          <fieldset className="plain"><legend className="small muted">Was führen Sie?</legend>
            <div className="type-pick">
              {/* Restaurant: über ?art=restaurant oder nach Freischaltung der Restaurant-Seite (SPEC 20.9) */}
              {PROPERTY_TYPES.map((t, i) => (
                <label key={t}><input type="radio" name="propertyType" value={t} defaultChecked={sp.art === "restaurant" ? t === "restaurant" : i === 0} required />{PROPERTY_LABEL[t]}</label>
              ))}
            </div>
          </fieldset>
          <fieldset className="plain"><legend className="small muted">Brauchen Sie eine Website?</legend>
            <div className="mode-pick">
              <label><input type="radio" name="mode" value="website" defaultChecked /><span><strong>Ja, Website mit Buchung</strong><span className="small muted">Wir erstellen Ihre Website, Sie gestalten sie im Baukasten.</span></span></label>
              <label><input type="radio" name="mode" value="booking_only" /><span><strong>Nein, nur das Buchungssystem</strong><span className="small muted">Sie behalten Ihre Website und bauen einen Link oder Knopf «Buchen» ein.</span></span></label>
            </div>
            <div className="mode-url"><label htmlFor="websiteUrl">Adresse Ihrer Website</label><input id="websiteUrl" name="websiteUrl" maxLength={300} placeholder="www.chalet-edelweiss.ch" inputMode="url" /></div>
          </fieldset>
          <div><label htmlFor="name">Name des Betriebs</label><input id="name" name="name" required maxLength={120} placeholder="z. B. Chalet Edelweiss" /></div>
          <div className="form-grid mt0">
            <div><label htmlFor="canton">Kanton</label>
              <select id="canton" name="canton" required defaultValue=""><option value="" disabled>wählen</option>{CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label htmlFor="municipality">Gemeinde</label><input id="municipality" name="municipality" required maxLength={100} placeholder="für die Kurtaxe" /></div>
          </div>
          <div><label htmlFor="contactName">Ihr Name</label><input id="contactName" name="contactName" required maxLength={120} autoComplete="name" /></div>
          <div><label htmlFor="email">E-Mail</label><input id="email" name="email" type="email" required maxLength={200} autoComplete="email" /></div>
          <div><label htmlFor="password">Passwort</label><input id="password" name="password" type="password" required minLength={8} maxLength={200} autoComplete="new-password" /><span className="small muted">Mindestens 8 Zeichen. Damit melden Sie sich an; einen Passkey richten Sie später unter «Mein Konto» ein.</span></div>
          <FormGuard />
          {turnstileEnabled() ? <Turnstile siteKey={env().TURNSTILE_SITE_KEY!} /> : null}
          <label className="check"><input type="checkbox" name="terms" required /><span>Ich akzeptiere die <a href="/gastgeber-bedingungen" target="_blank">Bedingungen für Gastgeber</a> ({feePercentText()} %, mindestens CHF 19 pro Monat).</span></label>
          <button className="btn">Registrieren</button>
          <p className="small muted">Schon registriert? <a href="/admin/login">Anmelden</a></p>
        </form>
      </div>
    </main>
    </PlatformFrame>
  );
}
