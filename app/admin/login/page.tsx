import { redirect } from "next/navigation";
import { requestLoginLink } from "@/src/auth/session";
import { currentUserId } from "@/src/auth/guard";
import { clientIp, rateLimit } from "@/src/lib/rate-limit";
import { headers } from "next/headers";
import { env } from "@/src/env";
import { PasskeyLogin } from "@/components/admin/PasskeyLogin";

export const dynamic = "force-dynamic";

async function requestLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const h = await headers();
  const ip = clientIp(new Request("http://x", { headers: h }));
  if (!rateLimit(`login:${ip}`, 5)) redirect("/admin/login?sent=1");
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
      <p className="muted">Am einfachsten mit Passkey. Alternativ senden wir Ihnen einen Login-Link per E-Mail (15 Minuten gültig). Wer «nur Passkey» eingeschaltet hat, erhält keinen Link.</p>
      {sp.error ? <p className="notice warn">Der Link ist ungültig oder abgelaufen. Bitte neu anfordern.</p> : null}
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
        <button className="btn" type="submit">Login-Link senden</button>
      </form>
    </main>
  );
}
