import { redirect } from "next/navigation";
import { requestLoginLink } from "@/src/auth/session";
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

async function requestLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const h = await headers();
  const ip = clientIp(new Request("http://x", { headers: h }));
  // Bots und Überschreitungen bekommen dieselbe Antwort wie alle («Link ist unterwegs»), damit nichts über Konten verraten wird
  const check = await checkPublicForm(formData, ip, { minMs: 1000 });
  if (check === "retry") redirect("/admin/login?error=retry");
  if (check === "turnstile") redirect("/admin/login?error=turnstile");
  if (check === "bot") redirect("/admin/login?sent=1");
  // je IP 10 Anträge pro 10 Minuten, je Adresse 5 pro Stunde (verhindert Mail-Flut an eine fremde Adresse)
  if (!(await limitByIpAndEmail("login", ip, email, { ipLimit: 10, ipWindowMs: 600_000, emailLimit: 5, emailWindowMs: 3_600_000 }))) redirect("/admin/login?sent=1");
  const link = email ? await requestLoginLink(email) : null;
  // In der Entwicklung ohne E-Mail-Versand: Link direkt anzeigen
  const showDev = link && env().NODE_ENV !== "production" && !env().POSTMARK_SERVER_TOKEN;
  redirect(showDev ? `/admin/login?sent=1&dev=${encodeURIComponent(link)}` : "/admin/login?sent=1");
}

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await currentUserId()) redirect("/admin");
  const sp = await searchParams;
  return (
    <main className="wrap" style={{ maxWidth: 420, padding: "80px 16px" }}>
      <h1>Anmelden</h1>
      <p className="muted">Melden Sie sich mit Passkey oder mit einem Login-Link per E-Mail an (15 Minuten gültig). Wer die Zwei-Faktor-Anmeldung eingeschaltet hat, gibt danach den Code der Authenticator-App ein. Wer «nur Passkey» eingeschaltet hat, erhält keinen Link.</p>
      {sp.emailchanged ? <p className="notice">Die neue E-Mail-Adresse ist bestätigt. Bitte melden Sie sich damit an.</p> : null}
      {sp.error === "retry" ? <p className="notice warn">Bitte nochmals absenden.</p> : null}
      {sp.error === "turnstile" ? <p className="notice warn">Die Sicherheitsprüfung ist fehlgeschlagen. Bitte die Seite neu laden und nochmals versuchen.</p> : null}
      {sp.error === "link" ? <p className="notice warn">Der Link ist ungültig oder abgelaufen. Bitte neu anfordern.</p> : null}
      {sp.sent ? <p className="notice">Falls die Adresse bei uns registriert ist, ist der Link unterwegs.</p> : null}
      {sp.dev ? (
        <p className="notice warn small">
          Entwicklung (kein E-Mail-Versand konfiguriert): <a href={sp.dev}>Hier anmelden</a>
        </p>
      ) : null}
      <PasskeyLogin />
      <form action={requestLink} className="card stack">
        <div>
          <label htmlFor="email">E-Mail</label>
          <input id="email" name="email" type="email" required autoComplete="email webauthn" />
        </div>
        <FormGuard />
        {turnstileEnabled() ? <Turnstile siteKey={env().TURNSTILE_SITE_KEY!} /> : null}
        <button className="btn" type="submit">Login-Link senden</button>
      </form>
    </main>
  );
}
