import { NextResponse } from "next/server";
import { env } from "@/src/env";
import { clientIp, rateLimit } from "@/src/lib/rate-limit";
import { signShort, WEBAUTHN_COOKIE } from "@/src/auth/session";
import { passkeyLoginOptions } from "@/src/services/mfa";

export const dynamic = "force-dynamic";

/** Anmeldung per Passkey, Schritt 1: Challenge (signiert im Cookie, 5 Minuten) */
export async function POST(req: Request) {
  if (!rateLimit(`pk-opt:${clientIp(req)}`, 20)) return NextResponse.json({ error: "rate" }, { status: 429 });
  const options = await passkeyLoginOptions();
  const res = NextResponse.json(options);
  res.cookies.set(WEBAUTHN_COOKIE, signShort({ c: options.challenge, p: "login" }, 300), { httpOnly: true, sameSite: "strict", secure: env().APP_BASE_URL.startsWith("https://"), path: "/api", maxAge: 300 });
  return res;
}
