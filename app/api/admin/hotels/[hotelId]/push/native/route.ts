import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import { nativePushTokens } from "@/src/db/schema";
import { atLeast, readSessionValue, roleIn, SESSION_COOKIE } from "@/src/auth/session";

export const dynamic = "force-dynamic";

const body = z.object({ platform: z.enum(["android", "ios"]), token: z.string().min(20).max(4096), app_version: z.string().max(40).optional() });

async function member(hotelId: string) {
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !atLeast(await roleIn(userId, hotelId), "staff")) return null;
  return userId;
}

/** Die App meldet ihre Gerätekennung für Mitteilungen an (SPEC 19.23). Gilt für das angemeldete Konto und diesen Betrieb. */
export async function POST(req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = await member(hotelId);
  if (!userId) return Response.json({ error: "not_found" }, { status: 404 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "invalid" }, { status: 400 });
  await db().insert(nativePushTokens).values({ hotelId, userId, platform: p.data.platform, token: p.data.token, appVersion: p.data.app_version ?? null })
    .onConflictDoUpdate({ target: [nativePushTokens.hotelId, nativePushTokens.userId, nativePushTokens.token], set: { platform: p.data.platform, appVersion: p.data.app_version ?? null } });
  return Response.json({ ok: true });
}

/** Abmelden (z. B. beim Ausloggen in der App) */
export async function DELETE(req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = await member(hotelId);
  if (!userId) return Response.json({ error: "not_found" }, { status: 404 });
  const token = new URL(req.url).searchParams.get("token") ?? "";
  await db().delete(nativePushTokens).where(and(eq(nativePushTokens.hotelId, hotelId), eq(nativePushTokens.userId, userId), eq(nativePushTokens.token, token)));
  return Response.json({ ok: true });
}
