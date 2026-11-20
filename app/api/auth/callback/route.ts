import { NextResponse } from "next/server";
import { consumeLoginToken, createSessionValue, MFA_COOKIE, SESSION_COOKIE, sessionCookieOptions, signShort } from "@/src/auth/session";
import { hasTotp } from "@/src/services/mfa";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const base = env().APP_BASE_URL;
  const userId = token ? await consumeLoginToken(token) : null;
  if (!userId) return NextResponse.redirect(`${base}/mypontivo/login?error=link`);
  // Mit aktiver Authenticator-App folgt als zweiter Schritt der Code (Sitzung erst danach)
  if (await hasTotp(userId)) {
    const res = NextResponse.redirect(`${base}/mypontivo/login/2fa`);
    res.cookies.set(MFA_COOKIE, signShort({ u: userId }, 300), { httpOnly: true, sameSite: "lax", secure: base.startsWith("https://"), path: "/mypontivo/login", maxAge: 300 });
    return res;
  }
  const res = NextResponse.redirect(`${base}/mypontivo`);
  res.cookies.set(SESSION_COOKIE, createSessionValue(userId), sessionCookieOptions());
  return res;
}
