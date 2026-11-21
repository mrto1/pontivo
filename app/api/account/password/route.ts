import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { rateLimit } from "@/src/lib/rate-limit";
import { readSessionValue, SESSION_COOKIE } from "@/src/auth/session";
import { changePassword } from "@/src/services/password";

export const dynamic = "force-dynamic";

/** Passwort des angemeldeten Benutzers setzen oder ändern (aktuelles Passwort nötig, wenn schon eins besteht) */
export async function POST(req: Request) {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return NextResponse.json({ error: "type" }, { status: 415 });
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "auth" }, { status: 401 });
  if (!rateLimit(`pw-acct:${userId}`, 10)) return NextResponse.json({ error: "rate" }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const r = await changePassword(userId, body.current ? String(body.current) : null, String(body.password ?? ""));
  if (r === "ok") return NextResponse.json({ ok: true });
  if (r === "wrong") return NextResponse.json({ ok: false, error: "Das aktuelle Passwort stimmt nicht." }, { status: 400 });
  return NextResponse.json({ ok: false, error: r.problem }, { status: 400 });
}
