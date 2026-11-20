import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp } from "@/src/lib/rate-limit";
import { rateLimitDb } from "@/src/lib/rate-limit-db";
import { createSessionValue, MFA_COOKIE, readShort, SESSION_COOKIE, sessionCookieOptions } from "@/src/auth/session";
import { verifySecondFactor } from "@/src/services/mfa";

export const dynamic = "force-dynamic";

async function submit(formData: FormData) {
  "use server";
  const jar = await cookies();
  const p = readShort<{ u: string }>(jar.get(MFA_COOKIE)?.value);
  if (!p) redirect("/mypontivo/login?error=link");
  const ip = clientIp(new Request("http://x", { headers: await headers() }));
  if (!(await rateLimitDb(`2fa:${p.u}`, 5, 300_000)) || !(await rateLimitDb(`2fa-ip:${ip}`, 20, 300_000))) redirect("/mypontivo/login/2fa?error=rate");
  if (!(await verifySecondFactor(p.u, String(formData.get("code") ?? "")))) redirect("/mypontivo/login/2fa?error=code");
  jar.set(SESSION_COOKIE, createSessionValue(p.u), sessionCookieOptions());
  jar.delete({ name: MFA_COOKIE, path: "/mypontivo/login" });
  redirect("/mypontivo");
}

export default async function TwoFactor({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if (!readShort((await cookies()).get(MFA_COOKIE)?.value)) redirect("/mypontivo/login");
  return (
    <main className="wrap" style={{ maxWidth: 420, padding: "80px 16px" }}>
      <h1>Zweiter Faktor</h1>
      <p className="muted">Geben Sie den 6-stelligen Code Ihrer Authenticator-App ein. Ohne Handy können Sie einen Wiederherstellungscode verwenden.</p>
      {sp.error === "code" ? <p className="notice warn">Der Code stimmt nicht.</p> : null}
      {sp.error === "rate" ? <p className="notice warn">Zu viele Versuche. Bitte in einigen Minuten neu anmelden.</p> : null}
      <form action={submit} className="card stack">
        <div>
          <label htmlFor="code">Code</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required />
        </div>
        <button className="btn" type="submit">Anmelden</button>
      </form>
      <p className="small"><a href="/mypontivo/login">Abbrechen</a></p>
    </main>
  );
}
