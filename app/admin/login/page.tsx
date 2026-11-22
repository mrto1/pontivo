import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { MFA_COOKIE, requestLoginLink, createSessionValue, SESSION_COOKIE, sessionCookieOptions, signShort } from "@/src/auth/session";
import { hasTotp } from "@/src/services/mfa";
import { loginWithPassword } from "@/src/services/password";
import { Logo } from "@/components/marketing/Chrome";
import { currentUserId } from "@/src/auth/guard";
import { clientIp } from "@/src/lib/rate-limit";
import { checkPublicForm, limitByIpAndEmail } from "@/src/lib/public-form";
import { FormGuard } from "@/components/FormGuard";
import { Turnstile } from "@/components/Turnstile";
import { turnstileEnabled } from "@/src/integrations/turnstile";
import { headers } from "next/headers";
import { env } from "@/src/env";
import { PasskeyLogin } from "@/components/admin/PasskeyLogin";

export const dynamic = "force-dynamic";

/** Anmeldung mit E-Mail und Passwort. Fehler und Sperren zeigen dieselbe Meldung (keine Auskunft über Konten). */
async function passwordLogin(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const h = await headers();
  const ip = clientIp(new Request("http://x", { headers: h }));
  const check = await checkPublicForm(formData, ip, { minMs: 600 });
  if (check === "retry") redirect("/admin/login?error=retry");
  if (check === "turnstile") redirect("/admin/login?error=turnstile");
  if (check === "bot") redirect("/admin/login?error=pw");
  // Durchprobieren bremsen: je IP 30 und je Adresse 10 Versuche pro 10 Minuten
  if (!(await limitByIpAndEmail("pwlogin", ip, email, { ipLimit: 30, ipWindowMs: 600_000, emailLimit: 10, emailWindowMs: 600_000 }))) redirect("/admin/login?error=rate");
  const userId = email && password ? await loginWithPassword(email, password) : null;
  if (!userId) redirect("/admin/login?error=pw");
  const jar = await cookies();
  // Mit aktiver Authenticator-App folgt als zweiter Schritt der Code (Sitzung erst danach)
  if (await hasTotp(userId)) {
    jar.set(MFA_COOKIE, signShort({ u: userId }, 300), { httpOnly: true, sameSite: "lax", secure: env().APP_BASE_URL.startsWith("https://"), path: "/admin/login", maxAge: 300 });
    redirect("/admin/login/2fa");
  }
  jar.set(SESSION_COOKIE, createSessionValue(userId), sessionCookieOptions());
  redirect("/admin");
}

async function requestLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const h = await headers();
  const ip = clientIp(new Request("http://x", { headers: h }));
  // Bots und Überschreitungen bekommen dieselbe Antwort wie alle («Link ist unterwegs»), damit nichts über Konten verraten wird
  const check = await checkPublicForm(formData, ip, { minMs: 1000 });
  if (check === "retry") redirect("/admin/login?link=1&error=retry");
  if (check === "turnstile") redirect("/admin/login?link=1&error=turnstile");
  if (check === "bot") redirect("/admin/login?link=1&sent=1");
  // je IP 10 Anträge pro 10 Minuten, je Adresse 5 pro Stunde (verhindert Mail-Flut an eine fremde Adresse)
  if (!(await limitByIpAndEmail("login", ip, email, { ipLimit: 10, ipWindowMs: 600_000, emailLimit: 5, emailWindowMs: 3_600_000 }))) redirect("/admin/login?link=1&sent=1");
  const link = email ? await requestLoginLink(email) : null;
  // In der Entwicklung ohne E-Mail-Versand: Link direkt anzeigen
  const showDev = link && env().NODE_ENV !== "production" && !env().POSTMARK_SERVER_TOKEN;
  redirect(showDev ? `/admin/login?link=1&sent=1&dev=${encodeURIComponent(link)}` : "/admin/login?link=1&sent=1");
}

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await currentUserId()) redirect("/admin");
  const sp = await searchParams;
  const linkMode = sp.link === "1" || !!sp.sent;
  return (
    <main className="login-wrap">
      <div className="login-card">
        <div className="login-brand"><span className="login-logo" style={{ ["--pv-fee" as string]: "#e0902b" }}><Logo /></span> Pontivo</div>
        <h1>{linkMode ? "Login-Link anfordern" : "Anmelden"}</h1>
        {sp.emailchanged ? <p className="notice">Die neue E-Mail-Adresse ist bestätigt. Bitte melden Sie sich damit an.</p> : null}
        {sp.error === "retry" ? <p className="notice warn">Bitte nochmals absenden.</p> : null}
        {sp.error === "turnstile" ? <p className="notice warn">Die Sicherheitsprüfung ist fehlgeschlagen. Bitte die Seite neu laden und nochmals versuchen.</p> : null}
        {sp.error === "link" ? <p className="notice warn">Der Link ist ungültig oder abgelaufen. Bitte neu anfordern.</p> : null}
        {sp.error === "pw" ? <p className="notice warn" role="alert">E-Mail oder Passwort stimmen nicht. «Nur Passkey» eingeschaltet? Dann melden Sie sich mit dem Passkey an.</p> : null}
        {sp.error === "rate" ? <p className="notice warn" role="alert">Zu viele Versuche. Bitte in einigen Minuten nochmals versuchen.</p> : null}
        {sp.sent ? <p className="notice">Falls die Adresse bei uns registriert ist, ist der Link unterwegs (15 Minuten gültig). Damit können Sie sich anmelden und unter «Profil &amp; Sicherheit» ein Passwort setzen.</p> : null}
        {sp.dev ? (
          <p className="notice warn small">
            Entwicklung (kein E-Mail-Versand konfiguriert): <a href={sp.dev}>Hier anmelden</a>
          </p>
        ) : null}

        {linkMode ? (
          <>
            <p className="muted">Wenn Sie Ihr Passwort vergessen haben oder noch keins haben, schicken wir Ihnen einen Link per E-Mail. Wer «nur Passkey» eingeschaltet hat, erhält keinen Link.</p>
            <form action={requestLink} className="stack">
              <div>
                <label htmlFor="email">E-Mail</label>
                <input id="email" name="email" type="email" required autoComplete="email" autoFocus />
              </div>
              <FormGuard />
              {turnstileEnabled() ? <Turnstile siteKey={env().TURNSTILE_SITE_KEY!} /> : null}
              <button className="btn" type="submit">Login-Link senden</button>
            </form>
            <p className="small login-alt"><a href="/admin/login">← Zurück zur Anmeldung mit Passwort</a></p>
          </>
        ) : (
          <>
            <PasskeyLogin />
            <div className="login-divider"><span>oder mit Passwort</span></div>
            <form action={passwordLogin} className="stack">
              <div>
                <label htmlFor="email">E-Mail</label>
                <input id="email" name="email" type="email" required autoComplete="username webauthn" />
              </div>
              <div>
                <label htmlFor="password">Passwort</label>
                <input id="password" name="password" type="password" required autoComplete="current-password" />
              </div>
              <FormGuard />
              {turnstileEnabled() ? <Turnstile siteKey={env().TURNSTILE_SITE_KEY!} /> : null}
              <button className="btn" type="submit">Anmelden</button>
            </form>
            <p className="small login-alt"><a href="/admin/login?link=1">Passwort vergessen?</a></p>
          </>
        )}
      </div>
    </main>
  );
}
