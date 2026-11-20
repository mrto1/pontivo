import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clientIp, rateLimit } from "@/src/lib/rate-limit";
import { env } from "@/src/env";
import { createSessionValue, MFA_COOKIE, readShort, SESSION_COOKIE, sessionCookieOptions, signShort, WEBAUTHN_COOKIE } from "@/src/auth/session";
import { hasTotp, verifyPasskeyLogin } from "@/src/services/mfa";

export const dynamic = "force-dynamic";

/** Anmeldung per Passkey, Schritt 2: Antwort des Geräts prüfen, Sitzung setzen */
export async function POST(req: Request) {
  if (!rateLimit(`pk-ver:${clientIp(req)}`, 20)) return NextResponse.json({ ok: false }, { status: 429 });
  const ch = readShort<{ c: string; p: string }>((await cookies()).get(WEBAUTHN_COOKIE)?.value);
  const body = await req.json().catch(() => null);
  if (!ch || ch.p !== "login" || !body) return NextResponse.json({ ok: false }, { status: 400 });
  const userId = await verifyPasskeyLogin(body, ch.c);
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
  // Aktive Authenticator-App gilt für jeden Anmeldeweg: erst der Code, dann die Sitzung
  const mfa = await hasTotp(userId);
  const res = NextResponse.json({ ok: true, mfa });
  if (mfa) res.cookies.set(MFA_COOKIE, signShort({ u: userId }, 300), { httpOnly: true, sameSite: "lax", secure: env().APP_BASE_URL.startsWith("https://"), path: "/mypontivo/login", maxAge: 300 });
  else res.cookies.set(SESSION_COOKIE, createSessionValue(userId), sessionCookieOptions());
  res.cookies.delete({ name: WEBAUTHN_COOKIE, path: "/api" });
  return res;
}
