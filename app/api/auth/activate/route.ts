import { NextResponse } from "next/server";
import { consumeLoginToken } from "@/src/auth/session";
import { env } from "@/src/env";

export const dynamic = "force-dynamic";

/** Aktivierungslink aus der Registrierung: bestätigt die E-Mail-Adresse, meldet aber NICHT an (dafür braucht es Passwort oder Passkey). */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const base = env().APP_BASE_URL;
  const userId = token ? await consumeLoginToken(token, new Date(), "activate") : null;
  return NextResponse.redirect(`${base}/admin/login?${userId ? "activated=1" : "error=activate"}`);
}
