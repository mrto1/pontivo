import { cookies } from "next/headers";
import { atLeast, readSessionValue, roleIn, SESSION_COOKIE } from "@/src/auth/session";
import { hasSubscription, pushConfigured, removeSubscription, saveSubscription, vapidPublicKey } from "@/src/push/service";

export const dynamic = "force-dynamic";

/** Mitarbeitende und höher (nicht die eingeschränkten Rollen, die keine Buchungsmeldungen bekommen sollen) dürfen Mitteilungen für das eigene Gerät ein- und ausschalten */
async function member(hotelId: string) {
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !atLeast(await roleIn(userId, hotelId), "staff")) return null;
  return userId;
}

/** Stand für dieses Gerät: ?endpoint=… */
export async function GET(req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = await member(hotelId);
  if (!userId) return Response.json({ error: "not_found" }, { status: 404 });
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  return Response.json({
    configured: pushConfigured(),
    publicKey: vapidPublicKey(),
    subscribed: endpoint ? await hasSubscription(hotelId, userId, endpoint) : false,
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = await member(hotelId);
  if (!userId) return Response.json({ error: "not_found" }, { status: 404 });
  if (!pushConfigured()) return Response.json({ error: "Mitteilungen sind auf dem Server nicht eingerichtet." }, { status: 503 });
  try {
    await saveSubscription(hotelId, userId, await req.json(), req.headers.get("user-agent"));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const userId = await member(hotelId);
  if (!userId) return Response.json({ error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (body.endpoint) await removeSubscription(hotelId, userId, body.endpoint);
  return Response.json({ ok: true });
}
