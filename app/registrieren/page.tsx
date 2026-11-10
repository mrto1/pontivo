import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { CANTONS, PROPERTY_LABEL, PROPERTY_TYPES, registerHost } from "@/src/services/onboarding";
import { getHotelByHost } from "@/src/services/hotels";
import { clientIp, rateLimit } from "@/src/lib/rate-limit";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Registrieren – Direktbuchung für Ihren Betrieb", robots: { index: true } };

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function register(f: FormData) {
  "use server";
  const h = await headers();
  if (s(f, "website")) redirect("/registrieren/danke"); // Spam-Falle
  if (!rateLimit(`register:${clientIp(new Request("http://x", { headers: h }))}`, 3)) redirect("/registrieren?error=" + encodeURIComponent("Zu viele Versuche. Bitte in einer Minute nochmals."));
  let link: string | null = null;
  try {
    const r = await registerHost({
      propertyType: s(f, "propertyType") as never, name: s(f, "name"), contactName: s(f, "contactName"), email: s(f, "email"),
      canton: s(f, "canton") as never, municipality: s(f, "municipality"),
      mode: s(f, "mode") === "booking_only" ? "booking_only" : "website", websiteUrl: s(f, "websiteUrl"), acceptTerms: f.get("terms") === "on" ? true : (false as never),
    });
    link = r.loginLink;
  } catch (e) {
    if (e instanceof ZodError) redirect("/registrieren?error=" + encodeURIComponent(e.issues.map((i) => i.message).join(" · ")));
    throw e;
  }
  const dev = link && env().NODE_ENV !== "production" && !env().POSTMARK_SERVER_TOKEN;
  redirect(dev ? `/registrieren/danke?dev=${encodeURIComponent(link!)}` : "/registrieren/danke");
}

export default async function Register({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await getHotelByHost((await headers()).get("host"))) redirect("/");
  const sp = await searchParams;
  const name = env().PLATFORM_NAME;
  return (
    <main className="wrap register">
      <a href="/" className="brand">{name}</a>
      <div className="register-grid">
        <section>
          <h1>Direktbuchung für Ihren Betrieb – in 20 Minuten eingerichtet</h1>
          <p className="muted">Online-Buchung mit TWINT und Kartenzahlung für Hotels, B&amp;Bs, Ferienwohnungen und Chalets in der Schweiz – mit neuer Website oder eingebaut in Ihre bestehende.</p>
          <ol className="register-steps">
            <li><strong>Registrieren</strong> – Sie erhalten einen Login-Link per E-Mail.</li>
            <li><strong>Einrichten</strong> – der Assistent fragt Angaben, Kurtaxe, Preise und Fotos ab. Unterbrechen jederzeit möglich.</li>
            <li><strong>Zahlungen aktivieren</strong> – Konto bei Stripe eröffnen, Geld geht direkt an Sie.</li>
            <li><strong>Online gehen</strong> – sofort buchbar. Mit eigener Website: Link oder Knopf «Buchen» einbauen, wir zeigen wie.</li>
          </ol>
          <div className="card small">
            <strong>Preis, mit oder ohne Website gleich:</strong> 1 % pro Direktbuchung, mindestens CHF 19 pro Monat (ab dem ersten vollen Monat nach dem Live-Gang). Liegen die 1 % darunter, wird nur die Differenz belastet. Keine Einrichtungsgebühr, monatlich kündbar.
          </div>
        </section>
        <form action={register} className="card stack">
          <h2 style={{ margin: 0 }}>Registrieren</h2>
          {sp.error ? <p className="notice warn" role="alert">{sp.error}</p> : null}
          <fieldset className="plain"><legend className="small muted">Was vermieten Sie?</legend>
            <div className="type-pick">
              {PROPERTY_TYPES.map((t, i) => (
                <label key={t}><input type="radio" name="propertyType" value={t} defaultChecked={i === 0} required />{PROPERTY_LABEL[t]}</label>
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
          <div className="form-grid" style={{ marginTop: 0 }}>
            <div><label htmlFor="canton">Kanton</label>
              <select id="canton" name="canton" required defaultValue=""><option value="" disabled>wählen</option>{CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label htmlFor="municipality">Gemeinde</label><input id="municipality" name="municipality" required maxLength={100} placeholder="für die Kurtaxe" /></div>
          </div>
          <div><label htmlFor="contactName">Ihr Name</label><input id="contactName" name="contactName" required maxLength={120} autoComplete="name" /></div>
          <div><label htmlFor="email">E-Mail</label><input id="email" name="email" type="email" required maxLength={200} autoComplete="email" /></div>
          <div className="hp" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
          <label className="check"><input type="checkbox" name="terms" required /><span>Ich akzeptiere die <a href="/gastgeber-bedingungen" target="_blank">Bedingungen für Gastgeber</a> (1 %, mindestens CHF 19 pro Monat).</span></label>
          <button className="btn">Registrieren und Login-Link erhalten</button>
          <p className="small muted">Schon registriert? <a href="/admin/login">Anmelden</a></p>
        </form>
      </div>
    </main>
  );
}
