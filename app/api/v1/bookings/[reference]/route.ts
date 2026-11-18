import { and, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { bookings } from "@/src/db/schema";
import { apiError, websiteAuth } from "@/src/lib/api-auth";

export const dynamic = "force-dynamic";

/** Status einer Buchung des eigenen Betriebs (SPEC 19.22): so sieht die Website, ob bezahlt und bestätigt ist. */
export async function GET(req: Request, { params }: { params: Promise<{ reference: string }> }) {
  const a = await websiteAuth(req);
  if (a instanceof Response) return a;
  const { reference } = await params;
  const [b] = await db().select().from(bookings).where(and(eq(bookings.hotelId, a.hotel.id), eq(bookings.reference, reference.trim().toUpperCase())));
  if (!b) return apiError(404, "not_found", "Buchung nicht gefunden.");
  return Response.json({ reference: b.reference, status: b.status, checkin: b.checkin, checkout: b.checkout, adults: b.adults, children: b.children, total_rappen: b.totalRappen, source: b.source, hold_expires_at: b.holdExpiresAt, confirmed_at: b.confirmedAt });
}
