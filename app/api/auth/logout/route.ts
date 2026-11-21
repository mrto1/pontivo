import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/src/auth/session";
import { env } from "@/src/env";

export async function POST() {
  const res = NextResponse.redirect(`${env().APP_BASE_URL}/admin/login`, 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
