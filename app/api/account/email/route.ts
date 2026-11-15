import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { rateLimit } from "@/src/lib/rate-limit";
import { readSessionValue, SESSION_COOKIE } from "@/src/auth/session";
import { requestEmailChange } from "@/src/services/email-change";

export const dynamic = "force-dynamic";

/** E-Mail-Adresse ändern (SPEC 18.10): body { email, code? } → { result } */
export async function POST(req: Request) {
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId) return NextResponse.json({ error: "auth" }, { status: 401 });
  if (!rateLimit(`email-change-ip:${userId}`, 10)) return NextResponse.json({ error: "rate" }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const result = await requestEmailChange(userId, String(body.email ?? ""), body.code ? String(body.code) : undefined);
  return NextResponse.json({ result }, { status: result === "sent" ? 200 : result === "rate" ? 429 : 400 });
}
