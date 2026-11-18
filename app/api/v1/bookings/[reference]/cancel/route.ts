import { and, eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { bookings } from "@/src/db/schema";
import { apiError, apiJson, websiteAuth } from "@/src/lib/api-auth";
import { BookingError, cancelBooking, cancellationPreview } from "@/src/services/bookings";

export const dynamic = "force-dynamic";

async function load(req: Request, reference: string) {
  const a = await websiteAuth(req, 30);
  if (a instanceof Response) return a;
  const [b] = await db().select().from(bookings).where(and(eq(bookings.hotelId, a.hotel.id), eq(bookings.reference, reference.trim().toUpperCase())));
  if (!b) return apiError(404, "not_found", "Buchung nicht gefunden.");
  return { a, b };
}

/** Was würde ein Storno kosten? (Rückerstattung und Gebühr nach den Regeln des Tarifs, SPEC 19.22) */
export async function GET(req: Request, { params }: { params: Promise<{ reference: string }> }) {
  const r = await load(req, (await params).reference);
  if (r instanceof Response) return r;
  const q = await cancellationPreview(r.b.id, { by: "guest", hotelId: r.a.hotel.id });
  return apiJson({ cancellable: q.cancellable, reason: q.reason ?? null, refund_rappen: q.refundRappen, fee_rappen: q.feeRappen });
}

/** Stornieren wie ein Gast (gleiche Fristen, Gebühr und Rückerstattung auf die Zahlungsart). Wiederholung ist unschädlich: schon storniert → 200. */
export async function POST(req: Request, { params }: { params: Promise<{ reference: string }> }) {
  const r = await load(req, (await params).reference);
  if (r instanceof Response) return r;
  if (r.b.status === "cancelled") return apiJson({ reference: r.b.reference, status: "cancelled", already_cancelled: true });
  try {
    const out = await cancelBooking(r.b.id, { by: "guest", actor: `api:${r.a.key.id}`, hotelId: r.a.hotel.id, reason: "api" });
    return apiJson({ reference: r.b.reference, status: "cancelled", refund_rappen: out.refundRappen, fee_rappen: out.feeRappen });
  } catch (e) {
    if (e instanceof BookingError) return apiError(e.httpStatus, e.code, `Stornierung nicht möglich: ${e.code}`);
    throw e;
  }
}
