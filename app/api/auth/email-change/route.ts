import { NextResponse } from "next/server";
import { env } from "@/src/env";
import { confirmEmailChange } from "@/src/services/email-change";

export const dynamic = "force-dynamic";

/** Link aus der Bestätigungsmail an die neue Adresse */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const done = token ? await confirmEmailChange(token) : null;
  const base = env().APP_BASE_URL;
  return NextResponse.redirect(done ? `${base}/mypontivo/login?emailchanged=1` : `${base}/mypontivo/login?error=link`);
}
