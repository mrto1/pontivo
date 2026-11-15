import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { rateLimit } from "@/src/lib/rate-limit";
import { readSessionValue, SESSION_COOKIE } from "@/src/auth/session";
import { beginTotp, confirmTotp, disableTotp, regenerateRecoveryCodes } from "@/src/services/mfa";

export const dynamic = "force-dynamic";

/** Authenticator-App (TOTP) des angemeldeten Benutzers: action = begin | confirm | disable | regenerate */
export async function POST(req: Request) {
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "auth" }, { status: 401 });
  if (!rateLimit(`totp-acct:${userId}`, 10)) return NextResponse.json({ error: "rate" }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? "");
  try {
    if (body.action === "begin") return NextResponse.json({ ok: true, ...(await beginTotp(userId)) });
    if (body.action === "confirm") {
      const codes = await confirmTotp(userId, code);
      return NextResponse.json(codes ? { ok: true, recoveryCodes: codes } : { ok: false }, { status: codes ? 200 : 400 });
    }
    if (body.action === "disable") {
      const ok = await disableTotp(userId, code);
      return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
    }
    if (body.action === "regenerate") {
      const codes = await regenerateRecoveryCodes(userId, code);
      return NextResponse.json(codes ? { ok: true, recoveryCodes: codes } : { ok: false }, { status: codes ? 200 : 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json({ error: "action" }, { status: 400 });
}
