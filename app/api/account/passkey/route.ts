import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/src/env";
import { readSessionValue, readShort, SESSION_COOKIE, signShort, WEBAUTHN_COOKIE } from "@/src/auth/session";
import { deletePasskey, passkeyRegistrationOptions, verifyPasskeyRegistration } from "@/src/services/mfa";

export const dynamic = "force-dynamic";

/** Passkeys des angemeldeten Benutzers: action = options | verify | delete */
export async function POST(req: Request) {
  const jar = await cookies();
  const userId = readSessionValue(jar.get(SESSION_COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "auth" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.action === "options") {
    const options = await passkeyRegistrationOptions(userId);
    const res = NextResponse.json(options);
    res.cookies.set(WEBAUTHN_COOKIE, signShort({ c: options.challenge, p: "register", u: userId }, 300), { httpOnly: true, sameSite: "strict", secure: env().APP_BASE_URL.startsWith("https://"), path: "/api", maxAge: 300 });
    return res;
  }
  if (body.action === "verify") {
    const ch = readShort<{ c: string; p: string; u: string }>(jar.get(WEBAUTHN_COOKIE)?.value);
    if (!ch || ch.p !== "register" || ch.u !== userId) return NextResponse.json({ ok: false }, { status: 400 });
    let ok = false;
    try { ok = await verifyPasskeyRegistration(userId, body.response, ch.c, String(body.name ?? "")); } catch { ok = false; }
    const res = NextResponse.json({ ok }, { status: ok ? 200 : 400 });
    res.cookies.delete({ name: WEBAUTHN_COOKIE, path: "/api" });
    return res;
  }
  if (body.action === "delete") return NextResponse.json({ ok: await deletePasskey(userId, String(body.id ?? "")) });
  return NextResponse.json({ error: "action" }, { status: 400 });
}
