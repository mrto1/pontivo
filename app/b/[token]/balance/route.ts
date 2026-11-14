import { startBalancePayment } from "@/src/services/balance";
import { BookingError } from "@/src/services/bookings";
import { clientIp, rateLimit } from "@/src/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Restzahlung starten (SPEC 5.9): erzeugt eine frische Zahlungsseite und leitet dorthin weiter. Wer den Buchungslink kennt, darf zahlen. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!rateLimit(`balance:${clientIp(req)}`, 10)) return new Response("Too many requests", { status: 429 });
  try {
    const { url } = await startBalancePayment(token);
    return Response.redirect(url, 303);
  } catch (e) {
    if (e instanceof BookingError) return Response.redirect(new URL(`/b/${token}`, req.url), 303);
    throw e;
  }
}
