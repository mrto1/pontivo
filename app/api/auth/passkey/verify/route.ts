import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clientIp, rateLimit } from "@/src/lib/rate-limit";
import { createSessionValue, readShort, SESSION_COOKIE, sessionCookieOptions, WEBAUTHN_COOKIE } from "@/src/auth/session";
import { verifyPasskeyLogin } from "@/src/services/mfa";

export const dynamic = "force-dynamic";

/** Anmeldung per Passkey, Schritt 2: Antwort des Geräts prüfen, Sitzung setzen */
export async function POST(req: Request) {
  if (!rateLimit(`pk-ver:${clientIp(req)}`, 20)) return NextResponse.json({ ok: false }, { status: 429 });
  const ch = readShort<{ c: string; p: string }>((await cookies()).get(WEBAUTHN_COOKIE)?.value);
  const body = await req.json().catch(() => null);
  if (!ch || ch.p !== "login" || !body) return NextResponse.json({ ok: false }, { status: 400 });
  const userId = await verifyPasskeyLogin(body, ch.c);
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionValue(userId), sessionCookieOptions());
  res.cookies.delete({ name: WEBAUTHN_COOKIE, path: "/api" });
  return res;
}
