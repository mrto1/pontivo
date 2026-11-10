import { cookies } from "next/headers";
import { atLeast, readSessionValue, roleIn, SESSION_COOKIE } from "@/src/auth/session";
import { getHotelById } from "@/src/services/hotels";
import { onboardingSession, refreshAccountStatus } from "@/src/integrations/stripe/onboarding";

export const dynamic = "force-dynamic";

async function owner(hotelId: string) {
  const userId = readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !atLeast(await roleIn(userId, hotelId), "owner")) return null;
  return { userId, hotel: await getHotelById(hotelId) };
}

/** Client-Secret für die eingebettete Stripe-Kontoeröffnung (nur Inhaber) */
export async function POST(_req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const o = await owner(hotelId);
  if (!o?.hotel) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    return Response.json({ client_secret: await onboardingSession(o.hotel, `user:${o.userId}`) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** Nach dem Schliessen der Komponente: Status bei Stripe nachladen */
export async function PUT(_req: Request, ctx: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await ctx.params;
  const o = await owner(hotelId);
  if (!o?.hotel) return Response.json({ error: "not_found" }, { status: 404 });
  await refreshAccountStatus(o.hotel);
  const h = await getHotelById(hotelId);
  return Response.json({ charges_enabled: !!h?.stripeChargesEnabled });
}
